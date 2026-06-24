import { Schema, type, MapSchema } from "@colyseus/schema";
import { InventoryItem } from "./InventoryItem";
import type { InputData } from "../../types";

/**
 * Player — the authoritative character state, synced to all clients in the room.
 * Server-only fields (input queue, cooldowns) are plain properties WITHOUT @type so they never sync.
 */
export class Player extends Schema {
  // ─ Transform ─
  @type("number") x = 0;
  @type("number") y = 0;
  @type("int8") facing = 1; // -1 = left, 1 = right
  @type("number") tick = 0; // last processed input tick (for client reconciliation)

  // ─ Identity ─
  @type("string") name = "";
  @type("string") archetype = "WARRIOR";

  // ─ Vitals ─
  @type("uint8") level = 1;
  @type("int16") hp = 50;
  @type("int16") maxHp = 50;
  @type("int16") mp = 5;
  @type("int16") maxMp = 5;
  @type("boolean") dead = false;

  // ─ Stats (STR/DEX/INT/LUK) ─
  @type("uint16") str = 4;
  @type("uint16") dex = 4;
  @type("uint16") intel = 4;
  @type("uint16") luk = 4;

  // ─ Progression ─
  @type("uint32") exp = 0;
  @type("uint16") ap = 0; // unspent ability points
  @type("uint16") sp = 0; // unspent skill points
  @type("uint32") mesos = 0;

  // ─ Combat presentation ─
  @type("boolean") attacking = false;

  // ─ Owned items ─
  @type({ map: InventoryItem }) inventory = new MapSchema<InventoryItem>();

  // ─── Server-only (NOT synced) ───────────────────────────────────────
  accountId = ""; // persistent account this character writes mesos/items through to
  inputQueue: InputData[] = [];
  attackCooldown = 0; // ms remaining before next melee swing
  attackTimer = 0; // ms remaining of the current swing animation
  respawnTimer = 0; // ms remaining before respawn when dead
}
