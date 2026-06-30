import type { StateCreator } from "zustand";
import type { CashCategory } from "@maple/shared";

import type { UIState } from "./index";

/**
 * Cash Shop slice — bridge state for the premium cosmetic shop.
 *
 * Mirrors the shop slice but for the premium currency (Maple Crystals, not
 * mesos): a plain snapshot pushed in from `CashShopScene`, an `open` flag, and a
 * per-feature action registry (buy / equip / close) the scene wires to
 * authoritative `room.send(...)` messages.
 */

/** A catalog entry with the player's owned/equipped state resolved in. */
export interface CashShopItem {
  id: string;
  name: string;
  category: CashCategory;
  /** Human-readable category label (e.g. "Weapon Skins"). */
  categoryLabel: string;
  price: number;
  durationDays?: number;
  owned: boolean;
  equipped: boolean;
  /** True when the item has an appearance override (Equip/Unequip applies). */
  hasAppearance: boolean;
}

/** Transient result of a buy/equip attempt — drives a toast in the panel. */
export interface CashShopFeedback {
  id: number;
  message: string;
  ok: boolean;
}

/** Everything the Cash Shop UI needs in one immutable push from Phaser. */
export interface CashShopSnapshot {
  balance: number;
  /** Premium currency display name (e.g. "Maple Crystals"). */
  currencyLabel: string;
  /** Premium currency ticker (e.g. "MC"). */
  ticker: string;
  /** Full catalog in display order (browse groups it by category). */
  items: CashShopItem[];
  feedback: CashShopFeedback | null;
}

/** Imperative actions the scene wires so React can drive the cash shop. */
export interface CashShopActions {
  /** Purchase a cash item by id (account-wide). */
  buy(itemId: string): void;
  /** Equip or unequip an owned cash item by id (toggle). */
  equip(itemId: string): void;
  /** Close the cash shop window. */
  close(): void;
}

const EMPTY_CASH_SHOP: CashShopSnapshot = {
  balance: 0,
  currencyLabel: "Maple Crystals",
  ticker: "MC",
  items: [],
  feedback: null,
};

export interface CashShopSlice {
  cashShopOpen: boolean;
  cashShop: CashShopSnapshot;
  cashShopActions: CashShopActions | null;

  setCashShopOpen: (open: boolean) => void;
  setCashShop: (snapshot: CashShopSnapshot) => void;
  setCashShopActions: (actions: CashShopActions | null) => void;
}

export const createCashShopSlice: StateCreator<UIState, [], [], CashShopSlice> = (set) => ({
  cashShopOpen: false,
  cashShop: EMPTY_CASH_SHOP,
  cashShopActions: null,

  setCashShopOpen: (open) => set({ cashShopOpen: open }),
  setCashShop: (snapshot) => set({ cashShop: snapshot }),
  setCashShopActions: (actions) => set({ cashShopActions: actions }),
});
