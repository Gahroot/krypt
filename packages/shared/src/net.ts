/**
 * Network wire protocol — the input shape + message channels shared by client and server.
 * Lives in @maple/shared (dependency-free) so the browser never has to import server code.
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

/** Message channels (numeric for compactness), used by both sides of the TownRoom. */
export const MessageType = {
  INPUT: 0,
  PICKUP: 1,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];
