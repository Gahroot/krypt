import { Schema, type } from "@colyseus/schema";

/**
 * Projectile — a server-authoritative entity fired by ranged/caster mobs.
 * Clients render it but never trust its position or damage.
 */
export class Projectile extends Schema {
  @type("string") id = "";
  @type("string") ownerId = ""; // mob instance id that fired it
  @type("string") ownerMobId = ""; // mob def id (for client visuals)
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") vx = 0;
  @type("number") vy = 0;
  @type("int8") facing = 1;
  @type("number") damage = 0;
  @type("string") kind = ""; // "ranged" | "caster" | "player_arrow" | "player_bolt" | "player_bullet"
  @type("boolean") dead = false;
  /** Session id of the player who fired this (empty for mob projectiles). */
  @type("string") ownerSession = "";
  /** Skill id that spawned this projectile (empty for mob projectiles). */
  @type("string") skillId = "";

  // ─── Server-only (NOT synced) ───────────────────────────────────────
  /** Milliseconds remaining before the projectile is forcibly removed. */
  lifetime = 0;
  /** Session ids of players already hit (prevents multi-hit on the same target). */
  hitSessionIds = new Set<string>();
  /** Mob instance ids already hit (for player projectiles hitting mobs). */
  hitMobKeys = new Set<string>();
}
