import React from "react";
import { useTranslation } from "react-i18next";
import { useTimezone } from "@/contexts/timezone-context";
import { useAllDeployStatuses, useDeployLogs, useSystemLogs } from "@/hooks/use-deploy";
import { useListExtensions } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Server, Phone, RefreshCw, Trash2, Copy, Download, Check, Wifi } from "lucide-react";

const SYSTEM_VALUE = "__system__";

interface ParsedLine {
  ts: string | null;
  level: string | null;
  source: string | null;
  msg: string;
  raw: string;
}

function parseLogLine(line: string, sourceLabel?: string): ParsedLine {
  if (!line.trim()) return { ts: null, level: null, source: null, msg: line, raw: line };

  // Pino-pretty: [HH:MM:SS.mmm] LEVEL (pid): message
  const pinoPretty = line.match(/^\[(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]\s+(\w+)\s+\(\d+\):\s+(.+)$/);
  if (pinoPretty) {
    return { ts: pinoPretty[1], level: pinoPretty[2].toUpperCase(), source: sourceLabel ?? "System", msg: pinoPretty[3], raw: line };
  }

  // Pino JSON: {"level":30,"time":...,"msg":"..."}
  try {
    const obj = JSON.parse(line) as { level?: number; time?: number; msg?: string; message?: string; name?: string };
    if (obj.level !== undefined || obj.msg !== undefined) {
      const levelMap: Record<number, string> = { 10: "TRACE", 20: "DEBUG", 30: "INFO", 40: "WARN", 50: "ERROR", 60: "FATAL" };
      const lvl = obj.level ? levelMap[obj.level] ?? "INFO" : "INFO";
      const ts = obj.time ? new Date(obj.time).toLocaleString() : null;
      return { ts, level: lvl, source: sourceLabel ?? "System", msg: obj.msg ?? obj.message ?? line, raw: line };
    }
  } catch { /* not JSON */ }

  // Date+time prefix: YYYY/MM/DD HH:MM:SS LEVEL message
  const dtMatch = line.match(/^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(\w+)\s+(.+)$/);
  if (dtMatch) {
    return { ts: dtMatch[1].replace("/", "-").replace("/", "-"), level: dtMatch[2].toUpperCase(), source: sourceLabel ?? null, msg: dtMatch[3], raw: line };
  }

  // Short time + level: HH:MM:SS LEVEL message
  const shortMatch = line.match(/^(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(\w+)\s+(.+)$/);
  if (shortMatch) {
    return { ts: shortMatch[1], level: shortMatch[2].toUpperCase(), source: sourceLabel ?? null, msg: shortMatch[3], raw: line };
  }

  return { ts: null, level: null, source: null, msg: line, raw: line };
}

const LEVEL_STYLES: Record<string, string> = {
  INFO:  "text-green-400 bg-green-400/10 border border-green-400/20",
  WARN:  "text-yellow-400 bg-yellow-400/10 border border-yellow-400/20",
  ERROR: "text-red-400 bg-red-400/10 border border-red-400/20",
  DEBUG: "text-gray-400 bg-gray-400/10 border border-gray-400/20",
  TRACE: "text-gray-500 bg-gray-500/10 border border-gray-500/20",
  FATAL: "text-red-500 bg-red-500/10 border border-red-500/20",
};

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost" size="sm"
      className="gap-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 h-7"
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("logs.copied") : t("logs.copyLogs")}
    </Button>
  );
}

export default function LogsPage() {
  const { t } = useTranslation();
  const { formatDateTime } = useTimezone();
  const { data: extensions } = useListExtensions();
  const { data: allStatuses } = useAllDeployStatuses();

  const [selectedValue, setSelectedValue] = React.useState<string>(SYSTEM_VALUE);
  const [isLive, setIsLive] = React.useState(false);
  const [liveFromIndex, setLiveFromIndex] = React.useState<number | null>(null);
  const [clearedAt, setClearedAt] = React.useState<number>(0);
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  const isSystem = selectedValue === SYSTEM_VALUE;
  const selectedExtId = isSystem ? null : Number(selectedValue);

  const { data: extLogs } = useDeployLogs(selectedExtId ?? 0, !isSystem && selectedExtId != null, isLive);
  const { data: sysLogs } = useSystemLogs(isSystem, isLive);

  const allLines = isSystem ? (sysLogs?.lines ?? []) : (extLogs?.lines ?? []);

  const displayedLines = React.useMemo(() => {
    if (!isLive || liveFromIndex === null) return [];
    return allLines.slice(Math.max(liveFromIndex, clearedAt));
  }, [isLive, allLines, liveFromIndex, clearedAt]);

  const selectedExt = extensions?.find(e => e.id === selectedExtId);
  const selectedLabel = isSystem ? "System" : selectedExt ? `EXT ${selectedExt.extensionNumber}${selectedExt.displayName ? ` (${selectedExt.displayName})` : ""}` : undefined;

  const parsedLines = React.useMemo(() =>
    displayedLines.map(line => parseLogLine(line, selectedLabel)),
    [displayedLines, selectedLabel]
  );

  React.useEffect(() => {
    setLiveFromIndex(null);
    setIsLive(false);
    setClearedAt(0);
  }, [selectedValue]);

  const handleLiveToggle = () => {
    if (!isLive) {
      setLiveFromIndex(allLines.length ?? 0);
      setIsLive(true);
    } else {
      setIsLive(false);
    }
  };

  React.useEffect(() => {
    if (isLive) logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [parsedLines.length, isLive]);

  const handleClear = () => setClearedAt(allLines.length);

  const downloadLogs = () => {
    const text = displayedLines.join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${selectedValue}-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedStatus = isSystem ? null : allStatuses?.find(s => s.extensionId === selectedExtId);

  const lastLine = parsedLines[parsedLines.length - 1];
  const lastTs = lastLine?.ts ?? null;

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("logs.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("logs.description")}</p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("logs.source")}</label>
          <Select value={selectedValue} onValueChange={setSelectedValue}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder={t("logs.selectSource")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SYSTEM_VALUE}>
                <span className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("logs.system")}
                </span>
              </SelectItem>
              {extensions?.map((ext) => {
                const st = allStatuses?.find(s => s.extensionId === ext.id);
                const isRunning = st?.status === "registered" || st?.status === "starting" || st?.status === "reconnecting";
                return (
                  <SelectItem key={ext.id} value={ext.id.toString()}>
                    <span className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Extension {ext.extensionNumber}{ext.displayName ? ` (${ext.displayName})` : ""}</span>
                      {st && (
                        <span className={`h-2 w-2 rounded-full shrink-0 ${isRunning ? "bg-green-500" : "bg-red-400"}`} />
                      )}
                      {st && (
                        <span className={`text-xs ${isRunning ? "text-green-600" : "text-red-500"}`}>
                          {isRunning ? "Registered" : "Down"}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={handleClear}
          >
            <Trash2 className="h-4 w-4" /> {t("logs.clearView")}
          </Button>
          <Button
            variant={isLive ? "default" : "outline"} size="sm"
            className={`gap-1.5 ${isLive ? "bg-primary text-primary-foreground" : ""}`}
            onClick={handleLiveToggle}
          >
            <RefreshCw className={`h-4 w-4 ${isLive ? "animate-spin" : ""}`} />
            {t("logs.live")}
          </Button>
        </div>
      </div>

      {/* Terminal */}
      <div className="rounded-xl overflow-hidden border border-gray-800 bg-[#0d1117] shadow-lg">
        {/* Terminal header */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-800 bg-[#161b22]">
          <span className="text-xs text-gray-400 flex items-center gap-1.5">
            {isSystem ? <Server className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
            {isSystem ? t("logs.system") : selectedLabel}
          </span>
          {selectedStatus && (
            <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${
              selectedStatus.status === "registered" ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10"
            }`}>
              {selectedStatus.status}
            </span>
          )}
        </div>

        {/* Log table */}
        <div className="h-[480px] overflow-y-auto font-mono text-xs">
          {!isLive ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
              <RefreshCw className="h-6 w-6 opacity-40" />
              <p className="italic" dangerouslySetInnerHTML={{ __html: t("logs.clickLive") }} />
            </div>
          ) : parsedLines.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
              <RefreshCw className="h-5 w-5 animate-spin opacity-40" />
              <p className="italic">{isSystem ? t("logs.waitingSystem") : t("logs.waitingOutput")}</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-gray-600 bg-[#161b22] sticky top-0 border-b border-gray-800">
                  <th className="text-left font-medium py-2 px-4 w-44">{t("logs.thTimestamp")}</th>
                  <th className="text-left font-medium py-2 px-2 w-16">{t("logs.thLevel")}</th>
                  <th className="text-left font-medium py-2 px-2 w-40">{t("logs.thSource")}</th>
                  <th className="text-left font-medium py-2 px-3">{t("logs.thMessage")}</th>
                </tr>
              </thead>
              <tbody>
                {parsedLines.map((p, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-white/5">
                    <td className="py-1.5 px-4 text-green-500/80 whitespace-nowrap">
                      {p.ts ? (
                        <span className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500/60 shrink-0" />
                          {p.ts}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2">
                      {p.level ? (
                        <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${LEVEL_STYLES[p.level] ?? "text-gray-400 bg-gray-400/10"}`}>
                          {p.level}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 px-2 text-green-400/70 truncate max-w-[160px]">
                      {p.source ?? "—"}
                    </td>
                    <td className="py-1.5 px-3 text-gray-200 break-all">
                      {p.msg}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-800 bg-[#161b22] text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${isLive ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
              {isLive ? t("logs.liveConnection") : t("logs.notConnected")}
            </span>
            {lastTs && (
              <span>{t("logs.lastEvent", { ts: lastTs })}</span>
            )}
            <span>{t("logs.entries", { count: parsedLines.length })}</span>
          </div>
          <div className="flex items-center gap-1">
            <CopyButton text={displayedLines.join("\n")} />
            <Button
              variant="ghost" size="sm"
              className="gap-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 h-7"
              onClick={downloadLogs}
              disabled={displayedLines.length === 0}
            >
              <Download className="h-3.5 w-3.5" /> {t("logs.downloadLogs")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
