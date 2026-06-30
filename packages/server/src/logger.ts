/**
 * Structured logger — JSON in production, human-readable in dev.
 * No external dependencies.
 */
const isProd = process.env.NODE_ENV === "production";

function fmt(level: string, msg: string, meta?: Record<string, unknown>): void {
  if (isProd) {
    console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta }));
  } else {
    const tag = meta ? " " + JSON.stringify(meta) : "";
    console.log(`[${level}] ${msg}${tag}`);
  }
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => fmt("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => fmt("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => fmt("error", msg, meta),
};
