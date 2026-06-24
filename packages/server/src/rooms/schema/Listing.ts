import { Schema, type } from "@colyseus/schema";

/**
 * Listing — one item posted for sale on the Free Market for a Mesos price.
 * This is the off-chain "soft market" (the MapleStory FM). The on-chain Premium Market is Phase 2.
 */
export class Listing extends Schema {
  @type("string") listingId = "";
  /** Seller's persistent account id (their item escrow owner). */
  @type("string") sellerId = "";
  @type("string") sellerName = "";
  @type("string") defId = "";
  @type("string") baseRank = "NORMAL";
  @type("string") potentialTier = "RARE";
  @type("uint8") lines = 1;
  @type("uint32") price = 0; // Mesos
  @type("number") createdAt = 0;
}
