import { Router } from "express";
import { eq, asc } from "drizzle-orm";
import { db, extensionsTable, agentToolsTable, type Extension, type AgentConfig, type Client } from "@workspace/db";

const router = Router();

type ExtensionWithRelations = Extension & {
  agentConfig: AgentConfig | null;
  client: Client | null;
};

type AiProviderKey = "openai" | "elevenlabs" | "gemini" | "deepgram" | "cartesia";

function serviceNameFor(ext: ExtensionWithRelations): string {
  const suffix = ext.extensionNumber.replace(/[^a-zA-Z0-9_.@-]/g, "-");
  return `sip-agent-${suffix || ext.id}`;
}

const PROVIDER_ENV_KEYS: Record<AiProviderKey, string> = {
  openai: "OPENAI_API_KEY",
  elevenlabs: "ELEVEN_LABS_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  cartesia: "CARTESIA_API_KEY",
};

async function buildConfigJson(ext: ExtensionWithRelations): Promise<Record<string, unknown> | null> {
  if (!ext.agentConfig) return null;
  const cfg = ext.agentConfig;
  const { sipUsername, sipAuthId, sipPassword } = ext;
  // SIP domain and server come from the linked IPBX (client), not the extension
  const sipDomain = ext.client?.sipDomain ?? "";
  const sipServer = ext.client?.sipServer ?? "";
  const deployment = await db.query.deploymentsTable.findFirst({
    where: (table, { eq }) => eq(table.extensionId, ext.id),
  });
  const sipLocalPort = deployment?.sipLocalPort ?? 25060 + ext.id * 2;
  const httpPort = deployment?.httpPort ?? 19000 + ext.id;

  // API base URL for callback URLs (same derivation as deployment.ts)
  const apiPort = process.env["PORT"] ?? "8080";
  const apiBaseUrl = process.env["API_BASE_URL"] ?? `http://localhost:${apiPort}/api`;

  const base: Record<string, unknown> = {
    mode: cfg.mode ?? "inbound",
    api_port: httpPort,
    provider: cfg.provider,
    sip: {
      username: sipUsername,
      auth_id: sipAuthId,
      password: sipPassword,
      domain: sipDomain,
      server: sipServer,
      listen: sipLocalPort,
    },
    // Callback URLs so the binary can execute tools and fetch outbound context
    tools_callback_url: `${apiBaseUrl}/tools/execute`,
    context_webhook_url: `${apiBaseUrl}/outbound/context/${ext.id}`,
  };

  // API keys are NOT embedded in config.json — they are passed via environment
  // variables (ELEVEN_LABS_API_KEY, OPENAI_API_KEY, etc.) by the service runner.
  switch (cfg.provider as AiProviderKey) {
    case "openai":
      base["openai"] = {
        ...(cfg.modelId ? { model: cfg.modelId } : { model: "gpt-4o-realtime-preview" }),
        voice: cfg.voiceId ?? "alloy",
        ...(cfg.systemPrompt ? { instructions: cfg.systemPrompt } : {}),
        ...(cfg.greeting ? { greeting: cfg.greeting } : {}),
      };
      break;
    case "elevenlabs":
      base["elevenlabs"] = {
        agent_id: cfg.modelId ?? "",
        ...(cfg.greeting ? { first_message: cfg.greeting } : {}),
        ...(cfg.systemPrompt ? { system_prompt: cfg.systemPrompt } : {}),
      };
      break;
    case "gemini":
      base["gemini"] = {
        model: cfg.modelId ?? "gemini-2.0-flash-live-001",
        voice: cfg.voiceId ?? "Puck",
        ...(cfg.language ? { language: cfg.language } : {}),
        ...(cfg.systemPrompt ? { system_prompt: cfg.systemPrompt } : {}),
        ...(cfg.greeting ? { greeting: cfg.greeting } : {}),
      };
      break;
    case "deepgram":
      base["deepgram"] = {
        model: cfg.modelId ?? "aura-2-thalia-en",
        ...(cfg.voiceId ? { listen_model: cfg.voiceId } : {}),
        ...(cfg.systemPrompt ? { system_prompt: cfg.systemPrompt } : {}),
        ...(cfg.language ? { language: cfg.language } : {}),
      };
      break;
    case "cartesia":
      base["cartesia"] = {
        voice_id: cfg.voiceId ?? "",
        model: cfg.modelId ?? "sonic-2",
        ...(cfg.language ? { language: cfg.language } : {}),
        ...(cfg.systemPrompt ? { system_prompt: cfg.systemPrompt } : {}),
      };
      break;
  }

  if (cfg.extraConfig) {
    try {
      const extra = JSON.parse(cfg.extraConfig) as Record<string, unknown>;
      Object.assign(base, extra);
    } catch {
      // ignore invalid JSON
    }
  }

  // Include enabled tools so standalone deployments have full tool support
  const tools = await db
    .select()
    .from(agentToolsTable)
    .where(eq(agentToolsTable.agentConfigId, cfg.id))
    .orderBy(asc(agentToolsTable.sortOrder), asc(agentToolsTable.createdAt));
  const enabledTools = tools.filter(t => t.enabled);
  if (enabledTools.length > 0) {
    base["tools"] = enabledTools.map(t => ({
      name: t.name,
      description: t.description,
      ...(t.parametersSchema ? { parameters: safeParseJsonGenerate(t.parametersSchema) } : { parameters: {} }),
      execution_type: t.executionType,
      timeout: t.timeout,
      require_confirmation: t.requireConfirmation,
    }));
  }

  return base;
}

function safeParseJsonGenerate(str: string): Record<string, unknown> {
  try { return JSON.parse(str) as Record<string, unknown>; } catch { return {}; }
}

async function buildServiceFile(ext: ExtensionWithRelations): Promise<string | null> {
  if (!ext.agentConfig) return null;
  const cfg = ext.agentConfig;
  const { extensionNumber, sipUsername, sipAuthId, sipPassword } = ext;
  // SIP domain and server come from the linked IPBX (client), not the extension
  const sipDomain = ext.client?.sipDomain ?? "";
  const sipServer = ext.client?.sipServer ?? "";
  const deployment = await db.query.deploymentsTable.findFirst({
    where: (table, { eq }) => eq(table.extensionId, ext.id),
  });
  const sipLocalPort = deployment?.sipLocalPort ?? 25060 + ext.id * 2;
  const httpPort = deployment?.httpPort ?? 19000 + ext.id;

  const providerEnvKey = PROVIDER_ENV_KEYS[cfg.provider as AiProviderKey] ?? "AI_API_KEY";
  // Each extension uses its own config file path so multiple systemd services
  // can run simultaneously without overwriting each other's config.json.
  // WorkingDirectory stays at the always-present parent; the per-extension
  // config directory is created by ExecStartPre before the process starts.
  const configDir = `/opt/sip-agent/ext-${extensionNumber}`;
  const configPath = `${configDir}/config.json`;
  const serviceName = serviceNameFor(ext);

  return `[Unit]
Description=SIP Agent Voice Agent - Extension ${extensionNumber}
After=network.target

[Service]
WorkingDirectory=/opt/sip-agent
ExecStartPre=/bin/mkdir -p ${configDir}
Environment=CONFIG_FILE=${configPath}
Environment=SIP_USERNAME=${sipUsername}
Environment=SIP_AUTH_ID=${sipAuthId}
Environment=SIP_PASSWORD=${sipPassword}
Environment=SIP_DOMAIN=${sipDomain}
Environment=SIP_SERVER=${sipServer}
Environment=SIP_LOCAL_PORT=${sipLocalPort}
Environment=HTTP_PORT=${httpPort}
Environment=SIP_OVERRIDE_PORT=${sipLocalPort}
Environment=${providerEnvKey}=${cfg.apiKey}
ExecStart=/usr/local/bin/sip-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

router.get("/generate/:extensionId/config", async (req, res) => {
  const extensionId = Number(req.params.extensionId);
  if (!Number.isInteger(extensionId) || extensionId <= 0) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }

  const ext = await db.query.extensionsTable.findFirst({
    where: eq(extensionsTable.id, extensionId),
    with: { agentConfig: true, client: true },
  }) as ExtensionWithRelations | undefined;

  if (!ext) {
    res.status(404).json({ error: "Extension not found" });
    return;
  }

  const content = await buildConfigJson(ext);
  if (!content) {
    res.status(404).json({ error: "No AI agent config found for this extension" });
    return;
  }

  res.json({
    filename: `config-ext-${ext.extensionNumber}.json`,
    content,
  });
});

router.get("/generate/:extensionId/service", async (req, res) => {
  const extensionId = Number(req.params.extensionId);
  if (!Number.isInteger(extensionId) || extensionId <= 0) {
    res.status(400).json({ error: "Invalid extensionId" });
    return;
  }

  const ext = await db.query.extensionsTable.findFirst({
    where: eq(extensionsTable.id, extensionId),
    with: { agentConfig: true, client: true },
  }) as ExtensionWithRelations | undefined;

  if (!ext) {
    res.status(404).json({ error: "Extension not found" });
    return;
  }

  const content = await buildServiceFile(ext);
  if (!content) {
    res.status(404).json({ error: "No AI agent config found for this extension" });
    return;
  }

  res.json({
    filename: `${serviceNameFor(ext)}.service`,
    content,
  });
});

export default router;
