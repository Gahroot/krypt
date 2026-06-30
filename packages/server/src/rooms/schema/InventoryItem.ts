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
  /** Potential bonus lines as JSON string: [{"stat":"ATK","percent":9}, ...]. */
  @type("string") potentialLines = "[]";
  /** Flame bonus stats as JSON string: [{"stat":"STR","value":5,"tier":"RARE"}, ...]. */
  @type("string") bonusStats = "[]";
  /** True once this item has been (or is queued to be) minted on-chain. Phase 2. */
  @type("boolean") minted = false;
  /** Star Force level (0–15). Distinct from base-rank upgrades. */
  @type("uint8") stars = 0;
  /** Stack count for consumables (always 1 for equipment). */
  @type("uint16") count = 1;
}
