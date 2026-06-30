/**
 * Client-side ring buffer that captures console.log / warn / error lines.
 * Imported once at startup; the feedback panel reads the last N lines.
 */
const MAX_LINES = 100;
const lines: string[] = [];

function capture(level: string, args: unknown[]): void {
  const text = args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  const stamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  lines.push(`[${stamp}] [${level}] ${text}`);
  if (lines.length > MAX_LINES) lines.shift();
}

const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);

console.log = (...args: unknown[]) => {
  capture("INFO", args);
  origLog(...args);
};
console.warn = (...args: unknown[]) => {
  capture("WARN", args);
  origWarn(...args);
};
console.error = (...args: unknown[]) => {
  capture("ERR", args);
  origError(...args);
};

/** Return the last `n` captured log lines. */
export function getLastLogLines(n = 50): string[] {
  return lines.slice(-n);
}
