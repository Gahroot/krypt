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
  {
    rank: BaseRank.STARFORGED,
    label: "Star-forged",
    color: "#C084FC",
    order: 2,
    statMultiplier: 1.6,
  },
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

// ─── Base Rank Upgrade Ladder ────────────────────────────────────────────

/** Default success rate per upgrade step. Each tier shares the same rate. */
export const UPGRADE_BASE_RATE = 0.5;

/** Per-step mesos cost for a base-rank upgrade. Scales with the target rank. */
export function upgradeCost(targetRank: BaseRank): number {
  const idx = RANK_INFO[targetRank].order; // NORMAL=0, ENHANCED=1, …
  // Costs: ENHANCED 500, STARFORGED 2 000, MYTHIC 8 000
  return 500 * 4 ** (idx - 1);
}

/** Material shard counts consumed per upgrade step. */
export function upgradeMaterialCost(targetRank: BaseRank): number {
  const idx = RANK_INFO[targetRank].order;
  // Shards: ENHANCED 3, STARFORGED 8, MYTHIC 20
  return idx <= 1 ? 3 : idx === 2 ? 8 : 20;
}

export interface UpgradeOptions {
  /** RNG returning [0, 1). Defaults to Math.random. */
  rng?: () => number;
  /** Override the success rate per step (default: UPGRADE_BASE_RATE). */
  successRate?: number;
  /** On failure, the item drops one rank (e.g. STARFORGED → ENHANCED). Default: false. */
  allowDowngrade?: boolean;
}

export interface UpgradeSuccess {
  readonly ok: true;
  /** The new base rank after the successful upgrade. */
  readonly newRank: BaseRank;
  /** Previous rank before the upgrade. */
  readonly prevRank: BaseRank;
}

export interface UpgradeFailure {
  readonly ok: false;
  /** Rank stayed the same (no downgrade). */
  readonly newRank: BaseRank;
  /** Previous rank (unchanged). */
  readonly prevRank: BaseRank;
}

/** If downgrade is enabled and the item was downgraded, this captures the demoted rank. */
export interface UpgradeDowngrade {
  readonly ok: false;
  readonly newRank: BaseRank;
  readonly prevRank: BaseRank;
  /** True when the failure caused a rank demotion. */
  readonly downgraded: true;
}

export type UpgradeResult = UpgradeSuccess | UpgradeFailure | UpgradeDowngrade;

/**
 * Attempt a single base-rank upgrade step. Pure function — returns a result object
 * and never mutates inputs.
 *
 * Ladder: NORMAL → ENHANCED → STARFORGED → MYTHIC.
 * At MYTHIC, returns `null` (nothing to upgrade).
 *
 * @param currentRank The item's current base rank.
 * @param opts        Upgrade options (RNG, success rate override, downgrade flag).
 * @returns           UpgradeResult on success/failure, or null if already max rank.
 */
export function upgradeBaseRank(
  currentRank: BaseRank,
  opts?: UpgradeOptions,
): UpgradeResult | null {
  const next = nextBaseRank(currentRank);
  if (!next) return null; // already MYTHIC

  const rng = opts?.rng ?? Math.random;
  const rate = opts?.successRate ?? UPGRADE_BASE_RATE;
  const roll = rng();

  if (roll < rate) {
    // ── Success ──────────────────────────────────────────────────────────
    return { ok: true, newRank: next, prevRank: currentRank };
  }

  // ── Failure ────────────────────────────────────────────────────────────
  if (opts?.allowDowngrade && currentRank !== BaseRank.NORMAL) {
    const prevOrder = RANK_INFO[currentRank].order;
    const demotedEntry = BASE_RANKS[prevOrder - 1];
    if (demotedEntry === undefined) {
      throw new Error(`upgrade: no base rank below order ${prevOrder}`);
    }
    const demoted = demotedEntry.rank;
    return {
      ok: false,
      newRank: demoted,
      prevRank: currentRank,
      downgraded: true,
    } as UpgradeDowngrade;
  }

  return { ok: false, newRank: currentRank, prevRank: currentRank };
}

// ─── Star Force (per-star enhancement, distinct from base-rank ladder) ─────

/** Maximum number of stars an item can hold. */
export const MAX_STARS = 15;

/** Outcome of a star-force attempt. */
export type StarForceOutcome = "success" | "fail" | "destroy";

export interface StarForceTier {
  /** Star level being attempted (0 = going from 0→1 star, etc.). */
  readonly star: number;
  /** Probability of success (gain +1 star). */
  readonly successRate: number;
  /** Probability of failure with no star loss. */
  readonly failRate: number;
  /** Probability of failure + item destruction. */
  readonly destroyRate: number;
  /** Flat ATK bonus granted when this star is achieved. */
  readonly atkBonus: number;
  /** Flat primary-stat bonus (applied to all four stats). */
  readonly statBonus: number;
}

/**
 * The public Star Force odds table. Each entry describes the attempt from `star` to `star + 1`.
 * success + fail + destroy == 1.0 for every row. Immutable + unit-tested.
 *
 * Curve rationale: early stars are cheap and safe (newbie-friendly). Mid stars introduce
 * destroy risk. Late stars are a genuine meso/material sink for endgame power.
 */
export const STAR_FORCE_TABLE: readonly StarForceTier[] = [
  { star: 0, successRate: 0.95, failRate: 0.05, destroyRate: 0.0, atkBonus: 2, statBonus: 1 },
  { star: 1, successRate: 0.9, failRate: 0.1, destroyRate: 0.0, atkBonus: 2, statBonus: 1 },
  { star: 2, successRate: 0.85, failRate: 0.15, destroyRate: 0.0, atkBonus: 3, statBonus: 2 },
  { star: 3, successRate: 0.8, failRate: 0.2, destroyRate: 0.0, atkBonus: 3, statBonus: 2 },
  { star: 4, successRate: 0.75, failRate: 0.25, destroyRate: 0.0, atkBonus: 4, statBonus: 3 },
  { star: 5, successRate: 0.7, failRate: 0.28, destroyRate: 0.02, atkBonus: 4, statBonus: 3 },
  { star: 6, successRate: 0.65, failRate: 0.3, destroyRate: 0.05, atkBonus: 5, statBonus: 4 },
  { star: 7, successRate: 0.6, failRate: 0.32, destroyRate: 0.08, atkBonus: 5, statBonus: 4 },
  { star: 8, successRate: 0.55, failRate: 0.34, destroyRate: 0.11, atkBonus: 6, statBonus: 5 },
  { star: 9, successRate: 0.5, failRate: 0.35, destroyRate: 0.15, atkBonus: 6, statBonus: 5 },
  { star: 10, successRate: 0.45, failRate: 0.35, destroyRate: 0.2, atkBonus: 7, statBonus: 6 },
  { star: 11, successRate: 0.4, failRate: 0.35, destroyRate: 0.25, atkBonus: 7, statBonus: 6 },
  { star: 12, successRate: 0.35, failRate: 0.35, destroyRate: 0.3, atkBonus: 8, statBonus: 7 },
  { star: 13, successRate: 0.3, failRate: 0.35, destroyRate: 0.35, atkBonus: 8, statBonus: 7 },
  { star: 14, successRate: 0.25, failRate: 0.35, destroyRate: 0.4, atkBonus: 10, statBonus: 8 },
] as const;

const STAR_FORCE_BY_STAR: Record<number, StarForceTier> = Object.fromEntries(
  STAR_FORCE_TABLE.map((t) => [t.star, t]),
) as Record<number, StarForceTier>;

/** Look up the star-force tier for a given star level. Returns undefined if at max. */
export function getStarForceTier(star: number): StarForceTier | undefined {
  return STAR_FORCE_BY_STAR[star];
}

/** Public odds as exact probabilities — for display + audit. */
export function starForceOdds(
  star: number,
): { successRate: number; failRate: number; destroyRate: number } | undefined {
  const tier = STAR_FORCE_BY_STAR[star];
  return tier
    ? { successRate: tier.successRate, failRate: tier.failRate, destroyRate: tier.destroyRate }
    : undefined;
}

/**
 * Cumulative ATK bonus from `n` stars. Sum of atkBonus for each achieved star level [0, n).
 */
export function starForceAtkBonus(stars: number): number {
  let total = 0;
  for (const t of STAR_FORCE_TABLE) {
    if (t.star >= stars) break;
    total += t.atkBonus;
  }
  return total;
}

/**
 * Cumulative primary-stat bonus from `n` stars. Sum of statBonus for each achieved star level [0, n).
 */
export function starForceStatBonus(stars: number): number {
  let total = 0;
  for (const t of STAR_FORCE_TABLE) {
    if (t.star >= stars) break;
    total += t.statBonus;
  }
  return total;
}

/**
 * Meso cost for a star-force attempt from `star` → `star + 1`.
 * Exponential curve: 500 * 2^star, rounded to nearest 100.
 */
export function starForceCost(star: number): number {
  return Math.round((500 * 2 ** star) / 100) * 100;
}

/**
 * Material (Aether Shard) count consumed per star-force attempt.
 * Scales from 1 at 0★ to 44 at 14★.
 */
export function starForceMaterialCost(star: number): number {
  if (star <= 4) return star + 1; // 1..5
  if (star <= 9) return 6 + (star - 5) * 2; // 6,8,10,12,14
  return 18 + (star - 10) * 7; // 18,25,32,39,46
}

export interface StarForceAttempt {
  readonly outcome: StarForceOutcome;
  readonly prevStars: number;
  readonly newStars: number;
}

/**
 * Attempt a star-force upgrade. Pure function — returns the outcome.
 * @param currentStars The item's current star count.
 * @param rng          RNG returning [0, 1). Defaults to Math.random.
 * @returns            The attempt result, or null if already at MAX_STARS.
 */
export function rollStarForce(
  currentStars: number,
  rng: () => number = Math.random,
): StarForceAttempt | null {
  if (currentStars >= MAX_STARS) return null;
  const tier = STAR_FORCE_BY_STAR[currentStars];
  if (!tier) return null;

  const roll = rng();
  if (roll < tier.successRate) {
    return { outcome: "success", prevStars: currentStars, newStars: currentStars + 1 };
  }
  if (roll < tier.successRate + tier.failRate) {
    return { outcome: "fail", prevStars: currentStars, newStars: currentStars };
  }
  return { outcome: "destroy", prevStars: currentStars, newStars: 0 };
}

// ─── Verifiable Roll (provably-fair, Chainlink VRF bridge) ──────────────────

/**
 * The verifiable-roll shape returned by reroll operations.
 * This is the off-chain rehearsal of the on-chain "provably fair" claim:
 *   1. Client/server agree on a seed commitment (hash) BEFORE the roll.
 *   2. The roll is computed with a deterministic RNG seeded from that seed.
 *   3. The seed is revealed; anyone can re-derive the result.
 *
 * On-chain (Phase 2), Chainlink VRF replaces the seed with a verifiable
 * random number that no party can predict or manipulate.
 */
export interface VerifiableRoll {
  /** Hex-encoded seed used to drive the RNG for this roll. */
  readonly seed: string;
  /**
   * Hex-encoded commitment (hash of seed) revealed BEFORE the roll.
   * On-chain this becomes the Chainlink VRF request ID.
   */
  readonly commitment: string;
  /** The new potential tier after the roll. */
  readonly newTier: PotentialTier;
  /** The number of bonus stat lines rolled (determined by tier). */
  readonly linesCount: number;
  /** Unix-ms timestamp of when the roll was executed. */
  readonly timestamp: number;
}

/**
 * Generate a VerifiableRoll shape from a seed + tier result.
 * Pure helper — the actual hashing will use a secure hash in production.
 * For the MVP we use a simple hex encoding so the shape is testable end-to-end.
 */
export function createVerifiableRoll(
  seed: number,
  newTier: PotentialTier,
  timestamp?: number,
): VerifiableRoll {
  // Simple commitment for MVP: hex-encode the seed.
  // Production: SHA-256(seed + server_nonce) committed before the roll.
  const seedHex = "0x" + (seed >>> 0).toString(16).padStart(8, "0");
  const commitmentHex = "0x" + ((seed * 0x9e3779b9) >>> 0).toString(16).padStart(8, "0");
  return {
    seed: seedHex,
    commitment: commitmentHex,
    newTier,
    linesCount: getPotentialTierInfo(newTier).lines,
    timestamp: timestamp ?? Date.now(),
  };
}
