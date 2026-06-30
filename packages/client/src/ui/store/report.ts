import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Report slice — bridge state for the player-report modal (ReportDialog.tsx).
 *
 * Opened from the Phaser player context menu (`UIScene.openReportDialog`), which
 * pushes the target name + open flag in. React renders the modal on the shared
 * dialog primitive and submits through `reportActions.submit` — wired by the
 * scene to the authoritative PLAYER_REPORT message.
 */

export interface ReportActions {
  /** Submit a report for the current target with a free-text reason. */
  submit(reason: string): void;
  /** Dismiss the dialog without reporting. */
  close(): void;
}

export interface ReportSlice {
  reportOpen: boolean;
  reportTargetName: string;
  reportActions: ReportActions | null;

  setReportOpen: (open: boolean) => void;
  setReportTarget: (name: string) => void;
  setReportActions: (actions: ReportActions | null) => void;
}

export const createReportSlice: StateCreator<UIState, [], [], ReportSlice> = (set) => ({
  reportOpen: false,
  reportTargetName: "",
  reportActions: null,

  setReportOpen: (open) => set({ reportOpen: open }),
  setReportTarget: (name) => set({ reportTargetName: name }),
  setReportActions: (actions) => set({ reportActions: actions }),
});
