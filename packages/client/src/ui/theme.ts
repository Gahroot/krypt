/**
 * Runtime theme sync — keeps the overlay's rarity/rank color tokens identical to
 * the authoritative game data in @maple/shared.
 *
 * `styles.css` seeds `--rarity-*` / `--rank-*` with build-time fallbacks so the
 * Tailwind utilities (`border-rarity-epic`, `text-rank-mythic`, …) exist before
 * any JS runs. This function overwrites those custom properties on :root from
 * POTENTIAL_TIERS and BASE_RANKS, so the React UI can NEVER drift from the
 * colors items are drawn with in-game — @maple/shared stays the single source of
 * truth. Called once from mount.tsx before the first render.
 */
import { POTENTIAL_TIERS, BASE_RANKS, type Element } from "@maple/shared";

export function applyRarityTheme(root: HTMLElement = document.documentElement): void {
  for (const tier of POTENTIAL_TIERS) {
    root.style.setProperty(`--rarity-${tier.tier.toLowerCase()}`, tier.color);
  }
  for (const rank of BASE_RANKS) {
    // BaseRank.STARFORGED → "starforged" (matches the token name in styles.css).
    root.style.setProperty(`--rank-${rank.rank.toLowerCase()}`, rank.color);
  }
}

/**
 * Short labels for each potential tier — used as corner badges on item cells
 * so rarity is identifiable without relying on border color alone.
 */
export const RARITY_SHORT_LABELS: Record<string, string> = {
  RARE: "R",
  EPIC: "E",
  UNIQUE: "U",
  LEGENDARY: "L",
};

/**
 * Emoji icons for each element — used in skill tooltips and combat feedback
 * so elemental affinity is distinguishable without relying on color alone.
 */
export const ELEMENT_ICONS: Record<Element, string> = {
  FIRE: "🔥",
  ICE: "❄️",
  LIGHTNING: "⚡",
  POISON: "☠️",
  HOLY: "✨",
  DARK: "🌑",
  PHYSICAL: "⚔️",
  NONE: "",
};
