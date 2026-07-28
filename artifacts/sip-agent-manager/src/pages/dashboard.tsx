import React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetStats, useListExtensions } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Phone, Server, Activity, Play, RotateCcw, Square, PhoneCall, Bot } from "lucide-react";
import { ProviderBadge } from "@/components/provider-badge";
import { useAllDeployStatuses, useStartExtension, useStopExtension, useRestartExtension, statusColor, type DeployStatus } from "@/hooks/use-deploy";
import { useToast } from "@/hooks/use-toast";
import { CallHistoryTable, groupEventsByCall, type CallEvent } from "@/components/call-history-table";

interface CallEventsResponse {
  events: CallEvent[];
  activeCallCount: number;
  outboundCalls?: { callId: string; phoneNumber: string }[];
}

function useCallEvents() {
  return useQuery<CallEventsResponse>({
    queryKey: ["call-events"],
    queryFn: async () => {
      const res = await fetch("/api/deploy/call-events");
      if (!res.ok) return { events: [], activeCallCount: 0 };
      return res.json();
    },
    refetchInterval: 3000,
  });
}

function AgentRow({ ext, status }: { ext: { id: number; extensionNumber: string; displayName?: string | null; agentConfig?: { provider: string } | null }; status: DeployStatus | undefined }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const start   = useStartExtension(ext.id);
  const stop    = useStopExtension(ext.id);
  const restart = useRestartExtension(ext.id);
  const isRunning    = status?.status === "registered" || status?.status === "starting";
  const currentStatus = status?.status ?? "stopped";

  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <span className="font-mono font-semibold text-sm">{ext.extensionNumber}</span>
          <span className="text-xs text-muted-foreground">{ext.displayName || "—"}</span>
        </div>
        <ProviderBadge provider={ext.agentConfig?.provider} />
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-medium ${statusColor(currentStatus)}`}>
          {t(`deploy.status.${currentStatus}`)}
        </span>
        <div className="flex gap-1">
          {!isRunning ? (
            <Button
              size="sm" variant="outline" className="gap-1 h-7 text-xs"
              disabled={!ext.agentConfig || start.isPending}
              onClick={() => start.mutate(undefined, {
                onError: (e) => toast({ variant: "destructive", title: t("dashboard.deployFailed"), description: e.message })
              })}
            >
              <Play className="h-3 w-3" /> {t("deploy.deploy")}
            </Button>
          ) : (
            <>
              <Button
                size="sm" variant="outline" className="gap-1 h-7 text-xs border-red-300 text-red-600 hover:bg-red-50"
                disabled={stop.isPending}
                onClick={() => stop.mutate(undefined, {
                  onError: (e) => toast({ variant: "destructive", title: t("dashboard.stopFailed"), description: e.message })
                })}
              >
                <Square className="h-3 w-3" /> {t("deploy.stop")}
              </Button>
              <Button
                size="sm" variant="outline" className="gap-1 h-7 text-xs"
                disabled={restart.isPending}
                onClick={() => restart.mutate(undefined, {
                  onError: (e) => toast({ variant: "destructive", title: t("dashboard.restartFailed"), description: e.message })
                })}
              >
                <RotateCcw className="h-3 w-3" /> {t("deploy.restart")}
              </Button>
            </>
          )}
          <Link href={`/extensions/${ext.id}`}>
            <Button size="sm" variant="ghost" className="h-7 text-xs">{t("deploy.details")}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useGetStats();
  const { data: extensions }       = useListExtensions();
  const { data: allStatuses }      = useAllDeployStatuses();
  const { data: callEvents }       = useCallEvents();

  const statusMap = React.useMemo(() => {
    const m = new Map<number, DeployStatus>();
    for (const s of allStatuses ?? []) m.set(s.extensionId, s);
    return m;
  }, [allStatuses]);

  const registeredCount = (allStatuses ?? []).filter(s => s.status === "registered").length;

  const callGroups = React.useMemo(() => {
    if (!callEvents?.events?.length) return [];
    const grouped = groupEventsByCall(callEvents.events);
    return Array.from(grouped.entries())
      .filter(([, legs]) => legs.some(l => l.event === "invite") && legs.some(l => l.event === "ended"))
      .sort(([, a], [, b]) => new Date(b[0].timestamp).getTime() - new Date(a[0].timestamp).getTime());
  }, [callEvents]);

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <h1 className="text-3xl font-bold tracking-tight">{t("dashboard.title")}</h1>
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardHeader><CardTitle className="text-sm font-medium">{t("dashboard.loadingCard")}</CardTitle></CardHeader>
              <CardContent><div className="h-8 w-16 bg-muted rounded" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-3xl font-bold tracking-tight">{t("dashboard.title")}</h1>

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.totalIPBXs")}</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{stats?.totalClients ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.extensions")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{stats?.totalExtensions ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.registered")}</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold text-green-600">{registeredCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.agentConfigs")}</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-3xl font-bold">{stats?.extensionsByProvider?.length ?? 0}</div></CardContent>
        </Card>
      </div>

      <div className="grid gap-6">
        {/* Live Agent Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {t("dashboard.liveAgentStatus")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!extensions || extensions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>{t("dashboard.noExtensions")}</p>
              </div>
            ) : (
              <>
                <div>
                  {extensions.slice(0, 5).map(ext => (
                    <AgentRow key={ext.id} ext={ext} status={statusMap.get(ext.id)} />
                  ))}
                </div>
                <div className="mt-3 flex justify-center">
                  <Link href="/extensions">
                    <Button variant="ghost" size="sm" className="text-xs h-7">{t("dashboard.viewAll")}</Button>
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Calls History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5" />
              {t("dashboard.callsHistory")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <CallHistoryTable
              callGroups={callGroups}
              extensions={extensions}
              outboundCalls={callEvents?.outboundCalls}
              limit={5}
              viewAllHref="/calls"
              emptyMessage={t("dashboard.emptyCallsMsg")}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
