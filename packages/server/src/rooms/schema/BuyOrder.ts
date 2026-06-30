import { Schema, type } from "@colyseus/schema";

/**
 * BuyOrder — a want-to-buy order placed by a player seeking an item.
 * Mesos are escrowed when the order is placed and released on cancel or settlement.
 */
export class BuyOrder extends Schema {
  @type("string") buyOrderId = "";
  @type("string") buyerCharId = "";
  @type("string") buyerName = "";
  @type("string") defId = "";
  @type("uint32") maxPrice = 0; // Mesos per unit
  @type("uint8") qty = 1;
  @type("uint32") mesosEscrowed = 0;
  @type("number") createdAt = 0;
}
