import { Schema, type, MapSchema } from "@colyseus/schema";
import { Listing } from "./Listing";

/**
 * MarketState — the synced order book. A map of active listings keyed by listingId.
 */
export class MarketState extends Schema {
  @type({ map: Listing }) listings = new MapSchema<Listing>();
  /** Protocol fee in basis points taken from each sale (the reskinned MTS tax). */
  @type("uint16") feeBps = 250; // 2.5%
}
