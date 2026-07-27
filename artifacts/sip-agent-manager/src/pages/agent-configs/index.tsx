import React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { 
  useListAgentConfigs,
  useDeleteAgentConfig,
  getListAgentConfigsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProviderBadge } from "@/components/provider-badge";
import { Plus, Bot, Trash2 } from "lucide-react";

export default function AgentConfigsList() {
  const { t } = useTranslation();
  const { data: configs, isLoading } = useListAgentConfigs();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  const deleteConfig = useDeleteAgentConfig();

  const confirmDelete = () => {
    if (deletingId === null) return;
    deleteConfig.mutate(
      { id: deletingId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentConfigsQueryKey() });
          toast({ title: t("agents.deleted"), description: t("agents.deletedDesc") });
        },
        onSettled: () => setDeletingId(null),
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("agents.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("agents.description")}</p>
        </div>
        
        <Link href="/agent-configs/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> {t("agents.newAgent")}
          </Button>
        </Link>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("agents.thName")}</TableHead>
              <TableHead>{t("agents.thProvider")}</TableHead>
              <TableHead>{t("agents.thAgentId")}</TableHead>
              <TableHead>{t("agents.thLanguage")}</TableHead>
              <TableHead className="w-[100px]">{t("agents.thAction")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                  {t("agents.loading")}
                </TableCell>
              </TableRow>
            ) : !configs || configs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-48 text-muted-foreground">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Bot className="h-8 w-8 text-muted-foreground/50" />
                    <p>{t("agents.noAgents")}</p>
                    <Link href="/agent-configs/new">
                      <Button variant="link">{t("agents.createFirst")}</Button>
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
                      {!config.modelId && !config.voiceId && <span className="text-muted-foreground italic">{t("agents.defaults")}</span>}
                    </div>
                  </TableCell>
                  <TableCell>{config.language || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <Button 
                        variant="ghost" size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeletingId(config.id)}
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
            <AlertDialogTitle>{t("agents.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("agents.deleteDesc")}</AlertDialogDescription>
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
