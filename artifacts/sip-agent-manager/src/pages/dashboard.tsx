import React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetStats, useListExtensions, useListAgentConfigs } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Server, Users, Activity, Bot, PhoneCall, ArrowUpRight, RotateCcw, Square, Play } from "lucide-react";
import { ProviderBadge } from "@/components/provider-badge";
import { useAllDeployStatuses, useStartExtension, useStopExtension, useRestartExtension, type DeployStatus } from "@/hooks/use-deploy";
import { useToast } from "@/hooks/use-toast";
import { CallHistoryTable, groupEventsByCall, type CallEvent } from "@/components/call-history-table";
import { cn } from "@/lib/utils";

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

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

function StatCard({ icon: Icon, label, value, iconBg, iconColor }: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="bg-card border rounded-xl p-5 flex items-center gap-4 shadow-sm">
      <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl shrink-0", iconBg)}>
        <Icon className={cn("h-6 w-6", iconColor)} />
      </div>
      <div>
        <p className="text-sm text-muted-foreground font-medium">{label}</p>
        <p className="text-3xl font-bold text-foreground leading-none mt-1">{value}</p>
      </div>
    </div>
  );
}

function AgentRow({ ext, status }: {
  ext: { id: number; extensionNumber: string; displayName?: string | null; agentConfig?: { provider: string; name: string } | null };
  status: DeployStatus | undefined;
}) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const start   = useStartExtension(ext.id);
  const stop    = useStopExtension(ext.id);
  const restart = useRestartExtension(ext.id);
  const isRunning = status?.status === "registered" || status?.status === "starting" || status?.status === "reconnecting";
  const isReg     = status?.sipRegistered ?? false;

  return (
    <tr className="border-b last:border-0 hover:bg-muted/20 transition-colors">
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-mono font-semibold text-sm">{ext.extensionNumber}</span>
        </div>
      </td>
      <td className="py-3 px-4 text-sm font-medium text-foreground">{ext.displayName || "—"}</td>
      <td className="py-3 px-4">
        {ext.agentConfig ? (
          <div className="flex items-center gap-2">
            <ProviderBadge provider={ext.agentConfig.provider} />
            <span className="text-xs text-muted-foreground">{ext.agentConfig.name}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground italic">No agent</span>
        )}
      </td>
      <td className="py-3 px-4">
        {status ? (
          <div className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full shrink-0", isRunning ? "bg-green-500" : "bg-gray-300")} />
            <span className={cn("text-sm font-medium", isRunning ? "text-green-700" : "text-muted-foreground")}>
              {isRunning ? "Running" : "Stopped"}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-xs text-muted-foreground">
        {isRunning && status?.lastStartedAt ? timeAgo(status.lastStartedAt) : "—"}
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1.5">
          {!isRunning ? (
            <Button
              size="sm" variant="outline"
              className="h-7 px-3 text-xs gap-1 text-primary border-primary/30 hover:bg-primary hover:text-primary-foreground"
              disabled={!ext.agentConfig || start.isPending}
              onClick={() => start.mutate(undefined, {
                onError: (e) => toast({ variant: "destructive", title: t("dashboard.deployFailed"), description: e.message })
              })}
            >
              <Play className="h-3 w-3" /> {t("deploy.deploy")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline"
                className="h-7 px-3 text-xs gap-1 border-red-200 text-red-600 hover:bg-red-50"
                disabled={stop.isPending}
                onClick={() => stop.mutate(undefined, {
                  onError: (e) => toast({ variant: "destructive", title: t("dashboard.stopFailed"), description: e.message })
                })}
              >
                <Square className="h-3 w-3" /> {t("deploy.stop")}
              </Button>
              <Button size="sm" variant="outline"
                className="h-7 px-3 text-xs gap-1"
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
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-0.5 text-primary">
              {t("deploy.details")} <ArrowUpRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </td>
    </tr>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useGetStats();
  const { data: extensions }       = useListExtensions();
  const { data: agentConfigs }     = useListAgentConfigs();
  const { data: allStatuses }      = useAllDeployStatuses();
  const { data: callEvents }       = useCallEvents();

  const statusMap = React.useMemo(() => {
    const m = new Map<number, DeployStatus>();
    for (const s of allStatuses ?? []) m.set(s.extensionId, s);
    return m;
  }, [allStatuses]);

  const runningCount = (allStatuses ?? []).filter(
    s => s.status === "registered" || s.status === "starting" || s.status === "reconnecting"
  ).length;
  const totalExt = extensions?.length ?? 0;
  const stoppedCount = Math.max(0, totalExt - runningCount);

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
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">Monitor your IPBX systems, AI agents and voice activity.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 border border-green-200 bg-green-50 rounded-full px-3 py-1 shrink-0 mt-1">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          System Healthy
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Server}   label="IPBX Systems"          value={stats?.totalClients ?? 0}  iconBg="bg-blue-50"   iconColor="text-blue-600" />
        <StatCard icon={Users}    label="Extensions"             value={stats?.totalExtensions ?? 0} iconBg="bg-gray-100"   iconColor="text-gray-500" />
        <StatCard icon={Activity} label="Registered Extensions"  value={runningCount}              iconBg="bg-green-50"  iconColor="text-green-600" />
        <StatCard icon={Bot}      label="AI Agents"              value={agentConfigs?.length ?? 0} iconBg="bg-purple-50" iconColor="text-purple-600" />
      </div>

      {/* Live Agent Status */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-base">{t("dashboard.liveAgentStatus")}</h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-green-700 font-medium">{runningCount} Running</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-gray-400" />
                <span className="text-muted-foreground">{stoppedCount} Stopped</span>
              </span>
            </div>
            <Link href="/extensions">
              <Button variant="ghost" size="sm" className="text-primary h-7 gap-0.5 text-xs font-medium hover:text-primary">
                View all extensions <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        {!extensions || extensions.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{t("dashboard.noExtensions")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-muted-foreground bg-muted/30 border-b">
                  <th className="text-left font-medium py-2.5 px-4">Extension</th>
                  <th className="text-left font-medium py-2.5 px-4">Name</th>
                  <th className="text-left font-medium py-2.5 px-4">AI Agent</th>
                  <th className="text-left font-medium py-2.5 px-4">Runtime Status</th>
                  <th className="text-left font-medium py-2.5 px-4">Last Activity</th>
                  <th className="text-left font-medium py-2.5 px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {extensions.slice(0, 5).map(ext => (
                  <AgentRow key={ext.id} ext={ext} status={statusMap.get(ext.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Calls */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <PhoneCall className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="font-semibold text-base">{t("dashboard.callsHistory")}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Last 5 calls across your deployed extensions.</p>
            </div>
          </div>
          <Link href="/calls">
            <Button variant="ghost" size="sm" className="text-primary h-7 gap-0.5 text-xs font-medium hover:text-primary">
              View all call history <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
        <CallHistoryTable
          callGroups={callGroups}
          extensions={extensions}
          outboundCalls={callEvents?.outboundCalls}
          limit={5}
          emptyMessage={t("dashboard.emptyCallsMsg")}
        />
      </div>
    </div>
  );
}
