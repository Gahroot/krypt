/**
 * Wire types shared between the room and the client (the client imports these via `import type`,
 * the verified tutorial pattern). Keep this dependency-free so it's safe to import from the browser.
 */

/** Per-tick input the client sends; the server is authoritative over the resulting movement. */
export interface InputData {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Melee attack pressed this tick. */
  attack: boolean;
  /** Client tick counter, echoed back for reconciliation. */
  tick: number;
}

/** Message channels (numeric for compactness), mirrored on the client. */
export const MessageType = {
  INPUT: 0,
  PICKUP: 1,
} as const;
