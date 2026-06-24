/**
 * Backend connection config. The Colyseus server URL comes from VITE_BACKEND_URL (see .env.example),
 * defaulting to localhost for dev.
 */
export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? "ws://localhost:2567";

/**
 * A stable per-browser account id so your Mesos + items persist across reloads and are shared
 * between the town and the market. Phase 2 replaces this with a real wallet address.
 */
export function getAccountId(): string {
  const KEY = "cryptomaple.accountId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `web_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

/** A display name, editable later via UI. */
export function getPlayerName(): string {
  return localStorage.getItem("cryptomaple.name") ?? "Adventurer";
}
