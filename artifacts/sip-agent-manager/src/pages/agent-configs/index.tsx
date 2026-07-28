import React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useListAgentConfigs,
  useDeleteAgentConfig,
  useCreateAgentConfig,
  getListAgentConfigsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProviderBadge } from "@/components/provider-badge";
import { Plus, Bot, Trash2, MoreHorizontal, Pencil, Copy, Check } from "lucide-react";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="p-0.5 rounded hover:bg-muted text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      title={value}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export default function AgentConfigsList() {
  const { t } = useTranslation();
  const { data: configs, isLoading } = useListAgentConfigs();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  const deleteConfig = useDeleteAgentConfig();
  const createConfig = useCreateAgentConfig();

  const handleDuplicate = (config: NonNullable<typeof configs>[number]) => {
      createConfig.mutate(
        { data: { name: `${config.name} (copy)`, provider: config.provider, apiKey: config.apiKey, modelId: config.modelId ?? undefined, voiceId: config.voiceId ?? undefined, language: config.language ?? undefined, systemPrompt: config.systemPrompt ?? undefined } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListAgentConfigsQueryKey() });
            toast({ title: "Agent duplicated", description: `"${config.name} (copy)" created.` });
          },
          onError: () => toast({ variant: "destructive", title: t("common.error"), description: "Failed to duplicate agent." }),
        }
      );
    };

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("agents.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">Configure and manage AI voice agents for your extensions.</p>
        </div>
        <Link href="/agent-configs/new">
          <Button className="gap-2"><Plus className="h-4 w-4" /> {t("agents.newAgent")}</Button>
        </Link>
      </div>

      {/* Empty state */}
      {!isLoading && (!configs || configs.length === 0) ? (
        <div className="border-2 border-dashed rounded-xl bg-card">
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-purple-50">
                <Bot className="h-8 w-8 text-purple-400" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="h-3 w-3" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-foreground text-base">No AI agents configured</p>
              <p className="text-sm text-muted-foreground mt-1">Create your first AI agent to start assigning it to SIP extensions.</p>
            </div>
            <Link href="/agent-configs/new">
              <Button className="gap-2 mt-1"><Plus className="h-4 w-4" /> {t("agents.newAgent")}</Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t("agents.loading")}</div>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-muted-foreground bg-muted/30 border-b">
                    <th className="text-left font-medium py-3 px-4">{t("agents.thName")}</th>
                    <th className="text-left font-medium py-3 px-4">{t("agents.thProvider")}</th>
                    <th className="text-left font-medium py-3 px-4">{t("agents.thAgentId")}</th>
                    <th className="text-left font-medium py-3 px-4">{t("agents.thLanguage")}</th>
                    <th className="text-right font-medium py-3 px-4">{t("agents.thAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(configs ?? []).map((config) => {
                    const initial = config.name.charAt(0).toUpperCase();
                    const agentId = config.modelId || config.voiceId || "";
                    const agentIdShort = agentId.length > 20 ? agentId.slice(0, 20) + "…" : agentId;

                    return (
                      <tr key={config.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-700 font-semibold text-sm shrink-0">
                              {initial}
                            </div>
                            <span className="font-semibold text-sm text-foreground">{config.name}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <ProviderBadge provider={config.provider} />
                        </td>
                        <td className="py-3.5 px-4">
                          {agentId ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs text-foreground">{agentIdShort}</span>
                              <CopyButton value={agentId} />
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic text-xs">{t("agents.defaults")}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-muted-foreground">
                          {config.language || "—"}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-end gap-2">
                            <Link href={`/agent-configs/${config.id}/edit`}>
                              <Button variant="outline" size="sm" className="h-7 px-3 text-xs">
                                View
                              </Button>
                            </Link>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon" className="h-7 w-7">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/agent-configs/${config.id}/edit`} className="flex items-center gap-2 cursor-pointer">
                                    <Pencil className="h-4 w-4" /> Edit Agent
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="flex items-center gap-2 cursor-pointer"
                                  onClick={() => handleDuplicate(config)}
                                  disabled={createConfig.isPending}
                                >
                                  <Copy className="h-4 w-4" /> Duplicate Agent
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive flex items-center gap-2 cursor-pointer"
                                  onClick={() => setDeletingId(config.id)}
                                >
                                  <Trash2 className="h-4 w-4" /> Delete Agent
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
                Showing {configs?.length ?? 0} of {configs?.length ?? 0} {configs?.length === 1 ? "agent" : "agents"}
              </div>
            </>
          )}
        </div>
      )}

      <AlertDialog open={deletingId !== null} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("agents.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("agents.deleteDesc")}</AlertDialogDescription>
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
