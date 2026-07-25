import React from "react";
import { useListExtensions } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PhoneCall, RefreshCw } from "lucide-react";
import { CallHistoryTable, groupEventsByCall, type CallEvent } from "@/components/call-history-table";

interface CallEventsResponse {
  events: CallEvent[];
  activeCallCount: number;
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
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const { data: extensions } = useListExtensions();

  // Only completed calls: must have both an invite and an ended event.
  // Sorted most-recent first by call start time (first event = invite after ascending sort).
  const callGroups = React.useMemo(() => {
    if (!callEvents?.events?.length) return [];
    const grouped = groupEventsByCall(callEvents.events);
    return Array.from(grouped.entries())
      .filter(([, legs]) => legs.some(l => l.event === "invite") && legs.some(l => l.event === "ended"))
      .sort(([, a], [, b]) => new Date(b[0].timestamp).getTime() - new Date(a[0].timestamp).getTime());
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
          <CallHistoryTable
            callGroups={pageGroups}
            extensions={extensions}
            emptyMessage="No completed calls recorded yet. Deploy an extension and make a call to see history here."
          />

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
        </CardContent>
      </Card>
    </div>
  );
}
