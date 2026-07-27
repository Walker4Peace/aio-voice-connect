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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { ArrowLeft, Phone, Server, Play, Square, RotateCcw, Loader2, AlertCircle, Bot, Edit, Trash2, ShieldCheck } from "lucide-react";
import { ProviderBadge } from "@/components/provider-badge";
import { useToast } from "@/hooks/use-toast";
import { maskString } from "@/lib/utils";
import {
  useDeployStatus, useStartExtension, useStopExtension, useRestartExtension,
  useWatchdogState, useSetWatchdog, statusColor,
} from "@/hooks/use-deploy";

const agentSchema = z.object({ agentConfigId: z.string() });

const sipSchema = z.object({
  extensionNumber: z.string().min(1),
  sipUsername: z.string().min(1),
  sipAuthId: z.string().min(1),
  sipPassword: z.string().min(1),
  clientId: z.string(),
});

export default function ExtensionDetail() {
  const { id } = useParams();
  const extensionId = Number(id);
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [editSipOpen, setEditSipOpen] = React.useState(false);

  const { data: extension, isLoading } = useGetExtension(extensionId, {
    query: { enabled: !!extensionId, queryKey: getGetExtensionQueryKey(extensionId) }
  });

  const { data: agentConfigs } = useListAgentConfigs();
  const { data: clients } = useListClients();
  const updateExtension = useUpdateExtension();

  const { data: deployStatus, isLoading: statusLoading } = useDeployStatus(extensionId, !!extensionId);
  const [, navigate] = useLocation();
  const deleteExtension = useDeleteExtension();

  const start = useStartExtension(extensionId);
  const stop = useStopExtension(extensionId);
  const restart = useRestartExtension(extensionId);
  const { data: watchdog } = useWatchdogState(extensionId, !!extensionId);
  const setWatchdog = useSetWatchdog(extensionId);

  const isRunning = deployStatus?.status === "registered" || deployStatus?.status === "starting" || deployStatus?.status === "reconnecting";
  const isStarting = deployStatus?.status === "starting";
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
    if (extension) {
      agentForm.reset({ agentConfigId: extension.agentConfigId ? extension.agentConfigId.toString() : "none" });
    }
  }, [extension, agentForm]);

  React.useEffect(() => {
    if (editSipOpen && extension) {
      sipForm.reset({
        extensionNumber: extension.extensionNumber,
        sipUsername: extension.sipUsername,
        sipAuthId: extension.sipAuthId,
        sipPassword: extension.sipPassword,
        clientId: extension.clientId ? extension.clientId.toString() : "none",
      });
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
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetExtensionQueryKey(extensionId) });
          toast({ title: t("extDetail.agentUpdated") });
        },
        onError: () => toast({ variant: "destructive", title: t("extDetail.agentUpdateFailed") }),
      }
    );
  };

  const handleSipSave = (values: z.infer<typeof sipSchema>) => {
    if (!extension) return;
    updateExtension.mutate(
      { id: extensionId, data: { extensionNumber: values.extensionNumber, sipUsername: values.sipUsername, sipAuthId: values.sipAuthId, sipPassword: values.sipPassword, clientId: values.clientId === "none" ? null : Number(values.clientId), agentConfigId: extension.agentConfigId ?? null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetExtensionQueryKey(extensionId) });
          setEditSipOpen(false);
          toast({ title: t("extDetail.sipUpdated") });
        },
        onError: () => toast({ variant: "destructive", title: t("extDetail.sipUpdateFailed") }),
      }
    );
  };

  if (isLoading) return <div className="p-8 animate-pulse text-muted-foreground">{t("extDetail.loading")}</div>;
  if (!extension) return <div className="p-8 text-destructive">{t("extDetail.notFound")}</div>;

  const hasAgentConfig = !!extension.agentConfig;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/extensions">
            <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Extension {extension.extensionNumber}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{extension.displayName || t("extDetail.noDisplayName")}</p>
          </div>
        </div>
        {!statusLoading && deployStatus && (
          <Badge variant="outline" className={`text-sm px-3 py-1 font-semibold ${statusColor(deployStatus.status)}`}>
            {t(`deploy.status.${deployStatus.status}`)}
          </Badge>
        )}
      </div>

      {/* ── LIVE DEPLOYMENT PANEL ── */}
      <Card className={`border-l-4 ${isReconnecting ? "border-l-orange-500" : isRunning ? "border-l-green-500" : deployStatus?.status === "error" ? "border-l-red-500" : "border-l-muted"}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Server className="h-5 w-5" />
                {t("extDetail.sipAgentTitle")}
              </CardTitle>
              <CardDescription>
                {hasAgentConfig ? t("extDetail.deployDesc") : t("extDetail.assignFirst")}
              </CardDescription>
            </div>
            {deployStatus?.uptimeSeconds != null && (
              <div className="text-right text-xs text-muted-foreground">
                <p>{t("extDetail.uptime")} {Math.floor(deployStatus.uptimeSeconds / 60)}m {deployStatus.uptimeSeconds % 60}s</p>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {deployStatus?.lastError && deployStatus.status !== "registered" && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="font-mono text-xs break-all">{deployStatus.lastError}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!isRunning ? (
              <Button
                className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                disabled={!hasAgentConfig || start.isPending}
                onClick={() => handleAction(start, "deploy.deploy")}
              >
                {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {start.isPending ? t("deploy.deploying") : t("deploy.deploy")}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline" className="gap-2 border-red-300 text-red-600 hover:bg-red-50"
                  disabled={stop.isPending}
                  onClick={() => handleAction(stop, "deploy.stop")}
                >
                  {stop.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  {t("deploy.stop")}
                </Button>
                <Button
                  variant="outline" className="gap-2"
                  disabled={restart.isPending}
                  onClick={() => handleAction(restart, "deploy.restart")}
                >
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
          <div className="mt-2 pt-3 border-t flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className={`h-4 w-4 ${watchdog?.enabled ? "text-green-500" : "text-muted-foreground"}`} />
              <div>
                <p className="text-sm font-medium">{t("extDetail.watchdogLabel")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("extDetail.watchdogDesc")}
                  {watchdog?.pinging && (
                    <span className="ml-1 inline-flex items-center gap-1 text-yellow-600">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> {t("extDetail.pinging")}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant={watchdog?.enabled ? "default" : "outline"}
              className={watchdog?.enabled ? "bg-green-600 hover:bg-green-700 text-white shrink-0" : "shrink-0"}
              disabled={setWatchdog.isPending}
              onClick={() => setWatchdog.mutate(!watchdog?.enabled, {
                onSuccess: () => toast({ title: watchdog?.enabled ? t("extDetail.watchdogDisabled") : t("extDetail.watchdogEnabled") }),
                onError: (e) => toast({ variant: "destructive", title: t("extDetail.watchdogFailed"), description: e.message }),
              })}
            >
              {watchdog?.enabled ? t("extDetail.watchdogOn") : t("extDetail.watchdogOff")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* SIP Credentials */}
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Phone className="h-4 w-4" /> {t("extDetail.sipCredentials")}</CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2 h-8" onClick={() => setEditSipOpen(true)}>
                <Edit className="h-3.5 w-3.5" /> {t("extDetail.edit")}
              </Button>
              <Button
                variant="outline" size="sm"
                className="gap-2 h-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => {
                  if (!window.confirm(t("extDetail.removeConfirm", { number: extension.extensionNumber }))) return;
                  deleteExtension.mutate({ id: extensionId }, {
                    onSuccess: () => {
                      toast({ title: t("extDetail.removed") });
                      navigate("/extensions");
                    },
                    onError: () => toast({ variant: "destructive", title: t("extDetail.removeFailed") }),
                  });
                }}
                disabled={deleteExtension.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" /> {t("extDetail.remove")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {[
                [t("extDetail.extNumber"),   extension.extensionNumber],
                [t("extDetail.sipUsername"),  extension.sipUsername],
                [t("extDetail.sipAuthId"),    extension.sipAuthId],
                [t("extDetail.sipPassword"),  maskString(extension.sipPassword)],
                [t("extDetail.sipDomain"),    extension.client?.sipDomain || t("extDetail.sipDomainHint")],
                [t("extDetail.sipServer"),    extension.client?.sipServer || t("extDetail.sipServerHint")],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground font-medium shrink-0">{label}</dt>
                  <dd className="font-mono text-xs text-right truncate max-w-[200px]">{value}</dd>
                </div>
              ))}
            </dl>
            {extension.client && (
              <div className="mt-3 pt-3 border-t">
                <Link href={`/ipbxs/${extension.clientId}`} className="text-xs text-primary hover:underline">
                  ↗ {extension.client.name}
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Agent Assignment */}
        <Card className="border-l-4 border-l-purple-500">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Bot className="h-4 w-4" /> {t("extDetail.aiAgent")}</CardTitle>
              {extension.agentConfig && <ProviderBadge provider={extension.agentConfig.provider} />}
            </div>
          </CardHeader>
          <CardContent>
            <Form {...agentForm}>
              <form onSubmit={agentForm.handleSubmit(handleAgentSave)} className="space-y-4">
                <FormField
                  control={agentForm.control} name="agentConfigId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("extDetail.assignedAgent")}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t("extDetail.selectAgent")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("extDetail.noAgentOption")}</SelectItem>
                          {agentConfigs?.map((a) => (
                            <SelectItem key={a.id} value={a.id.toString()}>
                              {a.name} ({a.provider})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {extension.agentConfig && (
                  <>
                    <Separator />
                    <dl className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><dt className="text-muted-foreground">{t("extDetail.name")}</dt><dd>{extension.agentConfig.name}</dd></div>
                      <div className="flex justify-between"><dt className="text-muted-foreground">{t("extDetail.apiKey")}</dt><dd className="font-mono text-xs">{maskString(extension.agentConfig.apiKey)}</dd></div>
                      {extension.agentConfig.modelId && <div className="flex justify-between"><dt className="text-muted-foreground">{t("extDetail.model")}</dt><dd className="text-xs">{extension.agentConfig.modelId}</dd></div>}
                      {extension.agentConfig.voiceId && <div className="flex justify-between"><dt className="text-muted-foreground">{t("extDetail.voice")}</dt><dd className="text-xs">{extension.agentConfig.voiceId}</dd></div>}
                    </dl>
                    <div className="flex justify-end">
                      <Link href={`/agent-configs/${extension.agentConfig.id}/edit`}>
                        <Button variant="ghost" size="sm" type="button">{t("extDetail.editAgent")}</Button>
                      </Link>
                    </div>
                  </>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  {!extension.agentConfig && (
                    <Link href="/agent-configs/new">
                      <Button variant="outline" size="sm" type="button">{t("extDetail.createNewAgent")}</Button>
                    </Link>
                  )}
                  <Button size="sm" type="submit" disabled={updateExtension.isPending}>
                    {updateExtension.isPending ? t("extDetail.savingAgent") : t("common.save")}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* Edit SIP Credentials Dialog */}
      <Dialog open={editSipOpen} onOpenChange={setEditSipOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("extDetail.editSipTitle")}</DialogTitle>
          </DialogHeader>
          <Form {...sipForm}>
            <form onSubmit={sipForm.handleSubmit(handleSipSave)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={sipForm.control} name="extensionNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("extDetail.extNumber")}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={sipForm.control} name="sipUsername" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("extDetail.sipUsername")}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={sipForm.control} name="sipAuthId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("extDetail.sipAuthId")}</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={sipForm.control} name="clientId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("extensions.ipbx")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select an IPBX" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">{t("extDetail.ipbxOption")}</SelectItem>
                        {clients?.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
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
