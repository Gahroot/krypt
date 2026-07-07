import { Schema, type } from "@colyseus/schema";

/**
 * Reactor — a placed interactive/breakable object synced to clients.
 * Breakable types (ore-vein, breakable-box) take attack damage; interactive
 * types (quest-switch, mechanism) are triggered by the interact action.
 */
export class Reactor extends Schema {
  @type("string") reactorId = "";
  @type("string") kind = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") hp = 0;
  @type("number") maxHp = 0;
  @type("boolean") active = true;
}
