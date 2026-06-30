import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Status-effects slice — bridge state for the always-on buff/debuff icon strip
 * (StatusEffects.tsx, in the HUD layer).
 *
 * The Phaser `UIScene` owns the authoritative effect list (synced from the
 * server's STATUS_EFFECTS message and ticked down each frame) and pushes a plain
 * snapshot in via `publishStatusEffects`. React renders the strip with timers —
 * it never touches Phaser/Colyseus.
 */

/** A single active buff/debuff (mirror of shared StatusEffectInfo). */
export interface StatusEffectSnapshot {
  id: string;
  /** "buff" | "debuff" | "stun" | "hot" | "dot" | … — drives color + icon. */
  kind: string;
  label: string;
  stacks: number;
  durationMs: number;
  remainingMs: number;
}

export interface StatusEffectsSlice {
  statusEffects: StatusEffectSnapshot[];
  setStatusEffects: (effects: StatusEffectSnapshot[]) => void;
}

export const createStatusEffectsSlice: StateCreator<UIState, [], [], StatusEffectsSlice> = (
  set,
) => ({
  statusEffects: [],
  setStatusEffects: (effects) => set({ statusEffects: effects }),
});
