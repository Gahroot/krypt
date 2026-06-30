/**
 * Optional error tracker — pipes exceptions to an external service (e.g. Sentry)
 * **only when a DSN is configured**. With no DSN this is a no-op, so the server has
 * zero hard dependency on any tracking SDK and nothing is sent off-box by default.
 *
 * Enable by setting `SENTRY_DSN` (or the generic `ERROR_TRACKER_DSN`). When set we
 * lazily `import("@sentry/node")` — a soft/optional dependency: if the package isn't
 * installed we warn once and degrade gracefully instead of crashing the boot.
 *
 * Tests (and alternative backends) can inject their own transport via `setErrorSink`.
 *
 * The DSN itself is a secret and is NEVER logged.
 */
import { log, redact, serializeError } from "./logger";

/** Extra structured context attached to a captured exception (redacted before send). */
export type CaptureContext = Record<string, unknown>;

/** A transport that ships a single error + context to a backend. */
export type ErrorSink = (error: Error, context?: CaptureContext) => void;

const DSN = process.env.SENTRY_DSN || process.env.ERROR_TRACKER_DSN || "";

let sink: ErrorSink | null = null;
let initialized = false;

/** True when a DSN is configured (i.e. exceptions will be shipped somewhere). */
export function errorTrackingEnabled(): boolean {
  return DSN.length > 0;
}

/**
 * Override the transport. Used by tests to assert capture happens, and as the seam
 * the default Sentry loader writes into. Passing `null` disables shipping.
 */
export function setErrorSink(fn: ErrorSink | null): void {
  sink = fn;
}

/**
 * Initialise tracking. Idempotent. No-op when no DSN is set. When a DSN is present
 * but a sink was already injected (tests / custom backend), the injected sink wins.
 */
export async function initErrorTracker(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!errorTrackingEnabled()) {
    log.info("error tracker disabled (no DSN configured)");
    return;
  }
  if (sink) {
    log.info("error tracker enabled (custom sink)");
    return;
  }

  // Lazy, dynamic import so `@sentry/node` is an OPTIONAL dependency. The string is
  // held in a variable so the bundler/compiler treats it as runtime-resolved and does
  // not require the module to be present at build time.
  const moduleName = "@sentry/node";
  try {
    const Sentry = (await import(moduleName)) as {
      init: (opts: Record<string, unknown>) => void;
      captureException: (err: unknown, hint?: Record<string, unknown>) => void;
    };
    Sentry.init({
      dsn: DSN,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0,
    });
    sink = (error, context) => {
      Sentry.captureException(error, { extra: redact(context ?? {}) as Record<string, unknown> });
    };
    log.info("error tracker enabled (sentry)");
  } catch {
    // DSN set but SDK missing — make it loud once, then carry on without shipping.
    log.warn(
      "error tracker DSN is set but '@sentry/node' is not installed — exceptions will be logged only. " +
        "Run `pnpm add @sentry/node` to enable remote capture.",
    );
  }
}

/**
 * Ship an exception to the configured tracker. Safe to call unconditionally: it is a
 * no-op when tracking is disabled, never throws, and never blocks the caller.
 */
export function captureException(err: unknown, context?: CaptureContext): void {
  if (!sink) return;
  const error = err instanceof Error ? err : new Error(String(err));
  try {
    sink(error, context);
  } catch (sinkErr) {
    log.warn("error tracker sink threw", { err: serializeError(sinkErr) });
  }
}
