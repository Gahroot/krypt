import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Market slice — bridge state for the player-driven Free Market (auction house).
 *
 * Follows the reference inventory/shop slices: a plain, serializable snapshot
 * pushed in from Phaser (`MarketScene`), an `open` flag, and a per-feature action
 * registry the scene wires to authoritative `room.send(...)` messages. React
 * reads the snapshot and calls the actions — it never touches Phaser/Colyseus.
 *
 * Search / filter / sort / pagination are pure client-side view state owned by
 * `MarketPanel`; they operate over the `listings` array in the snapshot, exactly
 * as the legacy Phaser scene filtered its order book locally.
 */

/** A public listing on the order book (plain mirror of ListingView + display fields). */
export interface MarketListing {
  listingId: string;
  defId: string;
  /** Resolved display name (from getItemDef). */
  name: string;
  sellerId: string;
  sellerName: string;
  /** Potential tier id, e.g. "RARE" | "EPIC" | "UNIQUE" | "LEGENDARY". */
  potentialTier: string;
  /** Human-readable tier label. */
  tierLabel: string;
  /** Tier color as a CSS string for the rarity badge. */
  tierColor: string;
  lines: number;
  price: number;
  createdAt: number;
  /** "fixed" (immediate buy) or "auction" (bidding). */
  listingType: string;
  /** Epoch-ms when the listing expires (0 = no expiry). */
  endsAt: number;
  /** Current highest bid for auctions (0 for fixed). */
  currentBid: number;
  /** True when the local account owns this listing. */
  mine: boolean;
}

/** A wallet item the player can list for sale (server-decorated). */
export interface MarketWalletItem {
  uid: string;
  defId: string;
  name: string;
  tierLabel: string;
  tierColor: string;
  lines: number;
  count: number;
}

/** Transient result of a market action — drives a toast in the panel. */
export interface MarketFeedback {
  /** Monotonic id so identical messages re-fire the toast. */
  id: number;
  message: string;
  ok: boolean;
}

/** Everything the Free Market UI needs in one immutable push from Phaser. */
export interface MarketSnapshot {
  /** Live mesos balance (from the private `wallet` push). */
  mesos: number;
  /** Protocol fee in basis points (250 = 2.5%). */
  feeBps: number;
  /** False until the market room socket has connected. */
  connected: boolean;
  /** Public order book. */
  listings: MarketListing[];
  /** The player's listable inventory. */
  walletItems: MarketWalletItem[];
  feedback: MarketFeedback | null;
}

/** Imperative actions the scene wires so React can drive the market. */
export interface MarketActions {
  /** Buy a fixed-price listing by id. */
  buy(listingId: string): void;
  /** Place a bid on an auction listing. */
  bid(listingId: string, amount: number): void;
  /** Create a new fixed-price listing for a wallet item. */
  createListing(itemUid: string, price: number): void;
  /** Cancel one of the player's own listings. */
  cancelListing(listingId: string): void;
  /** Close the market window. */
  close(): void;
}

const EMPTY_MARKET: MarketSnapshot = {
  mesos: 0,
  feeBps: 250,
  connected: false,
  listings: [],
  walletItems: [],
  feedback: null,
};

export interface MarketSlice {
  marketOpen: boolean;
  market: MarketSnapshot;
  marketActions: MarketActions | null;

  setMarketOpen: (open: boolean) => void;
  setMarket: (snapshot: MarketSnapshot) => void;
  setMarketActions: (actions: MarketActions | null) => void;
}

export const createMarketSlice: StateCreator<UIState, [], [], MarketSlice> = (set) => ({
  marketOpen: false,
  market: EMPTY_MARKET,
  marketActions: null,

  setMarketOpen: (open) => set({ marketOpen: open }),
  setMarket: (snapshot) => set({ market: snapshot }),
  setMarketActions: (actions) => set({ marketActions: actions }),
});
