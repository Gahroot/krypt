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
import { POTENTIAL_TIERS, BASE_RANKS } from "@maple/shared";

export function applyRarityTheme(root: HTMLElement = document.documentElement): void {
  for (const tier of POTENTIAL_TIERS) {
    root.style.setProperty(`--rarity-${tier.tier.toLowerCase()}`, tier.color);
  }
  for (const rank of BASE_RANKS) {
    // BaseRank.STARFORGED → "starforged" (matches the token name in styles.css).
    root.style.setProperty(`--rank-${rank.rank.toLowerCase()}`, rank.color);
  }
}
