import React from "react";
import { Link } from "wouter";
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
import { PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneOff, Activity, ChevronDown, ChevronRight, Trash2, Copy, Check, ArrowDownLeft, ArrowUpRight } from "lucide-react";

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
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
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

function eventLabel(ev: CallEvent, isOutbound: boolean, extLabel: string): string {
  switch (ev.event) {
    case "invite":
      return isOutbound
        ? `Outgoing call from ${extLabel}`
        : ev.detail ? `Incoming call from ${ev.detail}` : "Incoming call";
    case "answered":
      return "Answered";
    case "connected_ai":
      return ev.detail ? `AI responded — ${ev.detail}` : "AI responded";
    case "ended":
      return ev.detail ? `Call ended (${ev.detail})` : "Call ended";
    case "error":
      return ev.detail ? `Error: ${ev.detail}` : "Error";
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

// ── single row ─────────────────────────────────────────────────────────────

interface CallRowProps {
  callId: string;
  legs: CallEvent[];
  extNumber?: string;
  isOutbound?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onDelete?: (callId: string) => void;
}

function CallTableRow({ callId, legs, extNumber, isOutbound = false, isOpen, onToggle, onDelete }: CallRowProps) {
  const { formatDateTime, formatTime } = useTimezone();
  const hasEnded = legs.some(l => l.event === "ended");
  const hasAI    = legs.some(l => l.event === "connected_ai");
  const hasError = legs.some(l => l.event === "error");

  const firstLeg = legs[0];
  const duration = callDuration(legs);

  const inviteLeg   = legs.find(l => l.event === "invite");
  const phoneNumber = inviteLeg?.detail ?? null;
  const extLabel    = extNumber ? `Ext ${extNumber}` : "—";

  // Outbound: Ext called the phone number — show Ext as caller, phone number as called
  // Inbound:  phone number called the Ext — show phone number as caller, Ext as called
  const caller = isOutbound ? extLabel              : (phoneNumber ?? "—");
  const called = isOutbound ? (phoneNumber ?? "—") : extLabel;

  const stateLabel = hasError ? "Error" : hasEnded ? "Ended" : hasAI ? "AI Active" : "Ringing";
  const stateColor = hasError
    ? "text-red-500"
    : hasEnded
    ? "text-muted-foreground"
    : hasAI
    ? "text-purple-600"
    : "text-blue-500";

  // Legs displayed newest-first
  const legsDesc = [...legs].reverse();

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle} asChild>
      <>
        <CollapsibleTrigger asChild>
          <TableRow className="cursor-pointer hover:bg-muted/40 select-none group/row">
            {/* Call ID */}
            <TableCell className="font-mono text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                {isOpen
                  ? <ChevronDown  className="h-3.5 w-3.5 shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                <span>{callId.slice(0, 8)}…</span>
                <CopyButton value={callId} />
              </div>
            </TableCell>
            {/* Direction */}
            <TableCell>
              {isOutbound ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                  <ArrowUpRight className="h-3 w-3" />
                  Outbound
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                  <ArrowDownLeft className="h-3 w-3" />
                  Inbound
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
              <div className="flex items-center justify-between gap-2">
                <span>{duration ?? "—"}</span>
                {onDelete && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="opacity-0 group-hover/row:opacity-100 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                        title="Delete this call"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this call record?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete the call <span className="font-mono">{callId.slice(0, 8)}…</span>. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => onDelete(callId)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </TableCell>
          </TableRow>
        </CollapsibleTrigger>

        {/* Accordion legs — newest first */}
        <CollapsibleContent asChild>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={6} className="p-0 border-t-0">
              <div className="bg-muted/20 divide-y border-b">
                {legsDesc.map((leg, i) => (
                  <div key={i} className="flex items-center gap-3 px-10 py-2.5">
                    <div className="shrink-0">{(isOutbound ? EVENT_ICONS_OUTBOUND : EVENT_ICONS)[leg.event]}</div>
                    <div className="flex-1 min-w-0 text-sm">{eventLabel(leg, isOutbound, extLabel)}</div>
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
  );
}

// ── table wrapper ───────────────────────────────────────────────────────────

interface CallHistoryTableProps {
  /** [callId, legs[]] entries, already sorted most-recent first */
  callGroups: [string, CallEvent[]][];
  extensions?: Extension[];
  /** Set of callIds that were triggered as outbound calls */
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
  outboundCallIds,
  limit,
  viewAllHref,
  emptyMessage = "No completed calls recorded yet.",
  onDeleteCall,
}: CallHistoryTableProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);

  const visible = limit ? callGroups.slice(0, limit) : callGroups;
  const outboundSet = new Set(outboundCallIds ?? []);

  const toggle = (id: string) =>
    setOpenId(prev => (prev === id ? null : id));

  if (callGroups.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <PhoneCall className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[220px]">Call ID</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead>Caller</TableHead>
            <TableHead>Called</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map(([callId, legs]) => {
            const ext = extensions?.find(e => e.id === legs[0]?.extensionId);
            return (
              <CallTableRow
                key={callId}
                callId={callId}
                legs={legs}
                extNumber={ext?.extensionNumber}
                isOutbound={outboundSet.has(callId)}
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
            <Button variant="ghost" size="sm" className="text-xs h-7">View all</Button>
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
  // Sort each group oldest-first so duration/date calculations are correct
  for (const [callId, legs] of map.entries()) {
    legs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Deduplicate: remove events where (type, detail) is identical to an earlier one.
    // This handles the backend occasionally emitting duplicate invite/connected_ai events.
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
