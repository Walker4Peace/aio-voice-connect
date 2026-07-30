import React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useListClients,
  useCreateClient,
  useDeleteClient,
  useListExtensions,
  getListClientsQueryKey
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Server, Trash2, FlaskConical, Loader2, CheckCircle, XCircle, MoreHorizontal, RefreshCw, Eye, Users } from "lucide-react";

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

const formSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  sipDomain: z.string().optional(),
  sipHost: z.string().optional(),
  sipPort: z.string().optional(),
  yeastarApiUrl: z.string().optional(),
  yeastarClientId: z.string().optional(),
  yeastarClientSecret: z.string().optional(),
});

type TestStatus = "idle" | "testing" | "success" | "error";

function parseSipServer(sipServer: string | null | undefined) {
  if (!sipServer) return { sipHost: "", sipPort: "5060" };
  const lastColon = sipServer.lastIndexOf(":");
  if (lastColon === -1) return { sipHost: sipServer, sipPort: "5060" };
  return { sipHost: sipServer.slice(0, lastColon), sipPort: sipServer.slice(lastColon + 1) || "5060" };
}

export default function ClientsList() {
  const { t } = useTranslation();
  const { data: clients, isLoading } = useListClients();
  const { data: allExtensions } = useListExtensions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const [testStatus, setTestStatus] = React.useState<TestStatus>("idle");
  const [testError, setTestError] = React.useState<string>("");

  const [page, setPage] = React.useState(1);
  const PAGE_SIZE = 10;

  const createClient = useCreateClient();
  const deleteClient = useDeleteClient();

  const total = clients?.length ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pagedClients = (clients ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showingText = total <= PAGE_SIZE
    ? t("clients.showing", { count: total, total })
    : t("clients.showingRange", { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, total), total });

  // Count extensions per client
  const extCountMap = React.useMemo(() => {
    const m = new Map<number, number>();
    for (const e of allExtensions ?? []) {
      if (e.clientId) m.set(e.clientId, (m.get(e.clientId) ?? 0) + 1);
    }
    return m;
  }, [allExtensions]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", sipDomain: "", sipHost: "", sipPort: "5060", yeastarApiUrl: "", yeastarClientId: "", yeastarClientSecret: "" },
  });

  const handleTestConnection = async () => {
    const values = form.getValues();
    const pbxUrl = values.yeastarApiUrl?.trim();
    const clientId = values.yeastarClientId?.trim();
    const clientSecret = values.yeastarClientSecret?.trim();
    if (!pbxUrl || !clientId || !clientSecret) {
      toast({ variant: "destructive", title: t("clients.yeastarTestMissing") });
      return;
    }
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch(`${API_BASE}/clients/yeastar/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pbxUrl, clientId, clientSecret }),
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

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const sipServer = values.sipHost ? `${values.sipHost}:${values.sipPort || "5060"}` : "";
    createClient.mutate(
      { data: { name: values.name, description: values.description, sipDomain: values.sipDomain, sipServer, yeastarApiUrl: values.yeastarApiUrl || null, yeastarClientId: values.yeastarClientId || null, yeastarClientSecret: values.yeastarClientSecret || null } as Parameters<typeof createClient.mutate>[0]["data"] },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setOpen(false);
          form.reset();
          setTestStatus("idle");
          setTestError("");
          toast({ title: t("clients.created"), description: t("clients.createdDesc") });
        },
        onError: () => toast({ variant: "destructive", title: t("common.error"), description: t("clients.createError") }),
      }
    );
  };

  const confirmDelete = () => {
    if (deletingId === null) return;
    deleteClient.mutate(
      { id: deletingId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({ title: t("clients.deleted"), description: t("clients.deletedDesc") });
        },
        onSettled: () => setDeletingId(null),
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("clients.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("clients.description")}</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setTestStatus("idle"); setTestError(""); } }}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="h-4 w-4" /> {t("clients.addIPBX")}</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] flex flex-col sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("clients.dialogTitle")}</DialogTitle>
              <DialogDescription>{t("clients.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto flex-1 pl-1 pr-4">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem><FormLabel>{t("clients.ipbxName")}</FormLabel><FormControl><Input placeholder="Office IPBX" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="sipDomain" render={({ field }) => (
                    <FormItem><FormLabel>{t("clients.sipDomain")}</FormLabel><FormControl><Input placeholder="pbx.example.com" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="flex gap-2">
                    <FormField control={form.control} name="sipHost" render={({ field }) => (
                      <FormItem className="flex-1"><FormLabel>{t("clients.sipServer")}</FormLabel><FormControl><Input placeholder="pbx.example.com" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="sipPort" render={({ field }) => (
                      <FormItem className="w-24"><FormLabel>{t("clients.port")}</FormLabel><FormControl><Input placeholder="5060" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="yeastarApiUrl" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("clients.yeastarApiUrl")}</FormLabel>
                      <FormControl><Input placeholder="https://192.168.11.90:8088" {...field} onChange={e => { field.onChange(e); setTestStatus("idle"); }} /></FormControl>
                      <p className="text-xs text-muted-foreground">{t("clients.yeastarApiHint")}</p>
                      <FormMessage />
                    </FormItem>
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
                    {testStatus === "success" && (
                      <div className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle className="h-3.5 w-3.5 shrink-0" />{t("clients.yeastarTestSuccess")}</div>
                    )}
                    {testStatus === "error" && (
                      <div className="flex items-start gap-1.5 text-xs text-destructive"><XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span className="break-all">{testError || t("clients.yeastarTestFailed")}</span></div>
                    )}
                  </div>
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem><FormLabel>{t("clients.notes")}</FormLabel><FormControl><Textarea placeholder="Details about this IPBX..." {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={createClient.isPending}>
                      {createClient.isPending ? t("clients.creating") : t("clients.createIPBX")}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table / Empty state */}
      {!isLoading && (!clients || clients.length === 0) ? (
        <div className="border-2 border-dashed rounded-xl bg-card">
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-50">
                <Server className="h-8 w-8 text-blue-400" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="h-3 w-3" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-foreground text-base">{t("clients.noIPBX")}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("clients.addFirstDesc")}</p>
            </div>
            <Button className="gap-2 mt-1" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> {t("clients.addIPBX")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t("clients.loading")}</div>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-muted-foreground bg-muted/30 border-b">
                    <th className="text-left font-medium py-3 px-4">{t("clients.thIPBX")}</th>
                    <th className="text-left font-medium py-3 px-4">{t("clients.thSipServer")}</th>
                    <th className="text-left font-medium py-3 px-4">{t("clients.thSipPort")}</th>
                    <th className="text-left font-medium py-3 px-4">{t("clients.thApiStatus")}</th>
                    <th className="text-left font-medium py-3 px-4">{t("clients.thExtensions")}</th>
                    <th className="text-left font-medium py-3 px-4">{t("clients.thLastSynced")}</th>
                    <th className="text-right font-medium py-3 px-4">{t("clients.thActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedClients.map((client) => {
                    const { sipHost, sipPort } = parseSipServer(client.sipServer);
                    const c = client as typeof client & { yeastarApiUrl?: string | null; yeastarVerified?: boolean | null; createdAt?: string; updatedAt?: string };
                    const extCount = extCountMap.get(client.id) ?? 0;
                    const apiConnected = c.yeastarApiUrl && c.yeastarVerified === true;
                    const apiConfigured = c.yeastarApiUrl && c.yeastarVerified !== false;

                    return (
                      <tr key={client.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 shrink-0">
                              <Server className="h-4 w-4 text-blue-500" />
                            </div>
                            <span className="font-semibold text-sm text-foreground">{client.name}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-muted-foreground">
                          {sipHost || "—"}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">{sipPort || "—"}</span>
                            {sipPort && (
                              <span className="text-[10px] font-medium text-muted-foreground bg-muted border rounded px-1.5 py-0.5">UDP</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          {c.yeastarApiUrl ? (
                            <div className="flex flex-col gap-0.5">
                              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${apiConnected ? "text-green-700" : "text-muted-foreground"}`}>
                                <span className={`h-1.5 w-1.5 rounded-full inline-block ${apiConnected ? "bg-green-500" : "bg-gray-400"}`} />
                                {apiConnected ? t("clients.apiConnected") : apiConfigured ? t("clients.apiConfigured") : t("clients.apiNotTested")}
                              </span>
                              {apiConnected && <span className="text-[11px] text-muted-foreground pl-3">{t("clients.apiVerified")}</span>}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">{t("clients.apiNoApi")}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm text-foreground">{extCount}</span>
                            <span className="text-xs text-muted-foreground">{t("clients.thExtensions")}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-muted-foreground">
                          {c.updatedAt ? (
                              <div>
                                <p className="text-xs text-foreground">{new Date(c.updatedAt).toLocaleString()}</p>
                                <p className="text-[11px] text-muted-foreground">{timeAgo(c.updatedAt)}</p>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-end gap-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/ipbxs/${client.id}`} className="flex items-center gap-2 cursor-pointer">
                                    <Eye className="h-4 w-4" /> {t("clients.viewDetails")}
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                  <Link href={`/ipbxs/${client.id}`} className="flex items-center gap-2 cursor-pointer">
                                    <RefreshCw className="h-4 w-4" /> {t("clients.testApiConn")}
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive flex items-center gap-2 cursor-pointer"
                                  onClick={() => setDeletingId(client.id)}
                                >
                                  <Trash2 className="h-4 w-4" /> {t("clients.deleteIPBX")}
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
              <div className="grid grid-cols-3 items-center px-4 py-3 border-t">
                <span className="text-xs text-muted-foreground">{showingText}</span>
                <div className="flex items-center justify-center gap-1">
                  {totalPages > 1 && Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <Button
                      key={p}
                      variant={p === page ? "default" : "outline"}
                      size="sm"
                      className="h-8 w-8 p-0 text-xs"
                      onClick={() => { setPage(p); document.querySelector('main')?.scrollTo({ top: 0, behavior: "smooth" }); }}
                    >
                      {p}
                    </Button>
                  ))}
                </div>
                <div />
              </div>
            </>
          )}
        </div>
      )}

      <AlertDialog open={deletingId !== null} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clients.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("clients.deleteDesc")}</AlertDialogDescription>
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
