import { Schema, type } from "@colyseus/schema";

/**
 * A concrete owned item synced to its owner. Mirrors @maple/shared's ItemInstance, flattened for
 * efficient network sync. `potentialTier` / `baseRank` hold the string enum values from shared.
 */
export class InventoryItem extends Schema {
  @type("string") uid = "";
  @type("string") defId = "";
  @type("string") baseRank = "NORMAL";
  @type("string") potentialTier = "RARE";
  @type("uint8") lines = 1;
  /** True once this item has been (or is queued to be) minted on-chain. Phase 2. */
  @type("boolean") minted = false;
}
