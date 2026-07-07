/**
 * Emotes — short-lived facial expressions and bubble icons triggered by hotkeys.
 *
 * Pure data. No runtime deps. Shared by server (validation) and client (display).
 * Each emote maps to an emoji shown in a bubble above the player's head.
 */

export interface EmoteDef {
  /** Stable wire id — the value sent over MessageType.EMOTE. */
  readonly id: string;
  /** Human-readable label for UI tooltips. */
  readonly label: string;
  /** Emoji character rendered inside the emote bubble. */
  readonly emoji: string;
  /** Keyboard shortcut hint shown in the emote wheel / tooltip. */
  readonly keyHint: string;
}

export const EMOTE_DEFS: readonly EmoteDef[] = [
  { id: "happy", label: "Happy", emoji: "😊", keyHint: "F1" },
  { id: "angry", label: "Angry", emoji: "😠", keyHint: "F2" },
  { id: "cry", label: "Cry", emoji: "😭", keyHint: "F3" },
  { id: "surprised", label: "Surprised", emoji: "😲", keyHint: "F4" },
  { id: "love", label: "Love", emoji: "😍", keyHint: "F5" },
  { id: "sweat", label: "Sweat", emoji: "😅", keyHint: "F6" },
  { id: "cool", label: "Cool", emoji: "😎", keyHint: "F7" },
  { id: "wave", label: "Wave", emoji: "👋", keyHint: "F8" },
] as const;

/** Set of all valid emote ids for O(1) membership checks. */
export const EMOTE_IDS: ReadonlySet<string> = new Set(EMOTE_DEFS.map((e) => e.id));

/** Look up an emote def by id. Returns `undefined` for invalid ids. */
export function getEmote(id: string): EmoteDef | undefined {
  return EMOTE_DEFS.find((e) => e.id === id);
}
