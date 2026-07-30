import React from "react";
import { useListExtensions } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PhoneCall, RefreshCw, Trash2 } from "lucide-react";
import { CallHistoryTable, groupEventsByCall, type CallEvent } from "@/components/call-history-table";

interface CallEventsResponse {
  events: CallEvent[];
  activeCallCount: number;
  outboundCalls?: { callId: string; phoneNumber: string }[];
}

const PAGE_SIZE = 20;

export default function CallsPage() {
  const { t } = useTranslation();
  const [page, setPage] = React.useState(1);
  const queryClient = useQueryClient();

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

  const deleteCall = useMutation({
    mutationFn: async (callId: string) => {
      const res = await fetch(`/api/deploy/call-events/${encodeURIComponent(callId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete call");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["call-events-all"] }),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/deploy/call-events", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear call history");
    },
    onSuccess: () => {
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ["call-events-all"] });
    },
  });

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
          <h1 className="text-3xl font-bold tracking-tight">{t("calls.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("calls.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleRefresh} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {t("calls.refresh")}
          </Button>
          {callGroups.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                  {t("calls.clearAll")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("calls.clearTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("calls.clearDesc", { count: callGroups.length })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => clearAll.mutate()}
                  >
                    {t("calls.clearAll")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PhoneCall className="h-4 w-4" />
            {t("calls.allCalls")}
            {callGroups.length > 0 && (
              <Badge variant="secondary" className="ml-1">{callGroups.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <CallHistoryTable
            callGroups={pageGroups}
            extensions={extensions}
            outboundCalls={callEvents?.outboundCalls}
            emptyMessage={t("calls.emptyMessage")}
            onDeleteCall={(callId) => deleteCall.mutate(callId)}
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
                  onClick={() => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}
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
