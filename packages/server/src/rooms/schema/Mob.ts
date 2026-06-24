import { Schema, type } from "@colyseus/schema";

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

  // ─── Server-only (NOT synced) ───────────────────────────────────────
  spawnX = 0;
  wanderDir = 0; // -1, 0, or 1
  wanderTimer = 0; // ms until next wander decision
  hitTimer = 0; // ms remaining of the hit flash
  respawnTimer = 0; // ms remaining before this slot respawns
  contactCooldown = 0; // ms remaining before this mob can deal contact damage again
}
