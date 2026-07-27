import React from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Phone, PhoneOutgoing, RefreshCw, Info, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OutboundCall {
  id: number;
  extensionId: number | null;
  phoneNumber: string;
  callerId: string | null;
  firstMessage: string | null;
  systemPromptOverride: string | null;
  variables: string | null;
  metadata: string | null;
  webhookUrl: string | null;
  status: "pending" | "dialing" | "active" | "completed" | "failed";
  callId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Extension {
  id: number;
  extensionNumber: string;
  displayName: string | null;
  agentConfig?: { name: string } | null;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchOutboundCalls(): Promise<OutboundCall[]> {
  const r = await fetch(`${API_BASE}/outbound/calls`);
  if (!r.ok) throw new Error("Failed to fetch outbound calls");
  return r.json() as Promise<OutboundCall[]>;
}

async function fetchExtensions(): Promise<Extension[]> {
  const r = await fetch(`${API_BASE}/extensions`);
  if (!r.ok) throw new Error("Failed to fetch extensions");
  return r.json() as Promise<Extension[]>;
}

async function triggerCall(payload: {
  extensionId: number;
  phoneNumber: string;
  callerId?: string;
  firstMessage?: string;
  systemPromptOverride?: string;
  variables?: Record<string, unknown>;
  webhookUrl?: string;
}): Promise<OutboundCall> {
  const r = await fetch(`${API_BASE}/outbound/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const err = await r.json() as { error?: string };
    throw new Error(err.error ?? "Failed to trigger call");
  }
  return r.json() as Promise<OutboundCall>;
}

async function deleteOutboundCall(id: number): Promise<void> {
  const r = await fetch(`${API_BASE}/outbound/calls/${id}`, { method: "DELETE" });
  if (!r.ok) {
    const err = await r.json() as { error?: string };
    throw new Error(err.error ?? "Failed to delete record");
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OutboundCall["status"] }) {
  const map: Record<string, string> = {
    pending:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    dialing:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    active:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    completed: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    failed:    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? ""}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ── Trigger Dialog ────────────────────────────────────────────────────────────

interface TriggerDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  extensions: Extension[];
  onSuccess: () => void;
}

function TriggerDialog({ open, onOpenChange, extensions, onSuccess }: TriggerDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [extensionId, setExtensionId] = React.useState("");
  const [phoneNumber, setPhoneNumber] = React.useState("");
  const [callerId, setCallerId] = React.useState("");
  const [firstMessage, setFirstMessage] = React.useState("");
  const [systemPromptOverride, setSystemPromptOverride] = React.useState("");
  const [variables, setVariables] = React.useState("");
  const [webhookUrl, setWebhookUrl] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [variablesError, setVariablesError] = React.useState("");

  function reset() {
    setExtensionId(""); setPhoneNumber(""); setCallerId("");
    setFirstMessage(""); setSystemPromptOverride(""); setVariables("");
    setWebhookUrl(""); setVariablesError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!extensionId || !phoneNumber) return;

    let parsedVars: Record<string, unknown> | undefined;
    if (variables.trim()) {
      try {
        parsedVars = JSON.parse(variables) as Record<string, unknown>;
        setVariablesError("");
      } catch {
        setVariablesError("Variables must be valid JSON");
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await triggerCall({
        extensionId: Number(extensionId),
        phoneNumber,
        ...(callerId ? { callerId } : {}),
        ...(firstMessage ? { firstMessage } : {}),
        ...(systemPromptOverride ? { systemPromptOverride } : {}),
        ...(parsedVars ? { variables: parsedVars } : {}),
        ...(webhookUrl ? { webhookUrl } : {}),
      });

      if (result.status === "failed") {
        toast({
          variant: "destructive",
          title: "Call failed to dial",
          description: result.error ?? "Yeastar API did not accept the dial request.",
        });
      } else {
        toast({ title: "Call triggered", description: `Outbound call to ${phoneNumber} initiated (${result.status}).` });
      }

      void queryClient.invalidateQueries({ queryKey: ["outbound-calls"] });
      onSuccess();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PhoneOutgoing className="h-5 w-5" />
            Trigger Outbound Call
          </DialogTitle>
          <DialogDescription>
            The selected extension must be running. Yeastar will ring it and the AI agent will dial out.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Extension */}
          <div className="space-y-1">
            <Label htmlFor="ext">Extension <span className="text-destructive">*</span></Label>
            <Select value={extensionId} onValueChange={setExtensionId}>
              <SelectTrigger id="ext">
                <SelectValue placeholder="Select extension" />
              </SelectTrigger>
              <SelectContent>
                {extensions.map(e => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.extensionNumber}{e.displayName ? ` — ${e.displayName}` : ""}
                    {e.agentConfig ? ` (${e.agentConfig.name})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Phone number */}
          <div className="space-y-1">
            <Label htmlFor="phone">Phone Number <span className="text-destructive">*</span></Label>
            <Input
              id="phone"
              placeholder="+1234567890"
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              required
            />
          </div>

          {/* Caller ID */}
          <div className="space-y-1">
            <Label htmlFor="cid">Caller ID <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              id="cid"
              placeholder="+10000000000"
              value={callerId}
              onChange={e => setCallerId(e.target.value)}
            />
          </div>

          {/* First message */}
          <div className="space-y-1">
            <Label htmlFor="fm">First Message Override <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              id="fm"
              placeholder="Hello! I'm calling about…"
              value={firstMessage}
              onChange={e => setFirstMessage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Overrides the agent's default greeting for this call only.</p>
          </div>

          {/* System prompt override */}
          <div className="space-y-1">
            <Label htmlFor="sp">System Prompt Override <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea
              id="sp"
              placeholder="You are calling to follow up on…"
              className="min-h-[80px] text-sm"
              value={systemPromptOverride}
              onChange={e => setSystemPromptOverride(e.target.value)}
            />
          </div>

          {/* Variables */}
          <div className="space-y-1">
            <Label htmlFor="vars">Variables <span className="text-muted-foreground text-xs">(optional JSON)</span></Label>
            <Textarea
              id="vars"
              placeholder='{"customer_name": "John", "account_id": "123"}'
              className="min-h-[60px] font-mono text-xs"
              value={variables}
              onChange={e => setVariables(e.target.value)}
            />
            {variablesError && <p className="text-xs text-destructive">{variablesError}</p>}
          </div>

          {/* Webhook URL */}
          <div className="space-y-1">
            <Label htmlFor="wh">Webhook URL <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              id="wh"
              type="url"
              placeholder="https://your-app.com/webhook/call-result"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">We'll POST the call result to this URL when the call ends.</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting || !extensionId || !phoneNumber}>
              {submitting ? "Triggering…" : "Trigger Call"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete confirmation ───────────────────────────────────────────────────────

interface DeleteConfirmProps {
  callId: number | null;
  onCancel: () => void;
  onConfirm: (id: number) => void;
  isDeleting: boolean;
}

function DeleteConfirm({ callId, onCancel, onConfirm, isDeleting }: DeleteConfirmProps) {
  return (
    <AlertDialog open={callId !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this record?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove the outbound call record. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => callId !== null && onConfirm(callId)}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OutboundPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [triggerOpen, setTriggerOpen] = React.useState(false);
  const [deleteTargetId, setDeleteTargetId] = React.useState<number | null>(null);

  const { data: calls = [], isLoading, refetch } = useQuery({
    queryKey: ["outbound-calls"],
    queryFn: fetchOutboundCalls,
    refetchInterval: 5000,
  });

  const { data: extensions = [] } = useQuery({
    queryKey: ["extensions"],
    queryFn: fetchExtensions,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteOutboundCall,
    onSuccess: () => {
      toast({ title: "Record deleted" });
      setDeleteTargetId(null);
      void queryClient.invalidateQueries({ queryKey: ["outbound-calls"] });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Delete failed", description: err.message });
      setDeleteTargetId(null);
    },
  });

  const extensionMap = React.useMemo(
    () => Object.fromEntries(extensions.map(e => [e.id, e])),
    [extensions]
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Outbound Calls</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Trigger and monitor outbound AI calls. External applications can use the API to start calls programmatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setTriggerOpen(true)}>
            <PhoneOutgoing className="h-4 w-4 mr-1" />
            Trigger Call
          </Button>
        </div>
      </div>

      {/* API info card */}
      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div className="space-y-1.5 text-sm">
              <p className="font-medium text-blue-900 dark:text-blue-100">External API Integration</p>
              <p className="text-blue-700 dark:text-blue-300">
                Trigger calls from any application with a single HTTP request. The extension must be running and linked to an IPBX with Yeastar API configured. Set <code className="bg-blue-100 dark:bg-blue-900 rounded px-1 py-0.5 text-xs">OUTBOUND_API_KEY</code> in your environment to secure the endpoint.
              </p>
              <div className="mt-2 bg-blue-100 dark:bg-blue-900/50 rounded p-2 font-mono text-xs text-blue-800 dark:text-blue-200 break-all">
                POST /api/outbound/call<br />
                X-Api-Key: your-key<br />
                {`{ "extensionId": 1, "phoneNumber": "+1234567890", "firstMessage": "Hello!" }`}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calls table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Call History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : calls.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No outbound calls yet. Trigger one above or via the API.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Extension</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>First Message</TableHead>
                  <TableHead className="text-right">Initiated</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map(call => {
                  const ext = call.extensionId ? extensionMap[call.extensionId] : null;
                  return (
                    <TableRow key={call.id}>
                      <TableCell className="font-mono text-sm">{call.phoneNumber}</TableCell>
                      <TableCell>
                        {ext ? (
                          <span className="text-sm">{ext.extensionNumber}{ext.displayName ? ` — ${ext.displayName}` : ""}</span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={call.status} />
                        {call.error && (
                          <p className="text-xs text-destructive mt-0.5 max-w-[200px] truncate" title={call.error}>{call.error}</p>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <span className="text-sm text-muted-foreground truncate block">
                          {call.firstMessage ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatDate(call.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTargetId(call.id)}
                          title="Delete record"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TriggerDialog
        open={triggerOpen}
        onOpenChange={setTriggerOpen}
        extensions={extensions}
        onSuccess={() => void refetch()}
      />

      <DeleteConfirm
        callId={deleteTargetId}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={(id) => deleteMutation.mutate(id)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
