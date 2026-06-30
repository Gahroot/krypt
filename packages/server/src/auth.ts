/**
 * Authentication — server-issued, signed session tokens.
 *
 * The trust model: identity (`accountId`) is **server-issued**, never client-chosen.
 * A client authenticates once (guest or login) over HTTP, receives a compact
 * HMAC-SHA256-signed token bound to its accountId, and presents that token on every
 * room join. Rooms derive the trusted accountId from the verified token (via the
 * static `onAuth` hook) — never from `options.accountId`.
 *
 * The token is a minimal JWT (`header.payload.signature`, base64url, HS256). We sign
 * with Node's built-in `crypto` so there is no extra dependency.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { verifyMessage } from "viem";
import { log } from "./logger";

// ─── Secret resolution ────────────────────────────────────────────────────────
/**
 * The HMAC secret. Provide `AUTH_SECRET` in the environment for stable tokens
 * across restarts. When unset we generate an ephemeral per-process secret —
 * fine for local dev / tests (sign + verify happen in the same process) but it
 * means tokens are invalidated on restart. In production a missing secret is a
 * misconfiguration: we still boot (with a random secret) but warn loudly.
 */
const AUTH_SECRET: string = (() => {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  const generated = randomBytes(32).toString("hex");
  if (process.env.NODE_ENV === "production") {
    log.warn(
      "AUTH_SECRET is unset or too short — using an ephemeral secret. " +
        "Set AUTH_SECRET (>=16 chars) so sessions survive restarts.",
    );
  }
  return generated;
})();

/**
 * Default session-token lifetime. Short by design: clients refresh proactively via
 * `POST /auth/refresh` before it lapses (so long play sessions never get kicked),
 * and a leaked token has only a small window of use. Configurable via
 * `AUTH_TOKEN_TTL_SECONDS` (default 3600 = 1 hour), clamped to a sane
 * [1 minute, 30 day] range.
 */
export const DEFAULT_TTL_MS: number = (() => {
  const FALLBACK = 60 * 60 * 1000; // 1 hour
  const MIN = 60 * 1000; // 1 minute floor
  const MAX = 30 * 24 * 60 * 60 * 1000; // 30 day ceiling
  const raw = process.env.AUTH_TOKEN_TTL_SECONDS;
  if (!raw) return FALLBACK;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs <= 0) return FALLBACK;
  return Math.min(Math.max(secs * 1000, MIN), MAX);
})();

// ─── base64url helpers ─────────────────────────────────────────────────────────
function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(data: string): string {
  return b64url(createHmac("sha256", AUTH_SECRET).update(data).digest());
}

// ─── Token payload ─────────────────────────────────────────────────────────────
interface TokenPayload {
  /** Subject — the trusted accountId. */
  sub: string;
  /** Issued-at (ms epoch). */
  iat: number;
  /** Expiry (ms epoch). */
  exp: number;
}

/** A new server-issued guest accountId. Uses 16 hex chars (64 bits) to defeat brute-force. */
export function newGuestAccountId(): string {
  return `web_${randomBytes(8).toString("hex")}`;
}

/** A new server-issued accountId for a credentialed (registered/wallet) account. */
export function newAccountId(): string {
  return `acc_${randomBytes(8).toString("hex")}`;
}

// ─── Password hashing (bcrypt — salted + slow by design) ───────────────────────
/**
 * bcrypt work factor. 12 is a sane 2025 default (~250ms/hash) — high enough to
 * make offline cracking expensive, low enough to keep login snappy.
 */
const BCRYPT_ROUNDS = 12;

/** Minimum password length we accept at registration / claim. */
export const MIN_PASSWORD_LENGTH = 8;

/** Hash a plaintext password with a per-password random salt. Never logs the input. */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a stored bcrypt hash. bcrypt.compare is constant-time
 * with respect to the hash, so it does not leak match progress via timing.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * A precomputed bcrypt hash of a value no user can enter. Verify against this when an
 * email is unknown so login takes the same time whether or not the account exists —
 * defeating account-enumeration via response timing.
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  `\0nonexistent\0${randomBytes(8).toString("hex")}`,
  BCRYPT_ROUNDS,
);

// ─── Email / wallet validation ─────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

/** Normalize an email for storage + lookup (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Whether a string is a plausibly-valid email (length-capped to avoid abuse). */
export function isValidEmail(email: string): boolean {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email.trim());
}

/** Normalize an EVM address for storage + lookup (trim + lowercase). */
export function normalizeWallet(address: string): string {
  return address.trim().toLowerCase();
}

/** Whether a string is a well-formed 0x EVM address. */
export function isValidWalletAddress(address: string): boolean {
  return typeof address === "string" && WALLET_RE.test(address.trim());
}

// ─── "Sign in with wallet" — EIP-191 nonce challenge ───────────────────────────
/** How long a wallet sign-in nonce stays valid. */
const WALLET_NONCE_TTL_MS = 5 * 60_000;

/** Pending nonces: normalized address → { nonce, expiry }. Single-use, in-memory. */
const walletNonces = new Map<string, { nonce: string; exp: number }>();

/** The exact human-readable message a wallet must sign for `nonce`. */
export function walletLoginMessage(nonce: string): string {
  return `CryptoMaple wants you to sign in.\n\nThis request will not trigger a transaction or cost any gas.\n\nNonce: ${nonce}`;
}

/**
 * Issue a fresh sign-in nonce for `address` and return the exact message the client
 * must sign. Overwrites any prior pending nonce for that address (single outstanding
 * challenge per wallet).
 */
export function issueWalletNonce(address: string): { nonce: string; message: string } {
  const nonce = randomBytes(16).toString("hex");
  walletNonces.set(normalizeWallet(address), { nonce, exp: Date.now() + WALLET_NONCE_TTL_MS });
  return { nonce, message: walletLoginMessage(nonce) };
}

/**
 * Verify an EIP-191 (`personal_sign`) signature over the message we issued for
 * `address`. The nonce is consumed on the first attempt (success OR failure) so a
 * captured signature can never be replayed. Returns true only when the signature
 * recovers to `address` and the nonce was still valid.
 */
export async function verifyWalletSignature(address: string, signature: string): Promise<boolean> {
  if (!isValidWalletAddress(address) || typeof signature !== "string") return false;
  const key = normalizeWallet(address);
  const entry = walletNonces.get(key);
  if (!entry) return false;
  walletNonces.delete(key); // single-use — consume regardless of outcome.
  if (Date.now() >= entry.exp) return false;
  try {
    return await verifyMessage({
      address: address as `0x${string}`,
      message: walletLoginMessage(entry.nonce),
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

// ─── Login rate limiting (per key, fixed window) ───────────────────────────────
/** Max login/verify attempts allowed per key within the window. */
const LOGIN_RATE_MAX = 10;
/** Rate-limit window (ms). */
const LOGIN_RATE_WINDOW_MS = 5 * 60_000;
/** key (e.g. ip+email) → recent attempt timestamps. */
const loginAttempts = new Map<string, number[]>();

/**
 * Record an attempt for `key` and report whether it is now rate-limited.
 * Returns true when the caller has exceeded the allowance (caller should 429).
 */
export function loginRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (loginAttempts.get(key) ?? []).filter((t) => now - t < LOGIN_RATE_WINDOW_MS);
  if (recent.length >= LOGIN_RATE_MAX) {
    loginAttempts.set(key, recent);
    return true;
  }
  recent.push(now);
  loginAttempts.set(key, recent);
  return false;
}

/** Clear the rate-limit counter for a key (call after a successful login). */
export function resetLoginRate(key: string): void {
  loginAttempts.delete(key);
}

/** Issue a signed session token bound to `accountId`. */
export function signToken(accountId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Date.now();
  const payload: TokenPayload = { sub: accountId, iat: now, exp: now + ttlMs };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify a token and return the trusted `{ accountId }`, or `null` when the token
 * is missing, malformed, tampered, or expired.
 */
export function verifyToken(token: string | undefined | null): { accountId: string } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) return null;

  // Constant-time signature comparison.
  const expected = sign(`${encodedHeader}.${encodedPayload}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(encodedPayload).toString("utf8")) as TokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.exp !== "number" || Date.now() >= payload.exp) return null;

  return { accountId: payload.sub.slice(0, 64) };
}
