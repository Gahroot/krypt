/**
 * Event system — config-driven live-ops framework.
 *
 * Events are date-gated flags defined in a server-side JSON config. Each event
 * can carry arbitrary effect multipliers (exp, drop, meso) and a player-facing
 * notice. Adding a new event is a config change — no code changes required.
 *
 * This module lives in @maple/shared (pure types + helpers) so the client can
 * type-check event payloads without importing server code.
 */

/** Effect multipliers an event can apply. All default to 1 (no effect). */
export interface EventEffects {
  /** EXP multiplier applied to all EXP grants (mob kills, quests, achievements). */
  expMultiplier?: number;
  /** Drop rate multiplier for item drops. */
  dropMultiplier?: number;
  /** Mesos multiplier for mob-kill meso rolls. */
  mesoMultiplier?: number;
}

/** One event definition as written in the config file. */
export interface EventDefinition {
  /** Unique event identifier (e.g. "double_exp_weekend_jul2026"). */
  id: string;
  /** Player-facing short name (e.g. "2× EXP Weekend"). */
  name: string;
  /** Longer description shown in the events notice (e.g. "All EXP gains doubled"). */
  description: string;
  /** Start time as epoch-ms (inclusive). */
  startAt: number;
  /** End time as epoch-ms (exclusive). */
  endAt: number;
  /** Effect multipliers active during this event. */
  effects: EventEffects;
  /** Optional banner color for UI (hex, e.g. "#FFD700"). */
  color?: string;
  /** Optional icon/emoji shown in the events notice. */
  icon?: string;
}

/**
 * A resolved, currently-active event — the runtime representation pushed to
 * clients. Strips the raw config and keeps only what the UI needs.
 */
export interface ActiveEvent {
  id: string;
  name: string;
  description: string;
  effects: EventEffects;
  color?: string;
  icon?: string;
  /** Epoch-ms when this event ends (for countdown displays). */
  endAt: number;
}

/** Server → client: sync of all currently active events. */
export interface EventsSyncPayload {
  events: ActiveEvent[];
}
