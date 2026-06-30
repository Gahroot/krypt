/**
 * @maple/shared — the single source of truth for game systems.
 *
 * Pure data + pure functions used by BOTH the authoritative server (logic) and the Phaser client
 * (display). No runtime dependencies. Colyseus Schemas live server-side; the client imports types.
 */

export * from "./net.js";
export * from "./protocol.js";
export * from "./rarity.js";
export * from "./stats.js";
export * from "./classes.js";
export * from "./items.js";
export * from "./mobs.js";
export * from "./world.js";
export * from "./appearance.js";
export * from "./npcs.js";
export * from "./quests.js";
export * from "./cashshop.js";
export * from "./shops.js";
export * from "./skillbook.js";
export * from "./sets.js";
export * from "./consumables.js";
export * from "./combat.js";
export * from "./profanity.js";
export * from "./progression.js";
export * from "./guidance.js";
export * from "./effects.js";
export * from "./inventory.js";
export * from "./market.js";
export * from "./codex.js";
export * from "./familiars.js";
export {
  type AchievementConditionKind,
  type AchievementCondition,
  type AchievementReward,
  type AchievementDef,
  type AchievementProgress,
  ACHIEVEMENTS,
  createAchievementProgress,
  updateAchievementProgress,
  getAchievementSnapshot,
  getAllAchievementSnapshots,
} from "./achievements.js";
export {
  type PQObjective,
  type PQStageDef,
  type PQRewardSet,
  type PartyQuestDef,
  type PQStageProgress,
  type PQRunStatus,
  PARTY_QUESTS,
  getPartyQuest,
  createPQStageProgress,
} from "./partyquests.js";
export {
  type ActionId,
  type KeyBind,
  type KeyMap,
  type PlayerSettings,
  type VideoSettings,
  type AudioSettings,
  type GameplaySettings,
  type SettingsPayload,
  ALL_ACTION_IDS,
  ACTION_LABELS,
  DEFAULT_KEY_MAP,
  DEFAULT_SETTINGS,
} from "./keybindings.js";
export {
  type AutoPotConfig,
  type AutoPotSyncPayload,
  type MacroStep,
  type SkillMacro,
  type MacroLayoutPayload,
  type MacroCastPayload,
  type FeedbackCategory,
  type FeedbackSubmitPayload,
  type FeedbackResultPayload,
} from "./net.js";
