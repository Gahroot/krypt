/**
 * Effects — timed status effects applied by skills, consumables, and mobs.
 *
 * Every function is pure and deterministic, consistent with @maple/shared conventions.
 * Both the authoritative server and the prediction client run the same logic.
 *
 * Effect kinds:
 *  • buff    — positive stat modifier that expires after durationMs.
 *  • debuff  — negative stat modifier that expires after durationMs.
 *  • dot     — damage-over-time: ticks tickDamage every tickMs.
 *  • hot     — heal-over-time: ticks +tickDamage (absolute HP heal) every tickMs.
 *  • stun    — prevents action; no secondary stat modifier.
 */

import type { SecondaryStats } from "./stats.js";
import {
  type BuffEffect,
  type DebuffEffect,
  type ClassArchetype,
  allSkillsForClass,
} from "./classes.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type EffectKind = "buff" | "debuff" | "dot" | "hot" | "stun";

export interface StatusEffect {
  /** Unique id (e.g. "warrior.rally", "pot.power_elixir"). */
  readonly id: string;
  /** Categorises the effect for tick / expiry / aggregation logic. */
  readonly kind: EffectKind;
  /** Stat modifiers applied while the effect is active (buff/debuff). */
  readonly secondary?: Partial<SecondaryStats>;
  /** Damage dealt (dot) or HP healed (hot) per tick. Positive value always. */
  readonly tickDamage?: number;
  /** Interval between ticks in ms (dot/hot only). */
  readonly tickMs?: number;
  /** Total duration in ms; effect is removed when elapsed ≥ durationMs. */
  readonly durationMs: number;
  /** Current stack count (1 = no stacking). */
  readonly stacks: number;
  /** Free-form label: who or what applied this effect (e.g. "warrior.rally", "player:42"). */
  readonly source: string;
}

export interface EffectTickResult {
  /** Remaining active effects after this tick (expired ones removed). */
  readonly active: StatusEffect[];
  /** Net HP delta from DoT/HoT ticks this step (negative = damage, positive = heal). */
  readonly hpDelta: number;
  /** Net MP delta from ticks this step (0 for now; reserved for mana-drain effects). */
  readonly mpDelta: number;
}

// ── Stacking rules ──────────────────────────────────────────────────────────

/**
 * Maximum number of stacks a single effect can have.
 * Exposed as a constant so both server and client agree.
 */
export const MAX_STACKS = 5;

/**
 * Default stacking policy: refresh duration and add a stack (capped at MAX_STACKS).
 * The `stacks` field on StatusEffect is mutated-free — a new object is returned.
 */
function stackOrRefresh(existing: StatusEffect, incoming: StatusEffect): StatusEffect {
  const newStacks = Math.min(existing.stacks + 1, MAX_STACKS);
  return {
    ...existing,
    stacks: newStacks,
    durationMs: incoming.durationMs, // refresh window
  };
}

// ── applyEffect ─────────────────────────────────────────────────────────────

/**
 * Apply a new StatusEffect onto an existing list.
 *
 * Stacking / refresh rules:
 *  1. If an effect with the same `id` already exists:
 *       a) If `stacks < MAX_STACKS` → increment stacks, refresh duration.
 *       b) If already at max stacks → refresh duration only.
 *  2. If no duplicate → append the new effect.
 *
 * @param active  Current list of active effects (not mutated).
 * @param next    The new effect to apply.
 * @returns       A **new** array with the effect applied.
 */
export function applyEffect(active: StatusEffect[], next: StatusEffect): StatusEffect[] {
  const idx = active.findIndex((e) => e.id === next.id);

  if (idx === -1) {
    return [...active, { ...next }];
  }

  const existing = active[idx];
  if (existing === undefined) {
    return [...active, { ...next }];
  }
  const updated = stackOrRefresh(existing, next);

  return active.map((e, i) => (i === idx ? updated : e));
}

// ── tickEffects ─────────────────────────────────────────────────────────────

/**
 * Advance all active effects by `dtMs` milliseconds, resolve DoT/HoT ticks,
 * and remove expired effects.
 *
 * Ticking model:
 *  • Each effect carries an internal `elapsedMs` counter tracked implicitly
 *    via a mutable map keyed by effect id. To keep the public API pure, callers
 *    must pass the same `elapsedMap` across ticks for the same entity.
 *  • When `elapsedMs >= tickMs` a DoT/HoT fires and the counter resets.
 *  • When `elapsedMs >= durationMs` the effect is removed.
 *
 * @param active     Current active effects.
 * @param dtMs       Time elapsed since last tick (ms).
 * @param elapsedMap Mutable map tracking per-effect elapsed time. Caller-owned.
 * @returns          Tick result with updated effects and HP/MP deltas.
 */
export function tickEffects(
  active: StatusEffect[],
  dtMs: number,
  elapsedMap: Map<string, number>,
): EffectTickResult {
  let hpDelta = 0;
  const mpDelta = 0;

  const remaining: StatusEffect[] = [];

  for (const effect of active) {
    const prev = elapsedMap.get(effect.id) ?? 0;
    const next = prev + dtMs;

    // Check expiry.
    if (next >= effect.durationMs) {
      elapsedMap.delete(effect.id);
      continue;
    }

    elapsedMap.set(effect.id, next);

    // Resolve DoT / HoT ticks.
    if ((effect.kind === "dot" || effect.kind === "hot") && effect.tickMs && effect.tickMs > 0) {
      const dmg = effect.tickDamage ?? 0;
      if (dmg > 0) {
        const ticksFired = Math.floor(next / effect.tickMs) - Math.floor(prev / effect.tickMs);
        const signed =
          effect.kind === "dot"
            ? -dmg * ticksFired * effect.stacks
            : dmg * ticksFired * effect.stacks;
        hpDelta += signed;
      }
    }

    remaining.push(effect);
  }

  return { active: remaining, hpDelta, mpDelta };
}

// ── aggregateSecondary ──────────────────────────────────────────────────────

/**
 * Sum all `secondary` modifiers from buff/debuff effects in the active list.
 * Only `kind: 'buff'` and `kind: 'debuff'` contribute; dot/hot/stun are ignored.
 * Values are already signed by the caller (positive for buffs, negative for debuffs)
 * and scaled by stack count.
 *
 * @param active  Active effects to aggregate.
 * @returns       A Partial<SecondaryStats> delta to fold into deriveSecondary.
 */
export function aggregateSecondary(active: StatusEffect[]): Partial<SecondaryStats> {
  const delta: Record<string, number> = {};

  for (const effect of active) {
    if (effect.kind !== "buff" && effect.kind !== "debuff") continue;
    if (!effect.secondary) continue;

    for (const [key, val] of Object.entries(effect.secondary)) {
      if (val === undefined || val === 0) continue;
      delta[key] = (delta[key] ?? 0) + (val as number) * effect.stacks;
    }
  }

  return delta as Partial<SecondaryStats>;
}

// ── Mapping helpers ─────────────────────────────────────────────────────────

/**
 * Resolve a BuffEffect (from SkillDef) into a SecondaryStats partial.
 * Maps the semantic buff fields to concrete secondary stat keys.
 */
export function buffEffectToSecondary(bf: BuffEffect): Partial<SecondaryStats> {
  if ("atkPercent" in bf) return { atk: bf.atkPercent };
  if ("defPercent" in bf) return { wDef: bf.defPercent, mDef: bf.defPercent };
  if ("speed" in bf) return { speed: bf.speed };
  if ("jump" in bf) return { jump: bf.jump };
  if ("hpMpRegen" in bf) return { hpRegen: bf.hpMpRegen, mpRegen: bf.hpMpRegen };
  if ("mpPercent" in bf) return {}; // MP% handled separately by caller
  return {};
}

/**
 * Convert a skill's buff config into a StatusEffect ready for applyEffect.
 *
 * @param skillId      The skill's id (e.g. "warrior.rally").
 * @param buffEffect   The BuffEffect from SkillCombatStats.
 * @param durationMs   Buff duration in ms.
 * @param source       Who applied it (typically the caster's id).
 * @returns            A StatusEffect of kind "buff".
 */
export function skillBuffToStatusEffect(
  skillId: string,
  buffEffect: BuffEffect,
  durationMs: number,
  source: string,
): StatusEffect {
  return {
    id: skillId,
    kind: "buff",
    secondary: buffEffectToSecondary(buffEffect),
    durationMs,
    stacks: 1,
    source,
  };
}

/**
 * Convert a skill's debuff config into a StatusEffect ready for applyEffect.
 *
 * @param skillId    The skill's id (e.g. "warrior.battle_cry").
 * @param debuff     The DebuffEffect from SkillCombatStats.
 * @param source     Who applied it (typically the caster's id/name).
 * @returns          One or more StatusEffects (stun → 1, slow → 1 debuff, poison → 1 dot).
 */
export function skillDebuffToStatusEffects(
  skillId: string,
  debuff: DebuffEffect,
  source: string,
): StatusEffect[] {
  const effects: StatusEffect[] = [];

  if ("stunMs" in debuff) {
    effects.push({
      id: `${skillId}.stun`,
      kind: "stun",
      durationMs: debuff.stunMs,
      stacks: 1,
      source,
    });
  } else if ("slowPercent" in debuff) {
    effects.push({
      id: `${skillId}.slow`,
      kind: "debuff",
      secondary: { speed: -debuff.slowPercent },
      durationMs: debuff.slowMs,
      stacks: 1,
      source,
    });
  } else if ("poisonTickDamage" in debuff) {
    effects.push({
      id: `${skillId}.poison`,
      kind: "dot",
      tickDamage: debuff.poisonTickDamage,
      tickMs: debuff.poisonTickMs,
      durationMs: debuff.poisonMs,
      stacks: 1,
      source,
    });
  }

  return effects;
}

/** Returns true if any active effect is a stun. */
export function isStunned(active: StatusEffect[]): boolean {
  return active.some((e) => e.kind === "stun");
}

/**
 * Compute the slow multiplier from active debuff effects.
 * Returns 1.0 (no slow) or a value < 1 (e.g. 0.7 for 30% slow).
 * Multiple slow debuffs stack additively but are capped at 70% slow (minimum 0.3x speed).
 */
export function getSlowMultiplier(active: StatusEffect[]): number {
  let slowPercent = 0;
  for (const e of active) {
    if (e.kind !== "debuff" || !e.secondary?.speed) continue;
    // speed is negative for slow debuffs (e.g. -30)
    slowPercent += Math.abs(e.secondary.speed) * e.stacks;
  }
  // Cap at 70% slow (minimum 30% of base speed).
  const capped = Math.min(slowPercent, 70);
  return 1 - capped / 100;
}

// ── Passive skill aggregation ──────────────────────────────────────────────

/**
 * Compute the aggregate SecondaryStats bonus from all learned passive skills.
 *
 * Passives are `kind: "passive"` skills with a `buffEffect` but no duration.
 * They are permanent while the skill is in the player's skillBook.
 *
 * @param archetype  The player's class archetype.
 * @param skillBook  Skill id → learned level. Only skills with level > 0 contribute.
 * @returns          A Partial<SecondaryStats> to fold into deriveSecondary.
 */
export function passiveEffectBonus(
  archetype: ClassArchetype,
  skillBook: Record<string, number>,
): Partial<SecondaryStats> {
  const delta: Record<string, number> = {};

  for (const skill of allSkillsForClass(archetype)) {
    if (skill.kind !== "passive") continue;
    if ((skillBook[skill.id] ?? 0) <= 0) continue;
    if (!skill.buffEffect) continue;

    const secondary = buffEffectToSecondary(skill.buffEffect);
    for (const [key, val] of Object.entries(secondary)) {
      if (val === undefined || val === 0) continue;
      delta[key] = (delta[key] ?? 0) + (val as number);
    }
  }

  return delta as Partial<SecondaryStats>;
}

/**
 * Convert a ConsumableBuffEffect into a StatusEffect ready for applyEffect.
 *
 * @param consumableId  The consumable's id (e.g. "buff.power_elixir").
 * @param secondary     SecondaryStats modifiers from ConsumableBuffEffect.
 * @param durationMs    Buff duration in ms.
 * @param source        Who used it (typically the player's id).
 * @returns             A StatusEffect of kind "buff".
 */
export function consumableBuffToStatusEffect(
  consumableId: string,
  secondary: Partial<SecondaryStats>,
  durationMs: number,
  source: string,
): StatusEffect {
  return {
    id: consumableId,
    kind: "buff",
    secondary,
    durationMs,
    stacks: 1,
    source,
  };
}
