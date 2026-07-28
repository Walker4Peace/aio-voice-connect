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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { ArrowLeft, Phone, Edit, Save, X, Link2, Trash2, FlaskConical, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { ProviderBadge } from "@/components/provider-badge";
import { formatDate } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

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

  const { data: client, isLoading: isLoadingClient } = useGetClient(clientId, { 
    query: { enabled: !!clientId, queryKey: ['client', clientId] } 
  });
  
  const { data: extensions, isLoading: isLoadingExtensions } = useListExtensions(
    { clientId }, 
    { query: { enabled: !!clientId, queryKey: getListExtensionsQueryKey({ clientId }) } }
  );

  const { data: allExtensions } = useListExtensions(
    {},
    { query: { queryKey: getListExtensionsQueryKey({}) } }
  );

  const availableExtensions = React.useMemo(() => {
    if (!allExtensions) return [];
    return allExtensions.filter(e => !e.clientId || e.clientId === clientId);
  }, [allExtensions, clientId]);

  const linkedExtIds = React.useMemo(
    () => new Set((extensions ?? []).map(e => e.id)),
    [extensions]
  );

  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const updateExtension = useUpdateExtension();
  const [, navigate] = useLocation();

  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: "", description: "", sipDomain: "", sipHost: "", sipPort: "5060",
      yeastarApiUrl: "", yeastarClientId: "", yeastarClientSecret: "",
    },
  });

  type ClientWithYeastar = typeof client & {
    yeastarApiUrl?: string | null;
    yeastarClientId?: string | null;
    yeastarClientSecret?: string | null;
    yeastarVerified?: boolean | null;
  };

  React.useEffect(() => {
    if (client) {
      const c = client as ClientWithYeastar;
      const { sipHost, sipPort } = parseSipServer(client.sipServer);
      form.reset({
        name: client.name,
        description: client.description ?? "",
        sipDomain: client.sipDomain ?? "",
        sipHost,
        sipPort,
        yeastarApiUrl: c.yeastarApiUrl ?? "",
        yeastarClientId: c.yeastarClientId ?? "",
        yeastarClientSecret: c.yeastarClientSecret ?? "",
      });
    }
  }, [client, form]);

  React.useEffect(() => {
    if (linkDialogOpen) {
      setSelectedExtIds(Array.from(linkedExtIds) as number[]);
    }
  }, [linkDialogOpen, linkedExtIds]);

  const onSave = (values: z.infer<typeof editSchema>) => {
    const sipServer = values.sipHost ? `${values.sipHost}:${values.sipPort || "5060"}` : "";
    updateClient.mutate(
      { id: clientId, data: {
        name: values.name,
        description: values.description,
        sipDomain: values.sipDomain,
        sipServer,
        yeastarApiUrl: values.yeastarApiUrl || null,
        yeastarClientId: values.yeastarClientId || null,
        yeastarClientSecret: values.yeastarClientSecret || null,
      } as Parameters<typeof updateClient.mutate>[0]["data"] },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['client', clientId] });
          setEditing(false);
          setTestStatus("idle");
          toast({ title: t("clientDetail.updated") });
        },
        onError: () => toast({ variant: "destructive", title: t("common.error"), description: t("clientDetail.updateError") }),
      }
    );
  };

  const handleTestConnection = async () => {
    const values = form.getValues();
    const pbxUrl = values.yeastarApiUrl?.trim();
    const clientIdVal = values.yeastarClientId?.trim();
    const clientSecret = values.yeastarClientSecret?.trim();

    if (!pbxUrl || !clientIdVal || !clientSecret) {
      toast({ variant: "destructive", title: t("clients.yeastarTestMissing") });
      return;
    }
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch(`${API_BASE}/clients/${clientId}/yeastar/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pbxUrl, clientId: clientIdVal, clientSecret }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        setTestStatus("success");
        toast({ title: t("clients.yeastarTestSuccess") });
      } else {
        setTestStatus("error");
        setTestError(data.error ?? t("clients.yeastarTestFailed"));
      }
    } catch (err) {
      setTestStatus("error");
      setTestError((err as Error).message);
    }
  };

  const handleDelete = () => {
    if (!client || !window.confirm(t("clientDetail.deleteConfirm", { name: client.name }))) return;
    deleteClient.mutate(
      { id: clientId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({ title: t("clientDetail.deleted") });
          navigate("/ipbxs");
        },
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
        ...toLink.map(eid => {
          const ext = allExtensions.find(e => e.id === eid);
          if (!ext) return null;
          return updateExtension.mutateAsync({ id: eid, data: { extensionNumber: ext.extensionNumber, sipUsername: ext.sipUsername, sipAuthId: ext.sipAuthId, sipPassword: ext.sipPassword, clientId: clientId, agentConfigId: ext.agentConfigId ?? null } });
        }),
        ...toUnlink.map(eid => {
          const ext = allExtensions.find(e => e.id === eid);
          if (!ext) return null;
          return updateExtension.mutateAsync({ id: eid, data: { extensionNumber: ext.extensionNumber, sipUsername: ext.sipUsername, sipAuthId: ext.sipAuthId, sipPassword: ext.sipPassword, clientId: null, agentConfigId: ext.agentConfigId ?? null } });
        }),
      ].filter(Boolean);

      await Promise.all(updates);
      queryClient.invalidateQueries({ queryKey: getListExtensionsQueryKey({ clientId }) });
      queryClient.invalidateQueries({ queryKey: getListExtensionsQueryKey({}) });
      setLinkDialogOpen(false);
      toast({ title: t("clientDetail.extUpdated") });
    } catch {
      toast({ variant: "destructive", title: t("common.error"), description: t("clientDetail.extError") });
    } finally {
      setLinking(false);
    }
  };

  const toggleExt = (eid: number) => {
    setSelectedExtIds(prev => prev.includes(eid) ? prev.filter(x => x !== eid) : [...prev, eid]);
  };

  if (isLoadingClient) {
    return <div className="p-8 animate-pulse text-muted-foreground">{t("clientDetail.loading")}</div>;
  }

  if (!client) {
    return <div className="p-8 text-destructive">{t("clientDetail.notFound")}</div>;
  }

  const c = client as ClientWithYeastar;
  const hasYeastarConfig = !!(c.yeastarApiUrl && c.yeastarClientId && c.yeastarClientSecret);
  // yeastarVerified: true = test passed (green), false = test failed (red), null = not tested yet

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/ipbxs">
          <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{client.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm font-mono">
            {client.sipDomain || t("clientDetail.noSipDomain")}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* IPBX Details Card */}
        <Card className="col-span-1 border-l-4 border-l-primary">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("clientDetail.cardTitle")}</CardTitle>
            {!editing ? (
              <Button variant="outline" size="sm" className="gap-2 h-7 text-xs" onClick={() => setEditing(true)}>
                <Edit className="h-3.5 w-3.5" /> {t("clientDetail.edit")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="gap-2 h-7 text-xs" onClick={() => { setEditing(false); setTestStatus("idle"); }}>
                <X className="h-3.5 w-3.5" /> {t("clientDetail.cancel")}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {editing ? (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSave)} className="space-y-3">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("clients.ipbxName")}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="sipDomain" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("clients.sipDomain")}</FormLabel>
                      <FormControl><Input placeholder="pbx.example.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-[1fr_6rem] gap-2">
                    <FormField control={form.control} name="sipHost" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("clients.sipServer")}</FormLabel>
                        <FormControl><Input placeholder="pbx.example.com" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="sipPort" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("clients.port")}</FormLabel>
                        <FormControl><Input inputMode="numeric" placeholder="5060" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("clients.notes")}</FormLabel>
                      <FormControl><Textarea {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  {/* Yeastar API section */}
                  <div className="pt-2 border-t space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("clients.yeastarSection")}
                    </p>
                    <FormField control={form.control} name="yeastarApiUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("clients.yeastarApiUrl")}</FormLabel>
                        <FormControl>
                          <Input placeholder="https://192.168.11.90:8088" {...field} onChange={e => { field.onChange(e); setTestStatus("idle"); }} />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">{t("clients.yeastarApiHint")}</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="yeastarClientId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("clients.yeastarClientId")}</FormLabel>
                        <FormControl>
                          <Input placeholder="STasWojiy…" {...field} onChange={e => { field.onChange(e); setTestStatus("idle"); }} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="yeastarClientSecret" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("clients.yeastarClientSecret")}</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} onChange={e => { field.onChange(e); setTestStatus("idle"); }} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    {/* Test connection button + status */}
                    <div className="space-y-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full gap-2"
                        onClick={handleTestConnection}
                        disabled={testStatus === "testing"}
                      >
                        {testStatus === "testing" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FlaskConical className="h-3.5 w-3.5" />
                        )}
                        {t("clients.yeastarTest")}
                      </Button>
                      {testStatus === "success" && (
                        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                          <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                          {t("clients.yeastarTestSuccess")}
                        </div>
                      )}
                      {testStatus === "error" && (
                        <div className="flex items-start gap-1.5 text-xs text-destructive">
                          <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span className="break-all">{testError || t("clients.yeastarTestFailed")}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <Button type="submit" size="sm" className="w-full gap-2 mt-2" disabled={updateClient.isPending}>
                    <Save className="h-4 w-4" />
                    {updateClient.isPending ? t("clientDetail.saving") : t("clientDetail.saveChanges")}
                  </Button>
                </form>
              </Form>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("clients.sipDomain")}</div>
                  <div className="text-sm font-mono">{client.sipDomain || "—"}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("clients.sipServer")}</div>
                    <div className="text-sm font-mono">{parseSipServer(client.sipServer).sipHost || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("clients.port")}</div>
                    <div className="text-sm font-mono">{parseSipServer(client.sipServer).sipPort}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("clients.notes")}</div>
                  <div className="text-sm">{client.description || "—"}</div>
                </div>

                {/* Yeastar API status */}
                <div className="pt-2 border-t">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{t("clients.yeastarSection")}</div>
                  {hasYeastarConfig ? (
                    <div className="space-y-1">
                      <div className="text-sm font-mono truncate">{c.yeastarApiUrl}</div>
                      {c.yeastarVerified === true && (
                        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                          <CheckCircle className="h-3 w-3" /> {t("clients.yeastarConfigured")}
                        </div>
                      )}
                      {c.yeastarVerified === false && (
                        <div className="flex items-center gap-1.5 text-xs text-destructive">
                          <XCircle className="h-3 w-3" /> {t("clients.yeastarNotVerified")}
                        </div>
                      )}
                      {c.yeastarVerified == null && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle className="h-3 w-3 opacity-40" /> {t("clients.yeastarConfigured")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">{t("clients.yeastarNotConfigured")}</div>
                  )}
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Added On</div>
                  <div className="text-sm">{formatDate(client.createdAt)}</div>
                </div>
                <Button
                  variant="outline" size="sm"
                  className="w-full gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-4 w-4" /> {t("clientDetail.removeIPBX")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Extensions card */}
        <Card className="col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("clientDetail.extensions")}</CardTitle>
            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={() => setLinkDialogOpen(true)}>
              <Link2 className="h-3.5 w-3.5" /> {t("clientDetail.linkExtension")}
            </Button>
          </CardHeader>
          <CardContent>
            {isLoadingExtensions ? (
              <div className="py-4 text-center text-sm text-muted-foreground">{t("clientDetail.loadingExt")}</div>
            ) : !extensions || extensions.length === 0 ? (
              <div className="py-8 text-center border border-dashed rounded-md flex flex-col items-center gap-2">
                <Phone className="h-6 w-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">{t("clientDetail.noExtensions")}</p>
                <Button variant="link" size="sm" onClick={() => setLinkDialogOpen(true)}>
                  {t("clientDetail.linkAnExt")}
                </Button>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("clientDetail.thExt")}</TableHead>
                      <TableHead>{t("clientDetail.thName")}</TableHead>
                      <TableHead>{t("clientDetail.thAgent")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extensions.map((ext) => (
                      <TableRow key={ext.id}>
                        <TableCell className="font-mono font-medium">
                          <Link href={`/extensions/${ext.id}`} className="hover:underline text-primary">
                            {ext.extensionNumber}
                          </Link>
                        </TableCell>
                        <TableCell>{ext.displayName || "—"}</TableCell>
                        <TableCell>
                          {ext.agentConfig ? (
                            <div className="flex items-center gap-2">
                              <ProviderBadge provider={ext.agentConfig.provider} />
                              <span className="text-xs text-muted-foreground">{ext.agentConfig.name}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic text-xs">{t("clientDetail.noAgent")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Link Extensions Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("clientDetail.dialogTitle", { name: client.name })}</DialogTitle>
            <DialogDescription>{t("clientDetail.dialogDesc")}</DialogDescription>
          </DialogHeader>

          {availableExtensions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Phone className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">{t("clientDetail.noAvailable")}</p>
              <p className="text-xs mt-1">{t("clientDetail.noAvailNote")}</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {availableExtensions.map(ext => (
                <div
                  key={ext.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => toggleExt(ext.id)}
                >
                  <Checkbox
                    checked={selectedExtIds.includes(ext.id)}
                    onCheckedChange={() => toggleExt(ext.id)}
                    onClick={e => e.stopPropagation()}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{ext.extensionNumber}</span>
                      {ext.displayName && <span className="text-xs text-muted-foreground">{ext.displayName}</span>}
                      {ext.clientId === clientId && (
                        <Badge variant="secondary" className="text-xs py-0">{t("clientDetail.linked")}</Badge>
                      )}
                    </div>
                    {ext.agentConfig && (
                      <div className="mt-0.5">
                        <ProviderBadge provider={ext.agentConfig.provider} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="ghost" onClick={() => setLinkDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleLinkExtensions} disabled={linking || availableExtensions.length === 0}>
              {linking ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
