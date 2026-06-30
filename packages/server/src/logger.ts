/**
 * Structured logger — one JSON object per line so logs are greppable and
 * machine-parseable (`… | grep '"level":"error"'`, `… | jq 'select(.room)'`).
 *
 * Design goals for the alpha ("see what breaks"):
 *   - **Levels** (`debug < info < warn < error`) with a runtime threshold (`LOG_LEVEL`).
 *   - **Context binding** via `log.child({ room, accountId, … })` so every line a
 *     room/request emits carries the same correlation fields without repetition.
 *   - **Error serialisation**: `Error` values become `{ name, message, stack }` instead
 *     of the useless `{}` you get from `JSON.stringify(new Error())`.
 *   - **Secret/PII redaction**: keys that look sensitive (token, password, secret,
 *     authorization, email, dsn, …) are replaced with `"[redacted]"` — recursively —
 *     so we never leak credentials or personal data into log sinks.
 *
 * No external dependencies. Human-readable pretty output is opt-in via `LOG_PRETTY=1`
 * (handy in a dev terminal); the default is JSON everywhere.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Arbitrary structured fields attached to a log line. */
export type LogMeta = Record<string, unknown>;

const isProd = process.env.NODE_ENV === "production";
const pretty = process.env.LOG_PRETTY === "1" || process.env.LOG_PRETTY === "true";

/** Minimum level that is emitted. Defaults to `debug` in dev, `info` in prod. */
const threshold: number = (() => {
  const raw = (process.env.LOG_LEVEL || "").toLowerCase() as LogLevel;
  if (raw in LEVEL_WEIGHT) return LEVEL_WEIGHT[raw];
  return isProd ? LEVEL_WEIGHT.info : LEVEL_WEIGHT.debug;
})();

// ─── Redaction ──────────────────────────────────────────────────────────────
/**
 * Substrings that mark a key as sensitive. Matching is case-insensitive and
 * substring-based, so `accessToken`, `AUTH_SECRET`, `x-api-key` all match.
 * `accountId`/`charId` are deliberately NOT here — they are internal correlation
 * ids (not secrets/PII) and are essential context when debugging.
 */
const SENSITIVE_KEY_PARTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "x-api-key",
  "privatekey",
  "private_key",
  "signature",
  "mnemonic",
  "seedphrase",
  "passphrase",
  "dsn",
  "email",
  "creditcard",
  "ssn",
];

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

/** Convert an `Error` (or thrown non-Error) into a plain, serialisable object. */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    // Preserve a wrapped cause (e.g. Colyseus RoomException → original error).
    if (err.cause !== undefined && err.cause !== err) {
      out.cause = err.cause instanceof Error ? serializeError(err.cause) : err.cause;
    }
    return out;
  }
  return { message: String(err) };
}

/**
 * Recursively redact sensitive keys and serialise Errors. Returns a structure
 * safe to `JSON.stringify`. Guards against cycles and runaway depth.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return serializeError(value);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
    } else if (val instanceof Error) {
      out[key] = serializeError(val);
    } else {
      out[key] = redact(val, depth + 1, seen);
    }
  }
  return out;
}

// ─── Emit ─────────────────────────────────────────────────────────────────────
function write(level: LogLevel, msg: string, context: LogMeta, meta?: LogMeta): void {
  if (LEVEL_WEIGHT[level] < threshold) return;

  const merged: LogMeta = { ...context, ...(meta ?? {}) };
  const safe = redact(merged) as LogMeta;

  if (pretty && !isProd) {
    const tag = Object.keys(safe).length ? " " + JSON.stringify(safe) : "";
    const line = `[${level}] ${msg}${tag}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }

  // Reserved fields (t/level/msg) are written LAST so a colliding meta key can never
  // shadow the timestamp, severity, or message — keeping logs reliably greppable.
  const record = JSON.stringify({ ...safe, t: new Date().toISOString(), level, msg });
  // Errors/warnings go to stderr so they survive stdout redirection and are easy to split.
  if (level === "error" || level === "warn") console.error(record);
  else console.log(record);
}

export interface Logger {
  debug(msg: string, meta?: LogMeta): void;
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
  /** Derive a logger that stamps `context` onto every line (merged under per-call meta). */
  child(context: LogMeta): Logger;
}

function makeLogger(context: LogMeta): Logger {
  return {
    debug: (msg, meta) => write("debug", msg, context, meta),
    info: (msg, meta) => write("info", msg, context, meta),
    warn: (msg, meta) => write("warn", msg, context, meta),
    error: (msg, meta) => write("error", msg, context, meta),
    child: (extra) => makeLogger({ ...context, ...extra }),
  };
}

/** Root logger. Use `log.child({ … })` to bind room/request correlation context. */
export const log: Logger = makeLogger({});
