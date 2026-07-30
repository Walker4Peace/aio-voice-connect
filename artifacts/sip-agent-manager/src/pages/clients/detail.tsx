import React from "react";
import { Link, useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetClient, useUpdateClient, useDeleteClient,
  useListExtensions, useUpdateExtension,
  getListExtensionsQueryKey, getListClientsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  ArrowLeft, Phone, Edit, Save, X, Link2, Trash2, FlaskConical, CheckCircle,
  XCircle, Loader2, Server, Globe, Network, Settings, Calendar, FileText,
  CircleCheck, ExternalLink, Users, Info,
} from "lucide-react";
import { ProviderBadge } from "@/components/provider-badge";
import { formatDate } from "@/lib/utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

const editSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  sipDomain: z.string().optional(),
  sipHost: z.string().optional(),
  sipPort: z.string().min(1),
  yeastarApiUrl: z.string().optional(),
  yeastarClientId: z.string().optional(),
  yeastarClientSecret: z.string().optional(),
});

function parseSipServer(sipServer: string | null | undefined): { sipHost: string; sipPort: string } {
  if (!sipServer) return { sipHost: "", sipPort: "5060" };
  const lastColon = sipServer.lastIndexOf(":");
  if (lastColon === -1) return { sipHost: sipServer, sipPort: "5060" };
  return { sipHost: sipServer.slice(0, lastColon), sipPort: sipServer.slice(lastColon + 1) || "5060" };
}

type TestStatus = "idle" | "testing" | "success" | "error";

function FieldRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted shrink-0 mt-0.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground font-medium mb-0.5">{label}</p>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const clientId = Number(id);
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [selectedExtIds, setSelectedExtIds] = React.useState<number[]>([]);
  const [linking, setLinking] = React.useState(false);
  const [testStatus, setTestStatus] = React.useState<TestStatus>("idle");
  const [testError, setTestError] = React.useState<string>("");
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  const { data: client, isLoading: isLoadingClient } = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: ['client', clientId] }
  });
  const { data: extensions, isLoading: isLoadingExtensions } = useListExtensions(
    { clientId },
    { query: { enabled: !!clientId, queryKey: getListExtensionsQueryKey({ clientId }) } }
  );
  const { data: allExtensions } = useListExtensions({}, { query: { queryKey: getListExtensionsQueryKey({}) } });

  const availableExtensions = React.useMemo(() => {
    if (!allExtensions) return [];
    return allExtensions.filter(e => !e.clientId || e.clientId === clientId);
  }, [allExtensions, clientId]);

  const linkedExtIds = React.useMemo(() => new Set((extensions ?? []).map(e => e.id)), [extensions]);

  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const updateExtension = useUpdateExtension();
  const [, navigate] = useLocation();

  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: "", description: "", sipDomain: "", sipHost: "", sipPort: "5060", yeastarApiUrl: "", yeastarClientId: "", yeastarClientSecret: "" },
  });

  type ClientWithYeastar = typeof client & {
    yeastarApiUrl?: string | null;
    yeastarClientId?: string | null;
    yeastarClientSecret?: string | null;
    yeastarVerified?: boolean | null;
    yeastarLastChecked?: string | null;
  };

  React.useEffect(() => {
    if (client) {
      const c = client as ClientWithYeastar;
      const { sipHost, sipPort } = parseSipServer(client.sipServer);
      form.reset({
        name: client.name, description: client.description ?? "", sipDomain: client.sipDomain ?? "",
        sipHost, sipPort, yeastarApiUrl: c.yeastarApiUrl ?? "",
        yeastarClientId: c.yeastarClientId ?? "", yeastarClientSecret: c.yeastarClientSecret ?? "",
      });
    }
  }, [client, form]);

  React.useEffect(() => {
    if (linkDialogOpen) setSelectedExtIds(Array.from(linkedExtIds) as number[]);
  }, [linkDialogOpen, linkedExtIds]);

  const onSave = (values: z.infer<typeof editSchema>) => {
    const sipServer = values.sipHost ? `${values.sipHost}:${values.sipPort || "5060"}` : "";
    updateClient.mutate(
      { id: clientId, data: { name: values.name, description: values.description, sipDomain: values.sipDomain, sipServer, yeastarApiUrl: values.yeastarApiUrl || null, yeastarClientId: values.yeastarClientId || null, yeastarClientSecret: values.yeastarClientSecret || null } as Parameters<typeof updateClient.mutate>[0]["data"] },
      {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['client', clientId] }); setEditing(false); setTestStatus("idle"); toast({ title: t("clientDetail.updated") }); },
        onError: () => toast({ variant: "destructive", title: t("common.error"), description: t("clientDetail.updateError") }),
      }
    );
  };

  const handleTestConnection = async () => {
    const values = form.getValues();
    const pbxUrl = values.yeastarApiUrl?.trim();
    const clientIdVal = values.yeastarClientId?.trim();
    const clientSecret = values.yeastarClientSecret?.trim();
    if (!pbxUrl || !clientIdVal || !clientSecret) { toast({ variant: "destructive", title: t("clients.yeastarTestMissing") }); return; }
    setTestStatus("testing"); setTestError("");
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/yeastar/test`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pbxUrl, clientId: clientIdVal, clientSecret }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) { setTestStatus("success"); toast({ title: t("clients.yeastarTestSuccess") }); }
      else { setTestStatus("error"); setTestError(data.error ?? t("clients.yeastarTestFailed")); }
    } catch (err) { setTestStatus("error"); setTestError((err as Error).message); }
  };

  const confirmDelete = () => {
    deleteClient.mutate(
      { id: clientId },
      {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); toast({ title: t("clientDetail.deleted") }); navigate("/ipbxs"); },
        onError: () => toast({ variant: "destructive", title: t("clientDetail.deleteError") }),
      }
    );
  };

  const handleLinkExtensions = async () => {
    if (!allExtensions) return;
    setLinking(true);
    try {
      const toLink = selectedExtIds.filter(eid => !linkedExtIds.has(eid));
      const toUnlink = Array.from(linkedExtIds).filter(eid => !selectedExtIds.includes(eid));
      const updates = [
        ...toLink.map(eid => { const ext = allExtensions.find(e => e.id === eid); if (!ext) return null; return updateExtension.mutateAsync({ id: eid, data: { extensionNumber: ext.extensionNumber, sipUsername: ext.sipUsername, sipAuthId: ext.sipAuthId, sipPassword: ext.sipPassword, clientId: clientId, agentConfigId: ext.agentConfigId ?? null } }); }),
        ...toUnlink.map(eid => { const ext = allExtensions.find(e => e.id === eid); if (!ext) return null; return updateExtension.mutateAsync({ id: eid, data: { extensionNumber: ext.extensionNumber, sipUsername: ext.sipUsername, sipAuthId: ext.sipAuthId, sipPassword: ext.sipPassword, clientId: null, agentConfigId: ext.agentConfigId ?? null } }); }),
      ].filter(Boolean);
      await Promise.all(updates);
      queryClient.invalidateQueries({ queryKey: getListExtensionsQueryKey({ clientId }) });
      queryClient.invalidateQueries({ queryKey: getListExtensionsQueryKey({}) });
      setLinkDialogOpen(false);
      toast({ title: t("clientDetail.extUpdated") });
    } catch {
      toast({ variant: "destructive", title: t("common.error"), description: t("clientDetail.extError") });
    } finally { setLinking(false); }
  };

  const toggleExt = (eid: number) => setSelectedExtIds(prev => prev.includes(eid) ? prev.filter(x => x !== eid) : [...prev, eid]);

  if (isLoadingClient) return <div className="p-8 animate-pulse text-muted-foreground">{t("clientDetail.loading")}</div>;
  if (!client) return <div className="p-8 text-destructive">{t("clientDetail.notFound")}</div>;

  const c = client as ClientWithYeastar;
  const hasYeastarConfig = !!(c.yeastarApiUrl && c.yeastarClientId && c.yeastarClientSecret);
  const { sipHost, sipPort } = parseSipServer(client.sipServer);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/ipbxs">
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
          <p className="text-muted-foreground text-sm font-mono mt-0.5">
            {sipHost || client.sipDomain || t("clientDetail.noSipDomain")}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: IPBX Details */}
        <div className="lg:col-span-2 bg-card border rounded-xl shadow-sm border-l-4 border-l-primary overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <h2 className="font-semibold text-sm">{t("clientDetail.cardTitle")}</h2>
            {!editing ? (
              <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => setEditing(true)}>
                <Edit className="h-3.5 w-3.5" /> {t("clientDetail.edit")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => { setEditing(false); setTestStatus("idle"); }}>
                <X className="h-3.5 w-3.5" /> {t("clientDetail.cancel")}
              </Button>
            )}
          </div>

          <div className="px-5 py-2">
            {editing ? (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSave)} className="space-y-3 py-3">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem><FormLabel>{t("clients.ipbxName")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="sipDomain" render={({ field }) => (
                    <FormItem><FormLabel>{t("clients.sipDomain")}</FormLabel><FormControl><Input placeholder="pbx.example.com" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="grid grid-cols-[1fr_6rem] gap-2">
                    <FormField control={form.control} name="sipHost" render={({ field }) => (
                      <FormItem><FormLabel>{t("clients.sipServer")}</FormLabel><FormControl><Input placeholder="pbx.example.com" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="sipPort" render={({ field }) => (
                      <FormItem><FormLabel>{t("clients.port")}</FormLabel><FormControl><Input inputMode="numeric" placeholder="5060" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem><FormLabel>{t("clients.notes")}</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="pt-2 border-t space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("clients.yeastarSection")}</p>
                    <FormField control={form.control} name="yeastarApiUrl" render={({ field }) => (
                      <FormItem><FormLabel>{t("clients.yeastarApiUrl")}</FormLabel><FormControl><Input placeholder="https://192.168.11.90:8088" {...field} onChange={e => { field.onChange(e); setTestStatus("idle"); }} /></FormControl><p className="text-xs text-muted-foreground">{t("clients.yeastarApiHint")}</p><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="yeastarClientId" render={({ field }) => (
                      <FormItem><FormLabel>{t("clients.yeastarClientId")}</FormLabel><FormControl><Input placeholder="STasWojiy…" {...field} onChange={e => { field.onChange(e); setTestStatus("idle"); }} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="yeastarClientSecret" render={({ field }) => (
                      <FormItem><FormLabel>{t("clients.yeastarClientSecret")}</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} onChange={e => { field.onChange(e); setTestStatus("idle"); }} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <div className="space-y-1.5">
                      <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={handleTestConnection} disabled={testStatus === "testing"}>
                        {testStatus === "testing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                        {t("clients.yeastarTest")}
                      </Button>
                      {testStatus === "success" && <div className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle className="h-3.5 w-3.5 shrink-0" />{t("clients.yeastarTestSuccess")}</div>}
                      {testStatus === "error" && <div className="flex items-start gap-1.5 text-xs text-destructive"><XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="break-all">{testError || t("clients.yeastarTestFailed")}</span></div>}
                    </div>
                  </div>
                  <Button type="submit" size="sm" className="w-full gap-2 mt-2" disabled={updateClient.isPending}>
                    <Save className="h-4 w-4" />
                    {updateClient.isPending ? t("clientDetail.saving") : t("clientDetail.saveChanges")}
                  </Button>
                </form>
              </Form>
            ) : (
              <div>
                <FieldRow icon={Server} label={t("clientDetail.fieldIPBXName")}>
                  <span className="font-medium">{client.name}</span>
                </FieldRow>
                <FieldRow icon={Globe} label={t("clientDetail.fieldIPDomain")}>
                  <span className="font-mono">{client.sipDomain || sipHost || "—"}</span>
                </FieldRow>
                <FieldRow icon={Network} label={t("clientDetail.fieldSipServer")}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{sipHost || "—"}</span>
                    {sipPort && (
                      <span className="text-muted-foreground text-xs">
                        Port <span className="font-mono">{sipPort}</span> <span className="bg-muted border rounded px-1 py-0.5 text-[10px] font-medium">UDP</span>
                      </span>
                    )}
                  </div>
                </FieldRow>
                <FieldRow icon={Settings} label={t("clientDetail.fieldApiConfig")}>
                  {hasYeastarConfig ? (
                    <div className="space-y-1">
                      <p className="font-mono text-xs break-all">{c.yeastarApiUrl}</p>
                      <div className="flex items-center gap-1.5 text-xs text-green-600">
                        <CheckCircle className="h-3 w-3" /> {t("clientDetail.oauthConfigured")}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic text-sm">{t("clientDetail.notConfigured")}</span>
                  )}
                </FieldRow>
                <FieldRow icon={CircleCheck} label={t("clientDetail.fieldApiStatus")}>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      {c.yeastarVerified === true ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5">
                          <span className="h-1.5 w-1.5 bg-green-500 rounded-full" /> {t("clientDetail.apiConnected")}
                        </span>
                      ) : c.yeastarVerified === false ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5">
                          <span className="h-1.5 w-1.5 bg-red-500 rounded-full" /> {t("clientDetail.apiError")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("clientDetail.apiNotTested")}</span>
                      )}
                      {hasYeastarConfig && (
                        <Button variant="outline" size="sm" className="h-6 px-2 text-xs gap-1" onClick={handleTestConnection} disabled={testStatus === "testing"}>
                          {testStatus === "testing" ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                          {t("clientDetail.testConnection")}
                        </Button>
                      )}
                    </div>
                    {testStatus === "success" && <p className="text-xs text-green-600">{t("clientDetail.lastChecked")}</p>}
                    {testStatus === "error" && <p className="text-xs text-destructive break-all">{testError}</p>}
                  </div>
                </FieldRow>
                <FieldRow icon={FileText} label={t("clientDetail.fieldNotes")}>
                  <span className={client.description ? "" : "text-muted-foreground"}>{client.description || "—"}</span>
                </FieldRow>

                <div className="py-4">
                  <Button
                    variant="outline" size="sm" className="w-full gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" /> {t("clientDetail.removeIPBX")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Extensions */}
        <div className="lg:col-span-3 bg-card border rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">{t("clientDetail.extOnIPBX")}</h2>
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-2 text-xs" onClick={() => setLinkDialogOpen(true)}>
              <Link2 className="h-3.5 w-3.5" /> {t("clientDetail.linkExtension")}
            </Button>
          </div>
          <div className="p-5">
            {isLoadingExtensions ? (
              <div className="py-4 text-center text-sm text-muted-foreground">{t("clientDetail.loadingExt")}</div>
            ) : !extensions || extensions.length === 0 ? (
              <div className="py-8 text-center border border-dashed rounded-lg flex flex-col items-center gap-2">
                <Phone className="h-6 w-6 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{t("clientDetail.noExtensions")}</p>
                <Button variant="link" size="sm" onClick={() => setLinkDialogOpen(true)}>{t("clientDetail.linkAnExt")}</Button>
              </div>
            ) : (
              <>
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left font-medium py-2 px-3">{t("clientDetail.thExt")}</th>
                      <th className="text-left font-medium py-2 px-3">{t("clientDetail.thName")}</th>
                      <th className="text-left font-medium py-2 px-3">{t("clientDetail.thAgent")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extensions.map((ext) => (
                      <tr key={ext.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="py-2.5 px-3">
                          <span className="font-mono font-semibold text-foreground text-sm">
                            {ext.extensionNumber}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-sm">{ext.displayName || "—"}</td>
                        <td className="py-2.5 px-3">
                          {ext.agentConfig ? (
                            <div className="flex items-center gap-2">
                              <ProviderBadge provider={ext.agentConfig.provider} />
                              <span className="text-xs text-muted-foreground">{ext.agentConfig.name}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic text-xs">{t("clientDetail.noAgent")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex justify-end">
                  <Link href="/extensions">
                    <Button variant="ghost" size="sm" className="text-primary text-xs gap-1 hover:text-primary">
                      {t("clientDetail.viewAllExt")} <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clientDetail.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("clientDetail.deleteDescModal")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Link Extensions Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-start gap-4 p-6 pb-4 shrink-0">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted shrink-0 text-3xl">
              🔗
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-semibold leading-tight">{t("clientDetail.dialogTitle", { name: client.name })}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{t("clientDetail.dialogDesc")}</p>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 space-y-3 pb-2">
            {availableExtensions.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">{t("clientDetail.noAvailable")}</p>
                <p className="text-xs mt-1">{t("clientDetail.noAvailNote")}</p>
              </div>
            ) : (
              availableExtensions.map(ext => {
                const isLinked = ext.clientId === clientId;
                const isSelected = selectedExtIds.includes(ext.id);
                return (
                  <div
                    key={ext.id}
                    className="flex items-center gap-4 rounded-xl border bg-card p-4"
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleExt(ext.id)}
                      onClick={e => e.stopPropagation()}
                      className="h-5 w-5 shrink-0"
                    />
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted shrink-0">
                      <Users className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base">{ext.extensionNumber}</span>
                        {ext.displayName && <span className="text-sm text-muted-foreground">{ext.displayName}</span>}
                      </div>
                      {ext.agentConfig && <div className="mt-1"><ProviderBadge provider={ext.agentConfig.provider} /></div>}
                    </div>
                    {isLinked && (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-3 py-1 shrink-0">
                        <span className="h-1.5 w-1.5 bg-green-500 rounded-full" />
                        {t("clientDetail.linked")}
                      </span>
                    )}
                  </div>
                );
              })
            )}

            {/* Note */}
            <div className="flex items-start gap-3 rounded-xl bg-blue-50/60 border border-blue-100 p-4">
              <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-700">{t("clientDetail.noteTitle")}</p>
                <p className="text-xs text-blue-600 mt-0.5">{t("clientDetail.noteDesc")}</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t shrink-0">
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleLinkExtensions} disabled={linking || availableExtensions.length === 0} className="px-8">
              {linking ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
