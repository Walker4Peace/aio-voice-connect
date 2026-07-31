import React from "react";
import { useTranslation } from "react-i18next";
import { useListExtensions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Zap, Key, Webhook, Code2, FlaskConical } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).catch(() => {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="absolute top-2 right-2 p-1.5 rounded bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white transition-colors"
      title={copied ? t("api.copied") : t("api.copy")}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ── Code block ────────────────────────────────────────────────────────────────
function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  void lang;
  return (
    <div className="relative">
      <pre className="bg-[#0d1117] text-gray-200 rounded-lg p-4 text-xs font-mono overflow-x-auto border border-gray-800 leading-relaxed whitespace-pre-wrap break-all pr-10">
        {code}
      </pre>
      <CopyBtn text={code} />
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────
function FieldRow({ name, type, required, desc }: { name: string; type: string; required: boolean; desc: string }) {
  const { t } = useTranslation();
  return (
    <tr className="border-b last:border-0">
      <td className="py-2.5 pr-3 font-mono text-xs text-foreground font-semibold whitespace-nowrap">{name}</td>
      <td className="py-2.5 pr-3">
        <Badge variant="outline" className="text-[10px] font-mono">{type}</Badge>
      </td>
      <td className="py-2.5 pr-3">
        {required
          ? <span className="text-xs font-medium text-red-500">{t("api.yes")}</span>
          : <span className="text-xs text-muted-foreground">{t("api.no")}</span>
        }
      </td>
      <td className="py-2.5 text-xs text-muted-foreground">{desc}</td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ApiDocsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: extensions } = useListExtensions();

  const [extId, setExtId] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [firstMsg, setFirstMsg] = React.useState("");
  const [webhook, setWebhook] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const serverUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");

  // ── Code snippets ──────────────────────────────────────────────────────────
  const curlSnippet = `curl -X POST ${serverUrl}/api/outbound/call \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: YOUR_API_KEY" \\
  -d '{
    "extensionId": 1,
    "phoneNumber": "+212661234567",
    "firstMessage": "Hello! I am calling about your request.",
    "webhookUrl": "https://your-crm.com/webhook/result"
  }'`;

  const jsSnippet = `const response = await fetch("${serverUrl}/api/outbound/call", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Api-Key": "YOUR_API_KEY",
  },
  body: JSON.stringify({
    extensionId: 1,
    phoneNumber: "+212661234567",
    firstMessage: "Hello! I am calling about your request.",
    webhookUrl: "https://your-crm.com/webhook/result",
  }),
});

const call = await response.json();
console.log("Call status:", call.status); // "dialing"`;

  const pythonSnippet = `import requests

response = requests.post(
    "${serverUrl}/api/outbound/call",
    headers={
        "Content-Type": "application/json",
        "X-Api-Key": "YOUR_API_KEY",
    },
    json={
        "extensionId": 1,
        "phoneNumber": "+212661234567",
        "firstMessage": "Hello! I am calling about your request.",
        "webhookUrl": "https://your-crm.com/webhook/result",
    },
)

call = response.json()
print("Call status:", call["status"])  # "dialing"`;

  const n8nSnippet = `// n8n — HTTP Request node configuration:
// Method:  POST
// URL:     ${serverUrl}/api/outbound/call
// Auth:    Header Auth  →  Name: X-Api-Key  /  Value: YOUR_API_KEY
// Body:    JSON
{
  "extensionId": {{ $json["extensionId"] }},
  "phoneNumber": "{{ $json["phone"] }}",
  "firstMessage": "Hello {{ $json["firstName"] }}, I'm calling about your request.",
  "variables": {
    "name": "{{ $json["firstName"] }}",
    "company": "{{ $json["company"] }}"
  },
  "webhookUrl": "https://your-n8n-instance.com/webhook/call-result"
}`;

  const webhookPayload = `// POST  https://your-crm.com/webhook/result
{
  "id": 42,
  "extensionId": 1,
  "phoneNumber": "+212661234567",
  "status": "completed",
  "callerId": null,
  "firstMessage": "Hello! I am calling about your request.",
  "variables": { "name": "Hamza" },
  "metadata": null,
  "createdAt": "2026-07-31T00:17:12.000Z",
  "updatedAt": "2026-07-31T00:19:05.000Z"
}`;

  const keySetupCode = `echo 'OUTBOUND_API_KEY=your-secret-key' >> /etc/aio-voice-connect.env`;
  const restartCode = `sudo systemctl restart aio-voice-connect`;

  // ── Live tester ────────────────────────────────────────────────────────────
  const handleTrigger = async () => {
    if (!extId) { toast({ variant: "destructive", title: t("api.testerNoExt") }); return; }
    if (!phone) { toast({ variant: "destructive", title: t("api.testerNoPhone") }); return; }
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/outbound/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extensionId: Number(extId),
          phoneNumber: phone,
          firstMessage: firstMsg || undefined,
          webhookUrl: webhook || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      toast({ title: t("api.testerSuccess"), description: t("api.testerSuccessDesc", { status: data.status }) });
    } catch (e) {
      toast({ variant: "destructive", title: t("api.testerError"), description: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const outboundExts = extensions?.filter(e => e.agentConfig?.mode === "outbound") ?? [];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("api.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("api.description")}</p>
      </div>

      {/* ── Authentication ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4 text-amber-500" />
            {t("api.auth")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("api.authDesc")}{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">OUTBOUND_API_KEY</code>{" "}
            {t("api.authDesc2")}
          </p>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("api.authExample")}</p>
            <CodeBlock code={`X-Api-Key: your-secret-key`} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("api.keySetup")}</p>
            <p className="text-sm text-muted-foreground">{t("api.keySetupDesc")}</p>
            <CodeBlock code={keySetupCode} />
            <p className="text-sm text-muted-foreground">{t("api.keySetupRestart")}</p>
            <CodeBlock code={restartCode} />
          </div>
        </CardContent>
      </Card>

      {/* ── Endpoint ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-500" />
            {t("api.endpoint")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Method + URL */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge className="bg-green-600 hover:bg-green-600 text-white font-mono text-sm px-3 py-1">POST</Badge>
            <code className="text-sm font-mono bg-muted px-3 py-1.5 rounded-md break-all">
              {serverUrl}/api/outbound/call
            </code>
          </div>

          <p className="text-sm text-muted-foreground">{t("api.endpointDesc")}</p>

          {/* Fields table */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{t("api.fields")}</p>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground">{t("api.fieldName")}</th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground">{t("api.fieldType")}</th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground">{t("api.fieldReq")}</th>
                    <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground">{t("api.fieldDesc")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y px-3">
                  <tr className="border-b last:border-0">
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold">extensionId</td>
                    <td className="py-2.5 px-3"><Badge variant="outline" className="text-[10px] font-mono">integer</Badge></td>
                    <td className="py-2.5 px-3"><span className="text-xs font-medium text-red-500">{t("api.yes")}</span></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">ID of the outbound-mode extension to use</td>
                  </tr>
                  <tr className="border-b last:border-0">
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold">phoneNumber</td>
                    <td className="py-2.5 px-3"><Badge variant="outline" className="text-[10px] font-mono">string</Badge></td>
                    <td className="py-2.5 px-3"><span className="text-xs font-medium text-red-500">{t("api.yes")}</span></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">Phone number to call (E.164 recommended, e.g. +212661234567)</td>
                  </tr>
                  <tr className="border-b last:border-0">
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold">callerId</td>
                    <td className="py-2.5 px-3"><Badge variant="outline" className="text-[10px] font-mono">string</Badge></td>
                    <td className="py-2.5 px-3"><span className="text-xs text-muted-foreground">{t("api.no")}</span></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">Caller ID shown to the recipient</td>
                  </tr>
                  <tr className="border-b last:border-0">
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold">firstMessage</td>
                    <td className="py-2.5 px-3"><Badge variant="outline" className="text-[10px] font-mono">string</Badge></td>
                    <td className="py-2.5 px-3"><span className="text-xs text-muted-foreground">{t("api.no")}</span></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">What the AI says first when the call is answered</td>
                  </tr>
                  <tr className="border-b last:border-0">
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold">systemPromptOverride</td>
                    <td className="py-2.5 px-3"><Badge variant="outline" className="text-[10px] font-mono">string</Badge></td>
                    <td className="py-2.5 px-3"><span className="text-xs text-muted-foreground">{t("api.no")}</span></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">Overrides the agent's default system prompt for this call only</td>
                  </tr>
                  <tr className="border-b last:border-0">
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold">variables</td>
                    <td className="py-2.5 px-3"><Badge variant="outline" className="text-[10px] font-mono">object</Badge></td>
                    <td className="py-2.5 px-3"><span className="text-xs text-muted-foreground">{t("api.no")}</span></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">Key-value data passed to the agent (e.g. lead name, product)</td>
                  </tr>
                  <tr className="border-b last:border-0">
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold">metadata</td>
                    <td className="py-2.5 px-3"><Badge variant="outline" className="text-[10px] font-mono">object</Badge></td>
                    <td className="py-2.5 px-3"><span className="text-xs text-muted-foreground">{t("api.no")}</span></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">Arbitrary data stored with the call record (e.g. CRM deal ID)</td>
                  </tr>
                  <tr className="border-b last:border-0">
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold">webhookUrl</td>
                    <td className="py-2.5 px-3"><Badge variant="outline" className="text-[10px] font-mono">string</Badge></td>
                    <td className="py-2.5 px-3"><span className="text-xs text-muted-foreground">{t("api.no")}</span></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">URL to receive the call result when the call ends</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Response */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("api.response")}</p>
            <p className="text-sm text-muted-foreground">
              {t("api.responseDesc")} <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">dialing</code> (HTTP 202).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Code examples ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Code2 className="h-4 w-4 text-purple-500" />
            {t("api.examples")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="curl">
            <TabsList className="mb-4">
              <TabsTrigger value="curl">{t("api.tabCurl")}</TabsTrigger>
              <TabsTrigger value="js">{t("api.tabJs")}</TabsTrigger>
              <TabsTrigger value="python">{t("api.tabPython")}</TabsTrigger>
              <TabsTrigger value="n8n">{t("api.tabN8n")}</TabsTrigger>
            </TabsList>
            <TabsContent value="curl"><CodeBlock code={curlSnippet} lang="bash" /></TabsContent>
            <TabsContent value="js"><CodeBlock code={jsSnippet} lang="javascript" /></TabsContent>
            <TabsContent value="python"><CodeBlock code={pythonSnippet} lang="python" /></TabsContent>
            <TabsContent value="n8n"><CodeBlock code={n8nSnippet} lang="json" /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ── Webhook ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Webhook className="h-4 w-4 text-green-500" />
            {t("api.webhookTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("api.webhookDesc")}{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">webhookUrl</code>{" "}
            {t("api.webhookDesc2")}
          </p>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("api.webhookPayload")}</p>
            <CodeBlock code={webhookPayload} lang="json" />
          </div>
        </CardContent>
      </Card>

      {/* ── Live tester ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-rose-500" />
            {t("api.testerTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("api.testerDesc")}</p>

          {outboundExts.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("api.noExtensions")}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Extension */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("api.testerExt")}</Label>
                <Select value={extId} onValueChange={setExtId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("api.testerSelectExt")} />
                  </SelectTrigger>
                  <SelectContent>
                    {outboundExts.map(e => (
                      <SelectItem key={e.id} value={e.id.toString()}>
                        {e.extensionNumber}{e.displayName ? ` — ${e.displayName}` : ""}{" "}
                        {e.agentConfig ? `(${e.agentConfig.name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("api.testerPhone")}</Label>
                <Input
                  placeholder={t("api.testerPhonePlaceholder")}
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>

              {/* First message */}
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">{t("api.testerFirstMsg")}</Label>
                <Textarea
                  placeholder={t("api.testerFirstMsgPlaceholder")}
                  value={firstMsg}
                  onChange={e => setFirstMsg(e.target.value)}
                  rows={2}
                  className="resize-none"
                />
              </div>

              {/* Webhook */}
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">{t("api.testerWebhook")}</Label>
                <Input
                  placeholder={t("api.testerWebhookPlaceholder")}
                  value={webhook}
                  onChange={e => setWebhook(e.target.value)}
                />
              </div>

              {/* Submit */}
              <div className="md:col-span-2">
                <Button onClick={handleTrigger} disabled={sending} className="w-full sm:w-auto">
                  <Zap className="h-4 w-4 mr-2" />
                  {sending ? t("api.testerSending") : t("api.testerSend")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
