import { Schema, type, MapSchema } from "@colyseus/schema";
import { Player } from "./Player";
import { Mob } from "./Mob";
import { LootDrop } from "./LootDrop";
import { Familiar } from "./Familiar";
import { Projectile } from "./Projectile";
import { Pet } from "./Pet";
import { Reactor } from "./Reactor";

/**
 * TownState — the full synced state of a Meadowfield room: map bounds + everyone/everything in it.
 */
export class TownState extends Schema {
  @type("string") mapId = "";
  @type("number") mapWidth = 0;
  @type("number") mapHeight = 0;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Mob }) mobs = new MapSchema<Mob>();
  @type({ map: LootDrop }) loot = new MapSchema<LootDrop>();
  @type({ map: Familiar }) familiars = new MapSchema<Familiar>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  @type({ map: Pet }) pets = new MapSchema<Pet>();
  @type({ map: Reactor }) reactors = new MapSchema<Reactor>();
}
