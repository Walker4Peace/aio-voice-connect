import React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useTimezone } from "@/contexts/timezone-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneOff, Activity, ChevronDown, ChevronRight, Trash2, Copy, Check, ArrowDownLeft, ArrowUpRight, Info, CheckCircle2, XCircle, HelpCircle, Loader2 } from "lucide-react";

export interface CallEvent {
  extensionId: number;
  callId: string;
  event: "invite" | "answered" | "ended" | "connected_ai" | "error";
  timestamp: string;
  detail?: string;
}

export interface Extension {
  id: number;
  extensionNumber: string;
  displayName?: string | null;
}

// ── CopyButton ─────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => {
        const el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed"; el.style.opacity = "0";
        document.body.appendChild(el); el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        done();
      });
    } else {
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed"; el.style.opacity = "0";
      document.body.appendChild(el); el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      done();
    }
  };
  return (
    <button
      onClick={handleCopy}
      className="p-0.5 rounded hover:bg-muted text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      title={value}
    >
      {copied
        ? <Check className="h-3 w-3 text-green-500" />
        : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<CallEvent["event"], React.ReactNode> = {
  invite:       <PhoneIncoming  className="h-3.5 w-3.5 text-blue-500" />,
  answered:     <PhoneCall     className="h-3.5 w-3.5 text-green-500" />,
  ended:        <PhoneOff      className="h-3.5 w-3.5 text-muted-foreground" />,
  connected_ai: <Activity      className="h-3.5 w-3.5 text-purple-500" />,
  error:        <PhoneOff      className="h-3.5 w-3.5 text-red-500" />,
};

const EVENT_ICONS_OUTBOUND: Record<CallEvent["event"], React.ReactNode> = {
  ...EVENT_ICONS,
  invite: <PhoneOutgoing className="h-3.5 w-3.5 text-blue-500" />,
};

/** Strip the ElevenLabs conversation_id suffix (|conv_XXX) from a detail string. */
function stripConvId(detail: string | null | undefined): string | undefined {
  if (!detail) return undefined;
  return detail.replace(/\|conv_[A-Za-z0-9_]+$/, "") || undefined;
}

/** Extract conv_id from detail string. */
function extractConvId(detail: string | null | undefined): string | null {
  const m = detail?.match(/\|?(conv_[A-Za-z0-9_]+)/);
  return m?.[1] ?? null;
}

function eventLabel(ev: CallEvent, isOutbound: boolean, extLabel: string, t: (key: string, opts?: Record<string, string>) => string): string {
  switch (ev.event) {
    case "invite":
      return isOutbound
        ? t("calls.eventOutgoing", { ext: extLabel })
        : ev.detail ? t("calls.eventIncomingFrom", { detail: ev.detail }) : t("calls.eventIncoming");
    case "answered":
      return t("calls.eventAnswered");
    case "connected_ai": {
      const cleanDetail = stripConvId(ev.detail);
      const translatedDetail = cleanDetail
        ? cleanDetail.replace(/^Connected to /i, t("calls.connectedTo") + " ")
        : undefined;
      return translatedDetail ? t("calls.eventAiResponded", { detail: translatedDetail }) : t("calls.eventAiRespondedSimple");
    }
    case "ended":
      return ev.detail ? t("calls.eventCallEnded", { detail: ev.detail }) : t("calls.eventCallEndedSimple");
    case "error":
      return ev.detail ? t("calls.eventError", { detail: ev.detail }) : t("calls.eventErrorSimple");
  }
}

/** Duration between first and last leg */
function callDuration(legs: CallEvent[]): string | null {
  if (legs.length < 2) return null;
  const ms =
    new Date(legs[legs.length - 1].timestamp).getTime() -
    new Date(legs[0].timestamp).getTime();
  if (ms < 0) return null;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

// ── Call Detail Dialog ──────────────────────────────────────────────────────

interface EvalCriterion {
  result: "success" | "failure";
  rationale?: string;
}

interface DataField {
  value: unknown;
  rationale?: string;
}

interface CallDetailResult {
  callId: string;
  conversationId: string | null;
  hasResult: boolean;
  result: {
    conversationId: string;
    transcript: Array<{ role: "agent" | "user"; message: string; time_in_call_secs?: number }>;
    analysis: {
      call_successful?: "success" | "failure" | "unknown" | null;
      transcript_summary?: string | null;
      evaluation_criteria_results?: Record<string, EvalCriterion>;
    };
    dataCollectionResults?: Record<string, DataField>;
    summary?: string | null;
    rawPayload?: unknown;
  } | null;
}

/** Convert snake_case / camelCase DB keys into readable Title Case labels. */
function prettyKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function CallDetailDialog({
  callId,
  legs,
  isOutbound,
  extLabel,
  open,
  onClose,
}: {
  callId: string;
  legs: CallEvent[];
  isOutbound: boolean;
  extLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { formatTime } = useTimezone();
  const [detail, setDetail] = React.useState<CallDetailResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [polling, setPolling] = React.useState(false);
  const [showRaw, setShowRaw] = React.useState(false);

  React.useEffect(() => {
    if (!open) { setDetail(null); setShowRaw(false); setPolling(false); return; }

    let cancelled = false;
    let pollCount = 0;
    const MAX_POLLS = 12; // 5 s × 12 = 60 s max

    const fetchDetail = async () => {
      if (cancelled) return;
      if (pollCount === 0) setLoading(true);

      const data: CallDetailResult | null = await fetch(
        `/api/deploy/call-events/${encodeURIComponent(callId)}/detail`
      )
        .then(r => r.ok ? r.json() as Promise<CallDetailResult> : null)
        .catch(() => null);

      if (cancelled) return;
      setDetail(data);
      setLoading(false);

      // If webhook hasn't arrived yet, keep polling up to MAX_POLLS
      if (!data?.hasResult && pollCount < MAX_POLLS) {
        pollCount++;
        setPolling(true);
        setTimeout(fetchDetail, 5000);
      } else {
        setPolling(false);
      }
    };

    fetchDetail();
    return () => { cancelled = true; };
  }, [open, callId]);

  // Legs in fixed logical order: ended/error → ai → answered → invite
  const LEG_ORDER: Record<string, number> = { ended: 0, error: 1, connected_ai: 2, answered: 3, invite: 4 };
  const legsDesc = [...legs].sort((a, b) => {
    const oa = LEG_ORDER[a.event] ?? 5;
    const ob = LEG_ORDER[b.event] ?? 5;
    if (oa !== ob) return oa - ob;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  const result = detail?.result;
  const transcript = result?.transcript ?? [];
  const analysis = result?.analysis;
  const evalEntries = Object.entries(analysis?.evaluation_criteria_results ?? {}) as [string, EvalCriterion][];
  const dataEntries = Object.entries(result?.dataCollectionResults ?? {}) as [string, DataField][];

  const successIcon = analysis?.call_successful === "success"
    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
    : analysis?.call_successful === "failure"
    ? <XCircle className="h-4 w-4 text-red-500 shrink-0" />
    : <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />;

  const successLabel = analysis?.call_successful === "success"
    ? t("calls.detailSuccess")
    : analysis?.call_successful === "failure"
    ? t("calls.detailFailure")
    : t("calls.detailUnknown");

  const hasResultSection = !loading && result &&
    (evalEntries.length > 0 || dataEntries.length > 0 || analysis?.call_successful || result.summary || result.rawPayload != null);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 flex-wrap">
            {t("calls.detailTitle")}
            <div className="flex items-center gap-1 min-w-0">
              <span className="font-mono text-xs text-muted-foreground font-normal break-all">{callId}</span>
              <CopyButton value={callId} />
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* ── Section 1: Call Legs ── */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("calls.detailLegs")}</h3>
          <div className="divide-y rounded-md border bg-muted/20">
            {legsDesc.map((leg, i) => {
              const isAiLeg = leg.event === "connected_ai";
              const convId = isAiLeg ? extractConvId(leg.detail) : null;
              return (
                <div key={i} className="px-4 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0">{(isOutbound ? EVENT_ICONS_OUTBOUND : EVENT_ICONS)[leg.event]}</div>
                    <div className="flex-1 min-w-0 text-sm">{eventLabel(leg, isOutbound, extLabel, t)}</div>
                    <time className="text-xs text-muted-foreground shrink-0 tabular-nums">{formatTime(leg.timestamp)}</time>
                  </div>
                  {isAiLeg && convId && (
                    <div className="ml-7 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-medium">{t("calls.detailConvId")}:</span>
                      <code className="font-mono bg-muted px-1 py-0.5 rounded">{convId}</code>
                      <CopyButton value={convId} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Section 2: Conversation ── */}
        <div className="space-y-2 pt-2 border-t">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("calls.detailConversation")}</h3>
          {loading ? (
            <div className="space-y-2 animate-pulse py-1">
              {[42, 65, 50].map((w, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-3 w-12 bg-muted rounded shrink-0" />
                  <div className="h-3 bg-muted rounded" style={{ width: `${w}%` }} />
                </div>
              ))}
            </div>
          ) : polling ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>{t("calls.detailWaiting")}</span>
            </div>
          ) : transcript.length > 0 ? (
            <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/10 divide-y">
              {transcript.map((turn, i) => (
                <div key={i} className="flex gap-3 px-3 py-2 text-sm">
                  <span className={`shrink-0 w-16 text-right text-xs font-semibold pt-0.5 ${
                    turn.role === "agent" ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"
                  }`}>
                    {turn.role === "agent" ? t("calls.detailAiSpeaker") : t("calls.detailCallerSpeaker")}
                  </span>
                  <span className="leading-relaxed flex-1 min-w-0">{turn.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-1">{t("calls.detailNoConversation")}</p>
          )}
        </div>

        {/* ── Section 3: Call Result ── */}
        {hasResultSection && (
          <div className="space-y-4 pt-2 border-t">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("calls.detailResult")}</h3>

            {/* Outcome + summary */}
            {(analysis?.call_successful || result!.summary) && (
              <div className="space-y-2">
                {analysis?.call_successful && (
                  <div className="flex items-center gap-2 text-sm">
                    {successIcon}
                    <span className="font-medium">{t("calls.detailCallSuccess")}:</span>
                    <span>{successLabel}</span>
                  </div>
                )}
                {result!.summary && (
                  <p className="text-sm leading-relaxed bg-muted/40 rounded-md px-3 py-2">{result!.summary}</p>
                )}
              </div>
            )}

            {/* Evaluation criteria — with rationale */}
            {evalEntries.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("calls.detailEvaluation")}</p>
                <div className="space-y-2.5">
                  {evalEntries.map(([key, criterion]) => (
                    <div key={key} className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        {criterion.result === "success"
                          ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                        <span className="text-sm font-medium">{prettyKey(key)}</span>
                      </div>
                      {criterion.rationale && (
                        <p className="text-xs text-muted-foreground ml-6 leading-relaxed">{criterion.rationale}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Extracted information */}
            {dataEntries.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("calls.detailExtractedInfo")}</p>
                <div className="rounded-md border divide-y text-sm">
                  {dataEntries.map(([key, field]) => (
                    <div key={key} className="px-3 py-2 space-y-0.5">
                      <div className="text-xs font-medium text-muted-foreground">{prettyKey(key)}</div>
                      <div className="font-medium">{String(field.value ?? "—")}</div>
                      {field.rationale && (
                        <div className="text-xs text-muted-foreground italic">{field.rationale}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw webhook payload — collapsible */}
            {result!.rawPayload != null && (
              <div className="space-y-1">
                <button
                  onClick={() => setShowRaw(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-150 ${showRaw ? "rotate-90" : ""}`} />
                  {t("calls.detailWebhookPayload")}
                </button>
                {showRaw && (
                  <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-80 font-mono leading-relaxed whitespace-pre-wrap break-all">
                    {JSON.stringify(result!.rawPayload, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── single row ─────────────────────────────────────────────────────────────

interface CallRowProps {
  callId: string;
  legs: CallEvent[];
  extNumber?: string;
  isOutbound?: boolean;
  /** Real destination phone number for outbound calls (from outbound_calls table) */
  outboundPhoneNumber?: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onDelete?: (callId: string) => void;
}

function CallTableRow({ callId, legs, extNumber, isOutbound = false, outboundPhoneNumber, isOpen, onToggle, onDelete }: CallRowProps) {
  const { formatDateTime, formatTime } = useTimezone();
  const { t } = useTranslation();
  const [detailOpen, setDetailOpen] = React.useState(false);

  const hasEnded = legs.some(l => l.event === "ended");
  const hasAI    = legs.some(l => l.event === "connected_ai");
  const hasError = legs.some(l => l.event === "error");

  const firstLeg = legs[0];
  const duration = callDuration(legs);

  const inviteLeg        = legs.find(l => l.event === "invite");
  const inboundNumber    = inviteLeg?.detail ?? null;
  const extLabel         = extNumber ? `Ext ${extNumber}` : "—";

  const outboundDest = outboundPhoneNumber
    ?? (inboundNumber && inboundNumber !== "unknown" ? inboundNumber : null);

  const caller = isOutbound ? extLabel                  : (inboundNumber ?? "—");
  const called = isOutbound ? (outboundDest ?? "—")    : extLabel;

  const stateLabel = hasError ? t("calls.stateError") : hasEnded ? t("calls.stateEnded") : hasAI ? t("calls.stateAiActive") : t("calls.stateRinging");
  const stateColor = hasError
    ? "text-red-500"
    : hasEnded
    ? "text-muted-foreground"
    : hasAI
    ? "text-purple-600"
    : "text-blue-500";

  // Legs displayed in fixed logical order: ended/error → ai → invite/answered
  const LEG_ORDER: Record<string, number> = { ended: 0, error: 1, connected_ai: 2, answered: 3, invite: 4 };
  const legsDesc = [...legs].sort((a, b) => {
    const oa = LEG_ORDER[a.event] ?? 5;
    const ob = LEG_ORDER[b.event] ?? 5;
    if (oa !== ob) return oa - ob;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  // Show delete only for completed calls; show detail for any call with an AI leg
  const showDelete = hasEnded && !!onDelete;
  const showDetail = hasAI || hasEnded;

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={onToggle} asChild>
        <>
          <TableRow className="hover:bg-muted/40 select-none group/row">
              {/* Call ID */}
              <TableCell className="font-mono text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <CollapsibleTrigger asChild>
                    <button className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-border bg-muted/50 hover:bg-muted transition-colors shrink-0">
                      {isOpen
                        ? <ChevronDown  className="h-3 w-3 shrink-0" />
                        : <ChevronRight className="h-3 w-3 shrink-0" />}
                    </button>
                  </CollapsibleTrigger>
                  <span>{callId.slice(0, 8)}…</span>
                  <CopyButton value={callId} />
                </div>
              </TableCell>
              {/* Direction */}
              <TableCell>
                {isOutbound ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                    <ArrowUpRight className="h-3 w-3" />
                    {t("calls.dirOutbound")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                    <ArrowDownLeft className="h-3 w-3" />
                    {t("calls.dirInbound")}
                  </span>
                )}
              </TableCell>
              {/* Caller */}
              <TableCell className="font-mono text-sm">{caller}</TableCell>
              {/* Called */}
              <TableCell className="font-mono text-sm">{called}</TableCell>
              {/* Date */}
              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDateTime(firstLeg.timestamp)}
              </TableCell>
              {/* Duration */}
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {duration ?? "—"}
              </TableCell>
              {/* Action */}
              {onDelete && (
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    {/* Detail button — always shown for completed/AI calls */}
                    {showDetail && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDetailOpen(true); }}
                        className="inline-flex items-center justify-center h-7 w-7 rounded border border-border text-muted-foreground hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-pointer"
                        title="View call detail"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {/* Delete button — only for completed calls */}
                    {showDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            className="inline-flex items-center justify-center h-7 w-7 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 hover:bg-destructive/10 transition-colors cursor-pointer"
                            title="Delete call"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("calls.deleteCallTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("calls.deleteCallDesc", { callId: callId.slice(0, 8) + "…" })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => onDelete(callId)}
                            >
                              {t("common.delete")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>

          {/* Accordion legs */}
          <CollapsibleContent asChild>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={onDelete ? 7 : 6} className="p-0 border-t-0">
                <div className="bg-muted/20 divide-y border-b">
                  {legsDesc.map((leg, i) => (
                    <div key={i} className="flex items-center gap-3 px-10 py-2.5">
                      <div className="shrink-0">{(isOutbound ? EVENT_ICONS_OUTBOUND : EVENT_ICONS)[leg.event]}</div>
                      <div className="flex-1 min-w-0 text-sm">{eventLabel(leg, isOutbound, extLabel, t)}</div>
                      <time className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {formatTime(leg.timestamp)}
                      </time>
                    </div>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          </CollapsibleContent>
        </>
      </Collapsible>

      {/* Detail dialog — rendered outside Collapsible so it doesn't interfere */}
      {showDetail && (
        <CallDetailDialog
          callId={callId}
          legs={legs}
          isOutbound={isOutbound}
          extLabel={extLabel}
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  );
}

// ── table wrapper ───────────────────────────────────────────────────────────

export interface OutboundCallInfo {
  callId: string;
  phoneNumber: string;
}

interface CallHistoryTableProps {
  /** [callId, legs[]] entries, already sorted most-recent first */
  callGroups: [string, CallEvent[]][];
  extensions?: Extension[];
  /** Outbound call records — provides direction detection and the real destination number */
  outboundCalls?: OutboundCallInfo[];
  /** @deprecated use outboundCalls instead */
  outboundCallIds?: string[];
  /** Show at most this many rows (undefined = all) */
  limit?: number;
  /** If set, a centered "View all" link is rendered below the table */
  viewAllHref?: string;
  emptyMessage?: string;
  /** Called when the user clicks the delete button on a call row */
  onDeleteCall?: (callId: string) => void;
}

export function CallHistoryTable({
  callGroups,
  extensions,
  outboundCalls,
  outboundCallIds,
  limit,
  viewAllHref,
  emptyMessage,
  onDeleteCall,
}: CallHistoryTableProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const { t } = useTranslation();
  const resolvedEmptyMessage = emptyMessage ?? t("calls.emptyMessage");

  const visible = limit ? callGroups.slice(0, limit) : callGroups;

  const outboundMap = React.useMemo(() => {
    const m = new Map<string, string | null>();
    if (outboundCalls) {
      for (const oc of outboundCalls) m.set(oc.callId, oc.phoneNumber);
    } else if (outboundCallIds) {
      for (const id of outboundCallIds) m.set(id, null);
    }
    return m;
  }, [outboundCalls, outboundCallIds]);

  const toggle = (id: string) =>
    setOpenId(prev => (prev === id ? null : id));

  if (callGroups.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <PhoneCall className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">{resolvedEmptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[220px]">{t("calls.thCallId")}</TableHead>
            <TableHead>{t("calls.thDirection")}</TableHead>
            <TableHead>{t("calls.thCaller")}</TableHead>
            <TableHead>{t("calls.thCalled")}</TableHead>
            <TableHead>{t("calls.thDate")}</TableHead>
            <TableHead>{t("calls.thDuration")}</TableHead>
            {onDeleteCall && <TableHead className="w-20 text-center">{t("calls.thAction")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map(([callId, legs]) => {
            const ext = extensions?.find(e => e.id === legs[0]?.extensionId);
            const isOutbound = outboundMap.has(callId);
            return (
              <CallTableRow
                key={callId}
                callId={callId}
                legs={legs}
                extNumber={ext?.extensionNumber}
                isOutbound={isOutbound}
                outboundPhoneNumber={isOutbound ? outboundMap.get(callId) : null}
                isOpen={openId === callId}
                onToggle={() => toggle(callId)}
                onDelete={onDeleteCall}
              />
            );
          })}
        </TableBody>
      </Table>

      {viewAllHref && (
        <div className="mt-3 flex justify-center">
          <Link href={viewAllHref}>
            <Button variant="ghost" size="sm" className="text-xs h-7">{t("calls.viewAll")}</Button>
          </Link>
        </div>
      )}
    </>
  );
}

// ── shared grouping util ────────────────────────────────────────────────────

export function groupEventsByCall(events: CallEvent[]): Map<string, CallEvent[]> {
  const map = new Map<string, CallEvent[]>();
  for (const ev of events) {
    if (!map.has(ev.callId)) map.set(ev.callId, []);
    map.get(ev.callId)!.push(ev);
  }
  for (const [callId, legs] of map.entries()) {
    legs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const seen = new Set<string>();
    map.set(callId, legs.filter(leg => {
      const key = `${leg.event}::${leg.detail ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }
  return map;
}
