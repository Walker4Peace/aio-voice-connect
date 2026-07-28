import React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { 
  useListClients, 
  useCreateClient, 
  useDeleteClient,
  getListClientsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Server, Trash2, FlaskConical, Loader2, CheckCircle, XCircle } from "lucide-react";

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

export default function ClientsList() {
  const { t } = useTranslation();
  const { data: clients, isLoading } = useListClients();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const [testStatus, setTestStatus] = React.useState<TestStatus>("idle");
  const [testError, setTestError] = React.useState<string>("");

  const createClient = useCreateClient();
  const deleteClient = useDeleteClient();

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
        onError: () => {
          toast({ variant: "destructive", title: t("common.error"), description: t("clients.createError") });
        },
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("clients.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("clients.description")}</p>
        </div>
        
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setTestStatus("idle"); setTestError(""); } }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> {t("clients.addIPBX")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>{t("clients.dialogTitle")}</DialogTitle>
              <DialogDescription>{t("clients.dialogDescription")}</DialogDescription>
            </DialogHeader>
            
            <div className="overflow-y-auto flex-1 px-1">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("clients.ipbxName")}</FormLabel>
                    <FormControl><Input placeholder="Office IPBX" {...field} /></FormControl>
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

                <div className="flex gap-2">
                  <FormField control={form.control} name="sipHost" render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>{t("clients.sipServer")}</FormLabel>
                      <FormControl><Input placeholder="pbx.example.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="sipPort" render={({ field }) => (
                    <FormItem className="w-24">
                      <FormLabel>{t("clients.port")}</FormLabel>
                      <FormControl><Input placeholder="5060" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
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
                  <FormItem>
                    <FormLabel>{t("clients.yeastarClientId")}</FormLabel>
                    <FormControl><Input placeholder="STasWojiy…" {...field} onChange={e => { field.onChange(e); setTestStatus("idle"); }} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="yeastarClientSecret" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("clients.yeastarClientSecret")}</FormLabel>
                    <FormControl><Input type="password" placeholder="••••••••" {...field} onChange={e => { field.onChange(e); setTestStatus("idle"); }} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Test connection button */}
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

                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("clients.notes")}</FormLabel>
                    <FormControl><Textarea placeholder="Details about this IPBX..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
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

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("clients.thName")}</TableHead>
              <TableHead>{t("clients.thSipServer")}</TableHead>
              <TableHead>{t("clients.thPort")}</TableHead>
              <TableHead className="w-[100px]">{t("clients.thAction")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                  {t("clients.loading")}
                </TableCell>
              </TableRow>
            ) : !clients || clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center h-48 text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Server className="h-8 w-8 text-muted-foreground/50" />
                    <p>{t("clients.noIPBXs")}</p>
                    <Button variant="link" onClick={() => setOpen(true)}>{t("clients.addFirst")}</Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">
                    <Link href={`/ipbxs/${client.id}`} className="hover:underline flex items-center gap-2">
                      {client.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {client.sipServer
                      ? (client.sipServer.includes(":") ? client.sipServer.split(":").slice(0, -1).join(":") : client.sipServer)
                      : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {client.sipServer
                      ? (client.sipServer.includes(":") ? client.sipServer.split(":").pop() : "5060")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button 
                        variant="ghost" size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeletingId(client.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={deletingId !== null} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clients.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("clients.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
