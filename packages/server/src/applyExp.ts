/**
 * Server helper — wraps the shared `applyExp` pure function and applies
 * the result to a live Colyseus Player schema. Handles:
 *   • level / exp update
 *   • AP / SP pool increments
 *   • max HP / MP recomputation + full heal on level-up
 *   • persistence to the durable CharacterRecord
 *
 * Import this from both MapRoom and TownRoom instead of ad-hoc expToNext loops.
 */
import { applyExp, type ClassArchetype } from "@maple/shared";
import type { Player } from "./rooms/schema/Player";
import { accountStore } from "./persistence/store";

export interface GrantExpResult {
  /** Whether at least one level-up occurred. */
  leveledUp: boolean;
  /** Number of levels gained. */
  levelsGained: number;
  /** Total AP granted across all level-ups. */
  apGained: number;
  /** Total SP granted across all level-ups. */
  spGained: number;
}

/**
 * Award `gained` EXP to a player, rolling over any number of level-ups.
 *
 * Updates the Player schema in-place and persists to the durable store.
 * The caller is responsible for broadcasting a LEVEL_UP event when
 * `result.leveledUp` is true.
 */
export function grantExp(player: Player, gained: number): GrantExpResult {
  const archetype = player.archetype as ClassArchetype;

  const result = applyExp({ level: player.level, exp: player.exp }, gained, archetype);

  // Update schema fields.
  player.level = result.level;
  player.exp = result.exp;
  player.ap += result.apGained;
  player.sp += result.spGained;
  player.maxHp = result.maxHp;
  player.maxMp = result.maxMp;

  if (result.leveledUp) {
    // Full heal on level-up (MapleStory convention).
    player.hp = result.maxHp;
    player.mp = result.maxMp;
  }

  // Persist to durable store.
  accountStore.updateCharacter(player.charId, {
    level: player.level,
    exp: player.exp,
    ap: player.ap,
    sp: player.sp,
    maxHp: player.maxHp,
    maxMp: player.maxMp,
    stats: {
      STR: player.str,
      DEX: player.dex,
      INT: player.intel,
      LUK: player.luk,
      HP: player.hp,
      MP: player.mp,
    },
  });

  return {
    leveledUp: result.leveledUp,
    levelsGained: result.levelsGained,
    apGained: result.apGained,
    spGained: result.spGained,
  };
}
