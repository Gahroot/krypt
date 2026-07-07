import { Schema, type } from "@colyseus/schema";

/**
 * LootDrop — a dropped item lying on the ground, visible to everyone until picked up.
 * `potentialTier` holds the string value of the rolled @maple/shared PotentialTier.
 */
export class LootDrop extends Schema {
  @type("string") uid = "";
  @type("string") defId = "";
  @type("string") potentialTier = "RARE";
  @type("uint8") lines = 1;
  @type("number") x = 0;
  @type("number") y = 0;
  /** Legendary rolls flag a future on-chain mint (Phase 2). Public + visible = part of the fantasy. */
  @type("boolean") legendary = false;

  // ─── Server-only ────────────────────────────────────────────────────
  despawnTimer = 0; // ms until this drop disappears if unclaimed

  /** Session id of the killer — exclusive pickup rights during the ownership window. */
  ownerSessionId = "";
  /** Epoch ms at which ownership expires and the drop becomes FFA. */
  ownershipExpiresAt = 0;
}
