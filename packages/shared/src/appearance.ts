/**
 * Appearance — cosmetic identity for character creation and rendering.
 *
 * Pure data + pure functions. No runtime deps. Both the server (storage) and
 * the Phaser client (sprite resolution) import from here.
 */

// ---------------------------------------------------------------------------
// Gender
// ---------------------------------------------------------------------------

export type Gender = "M" | "F";

// ---------------------------------------------------------------------------
// Cosmetic arrays — each entry has a stable `id` for storage and a `label`
// for UI. Hex values are optional hints for rendering; spriteKeys map to
// actual asset filenames in the client.
// ---------------------------------------------------------------------------

export interface SkinTone {
  readonly id: string;
  readonly label: string;
  readonly hex: string;
}

export const SKIN_TONES: readonly SkinTone[] = [
  { id: "skin_light", label: "Light", hex: "#FDDCB5" },
  { id: "skin_medium", label: "Medium", hex: "#DEB887" },
  { id: "skin_tan", label: "Tan", hex: "#C8A264" },
  { id: "skin_brown", label: "Brown", hex: "#8B6914" },
  { id: "skin_dark", label: "Dark", hex: "#4B3621" },
];

export interface HairStyle {
  readonly id: string;
  readonly label: string;
  readonly spriteKey: string;
}

export const HAIR_STYLES: readonly HairStyle[] = [
  { id: "hair_short", label: "Short", spriteKey: "hair_short" },
  { id: "hair_medium", label: "Medium", spriteKey: "hair_medium" },
  { id: "hair_long", label: "Long", spriteKey: "hair_long" },
  { id: "hair_ponytail", label: "Ponytail", spriteKey: "hair_ponytail" },
  { id: "hair_spiky", label: "Spiky", spriteKey: "hair_spiky" },
  { id: "hair_bob", label: "Bob", spriteKey: "hair_bob" },
];

export interface HairColor {
  readonly id: string;
  readonly label: string;
  readonly hex: string;
}

export const HAIR_COLORS: readonly HairColor[] = [
  { id: "color_black", label: "Black", hex: "#1A1A1A" },
  { id: "color_brown", label: "Brown", hex: "#6B3A2A" },
  { id: "color_blonde", label: "Blonde", hex: "#E8C56D" },
  { id: "color_red", label: "Red", hex: "#A0522D" },
  { id: "color_blue", label: "Blue", hex: "#4A7DDB" },
  { id: "color_pink", label: "Pink", hex: "#E77CB3" },
  { id: "color_white", label: "White", hex: "#E0E0E0" },
  { id: "color_green", label: "Green", hex: "#5DAD60" },
];

export interface FaceStyle {
  readonly id: string;
  readonly label: string;
  readonly spriteKey: string;
}

export const FACE_STYLES: readonly FaceStyle[] = [
  { id: "face_default", label: "Default", spriteKey: "face_default" },
  { id: "face_determined", label: "Determined", spriteKey: "face_determined" },
  { id: "face_happy", label: "Happy", spriteKey: "face_happy" },
  { id: "face_stoic", label: "Stoic", spriteKey: "face_stoic" },
  { id: "face_wonder", label: "Wonder", spriteKey: "face_wonder" },
];

export interface StarterOutfit {
  readonly id: string;
  readonly label: string;
  readonly spriteKey: string;
  readonly gender: Gender | "U";
}

export const STARTER_OUTFITS: readonly StarterOutfit[] = [
  { id: "outfit_tunic", label: "Adventurer Tunic", spriteKey: "outfit_tunic", gender: "U" },
  { id: "outfit_robe", label: "Wanderer Robe", spriteKey: "outfit_robe", gender: "U" },
  { id: "outfit_vest", label: "Island Vest", spriteKey: "outfit_vest", gender: "M" },
  { id: "outfit_dress", label: "Island Dress", spriteKey: "outfit_dress", gender: "F" },
];

// ---------------------------------------------------------------------------
// CharacterAppearance — the full cosmetic identity.
// ---------------------------------------------------------------------------

export interface CharacterAppearance {
  readonly gender: Gender;
  readonly skinId: string;
  readonly hairId: string;
  readonly hairColorId: string;
  readonly faceId: string;
  readonly outfitId: string;
}

// ---------------------------------------------------------------------------
// randomizeAppearance — returns a valid, randomised look.
// Accepts an optional RNG function (0–1) for determinism in tests.
// ---------------------------------------------------------------------------

function pick<T>(arr: readonly T[], rng: () => number): T {
  const item = arr[Math.floor(rng() * arr.length)];
  if (item === undefined) {
    throw new Error("pick: cannot select from an empty array");
  }
  return item;
}

/**
 * Generate a randomised character appearance.
 * @param rng - A function returning a float in [0, 1). Defaults to `Math.random`.
 */
export function randomizeAppearance(rng: () => number = Math.random): CharacterAppearance {
  const gender: Gender = rng() < 0.5 ? "M" : "F";
  const skinTone = pick(SKIN_TONES, rng);
  const hairStyle = pick(HAIR_STYLES, rng);
  const hairColor = pick(HAIR_COLORS, rng);
  const faceStyle = pick(FACE_STYLES, rng);

  // Filter outfits to those matching the chosen gender or universal ("U")
  const genderOutfits = STARTER_OUTFITS.filter((o) => o.gender === gender || o.gender === "U");
  const outfit = pick(genderOutfits, rng);

  return {
    gender,
    skinId: skinTone.id,
    hairId: hairStyle.id,
    hairColorId: hairColor.id,
    faceId: faceStyle.id,
    outfitId: outfit.id,
  };
}
