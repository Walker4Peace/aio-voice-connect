import React from "react";
import { Link } from "wouter";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { Plus, Building, Trash2 } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  description: z.string().optional(),
  sipDomain: z.string().optional(),
  sipHost: z.string().optional(),
  sipPort: z.string().optional(),
});

export default function ClientsList() {
  const { data: clients, isLoading } = useListClients();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);

  const createClient = useCreateClient();
  const deleteClient = useDeleteClient();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      sipDomain: "",
      sipHost: "",
      sipPort: "5060",
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const sipServer = values.sipHost ? `${values.sipHost}:${values.sipPort || "5060"}` : "";
    createClient.mutate(
      { data: { name: values.name, description: values.description, sipDomain: values.sipDomain, sipServer } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          setOpen(false);
          form.reset();
          toast({
            title: "IPBX created",
            description: "The IPBX has been added successfully.",
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to create IPBX.",
          });
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    if (!window.confirm("Are you sure you want to delete this IPBX?")) return;
    
    deleteClient.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({
            title: "IPBX deleted",
            description: "The IPBX has been removed.",
          });
        },
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">IPBXs</h1>
          <p className="text-muted-foreground mt-1">Manage your Yeastar IPBX systems and their SIP credentials.</p>
        </div>
        
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> Add IPBX
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New IPBX</DialogTitle>
              <DialogDescription>
                Register a Yeastar IPBX and configure its SIP connection details.
              </DialogDescription>
            </DialogHeader>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>IPBX Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Office IPBX" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sipDomain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SIP Domain</FormLabel>
                      <FormControl>
                        <Input placeholder="pbx.example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2">
                  <FormField
                    control={form.control}
                    name="sipHost"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>SIP Server</FormLabel>
                        <FormControl>
                          <Input placeholder="pbx.example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sipPort"
                    render={({ field }) => (
                      <FormItem className="w-24">
                        <FormLabel>Port</FormLabel>
                        <FormControl>
                          <Input placeholder="5060" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Details about this IPBX..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={createClient.isPending}>
                    {createClient.isPending ? "Creating..." : "Create IPBX"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>IPBX Name</TableHead>
              <TableHead>SIP Server</TableHead>
              <TableHead>Port</TableHead>
              <TableHead className="w-[100px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                  Loading IPBXs...
                </TableCell>
              </TableRow>
            ) : !clients || clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center h-48 text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Building className="h-8 w-8 text-muted-foreground/50" />
                    <p>No IPBXs found.</p>
                    <Button variant="link" onClick={() => setOpen(true)}>Add your first IPBX</Button>
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
                  <TableCell className="font-mono text-xs">{client.sipServer || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {client.sipServer
                      ? (client.sipServer.includes(":") ? client.sipServer.split(":").pop() : "5060")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(client.id)}
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
    </div>
  );
}
