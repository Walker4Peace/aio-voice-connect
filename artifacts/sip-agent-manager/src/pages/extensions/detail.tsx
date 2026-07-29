import React from "react";
import { Link, useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetExtension, useUpdateExtension, useDeleteExtension,
  useListAgentConfigs, useListClients, getGetExtensionQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  ArrowLeft, Phone, Server, Play, Square, RotateCcw, Loader2, AlertCircle,
  Bot, Edit, Trash2, ShieldCheck, Eye, EyeOff, RefreshCw, ExternalLink, Info, CheckCircle2, Users
} from "lucide-react";
import { ProviderBadge } from "@/components/provider-badge";
import { useToast } from "@/hooks/use-toast";
import { maskString } from "@/lib/utils";
import {
  useDeployStatus, useStartExtension, useStopExtension, useRestartExtension,
  useWatchdogState, useSetWatchdog,
} from "@/hooks/use-deploy";
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

function formatUptime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
  return `${m}m ${s}s`;
}

const agentSchema = z.object({ agentConfigId: z.string() });
const sipSchema = z.object({
  extensionNumber: z.string().min(1),
  sipUsername: z.string().min(1),
  sipAuthId: z.string().min(1),
  sipPassword: z.string().min(1),
  clientId: z.string(),
});

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-0 gap-4">
      <dt className="text-sm text-muted-foreground shrink-0 font-medium">{label}</dt>
      <dd className="text-sm text-right font-mono truncate max-w-[220px]">{children}</dd>
    </div>
  );
}

export default function ExtensionDetail() {
  const { id } = useParams();
  const extensionId = Number(id);
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [editSipOpen, setEditSipOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [showModel, setShowModel] = React.useState(false);

  const { data: extension, isLoading } = useGetExtension(extensionId, {
    query: { enabled: !!extensionId, queryKey: getGetExtensionQueryKey(extensionId) }
  });
  const { data: agentConfigs } = useListAgentConfigs();
  const { data: clients } = useListClients();
  const updateExtension = useUpdateExtension();
  const { data: deployStatus, isLoading: statusLoading } = useDeployStatus(extensionId, !!extensionId);
  const [, navigate] = useLocation();
  const deleteExtension = useDeleteExtension();
  const start   = useStartExtension(extensionId);
  const stop    = useStopExtension(extensionId);
  const restart = useRestartExtension(extensionId);
  const { data: watchdog } = useWatchdogState(extensionId, !!extensionId);
  const setWatchdog = useSetWatchdog(extensionId);

  const isRunning     = deployStatus?.status === "registered" || deployStatus?.status === "starting" || deployStatus?.status === "reconnecting";
  const isStarting    = deployStatus?.status === "starting";
  const isReconnecting = deployStatus?.status === "reconnecting";

  const agentForm = useForm<z.infer<typeof agentSchema>>({
    resolver: zodResolver(agentSchema),
    defaultValues: { agentConfigId: "none" },
  });

  const sipForm = useForm<z.infer<typeof sipSchema>>({
    resolver: zodResolver(sipSchema),
    defaultValues: { extensionNumber: "", sipUsername: "", sipAuthId: "", sipPassword: "", clientId: "none" },
  });

  React.useEffect(() => {
    if (extension) agentForm.reset({ agentConfigId: extension.agentConfigId ? extension.agentConfigId.toString() : "none" });
  }, [extension, agentForm]);

  React.useEffect(() => {
    if (editSipOpen && extension) {
      sipForm.reset({ extensionNumber: extension.extensionNumber, sipUsername: extension.sipUsername, sipAuthId: extension.sipAuthId, sipPassword: extension.sipPassword, clientId: extension.clientId ? extension.clientId.toString() : "none" });
    }
  }, [editSipOpen, extension, sipForm]);

  const handleAction = (action: typeof start | typeof stop | typeof restart, labelKey: string) => {
    action.mutate(undefined, {
      onSuccess: () => toast({ title: `${t(labelKey)} succeeded` }),
      onError: (e) => toast({ variant: "destructive", title: `${t(labelKey)} failed`, description: e.message }),
    });
  };

  const handleAgentSave = (values: z.infer<typeof agentSchema>) => {
    if (!extension) return;
    const agentConfigId = values.agentConfigId === "none" ? null : Number(values.agentConfigId);
    updateExtension.mutate(
      { id: extensionId, data: { extensionNumber: extension.extensionNumber, sipUsername: extension.sipUsername, sipAuthId: extension.sipAuthId, sipPassword: extension.sipPassword, clientId: extension.clientId ?? null, agentConfigId } },
      {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetExtensionQueryKey(extensionId) }); toast({ title: t("extDetail.agentUpdated") }); },
        onError: () => toast({ variant: "destructive", title: t("extDetail.agentUpdateFailed") }),
      }
    );
  };

  const handleSipSave = (values: z.infer<typeof sipSchema>) => {
    if (!extension) return;
    updateExtension.mutate(
      { id: extensionId, data: { extensionNumber: values.extensionNumber, sipUsername: values.sipUsername, sipAuthId: values.sipAuthId, sipPassword: values.sipPassword, clientId: values.clientId === "none" ? null : Number(values.clientId), agentConfigId: extension.agentConfigId ?? null } },
      {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetExtensionQueryKey(extensionId) }); setEditSipOpen(false); toast({ title: t("extDetail.sipUpdated") }); },
        onError: () => toast({ variant: "destructive", title: t("extDetail.sipUpdateFailed") }),
      }
    );
  };

  if (isLoading) return <div className="p-8 animate-pulse text-muted-foreground">{t("extDetail.loading")}</div>;
  if (!extension) return <div className="p-8 text-destructive">{t("extDetail.notFound")}</div>;

  const hasAgentConfig = !!extension.agentConfig;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/extensions">
            <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Extension {extension.extensionNumber}</h1>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
              <span>{extension.displayName || t("extDetail.noDisplayName")}</span>
              {extension.displayName && <span>•</span>}
            </div>
          </div>
        </div>
        {!statusLoading && deployStatus && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5 shrink-0">
            <RefreshCw className="h-3 w-3" />
            {t("extDetail.lastUpdated", { time: timeAgo(deployStatus.lastStartedAt) })}
          </div>
        )}
      </div>

      {/* Deployment Panel */}
      <div className={cn(
        "bg-card border rounded-xl shadow-sm border-l-4 overflow-hidden",
        isReconnecting ? "border-l-orange-500" : isRunning ? "border-l-green-500" : deployStatus?.status === "error" ? "border-l-red-500" : "border-l-muted"
      )}>
        <div className="flex items-start justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="font-semibold text-base">{t("extDetail.sipAgentTitle")}</h2>
              <p className="text-xs text-muted-foreground">{hasAgentConfig ? t("extDetail.deployManage") : t("extDetail.assignFirst")}</p>
            </div>
          </div>
          {deployStatus?.uptimeSeconds != null && isRunning && (
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <span className="text-muted-foreground text-xs">{t("extDetail.uptime")}</span>
              <span className="flex items-center gap-1 text-green-700">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                {formatUptime(deployStatus.uptimeSeconds)}
              </span>
            </div>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">
          {deployStatus?.lastError && deployStatus.status !== "registered" && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="font-mono text-xs break-all">{deployStatus.lastError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!isRunning ? (
              <Button
                className="gap-2"
                disabled={!hasAgentConfig || start.isPending}
                onClick={() => handleAction(start, "deploy.deploy")}
              >
                {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {start.isPending ? t("deploy.deploying") : t("deploy.deploy")}
              </Button>
            ) : (
              <>
                <Button variant="outline" className="gap-2 border-red-200 text-red-600 hover:bg-red-50"
                  disabled={stop.isPending} onClick={() => handleAction(stop, "deploy.stop")}>
                  {stop.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  {t("deploy.stop")}
                </Button>
                <Button variant="outline" className="gap-2"
                  disabled={restart.isPending} onClick={() => handleAction(restart, "deploy.restart")}>
                  {restart.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {t("deploy.restart")}
                </Button>
              </>
            )}
            {isStarting && (
              <span className="flex items-center gap-1 text-sm text-yellow-600">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("extDetail.waitingSip")}
              </span>
            )}
            {isReconnecting && (
              <span className="flex items-center gap-1 text-sm text-orange-600">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("extDetail.yeastarUnreach")}
              </span>
            )}
          </div>

          {/* Watchdog toggle */}
          <div className="flex items-center justify-between gap-4 pt-3 border-t">
            <div className="flex items-start gap-3">
              <ShieldCheck className={cn("h-4 w-4 mt-0.5 shrink-0", watchdog?.enabled ? "text-green-500" : "text-muted-foreground")} />
              <div>
                <p className="text-sm font-medium">{t("extDetail.watchdogLabel")}</p>
                <p className="text-xs text-muted-foreground max-w-lg">
                  {t("extDetail.watchdogDesc")}
                  {watchdog?.pinging && (
                    <span className="ml-1 inline-flex items-center gap-1 text-yellow-600">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> {t("extDetail.pinging")}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={() => setWatchdog.mutate(!watchdog?.enabled, {
                onSuccess: () => toast({ title: watchdog?.enabled ? t("extDetail.watchdogDisabled") : t("extDetail.watchdogEnabled") }),
                onError: (e) => toast({ variant: "destructive", title: t("extDetail.watchdogFailed"), description: e.message }),
              })}
              disabled={setWatchdog.isPending}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0",
                watchdog?.enabled ? "bg-green-500" : "bg-gray-200"
              )}
            >
              <span className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                watchdog?.enabled ? "translate-x-6" : "translate-x-1"
              )} />
            </button>
          </div>
        </div>
      </div>

      {/* Two-column: SIP Credentials + AI Agent */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* AI Agent */}
        <div className="order-2 bg-card border rounded-xl shadow-sm border-l-4 border-l-purple-500 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50">
                <Bot className="h-4 w-4 text-purple-500" />
              </div>
              <h2 className="font-semibold text-sm">{t("extDetail.aiAgent")}</h2>
            </div>
            {extension.agentConfig && <ProviderBadge provider={extension.agentConfig.provider} />}
          </div>

          <div className="px-5 py-4">
            <Form {...agentForm}>
              <form onSubmit={agentForm.handleSubmit(handleAgentSave)} className="space-y-4">
                <FormField control={agentForm.control} name="agentConfigId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("extDetail.assignedAgent")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder={t("extDetail.selectAgent")} /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("extDetail.noAgentOption")}</SelectItem>
                          {agentConfigs?.map((a) => (
                            <SelectItem key={a.id} value={a.id.toString()}>{a.name} ({a.provider})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {extension.agentConfig && (
                  <>
                    <dl className="space-y-0 border rounded-lg overflow-hidden">
                      {[
                        { label: t("extDetail.name"), value: extension.agentConfig.name, mono: false },
                        { label: t("extDetail.provider"), value: <ProviderBadge provider={extension.agentConfig.provider} />, mono: false },
                        { label: t("extDetail.apiKey"), value: showApiKey ? extension.agentConfig.apiKey : maskString(extension.agentConfig.apiKey), mono: true, toggle: () => setShowApiKey(v => !v) },
                        ...(extension.agentConfig.modelId ? [{ label: t("extDetail.model"), value: showModel ? extension.agentConfig.modelId : maskString(extension.agentConfig.modelId, 6), mono: true, toggle: () => setShowModel(v => !v) }] : []),
                        { label: t("extDetail.voice"), value: extension.agentConfig.voiceId || "—", mono: false },
                      ].map(({ label, value, mono, toggle }, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 px-3 py-2.5 border-b last:border-0 text-sm bg-card hover:bg-muted/30">
                          <dt className="text-muted-foreground font-medium shrink-0">{label}</dt>
                          <dd className={cn("text-right flex items-center gap-1.5 min-w-0", mono ? "font-mono text-xs" : "")}>
                            <span className="truncate max-w-[160px]">{value}</span>
                            {toggle && (
                              <button type="button" onClick={toggle} className="text-muted-foreground hover:text-foreground shrink-0">
                                {mono && label === t("extDetail.apiKey") && showApiKey ? <EyeOff className="h-3 w-3" /> : mono ? <Eye className="h-3 w-3" /> : null}
                              </button>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    {/* About this agent info box */}
                    <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 flex items-center justify-center rounded bg-blue-100 shrink-0">
                          <Bot className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-blue-700">{t("extDetail.aboutAgent")}</p>
                          <p className="text-xs text-blue-600">{t("extDetail.aboutAgentDesc")}</p>
                        </div>
                      </div>
                      <Link href={`/agent-configs/${extension.agentConfig.id}/edit`}>
                        <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-600 hover:text-blue-700 px-2 gap-1 shrink-0" type="button">
                          {t("extDetail.viewDetails")} <ExternalLink className="h-3 w-3" />
                        </Button>
                      </Link>
                    </div>
                  </>
                )}

                {!extension.agentConfig && (
                  <Link href="/agent-configs/new">
                    <Button variant="outline" size="sm" type="button" className="w-full">{t("extDetail.createNewAgent")}</Button>
                  </Link>
                )}

                <div className="flex justify-end">
                  <Button size="sm" type="submit" disabled={updateExtension.isPending} className="px-6">
                    {updateExtension.isPending ? t("extDetail.savingAgent") : t("common.save")}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>

        {/* SIP Credentials */}
        <div className="order-1 bg-card border rounded-xl shadow-sm border-l-4 border-l-blue-500 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                <Server className="h-4 w-4 text-blue-500" />
              </div>
              <h2 className="font-semibold text-sm">{t("extDetail.sipCredentials")}</h2>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setEditSipOpen(true)}>
                <Edit className="h-3 w-3" /> {t("extDetail.edit")}
              </Button>
              <Button variant="outline" size="sm"
                className="gap-1.5 h-7 text-xs border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => setDeleteDialogOpen(true)} disabled={deleteExtension.isPending}>
                <Trash2 className="h-3 w-3" /> {t("extDetail.remove")}
              </Button>
            </div>
          </div>
          <div className="px-5 py-2">
            <dl>
              <FieldRow label={t("extDetail.extNumber")}>{extension.extensionNumber}</FieldRow>
              <FieldRow label={t("extDetail.sipUsername")}>{extension.sipUsername}</FieldRow>
              <FieldRow label={t("extDetail.sipAuthId")}>{extension.sipAuthId}</FieldRow>
              <FieldRow label={t("extDetail.sipPassword")}>
                <span className="flex items-center gap-1.5">
                  {maskString(extension.sipPassword)}
                </span>
              </FieldRow>
              <FieldRow label={t("extDetail.sipDomain")}>{extension.client?.sipDomain || t("extDetail.sipDomainHint")}</FieldRow>
              <FieldRow label={t("extDetail.sipServer")}>{extension.client?.sipServer || t("extDetail.sipServerHint")}</FieldRow>
            </dl>

            {/* IPBX info box */}
            {extension.client && (
              <div className="mt-3 rounded-lg bg-blue-50 border border-blue-100 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-blue-700">IPBX</p>
                    <p className="text-xs text-blue-600 font-mono">{extension.client.name} ({extension.client.sipServer})</p>
                  </div>
                </div>
                <Link href={`/ipbxs/${extension.clientId}`}>
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-600 hover:text-blue-700 px-2 gap-1">
                    {t("extDetail.viewIPBX")} <ExternalLink className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
            )}

            {/* SIP Registration status box */}
            <div className={cn(
              "mt-2 rounded-lg border p-3 flex items-center justify-between gap-3",
              deployStatus?.sipRegistered ? "bg-green-50 border-green-100" : "bg-muted border-muted"
            )}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className={cn("h-4 w-4 shrink-0", deployStatus?.sipRegistered ? "text-green-500" : "text-muted-foreground")} />
                <div>
                  <p className={cn("text-xs font-semibold", deployStatus?.sipRegistered ? "text-green-700" : "text-muted-foreground")}>{t("extDetail.sipRegistration")}</p>
                  <p className={cn("text-xs", deployStatus?.sipRegistered ? "text-green-600" : "text-muted-foreground")}>
                    {deployStatus?.sipRegistered ? t("extDetail.sipRegisteredMsg") : t("extDetail.notRegistered")}
                  </p>
                </div>
              </div>
              {deployStatus?.sipRegistered && (
                <span className="text-xs font-medium text-green-700 bg-green-100 border border-green-200 rounded px-2 py-0.5">{t("extDetail.sipRegisteredBadge")}</span>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Delete Extension Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("extensions.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("extensions.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteExtension.mutate({ id: extensionId }, {
                  onSuccess: () => { toast({ title: t("extDetail.removed") }); navigate("/extensions"); },
                  onError: () => toast({ variant: "destructive", title: t("extDetail.removeFailed") }),
                });
              }}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit SIP Dialog */}
      <Dialog open={editSipOpen} onOpenChange={setEditSipOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t("extDetail.editSipTitle")}</DialogTitle></DialogHeader>
          <Form {...sipForm}>
            <form onSubmit={sipForm.handleSubmit(handleSipSave)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={sipForm.control} name="extensionNumber" render={({ field }) => (
                  <FormItem><FormLabel>{t("extDetail.extNumber")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={sipForm.control} name="sipUsername" render={({ field }) => (
                  <FormItem><FormLabel>{t("extDetail.sipUsername")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={sipForm.control} name="sipAuthId" render={({ field }) => (
                  <FormItem><FormLabel>{t("extDetail.sipAuthId")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={sipForm.control} name="clientId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("extensions.ipbx")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select an IPBX" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="none">{t("extDetail.ipbxOption")}</SelectItem>
                        {clients?.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={sipForm.control} name="sipPassword" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>{t("extDetail.sipPassword")}</FormLabel>
                    <FormControl><PasswordInput placeholder={t("extDetail.enterNewPwd")} {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="ghost" onClick={() => setEditSipOpen(false)}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={updateExtension.isPending}>
                  {updateExtension.isPending ? t("common.saving") : t("clientDetail.saveChanges")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
