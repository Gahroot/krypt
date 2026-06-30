import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Chat slice — bridge state for the React chat box (ChatBox).
 *
 * The Phaser `UIScene` pushes the message scrollback in (`publishChat`) and
 * registers a chat action registry (`registerChatActions`) wired to the
 * authoritative chat `room.send(...)` messages. The chat box owns a REAL DOM
 * `<input>` — the Phaser canvas can't cleanly capture focus. Suppressing game
 * keybinds while typing is NOT chat's job: the shared input-routing policy
 * (ui/inputFocus.ts) detects any focused text field document-wide and tells
 * Phaser to ignore the keyboard, so this slice no longer reports focus itself.
 */

/** A chat channel / scope (mirror of shared ChatScope, minus "system"). */
export type ChatChannel = "map" | "whisper" | "party" | "guild";

/** A plain snapshot of one chat line. */
export interface ChatMessageSnapshot {
  /** Monotonic id for stable React keys. */
  id: number;
  name: string;
  text: string;
  /** Source channel, or "system" for server notices (shown on every tab). */
  scope: ChatChannel | "system";
}

/** Everything the chat box needs in one push from Phaser. */
export interface ChatSnapshot {
  messages: ChatMessageSnapshot[];
  /** Selectable channel tabs, in display order. */
  channels: ChatChannel[];
}

/** Imperative chat actions the scene wires so React can drive the game. */
export interface ChatActions {
  /** Send `text` on `channel` (handles slash commands + GM routing in Phaser). */
  send(channel: ChatChannel, text: string): void;
}

const EMPTY_CHAT: ChatSnapshot = {
  messages: [],
  channels: ["map", "whisper", "party", "guild"],
};

export interface ChatSlice {
  chat: ChatSnapshot;
  chatActions: ChatActions | null;
  /** Bumped by Phaser (Enter / whisper shortcut) to focus the DOM input. */
  chatFocusNonce: number;
  /** Text to seed the input with on the next focus request (e.g. "/w Bob "). */
  chatPrefill: string;

  setChat: (snapshot: ChatSnapshot) => void;
  setChatActions: (actions: ChatActions | null) => void;
  /** Focus the chat input, optionally seeding it with `prefill`. */
  requestChatFocus: (prefill?: string) => void;
}

export const createChatSlice: StateCreator<UIState, [], [], ChatSlice> = (set) => ({
  chat: EMPTY_CHAT,
  chatActions: null,
  chatFocusNonce: 0,
  chatPrefill: "",

  setChat: (snapshot) => set({ chat: snapshot }),
  setChatActions: (actions) => set({ chatActions: actions }),
  requestChatFocus: (prefill = "") =>
    set((s) => ({ chatFocusNonce: s.chatFocusNonce + 1, chatPrefill: prefill })),
});
