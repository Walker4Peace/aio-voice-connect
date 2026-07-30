import React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useListExtensions,
  useDeleteExtension,
  useListClients,
  useListAgentConfigs,
  useCreateExtension,
  getListExtensionsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { ProviderBadge } from "@/components/provider-badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Users, Trash2, Search, Phone, Server, MoreHorizontal, X } from "lucide-react";
import { useAllDeployStatuses } from "@/hooks/use-deploy";

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const formSchema = z.object({
  clientId: z.string().optional(),
  agentConfigId: z.string().optional(),
  extensionNumber: z.string().min(1),
  displayName: z.string().optional(),
  sipUsername: z.string().min(1),
  sipAuthId: z.string().min(1),
  sipPassword: z.string().min(1),
});

export default function ExtensionsList() {
  const { t } = useTranslation();
  const { data: extensions, isLoading } = useListExtensions();
  const { data: clients } = useListClients();
  const { data: agentConfigs } = useListAgentConfigs();
  const { data: allStatuses } = useAllDeployStatuses();

  const statusMap = React.useMemo(() => {
    const m = new Map<number, { status: string; lastStartedAt?: string | null; sipRegistered?: boolean }>();
    for (const s of allStatuses ?? []) m.set(s.extensionId, s);
    return m;
  }, [allStatuses]);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  // Filters
  const [search, setSearch] = React.useState("");
  const [filterClientId, setFilterClientId] = React.useState("all");
  const [filterStatus, setFilterStatus] = React.useState("all");
  const [filterAgentId, setFilterAgentId] = React.useState("all");

  const createExtension = useCreateExtension();
  const deleteExtension = useDeleteExtension();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { clientId: "none", agentConfigId: "none", extensionNumber: "", displayName: "", sipUsername: "", sipAuthId: "", sipPassword: "" },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const data = {
      ...values,
      clientId: values.clientId === "none" ? null : Number(values.clientId),
      agentConfigId: values.agentConfigId === "none" ? null : Number(values.agentConfigId),
    };
    createExtension.mutate(
      { data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListExtensionsQueryKey() });
          setOpen(false);
          form.reset();
          toast({ title: t("extensions.created"), description: t("extensions.createdDesc") });
        },
        onError: () => toast({ variant: "destructive", title: t("common.error"), description: t("extensions.createError") }),
      }
    );
  };

  const confirmDelete = () => {
    if (deletingId === null) return;
    deleteExtension.mutate(
      { id: deletingId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListExtensionsQueryKey() });
          toast({ title: t("extensions.deleted"), description: t("extensions.deletedDesc") });
        },
        onSettled: () => setDeletingId(null),
      }
    );
  };

  const hasFilters = search || filterClientId !== "all" || filterStatus !== "all" || filterAgentId !== "all";

  const filtered = React.useMemo(() => {
    if (!extensions) return [];
    return extensions.filter(ext => {
      if (search && !ext.extensionNumber.includes(search) && !(ext.displayName ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      if (filterClientId !== "all" && ext.clientId !== Number(filterClientId)) return false;
      if (filterStatus !== "all") {
        const s = statusMap.get(ext.id);
        const st = s?.status ?? "stopped";
        if (filterStatus === "running" && st !== "registered" && st !== "starting" && st !== "reconnecting") return false;
        if (filterStatus === "stopped" && (st === "registered" || st === "starting" || st === "reconnecting")) return false;
        if (filterStatus === "error" && st !== "error") return false;
      }
      if (filterAgentId !== "all" && ext.agentConfigId !== Number(filterAgentId)) return false;
      return true;
    });
  }, [extensions, search, filterClientId, filterStatus, filterAgentId, statusMap]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("extensions.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("extensions.description")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" /> {t("extensions.addExt")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("extensions.dialogTitle")}</DialogTitle>
              <DialogDescription>{t("extensions.dialogDesc")}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="clientId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("extensions.ipbx")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select an IPBX" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("extensions.noIPBX")}</SelectItem>
                          {clients?.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="agentConfigId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("extensions.aiAgent")}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select an agent" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">{t("extensions.noAgentOption")}</SelectItem>
                          {agentConfigs?.map((a) => <SelectItem key={a.id} value={a.id.toString()}>{a.name} ({a.provider})</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="extensionNumber" render={({ field }) => (
                    <FormItem><FormLabel>{t("extensions.extNumber")}</FormLabel><FormControl><Input placeholder="1001" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="displayName" render={({ field }) => (
                    <FormItem><FormLabel>{t("extensions.displayName")}</FormLabel><FormControl><Input placeholder="Sales AI Agent" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="sipUsername" render={({ field }) => (
                    <FormItem><FormLabel>{t("extensions.sipUsername")}</FormLabel><FormControl><Input placeholder="1001" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="sipAuthId" render={({ field }) => (
                    <FormItem><FormLabel>{t("extensions.sipAuthId")}</FormLabel><FormControl><Input placeholder="Auth ID" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="sipPassword" render={({ field }) => (
                    <FormItem className="col-span-2"><FormLabel>{t("extensions.sipPassword")}</FormLabel><FormControl><PasswordInput placeholder="Secret password" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <p className="text-xs text-muted-foreground">{t("extensions.sipDomainNote")}</p>
                <div className="flex justify-end pt-4 border-t">
                  <Button type="submit" disabled={createExtension.isPending}>
                    {createExtension.isPending ? t("extensions.saving") : t("extensions.saveExt")}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Empty state */}
      {!isLoading && (!extensions || extensions.length === 0) ? (
        <div className="border-2 border-dashed rounded-xl bg-card">
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-50">
                <Phone className="h-8 w-8 text-blue-400" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="h-3 w-3" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-foreground text-base">{t("extensions.noExtensions")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("extensions.addFirstDesc")}</p>
            </div>
            <Button className="gap-2 mt-1" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> {t("extensions.addExt")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Search + filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("extensions.searchPlaceholder")}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <Select value={filterClientId} onValueChange={setFilterClientId}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue placeholder={t("extensions.allIPBXs")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("extensions.allIPBXs")}</SelectItem>
                {clients?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue placeholder={t("extensions.allStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("extensions.allStatuses")}</SelectItem>
                <SelectItem value="running">{t("extensions.running")}</SelectItem>
                <SelectItem value="stopped">{t("deploy.status.stopped")}</SelectItem>
                <SelectItem value="error">{t("common.error")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterAgentId} onValueChange={setFilterAgentId}>
              <SelectTrigger className="w-40 h-9">
                <SelectValue placeholder={t("extensions.allAgents")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("extensions.allAgents")}</SelectItem>
                {agentConfigs?.map(a => <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground"
                onClick={() => { setSearch(""); setFilterClientId("all"); setFilterStatus("all"); setFilterAgentId("all"); }}>
                <X className="h-3.5 w-3.5" /> {t("extensions.clearFilters")}
              </Button>
            )}
          </div>

          <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t("extensions.loading")}</div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{hasFilters ? t("extensions.noMatchFilters") : t("extensions.noExtensions")}</p>
              </div>
            ) : (
              <>
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-muted-foreground bg-muted/30 border-b">
                      <th className="text-left font-medium py-3 px-4">{t("extensions.thExt")}</th>
                      <th className="text-left font-medium py-3 px-4">{t("extensions.thName")}</th>
                      <th className="text-left font-medium py-3 px-4">{t("extensions.thIPBX")}</th>
                      <th className="text-left font-medium py-3 px-4">{t("extensions.thAgent")}</th>
                      <th className="text-left font-medium py-3 px-4">{t("extensions.thStatus")}</th>
                      <th className="text-left font-medium py-3 px-4">{t("extensions.thLastActivity")}</th>
                      <th className="text-left font-medium py-3 px-4">{t("extensions.thCreatedOn")}</th>
                      <th className="text-right font-medium py-3 px-4">{t("extensions.thAction")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((ext) => {
                      const s = statusMap.get(ext.id);
                      const st = (s?.status ?? "stopped") as string;
                      const isRunning = st === "registered" || st === "starting" || st === "reconnecting";
                      const extWithDate = ext as typeof ext & { createdAt?: string };

                      return (
                        <tr key={ext.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-mono font-semibold text-sm">{ext.extensionNumber}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-sm text-foreground font-medium">
                            {ext.displayName || "—"}
                          </td>
                          <td className="py-3.5 px-4">
                            {ext.client ? (
                              <div className="flex items-center gap-2">
                                <Server className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                                <div>
                                  <span className="text-sm font-medium text-foreground">{ext.client.name}</span>
                                  {ext.client.sipServer && (
                                    <p className="text-[11px] text-muted-foreground font-mono">
                                      {ext.client.sipServer.includes(":") ? ext.client.sipServer.split(":").slice(0, -1).join(":") : ext.client.sipServer}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic text-sm">{t("extensions.unassigned")}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {ext.agentConfig ? (
                              <div className="flex items-center gap-2">
                                <ProviderBadge provider={ext.agentConfig.provider} />
                                <span className="text-xs text-muted-foreground">{ext.agentConfig.name}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic text-xs">{t("extensions.noAgent")}</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {ext.agentConfig?.mode === "outbound" ? (
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-orange-400" />
                                  <span className="text-xs font-medium text-orange-600">{t("extensions.outboundBadge")}</span>
                                </div>
                                <p className="text-[11px] text-muted-foreground pl-3 mt-0.5">{t("extensions.outboundBadgeDesc")}</p>
                              </div>
                            ) : (
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isRunning ? "bg-green-500" : "bg-gray-300"}`} />
                                  <span className={`text-xs font-medium ${isRunning ? "text-green-700" : "text-muted-foreground"}`}>
                                    {isRunning ? t("deploy.status.registered") : t("deploy.status.stopped")}
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground pl-3 mt-0.5">
                                  {isRunning ? t("extensions.running") : t("extensions.notRunning")}
                                </p>
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-muted-foreground">
                            {isRunning && s?.lastStartedAt ? timeAgo(s.lastStartedAt) : "—"}
                          </td>
                          <td className="py-3.5 px-4 text-xs text-muted-foreground">
                            {extWithDate.createdAt ? new Date(extWithDate.createdAt).toLocaleDateString() : "—"}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex justify-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem asChild>
                                    <Link href={`/extensions/${ext.id}`} className="flex items-center gap-2 cursor-pointer">
                                      {t("extensions.viewDetails")}
                                    </Link>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive flex items-center gap-2 cursor-pointer"
                                    onClick={() => setDeletingId(ext.id)}
                                  >
                                    <Trash2 className="h-4 w-4" /> {t("extensions.deleteExt")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-4 py-3 border-t text-xs text-muted-foreground">
                  {t("extensions.showing", { count: filtered.length, total: extensions?.length ?? 0 })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      <AlertDialog open={deletingId !== null} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("extensions.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("extensions.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmDelete}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
