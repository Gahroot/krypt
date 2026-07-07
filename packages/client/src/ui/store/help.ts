import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Help slice — bridge state for the always-available Help panel (F1).
 *
 * Lightweight: the panel is purely client-side (reads keybindings directly),
 * so this slice only tracks the open flag. No Phaser scene needed.
 */

export interface HelpSlice {
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}

export const createHelpSlice: StateCreator<UIState, [], [], HelpSlice> = (set) => ({
  helpOpen: false,
  setHelpOpen: (open) => set({ helpOpen: open }),
});
