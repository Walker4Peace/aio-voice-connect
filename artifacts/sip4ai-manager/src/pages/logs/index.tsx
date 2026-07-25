import React from "react";
import { Link } from "wouter";
import { useAllDeployStatuses, useDeployLogs, statusLabel, statusColor, logLineClass } from "@/hooks/use-deploy";
import { useListExtensions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, RefreshCw, Terminal } from "lucide-react";

export default function LogsPage() {
  const { data: extensions } = useListExtensions();
  const { data: allStatuses } = useAllDeployStatuses();
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [isLive, setIsLive] = React.useState(false);
  const [liveFromIndex, setLiveFromIndex] = React.useState<number | null>(null);
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-select first extension with a running agent
  React.useEffect(() => {
    if (selectedId == null && allStatuses && allStatuses.length > 0) {
      const running = allStatuses.find(
        (s) => s.status === "registered" || s.status === "starting"
      );
      setSelectedId(running?.extensionId ?? allStatuses[0]?.extensionId ?? null);
    }
  }, [allStatuses, selectedId]);

  // Reset live state when switching extension
  React.useEffect(() => {
    setLiveFromIndex(null);
    setIsLive(false);
  }, [selectedId]);

  const { data: logs, dataUpdatedAt } = useDeployLogs(
    selectedId ?? 0,
    selectedId != null,
    isLive
  );

  // Only show lines captured since live was started — stopped state shows nothing
  const displayedLines = React.useMemo(() => {
    if (!isLive || !logs?.lines || liveFromIndex === null) return [];
    return logs.lines.slice(liveFromIndex);
  }, [isLive, logs?.lines, liveFromIndex]);

  const handleLiveToggle = () => {
    if (!isLive) {
      // Capture current position — only new lines will be shown
      setLiveFromIndex(logs?.lines.length ?? 0);
      setIsLive(true);
    } else {
      setIsLive(false);
    }
  };

  // Scroll to bottom only during live mode
  React.useEffect(() => {
    if (isLive) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [displayedLines.length, isLive]);

  const selectedStatus = allStatuses?.find((s) => s.extensionId === selectedId);
  const selectedExtension = extensions?.find((e) => e.id === selectedId);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Logs</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Live stdout/stderr output from deployed SIP Agent processes.
        </p>
      </div>

      {/* Extension picker + status strip */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <Select
            value={selectedId?.toString() ?? ""}
            onValueChange={(v) => setSelectedId(Number(v))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select extension…" />
            </SelectTrigger>
            <SelectContent>
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
            className="gap-2"
            onClick={handleLiveToggle}
          >
            <RefreshCw className={`h-4 w-4 ${isLive ? "animate-spin" : ""}`} />
            {isLive ? "Live" : "Stopped"}
          </Button>
          {selectedId && (
            <Link href={`/extensions/${selectedId}`}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Extension
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Status details row */}
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
          {/* Only show lastError when the agent is NOT registered */}
          {selectedStatus.lastError && selectedStatus.status !== "registered" && (
            <span className="text-red-500">
              Last error: <span className="font-mono">{selectedStatus.lastError}</span>
            </span>
          )}
        </div>
      )}

      {/* Log terminal */}
      <Card className="border-muted">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              Process Output
              {selectedExtension && (
                <span className="text-muted-foreground font-normal text-sm">
                  — ext {selectedExtension.extensionNumber}
                </span>
              )}
            </CardTitle>
            {isLive && (
              <span className="text-xs text-muted-foreground">
                {displayedLines.length} new line{displayedLines.length !== 1 ? "s" : ""}
                {dataUpdatedAt ? ` · ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ""}
              </span>
            )}
          </div>
          <CardDescription>
            Click <strong>Live</strong> to stream new output. Lines are colour-coded:
            {" "}<span className="text-green-400">INFO</span>{" · "}
            <span className="text-yellow-400">WARN</span>{" · "}
            <span className="text-blue-400">DEBUG</span>{" · "}
            <span className="text-red-400">ERROR</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-b-lg bg-black overflow-hidden">
            <div
              className="p-4 h-[460px] overflow-y-auto font-mono text-xs space-y-0.5 leading-relaxed"
            >
              {!selectedId ? (
                <p className="text-muted-foreground italic">Select an extension above to view its logs.</p>
              ) : !isLive ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                  <RefreshCw className="h-6 w-6 opacity-40" />
                  <p className="italic text-sm">Click <strong className="text-white">Live</strong> to start streaming logs.</p>
                </div>
              ) : displayedLines.length === 0 ? (
                <p className="text-muted-foreground italic">
                  Waiting for new output…
                  {selectedStatus?.status === "stopped"
                    ? " (deploy the agent first)"
                    : ""}
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

      {/* All agents summary */}
      {allStatuses && allStatuses.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">All Agents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {allStatuses.map((s) => {
                const ext = extensions?.find((e) => e.id === s.extensionId);
                return (
                  <div
                    key={s.extensionId}
                    className="flex items-center justify-between py-2 text-sm cursor-pointer hover:bg-accent/30 rounded px-2 transition-colors"
                    onClick={() => setSelectedId(s.extensionId)}
                  >
                    <div className="flex items-center gap-3">
                      <Badge
                        variant="outline"
                        className={`text-xs ${statusColor(s.status)}`}
                      >
                        {s.status}
                      </Badge>
                      <span className="font-medium">
                        {ext?.extensionNumber ?? `#${s.extensionId}`}
                        {ext?.displayName ? (
                          <span className="text-muted-foreground font-normal ml-1">
                            ({ext.displayName})
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {s.uptimeSeconds != null && (
                        <span>
                          {Math.floor(s.uptimeSeconds / 60)}m {s.uptimeSeconds % 60}s
                        </span>
                      )}
                      {s.sipRegistered && (
                        <span className="text-green-500 font-medium">SIP ✓</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(s.extensionId);
                        }}
                      >
                        View logs
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
