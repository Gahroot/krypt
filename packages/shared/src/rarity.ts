/**
 * Rarity — the two-layer item-quality model, reskinned from MapleStory.
 *
 *  1. Potential tier  (rolled at drop)   → RARE / EPIC / UNIQUE / LEGENDARY  (border color)
 *  2. Base rank       (raised by upgrades) → NORMAL → ENHANCED → STARFORGED → MYTHIC (name color)
 *
 * The Potential odds below are PUBLIC, DETERMINISTIC, and UNIT-TESTED. This is the off-chain
 * rehearsal of the on-chain "provably fair" claim — the direct answer to a central operator
 * secretly nerfing drop rates. `rollPotential()` takes an injectable RNG so it is fully testable
 * and can later be driven by Chainlink VRF output on-chain.
 */

/** Layer 1: the rolled bonus-stat tier. Order is ascending rarity. */
export enum PotentialTier {
  RARE = "RARE",
  EPIC = "EPIC",
  UNIQUE = "UNIQUE",
  LEGENDARY = "LEGENDARY",
}

/** Layer 2: the upgrade ladder. Order is ascending power. */
export enum BaseRank {
  NORMAL = "NORMAL",
  ENHANCED = "ENHANCED",
  STARFORGED = "STARFORGED",
  MYTHIC = "MYTHIC",
}

export interface PotentialTierInfo {
  readonly tier: PotentialTier;
  readonly label: string;
  /** Border color (hex) shown around the item icon. */
  readonly color: string;
  /** Relative drop weight. Public + immutable. Higher = more common. */
  readonly weight: number;
  /** How many bonus stat lines this tier grants. */
  readonly lines: number;
}

/**
 * The public drop table. Weights total 1300 →
 *   RARE 76.92%, EPIC 19.23%, UNIQUE 3.46%, LEGENDARY 0.385%.
 * A Legendary is a genuine "god roll" lottery ticket — and the only tier that mints on-chain (Phase 2).
 */
export const POTENTIAL_TIERS: readonly PotentialTierInfo[] = [
  { tier: PotentialTier.RARE, label: "Rare", color: "#3B82F6", weight: 1000, lines: 1 },
  { tier: PotentialTier.EPIC, label: "Epic", color: "#A855F7", weight: 250, lines: 2 },
  { tier: PotentialTier.UNIQUE, label: "Unique", color: "#F59E0B", weight: 45, lines: 3 },
  { tier: PotentialTier.LEGENDARY, label: "Legendary", color: "#22C55E", weight: 5, lines: 3 },
] as const;

const TIER_INFO: Record<PotentialTier, PotentialTierInfo> = Object.fromEntries(
  POTENTIAL_TIERS.map((t) => [t.tier, t]),
) as Record<PotentialTier, PotentialTierInfo>;

export function getPotentialTierInfo(tier: PotentialTier): PotentialTierInfo {
  return TIER_INFO[tier];
}

/** Sum of all weights — exported so callers/tests can reason about odds. */
export const TOTAL_POTENTIAL_WEIGHT: number = POTENTIAL_TIERS.reduce((sum, t) => sum + t.weight, 0);

/**
 * Roll a Potential tier using the public weighted table.
 * @param rng a function returning a float in [0, 1). Defaults to Math.random; inject for tests/VRF.
 */
export function rollPotential(rng: () => number = Math.random): PotentialTier {
  let roll = rng() * TOTAL_POTENTIAL_WEIGHT;
  for (const t of POTENTIAL_TIERS) {
    if (roll < t.weight) return t.tier;
    roll -= t.weight;
  }
  // Numerically unreachable (rng < 1), but return the rarest as a safe fallback.
  return PotentialTier.LEGENDARY;
}

/** Public odds as exact probabilities in [0, 1], keyed by tier — for display + audit. */
export function potentialOdds(): Record<PotentialTier, number> {
  return Object.fromEntries(
    POTENTIAL_TIERS.map((t) => [t.tier, t.weight / TOTAL_POTENTIAL_WEIGHT]),
  ) as Record<PotentialTier, number>;
}

/**
 * Whether a tier is rare enough to mint as an on-chain NFT (Phase 2).
 * Currently Legendary-only, keeping chain volume sane and ownership meaningful.
 */
export function isMintWorthy(tier: PotentialTier): boolean {
  return tier === PotentialTier.LEGENDARY;
}

export interface BaseRankInfo {
  readonly rank: BaseRank;
  readonly label: string;
  /** Item-name color (hex). */
  readonly color: string;
  /** Position on the upgrade ladder (0-based). */
  readonly order: number;
  /** Flat multiplier applied to the item's base stats at this rank. */
  readonly statMultiplier: number;
}

/** The upgrade ladder. Raised in-game via crafting/star-forging (off-chain). */
export const BASE_RANKS: readonly BaseRankInfo[] = [
  { rank: BaseRank.NORMAL, label: "Normal", color: "#E5E7EB", order: 0, statMultiplier: 1.0 },
  { rank: BaseRank.ENHANCED, label: "Enhanced", color: "#60A5FA", order: 1, statMultiplier: 1.25 },
  { rank: BaseRank.STARFORGED, label: "Star-forged", color: "#C084FC", order: 2, statMultiplier: 1.6 },
  { rank: BaseRank.MYTHIC, label: "Mythic", color: "#F87171", order: 3, statMultiplier: 2.1 },
] as const;

const RANK_INFO: Record<BaseRank, BaseRankInfo> = Object.fromEntries(
  BASE_RANKS.map((r) => [r.rank, r]),
) as Record<BaseRank, BaseRankInfo>;

export function getBaseRankInfo(rank: BaseRank): BaseRankInfo {
  return RANK_INFO[rank];
}

/** The next rank up the ladder, or null if already Mythic. */
export function nextBaseRank(rank: BaseRank): BaseRank | null {
  const next = BASE_RANKS[RANK_INFO[rank].order + 1];
  return next ? next.rank : null;
}
