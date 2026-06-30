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
  /** Listing type: "fixed" (immediate buy) or "auction" (bidding). */
  @type("string") listingType = "fixed";
  /** Epoch-ms when the listing expires (0 = no expiry). */
  @type("number") endsAt = 0;
  /** Current highest bid in Mesos (auction only). */
  @type("uint32") currentBid = 0;
  /** charId of the current highest bidder ("" if none). */
  @type("string") highBidderCharId = "";
}
