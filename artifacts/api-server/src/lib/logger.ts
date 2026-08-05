import pino from "pino";
import { Writable } from "stream";
import { addSystemLogFromPino } from "./system-log-buffer.js";

const isProduction = process.env.NODE_ENV === "production";

/**
 * A writable stream that parses newline-delimited pino JSON entries and feeds
 * them into the in-memory system log buffer (shown in the General tab of the
 * Logs page).  SIP proxy packet lines are filtered out inside addSystemLogFromPino.
 */
class SystemLogStream extends Writable {
  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: () => void,
  ): void {
    try {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed) as Record<string, unknown>;
          addSystemLogFromPino(json);
        } catch {
          // Not valid JSON — skip (e.g. pino-pretty decorations in dev)
        }
      }
    } catch {
      // Guard against any unexpected stream errors
    }
    callback();
  }
}

const systemStream = new SystemLogStream();

const pinoBaseOpts: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
};

export const logger = isProduction
  ? // Production: JSON to stdout + capture every entry into the in-memory buffer
    pino(
      pinoBaseOpts,
      pino.multistream([
        { stream: process.stdout, level: (process.env.LOG_LEVEL ?? "info") as pino.Level },
        { stream: systemStream,   level: (process.env.LOG_LEVEL ?? "info") as pino.Level },
      ]),
    )
  : // Development: pretty-print to stdout AND capture to buffer
    pino(
      {
        ...pinoBaseOpts,
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      },
    );

// In development mode, wire up an additional JSON-serialising logger that
// feeds the buffer (pino-pretty output cannot be re-parsed as JSON).
if (!isProduction) {
  const devCapture = pino(
    { level: process.env.LOG_LEVEL ?? "info" },
    systemStream,
  );
  // Replace logger methods with wrappers that call both loggers
  const levels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
  for (const lvl of levels) {
    const original = (logger[lvl] as (...args: unknown[]) => void).bind(logger);
    const capture  = (devCapture[lvl] as (...args: unknown[]) => void).bind(devCapture);
    (logger as unknown as Record<string, unknown>)[lvl] = (...args: unknown[]) => {
      original(...args);
      capture(...args);
    };
  }
}
