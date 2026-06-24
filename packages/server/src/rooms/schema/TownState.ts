import { Schema, type, MapSchema } from "@colyseus/schema";
import { Player } from "./Player";
import { Mob } from "./Mob";
import { LootDrop } from "./LootDrop";

/**
 * TownState — the full synced state of a Meadowfield room: map bounds + everyone/everything in it.
 */
export class TownState extends Schema {
  @type("number") mapWidth = 0;
  @type("number") mapHeight = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Mob }) mobs = new MapSchema<Mob>();
  @type({ map: LootDrop }) loot = new MapSchema<LootDrop>();
}
