/**
 * Live-ops event evaluator — config-driven event/flag system.
 *
 * Reads event definitions from events.json at boot (and on demand via
 * `reloadEvents()`). Evaluates which events are currently active based on
 * wall-clock time and exposes:
 *
 *   - `getActiveEvents()` → list of currently-active events (for sync to clients)
 *   - `getEventMultiplier(flag)` → the combined multiplier for a given effect flag
 *   - `reloadEvents()` → hot-reload the config file without a server restart
 *
 * ## Adding a new event
 *
 * 1. Add an entry to `packages/server/src/events.json`
 * 2. Done — no code changes needed. The event will activate when its startAt/endAt
 *    window is reached, and its effects will apply automatically.
 *
 * The sample event (double-EXP weekend) demonstrates the pattern.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger";
import type { EventDefinition, ActiveEvent, EventEffects } from "@maple/shared";

// ─── Config loading ──────────────────────────────────────────────────────────
/** Override with EVENTS_CONFIG_PATH env var to serve events from outside the build. */
const CONFIG_PATH =
  process.env.EVENTS_CONFIG_PATH || resolve(fileURLToPath(import.meta.url), "events.json");

let events: EventDefinition[] = [];

/** Load (or reload) the events config from disk. Called at boot and on demand. */
export function reloadEvents(): number {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    events = JSON.parse(raw) as EventDefinition[];
    log.info("events loaded", { count: events.length, path: CONFIG_PATH });
    return events.length;
  } catch (err) {
    log.error("failed to load events config", { err, path: CONFIG_PATH });
    events = [];
    return 0;
  }
}

// Load once at import time.
reloadEvents();

// ─── Active event resolution ─────────────────────────────────────────────────

/**
 * Return all events whose time window includes the given timestamp.
 * Default: now.
 */
export function getActiveEvents(now = Date.now()): ActiveEvent[] {
  return events
    .filter((e) => now >= e.startAt && now < e.endAt)
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      effects: e.effects,
      color: e.color,
      icon: e.icon,
      endAt: e.endAt,
    }));
}

/**
 * Compute the combined multiplier for a specific effect flag across all
 * active events. Returns 1.0 when no events affect this flag.
 *
 * Multipliers are multiplied together (stacking), so two 2× events = 4×.
 */
export function getEventMultiplier<K extends keyof EventEffects>(
  flag: K,
  now = Date.now(),
): NonNullable<EventEffects[K]> {
  let combined = 1;
  for (const event of events) {
    if (now >= event.startAt && now < event.endAt) {
      const value = event.effects[flag];
      if (typeof value === "number" && value > 0) {
        combined *= value;
      }
    }
  }
  return combined as NonNullable<EventEffects[K]>;
}

/**
 * Serialize the raw config for a public endpoint (e.g. GET /events).
 * Returns only the active events as a clean JSON payload.
 */
export function getEventsPayload(now = Date.now()): { events: ActiveEvent[] } {
  return { events: getActiveEvents(now) };
}
