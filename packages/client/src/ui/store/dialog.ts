import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Dialog slice — bridge state for the React NPC dialog overlay (DialogPanel).
 *
 * Follows the reference inventory slice: a plain, serializable snapshot pushed
 * in from Phaser (`UIScene.publishDialog`, mirrored from the registry dialog
 * state MapScene sets on each `DIALOG` message) plus a per-feature action
 * registry the scene wires to the authoritative `DIALOG_CHOICE` message. React
 * reads the snapshot and calls the actions — it never touches Phaser/Colyseus.
 *
 * The downstream effects of a choice (open shop / travel / advance job / …) are
 * driven entirely server-side: the server walks the NPC dialog tree and replies
 * with the matching message (`shop_open`, `TRAVEL`, `BRANCH_LIST`, …), which
 * MapScene already handles. The client only ever sends the chosen index.
 */

/** One branching choice button (mirror of the server DialogLinePayload choice). */
export interface DialogChoiceSnapshot {
  label: string;
  index: number;
}

/** Everything the dialog box needs in one immutable push from Phaser. */
export interface DialogSnapshot {
  npcId: string;
  npcName: string;
  text: string;
  /** Branch choices to show as buttons, or null for a plain line node. */
  choices: DialogChoiceSnapshot[] | null;
  /** True when this line node has more text following (show "Next"). */
  hasNext: boolean;
}

/** Imperative actions the scene wires so React can walk the dialog tree. */
export interface DialogActions {
  /** Advance a line node (sends `DIALOG_CHOICE` with index -1). */
  next(): void;
  /** Pick a branch choice by its server-assigned index. */
  choose(index: number): void;
  /** Close / end the dialog (sends `DIALOG_CHOICE` with index -1). */
  close(): void;
}

export interface DialogSlice {
  dialogOpen: boolean;
  dialog: DialogSnapshot | null;
  dialogActions: DialogActions | null;

  setDialog: (snapshot: DialogSnapshot | null) => void;
  setDialogActions: (actions: DialogActions | null) => void;
}

export const createDialogSlice: StateCreator<UIState, [], [], DialogSlice> = (set) => ({
  dialogOpen: false,
  dialog: null,
  dialogActions: null,

  setDialog: (snapshot) => set({ dialog: snapshot, dialogOpen: snapshot !== null }),
  setDialogActions: (actions) => set({ dialogActions: actions }),
});
