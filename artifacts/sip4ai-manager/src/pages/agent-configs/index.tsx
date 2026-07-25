import React from "react";
import { Link } from "wouter";
import { 
  useListAgentConfigs,
  useDeleteAgentConfig,
  getListAgentConfigsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { ProviderBadge } from "@/components/provider-badge";
import { Plus, Server, Trash2 } from "lucide-react";

export default function AgentConfigsList() {
  const { data: configs, isLoading } = useListAgentConfigs();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteConfig = useDeleteAgentConfig();

  const handleDelete = (id: number) => {
    if (!window.confirm("Are you sure you want to delete this agent configuration?")) return;
    
    deleteConfig.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentConfigsQueryKey() });
          toast({
            title: "Agent deleted",
            description: "The AI agent configuration has been removed.",
          });
        },
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Agents</h1>
          <p className="text-muted-foreground mt-1">Reusable AI agent configurations you can assign to any extension.</p>
        </div>
        
        <Link href="/agent-configs/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> New Agent
          </Button>
        </Link>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent Name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Model / Voice</TableHead>
              <TableHead>Language</TableHead>
              <TableHead className="w-[100px]">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                  Loading agents...
                </TableCell>
              </TableRow>
            ) : !configs || configs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-48 text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Server className="h-8 w-8 text-muted-foreground/50" />
                    <p>No agents configured yet.</p>
                    <Link href="/agent-configs/new">
                      <Button variant="link">Create your first AI agent</Button>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              configs.map((config) => (
                <TableRow key={config.id}>
                  <TableCell className="font-medium">
                    <Link href={`/agent-configs/${config.id}/edit`} className="hover:underline text-primary">
                      {config.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ProviderBadge provider={config.provider} />
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-col gap-1">
                      {config.modelId && <span className="font-medium">{config.modelId}</span>}
                      {config.voiceId && <span className="text-muted-foreground truncate max-w-[150px]">{config.voiceId}</span>}
                      {!config.modelId && !config.voiceId && <span className="text-muted-foreground italic">Defaults</span>}
                    </div>
                  </TableCell>
                  <TableCell>{config.language || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(config.id)}
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
