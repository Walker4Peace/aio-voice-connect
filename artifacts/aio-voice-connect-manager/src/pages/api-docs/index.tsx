import React from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Copy, Check, Zap, Key, Webhook, Code2, Plus, Trash2,
  ShieldCheck, Eye, EyeOff, PhoneIncoming, Calendar, BarChart3, Package,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ApiKeyRow {
  id: number;
  name: string;
  keyPrefix: string;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

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

// ── Inline copy button ────────────────────────────────────────────────────────
function InlineCopy({ text }: { text: string }) {
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
    <button onClick={copy} className="ml-2 p-1 rounded hover:bg-muted transition-colors shrink-0" title={t("api.copy")}>
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

// ── API Key Manager ───────────────────────────────────────────────────────────
function ApiKeyManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [newKeyName, setNewKeyName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = React.useState(false);
  const [revealedKey, setRevealedKey] = React.useState<{ id: number; plaintext: string } | null>(null);
  const [showKey, setShowKey] = React.useState(false);

  const fetchKeys = React.useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api-keys`);
      if (r.ok) setKeys(await r.json());
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) { toast({ variant: "destructive", title: t("api.keyNoName") }); return; }
    setCreating(true);
    try {
      const r = await fetch(`${API_BASE}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Unknown error");
      setRevealedKey({ id: data.id, plaintext: data.plaintext });
      setShowKey(true);
      setNewKeyName("");
      await fetchKeys();
    } catch (e) {
      toast({ variant: "destructive", title: t("api.testerError"), description: (e as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await fetch(`${API_BASE}/api-keys/${revokeTarget.id}`, { method: "DELETE" });
      toast({ title: t("api.keyRevoked") });
      setRevokeTarget(null);
      if (revealedKey?.id === revokeTarget.id) setRevealedKey(null);
      await fetchKeys();
    } catch { /* ignore */ } finally {
      setRevoking(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          {t("api.keys")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">{t("api.keysDesc")}</p>

        {revealedKey && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-4 space-y-2">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">⚠️ {t("api.keyCreated")}</p>
            <p className="text-xs text-amber-700 dark:text-amber-400">{t("api.keyCreatedDesc")}</p>
            <div className="flex items-center gap-2 bg-white dark:bg-black/20 rounded border border-amber-200 dark:border-amber-800 px-3 py-2">
              <code className="text-xs font-mono flex-1 break-all select-all">
                {showKey ? revealedKey.plaintext : revealedKey.plaintext.slice(0, 14) + "•".repeat(24)}
              </code>
              <button onClick={() => setShowKey(v => !v)} className="shrink-0 p-1 rounded hover:bg-muted transition-colors text-muted-foreground">
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <InlineCopy text={revealedKey.plaintext} />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Input
            placeholder={t("api.keyNamePlaceholder")}
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
            className="flex-1"
          />
          <Button onClick={handleCreate} disabled={creating}>
            <Plus className="h-4 w-4 mr-1.5" />
            {creating ? t("api.keyCreating") : t("api.keyCreate")}
          </Button>
        </div>

        {keys.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("api.keyNoKeys")}
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground">{t("api.keyPrefix")}</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground">{t("api.keyLastUsed")}</th>
                  <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground">{t("api.keyCreatedAt")}</th>
                  <th className="py-2.5 px-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {keys.map(k => (
                  <tr key={k.id} className="hover:bg-muted/20">
                    <td className="py-2.5 px-3 font-medium text-sm">{k.name}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{k.keyPrefix}…</td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : t("api.keyNeverUsed")}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 px-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setRevokeTarget(k)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AlertDialog open={!!revokeTarget} onOpenChange={open => !open && setRevokeTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("api.keyConfirmRevoke")}</AlertDialogTitle>
              <AlertDialogDescription>{t("api.keyConfirmRevokeDesc")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("clients.cancelBtn")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleRevoke}
                disabled={revoking}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              >
                {revoking ? t("api.keyRevoking") : t("api.keyConfirmBtn")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

// ── Use Case card ─────────────────────────────────────────────────────────────
interface UseCaseProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  benefits: string[];
  conversation: { role: "ai" | "caller" | "fn"; text: string }[];
  systemPrompt: string;
  tools: { name: string; desc: string; params: string }[];
  webhookCode: string;
}

function UseCaseCard({ icon, title, subtitle, color, benefits, conversation, systemPrompt, tools, webhookCode }: UseCaseProps) {
  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className={`px-5 py-4 ${color}`}>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center text-white shrink-0">
            {icon}
          </div>
          <div>
            <h3 className="font-semibold text-white text-base">{title}</h3>
            <p className="text-white/70 text-xs mt-0.5">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {benefits.map(b => (
            <span key={b} className="text-[10px] bg-white/20 text-white rounded-full px-2.5 py-0.5 font-medium">{b}</span>
          ))}
        </div>
      </div>

      <CardContent className="p-0">
        <Tabs defaultValue="conversation">
          <TabsList className="w-full rounded-none border-b bg-muted/30 h-auto p-0">
            {["conversation", "prompt", "tools", "webhook"].map(tab => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-2.5 text-xs font-medium capitalize"
              >
                {tab === "conversation" ? "Conversation" : tab === "prompt" ? "System Prompt" : tab === "tools" ? "Tools" : "Webhook"}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Conversation */}
          <TabsContent value="conversation" className="p-4 space-y-2 mt-0">
            {conversation.map((line, i) => (
              line.role === "fn" ? (
                <div key={i} className="text-[10px] font-mono text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30 rounded px-2.5 py-1.5 border border-purple-200 dark:border-purple-800">
                  → {line.text}
                </div>
              ) : (
                <div key={i} className={`flex gap-2 ${line.role === "ai" ? "" : "flex-row-reverse"}`}>
                  <div className={`text-[10px] font-bold shrink-0 mt-1 ${line.role === "ai" ? "text-blue-500" : "text-gray-500"}`}>
                    {line.role === "ai" ? "AI" : "Caller"}
                  </div>
                  <div className={`text-xs rounded-xl px-3 py-2 max-w-[85%] leading-relaxed ${
                    line.role === "ai"
                      ? "bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-100"
                      : "bg-muted text-foreground"
                  }`}>
                    {line.text}
                  </div>
                </div>
              )
            ))}
          </TabsContent>

          {/* System prompt */}
          <TabsContent value="prompt" className="p-4 mt-0">
            <CodeBlock code={systemPrompt} lang="text" />
          </TabsContent>

          {/* Tools */}
          <TabsContent value="tools" className="p-4 space-y-3 mt-0">
            {tools.map(tool => (
              <div key={tool.name} className="rounded-lg border overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 flex items-center gap-2">
                  <code className="text-xs font-mono font-semibold text-foreground">{tool.name}()</code>
                  <span className="text-xs text-muted-foreground">— {tool.desc}</span>
                </div>
                <div className="p-3">
                  <CodeBlock code={tool.params} lang="json" />
                </div>
              </div>
            ))}
          </TabsContent>

          {/* Webhook */}
          <TabsContent value="webhook" className="p-4 mt-0">
            <CodeBlock code={webhookCode} lang="javascript" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ApiDocsPage() {
  const { t } = useTranslation();

  const serverUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");

  // ── Code snippets ──────────────────────────────────────────────────────────
  const curlSnippet = `curl -X POST ${serverUrl}/api/outbound/call \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: YOUR_API_KEY" \\
  -d '{
    "extensionId": 1,
    "phoneNumber": "+212661234567",
    "firstMessage": "Hello {{name}}, I am calling about your order.",
    "variables": { "name": "Hamza", "order_id": "ORD-1234" },
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
    firstMessage: "Hello {{name}}, calling about your order.",
    variables: { name: "Hamza", order_id: "ORD-1234" },
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
        "firstMessage": "Hello {{name}}, calling about your order.",
        "variables": {"name": "Hamza", "order_id": "ORD-1234"},
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
  "firstMessage": "Hello Hamza, I am calling about your order.",
  "variables": { "name": "Hamza", "order_id": "ORD-1234" },
  "metadata": null,
  "createdAt": "2026-07-31T00:17:12.000Z",
  "updatedAt": "2026-07-31T00:19:05.000Z"
}`;

  const keySetupCode = `echo 'OUTBOUND_API_KEY=your-secret-key' >> /etc/aio-voice-connect.env`;
  const restartCode = `sudo systemctl restart aio-voice-connect`;

  // ── Use cases ──────────────────────────────────────────────────────────────
  const useCases: UseCaseProps[] = [
    {
      icon: <PhoneIncoming className="h-5 w-5" />,
      title: "AI Receptionist",
      subtitle: "Answer and route incoming calls automatically",
      color: "bg-gradient-to-r from-blue-600 to-blue-500",
      benefits: ["24/7 availability", "Instant routing", "Capture caller info"],
      conversation: [
        { role: "ai", text: "Good morning, thank you for calling Acme Corp. How may I direct your call today?" },
        { role: "caller", text: "Hi, I'd like to speak with someone about upgrading our service plan." },
        { role: "ai", text: "I'd be happy to connect you with our sales team. May I have your name and company?" },
        { role: "caller", text: "Sure, it's Michael Chen from TechStart Inc." },
        { role: "fn", text: 'transfer_call({"department": "sales", "reason": "Existing customer — service upgrade"})' },
        { role: "ai", text: "Thank you Mr. Chen. Transferring you to our sales department now. One moment please." },
      ],
      systemPrompt: `You are a professional receptionist for Acme Corp. Your job is to:
1. Greet callers warmly
2. Understand why they're calling
3. Route them to the appropriate department or take a message

Departments:
- Sales: For new customers or pricing inquiries
- Support: For existing customers with issues
- Billing: For payment or invoice questions
- HR: For job inquiries

Always be polite, professional, and efficient.`,
      tools: [
        {
          name: "transfer_call",
          desc: "Transfer the caller to a specific department",
          params: `{
  "department": "sales",   // sales | support | billing | hr
  "reason": "New customer interested in enterprise pricing"
}`,
        },
        {
          name: "take_message",
          desc: "Record a message when the department is unavailable",
          params: `{
  "caller_name": "John Smith",
  "caller_phone": "+1-555-123-4567",
  "message": "Wants to discuss renewal of contract #4521",
  "urgency": "medium",     // low | medium | high
  "for_department": "sales"
}`,
        },
      ],
      webhookCode: `app.post('/webhook/receptionist', async (req, res) => {
  const { tool_name, parameters, call_id } = req.body;

  switch (tool_name) {
    case 'transfer_call':
      const extensions = {
        sales:   'sip:sales@pbx.example.com',
        support: 'sip:support@pbx.example.com',
        billing: 'sip:billing@pbx.example.com',
        hr:      'sip:hr@pbx.example.com',
      };
      await sip4ai.transfer(call_id, extensions[parameters.department]);
      return res.json({ success: true });

    case 'take_message':
      await db.messages.create(parameters);
      await slack.notify(\`New message from \${parameters.caller_name}: \${parameters.message}\`);
      return res.json({ success: true });
  }
});`,
    },
    {
      icon: <Calendar className="h-5 w-5" />,
      title: "Appointment Booking",
      subtitle: "Schedule appointments via natural conversation",
      color: "bg-gradient-to-r from-emerald-600 to-emerald-500",
      benefits: ["Reduce no-shows", "Book outside business hours", "Auto-reminders"],
      conversation: [
        { role: "ai", text: "Hello, thank you for calling Downtown Dental. I can help you schedule or check an appointment. What would you like to do?" },
        { role: "caller", text: "I need to book a teeth cleaning." },
        { role: "ai", text: "Happy to help! What date works best for you?" },
        { role: "caller", text: "Do you have anything next Tuesday morning?" },
        { role: "fn", text: 'check_availability({"date": "2024-01-16", "appointment_type": "cleaning", "preferred_time": "morning"})' },
        { role: "ai", text: "Yes! I have Tuesday Jan 16th at 8:30 AM, 9:00 AM, and 10:30 AM. Which do you prefer?" },
        { role: "caller", text: "10:30 works great." },
        { role: "fn", text: 'book_appointment({"date": "2024-01-16", "time": "10:30", "appointment_type": "cleaning", "patient_name": "Sarah Williams"})' },
        { role: "ai", text: "Perfect! Booked for Tuesday Jan 16th at 10:30 AM. You'll receive a text confirmation shortly." },
      ],
      systemPrompt: `You are an appointment scheduling assistant for Downtown Dental Clinic.
Help callers:
1. Book new appointments
2. Reschedule existing appointments
3. Cancel appointments

Available types: Cleaning (30 min), Checkup (45 min), Consultation (30 min), Emergency (60 min)
Office hours: Mon–Fri 8am–6pm, Sat 9am–2pm

Always confirm date, time, and type before booking.
Collect patient name and phone for new patients.`,
      tools: [
        {
          name: "check_availability",
          desc: "Check available slots for a given date and type",
          params: `{
  "date": "2024-01-16",          // YYYY-MM-DD
  "appointment_type": "cleaning", // cleaning | checkup | consultation | emergency
  "preferred_time": "morning"     // morning | afternoon | evening (optional)
}`,
        },
        {
          name: "book_appointment",
          desc: "Book an appointment slot",
          params: `{
  "date": "2024-01-16",
  "time": "10:30",
  "appointment_type": "cleaning",
  "patient_name": "Jane Doe",
  "patient_phone": "+1-555-987-6543",
  "patient_email": "jane@example.com", // optional
  "notes": "First visit"               // optional
}`,
        },
      ],
      webhookCode: `app.post('/webhook/booking', async (req, res) => {
  const { tool_name, parameters } = req.body;

  switch (tool_name) {
    case 'check_availability':
      const slots = await calendar.getAvailableSlots({
        date: parameters.date,
        duration: APPOINTMENT_DURATIONS[parameters.appointment_type],
        preferredTime: parameters.preferred_time,
      });
      return res.json({ available_slots: slots.map(s => s.time) });

    case 'book_appointment':
      const appt = await calendar.createEvent({
        start: \`\${parameters.date}T\${parameters.time}\`,
        title: \`\${parameters.appointment_type} — \${parameters.patient_name}\`,
      });
      await db.appointments.create({ ...parameters, status: 'confirmed' });
      await twilio.messages.create({
        to: parameters.patient_phone,
        body: \`Confirmed: \${parameters.appointment_type} on \${parameters.date} at \${parameters.time}\`,
      });
      return res.json({ success: true, appointment_id: appt.id });
  }
});`,
    },
    {
      icon: <BarChart3 className="h-5 w-5" />,
      title: "Customer Surveys",
      subtitle: "Outbound AI calls for feedback collection",
      color: "bg-gradient-to-r from-purple-600 to-purple-500",
      benefits: ["Higher response rates", "Natural follow-ups", "Real-time sentiment"],
      conversation: [
        { role: "ai", text: "Hi, this is Alex from CloudTech. I'm following up on your recent support interaction. Do you have 2 minutes for feedback?" },
        { role: "caller", text: "Sure, I can do that." },
        { role: "ai", text: "On a scale of 1 to 5, how would you rate your recent support experience?" },
        { role: "caller", text: "I'd say a 3. It was okay." },
        { role: "fn", text: 'record_rating({"question_id": "support_rating", "score": 3})' },
        { role: "ai", text: "Thanks. What could we have done better?" },
        { role: "caller", text: "I was on hold for 45 minutes before getting through." },
        { role: "fn", text: 'record_feedback({"question_id": "improvement", "response": "45 min hold time", "sentiment": "negative"})' },
        { role: "ai", text: "I completely understand — 45 minutes is too long. I'll make sure this reaches our team. Have a great day!" },
      ],
      systemPrompt: `You are conducting a brief customer satisfaction survey for CloudTech Solutions.

Survey flow:
1. Introduce yourself and confirm they have 2–3 minutes
2. Ask about their support experience (1–5 rating)
3. Ask what went well
4. Ask what could be improved
5. Ask if they'd recommend us (NPS: 0–10)
6. Thank them and close the call

Be conversational, not robotic.
If they give a low score, empathize and dig deeper.
Keep it brief and respectful of their time.`,
      tools: [
        {
          name: "record_rating",
          desc: "Record a numerical rating from the customer",
          params: `{
  "question_id": "support_rating", // support_rating | nps_score
  "score": 4,                       // 1–5 for satisfaction, 0–10 for NPS
  "verbatim": "Agent was helpful"   // optional
}`,
        },
        {
          name: "record_feedback",
          desc: "Record open-ended feedback",
          params: `{
  "question_id": "improvement_feedback",
  "response": "Wait time was too long",
  "sentiment": "negative"           // positive | neutral | negative
}`,
        },
        {
          name: "flag_for_followup",
          desc: "Flag customer for manager follow-up",
          params: `{
  "reason": "Customer very dissatisfied, considering cancellation",
  "urgency": "high"                 // low | medium | high
}`,
        },
      ],
      webhookCode: `app.post('/webhook/survey', async (req, res) => {
  const { tool_name, parameters, call_id, customer_id } = req.body;

  switch (tool_name) {
    case 'record_rating':
      await db.survey_responses.create({
        customer_id, call_id,
        question_id: parameters.question_id,
        score: parameters.score,
      });
      // Alert on low scores
      if (parameters.score <= 2) {
        await slack.alert(\`⚠️ Low score (\${parameters.score}) from customer \${customer_id}\`);
      }
      return res.json({ success: true });

    case 'record_feedback':
      await db.survey_responses.create({
        customer_id, call_id,
        question_id: parameters.question_id,
        text_response: parameters.response,
        sentiment: parameters.sentiment,
      });
      return res.json({ success: true });

    case 'flag_for_followup':
      await db.followups.create({ customer_id, call_id, ...parameters, status: 'pending' });
      await email.send({
        to: 'cs-team@company.com',
        subject: \`[\${parameters.urgency.toUpperCase()}] Follow-up needed\`,
        body: \`Customer \${customer_id}: \${parameters.reason}\`,
      });
      return res.json({ success: true });
  }
});`,
    },
    {
      icon: <Package className="h-5 w-5" />,
      title: "Order Updates",
      subtitle: "Proactive status calls to customers",
      color: "bg-gradient-to-r from-orange-600 to-orange-500",
      benefits: ["Reduce 'where is my order?' calls", "Proactive issue resolution", "Reschedule conversationally"],
      conversation: [
        { role: "ai", text: "Hi, this is a delivery update from QuickShip. Am I speaking with Jennifer about order #78432?" },
        { role: "caller", text: "Yes, that's me." },
        { role: "ai", text: "Great! Your delivery is scheduled for tomorrow between 2–6 PM. Will someone be available at 123 Main Street?" },
        { role: "caller", text: "I won't be home then. Can we change it to Friday morning?" },
        { role: "fn", text: 'reschedule_delivery({"order_id": "ORD-78432", "new_date": "2024-01-19", "new_time_preference": "morning"})' },
        { role: "ai", text: "Done! Rescheduled for Friday Jan 19th between 8 AM and 12 PM. Any special delivery instructions?" },
        { role: "caller", text: "Please leave it at the back door." },
        { role: "fn", text: 'confirm_delivery({"order_id": "ORD-78432", "special_instructions": "Leave at back door"})' },
        { role: "ai", text: "Noted — we'll leave it at the back door. Have a great day!" },
      ],
      systemPrompt: `You are calling from QuickShip Logistics to provide an order update.
You have the following order information:

Order: #{{ORDER_ID}}
Customer: {{CUSTOMER_NAME}}
Status: {{ORDER_STATUS}}
Estimated Delivery: {{DELIVERY_DATE}}
Items: {{ITEMS}}

Purpose of call:
- Confirm delivery time window
- Verify delivery address
- Handle special instructions
- Reschedule if needed

Be proactive, helpful, and efficient.
If there's an issue (delay, missing item), apologize and offer solutions.`,
      tools: [
        {
          name: "confirm_delivery",
          desc: "Confirm the delivery time and address with the customer",
          params: `{
  "order_id": "ORD-78432",
  "confirmed_date": "2024-01-16",
  "time_window": "2pm-6pm",
  "special_instructions": "Leave at back door" // optional
}`,
        },
        {
          name: "reschedule_delivery",
          desc: "Reschedule delivery to a new date",
          params: `{
  "order_id": "ORD-78432",
  "new_date": "2024-01-19",
  "new_time_preference": "morning", // morning | afternoon | evening
  "reason": "Customer not available on original date"
}`,
        },
        {
          name: "report_issue",
          desc: "Report a delivery issue and create a support ticket",
          params: `{
  "order_id": "ORD-78432",
  "issue_type": "damaged",          // damaged | missing_item | wrong_item | not_delivered
  "description": "Box was crushed, item inside broken",
  "resolution_preference": "replacement" // refund | replacement | reship
}`,
        },
      ],
      webhookCode: `app.post('/webhook/orders', async (req, res) => {
  const { tool_name, parameters, call_id } = req.body;

  switch (tool_name) {
    case 'confirm_delivery':
      await db.orders.update(parameters.order_id, {
        delivery_confirmed: true,
        confirmed_date: parameters.confirmed_date,
        time_window: parameters.time_window,
        special_instructions: parameters.special_instructions,
      });
      await twilio.messages.create({
        to: order.customer_phone,
        body: \`Delivery confirmed for \${parameters.confirmed_date} between \${parameters.time_window}\`,
      });
      return res.json({ success: true });

    case 'reschedule_delivery':
      const newSlot = await shipping.reschedule({
        order_id: parameters.order_id,
        date: parameters.new_date,
        time_preference: parameters.new_time_preference,
      });
      return res.json({ success: true, new_date: newSlot.date, new_time_window: newSlot.time_window });

    case 'report_issue':
      const ticket = await db.support_tickets.create({
        order_id: parameters.order_id,
        type: parameters.issue_type,
        description: parameters.description,
        priority: 'high', status: 'open',
      });
      return res.json({ success: true, ticket_id: ticket.id });
  }
});`,
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("api.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("api.description")}</p>
      </div>

      {/* ── API Key Manager ── */}
      <ApiKeyManager />

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
          <div className="flex items-center gap-3 flex-wrap">
            <Badge className="bg-green-600 hover:bg-green-600 text-white font-mono text-sm px-3 py-1">POST</Badge>
            <code className="text-sm font-mono bg-muted px-3 py-1.5 rounded-md break-all">
              {serverUrl}/api/outbound/call
            </code>
          </div>

          <p className="text-sm text-muted-foreground">{t("api.endpointDesc")}</p>

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
                <tbody className="divide-y">
                  {[
                    { name: "extensionId", type: "integer", req: true, desc: "ID of the outbound-mode extension to use" },
                    { name: "phoneNumber", type: "string", req: true, desc: "Phone number to call (E.164 format, e.g. +212661234567)" },
                    { name: "callerId", type: "string", req: false, desc: "Caller ID shown to the recipient" },
                    { name: "firstMessage", type: "string", req: false, desc: "What the AI says first. Supports {{variable}} placeholders." },
                    { name: "systemPromptOverride", type: "string", req: false, desc: "Overrides the agent's default system prompt for this call. Supports {{variable}} placeholders." },
                    { name: "variables", type: "object", req: false, desc: "Key-value data injected into {{placeholders}} in firstMessage and systemPromptOverride" },
                    { name: "metadata", type: "object", req: false, desc: "Arbitrary data stored with the call record (e.g. CRM deal ID)" },
                    { name: "webhookUrl", type: "string", req: false, desc: "URL to receive the call result when the call ends" },
                  ].map(f => (
                    <tr key={f.name} className="border-b last:border-0">
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold">{f.name}</td>
                      <td className="py-2.5 px-3"><Badge variant="outline" className="text-[10px] font-mono">{f.type}</Badge></td>
                      <td className="py-2.5 px-3">
                        {f.req
                          ? <span className="text-xs font-medium text-red-500">{t("api.yes")}</span>
                          : <span className="text-xs text-muted-foreground">{t("api.no")}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{f.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Variables note */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20 p-4">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">💡 Variable substitution</p>
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              Use <code className="bg-blue-100 dark:bg-blue-900 rounded px-1">{"{{variable_name}}"}</code> placeholders
              in <code className="bg-blue-100 dark:bg-blue-900 rounded px-1">firstMessage</code> and{" "}
              <code className="bg-blue-100 dark:bg-blue-900 rounded px-1">systemPromptOverride</code>.
              Pass their values in <code className="bg-blue-100 dark:bg-blue-900 rounded px-1">variables</code> — the
              server resolves them before sending to the AI, so the agent receives the final text with no raw placeholders.
            </p>
            <CodeBlock code={`// firstMessage:  "Hello {{name}}, calling about order {{order_id}}."
// variables:     { "name": "Hamza", "order_id": "ORD-1234" }
// AI receives:   "Hello Hamza, calling about order ORD-1234."`} lang="js" />
          </div>

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

      {/* ── Use Cases ── */}
      <div>
        <div className="mb-5">
          <h2 className="text-xl font-bold tracking-tight">Use Cases</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Ready-to-use patterns for common outbound AI call scenarios — each includes a sample conversation,
            system prompt, tool definitions, and a webhook handler you can drop into your backend.
          </p>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {useCases.map(uc => (
            <UseCaseCard key={uc.title} {...uc} />
          ))}
        </div>
      </div>
    </div>
  );
}
