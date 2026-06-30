/**
 * Backend connection config. The Colyseus server URL comes from VITE_BACKEND_URL (see .env.example),
 * defaulting to localhost for dev.
 */
export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? "ws://localhost:2567";

/** HTTP(S) base for the auth REST endpoints, derived from the WS backend URL. */
export const HTTP_BACKEND_URL: string = BACKEND_URL.replace(/^ws/, "http");

/**
 * How long (ms) to wait for `joinOrCreate` before giving up and showing a
 * retryable "connection timed out" screen. Configurable via `VITE_CONNECT_TIMEOUT_MS`
 * so remote testers on slow links can extend it. Clamped to a sane 2s..60s range,
 * defaulting to 12s.
 */
export const CONNECT_TIMEOUT_MS: number = (() => {
  const raw = import.meta.env.VITE_CONNECT_TIMEOUT_MS;
  const n = raw !== undefined ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 12_000;
  return Math.min(Math.max(n, 2_000), 60_000);
})();

const TOKEN_KEY = "cryptomaple.token";
const ACCOUNT_KEY = "cryptomaple.accountId";

/** The server-issued session token, or null if we haven't authenticated yet. */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * The server-issued account id (informational only — the server derives the real
 * identity from the signed token, never from this value). Populated by `authenticate()`.
 */
export function getAccountId(): string {
  return localStorage.getItem(ACCOUNT_KEY) ?? "";
}

/** The `{ token, accountId }` returned by every successful authentication call. */
export interface AuthResult {
  token: string;
  accountId: string;
}

/** Cache a fresh server-issued credential in localStorage and return it. */
function persistAuth(data: AuthResult): AuthResult {
  setToken(data.token);
  localStorage.setItem(ACCOUNT_KEY, data.accountId);
  // Every successful auth re-arms the proactive refresh so the session is renewed
  // shortly before its (short) TTL lapses — long play sessions never get kicked.
  scheduleAuthRefresh();
  return data;
}

// ─── Token expiry + proactive refresh ──────────────────────────────────────
function b64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return atob(input.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/** Read the `exp` (epoch-ms) claim from the stored token, or null if absent/unparseable. */
export function getTokenExpiry(): number | null {
  const token = getToken();
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(b64urlDecode(part)) as { exp?: number };
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
}

/** Refresh this far ahead of the token's actual expiry (a comfortable safety margin). */
const REFRESH_LEAD_MS = 60_000;
/** Never schedule a refresh sooner than this, to avoid a tight loop on odd clocks. */
const MIN_REFRESH_DELAY_MS = 5_000;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let onSessionExpired: (() => void) | null = null;

/**
 * Register the callback invoked when the session can no longer be kept alive
 * (token expired/revoked). The app routes back to login from here. Pass null to clear.
 */
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  onSessionExpired = fn;
}

/** Cancel any pending proactive refresh. */
export function stopAuthAutoRefresh(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Schedule a single proactive refresh shortly before the stored token expires,
 * re-arming itself after each success. On failure (expired/revoked) it surfaces the
 * session-expired handler so the app can cleanly force a re-login.
 */
export function scheduleAuthRefresh(): void {
  stopAuthAutoRefresh();
  const exp = getTokenExpiry();
  if (exp === null) return;
  const delay = Math.max(exp - Date.now() - REFRESH_LEAD_MS, MIN_REFRESH_DELAY_MS);
  refreshTimer = setTimeout(() => {
    void (async () => {
      const session = await refreshSession();
      // refreshSession persists on success, which re-arms via persistAuth. On
      // failure the session is gone — clear it and notify so we route to login.
      if (!session) handleSessionExpired();
    })();
  }, delay);
}

/**
 * Drop just the session credential (token + accountId) and stop auto-refresh,
 * PRESERVING local UI state (selected character, name, quickslots, channel,
 * settings) so a forced re-login resumes exactly where the player was. Then notify
 * the registered handler. Use `logout()` for a deliberate, full sign-out.
 */
export function handleSessionExpired(): void {
  clearSession();
  onSessionExpired?.();
}

/** Clear only the credential (token + accountId) and stop auto-refresh; keep UI state. */
export function clearSession(): void {
  stopAuthAutoRefresh();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
}

/**
 * POST to an `/auth/*` endpoint and persist the issued credential.
 *
 * Identity is ALWAYS server-issued — the response carries the trusted token +
 * accountId, which we cache. A non-2xx response (or a body missing the token)
 * throws with the server's error message so the login UI can surface it.
 */
async function postAuth(path: string, body?: unknown): Promise<AuthResult> {
  const res = await fetch(`${HTTP_BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AuthResult> & { error?: string };
  if (!res.ok || !data.token || !data.accountId) {
    throw new Error(data.error || `authentication failed (${res.status})`);
  }
  return persistAuth({ token: data.token, accountId: data.accountId });
}

/** Guest sign-in — mint a brand-new server-issued account so new players get in fast. */
export function guestSignIn(): Promise<AuthResult> {
  return postAuth("/auth/guest");
}

/** Email + password sign-in — recovers the SAME account on any browser. */
export function loginWithPassword(email: string, password: string): Promise<AuthResult> {
  return postAuth("/auth/login", { email, password });
}

/** Register a NEW credentialed account from an email + password. */
export function registerWithPassword(email: string, password: string): Promise<AuthResult> {
  return postAuth("/auth/register", { email, password });
}

/** Minimal EIP-1193 provider surface we use for wallet sign-in (e.g. MetaMask). */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function getEthereum(): Eip1193Provider | undefined {
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
}

/** True when a browser wallet is injected and "Connect Wallet" can be offered. */
export function isWalletAvailable(): boolean {
  return !!getEthereum();
}

/**
 * Wallet sign-in (EIP-191 personal_sign):
 *   1. request the address, 2. ask the server for a single-use nonce message,
 *   3. sign it with the wallet, 4. verify the signature server-side to find-or-
 *      create the account bound to that wallet and issue a token.
 */
export async function connectWallet(): Promise<AuthResult> {
  const eth = getEthereum();
  if (!eth) throw new Error("No browser wallet detected. Install MetaMask to continue.");

  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("No wallet account selected.");

  const nonceRes = await fetch(`${HTTP_BACKEND_URL}/auth/wallet/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const nonceData = (await nonceRes.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };
  if (!nonceRes.ok || !nonceData.message) {
    throw new Error(nonceData.error || "could not start wallet sign-in");
  }

  const signature = (await eth.request({
    method: "personal_sign",
    params: [nonceData.message, address],
  })) as string;

  return postAuth("/auth/wallet/verify", { address, signature });
}

/**
 * Silently refresh a still-valid stored token via `POST /auth/refresh { token }`,
 * keeping the SAME accountId and minting a fresh expiry. Returns null (without
 * falling back to guest) when there is no token or it has expired/been revoked —
 * the caller decides what to do next (e.g. show the login screen).
 */
export async function refreshSession(): Promise<AuthResult | null> {
  const existing = getToken();
  if (!existing) return null;
  try {
    const res = await fetch(`${HTTP_BACKEND_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: existing }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AuthResult;
    return persistAuth(data);
  } catch {
    return null;
  }
}

/**
 * Obtain a valid server-issued session token, caching it in localStorage.
 *
 * Identity is ALWAYS server-issued. We never let the client pick its own accountId:
 * refresh a still-valid stored token (keeping the SAME accountId), else mint a
 * fresh guest account so the game can still connect.
 *
 * Returns the `{ token, accountId }`. The token must be presented to the Colyseus
 * server (via `client.auth.token = token` and/or the join options) before joining.
 */
export async function authenticate(): Promise<AuthResult> {
  const refreshed = await refreshSession();
  if (refreshed) return refreshed;
  return guestSignIn();
}

/** Thrown by `authenticateForPlay()` when the account is banned; carries the server's reason. */
export class BannedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "BannedError";
  }
}

/**
 * Like `authenticate()`, but for entering the game world: when the stored session
 * belongs to a BANNED account the server's `/auth/refresh` replies `403` with the
 * ban reason — we surface that as a `BannedError` instead of silently minting a
 * fresh guest (which would hide the ban). Any other refresh failure still falls
 * back to a guest so first-time players can connect.
 */
export async function authenticateForPlay(): Promise<AuthResult> {
  const existing = getToken();
  if (existing) {
    try {
      const res = await fetch(`${HTTP_BACKEND_URL}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: existing }),
      });
      if (res.status === 403) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new BannedError(data.error || "Your account has been banned.");
      }
      if (res.ok) {
        return persistAuth((await res.json()) as AuthResult);
      }
    } catch (err) {
      // A genuine ban must propagate; a network/parse error falls through to guest.
      if (err instanceof BannedError) throw err;
    }
  }
  return guestSignIn();
}

/**
 * Log out: drop the cached credential + identity and any character bound to it so
 * the next boot returns to the login screen with a clean slate.
 */
export function logout(): void {
  stopAuthAutoRefresh();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
  localStorage.removeItem("cryptomaple.charId");
  localStorage.removeItem("cryptomaple.name");
}

/** A display name, editable later via UI. */
export function getPlayerName(): string {
  return localStorage.getItem("cryptomaple.name") ?? "Adventurer";
}

export function setPlayerName(name: string): void {
  localStorage.setItem("cryptomaple.name", name);
}

// ─── Character roster (multi-character accounts) ───────────────────────────────
import type { CharacterAppearance } from "@maple/shared";

/** A compact view of an account character, as returned by `GET /characters`. */
export interface CharacterSummary {
  charId: string;
  name: string;
  archetype: string;
  className: string;
  level: number;
  mapId: string;
  mapName: string;
}

/** The account roster plus the server-enforced slot cap. */
export interface CharacterRoster {
  characters: CharacterSummary[];
  max: number;
}

/** Read a `{ error }` body from a failed character request, defaulting sensibly. */
async function characterError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || fallback;
}

/**
 * List the authenticated account's characters. Always presents a freshly
 * refreshed server-issued token so identity is derived from the token, never the
 * client — the server only ever returns characters belonging to that account.
 */
export async function fetchCharacters(): Promise<CharacterRoster> {
  const { token } = await authenticate();
  const res = await fetch(`${HTTP_BACKEND_URL}/characters`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await characterError(res, "Could not load characters."));
  const data = (await res.json()) as Partial<CharacterRoster>;
  return { characters: data.characters ?? [], max: data.max ?? 0 };
}

/** Create a new character on the authenticated account; returns the new summary. */
export async function createCharacterRequest(
  name: string,
  appearance: CharacterAppearance,
): Promise<CharacterSummary> {
  const { token } = await authenticate();
  const res = await fetch(`${HTTP_BACKEND_URL}/characters`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, appearance }),
  });
  if (!res.ok) throw new Error(await characterError(res, "Could not create character."));
  const data = (await res.json()) as { character: CharacterSummary };
  return data.character;
}

/** Delete one of the authenticated account's characters. */
export async function deleteCharacterRequest(charId: string): Promise<void> {
  const { token } = await authenticate();
  const res = await fetch(`${HTTP_BACKEND_URL}/characters/${encodeURIComponent(charId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await characterError(res, "Could not delete character."));
}

/** Persisted character id, set after CREATE_CHARACTER succeeds. */
export function getCharId(): string | null {
  return localStorage.getItem("cryptomaple.charId");
}

export function setCharId(id: string): void {
  localStorage.setItem("cryptomaple.charId", id);
}

/** Persisted channel index, set after CHANNEL_SWITCH succeeds. Default 0. */
export function getCurrentChannel(): number {
  const raw = localStorage.getItem("cryptomaple.channel");
  const n = raw !== null ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function setCurrentChannel(ch: number): void {
  localStorage.setItem("cryptomaple.channel", String(ch));
}

/** A single quickslot entry — what's assigned to a slot. */
export interface QuickSlotEntry {
  type: "skill" | "consumable";
  id: string;
}

/** Read the quickslot layout for a character from localStorage. */
export function getQuickslots(charId: string): (QuickSlotEntry | null)[] {
  try {
    const raw = localStorage.getItem(`cryptomaple.quickslots.${charId}`);
    if (!raw) return [];
    return JSON.parse(raw) as (QuickSlotEntry | null)[];
  } catch {
    return [];
  }
}

/** Persist the quickslot layout for a character to localStorage. */
export function setQuickslots(charId: string, slots: (QuickSlotEntry | null)[]): void {
  localStorage.setItem(`cryptomaple.quickslots.${charId}`, JSON.stringify(slots));
}

// ─── Player settings (controls + video + audio + gameplay) ─────────────────────────────

import type { PlayerSettings } from "@maple/shared";

const SETTINGS_KEY = "cryptomaple.settings";

/** Read player settings from localStorage. Returns null if none saved. */
export function getSettings(): PlayerSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlayerSettings;
  } catch {
    return null;
  }
}

/** Persist player settings to localStorage. */
export function setSettings(settings: PlayerSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ─── Auto-Pot config ─────────────────────────────────────────────────────

export interface AutoPotConfig {
  hpEnabled: boolean;
  hpThreshold: number;
  mpEnabled: boolean;
  mpThreshold: number;
  hpPotionId: string;
  mpPotionId: string;
}

const DEFAULT_AUTO_POT: AutoPotConfig = {
  hpEnabled: false,
  hpThreshold: 50,
  mpEnabled: false,
  mpThreshold: 50,
  hpPotionId: "pot.large_hp",
  mpPotionId: "pot.large_mp",
};

export function getAutoPot(charId: string): AutoPotConfig {
  try {
    const raw = localStorage.getItem(`cryptomaple.autoPot.${charId}`);
    if (!raw) return DEFAULT_AUTO_POT;
    return { ...DEFAULT_AUTO_POT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_AUTO_POT;
  }
}

export function setAutoPot(charId: string, config: AutoPotConfig): void {
  localStorage.setItem(`cryptomaple.autoPot.${charId}`, JSON.stringify(config));
}

// ─── Skill Macros ────────────────────────────────────────────────────────

export interface MacroStep {
  type: "skill" | "consumable";
  id: string;
}

export interface SkillMacro {
  id: string;
  name: string;
  steps: MacroStep[];
}

export function getMacros(charId: string): SkillMacro[] {
  try {
    const raw = localStorage.getItem(`cryptomaple.macros.${charId}`);
    if (!raw) return [];
    return JSON.parse(raw) as SkillMacro[];
  } catch {
    return [];
  }
}

export function setMacros(charId: string, macros: SkillMacro[]): void {
  localStorage.setItem(`cryptomaple.macros.${charId}`, JSON.stringify(macros));
}

// ─── Coach marks (onboarding overlays — seen once per character) ───────────────

/** IDs of coach marks the player has already seen. */
export type CoachMarkId = "move" | "attack" | "jump" | "inventory" | "talk";

/** Read the set of coach mark IDs already dismissed for this character. */
export function getSeenCoachMarks(charId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`cryptomaple.coachmarks.${charId}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

/** Mark a single coach mark as seen for this character. */
export function markCoachMarkSeen(charId: string, id: CoachMarkId): void {
  const seen = getSeenCoachMarks(charId);
  seen.add(id);
  localStorage.setItem(`cryptomaple.coachmarks.${charId}`, JSON.stringify([...seen]));
}

// ─── Intro cinematic (seen once per character) ────────────────────────────────

/** Has this character already seen the Dawn Isle intro cinematic? */
export function hasSeenIntro(charId: string): boolean {
  return localStorage.getItem(`cryptomaple.intro.${charId}`) === "1";
}

/** Persist that this character has seen the intro. */
export function markIntroSeen(charId: string): void {
  localStorage.setItem(`cryptomaple.intro.${charId}`, "1");
}
