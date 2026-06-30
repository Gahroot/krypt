/**
 * Free Market — pure data types + pure helper functions for the player-driven order book.
 *
 * The aggregate is intentionally framework-free (no Colyseus, no persistence). The server
 * wraps it as authoritative state; the client can import types only. All helpers are pure:
 * add / remove / match / search with filter predicates.
 *
 * The soft market uses Mesos. The on-chain Premium Market ($MAPLE) is Phase 2.
 */

import type { EquipSlot, BonusStatLine } from "./items.js";
import { getItemDef } from "./items.js";
import type { PotentialTier, BaseRank } from "./rarity.js";

// ─── Listing type ─────────────────────────────────────────────────────────────

/**
 * A single item listed for sale on the Free Market.
 *
 * `uid` is set for equips (non-stackable unique instances) and omitted for stackable items
 * identified solely by `defId`. `qty` is the stack count being sold (always 1 for equips).
 * `pricePerUnit` is the Mesos cost per unit; the buyer pays `pricePerUnit × qty` total.
 */
export interface ShopListing {
  /** Unique listing id (server-assigned, format `lst_N`). */
  readonly id: string;
  /** Persistent charId of the seller. */
  readonly sellerId: string;
  /** Seller display name (truncated for UI). */
  readonly sellerName: string;
  /** Item definition id — always present. */
  readonly defId: string;
  /** Unique instance id — set for equips (non-stackable), undefined for stackables. */
  readonly uid?: string;
  /** Stack count. Always 1 for equips; ≥ 1 for stackable items (potions, etc.). */
  readonly qty: number;
  /** Mesos charged per unit. Total price = pricePerUnit × qty. */
  readonly pricePerUnit: number;
  /** Equipment base rank (NORMAL → MYTHIC). */
  readonly baseRank: string;
  /** Potential tier (RARE → LEGENDARY). */
  readonly potentialTier: string;
  /** Number of bonus stat lines rolled on this instance. */
  readonly lines: number;
  /** Flame bonus stats on this instance (for display in market UI). */
  readonly bonusStats?: readonly BonusStatLine[];
  /** Server timestamp when the listing was created. */
  readonly createdAt: number;
  /** Listing type: "fixed" (immediate buy) or "auction" (bidding). */
  readonly listingType: "fixed" | "auction";
  /** Epoch-ms when the listing expires (0 = no expiry). Applies to fixed-price and auctions. */
  readonly endsAt: number;
  /** Current highest bid in Mesos (auction only; 0 for fixed). */
  readonly currentBid: number;
  /** charId of the current highest bidder (auction only; "" if no bids). */
  readonly highBidderCharId: string;
}

// ─── Buy Order (want-to-buy) ──────────────────────────────────────────────────

/** A buy order posted by a player seeking an item at a specified max price. */
export interface BuyOrder {
  /** Unique buy order id (server-assigned, format `bord_N`). */
  readonly id: string;
  /** Persistent charId of the buyer. */
  readonly buyerCharId: string;
  /** Buyer display name (truncated for UI). */
  readonly buyerName: string;
  /** Item definition id the buyer wants. */
  readonly defId: string;
  /** Buyer's max price per unit in Mesos. */
  readonly maxPrice: number;
  /** Quantity requested (always 1 for equips). */
  readonly qty: number;
  /** Mesos escrowed when the buy order was placed. */
  readonly mesosEscrowed: number;
  /** Server timestamp when the buy order was placed. */
  readonly createdAt: number;
}

// ─── Price History ─────────────────────────────────────────────────────────────

/** A single completed sale recorded for price history. */
export interface PriceHistoryEntry {
  /** Item definition id that was sold. */
  readonly defId: string;
  /** Sale price in Mesos (total). */
  readonly salePrice: number;
  /** Epoch-ms when the sale was completed. */
  readonly soldAt: number;
}

// ─── Search / filter ──────────────────────────────────────────────────────────

export interface MarketSearchFilter {
  /** Filter by equipment slot (WEAPON, HAT, etc.). Only equips match. */
  readonly slot?: EquipSlot;
  /** Minimum character level requirement (inclusive). */
  readonly levelMin?: number;
  /** Maximum character level requirement (inclusive). */
  readonly levelMax?: number;
  /** Filter by potential tier (exact match). */
  readonly potentialTier?: PotentialTier;
  /** Filter by base rank (exact match). */
  readonly baseRank?: BaseRank;
  /** Minimum total price (pricePerUnit × qty). */
  readonly priceMin?: number;
  /** Maximum total price (pricePerUnit × qty). */
  readonly priceMax?: number;
  /** Free-text search against item name and defId (case-insensitive substring). */
  readonly query?: string;
  /** Sort key. Default: "newest". */
  readonly sortBy?: "price" | "level" | "newest";
  /** Sort direction. Default: "asc". */
  readonly sortOrder?: "asc" | "desc";
}

// ─── FreeMarket aggregate ─────────────────────────────────────────────────────

/**
 * Pure in-memory order book. No I/O, no side-effects — just a Map of listings
 * with add / remove / match / search helpers. The server owns the authoritative
 * instance and fans out its state via Colyseus; the client never mutates it.
 */
export class FreeMarket {
  private listings = new Map<string, ShopListing>();
  private buyOrders = new Map<string, BuyOrder>();

  /** Number of active listings. */
  get size(): number {
    return this.listings.size;
  }

  /** Number of active buy orders. */
  get buyOrderCount(): number {
    return this.buyOrders.size;
  }

  /** Add a listing to the book. Overwrites if the id already exists (shouldn't happen). */
  addListing(listing: ShopListing): void {
    this.listings.set(listing.id, listing);
  }

  /** Remove and return a listing by id, or undefined if not found. */
  removeListing(id: string): ShopListing | undefined {
    const listing = this.listings.get(id);
    if (listing) this.listings.delete(id);
    return listing;
  }

  /** Get a listing by id without removing it. */
  matchListing(id: string): ShopListing | undefined {
    return this.listings.get(id);
  }

  /** Return all listings (unsorted copy). */
  allListings(): ShopListing[] {
    return [...this.listings.values()];
  }

  // ─── Buy Orders ──────────────────────────────────────────────────────

  /** Add a buy order. Overwrites if the id already exists (shouldn't happen). */
  addBuyOrder(order: BuyOrder): void {
    this.buyOrders.set(order.id, order);
  }

  /** Remove and return a buy order by id, or undefined if not found. */
  removeBuyOrder(id: string): BuyOrder | undefined {
    const order = this.buyOrders.get(id);
    if (order) this.buyOrders.delete(id);
    return order;
  }

  /** Get a buy order by id without removing it. */
  matchBuyOrder(id: string): BuyOrder | undefined {
    return this.buyOrders.get(id);
  }

  /** Return all buy orders (unsorted copy). */
  allBuyOrders(): BuyOrder[] {
    return [...this.buyOrders.values()];
  }

  /**
   * Find buy orders that match a new fixed-price listing.
   * A buy order matches when: defId matches AND maxPrice >= listing pricePerUnit AND order is not by the seller.
   * Returns matches sorted by maxPrice descending (best bid first).
   */
  findMatchingBuyOrders(listing: ShopListing): BuyOrder[] {
    if (listing.listingType !== "fixed") return [];
    const results: BuyOrder[] = [];
    for (const order of this.buyOrders.values()) {
      if (order.defId !== listing.defId) continue;
      if (order.buyerCharId === listing.sellerId) continue; // can't buy your own order
      if (order.maxPrice >= listing.pricePerUnit) {
        results.push(order);
      }
    }
    // Best bid first (highest maxPrice).
    results.sort((a, b) => b.maxPrice - a.maxPrice);
    return results;
  }

  /**
   * Find fixed-price listings that match a new buy order.
   * A listing matches when: defId matches AND pricePerUnit <= order.maxPrice AND listing is not by the buyer.
   * Returns matches sorted by price ascending (cheapest first).
   */
  findMatchingListings(order: BuyOrder): ShopListing[] {
    const results: ShopListing[] = [];
    for (const listing of this.listings.values()) {
      if (listing.listingType !== "fixed") continue;
      if (listing.defId !== order.defId) continue;
      if (listing.sellerId === order.buyerCharId) continue; // can't buy your own listing
      if (listing.pricePerUnit <= order.maxPrice) {
        results.push(listing);
      }
    }
    // Cheapest first.
    results.sort((a, b) => a.pricePerUnit - b.pricePerUnit);
    return results;
  }

  /**
   * Search the order book with a filter. Returns matching listings sorted
   * according to `sortBy` / `sortOrder`. When multiple filters are set, all
   * must match (AND logic).
   */
  search(filter: MarketSearchFilter): ShopListing[] {
    let results = [...this.listings.values()];

    // ── Predicate filters ────────────────────────────────────────────────

    if (filter.slot !== undefined) {
      results = results.filter((l) => {
        const def = getItemDef(l.defId);
        return def !== undefined && def.slot === filter.slot;
      });
    }

    if (filter.levelMin !== undefined) {
      const levelMin = filter.levelMin;
      results = results.filter((l) => {
        const def = getItemDef(l.defId);
        return def !== undefined && def.levelReq >= levelMin;
      });
    }

    if (filter.levelMax !== undefined) {
      const levelMax = filter.levelMax;
      results = results.filter((l) => {
        const def = getItemDef(l.defId);
        return def !== undefined && def.levelReq <= levelMax;
      });
    }

    if (filter.potentialTier !== undefined) {
      results = results.filter((l) => l.potentialTier === filter.potentialTier);
    }

    if (filter.baseRank !== undefined) {
      results = results.filter((l) => l.baseRank === filter.baseRank);
    }

    if (filter.priceMin !== undefined) {
      const priceMin = filter.priceMin;
      results = results.filter((l) => l.pricePerUnit * l.qty >= priceMin);
    }

    if (filter.priceMax !== undefined) {
      const priceMax = filter.priceMax;
      results = results.filter((l) => l.pricePerUnit * l.qty <= priceMax);
    }

    if (filter.query !== undefined && filter.query.length > 0) {
      const q = filter.query.toLowerCase();
      results = results.filter((l) => {
        const def = getItemDef(l.defId);
        const name = def !== undefined ? def.name.toLowerCase() : l.defId.toLowerCase();
        return name.includes(q) || l.defId.toLowerCase().includes(q);
      });
    }

    // ── Sort ─────────────────────────────────────────────────────────────

    const sortBy = filter.sortBy ?? "newest";
    const desc = filter.sortOrder === "desc";

    results.sort((a, b) => {
      let cmp: number;
      switch (sortBy) {
        case "price": {
          const totalA = a.pricePerUnit * a.qty;
          const totalB = b.pricePerUnit * b.qty;
          cmp = totalA - totalB;
          break;
        }
        case "level": {
          const defA = getItemDef(a.defId);
          const defB = getItemDef(b.defId);
          const lvlA = defA !== undefined ? defA.levelReq : 0;
          const lvlB = defB !== undefined ? defB.levelReq : 0;
          cmp = lvlA - lvlB;
          break;
        }
        case "newest":
        default:
          cmp = a.createdAt - b.createdAt;
          break;
      }
      return desc ? -cmp : cmp;
    });

    return results;
  }
}
