/**
 * In-memory system log buffer shared between the pino logger stream
 * and the deployment service.  Lives in its own module to avoid circular
 * imports (logger → deployment → logger).
 */

const MAX_SYSTEM_LOG_LINES = 300;
const systemLogBuffer: string[] = [];

const LEVEL_MAP: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

export type SystemLogCategory =
  | "DEPLOYMENT"
  | "WATCHDOG"
  | "STARTUP"
  | "YEASTAR"
  | "HTTP"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "DEBUG";

/** Add a manually constructed log line (used by deployment service). */
export function addSystemLog(
  line: string,
  category: SystemLogCategory = "DEPLOYMENT",
): void {
  const timestamp = new Date().toISOString();
  systemLogBuffer.push(`[${timestamp}] [${category}] ${line}`);
  if (systemLogBuffer.length > MAX_SYSTEM_LOG_LINES) systemLogBuffer.shift();
}

/**
 * Feed a parsed pino JSON log entry into the system buffer.
 * Filters out SIP proxy packet noise (those belong in extension logs).
 */
export function addSystemLogFromPino(json: Record<string, unknown>): void {
  // Skip SIP proxy packets — too noisy, already visible in extension logs
  if (json["msg"] === "SIP proxy packet") return;

  const levelNum = typeof json["level"] === "number" ? (json["level"] as number) : 30;
  const levelStr = LEVEL_MAP[levelNum] ?? "INFO";
  const timestamp =
    typeof json["time"] === "number"
      ? new Date(json["time"] as number).toISOString()
      : new Date().toISOString();

  let category: string = levelStr;
  let fullMsg =
    typeof json["msg"] === "string"
      ? (json["msg"] as string)
      : JSON.stringify(json["msg"]);

  // HTTP request/response — compress into a single readable line
  if (json["req"] && json["res"]) {
    const req = json["req"] as Record<string, unknown>;
    const res = json["res"] as Record<string, unknown>;
    const rt =
      typeof json["responseTime"] === "number"
        ? ` ${json["responseTime"] as number}ms`
        : "";
    category = "HTTP";
    fullMsg = `${req["method"]} ${req["url"]} → ${res["statusCode"]}${rt}`;
  } else {
    // Attach relevant context fields
    if (json["extensionId"] !== undefined)
      fullMsg = `[ext:${json["extensionId"]}] ${fullMsg}`;
    if (json["port"] !== undefined) fullMsg += ` port=${json["port"]}`;
    if (json["patchedBin"] !== undefined)
      fullMsg += ` bin=${json["patchedBin"]}`;
    // Error objects
    const errObj = (json["err"] ?? json["e"]) as Record<string, unknown> | undefined;
    if (errObj) {
      fullMsg += ` — ${typeof errObj["message"] === "string" ? errObj["message"] : JSON.stringify(errObj)}`;
    }
  }

  systemLogBuffer.push(`[${timestamp}] [${category}] ${fullMsg}`);
  if (systemLogBuffer.length > MAX_SYSTEM_LOG_LINES) systemLogBuffer.shift();
}

export function getSystemLogs(): string[] {
  return [...systemLogBuffer];
}

export function clearSystemLogs(): void {
  systemLogBuffer.length = 0;
}
