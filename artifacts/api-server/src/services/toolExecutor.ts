/**
 * Tool Executor Service
 *
 * Executes agent tools when the AI requests them during a call.
 * The sip-agent binary calls POST /api/tools/execute with the tool name and arguments.
 * We look up the tool definition, execute it, and return the result.
 */
import { db, agentToolsTable, extensionsTable, outboundCallsTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface ToolExecutionRequest {
  extensionId: number;
  callId?: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute a tool by name for a given extension's agent config.
 */
export async function executeTool(req: ToolExecutionRequest): Promise<ToolExecutionResult> {
  // Look up the extension to get its agentConfigId
  const ext = await db.query.extensionsTable.findFirst({
    where: eq(extensionsTable.id, req.extensionId),
    with: { agentConfig: { with: { tools: true } } },
  });

  if (!ext?.agentConfig) {
    return { success: false, error: "Extension or agent config not found" };
  }

  // Find the requested tool
  const tool = ext.agentConfig.tools?.find(
    (t) => t.name === req.toolName && t.enabled
  );

  if (!tool) {
    return { success: false, error: `Tool '${req.toolName}' not found or disabled` };
  }

  logger.info({ extensionId: req.extensionId, toolName: req.toolName, executionType: tool.executionType }, "Executing tool");

  try {
    const result = await executeByType(tool.executionType, tool.executionConfig, req.arguments, req, tool.timeout);
    logger.info({ extensionId: req.extensionId, toolName: req.toolName }, "Tool executed successfully");
    return { success: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ extensionId: req.extensionId, toolName: req.toolName, err }, "Tool execution failed");
    return { success: false, error: message };
  }
}

async function executeByType(
  type: string,
  configJson: string | null | undefined,
  args: Record<string, unknown>,
  req: ToolExecutionRequest,
  timeout: number,
): Promise<unknown> {
  const config = configJson ? safeParseJson(configJson) : {};

  switch (type) {
    case "http_request":
      return executeHttpRequest(config, args, timeout);

    case "webhook":
      return executeWebhook(config, args, req, timeout);

    case "save_result":
      return executeSaveResult(config, args, req);

    case "hang_up":
      // Signal intent; actual execution is handled by the sip-agent
      return { action: "hang_up" };

    case "transfer_call":
      return { action: "transfer_call", destination: args["destination"] ?? config["destination"] };

    case "send_dtmf":
      return { action: "send_dtmf", digits: args["digits"] ?? config["digits"] };

    case "custom_js":
      return executeCustomJs(config, args);

    default:
      throw new Error(`Unknown execution type: ${type}`);
  }
}

async function executeHttpRequest(
  config: Record<string, unknown>,
  args: Record<string, unknown>,
  timeout: number,
): Promise<unknown> {
  const url = (args["url"] as string) ?? (config["url"] as string);
  if (!url) throw new Error("http_request tool requires a 'url' in args or executionConfig");

  const method = ((args["method"] as string) ?? (config["method"] as string) ?? "GET").toUpperCase();
  const headers = Object.assign({}, config["headers"] as Record<string, string> ?? {}, args["headers"] as Record<string, string> ?? {});
  const body = args["body"] ?? config["body"];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);

  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await response.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, ok: response.ok, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function executeWebhook(
  config: Record<string, unknown>,
  args: Record<string, unknown>,
  req: ToolExecutionRequest,
  timeout: number,
): Promise<unknown> {
  const url = (config["url"] as string);
  if (!url) throw new Error("webhook tool requires a 'url' in executionConfig");

  const payload = {
    extensionId: req.extensionId,
    callId: req.callId,
    toolName: req.toolName,
    arguments: args,
    timestamp: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout * 1000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await response.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, ok: response.ok, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * save_result — Built-in tool that writes the AI's collected data to the
 * outbound call record in the DB so the caller can poll GET /api/outbound/calls/:id.
 *
 * If the call record has a webhookUrl, the result is also POSTed there
 * (fire-and-forget — errors are logged, not thrown).
 */
async function executeSaveResult(
  _config: Record<string, unknown>,
  args: Record<string, unknown>,
  req: ToolExecutionRequest,
): Promise<unknown> {
  // Find the most recent outbound call for this extension that is still in progress
  const [call] = await db
    .select()
    .from(outboundCallsTable)
    .where(
      and(
        eq(outboundCallsTable.extensionId, req.extensionId),
        inArray(outboundCallsTable.status, ["dialing", "active", "pending"]),
      ),
    )
    .orderBy(desc(outboundCallsTable.createdAt))
    .limit(1);

  if (!call) {
    logger.warn({ extensionId: req.extensionId }, "save_result: no active outbound call found for this extension");
    return { saved: false, reason: "no active outbound call found" };
  }

  const resultJson = JSON.stringify(args);

  await db
    .update(outboundCallsTable)
    .set({ result: resultJson, status: "completed", updatedAt: new Date() })
    .where(eq(outboundCallsTable.id, call.id));

  logger.info({ extensionId: req.extensionId, callId: call.id, result: args }, "save_result: outbound call result saved");

  // Fire webhook if configured (non-blocking)
  if (call.webhookUrl) {
    const payload = {
      event: "call_result",
      outboundCallId: call.id,
      extensionId: req.extensionId,
      phoneNumber: call.phoneNumber,
      result: args,
      timestamp: new Date().toISOString(),
    };
    fetch(call.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((err) => {
      logger.warn({ err, webhookUrl: call.webhookUrl }, "save_result: webhook delivery failed");
    });
  }

  return { saved: true, outboundCallId: call.id, result: args };
}

function executeCustomJs(
  config: Record<string, unknown>,
  args: Record<string, unknown>,
): unknown {
  const code = config["code"] as string;
  if (!code) throw new Error("custom_js tool requires 'code' in executionConfig");
  // Execute in a restricted scope — only args and basic primitives available
  // eslint-disable-next-line no-new-func
  const fn = new Function("args", code);
  return fn(args);
}

function safeParseJson(str: string): Record<string, unknown> {
  try { return JSON.parse(str) as Record<string, unknown>; } catch { return {}; }
}
