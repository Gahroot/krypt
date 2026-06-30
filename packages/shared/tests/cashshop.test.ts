import { describe, it, expect } from "vitest";
import {
  CASH_ITEMS,
  getCashItem,
  cashItemsByCategory,
  VALID_APPEARANCE_IDS,
  PREMIUM_CURRENCY,
  PREMIUM_TICKER,
} from "../src/cashshop.js";
import type { CashCategory } from "../src/cashshop.js";

// ---------------------------------------------------------------------------
// Premium currency constants
// ---------------------------------------------------------------------------

describe("Premium currency", () => {
  it("PREMIUM_CURRENCY is a non-empty string", () => {
    expect(typeof PREMIUM_CURRENCY).toBe("string");
    expect(PREMIUM_CURRENCY.length).toBeGreaterThan(0);
  });

  it("PREMIUM_TICKER is a non-empty string", () => {
    expect(typeof PREMIUM_TICKER).toBe("string");
    expect(PREMIUM_TICKER.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Catalog integrity
// ---------------------------------------------------------------------------

describe("CASH_ITEMS catalog", () => {
  const items = Object.values(CASH_ITEMS);

  it("contains at least one item", () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it("every key matches the item's id", () => {
    for (const [key, item] of Object.entries(CASH_ITEMS)) {
      expect(key).toBe(item.id);
    }
  });

  it("all ids are unique", () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all names are non-empty", () => {
    for (const item of items) {
      expect(item.name.length).toBeGreaterThan(0);
    }
  });

  it("all prices are positive integers", () => {
    for (const item of items) {
      expect(Number.isInteger(item.price)).toBe(true);
      expect(item.price).toBeGreaterThan(0);
    }
  });

  it("all category values are valid CashCategory members", () => {
    const validCategories: ReadonlySet<string> = new Set([
      "hair",
      "face",
      "outfit",
      "weapon-skin",
      "pet",
      "effect",
      "consumable",
    ]);
    for (const item of items) {
      expect(validCategories.has(item.category)).toBe(true);
    }
  });

  it("covers all seven categories", () => {
    const found = new Set(items.map((i) => i.category));
    for (const cat of validCategories()) {
      expect(found.has(cat)).toBe(true);
    }
  });

  it("durationDays, when present, is a positive integer", () => {
    for (const item of items) {
      if (item.durationDays !== undefined) {
        expect(Number.isInteger(item.durationDays)).toBe(true);
        expect(item.durationDays).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// appearanceOverride validation
// ---------------------------------------------------------------------------

describe("appearanceOverride integrity", () => {
  const items = Object.values(CASH_ITEMS);

  it("all appearanceOverride ids resolve against the base appearance arrays", () => {
    for (const item of items) {
      const ao = item.appearanceOverride;
      if (!ao) continue;

      if (ao.hairId !== undefined) {
        expect(
          VALID_APPEARANCE_IDS.has(ao.hairId),
          `${item.id}: invalid hairId "${ao.hairId}"`,
        ).toBe(true);
      }
      if (ao.hairColorId !== undefined) {
        expect(
          VALID_APPEARANCE_IDS.has(ao.hairColorId),
          `${item.id}: invalid hairColorId "${ao.hairColorId}"`,
        ).toBe(true);
      }
      if (ao.faceId !== undefined) {
        expect(
          VALID_APPEARANCE_IDS.has(ao.faceId),
          `${item.id}: invalid faceId "${ao.faceId}"`,
        ).toBe(true);
      }
      if (ao.outfitId !== undefined) {
        expect(
          VALID_APPEARANCE_IDS.has(ao.outfitId),
          `${item.id}: invalid outfitId "${ao.outfitId}"`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("getCashItem", () => {
  it("returns an item for a known id", () => {
    const first = Object.values(CASH_ITEMS)[0]!;
    expect(getCashItem(first.id)).toBe(first);
  });

  it("returns undefined for an unknown id", () => {
    expect(getCashItem("does_not_exist")).toBeUndefined();
  });
});

describe("cashItemsByCategory", () => {
  it("returns items for every valid category", () => {
    for (const cat of validCategories()) {
      const results = cashItemsByCategory(cat);
      expect(results.length).toBeGreaterThan(0);
      for (const item of results) {
        expect(item.category).toBe(cat);
      }
    }
  });

  it("returns empty array for a nonexistent category", () => {
    const results = cashItemsByCategory("nonexistent" as CashCategory);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Helpers — helpers to build valid category list
// ---------------------------------------------------------------------------

function validCategories(): CashCategory[] {
  return ["hair", "face", "outfit", "weapon-skin", "pet", "effect", "consumable"];
}
