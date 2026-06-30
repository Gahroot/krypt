import { Schema, type } from "@colyseus/schema";

/**
 * Familiar — an authoritative companion entity synced to all clients.
 * Follows its owner, chases nearby mobs, and auto-attacks on a cooldown.
 */
export class Familiar extends Schema {
  @type("string") mobId = ""; // source mob def id (e.g. "mob.friendly_snail")
  @type("string") ownerSession = ""; // session id of the summoning player
  @type("number") x = 0;
  @type("number") y = 0;
  @type("int8") facing = 1;
  @type("int16") hp = 0;
  @type("int16") maxHp = 0;
  @type("boolean") dead = false;
  @type("boolean") hit = false; // brief flash flag for client hit visual
  @type("boolean") grounded = false;

  // ─── Server-only (NOT synced) ───────────────────────────────────────
  /** Room-level instance id (e.g. "fam_42"). */
  instanceId = "";
  /** Mob def id used as the key in state.familiars. */
  familiarKey = "";
  /** AI state machine. */
  aiState: "idle" | "follow" | "chase" | "attack" = "follow";
  /** Session id of the mob being chased (for lookup). */
  targetMobKey = "";
  /** Ms remaining before the familiar can attack again. */
  attackCooldown = 0;
  /** Ms remaining of the hit flash. */
  hitTimer = 0;
  /** Movement speed (px/tick), derived from source mob. */
  speed = 0.5;
}
