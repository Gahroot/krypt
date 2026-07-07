/**
 * Town minigame system — simple reaction/color-matching games with modest rewards.
 * Adds social downtime activities to town maps.
 */

// ─── Minigame types ────────────────────────────────────────────────────────

export type MinigameType = "color_match";

export interface MinigameDef {
  readonly id: string;
  readonly name: string;
  readonly type: MinigameType;
  /** Number of rounds per game session. */
  readonly rounds: number;
  /** Milliseconds to react per round. */
  readonly reactionWindowMs: number;
  /** Mesos reward per successful round. */
  readonly mesosPerRound: number;
  /** EXP reward per successful round. */
  readonly expPerRound: number;
  /** Bonus mesos for a perfect game (all rounds correct). */
  readonly perfectBonusMesos: number;
  /** Bonus EXP for a perfect game. */
  readonly perfectBonusExp: number;
  /** Cooldown (ms) between games. */
  readonly cooldownMs: number;
  /** Maps where this minigame is available. */
  readonly allowedMaps: readonly string[];
}

/** Available colors for the color-match game. */
export const MINIGAME_COLORS = ["red", "blue", "green", "yellow", "purple", "orange"] as const;

/** Town minigame catalog. */
export const TOWN_MINIGAMES: Record<string, MinigameDef> = {
  color_crush: {
    id: "color_crush",
    name: "Color Crush",
    type: "color_match",
    rounds: 5,
    reactionWindowMs: 3000,
    mesosPerRound: 20,
    expPerRound: 10,
    perfectBonusMesos: 100,
    perfectBonusExp: 50,
    cooldownMs: 30_000,
    allowedMaps: [
      "dawn_isle",
      "heartland_harbor",
      "meadowfield",
      "sylvanreach",
      "craghold",
      "dusk_ward",
      "mirefen_marsh",
    ],
  },
};

/** Look up a minigame def by id. */
export function getMinigameDef(minigameId: string): MinigameDef | undefined {
  return TOWN_MINIGAMES[minigameId];
}
