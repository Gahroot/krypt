import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Shop slice — bridge state for the NPC General Store (mesos buy/sell).
 *
 * Follows the reference inventory slice: a plain, serializable snapshot pushed
 * in from Phaser (`GeneralStoreScene`), an `open` flag, and a per-feature action
 * registry the scene wires to authoritative `room.send(...)` messages. React
 * reads the snapshot and calls the actions — it never touches Phaser/Colyseus.
 */

/** A buyable shop slot (plain mirror of ShopSlot + resolved display fields). */
export interface ShopBuySlot {
  itemId: string;
  name: string;
  buyPrice: number;
  /** Consumables can be bought in stacks; equipment is single-purchase. */
  isConsumable: boolean;
}

/** A sellable inventory entry the player can sell back for mesos. */
export interface ShopSellEntry {
  uid: string;
  defId: string;
  name: string;
  count: number;
  sellPrice: number;
}

/** Transient result of a buy/sell attempt — drives a toast in the panel. */
export interface ShopFeedback {
  /** Monotonic id so identical messages re-fire the toast. */
  id: number;
  message: string;
  ok: boolean;
}

/** Everything the General Store UI needs in one immutable push from Phaser. */
export interface ShopSnapshot {
  shopId: string;
  title: string;
  mesos: number;
  buy: ShopBuySlot[];
  sell: ShopSellEntry[];
  feedback: ShopFeedback | null;
}

/** Imperative actions the scene wires so React can drive the shop. */
export interface ShopActions {
  /** Buy `qty` of an item from the shop. */
  buy(itemId: string, qty: number): void;
  /** Sell one inventory item back to the shop by uid. */
  sell(uid: string, qty: number): void;
  /** Close the shop window. */
  close(): void;
}

const EMPTY_SHOP: ShopSnapshot = {
  shopId: "",
  title: "Shop",
  mesos: 0,
  buy: [],
  sell: [],
  feedback: null,
};

export interface ShopSlice {
  shopOpen: boolean;
  shop: ShopSnapshot;
  shopActions: ShopActions | null;

  setShopOpen: (open: boolean) => void;
  setShop: (snapshot: ShopSnapshot) => void;
  setShopActions: (actions: ShopActions | null) => void;
}

export const createShopSlice: StateCreator<UIState, [], [], ShopSlice> = (set) => ({
  shopOpen: false,
  shop: EMPTY_SHOP,
  shopActions: null,

  setShopOpen: (open) => set({ shopOpen: open }),
  setShop: (snapshot) => set({ shop: snapshot }),
  setShopActions: (actions) => set({ shopActions: actions }),
});
