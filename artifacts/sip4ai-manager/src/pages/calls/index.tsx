import React from "react";
import { useListExtensions } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PhoneCall, PhoneIncoming, PhoneOff, Activity, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

interface CallEvent {
  extensionId: number;
  callId: string;
  event: "invite" | "answered" | "ended" | "connected_ai" | "error";
  timestamp: string;
  detail?: string;
}

interface CallEventsResponse {
  events: CallEvent[];
  activeCallCount: number;
}

const EVENT_ICONS: Record<CallEvent["event"], React.ReactNode> = {
  invite: <PhoneIncoming className="h-3.5 w-3.5 text-blue-500" />,
  answered: <PhoneCall className="h-3.5 w-3.5 text-green-500" />,
  ended: <PhoneOff className="h-3.5 w-3.5 text-muted-foreground" />,
  connected_ai: <Activity className="h-3.5 w-3.5 text-purple-500" />,
  error: <PhoneOff className="h-3.5 w-3.5 text-red-500" />,
};

function eventLabel(ev: CallEvent): string {
  switch (ev.event) {
    case "invite":
      return ev.detail ? `Incoming call from ${ev.detail}` : "Incoming call";
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

function groupEventsByCall(events: CallEvent[]): Map<string, CallEvent[]> {
  const map = new Map<string, CallEvent[]>();
  for (const ev of events) {
    if (!map.has(ev.callId)) map.set(ev.callId, []);
    map.get(ev.callId)!.push(ev);
  }
  return map;
}

/** Duration string between first and last event */
function callDuration(legs: CallEvent[]): string | null {
  if (legs.length < 2) return null;
  const ms = new Date(legs[legs.length - 1].timestamp).getTime() - new Date(legs[0].timestamp).getTime();
  if (ms < 0) return null;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function CallRow({ callId, legs, extNumber }: { callId: string; legs: CallEvent[]; extNumber?: string }) {
  const [open, setOpen] = React.useState(false);

  const hasEnded = legs.some(l => l.event === "ended");
  const hasAI = legs.some(l => l.event === "connected_ai");
  const hasError = legs.some(l => l.event === "error");
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];
  const duration = callDuration(legs);

  const stateLabel = hasError ? "Error" : hasEnded ? "Ended" : hasAI ? "AI Active" : "Ringing";
  const stateColor = hasError
    ? "text-red-500"
    : hasEnded
    ? "text-muted-foreground"
    : hasAI
    ? "text-purple-600"
    : "text-blue-600";

  const inviteLeg = legs.find(l => l.event === "invite");
  const fromNumber = inviteLeg?.detail;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors select-none">
          <div className="flex items-center gap-3 min-w-0">
            {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <PhoneCall className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium font-mono">call {callId.slice(0, 8)}…</span>
                {extNumber && (
                  <Badge variant="outline" className="text-xs font-mono px-1.5 py-0">ext {extNumber}</Badge>
                )}
                {fromNumber && (
                  <span className="text-xs text-muted-foreground font-mono">{fromNumber}</span>
                )}
                <span className={`text-xs font-medium ${stateColor}`}>{stateLabel}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {legs.length} leg{legs.length !== 1 ? "s" : ""}
                {" · "}{new Date(firstLeg.timestamp).toLocaleTimeString()}
                {hasEnded && ` → ${new Date(lastLeg.timestamp).toLocaleTimeString()}`}
                {duration && ` · ${duration}`}
              </p>
            </div>
          </div>
          <div className="shrink-0 ml-4">
            <span className="text-xs text-muted-foreground tabular-nums hidden sm:block">
              {new Date(firstLeg.timestamp).toLocaleDateString()}
            </span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="bg-muted/20 border-t divide-y">
          {legs.map((leg, i) => (
            <div key={i} className="flex items-start gap-3 px-8 py-2.5">
              <div className="mt-0.5 shrink-0">{EVENT_ICONS[leg.event]}</div>
              <div className="flex-1 min-w-0">
                <span className="text-sm">{eventLabel(leg)}</span>
              </div>
              <time className="text-xs text-muted-foreground shrink-0 tabular-nums">
                {new Date(leg.timestamp).toLocaleTimeString()}
              </time>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const PAGE_SIZE = 20;

export default function CallsPage() {
  const [page, setPage] = React.useState(1);

  const { data: callEvents, refetch, isFetching } = useQuery<CallEventsResponse>({
    queryKey: ["call-events-all"],
    queryFn: async () => {
      const res = await fetch("/api/deploy/call-events");
      if (!res.ok) return { events: [], activeCallCount: 0 };
      return res.json();
    },
    // No auto-refresh — only refresh on button click
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const { data: extensions } = useListExtensions();

  // Only show calls that have ended (after hang up)
  const callGroups = React.useMemo(() => {
    if (!callEvents?.events?.length) return [];
    const grouped = groupEventsByCall(callEvents.events);
    return Array.from(grouped.entries())
      .filter(([, legs]) => legs.some(l => l.event === "ended"))
      .reverse(); // most-recent first
  }, [callEvents]);

  const totalPages = Math.max(1, Math.ceil(callGroups.length / PAGE_SIZE));
  const pageGroups = callGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleRefresh = () => {
    setPage(1);
    refetch();
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Call History</h1>
          <p className="text-muted-foreground mt-1 text-sm">Completed calls across your deployed extensions.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleRefresh} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PhoneCall className="h-4 w-4" />
            All Calls
            {callGroups.length > 0 && (
              <Badge variant="secondary" className="ml-1">{callGroups.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {callGroups.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <PhoneCall className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No completed calls recorded yet.</p>
              <p className="text-xs mt-1">Deploy an extension and make a call to see history here.</p>
            </div>
          ) : (
            <>
              <div className="divide-y">
                {pageGroups.map(([callId, legs]) => {
                  const ext = extensions?.find(e => e.id === legs[0]?.extensionId);
                  return (
                    <CallRow
                      key={callId}
                      callId={callId}
                      legs={legs}
                      extNumber={ext?.extensionNumber}
                    />
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1 px-4 py-3 border-t">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <Button
                      key={p}
                      variant={p === page ? "default" : "outline"}
                      size="sm"
                      className="h-8 w-8 p-0 text-xs"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
