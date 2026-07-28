import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DeployStatus {
  extensionId: number;
  status: "stopped" | "starting" | "registered" | "reconnecting" | "error";
  pid: number | null;
  sipLocalPort: number | null;
  httpPort: number | null;
  serviceName: string | null;
  sipRegistered: boolean;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  lastError: string | null;
  uptimeSeconds: number | null;
}

async function apiFetch(path: string, method = "GET") {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

export function useDeployStatus(extensionId: number, enabled = true) {
  return useQuery<DeployStatus>({
    queryKey: ["deploy-status", extensionId],
    queryFn: () => apiFetch(`/api/deploy/${extensionId}/status`),
    refetchInterval: 3000,
    enabled: enabled && !!extensionId,
  });
}

export function useAllDeployStatuses() {
  return useQuery<DeployStatus[]>({
    queryKey: ["deploy-status-all"],
    queryFn: () => apiFetch("/api/deploy/all"),
    refetchInterval: 5000,
  });
}

export function useDeployLogs(extensionId: number, enabled = false, live = false) {
  return useQuery<{ extensionId: number; lines: string[] }>({
    queryKey: ["deploy-logs", extensionId],
    queryFn: () => apiFetch(`/api/deploy/${extensionId}/logs`),
    refetchInterval: (enabled && live) ? 2000 : false,
    enabled: enabled && !!extensionId,
  });
}

export function useSystemLogs(enabled = false, live = false) {
  return useQuery<{ lines: string[] }>({
    queryKey: ["system-logs"],
    queryFn: () => apiFetch("/api/deploy/system/logs"),
    refetchInterval: (enabled && live) ? 2000 : false,
    enabled,
  });
}

function useDeployAction(extensionId: number, action: "start" | "stop" | "restart") {
  const qc = useQueryClient();
  return useMutation<DeployStatus>({
    mutationFn: () => apiFetch(`/api/deploy/${extensionId}/${action}`, "POST"),
    onSuccess: (data) => {
      qc.setQueryData(["deploy-status", extensionId], data);
      qc.invalidateQueries({ queryKey: ["deploy-status-all"] });
    },
  });
}

export function useStartExtension(extensionId: number) {
  return useDeployAction(extensionId, "start");
}
export function useStopExtension(extensionId: number) {
  return useDeployAction(extensionId, "stop");
}
export function useRestartExtension(extensionId: number) {
  return useDeployAction(extensionId, "restart");
}

export interface WatchdogState {
  enabled: boolean;
  pinging: boolean;
}

export function useWatchdogState(extensionId: number, enabled = true) {
  return useQuery<WatchdogState>({
    queryKey: ["watchdog-state", extensionId],
    queryFn: () => apiFetch(`/api/deploy/${extensionId}/watchdog`),
    refetchInterval: 5000,
    enabled: enabled && !!extensionId,
  });
}

export function useSetWatchdog(extensionId: number) {
  const qc = useQueryClient();
  return useMutation<WatchdogState, Error, boolean>({
    mutationFn: (enable: boolean) =>
      fetch(`/api/deploy/${extensionId}/watchdog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enable }),
      }).then(r => r.json()),
    onSuccess: (data) => {
      qc.setQueryData(["watchdog-state", extensionId], data);
    },
  });
}

export function statusLabel(status: DeployStatus["status"]) {
  switch (status) {
    case "registered":   return "Registered";
    case "starting":     return "Starting…";
    case "reconnecting": return "Reconnecting…";
    case "error":        return "Error";
    default:             return "Down";
  }
}

export function statusColor(status: DeployStatus["status"]) {
  switch (status) {
    case "registered":   return "text-green-600";
    case "starting":     return "text-yellow-500";
    case "reconnecting": return "text-orange-500";
    case "error":        return "text-red-500";
    default:             return "text-black dark:text-white";
  }
}

/**
 * Classify a raw SIP agent log line into one of four levels.
 *
 * ERROR  🔴 – real failures: connection refused, registration failed, panic, etc.
 * WARN   🟡 – expected-but-notable SIP events: OPTIONS, NOTIFY, retransmissions.
 * DEBUG  🔵 – low-level SIP protocol details: Authorization headers, SDP, Via, CSeq, etc.
 * INFO   🟢 – everything else (startup, registration success, AI provider connected).
 *
 * Key rule: a 401 Unauthorized inside a REGISTER exchange is a normal SIP
 * auth challenge (challenge → re-send with credentials → 200 OK).  It must
 * NOT be classified as an error.
 */
export function classifyLogLine(line: string): "error" | "warn" | "info" | "debug" {
  // Strip ISO timestamp prefix, e.g. "[2026-07-24T21:07:20.432Z] "
  const body = line.replace(/^\[[^\]]+\]\s*/, "").toLowerCase();

  // ── ERROR ──────────────────────────────────────────────────────────────
  if (body.includes("panic:") || body.includes("fatal error") || body.includes("fatal:")) return "error";
  if (body.includes("connection refused") || body.includes("no such host")) return "error";
  if (body.includes("registration failed")) return "error";
  if (body.includes("address already in use")) return "error";
  if (body.includes("error in sip server")) return "error";
  if (body.includes("403 forbidden") || body.includes("403 not auth")) return "error";
  // Generic "error" keyword — but skip lines that are just auth/digest protocol detail
  if (
    body.includes(" error") &&
    !body.includes("authorization") &&
    !body.includes("digest") &&
    !body.includes("auth:")
  ) return "error";

  // ── WARN ───────────────────────────────────────────────────────────────
  if (body.includes("warn")) return "warn";
  if (body.includes("retransmit")) return "warn";
  // OPTIONS and NOTIFY are SIP keepalive/event messages — routine but worth noting
  if (/\boptions\b/.test(body) || /\bnotify\b/.test(body)) return "warn";

  // ── DEBUG ──────────────────────────────────────────────────────────────
  // SIP auth challenge exchange (401 → re-send with Authorization) — normal, not an error
  if (body.includes("authorization:") || body.includes("auth:") || body.includes("digest")) return "debug";
  if (body.includes("resending register")) return "debug";
  if (body.includes("received register response")) return "debug";
  // Raw SIP headers
  if (/^\s*(via|cseq|contact|from|to|call-id|expires|server):/.test(body)) return "debug";
  if (body.includes("nonce=") || body.includes("realm=") || body.includes("algorithm=")) return "debug";
  // Network/IP resolution details
  if (body.includes("outbound ip") || body.includes("local ip") || body.includes("external ip")) return "debug";
  if (body.includes("debug:")) return "debug";
  // SDP / RTP
  if (body.includes(" sdp") || body.includes("rtp") || body.includes("srtp")) return "debug";

  // ── INFO ───────────────────────────────────────────────────────────────
  return "info";
}

/** Tailwind class for a log line's foreground colour. */
export function logLineClass(line: string): string {
  switch (classifyLogLine(line)) {
    case "error": return "text-red-400";
    case "warn":  return "text-yellow-400";
    case "debug": return "text-blue-300";
    default:      return "text-green-300";
  }
}
