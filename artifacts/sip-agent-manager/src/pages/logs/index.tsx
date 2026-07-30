import React from "react";
import { useAllDeployStatuses, useDeployLogs, useSystemLogs, classifyLogLine } from "@/hooks/use-deploy";
import { useListExtensions } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Server, Phone, RefreshCw, Trash2, Copy, Download, Check } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtParsed {
  ts: string | null;
  level: string;
  msg: string;
  raw: string;
}

interface SysParsed {
  ts: string | null;
  category: string;
  msg: string;
  raw: string;
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function parseExtLine(raw: string): ExtParsed {
  const level = classifyLogLine(raw).toUpperCase();

  // YYYY/MM/DD HH:MM:SS LEVEL message
  const dtMatch = raw.match(/^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+\w+\s+(.+)$/);
  if (dtMatch) return { ts: dtMatch[1], level, msg: dtMatch[2], raw };

  // [ISO] rest
  const isoMatch = raw.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s+(.+)$/);
  if (isoMatch) return { ts: isoMatch[1], level, msg: isoMatch[2], raw };

  // HH:MM:SS.mmm message
  const timeMatch = raw.match(/^(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(.+)$/);
  if (timeMatch) return { ts: timeMatch[1], level, msg: timeMatch[2], raw };

  return { ts: null, level, msg: raw, raw };
}

function parseSysLine(raw: string): SysParsed {
  // [ISO] [CATEGORY] message
  const m = raw.match(/^\[([^\]]+)\]\s+\[([A-Z]+)\]\s+(.+)$/);
  if (m) return { ts: m[1], category: m[2], msg: m[3], raw };

  // [ISO] message (no category — legacy)
  const m2 = raw.match(/^\[([^\]]+)\]\s+(.+)$/);
  if (m2) return { ts: m2[1], category: "OTHER", msg: m2[2], raw };

  return { ts: null, category: "OTHER", msg: raw, raw };
}

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  // ISO → local time only (HH:MM:SS)
  try {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d.toLocaleTimeString();
  } catch { /* */ }
  return ts;
}

// ── Style maps ────────────────────────────────────────────────────────────────

const EXT_LEVEL_STYLES: Record<string, string> = {
  INFO:  "text-green-400 bg-green-400/10 border border-green-400/20",
  WARN:  "text-yellow-400 bg-yellow-400/10 border border-yellow-400/20",
  ERROR: "text-red-400 bg-red-400/10 border border-red-400/20",
  DEBUG: "text-blue-400 bg-blue-400/10 border border-blue-400/20",
};

const CAT_STYLES: Record<string, string> = {
  DEPLOYMENT: "text-blue-400   bg-blue-400/10   border border-blue-400/20",
  WATCHDOG:   "text-yellow-400 bg-yellow-400/10 border border-yellow-400/20",
  STARTUP:    "text-green-400  bg-green-400/10  border border-green-400/20",
  YEASTAR:    "text-purple-400 bg-purple-400/10 border border-purple-400/20",
  HTTP:       "text-gray-400   bg-gray-400/10   border border-gray-400/20",
  OTHER:      "text-gray-500   bg-gray-500/10   border border-gray-500/20",
};

const EXT_ROW_COLOR: Record<string, string> = {
  ERROR: "text-red-300",
  WARN:  "text-yellow-300",
  DEBUG: "text-blue-300",
  INFO:  "text-gray-200",
};

const ALL_SYSTEM_CATEGORIES = ["ALL", "DEPLOYMENT", "WATCHDOG", "STARTUP", "YEASTAR", "HTTP"] as const;
type SystemCategory = typeof ALL_SYSTEM_CATEGORIES[number];

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost" size="sm"
      className="gap-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 h-7"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}

// ── Shared terminal shell ─────────────────────────────────────────────────────

function TerminalShell({
  headerLeft,
  headerRight,
  isEmpty,
  isLive,
  children,
  lines,
  onLiveToggle,
  onClear,
}: {
  headerLeft: React.ReactNode;
  headerRight?: React.ReactNode;
  isEmpty: boolean;
  isLive: boolean;
  children: React.ReactNode;
  lines: string[];
  onLiveToggle: () => void;
  onClear: () => void;
}) {
  const downloadLogs = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 bg-[#0d1117] shadow-lg">
      {/* Terminal title bar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-gray-800 bg-[#161b22]">
        <span className="text-xs text-gray-400 flex items-center gap-2">
          {headerLeft}
        </span>
        <div className="flex items-center gap-1.5">
          {headerRight}
          <Button
            variant="ghost" size="sm"
            className="gap-1.5 text-xs text-destructive/70 hover:text-destructive hover:bg-destructive/10 h-7"
            onClick={onClear}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </Button>
          <Button
            variant={isLive ? "default" : "outline"} size="sm"
            className={`gap-1.5 h-7 text-xs ${isLive ? "" : "border-gray-700 text-gray-300"}`}
            onClick={onLiveToggle}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLive ? "animate-spin" : ""}`} />
            {isLive ? "Live" : "Go Live"}
          </Button>
        </div>
      </div>

      {/* Log body */}
      <div className="h-[480px] overflow-y-auto font-mono text-xs [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#0d1117] [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-500">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
            {isLive
              ? <><RefreshCw className="h-5 w-5 animate-spin opacity-40" /><p className="italic">Waiting for new log entries…</p></>
              : <><RefreshCw className="h-5 w-5 opacity-30" /><p className="italic">Click <strong className="text-gray-400">Go Live</strong> to start streaming logs</p></>
            }
          </div>
        ) : children}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-gray-800 bg-[#161b22] text-xs text-gray-500">
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${isLive ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
            {isLive ? "Live" : "Paused"}
          </span>
          <span>{lines.length} entries</span>
        </span>
        <div className="flex items-center gap-1">
          <CopyButton text={lines.join("\n")} />
          <Button
            variant="ghost" size="sm"
            className="gap-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 h-7"
            onClick={downloadLogs}
            disabled={lines.length === 0}
          >
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Extension tab ─────────────────────────────────────────────────────────────

function ExtensionTab() {
  const { data: extensions } = useListExtensions();
  const { data: allStatuses } = useAllDeployStatuses();

  const [selectedId, setSelectedId] = React.useState<string>("");
  const [isLive, setIsLive] = React.useState(false);
  const [clearedAt, setClearedAt] = React.useState(0);
  const endRef = React.useRef<HTMLDivElement>(null);

  const extId = selectedId ? Number(selectedId) : 0;

  const { data } = useDeployLogs(extId, !!extId, isLive);
  const allLines = data?.lines ?? [];
  const lines = allLines.slice(clearedAt);
  const parsed = React.useMemo(() => lines.map(parseExtLine), [lines]);

  React.useEffect(() => {
    setIsLive(false);
    setClearedAt(0);
  }, [selectedId]);

  React.useEffect(() => {
    if (isLive) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [parsed.length, isLive]);

  const selectedExt = extensions?.find(e => e.id === extId);
  const selectedStatus = allStatuses?.find(s => s.extensionId === extId);
  const isRunning = selectedStatus?.status === "registered" || selectedStatus?.status === "starting" || selectedStatus?.status === "reconnecting";

  return (
    <div className="space-y-4">
      {/* Extension selector */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Extension</label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-96">
            <SelectValue placeholder="Select an extension to view its SIP logs…" />
          </SelectTrigger>
          <SelectContent className="w-96">
            {extensions?.map((ext) => {
              const st = allStatuses?.find(s => s.extensionId === ext.id);
              const running = st?.status === "registered" || st?.status === "starting" || st?.status === "reconnecting";
              return (
                <SelectItem key={ext.id} value={ext.id.toString()}>
                  <span className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Extension {ext.extensionNumber}{ext.displayName ? ` — ${ext.displayName}` : ""}</span>
                    {st ? (
                      <>
                        <span className={`h-2 w-2 rounded-full shrink-0 ${running ? "bg-green-500" : "bg-red-400"}`} />
                        <span className={`text-xs ${running ? "text-green-600" : "text-red-500"}`}>
                          {running ? "Registered" : "Stopped"}
                        </span>
                      </>
                    ) : null}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Terminal */}
      <TerminalShell
        headerLeft={
          <>
            <Phone className="h-3.5 w-3.5" />
            {selectedExt
              ? <>Ext {selectedExt.extensionNumber}{selectedExt.displayName ? ` — ${selectedExt.displayName}` : ""}</>
              : <span className="text-gray-600">No extension selected</span>
            }
            {selectedStatus && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${isRunning ? "text-green-400 bg-green-400/10 border-green-400/20" : "text-gray-500 bg-gray-500/10 border-gray-500/20"}`}>
                {selectedStatus.status}
              </span>
            )}
          </>
        }
        isEmpty={parsed.length === 0}
        isLive={isLive}
        lines={lines}
        onLiveToggle={() => {
          if (!isLive) setClearedAt(allLines.length);
          setIsLive(v => !v);
        }}
        onClear={() => setClearedAt(allLines.length)}
      >
        <table className="w-full">
          <thead>
            <tr className="text-gray-600 bg-[#161b22] sticky top-0 border-b border-gray-800 z-10">
              <th className="text-left font-medium py-2 px-4 w-28">Time</th>
              <th className="text-left font-medium py-2 px-2 w-16">Level</th>
              <th className="text-left font-medium py-2 px-3">Message</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((p, i) => (
              <tr key={i} className="border-b border-gray-800/40 hover:bg-white/[0.03]">
                <td className="py-1 px-4 text-green-600/70 whitespace-nowrap">
                  {p.ts ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500/50 shrink-0" />
                      {fmtTs(p.ts)}
                    </span>
                  ) : <span className="text-gray-700">—</span>}
                </td>
                <td className="py-1 px-2">
                  <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${EXT_LEVEL_STYLES[p.level] ?? EXT_LEVEL_STYLES.INFO}`}>
                    {p.level}
                  </span>
                </td>
                <td className={`py-1 px-3 break-all ${EXT_ROW_COLOR[p.level] ?? "text-gray-200"}`}>
                  {p.msg}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div ref={endRef} />
      </TerminalShell>
    </div>
  );
}

// ── System tab ────────────────────────────────────────────────────────────────

function SystemTab() {
  const [isLive, setIsLive] = React.useState(false);
  const [clearedAt, setClearedAt] = React.useState(0);
  const [filterCat, setFilterCat] = React.useState<SystemCategory>("ALL");
  const endRef = React.useRef<HTMLDivElement>(null);

  const { data } = useSystemLogs(true, isLive);
  const allLines = data?.lines ?? [];

  const parsed = React.useMemo(
    () => allLines.slice(clearedAt).map(parseSysLine),
    [allLines, clearedAt],
  );

  const visible = React.useMemo(
    () => filterCat === "ALL" ? parsed : parsed.filter(p => p.category === filterCat),
    [parsed, filterCat],
  );

  React.useEffect(() => {
    if (isLive) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length, isLive]);

  const visibleRaw = visible.map(p => p.raw);

  return (
    <TerminalShell
      headerLeft={<><Server className="h-3.5 w-3.5" />System</>}
      headerRight={
        <Select value={filterCat} onValueChange={v => setFilterCat(v as SystemCategory)}>
          <SelectTrigger className="h-7 text-xs w-36 border-gray-700 bg-transparent text-gray-300">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_SYSTEM_CATEGORIES.map(cat => (
              <SelectItem key={cat} value={cat} className="text-xs">
                {cat === "ALL" ? "All categories" : cat.charAt(0) + cat.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      isEmpty={visible.length === 0}
      isLive={isLive}
      lines={visibleRaw}
      onLiveToggle={() => {
        if (!isLive) setClearedAt(allLines.length);
        setIsLive(v => !v);
      }}
      onClear={() => setClearedAt(allLines.length)}
    >
      <table className="w-full">
        <thead>
          <tr className="text-gray-600 bg-[#161b22] sticky top-0 border-b border-gray-800 z-10">
            <th className="text-left font-medium py-2 px-4 w-28">Time</th>
            <th className="text-left font-medium py-2 px-2 w-28">Category</th>
            <th className="text-left font-medium py-2 px-3">Message</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((p, i) => (
            <tr key={i} className="border-b border-gray-800/40 hover:bg-white/[0.03]">
              <td className="py-1 px-4 text-green-600/70 whitespace-nowrap">
                {p.ts ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500/50 shrink-0" />
                    {fmtTs(p.ts)}
                  </span>
                ) : <span className="text-gray-700">—</span>}
              </td>
              <td className="py-1 px-2">
                <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${CAT_STYLES[p.category] ?? CAT_STYLES.OTHER}`}>
                  {p.category}
                </span>
              </td>
              <td className="py-1 px-3 text-gray-200 break-all">
                {p.msg}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div ref={endRef} />
    </TerminalShell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Logs</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Real-time SIP agent output and server activity. Logs are in-memory and reset on restart.
        </p>
      </div>

      <Tabs defaultValue="extension">
        <TabsList className="mb-4">
          <TabsTrigger value="extension" className="gap-1.5">
            <Phone className="h-3.5 w-3.5" /> Extension
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-1.5">
            <Server className="h-3.5 w-3.5" /> System
          </TabsTrigger>
        </TabsList>

        <TabsContent value="extension">
          <ExtensionTab />
        </TabsContent>

        <TabsContent value="system">
          <SystemTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
