import { describe, it, expect } from "vitest";
import {
  SKIN_TONES,
  HAIR_STYLES,
  HAIR_COLORS,
  FACE_STYLES,
  STARTER_OUTFITS,
  randomizeAppearance,
} from "../src/appearance.js";
import { mulberry32 } from "./rng.js";

// ---------------------------------------------------------------------------
// Cosmetic data arrays
// ---------------------------------------------------------------------------
describe("Cosmetic data arrays", () => {
  it("SKIN_TONES has entries", () => {
    expect(SKIN_TONES.length).toBeGreaterThan(0);
  });

  it("HAIR_STYLES has entries", () => {
    expect(HAIR_STYLES.length).toBeGreaterThan(0);
  });

  it("HAIR_COLORS has entries", () => {
    expect(HAIR_COLORS.length).toBeGreaterThan(0);
  });

  it("FACE_STYLES has entries", () => {
    expect(FACE_STYLES.length).toBeGreaterThan(0);
  });

  it("STARTER_OUTFITS has entries", () => {
    expect(STARTER_OUTFITS.length).toBeGreaterThan(0);
  });

  it("all entries have unique ids within their array", () => {
    const check = (arr: readonly { id: string }[]) => {
      const ids = arr.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    };
    check(SKIN_TONES);
    check(HAIR_STYLES);
    check(HAIR_COLORS);
    check(FACE_STYLES);
    check(STARTER_OUTFITS);
  });
});

// ---------------------------------------------------------------------------
// randomizeAppearance
// ---------------------------------------------------------------------------
describe("randomizeAppearance", () => {
  it("returns valid ids from the cosmetic arrays", () => {
    const app = randomizeAppearance();
    expect(app.gender).toMatch(/^[MF]$/);
    expect(SKIN_TONES.some((s) => s.id === app.skinId)).toBe(true);
    expect(HAIR_STYLES.some((h) => h.id === app.hairId)).toBe(true);
    expect(HAIR_COLORS.some((c) => c.id === app.hairColorId)).toBe(true);
    expect(FACE_STYLES.some((f) => f.id === app.faceId)).toBe(true);
    expect(STARTER_OUTFITS.some((o) => o.id === app.outfitId)).toBe(true);
  });

  it("gender-specific outfit matches chosen gender", () => {
    const rng = mulberry32(42);
    const app = randomizeAppearance(rng);
    const outfit = STARTER_OUTFITS.find((o) => o.id === app.outfitId)!;
    expect(outfit.gender === app.gender || outfit.gender === "U").toBe(true);
  });

  it("is deterministic with a seeded rng", () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    const a1 = randomizeAppearance(rng1);
    const a2 = randomizeAppearance(rng2);
    expect(a1).toEqual(a2);
  });

  it("different seeds can produce different appearances", () => {
    const a1 = randomizeAppearance(mulberry32(1));
    const a2 = randomizeAppearance(mulberry32(2));
    // With two different seeds the chances of identical results across all
    // fields are astronomically low — but this is probabilistic, not
    // absolute. A failure here would mean the rng is broken or the arrays
    // are singletons.
    const identical =
      a1.gender === a2.gender &&
      a1.skinId === a2.skinId &&
      a1.hairId === a2.hairId &&
      a1.hairColorId === a2.hairColorId &&
      a1.faceId === a2.faceId &&
      a1.outfitId === a2.outfitId;
    expect(identical).toBe(false);
  });
});
