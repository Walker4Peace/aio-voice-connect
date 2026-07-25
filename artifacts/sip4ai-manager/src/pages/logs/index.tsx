import React from "react";
import { Link } from "wouter";
import { useAllDeployStatuses, useDeployLogs, useSystemLogs, statusLabel, statusColor, logLineClass } from "@/hooks/use-deploy";
import { useListExtensions } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, RefreshCw } from "lucide-react";

const SYSTEM_VALUE = "__system__";

export default function LogsPage() {
  const { data: extensions } = useListExtensions();
  const { data: allStatuses } = useAllDeployStatuses();

  // "system" is always selected by default
  const [selectedValue, setSelectedValue] = React.useState<string>(SYSTEM_VALUE);
  const [isLive, setIsLive] = React.useState(false);
  const [liveFromIndex, setLiveFromIndex] = React.useState<number | null>(null);
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  const isSystem = selectedValue === SYSTEM_VALUE;
  const selectedExtId = isSystem ? null : Number(selectedValue);

  // Fetch extension logs
  const { data: extLogs } = useDeployLogs(
    selectedExtId ?? 0,
    !isSystem && selectedExtId != null,
    isLive
  );

  // Fetch system logs
  const { data: sysLogs } = useSystemLogs(isSystem, isLive);

  const allLines = isSystem ? (sysLogs?.lines ?? []) : (extLogs?.lines ?? []);

  // Only show lines captured since live was started
  const displayedLines = React.useMemo(() => {
    if (!isLive || liveFromIndex === null) return [];
    return allLines.slice(liveFromIndex);
  }, [isLive, allLines, liveFromIndex]);

  // Reset live state when switching source
  React.useEffect(() => {
    setLiveFromIndex(null);
    setIsLive(false);
  }, [selectedValue]);

  const handleLiveToggle = () => {
    if (!isLive) {
      setLiveFromIndex(allLines.length ?? 0);
      setIsLive(true);
    } else {
      setIsLive(false);
    }
  };

  // Scroll to bottom during live mode
  React.useEffect(() => {
    if (isLive) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [displayedLines.length, isLive]);

  const selectedStatus = isSystem
    ? null
    : allStatuses?.find((s) => s.extensionId === selectedExtId);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Logs</h1>
      </div>

      {/* Source picker + status strip */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <Select
            value={selectedValue}
            onValueChange={setSelectedValue}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select source…" />
            </SelectTrigger>
            <SelectContent>
              {/* System is always first */}
              <SelectItem value={SYSTEM_VALUE}>
                🖥 System
              </SelectItem>
              {/* SIP extension logs below */}
              {extensions?.map((ext) => {
                const st = allStatuses?.find((s) => s.extensionId === ext.id);
                return (
                  <SelectItem key={ext.id} value={ext.id.toString()}>
                    {ext.extensionNumber}
                    {ext.displayName ? ` (${ext.displayName})` : ""}
                    {st ? ` — ${st.status}` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {selectedStatus && (
          <Badge
            variant="outline"
            className={`text-sm px-3 py-1 font-semibold ${statusColor(selectedStatus.status)}`}
          >
            {statusLabel(selectedStatus.status)}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={isLive ? "default" : "outline"}
            size="sm"
            className={`gap-2 ${!isLive ? "text-muted-foreground" : ""}`}
            onClick={handleLiveToggle}
          >
            <RefreshCw className={`h-4 w-4 ${isLive ? "animate-spin" : ""}`} />
            Live
          </Button>
          {!isSystem && selectedExtId && (
            <Link href={`/extensions/${selectedExtId}`}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Extension
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Status details row — extension only */}
      {selectedStatus && (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {selectedStatus.pid && <span>PID: <span className="font-mono">{selectedStatus.pid}</span></span>}
          {selectedStatus.uptimeSeconds != null && (
            <span>
              Uptime:{" "}
              <span className="font-mono">
                {Math.floor(selectedStatus.uptimeSeconds / 60)}m {selectedStatus.uptimeSeconds % 60}s
              </span>
            </span>
          )}
          {selectedStatus.lastStartedAt && (
            <span>
              Last start:{" "}
              <span className="font-mono">
                {new Date(selectedStatus.lastStartedAt).toLocaleString()}
              </span>
            </span>
          )}
          {selectedStatus.lastError && selectedStatus.status !== "registered" && (
            <span className="text-red-500">
              Last error: <span className="font-mono">{selectedStatus.lastError}</span>
            </span>
          )}
        </div>
      )}

      {/* Log terminal */}
      <Card className="border-muted">
        <CardContent className="p-0">
          <div className="rounded-lg bg-black overflow-hidden">
            <div className="p-4 h-[520px] overflow-y-auto font-mono text-xs space-y-0.5 leading-relaxed">
              {!isLive ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                  <RefreshCw className="h-6 w-6 opacity-40" />
                  <p className="italic text-sm">Click <strong className="text-white">Live</strong> to start streaming logs.</p>
                </div>
              ) : displayedLines.length === 0 ? (
                <p className="text-muted-foreground italic">
                  {isSystem
                    ? "Waiting for system events…"
                    : `Waiting for new output…${selectedStatus?.status === "stopped" ? " (deploy the agent first)" : ""}`}
                </p>
              ) : (
                displayedLines.map((line, i) => (
                  <p key={i} className={logLineClass(line)}>{line}</p>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
