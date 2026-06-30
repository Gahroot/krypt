/**
 * Server-side validation and rate-limiting utilities for inbound client messages.
 *
 * Every public-facing room must sanitize inputs before trusting them. The client is
 * adversarial by design — nothing it sends is assumed correct.
 */
import { log } from "./logger";
import type { InputData } from "./types";

// ─── Rate Limiter (token bucket) ────────────────────────────────────────────

/**
 * Per-key token bucket rate limiter. Each key (typically a sessionId) gets
 * `maxTokens` tokens that refill at `refillPerMs` tokens per millisecond.
 * `consume()` returns `true` if a token was available, `false` if throttled.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private readonly maxTokens: number,
    private readonly refillPerMs: number,
  ) {}

  consume(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }
    // Refill tokens based on elapsed time.
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillPerMs);
      bucket.lastRefill = now;
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Remove a key (call on player leave to avoid memory leak). */
  delete(key: string): void {
    this.buckets.delete(key);
  }
}

// ─── Anomaly logging ────────────────────────────────────────────────────────

export function logAnomaly(sessionId: string, type: string, detail: string): void {
  log.warn("anomaly", { sessionId, type, detail });
}

// ─── Input sanitization ─────────────────────────────────────────────────────

/** Max safe 32-bit unsigned tick. */
const MAX_TICK = 0x7fffffff;

/**
 * Validate and clamp an inbound InputData payload.
 * Returns a clean InputData or `null` if the shape is unrecoverable.
 */
export function sanitizeInputData(msg: unknown): InputData | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  const tick = Number(m.tick);
  if (!Number.isFinite(tick)) return null;
  return {
    left: !!m.left,
    right: !!m.right,
    up: !!m.up,
    down: !!m.down,
    attack: !!m.attack,
    jump: !!m.jump,
    interact: !!m.interact,
    tick: Math.max(0, Math.min(MAX_TICK, Math.floor(tick))),
  };
}

// ─── String sanitization ────────────────────────────────────────────────────

/**
 * Strip null bytes, trim whitespace, and cap length.
 * Returns `""` if the input is not a string.
 */
export function sanitizeString(val: unknown, maxLen: number): string {
  if (typeof val !== "string") return "";

  return val.replace(/\0/g, "").trim().slice(0, maxLen);
}

// ─── Numeric sanitization ───────────────────────────────────────────────────

/** Validate a price: must be a finite positive integer, clamped to `max`. */
export function sanitizePrice(val: unknown, max = 1_000_000_000): number | null {
  const n = Math.floor(Number(val));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, max);
}

/** Validate a quantity: must be a finite positive integer, clamped to `max`. */
export function sanitizeQty(val: unknown, max = 9999): number | null {
  const n = Math.floor(Number(val));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, max);
}

// ─── ID sanitization ────────────────────────────────────────────────────────

/** Validate a listing ID: non-empty string, max 64 chars. */
export function sanitizeListingId(val: unknown): string | null {
  if (typeof val !== "string" || val.length === 0 || val.length > 64) return null;
  return val;
}

/** Validate a generic string ID (item UIDs, skill IDs, etc.). */
export function sanitizeId(val: unknown, maxLen = 64): string | null {
  if (typeof val !== "string" || val.length === 0 || val.length > maxLen) return null;
  return val;
}

// ─── Market MTS sanitization ───────────────────────────────────────────────

/** Max listing duration: 24 hours in ms. */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

/** Validate a listing duration in ms. Returns 0 for no expiry, or clamped to [10s, 24h]. */
export function sanitizeDuration(val: unknown): number {
  const n = Math.floor(Number(val));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const min = 10_000; // 10 second minimum
  return Math.min(MAX_DURATION_MS, Math.max(min, n));
}

/** Validate a bid amount: must be a positive integer, clamped to MAX_LIST_PRICE. */
export function sanitizeBidAmount(val: unknown, max = 1_000_000_000): number | null {
  const n = Math.floor(Number(val));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, max);
}
