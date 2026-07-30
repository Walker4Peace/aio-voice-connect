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
import { PhoneOutgoing, RefreshCw, Info, Trash2 } from "lucide-react";
import { useTimezone } from "@/contexts/timezone-context";

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

async function clearAllOutboundCalls(): Promise<void> {
  const r = await fetch(`${API_BASE}/outbound/calls`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to clear outbound calls");
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
  const { t } = useTranslation();
  const colorMap: Record<string, string> = {
    pending:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    dialing:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    active:    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    completed: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    failed:    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };
  const labelMap: Record<string, string> = {
    pending:   t("outbound.statusPending"),
    dialing:   t("outbound.statusDialing"),
    active:    t("outbound.statusActive"),
    completed: t("outbound.statusCompleted"),
    failed:    t("outbound.statusFailed"),
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[status] ?? ""}`}>
      {labelMap[status] ?? status}
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
  const { t } = useTranslation();
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
        setVariablesError(t("outbound.variablesError"));
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
          title: t("outbound.callFailed"),
          description: result.error ?? t("outbound.callFailed"),
        });
      } else {
        toast({
          title: t("outbound.callTriggered"),
          description: t("outbound.callTriggeredDesc", { phone: phoneNumber, status: result.status }),
        });
      }

      void queryClient.invalidateQueries({ queryKey: ["outbound-calls"] });
      onSuccess();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast({ variant: "destructive", title: t("common.error"), description: (err as Error).message });
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
            {t("outbound.dialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("outbound.dialogDesc")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Extension */}
          <div className="space-y-1">
            <Label htmlFor="ext">{t("outbound.extension")} <span className="text-destructive">*</span></Label>
            <Select value={extensionId} onValueChange={setExtensionId}>
              <SelectTrigger id="ext">
                <SelectValue placeholder={t("outbound.selectExtension")} />
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
            <Label htmlFor="phone">{t("outbound.phoneNumber")} <span className="text-destructive">*</span></Label>
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
            <Label htmlFor="cid">{t("outbound.callerId")} <span className="text-muted-foreground text-xs">({t("outbound.optional")})</span></Label>
            <Input
              id="cid"
              placeholder="+10000000000"
              value={callerId}
              onChange={e => setCallerId(e.target.value)}
            />
          </div>

          {/* First message */}
          <div className="space-y-1">
            <Label htmlFor="fm">{t("outbound.firstMessage")} <span className="text-muted-foreground text-xs">({t("outbound.optional")})</span></Label>
            <Input
              id="fm"
              placeholder={t("outbound.firstMessagePlaceholder")}
              value={firstMessage}
              onChange={e => setFirstMessage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("outbound.firstMessageHint")}</p>
          </div>

          {/* System prompt override */}
          <div className="space-y-1">
            <Label htmlFor="sp">{t("outbound.systemPrompt")} <span className="text-muted-foreground text-xs">({t("outbound.optional")})</span></Label>
            <Textarea
              id="sp"
              placeholder={t("outbound.systemPromptPlaceholder")}
              className="min-h-[80px] text-sm"
              value={systemPromptOverride}
              onChange={e => setSystemPromptOverride(e.target.value)}
            />
          </div>

          {/* Variables */}
          <div className="space-y-1">
            <Label htmlFor="vars">{t("outbound.variables")} <span className="text-muted-foreground text-xs">({t("outbound.optionalJson")})</span></Label>
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
            <Label htmlFor="wh">{t("outbound.webhookUrl")} <span className="text-muted-foreground text-xs">({t("outbound.optional")})</span></Label>
            <Input
              id="wh"
              type="url"
              placeholder="https://your-app.com/webhook/call-result"
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("outbound.webhookHint")}</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={submitting || !extensionId || !phoneNumber}>
              {submitting ? t("outbound.triggering") : t("outbound.triggerCall")}
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
  const { t } = useTranslation();
  return (
    <AlertDialog open={callId !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("outbound.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("outbound.deleteDesc")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={isDeleting}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => callId !== null && onConfirm(callId)}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? t("outbound.deleting") : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OutboundPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { formatDateTime } = useTimezone();
  const queryClient = useQueryClient();
  const [triggerOpen, setTriggerOpen] = React.useState(false);
  const [deleteTargetId, setDeleteTargetId] = React.useState<number | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);
  const PAGE_SIZE = 20;

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
      toast({ title: t("outbound.recordDeleted") });
      setDeleteTargetId(null);
      void queryClient.invalidateQueries({ queryKey: ["outbound-calls"] });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: t("outbound.deleteFailed"), description: err.message });
      setDeleteTargetId(null);
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: clearAllOutboundCalls,
    onSuccess: () => {
      toast({ title: t("outbound.allCleared") });
      setClearConfirmOpen(false);
      setCurrentPage(1);
      void queryClient.invalidateQueries({ queryKey: ["outbound-calls"] });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: t("outbound.clearFailed"), description: err.message });
      setClearConfirmOpen(false);
    },
  });

  const extensionMap = React.useMemo(
    () => Object.fromEntries(extensions.map(e => [e.id, e])),
    [extensions]
  );

  const totalPages = Math.max(1, Math.ceil(calls.length / PAGE_SIZE));
  const pagedCalls = calls.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("outbound.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("outbound.description")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            {t("outbound.refresh")}
          </Button>
          {calls.length > 0 && (
            <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive hover:text-destructive-foreground" onClick={() => setClearConfirmOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t("outbound.clearAll")}
            </Button>
          )}
          <Button size="sm" onClick={() => setTriggerOpen(true)}>
            <PhoneOutgoing className="h-4 w-4 mr-1" />
            {t("outbound.triggerCall")}
          </Button>
        </div>
      </div>

      {/* API info card */}
      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div className="space-y-1.5 text-sm">
              <p className="font-medium text-blue-900 dark:text-blue-100">{t("outbound.apiTitle")}</p>
              <p className="text-blue-700 dark:text-blue-300">
                {t("outbound.apiDescPre")}{" "}
                <code className="bg-blue-100 dark:bg-blue-900 rounded px-1 py-0.5 text-xs">OUTBOUND_API_KEY</code>{" "}
                {t("outbound.apiDescPost")}
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
          <CardTitle className="text-base">{t("outbound.callHistory")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">{t("outbound.loading")}</div>
          ) : calls.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              {t("outbound.noCalls")}
            </div>
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("outbound.thPhone")}</TableHead>
                  <TableHead>{t("outbound.thExtension")}</TableHead>
                  <TableHead>{t("outbound.thStatus")}</TableHead>
                  <TableHead>{t("outbound.thFirstMessage")}</TableHead>
                  <TableHead className="text-right">{t("outbound.thInitiated")}</TableHead>
                  <TableHead className="w-10">{t("outbound.thAction")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedCalls.map(call => {
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
                        {formatDateTime(call.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTargetId(call.id)}
                          title={t("outbound.deleteRecord")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-1 px-4 py-3 border-t">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <Button
                    key={page}
                    variant={page === currentPage ? "default" : "outline"}
                    size="sm"
                    className="h-8 w-8 p-0 text-xs"
                    onClick={() => { setCurrentPage(page); document.querySelector('main')?.scrollTo({ top: 0, behavior: "smooth" }); }}
                  >
                    {page}
                  </Button>
                ))}
              </div>
            )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Clear All confirm */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("outbound.clearTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("outbound.clearDesc", { count: String(calls.length) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => clearAllMutation.mutate()}
              disabled={clearAllMutation.isPending}
            >
              {t("outbound.clearAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
