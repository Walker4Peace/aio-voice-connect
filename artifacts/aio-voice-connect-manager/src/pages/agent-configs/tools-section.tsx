/**
 * Tools Section — embedded inside the agent config form.
 * Only shown when editing an existing agent config (has an id).
 */
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Wrench } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExecutionType =
  | "http_request"
  | "webhook"
  | "save_result"
  | "transfer_call"
  | "hang_up"
  | "send_dtmf"
  | "custom_js";

export interface AgentTool {
  id: number;
  agentConfigId: number;
  name: string;
  description: string;
  parametersSchema: string | null;
  executionType: ExecutionType;
  executionConfig: string | null;
  timeout: number;
  requireConfirmation: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchTools(agentConfigId: number): Promise<AgentTool[]> {
  const r = await fetch(`${API_BASE}/agent-tools?agentConfigId=${agentConfigId}`);
  if (!r.ok) throw new Error("Failed to fetch tools");
  return r.json() as Promise<AgentTool[]>;
}

async function createTool(data: Omit<AgentTool, "id" | "createdAt" | "updatedAt">): Promise<AgentTool> {
  const r = await fetch(`${API_BASE}/agent-tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) { const e = await r.json() as { error?: string }; throw new Error(e.error ?? "Failed"); }
  return r.json() as Promise<AgentTool>;
}

async function updateTool(id: number, data: Partial<Omit<AgentTool, "id" | "agentConfigId" | "createdAt" | "updatedAt">>): Promise<AgentTool> {
  const r = await fetch(`${API_BASE}/agent-tools/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) { const e = await r.json() as { error?: string }; throw new Error(e.error ?? "Failed"); }
  return r.json() as Promise<AgentTool>;
}

async function deleteTool(id: number): Promise<void> {
  const r = await fetch(`${API_BASE}/agent-tools/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to delete tool");
}

// ── Execution type labels / configs ──────────────────────────────────────────

const EXECUTION_TYPE_LABELS: Record<ExecutionType, string> = {
  http_request:   "HTTP Request",
  webhook:        "Webhook",
  save_result:    "Save Result",
  transfer_call:  "Transfer Call",
  hang_up:        "Hang Up",
  send_dtmf:      "Send DTMF",
  custom_js:      "Custom JavaScript",
};

// Types that need no execution config — hide the textarea for these
const NO_CONFIG_TYPES = new Set<ExecutionType>(["hang_up", "save_result"]);

const EXECUTION_CONFIG_PLACEHOLDERS: Record<ExecutionType, string> = {
  http_request:  '{"url": "https://api.example.com/data", "method": "GET"}',
  webhook:       '{"url": "https://your-server.com/webhook"}',
  save_result:   "",
  transfer_call: '{"destination": "sip:operator@domain.com"}',
  hang_up:       "{}",
  send_dtmf:     '{"digits": "1234"}',
  custom_js:     '{"code": "return { result: args.input.toUpperCase() };"}',
};

// ── Tool form ─────────────────────────────────────────────────────────────────

interface ToolFormState {
  name: string;
  description: string;
  parametersSchema: string;
  executionType: ExecutionType;
  executionConfig: string;
  timeout: number;
  requireConfirmation: boolean;
  enabled: boolean;
  sortOrder: number;
}

const EMPTY_FORM: ToolFormState = {
  name: "",
  description: "",
  parametersSchema: "",
  executionType: "http_request",
  executionConfig: "",
  timeout: 10,
  requireConfirmation: false,
  enabled: true,
  sortOrder: 0,
};

interface ToolDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agentConfigId: number;
  tool?: AgentTool;
  onSaved: () => void;
}

function ToolDialog({ open, onOpenChange, agentConfigId, tool, onSaved }: ToolDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<ToolFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const [nameError, setNameError] = React.useState("");
  const [schemaError, setSchemaError] = React.useState("");
  const [configError, setConfigError] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setForm(tool ? {
        name: tool.name,
        description: tool.description,
        parametersSchema: tool.parametersSchema ?? "",
        executionType: tool.executionType,
        executionConfig: tool.executionConfig ?? "",
        timeout: tool.timeout,
        requireConfirmation: tool.requireConfirmation,
        enabled: tool.enabled,
        sortOrder: tool.sortOrder,
      } : EMPTY_FORM);
      setNameError(""); setSchemaError(""); setConfigError("");
    }
  }, [open, tool]);

  function set<K extends keyof ToolFormState>(key: K, value: ToolFormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let ok = true;

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(form.name)) {
      setNameError("Name must be a valid identifier (letters, numbers, underscores, no spaces)");
      ok = false;
    } else setNameError("");

    if (form.parametersSchema.trim()) {
      try { JSON.parse(form.parametersSchema); setSchemaError(""); }
      catch { setSchemaError("Must be valid JSON Schema"); ok = false; }
    }

    if (form.executionConfig.trim()) {
      try { JSON.parse(form.executionConfig); setConfigError(""); }
      catch { setConfigError("Must be valid JSON"); ok = false; }
    }

    if (!ok) return;

    setSubmitting(true);
    try {
      const payload = {
        agentConfigId,
        name: form.name,
        description: form.description,
        parametersSchema: form.parametersSchema.trim() || null,
        executionType: form.executionType,
        executionConfig: form.executionConfig.trim() || null,
        timeout: form.timeout,
        requireConfirmation: form.requireConfirmation,
        enabled: form.enabled,
        sortOrder: form.sortOrder,
      };

      if (tool) {
        await updateTool(tool.id, payload);
        toast({ title: "Tool updated" });
      } else {
        await createTool(payload);
        toast({ title: "Tool created" });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tool ? "Edit Tool" : "Add Tool"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="tname">Name <span className="text-destructive">*</span></Label>
              <Input
                id="tname"
                placeholder="check_weather"
                value={form.name}
                onChange={e => set("name", e.target.value)}
                required
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
              <p className="text-xs text-muted-foreground">Identifier used by the AI. No spaces.</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ttype">Execution Type <span className="text-destructive">*</span></Label>
              <Select value={form.executionType} onValueChange={v => set("executionType", v as ExecutionType)}>
                <SelectTrigger id="ttype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(EXECUTION_TYPE_LABELS) as [ExecutionType, string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tdesc">Description <span className="text-destructive">*</span></Label>
            <Input
              id="tdesc"
              placeholder="Get the current weather for a city"
              value={form.description}
              onChange={e => set("description", e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">Shown to the AI to decide when to use this tool.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tparams">Parameters Schema <span className="text-muted-foreground text-xs">(JSON Schema, optional)</span></Label>
            <Textarea
              id="tparams"
              placeholder={'{\n  "type": "object",\n  "properties": {\n    "city": { "type": "string", "description": "City name" }\n  },\n  "required": ["city"]\n}'}
              className="font-mono text-xs min-h-[100px]"
              value={form.parametersSchema}
              onChange={e => set("parametersSchema", e.target.value)}
            />
            {schemaError && <p className="text-xs text-destructive">{schemaError}</p>}
          </div>

          {form.executionType === "save_result" ? (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">No configuration needed</p>
              <p>
                <strong>Save Result</strong> writes the tool's arguments directly to the outbound call record in the database.
                When the AI calls this tool the caller can poll{" "}
                <code className="text-xs bg-muted px-1 rounded">GET /api/outbound/calls/:id</code>{" "}
                to retrieve the structured result. If a <code className="text-xs bg-muted px-1 rounded">webhookUrl</code> was
                provided at call time, the result is also POSTed there automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="tconfig">
                Execution Config{" "}
                <span className="text-muted-foreground text-xs">(JSON — {EXECUTION_TYPE_LABELS[form.executionType]})</span>
              </Label>
              <Textarea
                id="tconfig"
                placeholder={EXECUTION_CONFIG_PLACEHOLDERS[form.executionType]}
                className="font-mono text-xs min-h-[80px]"
                value={form.executionConfig}
                onChange={e => set("executionConfig", e.target.value)}
              />
              {configError && <p className="text-xs text-destructive">{configError}</p>}
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label htmlFor="ttimeout">Timeout (seconds)</Label>
              <Input
                id="ttimeout"
                type="number"
                min={1}
                max={300}
                value={form.timeout}
                onChange={e => set("timeout", Number(e.target.value))}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="tsort">Sort Order</Label>
              <Input
                id="tsort"
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={e => set("sortOrder", Number(e.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Options</Label>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="tenabled"
                    checked={form.enabled}
                    onCheckedChange={v => set("enabled", v)}
                  />
                  <Label htmlFor="tenabled" className="text-sm font-normal">Enabled</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="tconfirm"
                    checked={form.requireConfirmation}
                    onCheckedChange={v => set("requireConfirmation", v)}
                  />
                  <Label htmlFor="tconfirm" className="text-sm font-normal">Require confirmation</Label>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : tool ? "Update Tool" : "Add Tool"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main ToolsSection component ───────────────────────────────────────────────

interface ToolsSectionProps {
  agentConfigId: number;
}

export function ToolsSection({ agentConfigId }: ToolsSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editTool, setEditTool] = React.useState<AgentTool | undefined>();
  const [deletingId, setDeletingId] = React.useState<number | null>(null);

  const { data: tools = [], isLoading } = useQuery({
    queryKey: ["agent-tools", agentConfigId],
    queryFn: () => fetchTools(agentConfigId),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["agent-tools", agentConfigId] });

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      await deleteTool(id);
      toast({ title: "Tool deleted" });
      invalidate();
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggle(tool: AgentTool) {
    try {
      await updateTool(tool.id, { enabled: !tool.enabled });
      invalidate();
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: (err as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            AI Tools / Functions
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define tools the AI can call during a conversation. Each tool is included in the agent's config and executed by SIP Agent when requested.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { setEditTool(undefined); setDialogOpen(true); }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Tool
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4">Loading tools…</div>
      ) : tools.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No tools defined yet. Add tools like HTTP requests, webhooks, or call transfers that the AI can use.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-20 text-center">Enabled</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.map(tool => (
                <TableRow key={tool.id}>
                  <TableCell className="font-mono text-sm">{tool.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {EXECUTION_TYPE_LABELS[tool.executionType]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <span className="text-sm text-muted-foreground truncate block">{tool.description}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={tool.enabled}
                      onCheckedChange={() => void handleToggle(tool)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => { setEditTool(tool); setDialogOpen(true); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        disabled={deletingId === tool.id}
                        onClick={() => void handleDelete(tool.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ToolDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agentConfigId={agentConfigId}
        tool={editTool}
        onSaved={invalidate}
      />
    </div>
  );
}
