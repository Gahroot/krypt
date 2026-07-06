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
  @type("string") kind = ""; // "ranged" | "caster" (for client sprite/visual)
  @type("boolean") dead = false;

  // ─── Server-only (NOT synced) ───────────────────────────────────────
  /** Milliseconds remaining before the projectile is forcibly removed. */
  lifetime = 0;
  /** Session ids of players already hit (prevents multi-hit on the same target). */
  hitSessionIds = new Set<string>();
}
