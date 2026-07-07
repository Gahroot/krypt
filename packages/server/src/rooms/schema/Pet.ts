import { Schema, type } from "@colyseus/schema";

/**
 * Pet — a companion entity synced to all clients.
 * Follows its owner and auto-loots nearby ground drops.
 * Does NOT attack (that's the familiar system's job).
 */
export class Pet extends Schema {
  @type("string") petId = ""; // pet def id (e.g. "pet.snail")
  @type("string") ownerSession = ""; // session id of the summoning player
  @type("number") x = 0;
  @type("number") y = 0;
  @type("int8") facing = 1;
  @type("uint8") fullness = 100; // 0–100, synced so client can show hunger bar
  @type("boolean") grounded = false;

  // ─── Server-only (NOT synced) ───────────────────────────────────────
  /** Room-level instance id (e.g. "pet_42"). */
  instanceId = "";
  /** Pet def id used as the key in state.pets. */
  petKey = "";
  /** AI state machine: "idle" (fullness=0) or "follow" (active). */
  aiState: "idle" | "follow" = "follow";
  /** Movement speed (px/tick). */
  speed = 0.6;
  /** Epoch-ms when fullness decays by 1 point. */
  nextDecayAt = 0;
}
