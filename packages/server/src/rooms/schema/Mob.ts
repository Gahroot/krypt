import { Schema, type } from "@colyseus/schema";
import type { StatusEffect } from "@maple/shared";

/**
 * Mob — an authoritative monster instance. Position/HP are server-owned; the client only renders.
 */
export class Mob extends Schema {
  @type("string") mobId = ""; // def id from @maple/shared MOBS
  @type("number") x = 0;
  @type("number") y = 0;
  @type("int8") facing = 1;
  @type("int16") hp = 0;
  @type("int16") maxHp = 0;
  @type("boolean") dead = false;
  @type("boolean") hit = false; // brief flag the client uses to flash a hit
  @type("boolean") isElite = false; // elite variant — scaled HP/damage, golden tint
  @type("number") vy = 0;
  @type("boolean") grounded = false;
  @type("number") knockbackVx = 0; // synced: horizontal knockback velocity
  @type("string") bossTelegraph = ""; // synced: current AoE telegraph pattern name (empty = none)
  @type("boolean") stunned = false; // synced: true when a stun debuff is active

  // ─── Server-only (NOT synced) ───────────────────────────────────────
  /** Room-level instance id (e.g. "mob_42"), set by SpawnManager. */
  instanceId = "";
  spawnX = 0;
  wanderDir = 0; // -1, 0, or 1
  wanderTimer = 0; // ms until next wander decision
  hitTimer = 0; // ms remaining of the hit flash
  knockbackTimer = 0; // ms remaining of the knockback slide
  respawnTimer = 0; // ms remaining before this slot respawns
  contactCooldown = 0; // ms remaining before this mob can deal contact damage again
  footholdId = -1; // which platform this mob patrols

  // ─── AI state machine ────────────────────────────────────────────────
  aiState: "idle" | "wander" | "aggro" | "chase" | "attack" = "idle";
  targetSessionId = ""; // session id of the player being targeted
  attackCooldown = 0; // ms remaining before next attack
  aggroRange = 200; // px — detection radius
  attackRange = 50; // px — melee range
  deaggroRange = 280; // px — range at which mob gives up chase

  // ─── Boss encounter state (server-only) ──
  bossPhase = 0; // current phase (0 = phase 1, 1 = phase 2)
  bossPhaseTransitioned = false; // has the current phase transition been processed
  bossPatternTimer = 0; // ms until next attack pattern executes
  bossSummonTimer = 0; // ms until next add summon

  // ─── Active status effects (server-only, not synced) ─────────────────────
  /** Timed status effects applied to this mob (debuffs from player skills). */
  activeEffects: StatusEffect[] = [];
  /** Elapsed time per effect id — mutable, owned by tickEffects. */
  effectElapsed = new Map<string, number>();

  // ─── Caster behavior (server-only) ──────────────────────────────────────
  /** Countdown timer (ms) for caster telegraph phase. Active when bossTelegraph is non-empty. */
  _casterTelegraphTimer = 0;
}
