import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Intro slice — bridge state for the Dawn Isle intro cinematic (IntroPanel.tsx).
 *
 * The Phaser `IntroScene` is a thin controller: it publishes the sequence of
 * lines as a plain snapshot, opens the panel, and registers a `complete` action.
 * React plays the line sequence (fade in → hold → crossfade) and handles
 * skip-on-key/click, then calls `complete()` — which the scene wires to its
 * existing finish() (mark intro seen + fade into MapScene for Dawn Isle).
 */

/** A single line of the intro sequence (mirror of the legacy IntroLine). */
export interface IntroLineSnapshot {
  text: string;
  /** How long this line stays visible before crossfading to the next (ms). */
  holdMs: number;
}

/** Everything the intro cinematic needs in one immutable push from Phaser. */
export interface IntroSnapshot {
  lines: IntroLineSnapshot[];
}

/** Imperative actions the scene wires so React can end the cinematic. */
export interface IntroActions {
  /** Finish (or skip) the intro — marks it seen and starts MapScene. */
  complete(): void;
}

const EMPTY_INTRO: IntroSnapshot = { lines: [] };

export interface IntroSlice {
  introOpen: boolean;
  intro: IntroSnapshot;
  introActions: IntroActions | null;

  setIntroOpen: (open: boolean) => void;
  setIntro: (snapshot: IntroSnapshot) => void;
  setIntroActions: (actions: IntroActions | null) => void;
}

export const createIntroSlice: StateCreator<UIState, [], [], IntroSlice> = (set) => ({
  introOpen: false,
  intro: EMPTY_INTRO,
  introActions: null,

  setIntroOpen: (open) => set({ introOpen: open }),
  setIntro: (snapshot) => set({ intro: snapshot }),
  setIntroActions: (actions) => set({ introActions: actions }),
});
