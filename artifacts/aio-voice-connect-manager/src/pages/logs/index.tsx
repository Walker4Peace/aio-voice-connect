import React from "react";
import { useTranslation } from "react-i18next";
import { useAllDeployStatuses, useDeployLogs, useSystemLogs, useClearExtensionLogs, useClearSystemLogs, classifyLogLine } from "@/hooks/use-deploy";
import { useListExtensions } from "@workspace/api-client-react";
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
// Using inline styles (not Tailwind classes) so Tailwind's production purger
// cannot strip dynamic colors that only appear in JS lookup objects.

interface BadgeStyle { bg: string; color: string }

const LEVEL_BADGE: Record<string, BadgeStyle> = {
  INFO:  { bg: "#16a34a", color: "#fff" },   // green-600
  WARN:  { bg: "#ca8a04", color: "#fff" },   // yellow-600
  ERROR: { bg: "#dc2626", color: "#fff" },   // red-600
  DEBUG: { bg: "#2563eb", color: "#fff" },   // blue-600
};

const CAT_BADGE: Record<string, BadgeStyle> = {
  DEPLOYMENT: { bg: "#2563eb", color: "#fff" },  // blue-600
  WATCHDOG:   { bg: "#ca8a04", color: "#fff" },  // yellow-600
  STARTUP:    { bg: "#16a34a", color: "#fff" },  // green-600
  YEASTAR:    { bg: "#9333ea", color: "#fff" },  // purple-600
  HTTP:       { bg: "#6b7280", color: "#fff" },  // gray-500
  OTHER:      { bg: "#4b5563", color: "#fff" },  // gray-600
};

const LEVEL_DEFAULT: BadgeStyle = { bg: "#16a34a", color: "#fff" };
const CAT_DEFAULT:   BadgeStyle = { bg: "#4b5563", color: "#fff" };

const EXT_ROW_COLOR: Record<string, string> = {
  ERROR: "text-gray-100",
  WARN:  "text-gray-100",
  DEBUG: "text-gray-100",
  INFO:  "text-gray-200",
};

const ALL_SYSTEM_CATEGORIES = ["ALL", "DEPLOYMENT", "WATCHDOG", "STARTUP", "YEASTAR", "HTTP"] as const;
type SystemCategory = typeof ALL_SYSTEM_CATEGORIES[number];

// ── Clipboard helper (works inside cross-origin iframes) ─────────────────────

function copyToClipboard(text: string): Promise<void> {
  // Prefer the modern async API when available and in a secure context
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => execCommandFallback(text));
  }
  return execCommandFallback(text);
}

function execCommandFallback(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    ok ? resolve() : reject(new Error("copy failed"));
  });
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [state, setState] = React.useState<"idle" | "ok" | "err">("idle");
  return (
    <button
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      disabled={!text}
      onClick={() => {
        copyToClipboard(text)
          .then(() => { setState("ok"); setTimeout(() => setState("idle"), 1500); })
          .catch(() => { setState("err"); setTimeout(() => setState("idle"), 1500); });
      }}
    >
      {state === "ok"  ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
      {state === "ok"  ? t("logs.copied") : state === "err" ? t("logs.failed") : t("logs.copy")}
    </button>
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
  copyText,
  onLiveToggle,
  onClear,
  bodyClassName,
}: {
  headerLeft: React.ReactNode;
  headerRight?: React.ReactNode;
  isEmpty: boolean;
  isLive: boolean;
  children: React.ReactNode;
  lines: string[];
  /** Text written to clipboard — pass all buffered lines when paused, visible lines when live */
  copyText: string;
  onLiveToggle: () => void;
  onClear: () => void;
  bodyClassName?: string;
}) {
  const { t } = useTranslation();

  const downloadLogs = () => {
    const blob = new Blob([copyText], { type: "text/plain" });
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
        <span className="text-xs text-gray-300 flex items-center gap-2">
          {headerLeft}
        </span>
        <div className="flex items-center gap-1.5">
          {headerRight}
          <button
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs text-red-400/80 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            onClick={onClear}
          >
            <Trash2 className="h-3.5 w-3.5" /> {t("logs.clear")}
          </button>
          <button
            onClick={onLiveToggle}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-semibold border transition-colors"
            style={isLive
              ? { backgroundColor: "#2563eb", color: "#fff", borderColor: "#3b82f6" }
              : { backgroundColor: "#e5e7eb", color: "#111827", borderColor: "#d1d5db" }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLive ? "animate-spin" : ""}`} />
            {isLive ? t("logs.live") : t("logs.goLive")}
          </button>
        </div>
      </div>

      {/* Log body — height driven by caller via bodyClassName */}
      <div className={`text-gray-200 overflow-y-auto font-mono text-xs min-h-[280px] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#0d1117] [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-500 ${bodyClassName ?? "h-[calc(100vh-260px)]"}`}>
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
            {isLive
              ? <><RefreshCw className="h-5 w-5 animate-spin opacity-40" /><p className="italic">{t("logs.waitingEntries")}</p></>
              : <><RefreshCw className="h-5 w-5 opacity-30" /><p className="italic">{t("logs.clickGoLive1")} <strong className="text-gray-400">{t("logs.goLive")}</strong> {t("logs.clickGoLive2")}</p></>
            }
          </div>
        ) : children}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-gray-800 bg-[#161b22] text-xs text-gray-500">
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${isLive ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
            <span className={isLive ? "text-green-400" : "text-gray-500"}>{isLive ? t("logs.live") : t("logs.paused")}</span>
          </span>
          <span className="text-gray-600">{t("logs.entries", { count: lines.length })}</span>
        </span>
        <div className="flex items-center gap-1">
          <CopyButton text={copyText} />
          <button
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={downloadLogs}
            disabled={lines.length === 0}
          >
            <Download className="h-3.5 w-3.5" /> {t("logs.download")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Extension tab ─────────────────────────────────────────────────────────────

function ExtensionTab() {
  const { t } = useTranslation();
  const { data: extensions } = useListExtensions();
  const { data: allStatuses } = useAllDeployStatuses();

  const [selectedId, setSelectedId] = React.useState<string>("");
  const [isLive, setIsLive] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  const extId = selectedId ? Number(selectedId) : 0;

  const { data, refetch } = useDeployLogs(extId, !!extId, isLive);
  const clearExtLogs = useClearExtensionLogs(extId);
  const allLines = data?.lines ?? [];
  const parsed = React.useMemo(() => allLines.map(parseExtLine), [allLines]);

  React.useEffect(() => {
    setIsLive(false);
  }, [selectedId]);

  React.useEffect(() => {
    if (isLive) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [parsed.length, isLive]);

  const selectedExt = extensions?.find(e => e.id === extId);
  const selectedStatus = allStatuses?.find(s => s.extensionId === extId);
  const isRunning = selectedStatus?.status === "registered" || selectedStatus?.status === "starting" || selectedStatus?.status === "reconnecting";

  const handleClear = () => {
    if (!extId) return;
    clearExtLogs.mutate(undefined, { onSuccess: () => refetch() });
  };

  return (
    <div className="space-y-4">
      {/* Extension selector */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("logs.extension")}</label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-full max-w-xl">
            <SelectValue placeholder={t("logs.selectExtPlaceholder")} />
          </SelectTrigger>
          <SelectContent className="w-full max-w-xl">
            {extensions?.map((ext) => {
              const st = allStatuses?.find(s => s.extensionId === ext.id);
              const running = st?.status === "registered" || st?.status === "starting" || st?.status === "reconnecting";
              const isOutbound = ext.agentConfig?.mode === "outbound";
              return (
                <SelectItem key={ext.id} value={ext.id.toString()}>
                  <span className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Extension {ext.extensionNumber}{ext.displayName ? ` — ${ext.displayName}` : ""}</span>
                    {isOutbound ? (
                      <>
                        <span className="h-2 w-2 rounded-full shrink-0 bg-[#F1C40F]" />
                        <span className="text-xs text-[#92740A]">{t("extensions.outboundBadge")}</span>
                      </>
                    ) : st ? (
                      <>
                        <span className={`h-2 w-2 rounded-full shrink-0 ${running ? "bg-green-500" : "bg-red-400"}`} />
                        <span className={`text-xs ${running ? "text-green-600" : "text-red-500"}`}>
                          {running ? t("logs.statusRunning") : t("logs.statusDown")}
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
              : <span className="text-gray-600">{t("logs.noExtSelected")}</span>
            }
            {(selectedStatus || selectedExt?.agentConfig?.mode === "outbound") && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={isRunning
                  ? { backgroundColor: "#16a34a", color: "#fff" }
                  : { backgroundColor: "#9ca3af", color: "#111827" }}
              >
                {isRunning ? t("deploy.status.registered") : t("logs.notRegistered")}
              </span>
            )}
          </>
        }
        isEmpty={parsed.length === 0}
        isLive={isLive}
        lines={allLines}
        copyText={allLines.join("\n")}
        onLiveToggle={() => setIsLive(v => !v)}
        onClear={handleClear}
        bodyClassName="h-[450px]"
      >
        <table className="w-full">
          <thead>
            <tr className="text-gray-600 bg-[#161b22] sticky top-0 border-b border-gray-800 z-10">
              <th className="text-left font-medium py-2 px-4 w-28">{t("logs.thTime")}</th>
              <th className="text-left font-medium py-2 px-2 w-16">{t("logs.thLevel")}</th>
              <th className="text-left font-medium py-2 px-3">{t("logs.thMessage")}</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((p, i) => {
              const badge = LEVEL_BADGE[p.level] ?? LEVEL_DEFAULT;
              return (
                <tr key={i} className="hover:bg-white/[0.03]" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <td className="py-1 px-4 text-green-400/70 whitespace-nowrap">
                    {p.ts ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400/40 shrink-0" />
                        {fmtTs(p.ts)}
                      </span>
                    ) : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="py-1 px-2">
                    <span
                      className="text-[10px] font-bold rounded px-1.5 py-0.5"
                      style={{ backgroundColor: badge.bg, color: badge.color }}
                    >
                      {p.level}
                    </span>
                  </td>
                  <td className={`py-1 px-3 break-all ${EXT_ROW_COLOR[p.level] ?? "text-gray-200"}`}>
                    {p.msg}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div ref={endRef} />
      </TerminalShell>
    </div>
  );
}

// ── System tab ────────────────────────────────────────────────────────────────

function SystemTab() {
  const { t } = useTranslation();
  const [isLive, setIsLive] = React.useState(false);
  const [filterCat, setFilterCat] = React.useState<SystemCategory>("ALL");
  const endRef = React.useRef<HTMLDivElement>(null);

  const { data, refetch } = useSystemLogs(true, isLive);
  const clearSysLogs = useClearSystemLogs();
  const allLines = data?.lines ?? [];

  const parsed = React.useMemo(
    () => allLines.map(parseSysLine),
    [allLines],
  );

  const visible = React.useMemo(
    () => filterCat === "ALL" ? parsed : parsed.filter(p => p.category === filterCat),
    [parsed, filterCat],
  );

  React.useEffect(() => {
    if (isLive) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length, isLive]);

  const visibleRaw = visible.map(p => p.raw);

  const handleClear = () => {
    clearSysLogs.mutate(undefined, { onSuccess: () => refetch() });
  };

  return (
    <TerminalShell
      headerLeft={<><Server className="h-3.5 w-3.5" />{t("logs.system")}</>}
      headerRight={
        <Select value={filterCat} onValueChange={v => setFilterCat(v as SystemCategory)}>
          <SelectTrigger className="h-7 text-xs w-36 border-gray-300 bg-white text-gray-900 focus:ring-0 focus:ring-offset-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-200 text-gray-900">
            {ALL_SYSTEM_CATEGORIES.map(cat => (
              <SelectItem key={cat} value={cat} className="text-xs text-gray-900 focus:bg-gray-100 focus:text-gray-900">
                {cat === "ALL" ? t("logs.allCategories") : cat.charAt(0) + cat.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      isEmpty={visible.length === 0}
      isLive={isLive}
      lines={visibleRaw}
      copyText={visibleRaw.join("\n")}
      onLiveToggle={() => setIsLive(v => !v)}
      onClear={handleClear}
      bodyClassName="h-[450px]"
    >
      <table className="w-full">
        <thead>
          <tr className="text-gray-600 bg-[#161b22] sticky top-0 border-b border-gray-800 z-10">
            <th className="text-left font-medium py-2 px-4 w-28">{t("logs.thTime")}</th>
            <th className="text-left font-medium py-2 px-2 w-28">{t("logs.thCategory")}</th>
            <th className="text-left font-medium py-2 px-3">{t("logs.thMessage")}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((p, i) => {
            const badge = CAT_BADGE[p.category] ?? CAT_DEFAULT;
            return (
              <tr key={i} className="hover:bg-white/[0.03]" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <td className="py-1 px-4 text-green-400/70 whitespace-nowrap">
                  {p.ts ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400/40 shrink-0" />
                      {fmtTs(p.ts)}
                    </span>
                  ) : <span className="text-gray-700">—</span>}
                </td>
                <td className="py-1 px-2">
                  <span
                    className="text-[10px] font-bold rounded px-1.5 py-0.5"
                    style={{ backgroundColor: badge.bg, color: badge.color }}
                  >
                    {p.category}
                  </span>
                </td>
                <td className="py-1 px-3 text-gray-200 break-all">
                  {p.msg}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div ref={endRef} />
    </TerminalShell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("logs.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("logs.pageDesc")}
        </p>
      </div>

      <Tabs defaultValue="system">
        <TabsList className="mb-4">
          <TabsTrigger value="system" className="gap-1.5">
            <Server className="h-3.5 w-3.5" /> {t("logs.system")}
          </TabsTrigger>
          <TabsTrigger value="extension" className="gap-1.5">
            <Phone className="h-3.5 w-3.5" /> {t("logs.extension")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="system">
          <SystemTab />
        </TabsContent>

        <TabsContent value="extension">
          <ExtensionTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
