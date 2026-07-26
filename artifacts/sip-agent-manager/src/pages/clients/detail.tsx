import React from "react";
import { Link, useParams, useLocation } from "wouter";
import { 
  useGetClient,
  useUpdateClient,
  useDeleteClient,
  useListExtensions,
  useUpdateExtension,
  getListExtensionsQueryKey,
  getListClientsQueryKey
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ArrowLeft, Phone, Edit, Save, X, Plus, Link2, Trash2 } from "lucide-react";
import { ProviderBadge } from "@/components/provider-badge";
import { formatDate } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const editSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  description: z.string().optional(),
  sipDomain: z.string().optional(),
  sipHost: z.string().optional(),
  sipPort: z.string().min(1, "Port is required."),
});

function parseSipServer(sipServer: string | null | undefined): { sipHost: string; sipPort: string } {
  if (!sipServer) return { sipHost: "", sipPort: "5060" };
  const lastColon = sipServer.lastIndexOf(":");
  if (lastColon === -1) return { sipHost: sipServer, sipPort: "5060" };
  return { sipHost: sipServer.slice(0, lastColon), sipPort: sipServer.slice(lastColon + 1) || "5060" };
}

export default function ClientDetail() {
  const { id } = useParams();
  const clientId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [selectedExtIds, setSelectedExtIds] = React.useState<number[]>([]);
  const [linking, setLinking] = React.useState(false);

  const { data: client, isLoading: isLoadingClient } = useGetClient(clientId, { 
    query: { enabled: !!clientId, queryKey: ['client', clientId] } 
  });
  
  // Extensions already linked to this IPBX
  const { data: extensions, isLoading: isLoadingExtensions } = useListExtensions(
    { clientId }, 
    { query: { enabled: !!clientId, queryKey: getListExtensionsQueryKey({ clientId }) } }
  );

  // All extensions (to find unlinked ones for the modal)
  const { data: allExtensions } = useListExtensions(
    {},
    { query: { queryKey: getListExtensionsQueryKey({}) } }
  );

  // Extensions not yet linked to any IPBX or linked to this one
  const availableExtensions = React.useMemo(() => {
    if (!allExtensions) return [];
    return allExtensions.filter(e => !e.clientId || e.clientId === clientId);
  }, [allExtensions, clientId]);

  // Already linked extension IDs
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
    defaultValues: { name: "", description: "", sipDomain: "", sipHost: "", sipPort: "5060" },
  });

  React.useEffect(() => {
    if (client) {
      const { sipHost, sipPort } = parseSipServer(client.sipServer);
      form.reset({
        name: client.name,
        description: client.description ?? "",
        sipDomain: client.sipDomain ?? "",
        sipHost,
        sipPort,
      });
    }
  }, [client, form]);

  // Pre-select already linked extensions when dialog opens
  React.useEffect(() => {
    if (linkDialogOpen) {
      setSelectedExtIds(Array.from(linkedExtIds) as number[]);
    }
  }, [linkDialogOpen, linkedExtIds]);

  const onSave = (values: z.infer<typeof editSchema>) => {
    const sipServer = values.sipHost ? `${values.sipHost}:${values.sipPort || "5060"}` : "";
    updateClient.mutate(
      { id: clientId, data: { name: values.name, description: values.description, sipDomain: values.sipDomain, sipServer } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['client', clientId] });
          setEditing(false);
          toast({ title: "IPBX updated" });
        },
        onError: () => toast({ variant: "destructive", title: "Error", description: "Failed to update IPBX." }),
      }
    );
  };

  const handleDelete = () => {
    if (!client || !window.confirm(`Delete "${client.name}"? This cannot be undone.`)) return;
    deleteClient.mutate(
      { id: clientId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({ title: "IPBX deleted" });
          navigate("/ipbxs");
        },
        onError: () => toast({ variant: "destructive", title: "Failed to delete IPBX" }),
      }
    );
  };

  const handleLinkExtensions = async () => {
    if (!allExtensions) return;
    setLinking(true);

    try {
      // Determine which to link and which to unlink
      const toLink = selectedExtIds.filter(eid => !linkedExtIds.has(eid));
      const toUnlink = Array.from(linkedExtIds).filter(eid => !selectedExtIds.includes(eid));

      const updates = [
        ...toLink.map(eid => {
          const ext = allExtensions.find(e => e.id === eid);
          if (!ext) return null;
          return updateExtension.mutateAsync({
            id: eid,
            data: {
              extensionNumber: ext.extensionNumber,
              sipUsername: ext.sipUsername,
              sipAuthId: ext.sipAuthId,
              sipPassword: ext.sipPassword,
              clientId: clientId,
              agentConfigId: ext.agentConfigId ?? null,
            }
          });
        }),
        ...toUnlink.map(eid => {
          const ext = allExtensions.find(e => e.id === eid);
          if (!ext) return null;
          return updateExtension.mutateAsync({
            id: eid,
            data: {
              extensionNumber: ext.extensionNumber,
              sipUsername: ext.sipUsername,
              sipAuthId: ext.sipAuthId,
              sipPassword: ext.sipPassword,
              clientId: null,
              agentConfigId: ext.agentConfigId ?? null,
            }
          });
        }),
      ].filter(Boolean);

      await Promise.all(updates);

      queryClient.invalidateQueries({ queryKey: getListExtensionsQueryKey({ clientId }) });
      queryClient.invalidateQueries({ queryKey: getListExtensionsQueryKey({}) });
      setLinkDialogOpen(false);
      toast({ title: "Extensions updated" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update extensions." });
    } finally {
      setLinking(false);
    }
  };

  const toggleExt = (eid: number) => {
    setSelectedExtIds(prev =>
      prev.includes(eid) ? prev.filter(x => x !== eid) : [...prev, eid]
    );
  };

  if (isLoadingClient) {
    return <div className="p-8 animate-pulse text-muted-foreground">Loading IPBX data...</div>;
  }

  if (!client) {
    return <div className="p-8 text-destructive">IPBX not found.</div>;
  }

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
          <p className="text-muted-foreground mt-1 text-sm font-mono">{client.sipDomain || 'No SIP domain configured'}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* IPBX Details Card — Edit button lives here */}
        <Card className="col-span-1 border-l-4 border-l-primary">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">IPBX Details</CardTitle>
            {!editing ? (
              <Button variant="outline" size="sm" className="gap-2 h-7 text-xs" onClick={() => setEditing(true)}>
                <Edit className="h-3.5 w-3.5" /> Edit
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="gap-2 h-7 text-xs" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {editing ? (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSave)} className="space-y-3">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>IPBX Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="sipDomain" render={({ field }) => (
                    <FormItem>
                      <FormLabel>SIP Domain</FormLabel>
                      <FormControl><Input placeholder="pbx.example.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-[1fr_6rem] gap-2">
                    <FormField control={form.control} name="sipHost" render={({ field }) => (
                      <FormItem>
                        <FormLabel>SIP Server</FormLabel>
                        <FormControl><Input placeholder="pbx.example.com" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="sipPort" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Port</FormLabel>
                        <FormControl><Input inputMode="numeric" placeholder="5060" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl><Textarea {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" size="sm" className="w-full gap-2" disabled={updateClient.isPending}>
                    <Save className="h-4 w-4" />
                    {updateClient.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </form>
              </Form>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">SIP Domain</div>
                  <div className="text-sm font-mono">{client.sipDomain || "—"}</div>
                </div>
                 <div className="grid grid-cols-2 gap-3">
                   <div>
                     <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">SIP Server</div>
                     <div className="text-sm font-mono">{parseSipServer(client.sipServer).sipHost || "—"}</div>
                   </div>
                   <div>
                     <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Port</div>
                     <div className="text-sm font-mono">{parseSipServer(client.sipServer).sipPort}</div>
                   </div>
                 </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes</div>
                  <div className="text-sm">{client.description || "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Added On</div>
                  <div className="text-sm">{formatDate(client.createdAt)}</div>
                </div>
                 <Button
                   variant="outline"
                   size="sm"
                   className="w-full gap-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                   onClick={handleDelete}
                 >
                   <Trash2 className="h-4 w-4" /> Remove IPBX
                 </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Extensions card */}
        <Card className="col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Extensions</CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2"
              onClick={() => setLinkDialogOpen(true)}
            >
              <Link2 className="h-3.5 w-3.5" /> Link Extension
            </Button>
          </CardHeader>
          <CardContent>
            {isLoadingExtensions ? (
              <div className="py-4 text-center text-sm text-muted-foreground">Loading extensions...</div>
            ) : !extensions || extensions.length === 0 ? (
              <div className="py-8 text-center border border-dashed rounded-md flex flex-col items-center gap-2">
                <Phone className="h-6 w-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">No extensions configured for this IPBX.</p>
                <Button variant="link" size="sm" onClick={() => setLinkDialogOpen(true)}>
                  Link an extension
                </Button>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ext</TableHead>
                      <TableHead>Display Name</TableHead>
                      <TableHead>AI Agent</TableHead>
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
                            <span className="text-muted-foreground italic text-xs">No agent</span>
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
            <DialogTitle>Link Extensions to {client.name}</DialogTitle>
            <DialogDescription>
              Select extensions to link to this IPBX. An extension can only be linked to one IPBX.
            </DialogDescription>
          </DialogHeader>

          {availableExtensions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Phone className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No available extensions.</p>
              <p className="text-xs mt-1">Create extensions first from the Extensions page.</p>
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
                        <Badge variant="secondary" className="text-xs py-0">linked</Badge>
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
            <Button variant="ghost" onClick={() => setLinkDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleLinkExtensions} disabled={linking || availableExtensions.length === 0}>
              {linking ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
