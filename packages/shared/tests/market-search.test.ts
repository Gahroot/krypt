/**
 * FreeMarket search/filter tests — validates the pure in-memory order book.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FreeMarket, type ShopListing } from "../src/market.js";
import { EquipSlot } from "../src/items.js";
import { PotentialTier, BaseRank } from "../src/rarity.js";

function listing(overrides: Partial<ShopListing> & { id: string }): ShopListing {
  return {
    sellerId: "seller1",
    sellerName: "Seller",
    defId: "wpn.bronze_shortsword",
    qty: 1,
    pricePerUnit: 100,
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 0,
    createdAt: Date.now(),
    listingType: "fixed",
    endsAt: 0,
    currentBid: 0,
    highBidderCharId: "",
    ...overrides,
  };
}

describe("FreeMarket.search", () => {
  let book: FreeMarket;

  beforeEach(() => {
    book = new FreeMarket();
    book.addListing(
      listing({
        id: "l1",
        defId: "wpn.bronze_shortsword",
        pricePerUnit: 100,
        potentialTier: "RARE",
      }),
    );
    book.addListing(
      listing({ id: "l2", defId: "wpn.iron_broadsword", pricePerUnit: 500, potentialTier: "EPIC" }),
    );
    book.addListing(
      listing({ id: "l3", defId: "hat.leather_cap", pricePerUnit: 200, potentialTier: "RARE" }),
    );
    book.addListing(
      listing({ id: "l4", defId: "hat.tattered_hood", pricePerUnit: 50, potentialTier: "NORMAL" }),
    );
    book.addListing(
      listing({
        id: "l5",
        defId: "wpn.bronze_shortsword",
        pricePerUnit: 300,
        potentialTier: "UNIQUE",
        baseRank: "ENHANCED",
      }),
    );
    book.addListing(
      listing({
        id: "l6",
        defId: "con.hp_potion_s",
        pricePerUnit: 10,
        potentialTier: "RARE",
        qty: 50,
      }),
    );
  });

  it("empty filter returns all listings", () => {
    expect(book.search({}).length).toBe(6);
  });

  it("filter by slot", () => {
    const results = book.search({ slot: EquipSlot.WEAPON });
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r.defId).toMatch(/^wpn\./);
    }
  });

  it("filter by potentialTier", () => {
    const results = book.search({ potentialTier: PotentialTier.EPIC });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("l2");
  });

  it("filter by price range", () => {
    const results = book.search({ priceMin: 100, priceMax: 250 });
    expect(results.length).toBe(2); // l1 (100), l3 (200)
  });

  it("filter by baseRank", () => {
    const results = book.search({ baseRank: BaseRank.ENHANCED });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("l5");
  });

  it("combined filters (AND logic)", () => {
    const results = book.search({ slot: EquipSlot.WEAPON, priceMin: 200 });
    expect(results.length).toBe(2); // l2 (500), l5 (300)
  });

  it("search by query (defId substring)", () => {
    const results = book.search({ query: "iron" });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("l2");
  });

  it("sort by price ascending", () => {
    const results = book.search({ sortBy: "price", sortOrder: "asc" });
    // Sort uses total price (pricePerUnit × qty). l6 has qty=50.
    const prices = results.map((r) => r.pricePerUnit * r.qty);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]!).toBeGreaterThanOrEqual(prices[i - 1]!);
    }
  });

  it("sort by price descending", () => {
    const results = book.search({ sortBy: "price", sortOrder: "desc" });
    const prices = results.map((r) => r.pricePerUnit * r.qty);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]!).toBeLessThanOrEqual(prices[i - 1]!);
    }
  });

  it("removeListing removes from results", () => {
    book.removeListing("l1");
    expect(book.search({}).length).toBe(5);
    expect(book.search({ slot: EquipSlot.WEAPON }).length).toBe(2);
  });
});
