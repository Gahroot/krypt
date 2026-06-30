import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Coach-marks slice — bridge state for the onboarding hint overlay
 * (CoachMarks.tsx).
 *
 * The Phaser `CoachMarksScene` remains the driver: it polls the registry
 * `coachmark:<id>` flags MapScene/UIScene set on first action, gates them by the
 * per-character "seen" set, and owns the auto-dismiss timer + any-key/click
 * dismissal + persistence. It pushes the active hint in as a plain snapshot;
 * React renders the spotlight pill. There are no actions — dismissal flows
 * through the scene's own input listeners so behavior is preserved exactly.
 */

/** Where the hint anchors on screen (mirrors the legacy Phaser positions). */
export type CoachMarkPosition = "center-bottom" | "center" | "top-left";

/** One active onboarding hint pushed in from Phaser. */
export interface CoachMarkSnapshot {
  id: string;
  icon: string;
  title: string;
  detail: string;
  position: CoachMarkPosition;
}

export interface CoachMarksSlice {
  coachMark: CoachMarkSnapshot | null;
  setCoachMark: (snapshot: CoachMarkSnapshot | null) => void;
}

export const createCoachMarksSlice: StateCreator<UIState, [], [], CoachMarksSlice> = (set) => ({
  coachMark: null,
  setCoachMark: (snapshot) => set({ coachMark: snapshot }),
});
