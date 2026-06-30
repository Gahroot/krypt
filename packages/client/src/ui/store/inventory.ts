import type { StateCreator } from "zustand";
import type { InventoryTab } from "@maple/shared";

import type { UIState } from "./index";

/**
 * Inventory slice — the REFERENCE feature slice for the overlay bridge store.
 *
 * Every panel feature gets its own slice file shaped like this one: it owns a
 * plain, serializable *snapshot* (pushed in from Phaser via a `setX` setter) and
 * an `open` flag. React components read the snapshot; they never mutate game
 * state directly. Copy this file when adding a new panel (see ../README.md).
 */

/** A plain snapshot of one inventory item (mirror of InventoryItemView fields). */
export interface InvItemSnapshot {
  uid: string;
  defId: string;
  baseRank: string;
  potentialTier: string;
  lines: number;
  /** Potential bonus lines as a JSON string. */
  potentialLines: string;
  /** Flame bonus stats as a JSON string. */
  bonusStats: string;
  stars: number;
  count: number;
}

/** A plain snapshot of the local player's combat-relevant stats. */
export interface PlayerSnapshot {
  level: number;
  str: number;
  dex: number;
  intel: number;
  luk: number;
  hp: number;
  mp: number;
  archetype: string;
}

/** Everything the inventory UI needs in one immutable push from Phaser. */
export interface InventorySnapshot {
  buckets: Record<InventoryTab, InvItemSnapshot[]>;
  mesos: number;
  player: PlayerSnapshot | null;
  /** defIds currently equipped — used by the tooltip for set-bonus counts. */
  equippedDefIds: string[];
}

const EMPTY_BUCKETS: Record<InventoryTab, InvItemSnapshot[]> = {
  EQUIP: [],
  USE: [],
  ETC: [],
  CASH: [],
};

export interface InventorySlice {
  inventoryOpen: boolean;
  inventory: InventorySnapshot;

  setInventoryOpen: (open: boolean) => void;
  setInventory: (snapshot: InventorySnapshot) => void;
}

/**
 * Slice factory. Combined into the root store in ./index.ts. Typed against the
 * full {@link UIState} so a slice can read sibling slices via `get()` if needed.
 */
export const createInventorySlice: StateCreator<UIState, [], [], InventorySlice> = (set) => ({
  inventoryOpen: false,
  inventory: { buckets: EMPTY_BUCKETS, mesos: 0, player: null, equippedDefIds: [] },

  setInventoryOpen: (open) => set({ inventoryOpen: open }),
  setInventory: (snapshot) => set({ inventory: snapshot }),
});
