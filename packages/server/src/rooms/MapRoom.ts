/**
 * MapRoom — generic zone room that loads geometry from the shared map registry.
 *
 * Authoritative simulation built on the verified Colyseus pattern (tutorial-phaser Part4Room):
 *   - fixed timestep (1000/60) via setSimulationInterval
 *   - clients push *inputs* to a per-player queue; the server owns all movement, combat, and loot
 *   - the client can never move or mint authoritatively — it only predicts and reconciles
 *
 * Movement is a side-scrolling platformer with gravity, jumping, and foothold collision.
 * Map geometry comes from the shared GameMap registry — the single source of truth for
 * platforms, ladders, portals, and spawns.
 *
 * Loot odds come from @maple/shared (public + unit-tested) — the off-chain rehearsal of the on-chain
 * "provably fair" claim. A Legendary pickup records a `legendaryMintPending` entry for the future
 * chain step; no chain call is made yet (Phase 2).
 */
import { Client } from "colyseus";
import { AuthedRoom } from "./AuthedRoom";
import { ArraySchema } from "@colyseus/schema";
import {
  ClassArchetype,
  type PrimaryStat,
  type Foothold,
  type Ladder,
  type GameMap,
  type MobDef,
  type Portal,
  type DialogNode,
  type DialogLine,
  type DialogBranch,
  type NpcDef,
  getClass,
  getBranch,
  getBranchesForArchetype,
  maxHpForLevel,
  maxMpForLevel,
  autoAssign,
  spendAp,
  learnSkill,
  spSpent,
  getMobDef,
  getMap,
  rollMesos,
  rollItemDrops,
  rollPotential,
  isMintWorthy,
  lineCountForTier,
  groundYAt,
  clampXByWalls,
  ladderAt,
  randomizeAppearance,
  NPCS,
  QUESTS,
  getNpcsForMap,
  getAdvancementQuest,
  AttackType,
  resolveAttackType,
  resolveEquippedBonus,
  canEquip,
  resolveRingSlot,
  deriveSecondary,
  computeSetBonuses,
  ATTACK_RANGE_MELEE,
  ATTACK_RANGE_RANGED,
  ATTACK_RANGE_MAGIC,
  ATTACK_VERT_ALL,
  MAGIC_HIT_TARGETS,
  computeDamage,
  type AttackerCombatStats,
  type DefenderCombatStats,
  getCashItem,
  appearanceFieldsForCategory,
  type CharacterAppearance,
  getItemDef,
  EquipSlot,
  rollPotentialLines,
  getShopDef,
  getItemSellPrice,
  getShopNpcIds,
  isConsumable,
  tabForItem,
  TAB_CAPACITY,
  MAX_STACK,
  type InventoryTab,
  type CashCategory,
  type PotentialLine,
  rerollPotential,
  createVerifiableRoll,
  CUBE_REROLL_COST,
  FLAME_REROLL_COST,
  rerollBonusStats,
  type BonusStatLine,
  upgradeBaseRank,
  nextBaseRank,
  upgradeCost,
  upgradeMaterialCost,
  getBaseRankInfo,
  rollStarForce,
  starForceCost,
  starForceMaterialCost,
  getStarForceTier,
  skillStatAt,
  allSkillsForClass,
  getConsumableDef,
  UPGRADE_SHARD_DEF_ID,
  evaluateCodexMilestones,
  giveFame,
  meetsFameGate,
  startExploration,
  claimExplorations,
  maxExplorationSlots,
  registeredCodexEntries,
  MOBS as MOB_DEFS,
  createAchievementProgress,
  updateAchievementProgress,
  getAllAchievementSnapshots,
  ACHIEVEMENTS,
  FIELD_BOSS_IDS,
  SUMMON_BOSSES_BY_ITEM,
  DEFAULT_SETTINGS,
  type AutoPotConfig,
  type SkillMacro,
  type MacroStep,
  type MacroCastPayload,
  type MacroLayoutPayload,
  type AutoPotSyncPayload,
  filterProfanity,
  travelFee,
  applyEffect,
  tickEffects,
  aggregateSecondary,
  skillBuffToStatusEffect,
  skillDebuffToStatusEffects,
  isStunned,
  getSlowMultiplier,
  passiveEffectBonus,
  isFamiliarCard,
  familiarCardId,
  deriveFamiliarStats,
  FAMILIAR_ENABLED,
  FAMILIAR_MAX_SUMMONED,
  FAMILIAR_DAMAGE_FRACTION,
  FAMILIAR_ATTACK_COOLDOWN_MS,
  FAMILIAR_AGGRO_RANGE,
  FAMILIAR_AGGRO_VERT,
  FAMILIAR_ATTACK_RANGE,
  FAMILIAR_DEAGGRO_RANGE,
  FAMILIAR_CARD_DROP_CHANCE,
  type FamiliarCollection,
  EMPTY_FAMILIAR_COLLECTION,
  isCombatMap,
  deathExpLoss,
  getDeathReturnMapId,
  ELITE_SCALING,
  createEliteMob,
  getEffectiveMobDef,
  utcDateKey,
  TUTORIAL_QUEST_CHAIN,
  getDailyLoginReward,
} from "@maple/shared";

import { TownState } from "./schema/TownState";
import { Player } from "./schema/Player";
import { Mob } from "./schema/Mob";
import { Projectile } from "./schema/Projectile";
import { LootDrop } from "./schema/LootDrop";
import { Familiar } from "./schema/Familiar";
import { InventoryItem } from "./schema/InventoryItem";
import { SpawnManager } from "../spawnManager";
import { BossManager } from "../bossManager";
import { RuneManager } from "../runeManager";
import { TreasureBoxManager } from "../treasureBoxManager";
import { channelRegistry } from "../channelRegistry";
import { CHANNELS_PER_MAP } from "../app.config";
import type { MobBehavior } from "@maple/shared";
import {
  type InputData,
  type ChatPayload,
  type CreateCharacterPayload,
  type DeleteCharacterPayload,
  type EquipItemPayload,
  type UnequipItemPayload,
  type SpendApPayload,
  type LearnSkillPayload,
  type LearnSkillResultPayload,
  type TravelPayload,
  type SessionGenerationPayload,
  type ForceLogoutPayload,
  type FerryBlockedPayload,
  type TransportStatusPayload,
  type TalkNpcPayload,
  type DialogLinePayload,
  type DialogChoicePayload,
  type DialogEndPayload,
  type JobAdvancePayload,
  type BranchListPayload,
  type BranchChoicePayload,
  type BuyCashItemPayload,
  type BuyCashItemResultPayload,
  type EquipCashItemPayload,
  type EquipCashItemResultPayload,
  type CashInfoRequestPayload,
  type CashInfoPayload,
  type BuyFromShopPayload,
  type BuyFromShopResultPayload,
  type SellToShopPayload,
  type SellToShopResultPayload,
  type SkillBookRequestPayload,
  type SkillBookResponsePayload,
  type LevelUpPayload,
  type CombatHitPayload,
  type TradeInvitePayload,
  type TradeAcceptPayload,
  type TradeRejectPayload,
  type TradeCancelPayload,
  type TradeOfferPayload,
  type TradeLockPayload,
  type TradeConfirmPayload,
  type TradeUpdatePayload,
  type TradeResultPayload,
  type StorageDepositPayload,
  type StorageWithdrawPayload,
  type StorageResultPayload,
  type RepairEquipmentPayload,
  type RepairResultPayload,
  type CubeRerollPayload,
  type CubeRerollResultPayload,
  type UpgradeItemPayload,
  type UpgradeItemResultPayload,
  type StarForcePayload,
  type StarForceResultPayload,
  type FlameRerollPayload,
  type FlameRerollResultPayload,
  type GiveFamePayload,
  type FameResultPayload,
  type CodexSyncPayload,
  type AchievementSyncPayload,
  type AchievementUnlockPayload,
  type SkillCastPayload,
  type SkillCastResultPayload,
  type UseConsumablePayload,
  type UseConsumableResultPayload,
  type InventorySortPayload,
  type QuickSlotLayoutPayload,
  type SettingsPayload,
  type QuestOfferPayload,
  type QuestAcceptPayload,
  type QuestDeclinePayload,
  type QuestTurninOfferPayload,
  type QuestTurninAcceptPayload,
  type QuestTurninDeclinePayload,
  type QuestAbandonPayload,
  type FeedbackSubmitPayload,
  type FeedbackResultPayload,
  type PlayerReportPayload,
  type PlayerReportResultPayload,
  type BlockPlayerPayload,
  type UnblockPlayerPayload,
  type BlockedListResultPayload,
  type ServerAnnouncementPayload,
  type ModActionResultPayload,
  type GuideTravelPayload,
  type MapTravelPayload,
  type DailyLoginGiftSyncPayload,
  type UnstuckResultPayload,
  MessageType,
} from "../types";
import {
  accountStore,
  treasuryStore,
  feedbackStore,
  moderationStore,
  persistGuildsAndFriends,
  type CharacterRecord,
  STORAGE_CAPACITY,
} from "../persistence/store";
import {
  ensureQuestStates,
  acceptQuest,
  turnInQuest,
  abandonQuest,
  progressObjectives,
  sendQuestUpdate,
  sendGuidanceSync,
  resetDailyQuests,
  grantDailyLoginGift,
  sendBonusHuntSync,
  getExpMultiplierForMap,
  getDropMultiplierForMap,
} from "../questEngine";
import { grantExp } from "../applyExp";
import { getActiveEvents } from "../events";
import type { EventsSyncPayload } from "@maple/shared";
import { partyManager } from "../partyManager";
import { track } from "../analytics";
import { AnalyticsEventType } from "../analyticsEvents";
import { guildManager, GUILD_CREATE_COST } from "../guildManager";
import { handleGmCommand, isGmInvincible, isNoclipping } from "../gmCommands";
import { friendManager } from "../friendManager";
import {
  type PartyInvitePayload,
  type PartyAcceptPayload,
  type PartyLeavePayload,
  type PartyKickPayload,
  type PartyUpdatePayload,
  type PartyChatPayload,
  type PartyChatRelayPayload,
  type PartySetLootRulePayload,
  type LfgPostPayload,
  type LfgJoinPayload,
  type LfgListResultPayload,
  type GuildCreatePayload,
  type GuildInvitePayload,
  type GuildAcceptPayload,
  type GuildLeavePayload,
  type GuildKickPayload,
  type GuildRankPayload,
  type GuildChatPayload,
  type GuildInviteReceivedPayload,
  type GuildUpdatePayload,
  type GuildResultPayload,
  type GuildChatRelayPayload,
  type ChannelListPayload,
  type ChannelSwitchPayload,
  type ChannelSwitchResultPayload,
  type WhisperPayload,
  type WhisperRelayPayload,
  type WhisperFailedPayload,
  type FriendAddPayload,
  type FriendRemovePayload,
  type FriendListPayload,
  type FriendResultPayload,
  type FriendRemovedPayload,
  type OnlineStatusPayload,
  type FamiliarSyncPayload,
  type FamiliarSummonPayload,
  type FamiliarDismissPayload,
  type FamiliarCardDropPayload,
  type ExplorationStartPayload,
  type ExplorationClaimPayload,
  type ExplorationSyncPayload,
  type ExplorationStartResultPayload,
  type ExplorationClaimResultPayload,
  type EquipTitlePayload,
  type TitleSyncPayload,
} from "../types";
import {
  RateLimiter,
  sanitizeInputData,
  sanitizeString,
  sanitizeId,
  logAnomaly,
} from "../validate";
import {
  validateCharacterNameFormat,
  MAX_CHARACTERS_PER_ACCOUNT,
  NAME_TAKEN_CODE,
  NAME_TAKEN_MESSAGE,
} from "../characters";

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Pixels per fixed tick when walking. ~2.4 feels responsive at 60 fps. */
const PLAYER_SPEED = 2.4;
/** Per-tick horizontal acceleration (px/tick²). Snappy 2-tick ramp to full speed. */
const PLAYER_ACCEL = 1.2;
/** Per-tick horizontal deceleration when no key is held (px/tick²). ~5-tick skid-to-stop. */
const PLAYER_FRICTION = 0.5;
/** Reduced traction on icy/slippery footholds (harder to start, longer skid). */
const PLAYER_SLIPPERY_ACCEL = 0.4;
const PLAYER_SLIPPERY_FRICTION = 0.1;

/** Downward acceleration applied every tick while airborne (px/tick²). */
const GRAVITY = 0.45;
/** Initial upward impulse when jumping (negative = upward). */
const JUMP_VELOCITY = -8.5;
/** Terminal downward speed so the player doesn't teleport through platforms. */
const MAX_FALL_SPEED = 12;
/** Y-distance tolerance when snapping to a foothold surface (slopes + float jitter). */
const FOOTHOLD_SNAP_PX = 4;

const MOB_MOB_GRAVITY = 0.45;
const MOB_MAX_FALL = 12;

const ATTACK_COOLDOWN_MS = 450;
const ATTACK_DURATION_MS = 250;

/** Mob AI defaults for non-boss mobs. */
const MOB_AI_CHASE_SPEED_MULT = 1.6; // chase is faster than wander
const MOB_AI_VERT_TOLERANCE = 150; // px — max vertical gap for aggro/LoS
const MOB_AI_DEFAULT_ATTACK_DAMAGE = 5; // base damage for non-boss mobs
const MOB_AI_DEFAULT_ATTACK_COOLDOWN_MS = 1200; // ms between attacks
const PLAYER_RESPAWN_MS = 4000;

// ─── Projectile / behavior-specific constants ─────────────────────────────
const PROJECTILE_SPEED = 3; // px/tick
const PROJECTILE_LIFETIME_MS = 2000;
const PROJECTILE_HIT_RADIUS = 16; // px — collision sphere for projectile→player
const CASTER_AOE_RADIUS = 80; // px — AoE radius for caster mobs
const EXPLODER_AOE_RADIUS = 100; // px — AoE radius for exploder self-destruct
const EXPLODER_RUSH_SPEED_MULT = 2.2;

// ─── Action-combat tunables ──────────────────────────────────────────────
/** Per-tick multiplier applied to knockback velocity (decays toward 0). */
const KNOCKBACK_DECAY = 0.85;
/** Maximum knockback speed (px/tick) so targets don't fly off-screen. */
const KNOCKBACK_MAX = 12;
/** Minimum damage to trigger knockback (ignores tiny glancing blows). */
const KNOCKBACK_MIN_DMG = 5;
/** Duration (ms) of invulnerability frames after contact or boss damage. */
const IFRAME_MS = 600;
/** How long (ms) a combo stays alive between consecutive hits. */
const COMBO_WINDOW_MS = 1500;

const PICKUP_RANGE = 60;
const LOOT_DESPAWN_MS = 30_000;

/** How long (ms) a drop is exclusively reserved for the killer (and their party). */
const LOOT_OWNERSHIP_MS = 5_000;

/** Maximum simultaneous ground drops per map — prevents clutter and bandwidth blowup. */
const MAX_LOOT_PER_MAP = 200;

/**
 * Autosave cadence. Every live player's full state is flushed to SQLite on this
 * interval so an unexpected server kill loses at most this window of progress.
 * Overridable via MAPLE_AUTOSAVE_INTERVAL_MS (ops tuning + fast tests).
 */
const AUTOSAVE_INTERVAL_MS = (() => {
  const raw = Number(process.env.MAPLE_AUTOSAVE_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
})();

/**
 * Close code for kicking an older session on a duplicate login. We use Colyseus's
 * CONSENTED (4000) code on purpose: it routes the disconnect straight to `onLeave`
 * (immediate, full cleanup) instead of `onDrop` (which would open a reconnection
 * window and leave a ghost session registered). The client tells a kick apart from a
 * normal leave via the FORCE_LOGOUT message sent just before, not via the close code.
 */
const DUPLICATE_LOGIN_CLOSE_CODE = 4000;

/**
 * Grace window (seconds) we hold a dropped player's entity in room state so a flaky
 * connection can `reconnect()` and resume in place instead of re-joining cold. When the
 * window elapses without a reconnect, Colyseus falls through to `onLeave` for the full
 * cleanup + persistence path — so nothing is lost either way. Keep this in rough sync
 * with the client's reconnection retry budget in MapScene (`configureReconnection`).
 * Overridable via MAPLE_RECONNECT_GRACE_SECONDS (ops tuning + fast tests).
 */
const RECONNECT_GRACE_SECONDS = (() => {
  const raw = Number(process.env.MAPLE_RECONNECT_GRACE_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 20;
})();

/** Horizontal proximity (px) for a player to activate a portal. */
const PORTAL_RANGE_X = 40;
/** Vertical proximity (px) for a player to activate a portal. */
const PORTAL_RANGE_Y = 50;

const NPC_INTERACT_RANGE = 100; // px — max distance to initiate dialog

const CHAT_MAX_LEN = 120;
const CHAT_RATE_LIMIT_MS = 300;
/** Max recent chat lines to buffer per session for player report context. */
const CHAT_HISTORY_LEN = 20;

/** Cooldown (ms) between unstuck / return-to-town actions to prevent abuse. */
const UNSTUCK_COOLDOWN_MS = 60_000;

// ─── Trade constants ─────────────────────────────────────────────────────
/** Max horizontal distance (px) for a trade invite. */
const TRADE_RANGE_X = 150;
/** Max vertical distance (px) for a trade invite. */
const TRADE_RANGE_Y = 100;
/** Maximum unique item slots per player for trade capacity check. */
const TRADE_MAX_INVENTORY_SLOTS = 48;

/** Trade session state machine. */
type TradePhase = "negotiating" | "locked" | "confirmed";

interface TradeSession {
  id: string;
  a: {
    sessionId: string;
    charId: string;
    player: Player;
    offerItems: string[];
    offerMesos: number;
    locked: boolean;
    confirmed: boolean;
  };
  b: {
    sessionId: string;
    charId: string;
    player: Player;
    offerItems: string[];
    offerMesos: number;
    locked: boolean;
    confirmed: boolean;
  };
  phase: TradePhase;
  /** Snapshot of inventory + mesos at lock time (re-validated at confirm). */
  lockSnapshot?: {
    a: { itemUids: string[]; mesos: number };
    b: { itemUids: string[]; mesos: number };
  };
}

/** Snapshot of a player's inventory at lock time for re-validation. */
function snapshotPlayer(p: Player): { itemUids: string[]; mesos: number } {
  const uids: string[] = [];
  p.inventory.forEach((_, uid) => uids.push(uid));
  return { itemUids: uids, mesos: p.mesos };
}

/** How long (ms) the player ignores a foothold after pressing Down+Jump to drop through it. */
const DROP_THROUGH_MS = 250;

/** Pixels per tick when climbing a ladder/rope. */
const CLIMB_SPEED = 2.2;
/** Horizontal tolerance (px) when snapping onto a ladder. */
const LADDER_GRAB_TOLERANCE = 28;

// ─── Swimming physics (underwater maps) ─────────────────────────────────────
/** Reduced gravity when swimming — slower descent feels like buoyancy. */
const SWIM_GRAVITY = 0.12;
/** Upward impulse when swimming (negative = upward). */
const SWIM_VELOCITY = -3.5;
/** Terminal downward speed in water. */
const SWIM_MAX_FALL = 5;
/** Vertical speed per tick when swimming freely (no ladder needed). */
const SWIM_VERTICAL_SPEED = 2.0;

// ─── HP / MP regeneration ─────────────────────────────────────────────────
/** Ms after the last hit before passive regen begins (out-of-combat delay). */
const REGEN_COMBAT_DELAY_MS = 5_000;
/** Ms the player must be completely still before the faster rest regen kicks in. */
const REGEN_STANDING_DELAY_MS = 3_000;
/** Passive HP regen rate (% of maxHp per second) while walking/idle out of combat. */
const REGEN_HP_PASSIVE_RATE = 0.002;
/** Passive MP regen rate (% of maxMp per second) while walking/idle out of combat. */
const REGEN_MP_PASSIVE_RATE = 0.0015;
/** Resting HP regen rate (% of maxHp per second) when standing still out of combat. */
const REGEN_HP_REST_RATE = 0.01;
/** Resting MP regen rate (% of maxMp per second) when standing still out of combat. */
const REGEN_MP_REST_RATE = 0.008;
/** Mages regen MP at this multiplier (they burn MP on every skill). */
const REGEN_MAGE_MP_MULTIPLIER = 2.0;

interface PendingMint {
  session: string;
  itemUid: string;
  defId: string;
  tier: string;
}

/** Merge two Partial<SecondaryStats> deltas by summing shared keys. */
function mergeBonus(
  a: Partial<import("@maple/shared").SecondaryStats>,
  b: Partial<import("@maple/shared").SecondaryStats>,
): Partial<import("@maple/shared").SecondaryStats> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === "number") out[k] = (out[k] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === "number") out[k] = (out[k] ?? 0) + v;
  }
  return out as Partial<import("@maple/shared").SecondaryStats>;
}

export class MapRoom extends AuthedRoom<TownState> {
  state = new TownState();
  fixedTimeStep = 1000 / 60;
  maxClients = 50;

  /** The map geometry loaded in onCreate. */
  private map!: GameMap;

  /** Channel index for this room (from options). */
  private channel = 0;

  /** Monotonic id source for mobs / loot / items in this room. */
  private idCounter = 0;

  /** Zone-aware mob respawn controller. */
  private spawnManager!: SpawnManager;

  /** Boss encounter controller — timed spawns, multi-phase attacks, loot ownership. */
  private bossManager!: BossManager;

  /** Rune spawn/activation controller (combat maps only). */
  private runeManager?: RuneManager;

  /** Treasure box spawn/destruction controller (combat maps only). */
  private treasureBoxManager?: TreasureBoxManager;

  // ─── Scheduled transport system ───────────────────────────────────────────
  /** Epoch (ms) for all scheduled-transport phase calculations. */
  private transportEpoch = Date.now();
  /** Portal id → session ids of players who have boarded and are awaiting departure. */
  private boardingByPortal = new Map<string, string[]>();
  /** Previous phase per scheduled portal for departure-boundary detection. */
  private prevPhase = new Map<string, number>();
  /** Tick counter for the departure-check loop (fires every ~1 s). */
  private departureTick = 0;

  /**
   * Legendary pickups queued for on-chain minting (Phase 2). The authoritative server is the only
   * thing that can append here — proof that the client never mints gear. No chain call yet.
   */
  private pendingMints: PendingMint[] = [];

  /** Last chat timestamp per session (for rate-limiting). */
  private lastChatAt = new Map<string, number>();
  /** Throttle map for loot-all requests: sessionId → timestamp. */
  private lastLootAllAt = new Map<string, number>();
  /** Throttle map for unstuck / return-to-town: sessionId → timestamp. */
  private lastUnstuckAt = new Map<string, number>();

  // ─── Rate limiters (per-client, token-bucket) ──────────────────────────────
  /** High-frequency game input: 120/sec (matches 60fps with headroom). */
  private inputLimiter = new RateLimiter(120, 0.12);
  /** Skill / consumable casts: 10/sec. */
  private skillCastLimiter = new RateLimiter(10, 0.01);
  /** Loot pickup: 20/sec. */
  private pickupLimiter = new RateLimiter(20, 0.02);
  /** Macro casts: 5/sec. */
  private macroCastLimiter = new RateLimiter(5, 0.005);
  /** NPC interactions: 5/sec (quest chains can cascade quickly). */
  private talkNpcLimiter = new RateLimiter(5, 0.005);

  /** sessionId → persistent accountId (set in onJoin, used by create/delete handlers). */
  private sessionAccount = new Map<string, string>();

  /** Expose the session→account mapping to the base room for error/lifecycle log context. */
  protected override accountIdForSession(sessionId: string): string | undefined {
    return this.sessionAccount.get(sessionId);
  }

  /** sessionId → timestamp (ms) when the player joined (for session duration). */
  private sessionStartMs = new Map<string, number>();

  /** sessionId → recent chat lines ring buffer (for player report context). */
  private chatHistory = new Map<string, string[]>();

  /** Track first market list per account for analytics. */
  private marketListedAccounts = new Set<string>();

  /** Party manager — global singleton, cross-map support. */

  /** sessionId → active TradeSession (at most one per player). */
  private activeTrades = new Map<string, TradeSession>();

  /** sessionId → familiar collection (registered + summoned). */
  private familiarCollections = new Map<string, FamiliarCollection>();

  /** Remaining stock per shop slot: `"shopId:itemId"` → remaining count. Lazily populated on first buy. */
  private shopStock = new Map<string, number>();
  /** Monotonic trade id source. */
  private tradeSeq = 0;

  messages = {
    [MessageType.INPUT]: (client: Client, input: InputData) => {
      if (!this.inputLimiter.consume(client.sessionId)) {
        logAnomaly(client.sessionId, "rate_limit", "input");
        return;
      }
      const clean = sanitizeInputData(input);
      if (!clean) {
        logAnomaly(client.sessionId, "malformed", "input");
        return;
      }
      const player = this.state.players.get(client.sessionId);
      if (player) player.inputQueue.push(clean);
    },

    [MessageType.USE_PORTAL]: (client: Client) => {
      this.handlePortalUse(client);
    },

    [MessageType.PICKUP]: (client: Client, msg: { uid: string }) => {
      if (!this.pickupLimiter.consume(client.sessionId)) {
        logAnomaly(client.sessionId, "rate_limit", "pickup");
        return;
      }
      const uid = sanitizeId(msg?.uid, 64);
      if (!uid) {
        logAnomaly(client.sessionId, "malformed", "pickup_uid");
        return;
      }
      this.handlePickup(client, { uid });
    },

    [MessageType.CHAT]: (client: Client, msg: ChatPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !msg?.text) return;

      // Mute check: muted players cannot send chat.
      const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
      if (accountStore.isMuted(accountId)) {
        client.send(MessageType.CHAT, {
          sessionId: "",
          name: "System",
          text: "You are currently muted.",
        });
        return;
      }

      // Rate-limit: ignore if sent too fast.
      const now = Date.now();
      const last = this.lastChatAt.get(client.sessionId) ?? 0;
      if (now - last < CHAT_RATE_LIMIT_MS) return;
      this.lastChatAt.set(client.sessionId, now);

      // Validate + strip null bytes + trim + profanity filter.
      let text = sanitizeString(msg.text, CHAT_MAX_LEN);
      text = filterProfanity(text);
      if (text.length === 0) return;

      // ── Chat command interception (/town, /stuck) ──────────────────────
      const lowerText = text.toLowerCase();
      if (lowerText === "/town" || lowerText === "/stuck") {
        this.handleUnstuckAction(client);
        return;
      }

      // Record in chat history ring buffer for player reports.
      const hist = this.chatHistory.get(client.sessionId);
      if (hist) {
        hist.push(`${player.name}: ${text}`);
        if (hist.length > CHAT_HISTORY_LEN) hist.shift();
      }

      this.broadcast(MessageType.CHAT, {
        sessionId: client.sessionId,
        name: player.name,
        text,
      });
    },

    [MessageType.CREATE_CHARACTER]: (client: Client, msg: CreateCharacterPayload) => {
      this.handleCreateCharacter(client, msg);
    },

    [MessageType.DELETE_CHARACTER]: (client: Client, msg: DeleteCharacterPayload) => {
      this.handleDeleteCharacter(client, msg);
    },

    [MessageType.TALK_NPC]: (client: Client, msg: TalkNpcPayload) => {
      if (!this.talkNpcLimiter.consume(client.sessionId)) {
        logAnomaly(client.sessionId, "rate_limit", "talk_npc");
        client.send("npc_error", { reason: "Rate limit exceeded" });
        return;
      }
      this.handleTalkNpc(client, msg);
    },

    [MessageType.DIALOG_CHOICE]: (client: Client, msg: DialogChoicePayload) => {
      this.handleDialogChoice(client, msg);
    },

    [MessageType.BUY_CASH_ITEM]: (client: Client, msg: BuyCashItemPayload) => {
      this.handleBuyCashItem(client, msg);
    },

    [MessageType.EQUIP_CASH_ITEM]: (client: Client, msg: EquipCashItemPayload) => {
      this.handleEquipCashItem(client, msg);
    },

    [MessageType.CASH_INFO]: (client: Client, _msg: CashInfoRequestPayload) => {
      this.handleCashInfo(client);
    },

    [MessageType.EQUIP_ITEM]: (client: Client, msg: EquipItemPayload) => {
      this.handleEquip(client, msg);
    },

    [MessageType.UNEQUIP_ITEM]: (client: Client, msg: UnequipItemPayload) => {
      this.handleUnequip(client, msg);
    },

    [MessageType.BUY_FROM_SHOP]: (client: Client, msg: BuyFromShopPayload) => {
      this.handleBuyFromShop(client, msg);
    },

    [MessageType.SELL_TO_SHOP]: (client: Client, msg: SellToShopPayload) => {
      this.handleSellToShop(client, msg);
    },

    [MessageType.SPEND_AP]: (client: Client, msg: SpendApPayload) => {
      this.handleSpendAp(client, msg);
    },

    [MessageType.LEARN_SKILL]: (client: Client, msg: LearnSkillPayload) => {
      this.handleLearnSkill(client, msg);
    },

    [MessageType.SKILL_BOOK]: (client: Client, _msg: SkillBookRequestPayload) => {
      this.handleSkillBook(client);
    },

    [MessageType.TRADE_INVITE]: (client: Client, msg: TradeInvitePayload) => {
      this.handleTradeInvite(client, msg);
    },
    [MessageType.TRADE_ACCEPT]: (client: Client, msg: TradeAcceptPayload) => {
      this.handleTradeAccept(client, msg);
    },
    [MessageType.TRADE_REJECT]: (client: Client, msg: TradeRejectPayload) => {
      this.handleTradeReject(client, msg);
    },
    [MessageType.TRADE_CANCEL]: (client: Client, _msg: TradeCancelPayload) => {
      this.handleTradeCancel(client);
    },
    [MessageType.TRADE_OFFER]: (client: Client, msg: TradeOfferPayload) => {
      this.handleTradeOffer(client, msg);
    },
    [MessageType.TRADE_LOCK]: (client: Client, _msg: TradeLockPayload) => {
      this.handleTradeLock(client);
    },
    [MessageType.TRADE_CONFIRM]: (client: Client, _msg: TradeConfirmPayload) => {
      this.handleTradeConfirm(client);
    },

    // ─── Shared Account Storage ──────────────────────────────────────────────
    [MessageType.STORAGE_DEPOSIT]: (client: Client, msg: StorageDepositPayload) => {
      this.handleStorageDeposit(client, msg);
    },
    [MessageType.STORAGE_WITHDRAW]: (client: Client, msg: StorageWithdrawPayload) => {
      this.handleStorageWithdraw(client, msg);
    },

    // ─── Equipment Repair (mesos sink) ───────────────────────────────────────
    [MessageType.REPAIR_EQUIPMENT]: (client: Client, msg: RepairEquipmentPayload) => {
      this.handleRepairEquipment(client, msg);
    },

    // ─── Cube (potential reroll — the signature gacha loop) ──────────────────
    [MessageType.CUBE_REROLL]: (client: Client, msg: CubeRerollPayload) => {
      this.handleCubeReroll(client, msg);
    },

    // ─── Flame (bonus stat reroll) ─────────────────────────────────────────
    [MessageType.FLAME_REROLL]: (client: Client, msg: FlameRerollPayload) => {
      this.handleFlameReroll(client, msg);
    },

    // ─── Base-rank upgrade (NORMAL→ENHANCED→STARFORGED→MYTHIC) ──────────────
    [MessageType.UPGRADE_ITEM]: (client: Client, msg: UpgradeItemPayload) => {
      this.handleUpgradeItem(client, msg);
    },

    // ─── Star Force (per-star enhancement) ──────────────────────────────────────
    [MessageType.STAR_FORCE]: (client: Client, msg: StarForcePayload) => {
      this.handleStarForce(client, msg);
    },

    // ─── 2nd-job branch advancement ──────────────────────────────────────────
    [MessageType.BRANCH_CHOICE]: (client: Client, msg: BranchChoicePayload) => {
      this.handleBranchChoice(client, msg);
    },

    // ─── Quickslot hotbar ──────────────────────────────────────────────────
    [MessageType.SKILL_CAST]: (client: Client, msg: SkillCastPayload) => {
      if (!this.skillCastLimiter.consume(client.sessionId)) {
        logAnomaly(client.sessionId, "rate_limit", "skill_cast");
        return;
      }
      const skillId = sanitizeId(msg?.skillId, 64);
      if (!skillId) {
        logAnomaly(client.sessionId, "malformed", "skill_cast_id");
        return;
      }
      this.handleSkillCast(client, { skillId });
    },
    [MessageType.USE_CONSUMABLE]: (client: Client, msg: UseConsumablePayload) => {
      if (!this.skillCastLimiter.consume(client.sessionId)) {
        logAnomaly(client.sessionId, "rate_limit", "use_consumable");
        return;
      }
      const defId = sanitizeId(msg?.defId, 64);
      if (!defId) {
        logAnomaly(client.sessionId, "malformed", "consumable_id");
        return;
      }
      this.handleUseConsumable(client, { defId });
    },
    [MessageType.INVENTORY_SORT]: (client: Client, msg: InventorySortPayload) => {
      this.handleInventorySort(client, msg);
    },
    [MessageType.QUICKSLOT_LAYOUT]: (client: Client, msg: QuickSlotLayoutPayload) => {
      this.handleQuickslotLayout(client, msg);
    },
    [MessageType.SETTINGS_SYNC]: (client: Client, msg: SettingsPayload) => {
      this.handleSettingsSync(client, msg);
    },

    // ─── Combat QoL ─────────────────────────────────────────────────────
    [MessageType.PICKUP_ALL]: (client: Client) => {
      this.handlePickupAll(client);
    },
    [MessageType.MACRO_CAST]: (client: Client, msg: MacroCastPayload) => {
      if (!this.macroCastLimiter.consume(client.sessionId)) {
        logAnomaly(client.sessionId, "rate_limit", "macro_cast");
        return;
      }
      const macroId = sanitizeId(msg?.macroId, 64);
      if (!macroId) {
        logAnomaly(client.sessionId, "malformed", "macro_id");
        return;
      }
      this.handleMacroCast(client, { macroId });
    },
    [MessageType.MACRO_LAYOUT]: (client: Client, msg: MacroLayoutPayload) => {
      this.handleMacroLayout(client, msg);
    },
    [MessageType.AUTO_POT_SYNC]: (client: Client, msg: AutoPotSyncPayload) => {
      this.handleAutoPotSync(client, msg);
    },

    // ─── Party (group play, session-scoped) ────────────────────────────────
    [MessageType.PARTY_INVITE]: (client: Client, msg: PartyInvitePayload) => {
      this.handlePartyInvite(client, msg);
    },
    [MessageType.PARTY_ACCEPT]: (client: Client, msg: PartyAcceptPayload) => {
      this.handlePartyAccept(client, msg);
    },
    [MessageType.PARTY_LEAVE]: (client: Client, _msg: PartyLeavePayload) => {
      this.handlePartyLeave(client);
    },
    [MessageType.PARTY_KICK]: (client: Client, msg: PartyKickPayload) => {
      this.handlePartyKick(client, msg);
    },

    // ─── Guild (persistent cross-map social) ────────────────────────────
    [MessageType.GUILD_CREATE]: (client: Client, msg: GuildCreatePayload) => {
      this.handleGuildCreate(client, msg);
    },
    [MessageType.GUILD_INVITE]: (client: Client, msg: GuildInvitePayload) => {
      this.handleGuildInvite(client, msg);
    },
    [MessageType.GUILD_ACCEPT]: (client: Client, msg: GuildAcceptPayload) => {
      this.handleGuildAccept(client, msg);
    },
    [MessageType.GUILD_LEAVE]: (client: Client, _msg: GuildLeavePayload) => {
      this.handleGuildLeave(client);
    },
    [MessageType.GUILD_KICK]: (client: Client, msg: GuildKickPayload) => {
      this.handleGuildKick(client, msg);
    },
    [MessageType.GUILD_RANK]: (client: Client, msg: GuildRankPayload) => {
      this.handleGuildRank(client, msg);
    },
    [MessageType.GUILD_CHAT]: (client: Client, msg: GuildChatPayload) => {
      this.handleGuildChat(client, msg);
    },
    [MessageType.PARTY_CHAT]: (client: Client, msg: PartyChatPayload) => {
      this.handlePartyChat(client, msg);
    },
    [MessageType.PARTY_SET_LOOT_RULE]: (client: Client, msg: PartySetLootRulePayload) => {
      this.handlePartySetLootRule(client, msg);
    },

    // ─── LFG / Party Finder ────────────────────────────────────────────────
    [MessageType.LFG_POST]: (client: Client, msg: LfgPostPayload) => {
      this.handleLfgPost(client, msg);
    },
    [MessageType.LFG_LIST]: (client: Client) => {
      this.handleLfgList(client);
    },
    [MessageType.LFG_JOIN]: (client: Client, msg: LfgJoinPayload) => {
      this.handleLfgJoin(client, msg);
    },
    [MessageType.LFG_REMOVE]: (client: Client) => {
      this.handleLfgRemove(client);
    },

    // ─── Channel system ────────────────────────────────────────────────────
    [MessageType.CHANNEL_SWITCH]: (client: Client, msg: ChannelSwitchPayload) => {
      this.handleChannelSwitch(client, msg);
    },
    [MessageType.WHISPER]: (client: Client, msg: WhisperPayload) => {
      this.handleWhisper(client, msg);
    },

    // ─── Quest offer / turn-in accept/decline ──────────────────────────
    [MessageType.QUEST_ACCEPT]: (client: Client, msg: QuestAcceptPayload) => {
      this.handleQuestAccept(client, msg);
    },
    [MessageType.QUEST_DECLINE]: (client: Client, msg: QuestDeclinePayload) => {
      this.handleQuestDecline(client, msg);
    },
    [MessageType.QUEST_TURNIN_ACCEPT]: (client: Client, msg: QuestTurninAcceptPayload) => {
      this.handleQuestTurninAccept(client, msg);
    },
    [MessageType.QUEST_TURNIN_DECLINE]: (client: Client, msg: QuestTurninDeclinePayload) => {
      this.handleQuestTurninDecline(client, msg);
    },
    [MessageType.QUEST_ABANDON]: (client: Client, msg: QuestAbandonPayload) => {
      this.handleQuestAbandon(client, msg);
    },

    // ─── Runes (map buff spawns) ──────────────────────────────────────────────
    [MessageType.RUNE_ACTIVATE]: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !this.runeManager) return;
      this.runeManager.activate(client.sessionId, player);
    },

    // ─── Boss summon items ───────────────────────────────────────────────
    use_summon_item: (client: Client, msg: { itemId: string }) => {
      this.handleUseSummonItem(client, msg);
    },

    [MessageType.GIVE_FAME]: (client: Client, msg: GiveFamePayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Find the target player in this room.
      let targetPlayer: Player | undefined;
      let targetSessionId = "";
      for (const [sid, p] of this.state.players.entries()) {
        if (p.charId === msg.targetCharId) {
          targetPlayer = p;
          targetSessionId = sid;
          break;
        }
      }
      if (!targetPlayer) {
        client.send(MessageType.FAME_RESULT, {
          success: false,
          targetFame: 0,
          message: "Target player not found in this map.",
        } satisfies FameResultPayload);
        return;
      }

      // Proximity check — fame requires both players to be nearby.
      const fameDx = Math.abs(player.x - targetPlayer.x);
      const fameDy = Math.abs(player.y - targetPlayer.y);
      if (fameDx > TRADE_RANGE_X || fameDy > TRADE_RANGE_Y) {
        client.send(MessageType.FAME_RESULT, {
          success: false,
          targetFame: targetPlayer.fame.fame,
          message: "Too far away to give fame.",
        } satisfies FameResultPayload);
        return;
      }

      const result = giveFame(targetPlayer.fame, player.charId, msg.amount, Date.now());
      if (result.success) {
        targetPlayer.displayFame = targetPlayer.fame.fame;
        accountStore.setFame(
          targetPlayer.charId,
          targetPlayer.fame.fame,
          targetPlayer.fame.fameHistory,
        );
      }

      client.send(MessageType.FAME_RESULT, {
        success: result.success,
        targetFame: targetPlayer.fame.fame,
        message: result.message,
      } satisfies FameResultPayload);

      // Notify the target player too.
      const targetClient = this.clients.find((c) => c.sessionId === targetSessionId);
      if (targetClient) {
        targetClient.send(MessageType.FAME_RESULT, {
          success: result.success,
          targetFame: targetPlayer.fame.fame,
          myFame: targetPlayer.fame.fame,
          message: result.success
            ? `${player.name} ${msg.amount > 0 ? "gave you" : "took"} fame.`
            : result.message,
        } satisfies FameResultPayload);
      }
    },

    [MessageType.VIEW_CODEX]: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const result = evaluateCodexMilestones(player.codex);
      client.send(MessageType.CODEX_SYNC, {
        codex: player.codex,
        statBonus: {
          STR: result.totalStatBonus.STR ?? 0,
          DEX: result.totalStatBonus.DEX ?? 0,
          INT: result.totalStatBonus.INT ?? 0,
          LUK: result.totalStatBonus.LUK ?? 0,
          HP: result.totalStatBonus.HP ?? 0,
          MP: result.totalStatBonus.MP ?? 0,
        },
        expBonus: result.totalExpBonus,
      } satisfies CodexSyncPayload);
      // Also send exploration state so the UI populates both tabs.
      this.sendExplorationSync(client, player);
    },

    [MessageType.EXPLORATION_START]: (client: Client, msg: ExplorationStartPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const mobId = sanitizeId(msg?.mobId, 64);
      if (!mobId) {
        logAnomaly(client.sessionId, "malformed", "exploration_mob_id");
        return;
      }
      const duration = msg?.duration;
      if (duration !== "short" && duration !== "medium" && duration !== "long") {
        client.send(MessageType.EXPLORATION_START, {
          success: false,
          message: "Invalid duration. Must be short, medium, or long.",
        } satisfies ExplorationStartResultPayload);
        return;
      }
      const result = startExploration(
        player.exploration,
        player.codex,
        mobId,
        duration,
        Date.now(),
      );
      if (result.ok) {
        player.exploration = result.state;
        accountStore.setExploration(player.charId, player.exploration);
      }
      client.send(MessageType.EXPLORATION_START, {
        success: result.ok,
        message: result.message,
      } satisfies ExplorationStartResultPayload);
      this.sendExplorationSync(client, player);
    },

    [MessageType.EXPLORATION_CLAIM]: (client: Client, _msg: ExplorationClaimPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const mobLevels: Record<string, number> = {};
      const dropTables: Record<string, readonly { itemId: string; chance: number }[]> = {};
      for (const [id, def] of Object.entries(MOB_DEFS)) {
        mobLevels[id] = def.level;
        dropTables[id] = def.dropTable;
      }
      const result = claimExplorations(player.exploration, mobLevels, dropTables, Date.now());
      if (result.claims.length > 0) {
        player.exploration = result.state;
        player.mesos += result.totalMesos;
        accountStore.setMesos(player.charId, player.mesos);
        accountStore.setExploration(player.charId, player.exploration);
        // Grant exploration item drops to inventory.
        for (const itemId of result.totalItems) {
          const invItem = new InventoryItem();
          invItem.uid = `item_${++this.idCounter}`;
          invItem.defId = itemId;
          invItem.potentialTier = "NONE";
          invItem.lines = 0;
          invItem.baseRank = "NORMAL";
          invItem.potentialLines = "[]";
          player.inventory.set(invItem.uid, invItem);
          accountStore.addItem(player.charId, {
            uid: invItem.uid,
            defId: invItem.defId,
            baseRank: invItem.baseRank,
            potentialTier: invItem.potentialTier,
            lines: invItem.lines,
            minted: false,
            potentialLines: [],
          });
        }
        client.send(MessageType.EXPLORATION_CLAIM, {
          success: true,
          claims: result.claims,
          totalMesos: result.totalMesos,
          totalItems: result.totalItems,
          message: `Collected ${result.totalMesos} mesos from ${result.claims.length} exploration(s)!`,
        } satisfies ExplorationClaimResultPayload);
      } else {
        client.send(MessageType.EXPLORATION_CLAIM, {
          success: false,
          claims: [],
          totalMesos: 0,
          totalItems: [],
          message: "No completed explorations to claim.",
        } satisfies ExplorationClaimResultPayload);
      }
      this.sendExplorationSync(client, player);
    },

    [MessageType.VIEW_ACHIEVEMENTS]: (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const snaps = getAllAchievementSnapshots(player.achievements).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        completed: s.completed,
        progress: s.progress,
        rewards: s.rewards,
      }));
      client.send(MessageType.ACHIEVEMENT_SYNC, {
        achievements: snaps,
      } satisfies AchievementSyncPayload);
    },

    [MessageType.TITLE_EQUIP]: (client: Client, msg: EquipTitlePayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const raw = typeof msg?.title === "string" ? msg.title : "";
      const title = raw.length === 0 ? "" : (sanitizeId(raw, 64) ?? "");
      // Empty string = unequip; otherwise must be in owned list.
      if (title !== "" && !player.ownedTitles.includes(title)) {
        client.send(MessageType.TITLE_SYNC, {
          ownedTitles: player.ownedTitles,
          equippedTitle: player.equippedTitle,
        } satisfies TitleSyncPayload);
        return;
      }
      // ── Fame gate enforcement (titles require fame ≥ 50) ──
      if (title !== "") {
        const fameCheck = meetsFameGate(player.fame.fame, "title");
        if (!fameCheck.meets) {
          client.send(MessageType.TITLE_SYNC, {
            ownedTitles: player.ownedTitles,
            equippedTitle: player.equippedTitle,
          } satisfies TitleSyncPayload);
          client.send("title_fame_blocked", {
            message: `Requires ${fameCheck.required} Fame to equip a title, have ${player.fame.fame}.`,
          });
          return;
        }
      }
      player.equippedTitle = title;
      accountStore.updateCharacter(player.charId, { equippedTitle: title });
      client.send(MessageType.TITLE_SYNC, {
        ownedTitles: player.ownedTitles,
        equippedTitle: player.equippedTitle,
      } satisfies TitleSyncPayload);
    },

    // ─── Bug report / Feedback ────────────────────────────────────────────
    [MessageType.FEEDBACK_SUBMIT]: (client: Client, msg: FeedbackSubmitPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        client.send(MessageType.FEEDBACK_SUBMIT, {
          success: false,
          message: "Player not found.",
        } satisfies FeedbackResultPayload);
        return;
      }

      const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
      const result = feedbackStore.submit(
        accountId,
        player.charId,
        player.name,
        msg.category,
        msg.message,
        {
          ...msg.context,
          serverVersion: msg.context.serverVersion || "dev",
        },
      );

      client.send(MessageType.FEEDBACK_SUBMIT, {
        success: result.ok,
        message: result.ok
          ? "Thank you for your feedback!"
          : (result.reason ?? "Submission failed."),
      } satisfies FeedbackResultPayload);
    },

    // ─── Moderation: player report ─────────────────────────────────────────
    [MessageType.PLAYER_REPORT]: (client: Client, msg: PlayerReportPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
      const mapId = this.state.mapId || "meadowfield";
      const result = moderationStore.submitReport(
        accountId,
        player.name,
        msg.targetName,
        msg.reason,
        msg.chatContext,
        mapId,
      );
      client.send(MessageType.PLAYER_REPORT_RESULT, {
        success: result.ok,
        message: result.ok ? "Report submitted. Thank you!" : (result.reason ?? "Report failed."),
      } satisfies PlayerReportResultPayload);
    },

    // ─── Moderation: block / unblock ───────────────────────────────────────
    [MessageType.BLOCK_PLAYER]: (client: Client, msg: BlockPlayerPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !msg?.targetName) return;
      // Can't block yourself.
      if (msg.targetName.toLowerCase() === player.name.toLowerCase()) {
        client.send(MessageType.MOD_ACTION_RESULT, {
          success: false,
          message: "You cannot block yourself.",
        } satisfies ModActionResultPayload);
        return;
      }
      const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
      const added = accountStore.blockPlayer(accountId, msg.targetName);
      client.send(MessageType.MOD_ACTION_RESULT, {
        success: added,
        message: added ? `Blocked ${msg.targetName}.` : `${msg.targetName} is already blocked.`,
      } satisfies ModActionResultPayload);
      // Sync updated list.
      const acc = accountStore.getAccount(accountId);
      client.send(MessageType.BLOCKED_LIST_RESULT, {
        blockedNames: acc?.blockedPlayers ?? [],
      } satisfies BlockedListResultPayload);
    },
    [MessageType.UNBLOCK_PLAYER]: (client: Client, msg: UnblockPlayerPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !msg?.targetName) return;
      const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
      const removed = accountStore.unblockPlayer(accountId, msg.targetName);
      client.send(MessageType.MOD_ACTION_RESULT, {
        success: removed,
        message: removed ? `Unblocked ${msg.targetName}.` : `${msg.targetName} was not blocked.`,
      } satisfies ModActionResultPayload);
      const acc = accountStore.getAccount(accountId);
      client.send(MessageType.BLOCKED_LIST_RESULT, {
        blockedNames: acc?.blockedPlayers ?? [],
      } satisfies BlockedListResultPayload);
    },

    // ─── Friends / Buddy list ────────────────────────────────────────────────
    [MessageType.FRIEND_ADD]: (client: Client, msg: FriendAddPayload) => {
      this.handleFriendAdd(client, msg);
    },
    [MessageType.FRIEND_REMOVE]: (client: Client, msg: FriendRemovePayload) => {
      this.handleFriendRemove(client, msg);
    },

    // ─── Guided progression (Maple Guide) ──────────────────────────────────
    [MessageType.GUIDE_TRAVEL]: (client: Client, msg: GuideTravelPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const targetMapId = msg.targetMapId;
      if (!targetMapId || !getMap(targetMapId)) {
        client.send(MessageType.USE_PORTAL, {
          message: "That destination is not available.",
        } satisfies FerryBlockedPayload);
        return;
      }

      const fromMapId = this.state.mapId;
      const fee = travelFee(fromMapId, targetMapId);
      if (fee > 0 && player.mesos < fee) {
        client.send(MessageType.USE_PORTAL, {
          message: `You need ${fee} mesos for this trip. You have ${player.mesos}.`,
        } satisfies FerryBlockedPayload);
        return;
      }

      if (fee > 0) {
        player.mesos -= fee;
        accountStore.setMesos(player.charId, player.mesos);
      }

      this.persistPlayer(player);
      client.send(MessageType.TRAVEL, {
        mapId: targetMapId,
        spawnId: "playerSpawn",
      } satisfies TravelPayload);
    },

    // ─── World map quick-travel (click a node on the world map) ──────────────
    [MessageType.MAP_TRAVEL]: (client: Client, msg: MapTravelPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (player.dead) {
        client.send(MessageType.USE_PORTAL, {
          message: "You are dead.",
        } satisfies FerryBlockedPayload);
        return;
      }

      // Rate-limit rapid world-map travel (1.5 s cooldown).
      const now = Date.now();
      if (now - player.lastMapTravelAt < 1_500) {
        client.send(MessageType.USE_PORTAL, {
          message: "Traveling too fast, please wait.",
        } satisfies FerryBlockedPayload);
        return;
      }

      const targetMapId = msg?.targetMapId;
      if (!targetMapId || !getMap(targetMapId)) {
        client.send(MessageType.USE_PORTAL, {
          message: "That destination does not exist.",
        } satisfies FerryBlockedPayload);
        return;
      }

      const fromMapId = this.state.mapId;

      // Must be a different map.
      if (targetMapId === fromMapId) {
        client.send(MessageType.USE_PORTAL, {
          message: "You are already in that map.",
        } satisfies FerryBlockedPayload);
        return;
      }

      // Find the portal connecting current map → target map.
      const portal = this.map.portals.find((p) => p.toMapId === targetMapId);
      if (!portal) {
        client.send(MessageType.USE_PORTAL, {
          message: "There is no route to that map from here.",
        } satisfies FerryBlockedPayload);
        return;
      }

      // Coming-soon gate (mirrors checkPortalProximity).
      if (portal.comingSoon) {
        client.send(MessageType.USE_PORTAL, {
          message: `🚧 ${getMap(targetMapId)?.name ?? targetMapId} — Coming Soon! This zone is not yet available in the alpha.`,
        } satisfies FerryBlockedPayload);
        return;
      }

      // Level gate (mirrors checkPortalProximity).
      if (portal.requiresLevel && player.level < portal.requiresLevel) {
        client.send(MessageType.USE_PORTAL, {
          message: `You need to be at least level ${portal.requiresLevel} to travel there.`,
        } satisfies FerryBlockedPayload);
        return;
      }

      // Scheduled transport gate (mirrors checkPortalProximity).
      if (portal.schedule) {
        const phase = (Date.now() - this.transportEpoch) % portal.schedule.intervalMs;
        const inBoardingWindow = phase < portal.schedule.windowMs;
        if (!inBoardingWindow) {
          const nextMs = portal.schedule.intervalMs - phase;
          const nextSec = Math.ceil(nextMs / 1000);
          client.send(MessageType.USE_PORTAL, {
            message: `${portal.label} is not currently boarding. The next departure is in ${nextSec} seconds.`,
          } satisfies FerryBlockedPayload);
          return;
        }
      }

      // Travel fee.
      const fee = travelFee(fromMapId, targetMapId);
      if (fee > 0 && player.mesos < fee) {
        client.send(MessageType.USE_PORTAL, {
          message: `You need ${fee} mesos for this trip. You have ${player.mesos}.`,
        } satisfies FerryBlockedPayload);
        return;
      }

      if (fee > 0) {
        player.mesos -= fee;
        accountStore.setMesos(player.charId, player.mesos);
      }

      player.lastMapTravelAt = Date.now();
      this.persistPlayer(player);
      client.send(MessageType.TRAVEL, {
        mapId: targetMapId,
        spawnId: portal.toSpawnId ?? "playerSpawn",
      } satisfies TravelPayload);
    },

    // ─── Familiar system ────────────────────────────────────────────────
    [MessageType.FAMILIAR_SUMMON]: (client: Client, msg: FamiliarSummonPayload) => {
      if (!FAMILIAR_ENABLED) return;
      this.handleFamiliarSummon(client, msg);
    },
    [MessageType.FAMILIAR_DISMISS]: (client: Client, msg: FamiliarDismissPayload) => {
      if (!FAMILIAR_ENABLED) return;
      this.handleFamiliarDismiss(client, msg);
    },

    // ─── GM / Admin commands (server-validated, admin-only) ──────────────
    [MessageType.GM_COMMAND]: (client: Client, msg: { command?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const command = msg?.command;
      if (!command || typeof command !== "string") return;

      // Server-authoritative role check: always read from the DB, never trust the client.
      const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
      const acc = accountStore.getAccount(accountId);
      if (!acc || (acc.role !== "admin" && acc.role !== "gm")) {
        client.send(MessageType.GM_RESULT, {
          success: false,
          message: "Access denied. GM or Admin role required.",
        } satisfies import("@maple/shared").GmResultPayload);
        return;
      }

      const result = handleGmCommand(
        {
          client,
          room: { state: this.state, clients: this.clients },
          accountId,
          charName: player.name,
        },
        command,
      );
      client.send(MessageType.GM_RESULT, result);
      // Persist state mutations after GM commands (e.g. /level, /give mesos).
      this.persistPlayer(player);
    },

    // ─── Unstuck / Return to Town (self-recovery, any player) ───────────────
    [MessageType.UNSTUCK_ACTION]: (client: Client) => {
      this.handleUnstuckAction(client);
    },
  };

  onCreate(options: { mapId?: string; channel?: number } = {}): void {
    const mapId = options.mapId || "meadowfield";
    this.channel = options.channel ?? 0;
    const map = getMap(mapId);
    if (!map) {
      this.roomLog.error("unknown map — closing room", { mapId });
      return;
    }
    this.map = map;
    this.state.mapId = mapId;
    this.state.mapWidth = map.width;
    this.state.mapHeight = map.height;
    this.logCreate({ mapId, channel: this.channel });

    this.bossManager = new BossManager();

    this.spawnManager = new SpawnManager(
      this.state,
      this.map,
      () => ++this.idCounter,
      // onSpawn: register boss encounters when bosses appear
      (mobId) => {
        if (FIELD_BOSS_IDS.has(mobId) || this.bossManager.isBoss(mobId)) {
          // Find the mob instance we just spawned to register it.
          for (const [instId, mob] of this.state.mobs.entries()) {
            if (mob.mobId === mobId) {
              this.bossManager.registerEncounter(instId, mobId);
              break;
            }
          }
        }
      },
    );
    this.spawnManager.spawnAll();

    // Initialize rune + treasure box managers for combat maps only.
    if (isCombatMap(map)) {
      this.runeManager = new RuneManager(this.state, this.map, (type, payload) =>
        this.broadcast(type, payload),
      );
      this.treasureBoxManager = new TreasureBoxManager(
        this.state,
        this.map,
        (type, payload) => this.broadcast(type, payload),
        () => ++this.idCounter,
        (itemId, x, y) => this.spawnLoot(itemId, rollPotential(), x, y),
        (player, exp) => {
          const result = grantExp(player, exp);
          if (result.leveledUp) {
            const lc = this.findClientByPlayer(player);
            if (lc) {
              lc.send(MessageType.LEVEL_UP, {
                level: player.level,
                levelsGained: result.levelsGained,
                ap: player.ap,
                sp: player.sp,
                maxHp: player.maxHp,
                maxMp: player.maxMp,
              } satisfies LevelUpPayload);
            }
          }
          this.persistPlayer(player);
        },
      );
    }

    let elapsed = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsed += deltaTime;
      while (elapsed >= this.fixedTimeStep) {
        elapsed -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });
  }

  /** Party sync counter: push party HP/MP/level snapshots every ~1 second. */
  private partySyncTick = 0;
  private static readonly PARTY_SYNC_INTERVAL = 60; // ticks (≈1 s at 60 fps)

  /** Autosave counter: flush every player's full state on a fixed cadence (crash safety net). */
  private autosaveTick = 0;
  private readonly autosaveIntervalTicks = Math.max(
    1,
    Math.round(AUTOSAVE_INTERVAL_MS / (1000 / 60)),
  );

  /** Boss HP broadcast throttle: fire every N ticks instead of every tick (60→4 Hz). */
  private bossHpSyncTick = 0;
  private static readonly BOSS_HP_SYNC_INTERVAL = 15; // ≈4 Hz at 60 fps

  /** Per-tick reverse map: Mob instance → MapSchema key. Rebuilt once per tick for O(1) lookups. */
  private mobKeyByRef = new Map<Mob, string>();

  // ─── Main loop ──────────────────────────────────────────────────────────────
  //
  // Per-tick complexity at 50 CCU / 30 mobs / 5 familiars:
  //   Player physics + input drain  : O(players × queue_depth)      ≈ trivial
  //   Mob AI (findNearestPlayer)    : O(mobs × players)              ≈ 1,500 checks
  //   Familiar aggro scan           : O(familiars × mobs)            ≈ 150 checks
  //   Attack proximity (tryAttack)  : O(attacks × mobs)              ≈ 60 checks
  //   Foothold snap (nearestAt)     : O(players × footholds)         ≈ 1,000 checks
  //   ─────────────────────────────────────────────────────────────
  //   Total proximity work per tick ≈ 2,700 × ~5 ns ≈ 14 µs  (0.08% of 16.67 ms budget)
  //
  // At 200 CCU / 100 mobs: ~23,000 checks ≈ 115 µs (0.7%). Spatial partitioning
  // is NOT needed — the O(a×b) cross-type scans scale linearly in both counts.
  //
  // Schema sync: Colyseus delta-encodes only fields whose encoded value changed
  // since the last flush. Writing the same value (e.g. mob.x = mob.x for idle mobs)
  // does NOT mark the field dirty. No churny per-tick writes to synced fields.
  fixedTick(timeStep: number): void {
    // ── Build per-tick reverse lookup: Mob instance → MapSchema key ──
    // O(mobs) single pass; turns findMobKey from O(mobs) to O(1) in combat path.
    this.mobKeyByRef.clear();
    for (const [key, mob] of this.state.mobs.entries()) {
      this.mobKeyByRef.set(mob, key);
    }

    this.state.players.forEach((player) => {
      this.processPlayerInput(player);
      this.tickPlayerTimers(player, timeStep);
    });

    this.state.mobs.forEach((mob) => this.tickMob(mob, timeStep));

    // Projectile tick (ranged/caster mob projectiles).
    this.tickProjectiles(timeStep);

    // Familiar AI tick (follow owner, chase mobs, attack).
    if (FAMILIAR_ENABLED) {
      this.state.familiars.forEach((fam) => this.tickFamiliar(fam, timeStep));
    }

    // Boss encounter tick (timed spawns, multi-phase attacks, add summoning).
    this.bossManager.tick(
      timeStep,
      this.state,
      this.map,
      () => ++this.idCounter,
      (instanceId, bossDefId) => {
        this.broadcast("boss_spawn", {
          instanceId,
          mobId: bossDefId,
          name: getMobDef(bossDefId)?.name ?? bossDefId,
        });
      },
    );

    // Rune + treasure box tick (combat maps only).
    this.runeManager?.tick(timeStep);
    this.treasureBoxManager?.tick(timeStep);

    // Broadcast boss HP to all clients — throttled to ~4 Hz to save bandwidth.
    if (++this.bossHpSyncTick >= MapRoom.BOSS_HP_SYNC_INTERVAL) {
      this.bossHpSyncTick = 0;
      this.broadcastBossHp();
    }

    // ─── Scheduled transport departure loop (~1 s cadence) ──────────────────
    if (++this.departureTick >= 60) {
      this.departureTick = 0;
      this.processScheduledDepartures();
    }

    // Despawn expired loot drops. Collect UIDs to delete after iteration to avoid
    // mutating the MapSchema while iterating (no Array.from allocation).
    let lootToDelete: string[] | undefined;
    for (const [uid, drop] of this.state.loot) {
      drop.despawnTimer -= timeStep;
      if (drop.despawnTimer <= 0) {
        if (!lootToDelete) lootToDelete = [];
        lootToDelete.push(uid);
      }
    }
    if (lootToDelete) {
      for (const uid of lootToDelete) this.state.loot.delete(uid);
    }

    // Process mob respawns (zone-capped, staggered, per-mob-type delays).
    this.spawnManager.tick(timeStep);

    // Periodic party stats sync (HP/MP/level changes).
    if (++this.partySyncTick >= MapRoom.PARTY_SYNC_INTERVAL) {
      this.partySyncTick = 0;
      this.syncPartyStats();
    }

    // Periodic autosave — flush every player's full state so a crash loses at most
    // AUTOSAVE_INTERVAL_MS of progress (in addition to event-driven persists).
    // Also flush guild + friend state which is only written on explicit persist.
    if (++this.autosaveTick >= this.autosaveIntervalTicks) {
      this.autosaveTick = 0;
      this.persistAllPlayers();
      try {
        persistGuildsAndFriends();
      } catch (err) {
        console.error("[MapRoom] guild/friend autosave failed:", err);
      }
    }
  }

  /** Push updated HP/MP/level snapshots to every active party (cross-room aware). */
  private syncPartyStats(): void {
    const seen = new Set<string>();
    for (const [, player] of this.state.players) {
      // Update stats in the global party manager for this local player.
      partyManager.updateOnlineStats(
        player.charId,
        player.hp,
        player.maxHp,
        player.mp,
        player.maxMp,
        player.level,
        player.dead,
        player.x,
        player.y,
      );
      const party = partyManager.getPartyByChar(player.charId);
      if (!party || seen.has(party.id)) continue;
      seen.add(party.id);
      // Sync to all members (including cross-room via send callbacks).
      partyManager.syncPartyToAllMembers(party);
    }
  }

  private processPlayerInput(player: Player): void {
    // Drain the input queue — keep only the latest directional state.
    let input: InputData | undefined;
    let latest: InputData | undefined;
    let interactEdge = false;
    while ((input = player.inputQueue.shift())) {
      player.tick = input.tick;
      latest = input;
      if (player.dead) continue;
      // Stunned players cannot act.
      if (isStunned(player.activeEffects)) continue;
      // Attacks are disabled while climbing (MapleStory feel).
      if (!player.climbing && input.attack && player.attackCooldown <= 0) {
        this.tryAttack(player);
      }
      // Capture interact rising edge during drain (before queue empties).
      if (input.interact && !player.lastInteractHeld) {
        interactEdge = true;
      }
      if (input.interact) player.lastInteractHeld = true;
    }
    if (!latest || player.dead) {
      // Still update interact held state even when dead so edge resets.
      if (!latest) player.lastInteractHeld = false;
      return;
    }
    // Stunned players cannot move, jump, or climb.
    if (isStunned(player.activeEffects)) {
      if (!latest.interact) player.lastInteractHeld = false;
      return;
    }
    if (!latest.interact) player.lastInteractHeld = false;

    // ── Ladder / rope climbing ──
    if (player.climbing) {
      this.tickClimbing(player, latest);
      return; // skip gravity, horizontal movement, etc.
    }

    // ── GM No-clip: bypass all terrain collision and gravity ──
    const sessId = this.findSessionByPlayer(player);
    if (sessId && isNoclipping(sessId)) {
      const speed = PLAYER_SPEED * 1.5;
      if (latest.left) {
        player.vx = -speed;
        player.facing = -1;
      } else if (latest.right) {
        player.vx = speed;
        player.facing = 1;
      } else {
        player.vx = 0;
      }
      if (latest.up) {
        player.vy = -speed;
      } else if (latest.down) {
        player.vy = speed;
      } else {
        player.vy = 0;
      }
      player.grounded = false;
      player.x += player.vx;
      player.y += player.vy;
      player.x = clamp(player.x, 0, this.map.width);
      player.y = clamp(player.y, 0, this.map.height);
      return;
    }

    // ── Grab ladder (up near bottom, or down at top edge) ──
    if (!player.grounded) {
      // While airborne, press up near a ladder to grab it.
      if (latest.up) {
        const lad = ladderAt(this.map, player.x, player.y, LADDER_GRAB_TOLERANCE);
        if (lad) {
          this.attachToLadder(player, lad);
          return;
        }
      }
      // Pressing down while standing exactly on the top edge of a ladder
      // (i.e. grounded re-check happens below, but try here while airborne
      //  for the "step down onto rope" edge case).
      if (latest.down) {
        const lad = ladderAt(this.map, player.x, player.y, LADDER_GRAB_TOLERANCE);
        if (lad) {
          this.attachToLadder(player, lad);
          return;
        }
      }
    }

    // When grounded, check if player wants to grab a ladder below them
    // by pressing down while standing right on top of it.
    if (player.grounded && latest.down) {
      // Check for a ladder whose top is at or just below the player's feet.
      for (const lad of this.map.ladders) {
        if (Math.abs(lad.x - player.x) > LADDER_GRAB_TOLERANCE) continue;
        if (Math.abs(lad.yTop - player.y) <= FOOTHOLD_SNAP_PX) {
          this.attachToLadder(player, lad);
          player.y = lad.yTop + 1; // nudge just onto the ladder so it "sticks"
          return;
        }
      }
    }

    // When grounded, check if player wants to grab a ladder below them
    // by pressing up while standing right on top of it.
    if (player.grounded && latest.up) {
      for (const lad of this.map.ladders) {
        if (Math.abs(lad.x - player.x) > LADDER_GRAB_TOLERANCE) continue;
        if (Math.abs(lad.yTop - player.y) <= FOOTHOLD_SNAP_PX) {
          this.attachToLadder(player, lad);
          player.y = lad.yTop + 1;
          return;
        }
      }
    }

    // ── Horizontal velocity (acceleration / friction for gliding Maple feel) ──
    // Slow debuffs reduce movement speed.
    const playerSpeedMult = getSlowMultiplier(player.activeEffects);
    const maxSpeed = PLAYER_SPEED * playerSpeedMult;

    // Detect current foothold for slippery (ice) check.
    const currentFh = player.grounded ? this.nearestFootholdAt(player.x, player.y) : undefined;
    const isSlippery = currentFh?.slippery === true;
    const accel = isSlippery ? PLAYER_SLIPPERY_ACCEL : PLAYER_ACCEL;
    const friction = isSlippery ? PLAYER_SLIPPERY_FRICTION : PLAYER_FRICTION;

    if (latest.left) {
      // Accelerate toward target left speed.
      const target = -maxSpeed;
      if (player.vx > target) {
        player.vx = Math.max(target, player.vx - accel);
      }
      player.facing = -1;
    } else if (latest.right) {
      // Accelerate toward target right speed.
      const target = maxSpeed;
      if (player.vx < target) {
        player.vx = Math.min(target, player.vx + accel);
      }
      player.facing = 1;
    } else {
      // No input: friction decelerates toward 0.
      if (player.vx > 0) {
        player.vx = Math.max(0, player.vx - friction);
      } else if (player.vx < 0) {
        player.vx = Math.min(0, player.vx + friction);
      }
    }

    // ── Track standing / resting state for HP/MP regen ──
    // Reset the standing timer whenever the player is actively moving or jumping.
    const isMoving = latest.left || latest.right || latest.jump || latest.up || latest.down;
    if (isMoving) {
      player.standingSince = Date.now();
    }

    // ── Jump / Drop-through (edge-triggered: fire only on the rising edge) ──
    if (this.map.swimming) {
      // ── Swimming: free vertical movement via jump + up/down keys ──
      if (latest.jump && !player.lastJumpHeld) {
        player.vy = SWIM_VELOCITY;
        player.grounded = false;
      }
      // Hold up to swim upward, hold down to dive
      if (latest.up) {
        player.vy -= SWIM_VERTICAL_SPEED * 0.3; // gradual upward pull
      } else if (latest.down) {
        player.vy += SWIM_VERTICAL_SPEED * 0.3; // gradual downward pull
      }
    } else {
      // Normal land physics
      if (latest.jump && !player.lastJumpHeld && player.grounded) {
        if (latest.down) {
          // MapleStory drop-through: falling through a thin platform.
          const currentFh = this.nearestFootholdAt(player.x, player.y);
          if (currentFh && !currentFh.solid) {
            player.dropThroughFootholdId = currentFh.id;
            player.dropThroughTimer = DROP_THROUGH_MS;
            player.grounded = false;
          }
          // Solid foothold → do nothing (can't drop through the ground).
        } else {
          player.vy = JUMP_VELOCITY;
          player.grounded = false;
        }
      }
    }
    player.lastJumpHeld = latest.jump;

    // ── Integrate X ──
    const prevPlayerX = player.x;
    player.x += player.vx;
    if (this.map.walls?.length) {
      player.x = clampXByWalls(this.map.walls, prevPlayerX, player.x, player.y);
    }
    player.x = clamp(player.x, 0, this.map.width);

    if (this.map.swimming) {
      // ── Swimming: buoyant physics with reduced gravity ──
      player.vy = clamp(player.vy + SWIM_GRAVITY, -SWIM_MAX_FALL, SWIM_MAX_FALL);
      player.y += player.vy;

      // Still check foothold landing (for seabed collision)
      if (player.vy >= 0) {
        const fh = this.landingFoothold(player.x, player.y - player.vy, player.y);
        if (fh) {
          player.y = groundYAt(fh, player.x);
          player.vy = 0;
          player.grounded = true;
        } else {
          player.grounded = false;
        }
      }
    } else {
      // ── Grounded re-check after horizontal movement (slope follow + walk-off-edge) ──
      if (player.grounded) {
        const skipId = player.dropThroughTimer > 0 ? player.dropThroughFootholdId : -1;
        const fh = this.nearestFootholdAt(player.x, player.y, skipId);
        if (fh) {
          player.y = groundYAt(fh, player.x); // snap to surface (handles slopes)
        } else {
          player.grounded = false; // no platform nearby
        }
      }

      // ── Gravity + Y integration (airborne only) ──
      if (!player.grounded) {
        player.vy = Math.min(player.vy + GRAVITY, MAX_FALL_SPEED);
        const prevY = player.y;
        player.y += player.vy;

        // Landing: check if we crossed a foothold surface while falling.
        if (player.vy >= 0) {
          const skipId = player.dropThroughTimer > 0 ? player.dropThroughFootholdId : -1;
          const fh = this.landingFoothold(player.x, prevY, player.y, skipId);
          if (fh) {
            player.y = groundYAt(fh, player.x);
            player.vy = 0;
            player.grounded = true;
            player.dropThroughFootholdId = -1; // clear once landed
          }
        }
      }
    }

    // ── Clamp Y to map bounds (floor safety net) ──
    if (player.y > this.map.height) {
      player.y = this.map.height;
      player.vy = 0;
      player.grounded = true;
    }

    // ── Portal activation (after position update so we check the final position) ──
    if (interactEdge) {
      this.checkPortalProximity(player);
    }
  }

  /** Snap the player onto a ladder and enter climbing mode. */
  private attachToLadder(player: Player, lad: Ladder): void {
    player.climbing = true;
    player.ladderId = lad.id;
    player.x = lad.x; // snap x to ladder centre
    player.vy = 0;
    player.vx = 0;
    player.grounded = false;
    player.attacking = false;
    player.lastJumpHeld = false; // reset edge-trigger so jump doesn't fire on detach
  }

  /** Tick one frame of climbing movement. Handles input, clamping, and detach conditions. */
  private tickClimbing(player: Player, input: InputData): void {
    const lad = this.map.ladders.find((l) => l.id === player.ladderId);
    if (!lad) {
      // Ladder disappeared — emergency detach.
      this.detachFromLadder(player);
      return;
    }

    // ── Release conditions ──
    // Jump detaches immediately (gives a small upward boost at top, or drops at bottom).
    if (input.jump) {
      this.detachFromLadder(player);
      // If near top, give a small hop so the player lands on the platform.
      if (Math.abs(player.y - lad.yTop) < FOOTHOLD_SNAP_PX + 4) {
        player.vy = JUMP_VELOCITY * 0.6; // smaller hop off ladder
      }
      return;
    }

    // Pressing left or right detaches (walk off the ladder).
    if (input.left || input.right) {
      this.detachFromLadder(player);
      return;
    }

    // ── Vertical movement along the ladder ──
    if (input.up) {
      player.y -= CLIMB_SPEED;
    } else if (input.down) {
      player.y += CLIMB_SPEED;
    }

    // Keep x locked to ladder while climbing.
    player.x = lad.x;
    player.vy = 0;

    // ── Clamp to ladder vertical bounds ──
    if (player.y <= lad.yTop) {
      player.y = lad.yTop;
      // Reaching the top: if there is a foothold here, land on it.
      const topFh = this.nearestFootholdAt(player.x, player.y);
      if (topFh) {
        player.y = groundYAt(topFh, player.x);
        this.detachFromLadder(player);
        return;
      }
    }

    if (player.y >= lad.yBottom) {
      // At the bottom — drop off and find the ground foothold.
      player.y = lad.yBottom;
      this.detachFromLadder(player);
      // Land on the foothold below (gravity will kick in next tick).
      const botFh = this.nearestFootholdAt(player.x, player.y);
      if (botFh) {
        player.y = groundYAt(botFh, player.x);
        player.grounded = true;
      }
    }
  }

  /** Detach from a ladder and re-enable normal physics. */
  private detachFromLadder(player: Player): void {
    player.climbing = false;
    player.ladderId = -1;
    player.vx = 0;
    player.lastJumpHeld = false; // prevent edge-triggered jump from firing
  }

  /**
   * Find the nearest foothold at `x` whose surface is within FOOTHOLD_SNAP_PX of `y`
   * (above or below). Used by the grounded re-check to handle slopes and float jitter.
   */
  private nearestFootholdAt(x: number, y: number, skipFootholdId = -1): Foothold | undefined {
    let best: Foothold | undefined;
    let bestDist = Infinity;
    for (const fh of this.map.footholds) {
      if (fh.id === skipFootholdId) continue;
      const minX = Math.min(fh.x1, fh.x2);
      const maxX = Math.max(fh.x1, fh.x2);
      if (x < minX || x > maxX) continue;
      const sy = groundYAt(fh, x);
      const dist = Math.abs(sy - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = fh;
      }
    }
    return bestDist <= FOOTHOLD_SNAP_PX ? best : undefined;
  }

  /**
   * Find the foothold the player is landing on after falling from `prevY` to `y`.
   * Returns the closest surface whose y is between prevY and y (inclusive with tolerance),
   * preferring the highest one (nearest platform the player crossed).
   */
  private landingFoothold(
    x: number,
    prevY: number,
    currentY: number,
    skipFootholdId = -1,
  ): Foothold | undefined {
    let best: Foothold | undefined;
    let bestY = Infinity;
    for (const fh of this.map.footholds) {
      if (fh.id === skipFootholdId) continue;
      const minX = Math.min(fh.x1, fh.x2);
      const maxX = Math.max(fh.x1, fh.x2);
      if (x < minX || x > maxX) continue;
      const sy = groundYAt(fh, x);
      // Player crossed the surface: was above (or within tolerance) and is now at or below.
      if (prevY <= sy + FOOTHOLD_SNAP_PX && currentY >= sy - FOOTHOLD_SNAP_PX) {
        if (sy < bestY) {
          bestY = sy;
          best = fh;
        }
      }
    }
    return best;
  }

  private tickPlayerTimers(player: Player, dt: number): void {
    if (player.attackCooldown > 0) player.attackCooldown -= dt;
    if (player.attackTimer > 0) {
      player.attackTimer -= dt;
      if (player.attackTimer <= 0) player.attacking = false;
    }
    if (player.dropThroughTimer > 0) player.dropThroughTimer -= dt;
    if (player.dead) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0) this.respawnPlayer(player);
    }

    // ── Combo expiry: reset if no hit within the combo window ──
    if (player.comboCount > 0 && Date.now() - player.comboLastHitAt > COMBO_WINDOW_MS) {
      player.comboCount = 0;
    }

    // ── Player knockback: apply horizontal slide then decay ──
    if (player.knockbackVx !== 0) {
      player.x += player.knockbackVx;
      player.x = clamp(player.x, 0, this.map.width);
      player.knockbackVx *= KNOCKBACK_DECAY;
      if (Math.abs(player.knockbackVx) < 0.3) player.knockbackVx = 0;
    }

    // Tick skill + consumable cooldowns.
    for (const [skillId, remaining] of player.skillCooldowns) {
      const newRem = remaining - dt;
      if (newRem <= 0) player.skillCooldowns.delete(skillId);
      else player.skillCooldowns.set(skillId, newRem);
    }
    for (const [defId, remaining] of player.consumableCooldowns) {
      const newRem = remaining - dt;
      if (newRem <= 0) player.consumableCooldowns.delete(defId);
      else player.consumableCooldowns.set(defId, newRem);
    }

    // Tick active status effects (buffs, debuffs, DoT, HoT).
    if (player.activeEffects.length > 0) {
      const prevLen = player.activeEffects.length;
      const result = tickEffects(player.activeEffects, dt, player.effectElapsed);
      player.activeEffects = result.active;
      if (result.hpDelta !== 0) {
        player.hp = Math.max(1, Math.min(player.maxHp, player.hp + result.hpDelta));
        // Broadcast DoT/HoT combat number so the client shows a floating damage/heal number.
        const sess = this.findSessionByPlayer(player);
        if (sess) {
          this.broadcast("effect_tick", {
            sessionId: sess,
            delta: result.hpDelta,
            hp: player.hp,
            dead: player.dead,
          });
        }
      }
      // Sync to client when effects change (applied or expired).
      if (player.activeEffects.length !== prevLen) {
        this.syncPlayerEffects(player);
      }
    }

    // ── HP / MP Regeneration (out-of-combat, MapleStory-style) ──
    // Only regen if alive, not at full HP/MP, and out of combat for long enough.
    const now = Date.now();
    const outOfCombat = now - player.lastDamagedAt >= REGEN_COMBAT_DELAY_MS;
    if (!player.dead && outOfCombat && (player.hp < player.maxHp || player.mp < player.maxMp)) {
      const isResting = now - player.standingSince >= REGEN_STANDING_DELAY_MS;

      // Pick the appropriate rate: faster when resting (standing still).
      const hpRate = isResting ? REGEN_HP_REST_RATE : REGEN_HP_PASSIVE_RATE;
      let mpRate = isResting ? REGEN_MP_REST_RATE : REGEN_MP_PASSIVE_RATE;
      // Mages burn through MP fast — give them a class-based MP regen bonus.
      if (player.archetype === ClassArchetype.MAGE) {
        mpRate *= REGEN_MAGE_MP_MULTIPLIER;
      }

      // Accumulate fractional regen; apply only when ≥ 1 HP/MP.
      const dtSec = dt / 1000;
      let changed = false;
      if (player.hp < player.maxHp) {
        player._regenAccumHp += player.maxHp * hpRate * dtSec;
        if (player._regenAccumHp >= 1) {
          const heal = Math.floor(player._regenAccumHp);
          player.hp = Math.min(player.maxHp, player.hp + heal);
          player._regenAccumHp -= heal;
          changed = true;
        }
      } else {
        player._regenAccumHp = 0;
      }
      if (player.mp < player.maxMp) {
        player._regenAccumMp += player.maxMp * mpRate * dtSec;
        if (player._regenAccumMp >= 1) {
          const heal = Math.floor(player._regenAccumMp);
          player.mp = Math.min(player.maxMp, player.mp + heal);
          player._regenAccumMp -= heal;
          changed = true;
        }
      } else {
        player._regenAccumMp = 0;
      }

      // Broadcast a regen event so the client can show a green heal number.
      if (changed) {
        const sess = this.findSessionByPlayer(player);
        if (sess) {
          this.broadcast("regen_tick", {
            sessionId: sess,
            hp: player.hp,
            mp: player.mp,
            resting: isResting,
          });
        }
      }
    }
  }

  // ─── Combat ───────────────────────────────────────────────────────────────
  private tryAttack(attacker: Player): void {
    // Resolve attack type from equipped weapon → class fallback.
    const invLookup = (uid: string) => attacker.inventory.get(uid)?.defId;
    const equippedRec = Object.fromEntries(attacker.equipped.entries());
    const attackType = resolveAttackType(equippedRec, invLookup, attacker.archetype);
    attacker.attackType = attackType;
    attacker.attacking = true;
    attacker.attackTimer = ATTACK_DURATION_MS;
    attacker.attackCooldown = ATTACK_COOLDOWN_MS;

    const attackerStats = this.buildAttackerStats(attacker);
    let hitCount = 0;
    let anyHit = false; // track whether at least one mob was hit this swing

    // Hoist session lookup out of the mob loop — constant for this attacker.
    const attackerSession = this.findSessionByPlayer(attacker);

    // Check treasure box hit first (before mob loop).
    if (this.treasureBoxManager?.onAttack(attacker)) {
      anyHit = true;
    }

    this.state.mobs.forEach((mob) => {
      if (mob.dead) return;
      if (attackType === AttackType.MAGIC) {
        if (hitCount >= MAGIC_HIT_TARGETS) return;
        if (!this.inRange(mob, attacker, ATTACK_RANGE_MAGIC)) return;
        hitCount++;
      } else if (attackType === AttackType.RANGED) {
        if (!this.inRangedArc(attacker, mob)) return;
      } else {
        if (!this.inMeleeArc(attacker, mob)) return;
      }

      const mobDef = getMobDef(mob.mobId);
      const effectiveDef = getEffectiveMobDef(mobDef, mob.isElite);
      const defender: DefenderCombatStats = {
        wDef: effectiveDef?.wDef ?? 0,
        mDef: effectiveDef?.mDef ?? 0,
        avoid: effectiveDef?.avoid ?? 0,
        level: effectiveDef?.level ?? 1,
      };
      const result = computeDamage(attackerStats, defender, {
        element: "PHYSICAL",
        targetElementMods: mobDef?.elementMods,
      });

      if (result.hit && result.total > 0) {
        mob.hp -= result.total;
        mob.hit = true;
        mob.hitTimer = 120;
        anyHit = true;

        // ── Knockback: push the mob away from the attacker, proportional to damage ──
        if (result.total >= KNOCKBACK_MIN_DMG) {
          const kb = Math.min(KNOCKBACK_MAX, Math.max(1, result.total * 0.15));
          mob.knockbackVx += kb * attacker.facing;
          mob.knockbackTimer = 300;
        }

        // Track boss damage ownership and phase transitions.
        const bossEnc = this.bossManager.getEncounter(mob.instanceId);
        if (bossEnc && attackerSession) {
          const bossMobDef = getMobDef(mob.mobId);
          this.bossManager.onBossHit(
            mob.instanceId,
            attackerSession,
            mob.hp,
            mob.maxHp,
            bossMobDef?.phases ?? [0.5],
            this.state,
          );
        }

        if (mob.hp <= 0) this.killMob(mob, attacker);
      }

      // Broadcast combat result so the client can show floating numbers.
      this.broadcast(MessageType.COMBAT_HIT, {
        targetKey: this.mobKeyByRef.get(mob) ?? "",
        attackerSession,
        damage: result.total,
        crit: result.crit,
        hit: result.hit,
        mobHp: Math.max(0, mob.hp),
        mobMaxHp: mob.maxHp,
        elementMultiplier: result.elementMultiplier,
      } satisfies CombatHitPayload);
    });

    // ── Combo: increment on hit, reset on miss ──
    const now = Date.now();
    if (anyHit) {
      attacker.comboCount++;
      attacker.comboLastHitAt = now;
    } else {
      attacker.comboCount = 0;
    }
  }

  /** Build AttackerCombatStats from a player for use with computeDamage. */
  private buildAttackerStats(player: Player): AttackerCombatStats {
    const primary = this.playerPrimary(player);
    const equippedRec = Object.fromEntries(player.equipped.entries());
    const bonus = resolveEquippedBonus(
      equippedRec,
      (uid) => {
        const item = player.inventory.get(uid);
        return item ? getItemDef(item.defId) : undefined;
      },
      (uid) => {
        const item = player.inventory.get(uid);
        return (item?.baseRank ?? "NORMAL") as import("@maple/shared").BaseRank;
      },
      (uid) => {
        const item = player.inventory.get(uid);
        if (!item?.potentialLines) return [];
        try {
          return JSON.parse(item.potentialLines) as import("@maple/shared").PotentialLine[];
        } catch {
          return [];
        }
      },
      (uid) => {
        const item = player.inventory.get(uid);
        if (!item?.bonusStats) return [];
        try {
          const parsed = JSON.parse(item.bonusStats) as import("@maple/shared").BonusStatLine[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
    );

    const equipBonus: Record<string, number> = {
      atk: 0,
      mAtk: 0,
      wDef: bonus.wDef,
      mDef: bonus.mDef,
      critRate: 0,
      speed: bonus.speed,
      jump: bonus.jump,
      accuracy: 0,
    };

    const equippedDefIds = Object.values(equippedRec)
      .map((uid) => {
        const item = player.inventory.get(uid);
        return item ? getItemDef(item.defId)?.id : undefined;
      })
      .filter((id): id is string => id !== undefined);
    const setBonus = computeSetBonuses(equippedDefIds);
    equipBonus.atk += bonus.atk + setBonus.atk;
    equipBonus.mAtk += setBonus.mAtk;
    equipBonus.wDef += setBonus.wDef;
    equipBonus.mDef += setBonus.mDef;
    equipBonus.critRate += setBonus.critRate;
    equipBonus.speed += setBonus.speed;
    equipBonus.jump += setBonus.jump;
    equipBonus.accuracy += setBonus.accuracy;

    const stats = {
      STR: player.str + bonus.str + setBonus.STR,
      DEX: player.dex + bonus.dex + setBonus.DEX,
      INT: player.intel + bonus.int + setBonus.INT,
      LUK: player.luk + bonus.luk + setBonus.LUK,
      HP: player.hp + bonus.hp + setBonus.HP,
      MP: player.mp + bonus.mp + setBonus.MP,
    };
    // Compute passive + active effect bonuses.
    const passive = passiveEffectBonus(
      player.archetype as import("@maple/shared").ClassArchetype,
      player.skillBook,
    );
    const activeBuff = aggregateSecondary(player.activeEffects);
    const effectBonus = mergeBonus(passive, activeBuff);

    const secondary = deriveSecondary(stats, primary, equipBonus, effectBonus);

    return {
      atk: secondary.atk,
      mAtk: secondary.mAtk,
      primaryStat: secondary.atk,
      skillDamagePercent: 100,
      hitCount: 1,
      accuracy: secondary.accuracy,
      critRate: secondary.critRate,
      level: player.level,
    };
  }

  /** Generic distance check used by magic AoE (any horizontal direction). */
  private inRange(mob: Mob, player: Player, range: number): boolean {
    const dx = Math.abs(mob.x - player.x);
    const dy = Math.abs(mob.y - player.y);
    return dx <= range && dy <= ATTACK_VERT_ALL;
  }

  private inMeleeArc(player: Player, mob: Mob): boolean {
    const dx = mob.x - player.x;
    const dy = Math.abs(mob.y - player.y);
    if (dy > ATTACK_VERT_ALL || Math.abs(dx) > ATTACK_RANGE_MELEE) return false;
    // mob must be in front of the player (small overlap tolerance)
    return player.facing === 1 ? dx >= -10 : dx <= 10;
  }

  /** Ranged: mob in a line along the facing direction, up to RANGED_RANGE. */
  private inRangedArc(player: Player, mob: Mob): boolean {
    const dx = mob.x - player.x;
    const dy = Math.abs(mob.y - player.y);
    if (dy > ATTACK_VERT_ALL || Math.abs(dx) > ATTACK_RANGE_RANGED) return false;
    // Must be in the direction the player is facing.
    return player.facing === 1 ? dx >= 0 : dx <= 0;
  }

  private playerDamage(player: Player): number {
    const primary = this.playerPrimary(player);

    const equippedRec = Object.fromEntries(player.equipped.entries());

    // Resolve ATK + primary stat bonuses (rank-multiplied + potential lines + flame stats).
    const bonus = resolveEquippedBonus(
      equippedRec,
      (uid) => {
        const item = player.inventory.get(uid);
        return item ? getItemDef(item.defId) : undefined;
      },
      (uid) => {
        const item = player.inventory.get(uid);
        return (item?.baseRank ?? "NORMAL") as import("@maple/shared").BaseRank;
      },
      (uid) => {
        const item = player.inventory.get(uid);
        if (!item?.potentialLines) return [];
        try {
          return JSON.parse(item.potentialLines) as PotentialLine[];
        } catch {
          return [];
        }
      },
      (uid) => {
        const item = player.inventory.get(uid);
        if (!item?.bonusStats) return [];
        try {
          const parsed = JSON.parse(item.bonusStats) as import("@maple/shared").BonusStatLine[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
    );

    // Secondary stats (wDef/mDef/speed/jump) from resolveEquippedBonus.
    const equipBonus: Record<string, number> = {
      atk: 0,
      mAtk: 0,
      wDef: bonus.wDef,
      mDef: bonus.mDef,
      critRate: 0,
      speed: bonus.speed,
      jump: bonus.jump,
      accuracy: 0,
    };

    // Set bonuses (wDef, mDef, ATK, STR, HP, etc.) from matching gear.
    const equippedDefIds = Object.values(equippedRec)
      .map((uid) => {
        const item = player.inventory.get(uid);
        return item ? getItemDef(item.defId)?.id : undefined;
      })
      .filter((id): id is string => id !== undefined);
    const setBonus = computeSetBonuses(equippedDefIds);
    equipBonus.atk += bonus.atk + setBonus.atk;
    equipBonus.mAtk += setBonus.mAtk;
    equipBonus.wDef += setBonus.wDef;
    equipBonus.mDef += setBonus.mDef;
    equipBonus.critRate += setBonus.critRate;
    equipBonus.speed += setBonus.speed;
    equipBonus.jump += setBonus.jump;
    equipBonus.accuracy += setBonus.accuracy;

    // Effective primary stats = base + item primary stat bonuses + set primary bonuses.
    const stats = {
      STR: player.str + bonus.str + setBonus.STR,
      DEX: player.dex + bonus.dex + setBonus.DEX,
      INT: player.intel + bonus.int + setBonus.INT,
      LUK: player.luk + bonus.luk + setBonus.LUK,
      HP: player.hp + bonus.hp + setBonus.HP,
      MP: player.mp + bonus.mp + setBonus.MP,
    };
    // Compute passive + active effect bonuses.
    const passive = passiveEffectBonus(
      player.archetype as import("@maple/shared").ClassArchetype,
      player.skillBook,
    );
    const activeBuff = aggregateSecondary(player.activeEffects);
    const effectBonus = mergeBonus(passive, activeBuff);

    // deriveSecondary computes ATK/mAtk from primary stats, adds equipBonus + effectBonus.
    const secondary = deriveSecondary(stats, primary, equipBonus, effectBonus);
    const power = secondary.atk;

    // ±20% spread so numbers feel alive.
    return Math.max(1, Math.round(power * (0.9 + Math.random() * 0.4)));
  }

  private playerPrimary(player: Player): PrimaryStat {
    return getClass(player.archetype as ClassArchetype).primaryStat;
  }

  private killMob(mob: Mob, killer: Player): void {
    if (mob.dead) return; // guard against double-kill in same tick
    mob.dead = true;
    mob.hp = 0;
    mob.hit = false;

    // Clean up any projectiles owned by this mob.
    for (const [key, proj] of this.state.projectiles.entries()) {
      if (proj.ownerId === mob.instanceId) {
        proj.dead = true;
        this.state.projectiles.delete(key);
      }
    }

    // Boss death handling — clean up encounter and broadcast.
    const isBossKill = this.bossManager.isBoss(mob.instanceId);
    if (isBossKill) {
      this.bossManager.onBossDeath(mob.instanceId);
      this.broadcast("boss_death", {
        instanceId: mob.instanceId,
        mobId: mob.mobId,
        name: getMobDef(mob.mobId)?.name ?? mob.mobId,
      });
      const bKillerSess = this.findSessionByPlayer(killer);
      const bKillerAcct = bKillerSess ? this.sessionAccount.get(bKillerSess) : undefined;
      if (bKillerAcct) {
        track(AnalyticsEventType.BOSS_KILL, bKillerAcct, killer.charId, {
          mobId: mob.mobId,
          name: getMobDef(mob.mobId)?.name ?? mob.mobId,
          level: killer.level,
        });
      }
    }

    const def = getMobDef(mob.mobId);
    if (!def) {
      this.spawnManager.onMobDeath(mob.instanceId);
      this.spawnManager.removeDeadMob(mob.instanceId);
      return;
    }

    // Mesos go to the killer (boss kills: shared among all damage owners below).
    const eliteDef = mob.isElite ? createEliteMob(def) : def;
    const mesosDrop = rollMesos(eliteDef);
    killer.mesos += mesosDrop;
    accountStore.setMesos(killer.charId, killer.mesos);
    // Track lifetime mesos earned for achievements.
    killer.totalMesosEarned += mesosDrop;
    accountStore.incrementLifetimeCounter(killer.charId, "totalMesosEarned", mesosDrop);
    // Boss mesos: also grant a share to each damage owner (not just the killer).
    const bossMesosShare = isBossKill ? Math.max(1, Math.floor(mesosDrop * 0.5)) : 0;

    // EXP may be shared among nearby same-map party members.
    // Apply rune EXP multiplier if the killer has an active EXP rune buff.
    const killerSessionId = this.findSessionByPlayer(killer);
    const runeExpMul = this.runeManager?.getExpMultiplier(killerSessionId ?? "") ?? 1;
    const eliteExpMul = mob.isElite ? ELITE_SCALING.eliteKillExpMultiplier : 1;
    const bonusHuntExpMul = getExpMultiplierForMap(this.state.mapId);
    const baseExp = Math.floor(def.exp * runeExpMul * eliteExpMul * bonusHuntExpMul);
    const killerCharId = killer.charId;
    const expShares = partyManager.computePartyExp(
      { level: killer.level, dead: killer.dead, x: killer.x, y: killer.y },
      killerCharId,
      this.state.mapId,
      baseExp,
      mob.x,
      mob.y,
    );

    for (const share of expShares) {
      // Resolve charId to a local Player object (only same-map members qualify).
      const sharePlayer = this.findPlayerByCharId(share.charId);
      if (!sharePlayer) continue;
      const expResult = grantExp(sharePlayer, share.exp);
      this.persistPlayer(sharePlayer);
      if (expResult.leveledUp) {
        const lc = this.findClientByPlayer(sharePlayer);
        if (lc) {
          lc.send(MessageType.LEVEL_UP, {
            level: sharePlayer.level,
            levelsGained: expResult.levelsGained,
            ap: sharePlayer.ap,
            sp: sharePlayer.sp,
            maxHp: sharePlayer.maxHp,
            maxMp: sharePlayer.maxMp,
          } satisfies LevelUpPayload);
        }
        const shareSession = this.findSessionByPlayer(sharePlayer);
        const shareAcct = shareSession ? this.sessionAccount.get(shareSession) : undefined;
        if (shareAcct) {
          track(AnalyticsEventType.LEVEL_UP, shareAcct, sharePlayer.charId, {
            level: sharePlayer.level,
            levelsGained: expResult.levelsGained,
            class: sharePlayer.archetype,
          });
        }
        if (progressObjectives(sharePlayer.questState, "level", String(sharePlayer.level), 1)) {
          const lc = this.findClientByPlayer(sharePlayer);
          if (lc) sendQuestUpdate(lc, sharePlayer.questState);
        }
        // Re-sync the guide panel so level-banded milestones update immediately
        // after a mob-grind level-up (the most common way to cross a boundary).
        {
          const lc = this.findClientByPlayer(sharePlayer);
          if (lc) sendGuidanceSync(lc, sharePlayer.questState, sharePlayer.level);
        }
        // ── Achievements: level_reached ─────────────────────────────────
        this.processAchievementUnlocks(
          sharePlayer,
          updateAchievementProgress(
            sharePlayer.achievements,
            "level_reached",
            expResult.levelsGained,
          ),
        );
      }
    }

    // Sync party HP/MP/level after EXP grants (may have levelled up).
    if (killerCharId) {
      const party = partyManager.getPartyByChar(killerCharId);
      if (party) partyManager.syncPartyToAllMembers(party);
    }

    // Boss loot fairness: grant base EXP + mesos share to all damage contributors
    // who weren't already covered by the killer's party EXP distribution.
    if (isBossKill) {
      const partyRecipientCharIds = new Set(expShares.map((s) => s.charId));
      const lootOwners = this.bossManager.getLootOwners(mob.instanceId);
      for (const sessId of lootOwners) {
        const dmgPlayer = this.state.players.get(sessId);
        if (!dmgPlayer || dmgPlayer.charId === killerCharId) continue;
        if (partyRecipientCharIds.has(dmgPlayer.charId)) continue;
        // Mesos share for non-killer participants.
        if (bossMesosShare > 0) {
          dmgPlayer.mesos += bossMesosShare;
          accountStore.setMesos(dmgPlayer.charId, dmgPlayer.mesos);
          dmgPlayer.totalMesosEarned += bossMesosShare;
          accountStore.incrementLifetimeCounter(
            dmgPlayer.charId,
            "totalMesosEarned",
            bossMesosShare,
          );
        }
        // EXP share for non-killer participants.
        const expResult = grantExp(dmgPlayer, baseExp);
        this.persistPlayer(dmgPlayer);
        if (expResult.leveledUp) {
          const lc = this.findClientByPlayer(dmgPlayer);
          if (lc) {
            lc.send(MessageType.LEVEL_UP, {
              level: dmgPlayer.level,
              levelsGained: expResult.levelsGained,
              ap: dmgPlayer.ap,
              sp: dmgPlayer.sp,
              maxHp: dmgPlayer.maxHp,
              maxMp: dmgPlayer.maxMp,
            } satisfies LevelUpPayload);
          }
        }
      }
    }

    // Roll item drops → each rolls a Potential tier from the public, tested table.
    // Boss drops: FFA to all damage owners (not restricted to the last-hitter).
    // Regular drops: owned by the killer (and their party via canLoot).
    const killerSession = this.findSessionByPlayer(killer);
    const dropMult = getDropMultiplierForMap(this.state.mapId);
    for (const itemId of rollItemDrops(eliteDef)) {
      this.spawnLoot(itemId, rollPotential(), mob.x, mob.y, isBossKill ? undefined : killerSession);
      // Bonus hunting: fractional multiplier → chance of an extra drop.
      if (dropMult > 1 && Math.random() < dropMult - 1) {
        this.spawnLoot(
          itemId,
          rollPotential(),
          mob.x,
          mob.y,
          isBossKill ? undefined : killerSession,
        );
      }
    }

    // Progress kill objectives for active quests (killer only).
    if (progressObjectives(killer.questState, "kill", mob.mobId, 1)) {
      const client = this.findClientByPlayer(killer);
      if (client) sendQuestUpdate(client, killer.questState);
    }

    // ── Codex: record kill and check for new milestones ────────────────────
    accountStore.recordCodexKill(killer.charId, mob.mobId, 1);
    killer.codex[mob.mobId] = (killer.codex[mob.mobId] ?? 0) + 1;
    const codexResult = evaluateCodexMilestones(killer.codex);
    const kc = this.findClientByPlayer(killer);
    if (kc) {
      kc.send(MessageType.CODEX_SYNC, {
        codex: killer.codex,
        statBonus: {
          STR: codexResult.totalStatBonus.STR ?? 0,
          DEX: codexResult.totalStatBonus.DEX ?? 0,
          INT: codexResult.totalStatBonus.INT ?? 0,
          LUK: codexResult.totalStatBonus.LUK ?? 0,
          HP: codexResult.totalStatBonus.HP ?? 0,
          MP: codexResult.totalStatBonus.MP ?? 0,
        },
        expBonus: codexResult.totalExpBonus,
      } satisfies CodexSyncPayload);
    }

    // ── Achievements: update kill-based achievements ───────────────────────
    const killCompleted = updateAchievementProgress(killer.achievements, "total_kills", 1);
    if (def.isBoss) {
      const bossCompleted = updateAchievementProgress(
        killer.achievements,
        "total_kills",
        1,
        "boss",
      );
      killCompleted.push(...bossCompleted);
    }
    this.processAchievementUnlocks(killer, killCompleted);

    // ── Achievements: track mesos earned from mob drops ────────────────────
    this.processAchievementUnlocks(killer, [
      ...updateAchievementProgress(killer.achievements, "mesos_earned", mesosDrop),
    ]);

    // Familiar card drop: 2% chance on non-boss kills.
    if (FAMILIAR_ENABLED && !def.isBoss && Math.random() < FAMILIAR_CARD_DROP_CHANCE) {
      const killerSess = this.findSessionByPlayer(killer);
      if (killerSess) {
        const coll = this.familiarCollections.get(killerSess);
        if (coll && !coll.registered.includes(mob.mobId)) {
          coll.registered.push(mob.mobId);
          accountStore.updateCharacter(killer.charId, { familiars: coll });
          const kc = this.findClientByPlayer(killer);
          if (kc) {
            kc.send(MessageType.FAMILIAR_CARD_DROP, {
              mobId: mob.mobId,
              mobName: def.name,
            } satisfies FamiliarCardDropPayload);
            kc.send(MessageType.FAMILIAR_SYNC, {
              registered: coll.registered,
              summoned: coll.summoned,
            } satisfies FamiliarSyncPayload);
          }
        }
      }
    }

    // Schedule respawn through the spawn manager and remove the dead instance.
    this.spawnManager.onMobDeath(mob.instanceId);
    this.spawnManager.removeDeadMob(mob.instanceId);
  }

  private damagePlayer(player: Player, dmg: number): void {
    if (player.dead) return;
    // GM invincibility check: /god toggle.
    const sessId = this.findSessionByPlayer(player);
    if (sessId && isGmInvincible(sessId)) return;
    // I-frame check: ignore damage during the invulnerability window.
    const now = Date.now();
    if (now < player.iframesUntil) return;
    // Track when the player was last hit — drives the out-of-combat regen delay.
    player.lastDamagedAt = now;
    // Knockback the player backward (opposite their facing direction).
    player.knockbackVx += dmg * 0.12 * -player.facing;
    player.hp -= dmg;
    // Grant i-frames after taking contact/boss damage.
    player.iframesUntil = now + IFRAME_MS;
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      player.attacking = false;
      player.respawnTimer = PLAYER_RESPAWN_MS;

      // ── Death penalty: EXP loss (skip in non-combat / town maps) ──────
      if (isCombatMap(this.map)) {
        const loss = deathExpLoss(player.level, player.exp);
        if (loss > 0) player.exp = Math.max(0, player.exp - loss);
      }

      const sess = this.findSessionByPlayer(player);
      const acct = sess ? this.sessionAccount.get(sess) : undefined;
      if (acct) {
        track(AnalyticsEventType.DEATH, acct, player.charId, {
          mapId: this.state.mapId,
          level: player.level,
        });
      }
    }
  }

  private respawnPlayer(player: Player): void {
    player.dead = false;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    player.vy = 0;
    player.vx = 0;
    player.grounded = true;
    player.climbing = false;
    player.ladderId = -1;
    player.dropThroughTimer = 0;
    player.dropThroughFootholdId = -1;
    player.iframesUntil = 0;
    player.comboCount = 0;
    player.comboLastHitAt = 0;
    player.knockbackVx = 0;
    player.lastDamagedAt = Date.now(); // prevent regen immediately after respawn
    player.standingSince = Date.now();
    player._regenAccumHp = 0;
    player._regenAccumMp = 0;

    // ── Resolve return map (town or self) ──
    const returnMapId = getDeathReturnMapId(this.state.mapId);

    if (returnMapId !== this.state.mapId) {
      // Cross-map respawn: persist and send the client a travel message.
      this.persistPlayer(player);
      const client = this.findClientByPlayer(player);
      if (client) {
        client.send(MessageType.TRAVEL, {
          mapId: returnMapId,
          spawnId: "playerSpawn",
        } satisfies TravelPayload);
      }
    } else {
      // Same-map respawn: just reposition.
      player.x = this.map.playerSpawn.x;
      player.y = this.map.playerSpawn.y;
    }
  }

  // ─── Loot ─────────────────────────────────────────────────────────────────
  private spawnLoot(
    defId: string,
    tier: ReturnType<typeof rollPotential>,
    x: number,
    y: number,
    killerSessionId?: string,
  ): void {
    // ── Ground drop cap: evict the oldest drop if we've hit the limit ──
    if (this.state.loot.size >= MAX_LOOT_PER_MAP) {
      let oldestUid = "";
      let lowestTimer = Infinity;
      for (const [uid, d] of this.state.loot) {
        if (d.despawnTimer < lowestTimer) {
          lowestTimer = d.despawnTimer;
          oldestUid = uid;
        }
      }
      if (oldestUid) this.state.loot.delete(oldestUid);
    }

    const uid = `loot_${++this.idCounter}`;
    const drop = new LootDrop();
    drop.uid = uid;
    drop.defId = defId;
    drop.potentialTier = tier;
    drop.lines = lineCountForTier(tier);
    drop.x = x + (Math.random() - 0.5) * 24;
    drop.y = y;
    drop.legendary = isMintWorthy(tier);
    drop.despawnTimer = LOOT_DESPAWN_MS;

    // Ownership window: killer (and their party) get exclusive pickup rights.
    if (killerSessionId) {
      drop.ownerSessionId = killerSessionId;
      drop.ownershipExpiresAt = Date.now() + LOOT_OWNERSHIP_MS;
    }

    this.state.loot.set(uid, drop);

    if (drop.legendary) {
      console.log(`[MapRoom] ✨ LEGENDARY drop: ${defId} (${tier})`);
    }
  }

  /** Check whether a player may pick up a specific drop (ownership + party). */
  private canLoot(sessionId: string, charId: string, drop: LootDrop): boolean {
    // Ownership window expired (or never set) — FFA.
    if (!drop.ownerSessionId || Date.now() >= drop.ownershipExpiresAt) return true;
    // Direct owner.
    if (sessionId === drop.ownerSessionId) return true;
    // Party member of the owner.
    const ownerPlayer = this.state.players.get(drop.ownerSessionId);
    if (!ownerPlayer) return true; // Owner gone — FFA.
    return partyManager.areInSameParty(charId, ownerPlayer.charId);
  }

  private handlePickup(client: Client, msg: { uid: string }): void {
    const player = this.state.players.get(client.sessionId);
    const drop = msg && this.state.loot.get(msg.uid);
    if (!player || !drop || player.dead) return;

    const dist = Math.hypot(drop.x - player.x, drop.y - player.y);
    if (dist > PICKUP_RANGE) return;

    // Ownership window check: killer (and their party) get exclusive rights.
    if (!this.canLoot(client.sessionId, player.charId, drop)) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "System",
        text: "Not your drop yet.",
      });
      return;
    }

    // Party loot rule check.
    if (!partyManager.canPickup(player.charId)) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: "Cannot pick up: not your turn.",
      });
      return;
    }

    // ── Capacity check (server-authoritative) ─────────────────────────────
    const targetTab = tabForItem(drop.defId);
    const maxStack = MAX_STACK[targetTab];
    if (maxStack === 1) {
      // Non-stackable: needs an empty slot
      const used = this.countTabEntries(player, targetTab);
      if (used >= TAB_CAPACITY[targetTab]) {
        client.send(MessageType.CHAT, {
          sessionId: "",
          name: "System",
          text: `${targetTab} inventory is full. Drop remains on the ground.`,
        });
        return;
      }
    } else {
      // Stackable: check if any existing stack has room, or if empty slots exist
      let spaceAvailable = 0;
      player.inventory.forEach((item) => {
        if (item.defId === drop.defId) spaceAvailable += maxStack - (item.count || 1);
      });
      const used = this.countTabEntries(player, targetTab);
      spaceAvailable += (TAB_CAPACITY[targetTab] - used) * maxStack;
      if (spaceAvailable < 1) {
        client.send(MessageType.CHAT, {
          sessionId: "",
          name: "System",
          text: `${targetTab} inventory is full. Drop remains on the ground.`,
        });
        return;
      }
    }

    // ── Try to stack onto an existing entry (stackable items) ────────────
    if (maxStack > 1) {
      let stacked = false;
      player.inventory.forEach((existing, uid) => {
        if (stacked) return;
        if (existing.defId === drop.defId && (existing.count || 1) < maxStack) {
          existing.count = (existing.count || 1) + 1;
          // Persist updated count.
          const rec = accountStore.getItem(player.charId, uid);
          if (rec) {
            rec.count = existing.count;
            const char = accountStore.getCharacter(player.charId);
            if (char) {
              accountStore.updateCharacter(player.charId, {
                inventory: { ...char.inventory },
              });
            }
          }
          stacked = true;
        }
      });
      if (stacked) {
        this.state.loot.delete(drop.uid);
        partyManager.onPickup(player.charId);
        if (progressObjectives(player.questState, "collect", drop.defId, 1)) {
          sendQuestUpdate(client, player.questState);
        }
        player.totalItemsCollected += 1;
        accountStore.incrementLifetimeCounter(player.charId, "totalItemsCollected", 1);
        this.processAchievementUnlocks(
          player,
          updateAchievementProgress(player.achievements, "items_collected", 1),
        );
        return;
      }
    }

    // ── Create new inventory entry ──────────────────────────────────────
    const item = new InventoryItem();
    item.uid = `item_${++this.idCounter}`;
    item.defId = drop.defId;
    item.potentialTier = drop.potentialTier;
    item.lines = drop.lines;
    item.baseRank = "NORMAL";
    // Generate potential bonus lines for this item.
    const potentials = rollPotentialLines(
      drop.potentialTier as import("@maple/shared").PotentialTier,
    );
    item.potentialLines = JSON.stringify(potentials);
    item.count = 1;
    player.inventory.set(item.uid, item);

    // Write the item through to the durable character so it can be sold on the Free Market.
    accountStore.addItem(player.charId, {
      uid: item.uid,
      defId: item.defId,
      baseRank: item.baseRank,
      potentialTier: item.potentialTier,
      lines: item.lines,
      minted: false,
      potentialLines: potentials,
    });

    if (drop.legendary) {
      // Record for Phase 2: only the authoritative server can append a mint authorization.
      this.pendingMints.push({
        session: client.sessionId,
        itemUid: item.uid,
        defId: item.defId,
        tier: drop.potentialTier,
      });
      console.log(
        `[MapRoom] legendaryMintPending: ${item.uid} (${item.defId}) for ${client.sessionId} → Phase 2 chain mint`,
      );
    }

    this.state.loot.delete(drop.uid);

    // Advance round-robin if using that loot rule.
    partyManager.onPickup(player.charId);

    // Progress collect objectives for active quests.
    if (progressObjectives(player.questState, "collect", item.defId, 1)) {
      sendQuestUpdate(client, player.questState);
    }
    // ── Achievements: items_collected ────────────────────────────────────
    player.totalItemsCollected += 1;
    accountStore.incrementLifetimeCounter(player.charId, "totalItemsCollected", 1);
    this.processAchievementUnlocks(
      player,
      updateAchievementProgress(player.achievements, "items_collected", 1),
    );
  }

  // ─── Mobs ─────────────────────────────────────────────────────────────────
  // Initial spawning and respawning handled by SpawnManager (see spawnManager.ts).

  private tickMob(mob: Mob, dt: number): void {
    if (mob.hitTimer > 0) {
      mob.hitTimer -= dt;
      if (mob.hitTimer <= 0) mob.hit = false;
    }
    // ── Knockback slide (decays toward 0, applied after gravity snap) ──
    if (mob.knockbackTimer > 0) {
      mob.knockbackTimer -= dt;
      if (mob.knockbackTimer <= 0) {
        mob.knockbackVx = 0;
        mob.knockbackTimer = 0;
      }
    }
    if (mob.attackCooldown > 0) mob.attackCooldown -= dt;

    // Tick active status effects (debuffs, DoT, stun, slow).
    if (mob.activeEffects.length > 0) {
      const result = tickEffects(mob.activeEffects, dt, mob.effectElapsed);
      mob.activeEffects = result.active;
      if (result.hpDelta !== 0 && !mob.dead) {
        mob.hp = Math.max(0, mob.hp + result.hpDelta);
        // Flash a combat number for DoT damage so clients see it.
        if (result.hpDelta < 0) {
          mob.hit = true;
          mob.hitTimer = 120;
        }
        if (mob.hp <= 0) {
          // DoT killed the mob — find the last source player to credit the kill.
          const killer = this.findPlayerByEffectSource(mob);
          if (killer) {
            this.killMob(mob, killer);
          } else {
            mob.dead = true;
            mob.hp = 0;
            this.spawnManager.onMobDeath(mob.instanceId);
            this.spawnManager.removeDeadMob(mob.instanceId);
          }
        }
      }
    }
    // Sync the stun flag so the client can render a stun visual on the mob sprite.
    mob.stunned = isStunned(mob.activeEffects);

    // Stun: mob cannot act (skip AI, movement, and gravity).
    if (isStunned(mob.activeEffects)) return;

    if (mob.dead) return;

    // Compute effective speed multiplier from slow debuffs.
    const speedMult = getSlowMultiplier(mob.activeEffects);

    const def = getMobDef(mob.mobId);
    if (!def) return;

    const fh = this.map.footholds.find((f) => f.id === mob.footholdId);
    if (!fh) return;
    const minX = Math.min(fh.x1, fh.x2);
    const maxX = Math.max(fh.x1, fh.x2);

    // Save horizontal position before AI + knockback movement for wall check.
    const prevMobX = mob.x;

    // ── AI state machine ──
    switch (mob.aiState) {
      case "idle":
      case "wander":
        this.tickMobWander(mob, def, fh, minX, maxX, dt, speedMult);
        break;
      case "aggro":
      case "chase":
        this.tickMobChase(mob, def, fh, minX, maxX, dt, speedMult);
        break;
      case "attack":
        this.tickMobAttack(mob, def, dt);
        break;
    }

    // Gravity — snap to foothold surface (flyers skip this).
    if (def.behavior !== "flyer") {
      if (!mob.grounded) {
        mob.vy = Math.min(mob.vy + MOB_MOB_GRAVITY, MOB_MAX_FALL);
        mob.y += mob.vy;
      }
      const surfaceY = groundYAt(fh, mob.x);
      if (mob.y >= surfaceY) {
        mob.y = surfaceY;
        mob.vy = 0;
        mob.grounded = true;
      }
    } else {
      // Flyers always stay "grounded" so they don't fall, but don't snap to surface.
      mob.grounded = true;
    }

    // ── Knockback: apply horizontal slide then decay ──
    if (mob.knockbackVx !== 0) {
      mob.x += mob.knockbackVx;
      mob.x = clamp(mob.x, 0, this.map.width);
      mob.knockbackVx *= KNOCKBACK_DECAY;
      if (Math.abs(mob.knockbackVx) < 0.3) mob.knockbackVx = 0;
    }

    // ── Wall collision (after all horizontal movement) ──
    if (this.map.walls?.length) {
      mob.x = clampXByWalls(this.map.walls, prevMobX, mob.x, mob.y);
    }
  }

  /** Idle / wander: pace randomly within the foothold, scanning for targets. */
  private tickMobWander(
    mob: Mob,
    def: MobDef,
    fh: Foothold,
    minX: number,
    maxX: number,
    dt: number,
    speedMult: number,
  ): void {
    // Scan for aggro targets.
    const target = this.findNearestAlivePlayer(mob);
    if (target) {
      const dx = Math.abs(mob.x - target.player.x);

      const dy = Math.abs(mob.y - target.player.y);
      if (dx <= mob.aggroRange && dy <= MOB_AI_VERT_TOLERANCE) {
        mob.aiState = "chase";
        mob.targetSessionId = target.sessionId;
        mob.facing = target.player.x >= mob.x ? 1 : -1;
        return;
      }
    }

    // Wander pacing.
    mob.wanderTimer -= dt;
    if (mob.wanderTimer <= 0) {
      mob.wanderDir = [-1, 0, 0, 1][Math.floor(Math.random() * 4)];
      mob.wanderTimer = 800 + Math.random() * 1600;
      if (mob.wanderDir !== 0) mob.facing = mob.wanderDir;
    }
    if (mob.wanderDir !== 0) {
      mob.x += mob.wanderDir * def.speed * speedMult;
      if (mob.x <= minX || mob.x >= maxX) {
        mob.x = clamp(mob.x, minX, maxX);
        mob.wanderDir *= -1;
        mob.facing = mob.wanderDir;
      }
    }
  }

  /** Chase: move toward the target player. Transition to attack when close enough. */
  private tickMobChase(
    mob: Mob,
    def: MobDef,
    fh: Foothold,
    minX: number,
    maxX: number,
    dt: number,
    speedMult: number,
  ): void {
    const target = mob.targetSessionId ? this.state.players.get(mob.targetSessionId) : undefined;
    const behavior: MobBehavior = def.behavior ?? "melee";

    // De-aggro: target gone, dead, or out of range.
    if (!target || target.dead) {
      this.mobReturnToIdle(mob);
      return;
    }

    const dx = target.x - mob.x;
    const dy = target.y - mob.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Flyers use a larger vertical tolerance (they move in 2D).
    const vertTolerance = behavior === "flyer" ? 400 : MOB_AI_VERT_TOLERANCE;

    if (absDx > mob.deaggroRange || absDy > vertTolerance) {
      this.mobReturnToIdle(mob);
      return;
    }

    // Face the target.
    mob.facing = dx >= 0 ? 1 : -1;

    // ── Behavior-specific chase logic ──

    if (behavior === "flyer") {
      // Flyers move freely in 2D toward the player (ignore foothold bounds).
      const chaseSpeed = def.speed * MOB_AI_CHASE_SPEED_MULT * speedMult;
      const dist = Math.hypot(dx, dy);
      if (dist > mob.attackRange) {
        mob.x += (dx / dist) * chaseSpeed;
        mob.y += (dy / dist) * chaseSpeed;
      } else {
        mob.aiState = "attack";
        mob.wanderDir = 0;
      }
      return;
    }

    if (behavior === "ranged") {
      // Ranged mobs try to stay at attack range; if too close, back up; if too far, approach.
      if (absDx <= mob.attackRange && absDy <= MOB_AI_VERT_TOLERANCE) {
        mob.aiState = "attack";
        mob.wanderDir = 0;
        return;
      }
      const chaseSpeed = def.speed * MOB_AI_CHASE_SPEED_MULT * speedMult;
      mob.wanderDir = dx >= 0 ? 1 : -1;
      mob.x += mob.wanderDir * chaseSpeed;
      // Don't walk off the platform edge.
      mob.x = clamp(mob.x, minX, maxX);
      return;
    }

    if (behavior === "exploder") {
      // Exploders rush toward the player at high speed.
      if (absDx <= mob.attackRange && absDy <= MOB_AI_VERT_TOLERANCE) {
        mob.aiState = "attack";
        mob.wanderDir = 0;
        return;
      }
      const chaseSpeed = def.speed * EXPLODER_RUSH_SPEED_MULT * speedMult;
      mob.wanderDir = dx >= 0 ? 1 : -1;
      mob.x += mob.wanderDir * chaseSpeed;
      mob.x = clamp(mob.x, minX, maxX);
      return;
    }

    if (behavior === "caster") {
      // Casters keep distance and attack when within range.
      if (absDx <= mob.attackRange && absDy <= MOB_AI_VERT_TOLERANCE) {
        mob.aiState = "attack";
        mob.wanderDir = 0;
        return;
      }
      const chaseSpeed = def.speed * MOB_AI_CHASE_SPEED_MULT * speedMult;
      mob.wanderDir = dx >= 0 ? 1 : -1;
      mob.x += mob.wanderDir * chaseSpeed;
      mob.x = clamp(mob.x, minX, maxX);
      return;
    }

    // Default melee chase (unchanged).
    // Within attack range? Transition to attack.
    if (absDx <= mob.attackRange && absDy <= MOB_AI_VERT_TOLERANCE) {
      mob.aiState = "attack";
      mob.wanderDir = 0;
      return;
    }

    // Move toward the player along the platform.
    const chaseSpeed = def.speed * MOB_AI_CHASE_SPEED_MULT * speedMult;
    mob.wanderDir = dx >= 0 ? 1 : -1;
    mob.x += mob.wanderDir * chaseSpeed;

    // Don't walk off the platform edge — clamp.
    if (mob.x <= minX || mob.x >= maxX) {
      mob.x = clamp(mob.x, minX, maxX);
      mob.wanderDir = 0;
    }
  }

  /** Attack: deal damage to the target when on cooldown. Behavior-specific. */
  private tickMobAttack(mob: Mob, def: MobDef, dt: number): void {
    const behavior: MobBehavior = def.behavior ?? "melee";
    // Apply elite scaling to attack damage only (wander/chase use speed which is unchanged).
    const effectiveDef = mob.isElite ? (getEffectiveMobDef(def, true) ?? def) : def;
    const target = mob.targetSessionId ? this.state.players.get(mob.targetSessionId) : undefined;

    // De-aggro: target gone or dead.
    if (!target || target.dead) {
      this.mobReturnToIdle(mob);
      return;
    }

    const dx = target.x - mob.x;
    const absDx = Math.abs(dx);
    const dy = Math.abs(target.y - mob.y);
    const vertTolerance = behavior === "flyer" ? 400 : MOB_AI_VERT_TOLERANCE;

    // If target moved out of chase range, chase again.
    if (absDx > mob.attackRange * 1.8 || dy > vertTolerance) {
      mob.aiState = "chase";
      return;
    }

    // De-aggro if out of deaggro range.
    if (absDx > mob.deaggroRange || dy > vertTolerance) {
      this.mobReturnToIdle(mob);
      return;
    }

    // ── Ranged: fire a projectile ──
    if (behavior === "ranged") {
      if (mob.attackCooldown <= 0) {
        this.spawnMobProjectile(mob, effectiveDef, target, "ranged");
        mob.attackCooldown = effectiveDef.projectileCooldownMs ?? 1500;
      }
      return;
    }

    // ── Caster: telegraph then AoE ──
    if (behavior === "caster") {
      // If currently telegraphing, count down and fire when ready.
      if (mob.bossTelegraph !== "") {
        mob._casterTelegraphTimer = (mob._casterTelegraphTimer ?? 0) - dt;
        if (mob._casterTelegraphTimer <= 0) {
          mob.bossTelegraph = "";
          mob._casterTelegraphTimer = 0;
          this.mobCasterAoE(mob, effectiveDef);
          mob.attackCooldown = effectiveDef.casterCooldownMs ?? 2000;
        }
        return;
      }
      // Start telegraph on cooldown.
      if (mob.attackCooldown <= 0) {
        const telegraphMs = effectiveDef.casterTelegraphMs ?? 800;
        mob.bossTelegraph = "caster_aoe";
        mob._casterTelegraphTimer = telegraphMs;
        mob.attackCooldown = telegraphMs + (effectiveDef.casterCooldownMs ?? 2000);
      }
      return;
    }

    // ── Exploder: rush + self-destruct AoE ──
    if (behavior === "exploder") {
      if (mob.attackCooldown <= 0) {
        const detRange = effectiveDef.exploderDetonateRange ?? 30;
        if (absDx <= detRange && dy <= vertTolerance) {
          // Detonate!
          this.mobExploderDetonate(mob, effectiveDef);
          return;
        }
      }
      // Player moved out of detonation range — chase again.
      mob.aiState = "chase";
      return;
    }

    // Default melee attack on cooldown.
    if (mob.attackCooldown <= 0) {
      this.mobAttackPlayer(mob, effectiveDef, target);
      mob.attackCooldown = effectiveDef.attackCooldownMs ?? MOB_AI_DEFAULT_ATTACK_COOLDOWN_MS;
    }
  }

  /** Resolve mob → player damage through the shared combat engine. */
  private mobAttackPlayer(mob: Mob, def: MobDef, player: Player): void {
    const mobAtk = def.attackDamage ?? MOB_AI_DEFAULT_ATTACK_DAMAGE;
    const mobLevel = def.level;

    // Build attacker stats for the mob.
    const attacker: AttackerCombatStats = {
      atk: mobAtk,
      mAtk: 0,
      primaryStat: mobLevel * 2,
      skillDamagePercent: 100,
      hitCount: 1,
      accuracy: mobLevel * 5 + 10,
      critRate: 0.05,
      level: mobLevel,
    };

    // Build defender stats from the player's current state.
    const defender: DefenderCombatStats = {
      wDef: this.playerEffectiveWDef(player),
      mDef: this.playerEffectiveMDef(player),
      avoid: player.dex + player.luk,
      level: player.level,
    };

    const result = computeDamage(attacker, defender);
    if (!result.hit || result.total <= 0) return;

    this.damagePlayer(player, result.total);

    // Broadcast hit to all clients for damage number / flash.
    this.broadcast("mob_hit_player", {
      mobId: mob.mobId,
      sessionId: this.findSessionByPlayer(player),
      damage: result.total,
      crit: result.crit,
      hp: player.hp,
      dead: player.dead,
    });

    // Apply mob debuff (stun/slow/poison) to the player on hit.
    if (def.debuffEffect) {
      const debuffs = skillDebuffToStatusEffects(def.id, def.debuffEffect, def.name);
      for (const debuff of debuffs) {
        player.activeEffects = applyEffect(player.activeEffects, debuff);
        player.effectElapsed.set(debuff.id, 0);
      }
      this.syncPlayerEffects(player);
    }
  }

  /** Compute the player's effective physical defence from equipped gear + set bonuses + flame stats. */
  private playerEffectiveWDef(player: Player): number {
    const equippedRec = Object.fromEntries(player.equipped.entries());
    let wDef = 0;
    for (const uid of Object.values(equippedRec)) {
      const item = player.inventory.get(uid);
      const def = item ? getItemDef(item.defId) : undefined;
      if (def) wDef += def.wDef ?? 0;
      // Flame bonus stats can roll WDEF.
      if (item?.bonusStats) {
        try {
          const flames = JSON.parse(item.bonusStats) as import("@maple/shared").BonusStatLine[];
          for (const bs of flames) {
            if (bs.stat === "WDEF") wDef += bs.value;
          }
        } catch {
          /* ignore */
        }
      }
    }
    const equippedDefIds = Object.values(equippedRec)
      .map((uid) => {
        const item = player.inventory.get(uid);
        return item ? getItemDef(item.defId)?.id : undefined;
      })
      .filter((id): id is string => id !== undefined);
    wDef += computeSetBonuses(equippedDefIds).wDef;
    return wDef;
  }

  /** Compute the player's effective magical defence from equipped gear + set bonuses + flame stats. */
  private playerEffectiveMDef(player: Player): number {
    const equippedRec = Object.fromEntries(player.equipped.entries());
    let mDef = 0;
    for (const uid of Object.values(equippedRec)) {
      const item = player.inventory.get(uid);
      const def = item ? getItemDef(item.defId) : undefined;
      if (def) mDef += def.mDef ?? 0;
      // Flame bonus stats can roll MDEF.
      if (item?.bonusStats) {
        try {
          const flames = JSON.parse(item.bonusStats) as import("@maple/shared").BonusStatLine[];
          for (const bs of flames) {
            if (bs.stat === "MDEF") mDef += bs.value;
          }
        } catch {
          /* ignore */
        }
      }
    }
    const equippedDefIds = Object.values(equippedRec)
      .map((uid) => {
        const item = player.inventory.get(uid);
        return item ? getItemDef(item.defId)?.id : undefined;
      })
      .filter((id): id is string => id !== undefined);
    mDef += computeSetBonuses(equippedDefIds).mDef;
    return mDef;
  }

  /** Reset mob to idle state at its spawn position. */
  private mobReturnToIdle(mob: Mob): void {
    mob.aiState = "idle";
    mob.targetSessionId = "";
    mob.wanderDir = 0;
    mob.wanderTimer = Math.random() * 500;
  }

  // ─── Behavior: Projectile / Caster AoE / Exploder ────────────────────────

  /** Spawn a mob-fired projectile aimed at a target player. */
  private spawnMobProjectile(mob: Mob, def: MobDef, target: Player, kind: string): void {
    const dx = target.x - mob.x;
    const dy = target.y - mob.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = PROJECTILE_SPEED;

    const proj = new Projectile();
    proj.id = `proj_${++this.idCounter}`;
    proj.ownerId = mob.instanceId;
    proj.ownerMobId = mob.mobId;
    proj.x = mob.x;
    proj.y = mob.y - 10; // fire from chest height
    proj.vx = (dx / dist) * speed;
    proj.vy = (dy / dist) * speed;
    proj.facing = mob.facing;
    proj.damage = def.projectileDamage ?? MOB_AI_DEFAULT_ATTACK_DAMAGE;
    proj.kind = kind;
    proj.dead = false;
    proj.lifetime = PROJECTILE_LIFETIME_MS;

    this.state.projectiles.set(proj.id, proj);
  }

  /** Caster AoE: deal damage to all players within range. */
  private mobCasterAoE(mob: Mob, def: MobDef): void {
    const dmg = def.casterDamage ?? MOB_AI_DEFAULT_ATTACK_DAMAGE;
    this.state.players.forEach((player, sessionId) => {
      if (player.dead) return;
      const dist = Math.hypot(mob.x - player.x, mob.y - player.y);
      if (dist > CASTER_AOE_RADIUS) return;

      const attacker: AttackerCombatStats = {
        atk: dmg,
        mAtk: dmg,
        primaryStat: def.level * 2,
        skillDamagePercent: 100,
        hitCount: 1,
        accuracy: def.level * 5 + 10,
        critRate: 0.1,
        level: def.level,
      };
      const defender: DefenderCombatStats = {
        wDef: this.playerEffectiveWDef(player),
        mDef: this.playerEffectiveMDef(player),
        avoid: player.dex + player.luk,
        level: player.level,
      };
      const result = computeDamage(attacker, defender);
      if (!result.hit || result.total <= 0) return;

      this.damagePlayer(player, result.total);
      this.broadcast("mob_hit_player", {
        mobId: mob.mobId,
        sessionId,
        damage: result.total,
        crit: result.crit,
        hp: player.hp,
        dead: player.dead,
      });

      // Apply caster debuff.
      if (def.casterDebuffEffect) {
        const debuffs = skillDebuffToStatusEffects(def.id, def.casterDebuffEffect, def.name);
        for (const debuff of debuffs) {
          player.activeEffects = applyEffect(player.activeEffects, debuff);
          player.effectElapsed.set(debuff.id, 0);
        }
        this.syncPlayerEffects(player);
      }
    });
  }

  /** Exploder self-destruct: deal AoE damage to all nearby players, then die. */
  private mobExploderDetonate(mob: Mob, def: MobDef): void {
    const dmg = def.exploderDamage ?? 15;
    this.state.players.forEach((player, sessionId) => {
      if (player.dead) return;
      const dist = Math.hypot(mob.x - player.x, mob.y - player.y);
      if (dist > EXPLODER_AOE_RADIUS) return;

      const attacker: AttackerCombatStats = {
        atk: dmg,
        mAtk: 0,
        primaryStat: def.level * 2,
        skillDamagePercent: 100,
        hitCount: 1,
        accuracy: def.level * 5 + 10,
        critRate: 0.05,
        level: def.level,
      };
      const defender: DefenderCombatStats = {
        wDef: this.playerEffectiveWDef(player),
        mDef: this.playerEffectiveMDef(player),
        avoid: player.dex + player.luk,
        level: player.level,
      };
      const result = computeDamage(attacker, defender);
      if (!result.hit || result.total <= 0) return;

      this.damagePlayer(player, result.total);
      this.broadcast("mob_hit_player", {
        mobId: mob.mobId,
        sessionId,
        damage: result.total,
        crit: result.crit,
        hp: player.hp,
        dead: player.dead,
      });
    });

    // Self-destruct: kill the mob.
    mob.hp = 0;
    mob.dead = true;
    mob.hit = true;
    mob.hitTimer = 120;
    // Broadcast explosion event for client VFX.
    this.broadcast("mob_explode", {
      mobId: mob.mobId,
      x: mob.x,
      y: mob.y,
      radius: EXPLODER_AOE_RADIUS,
    });
    // Credit kill to the targeted player (or just remove).
    if (mob.targetSessionId) {
      const killer = this.state.players.get(mob.targetSessionId);
      if (killer && !killer.dead) {
        this.killMob(mob, killer);
      } else {
        this.spawnManager.onMobDeath(mob.instanceId);
        this.spawnManager.removeDeadMob(mob.instanceId);
      }
    } else {
      this.spawnManager.onMobDeath(mob.instanceId);
      this.spawnManager.removeDeadMob(mob.instanceId);
    }
  }

  // ─── Projectile tick ─────────────────────────────────────────────────────

  /** Move all active projectiles, check player collisions, expire stale ones. */
  private tickProjectiles(dt: number): void {
    const toRemove: string[] = [];
    for (const [key, proj] of this.state.projectiles.entries()) {
      if (proj.dead) {
        toRemove.push(key);
        continue;
      }

      // Move.
      proj.x += proj.vx;
      proj.y += proj.vy;

      // Lifetime expiry.
      proj.lifetime -= dt;
      if (proj.lifetime <= 0) {
        proj.dead = true;
        toRemove.push(key);
        continue;
      }

      // Collision check: hit the first alive player within radius.
      let hitSomeone = false;
      this.state.players.forEach((player, sessionId) => {
        if (hitSomeone || player.dead) return;
        if (proj.hitSessionIds.has(sessionId)) return;
        const dist = Math.hypot(proj.x - player.x, proj.y - player.y);
        if (dist > PROJECTILE_HIT_RADIUS) return;

        // Apply damage through the combat engine.
        const mobDef = getMobDef(proj.ownerMobId);
        const attacker: AttackerCombatStats = {
          atk: proj.damage,
          mAtk: proj.kind === "caster" ? proj.damage : 0,
          primaryStat: (mobDef?.level ?? 1) * 2,
          skillDamagePercent: 100,
          hitCount: 1,
          accuracy: (mobDef?.level ?? 1) * 5 + 10,
          critRate: 0.08,
          level: mobDef?.level ?? 1,
        };
        const defender: DefenderCombatStats = {
          wDef: this.playerEffectiveWDef(player),
          mDef: this.playerEffectiveMDef(player),
          avoid: player.dex + player.luk,
          level: player.level,
        };
        const result = computeDamage(attacker, defender);
        if (!result.hit || result.total <= 0) return;

        this.damagePlayer(player, result.total);
        this.broadcast("mob_hit_player", {
          mobId: proj.ownerMobId,
          sessionId,
          damage: result.total,
          crit: result.crit,
          hp: player.hp,
          dead: player.dead,
        });
        proj.hitSessionIds.add(sessionId);
        hitSomeone = true;
        proj.dead = true;
        toRemove.push(key);
      });

      // Remove if out of map bounds.
      if (
        proj.x < -50 ||
        proj.x > this.map.width + 50 ||
        proj.y < -200 ||
        proj.y > this.map.height + 200
      ) {
        proj.dead = true;
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.state.projectiles.delete(key);
    }
  }

  /** Broadcast boss HP bar updates to all clients every tick. */
  private broadcastBossHp(): void {
    if (!this.bossManager.hasActiveEncounters()) return;
    for (const [instanceId, mob] of this.state.mobs.entries()) {
      if (mob.dead) continue;
      const enc = this.bossManager.getEncounter(instanceId);
      if (!enc) continue;
      const def = getMobDef(mob.mobId);
      if (!def) continue;
      this.broadcast("boss_hp", {
        instanceId,
        mobId: mob.mobId,
        name: def.name,
        hp: mob.hp,
        maxHp: mob.maxHp,
        phase: enc.phase,
      });
    }
  }

  /** Send exploration sync to a single client. */
  private sendExplorationSync(client: Client, player: import("./schema/Player").Player): void {
    const maxSlots = maxExplorationSlots(player.codex);
    const registeredCount = registeredCodexEntries(player.codex);
    client.send(MessageType.EXPLORATION_SYNC, {
      slots: player.exploration.slots.map((s) => ({
        slotIndex: s.slotIndex,
        mobId: s.mobId,
        startAt: s.startAt,
        duration: s.duration,
        durationMs: s.durationMs,
        completeAt: s.completeAt,
        claimed: s.claimed,
      })),
      maxSlots,
      registeredCount,
    } satisfies ExplorationSyncPayload);
  }

  // ─── Scheduled transport departure loop ─────────────────────────────────────
  /**
   * Runs every ~1 s (60 ticks at 60 fps).
   *
   * 1. Broadcasts a TRANSPORT_STATUS countdown to every boarded player so the
   *    client can show a live "wait at the dock" timer.
   * 2. Detects the boarding→departing boundary crossing and teleports all
   *    boarded players simultaneously (the iconic ferry departure ritual).
   */
  private processScheduledDepartures(): void {
    const now = Date.now();
    for (const portal of this.map.portals) {
      if (!portal.schedule) continue;

      const phase = (now - this.transportEpoch) % portal.schedule.intervalMs;
      const prev = this.prevPhase.get(portal.id) ?? phase;
      this.prevPhase.set(portal.id, phase);

      const boarded = this.boardingByPortal.get(portal.id);
      const inWindow = phase < portal.schedule.windowMs;

      // ── Live countdown broadcast while boarding window is open ──
      if (inWindow && boarded && boarded.length > 0) {
        const departInMs = portal.schedule.windowMs - phase;
        const statusPayload: TransportStatusPayload = {
          portalLabel: portal.label,
          departInMs,
          boardedCount: boarded.length,
          portalId: portal.id,
        };
        for (const sid of boarded) {
          const c = this.clients.find((cl) => cl.sessionId === sid);
          if (c) c.send(MessageType.TRANSPORT_STATUS, statusPayload);
        }
      }

      // ── Detect boundary crossing: was inside boarding window, now outside ──
      if (prev < portal.schedule.windowMs && !inWindow) {
        if (boarded && boarded.length > 0) {
          console.log(`[MapRoom] 🚢 ${portal.label} departing with ${boarded.length} passenger(s)`);
          for (const sid of boarded) {
            const c = this.clients.find((cl) => cl.sessionId === sid);
            if (c) {
              const p = this.state.players.get(sid);
              if (p && !p.dead) {
                this.persistPlayer(p);
                // Signal departure before teleporting (client shows departure toast).
                c.send(MessageType.TRANSPORT_DEPARTED, {
                  portalLabel: portal.label,
                  mapId: portal.toMapId,
                });
                c.send(MessageType.TRAVEL, {
                  mapId: portal.toMapId,
                  spawnId: portal.toSpawnId ?? "playerSpawn",
                } satisfies TravelPayload);
              }
            }
          }
          boarded.length = 0;
        }
      }
    }
  }

  /** Handle player using a summon item (e.g. balrog talisman) to spawn a boss. */
  private handleUseSummonItem(client: Client, msg: { itemId: string }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    const bossDefId = SUMMON_BOSSES_BY_ITEM.get(msg.itemId);
    if (!bossDefId) return;
    // Find and remove the summon item from inventory.
    let foundUid = "";
    for (const [uid, item] of player.inventory.entries()) {
      if (item.defId === msg.itemId) {
        foundUid = uid;
        break;
      }
    }
    if (!foundUid) return;
    player.inventory.delete(foundUid);
    // Spawn the boss near the player.
    const instanceId = this.bossManager.summonBoss(
      bossDefId,
      this.state,
      this.map,
      player.x + 60,
      player.y,
      player.grounded ? 0 : 0,
      () => ++this.idCounter,
    );
    if (instanceId) {
      this.broadcast("boss_spawn", {
        instanceId,
        mobId: bossDefId,
        name: getMobDef(bossDefId)?.name ?? bossDefId,
      });
    }
  }

  // ─── Unstuck / Return to Town ─────────────────────────────────────────────
  /**
   * Teleport the player to their current map's playerSpawn — the guaranteed safe
   * entry point. Handles bad footholds, out-of-bounds, dead-ends, and any other
   * stuck state. Cooldown-gated to prevent abuse.
   *
   * Works on every shipped map because every GameMap defines a playerSpawn.
   */
  private handleUnstuckAction(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Cooldown check.
    const now = Date.now();
    const last = this.lastUnstuckAt.get(client.sessionId) ?? 0;
    const elapsed = now - last;
    if (elapsed < UNSTUCK_COOLDOWN_MS) {
      const remainingSec = Math.ceil((UNSTUCK_COOLDOWN_MS - elapsed) / 1000);
      client.send(MessageType.UNSTUCK_ACTION, {
        success: false,
        message: `Please wait ${remainingSec}s before using unstuck again.`,
        cooldownRemaining: remainingSec,
      } satisfies UnstuckResultPayload);
      return;
    }

    // Resolve the safe spawn from the current map geometry.
    const spawn = this.map.playerSpawn;

    // Reset velocity so the player doesn't continue falling after teleport.
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.grounded = true;
    player.knockbackVx = 0;
    player.climbing = false;
    player.ladderId = -1;

    // Record cooldown.
    this.lastUnstuckAt.set(client.sessionId, now);

    // Persist so the safe position survives a crash.
    this.persistPlayer(player);

    client.send(MessageType.UNSTUCK_ACTION, {
      success: true,
      message: "Teleported to town. Stay safe out there!",
      cooldownRemaining: 0,
    } satisfies UnstuckResultPayload);
  }

  // ─── Portals ──────────────────────────────────────────────────────────────
  /**
   * When a player presses interact near a portal, fire the USE_PORTAL flow.
   * This is called from both the message handler and the edge-triggered tick check.
   */
  private handlePortalUse(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    this.checkPortalProximity(player, client);
  }

  /**
   * Check if the player is near a portal and process the use.
   * If a client is provided the result is sent directly; otherwise broadcast from tick.
   */
  private checkPortalProximity(player: Player, client?: Client): void {
    // Find the nearest portal within range.
    let nearest: Portal | undefined;
    let bestDist = Infinity;
    for (const portal of this.map.portals) {
      const dx = Math.abs(portal.x - player.x);
      const dy = Math.abs(portal.y - player.y);
      if (dx > PORTAL_RANGE_X || dy > PORTAL_RANGE_Y) continue;
      const dist = dx + dy;
      if (dist < bestDist) {
        bestDist = dist;
        nearest = portal;
      }
    }
    if (!nearest) return;

    // Coming-soon gate: block if the destination zone is not yet available.
    if (nearest.comingSoon) {
      const c = client ?? this.findClientByPlayer(player);
      if (c) {
        c.send(MessageType.USE_PORTAL, {
          message: `🚧 ${nearest.label} — Coming Soon! This zone is not yet available in the alpha.`,
        } satisfies FerryBlockedPayload);
      }
      return;
    }

    // Level gate: block if below required level.
    if (nearest.requiresLevel && player.level < nearest.requiresLevel) {
      // Find the client for this player if not provided.
      const c = client ?? this.findClientByPlayer(player);
      if (c) {
        c.send(MessageType.USE_PORTAL, {
          message: `You need to be at least level ${nearest.requiresLevel} to use ${nearest.label}.`,
        } satisfies FerryBlockedPayload);
      }
      return;
    }

    // ── Scheduled transport gate ──────────────────────────────────────────────
    if (nearest.schedule) {
      const phase = (Date.now() - this.transportEpoch) % nearest.schedule.intervalMs;
      const inBoardingWindow = phase < nearest.schedule.windowMs;

      if (!inBoardingWindow) {
        const nextMs = nearest.schedule.intervalMs - phase;
        const nextSec = Math.ceil(nextMs / 1000);
        const c2 = client ?? this.findClientByPlayer(player);
        if (c2) {
          c2.send(MessageType.USE_PORTAL, {
            message: `${nearest.label} is not currently boarding. The next departure is in ${nextSec} seconds.`,
          } satisfies FerryBlockedPayload);
        }
        return;
      }

      // Board the player — they will be teleported when the window closes.
      const boardingClient = client ?? this.findClientByPlayer(player);
      if (!boardingClient) return;

      let list = this.boardingByPortal.get(nearest.id);
      if (!list) {
        list = [];
        this.boardingByPortal.set(nearest.id, list);
      }
      if (!list.includes(boardingClient.sessionId)) list.push(boardingClient.sessionId);

      const remainingMs = nearest.schedule.windowMs - phase;
      const remainingSec = Math.ceil(remainingMs / 1000);

      // Send boarding confirmation via USE_PORTAL (legacy float text).
      boardingClient.send(MessageType.USE_PORTAL, {
        message: `Boarding ${nearest.label}… The ship departs in ${remainingSec} seconds.`,
      } satisfies FerryBlockedPayload);

      // Also send the structured transport countdown so the client can show a banner.
      boardingClient.send(MessageType.TRANSPORT_STATUS, {
        portalLabel: nearest.label,
        departInMs: remainingMs,
        boardedCount: list.length,
        portalId: nearest.id,
      } satisfies TransportStatusPayload);
      return;
    }

    // Valid portal use — persist state and send travel message.
    this.persistPlayer(player);
    const c = client ?? this.findClientByPlayer(player);
    if (c) {
      c.send(MessageType.TRAVEL, {
        mapId: nearest.toMapId,
        spawnId: nearest.toSpawnId ?? "playerSpawn",
      } satisfies TravelPayload);
    }
  }

  /** Find the client session that owns a given player. */
  private findClientByPlayer(player: Player): Client | undefined {
    for (const c of this.clients) {
      const p = this.state.players.get(c.sessionId);
      if (p && p.charId === player.charId) return c;
    }
    return undefined;
  }

  /**
   * Process newly completed achievements: grant rewards, persist, and notify the client.
   * Deduplicates by achievement id so a single trigger batch never double-grants.
   */
  private processAchievementUnlocks(player: Player, completedIds: string[]): void {
    if (completedIds.length === 0) return;
    const unique = [...new Set(completedIds)];
    for (const achId of unique) {
      const achDef = ACHIEVEMENTS[achId];
      if (!achDef) continue;
      // Grant mesos reward.
      if (achDef.rewards.mesos) {
        player.mesos += achDef.rewards.mesos;
        accountStore.setMesos(player.charId, player.mesos);
      }
      // Grant EXP reward.
      if (achDef.rewards.exp) {
        grantExp(player, achDef.rewards.exp);
      }
      // Grant title if the achievement awards one and not already owned.
      if (achDef.rewards.title && !player.ownedTitles.includes(achDef.rewards.title)) {
        player.ownedTitles.push(achDef.rewards.title);
        if (!player.equippedTitle) {
          player.equippedTitle = achDef.rewards.title;
        }
        accountStore.updateCharacter(player.charId, {
          ownedTitles: player.ownedTitles,
          equippedTitle: player.equippedTitle,
        });
      }
      // Persist achievement progress.
      accountStore.setAchievements(player.charId, player.achievements);
      // Notify the client.
      const client = this.findClientByPlayer(player);
      if (client) {
        client.send(MessageType.ACHIEVEMENT_UNLOCK, {
          achievementId: achId,
          name: achDef.name,
          description: achDef.description,
          rewards: {
            mesos: achDef.rewards.mesos,
            exp: achDef.rewards.exp,
            title: achDef.rewards.title,
          },
        } satisfies AchievementUnlockPayload);
        if (achDef.rewards.title) {
          client.send(MessageType.TITLE_SYNC, {
            ownedTitles: player.ownedTitles,
            equippedTitle: player.equippedTitle,
          } satisfies TitleSyncPayload);
        }
      }
    }
  }

  /** Find a charId by player name (case-insensitive) from the local room state. */
  private findCharIdByName(name: string): string {
    const lower = name.toLowerCase();
    for (const [, player] of this.state.players) {
      if (player.name.toLowerCase() === lower) return player.charId;
    }
    return "";
  }

  /** Find a local Player object by charId. */
  private findPlayerByCharId(charId: string): Player | undefined {
    for (const [, player] of this.state.players) {
      if (player.charId === charId) return player;
    }
    return undefined;
  }

  /** Find the nearest alive player to a mob (for aggro targeting). */
  private findNearestAlivePlayer(mob: Mob): { sessionId: string; player: Player } | undefined {
    let best: { sessionId: string; player: Player } | undefined;
    let bestDist = Infinity;
    this.state.players.forEach((player, sessionId) => {
      if (player.dead) return;
      const dist = Math.hypot(mob.x - player.x, mob.y - player.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { sessionId, player };
      }
    });
    return best;
  }

  /** Find the session id for a player (for broadcast messages). */
  private findSessionByPlayer(player: Player): string {
    for (const [sessionId, p] of this.state.players.entries()) {
      if (p === player) return sessionId;
    }
    return "";
  }

  /** Find the Player whose name matches a mob's active effect source. */
  private findPlayerByEffectSource(mob: Mob): Player | undefined {
    for (const effect of mob.activeEffects) {
      if (!effect.source) continue;
      for (const [, p] of this.state.players.entries()) {
        if (p.name === effect.source) return p;
      }
    }
    return undefined;
  }

  /** Broadcast the local player's active status effects to their client. */
  private syncPlayerEffects(player: Player): void {
    const sess = this.findSessionByPlayer(player);
    if (!sess) return;
    const client = this.clients.find((c) => c.sessionId === sess);
    if (!client) return;
    client.send(MessageType.STATUS_EFFECTS, {
      effects: player.activeEffects.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.source,
        stacks: e.stacks,
        durationMs: e.durationMs,
        remainingMs: e.durationMs - (player.effectElapsed.get(e.id) ?? 0),
      })),
    });
  }

  // ─── NPC Dialog ────────────────────────────────────────────────────────────
  private handleTalkNpc(client: Client, msg: TalkNpcPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) {
      client.send("npc_error", { reason: "You are dead" });
      return;
    }
    const npcId = msg?.npcId;
    if (!npcId) {
      client.send("npc_error", { reason: "Invalid NPC" });
      return;
    }

    const npc = NPCS[npcId] as NpcDef | undefined;
    if (!npc) {
      client.send("npc_error", { reason: "NPC not found" });
      return;
    }

    // Must be on the same map.
    if (npc.mapId !== this.state.mapId) {
      client.send("npc_error", { reason: "NPC not on this map" });
      return;
    }

    // Range check.
    const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
    if (dist > NPC_INTERACT_RANGE) {
      client.send("npc_error", {
        reason: "Too far away",
        distance: dist,
        range: NPC_INTERACT_RANGE,
      });
      return;
    }

    // Already in a conversation? Ignore (must finish first).
    if (player.dialogNpcId) {
      client.send("npc_error", { reason: "Already in conversation" });
      return;
    }

    // Progress talk objectives for active quests targeting this NPC.
    if (progressObjectives(player.questState, "talk", npcId, 1)) {
      sendQuestUpdate(client, player.questState);
    }

    // Offer quest turn-ins (instead of auto-processing).
    const giverQuests = player.questState.filter(
      (qs) => qs.status === "complete" && QUESTS[qs.questId]?.giverNpcId === npcId,
    );
    if (giverQuests.length > 0) {
      // Offer the first completable quest (one at a time).
      const qs = giverQuests[0];
      const def = qs ? QUESTS[qs.questId] : undefined;
      if (qs && def) {
        player.pendingQuestTurnin = qs.questId;
        // Set dialog NPC so turn-in accept/decline can start dialog afterward.
        player.dialogNpcId = npcId;
        player.dialogNodeIndex = 0;
        client.send("quest_turnin_offer", {
          questId: qs.questId,
          questName: def.name,
          giverNpcId: def.giverNpcId,
          giverNpcName: npc.name,
          rewards: {
            mesos: def.rewards.mesos,
            exp: def.rewards.exp,
            items: def.rewards.items ? [...def.rewards.items] : [],
          },
        } satisfies QuestTurninOfferPayload);
        // Don't send dialog yet — wait for turn-in accept/decline.
        return;
      }
    }

    // Start dialog at node 0.
    player.dialogNpcId = npcId;
    player.dialogNodeIndex = 0;
    this.sendDialogNode(client, player, npc, 0);
  }

  private handleDialogChoice(client: Client, msg: DialogChoicePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    if (!player.dialogNpcId) return;
    const choiceIndex = msg?.choiceIndex;
    if (choiceIndex === undefined || choiceIndex === null) return;

    const npc = NPCS[player.dialogNpcId] as NpcDef | undefined;
    if (!npc) {
      this.endDialog(client, player);
      return;
    }

    const currentNode = npc.dialog[player.dialogNodeIndex] as DialogNode | undefined;
    if (!currentNode) {
      this.endDialog(client, player);
      return;
    }

    if (currentNode.kind === "line") {
      // Client clicked "Next" on a line node — advance to the next node.
      const line = currentNode as DialogLine;
      if (line.next !== undefined) {
        player.dialogNodeIndex = line.next;
        this.sendDialogNode(client, player, npc, line.next);
      } else {
        // No next — dialog ends.
        this.endDialog(client, player);
      }
      return;
    }

    // Branch node — use the choice index.
    const branch = currentNode as DialogBranch;
    const choice = branch.choices[choiceIndex];
    if (!choice) {
      this.endDialog(client, player);
      return;
    }

    // Execute the choice's action (if any).
    if (choice.action) {
      this.executeDialogAction(client, player, npc, choice.action);
    }

    // If the choice has a next node, advance to it.
    if (choice.next !== undefined) {
      player.dialogNodeIndex = choice.next;
      this.sendDialogNode(client, player, npc, choice.next);
    } else {
      // No next node — dialog ends.
      this.endDialog(client, player);
    }
  }

  /** Send exactly ONE dialog node to the client as a DIALOG message. */
  private sendDialogNode(client: Client, player: Player, npc: NpcDef, nodeIndex: number): void {
    const node = npc.dialog[nodeIndex] as DialogNode | undefined;
    if (!node) {
      this.endDialog(client, player);
      return;
    }

    if (node.kind === "line") {
      const line = node as DialogLine;
      // Execute any action attached to this line (server-side).
      if (line.action) {
        this.executeDialogAction(client, player, npc, line.action);
      }
      client.send(MessageType.DIALOG, {
        npcId: npc.id,
        npcName: npc.name,
        text: line.text,
        hasNext: line.next !== undefined,
      } satisfies DialogLinePayload);
    } else {
      // Branch node — send text + choices.
      const branch = node as DialogBranch;
      const choices = branch.choices.map((c, i) => ({ label: c.label, index: i }));
      client.send(MessageType.DIALOG, {
        npcId: npc.id,
        npcName: npc.name,
        text: branch.text,
        choices,
      } satisfies DialogLinePayload);
    }
  }

  /** Execute a dialog action (openShop, giveQuest, advanceJob, travel, openStorage, enterPQ, end). */
  private executeDialogAction(
    client: Client,
    player: Player,
    npc: NpcDef,
    action: { kind: string; payload?: string; fee?: number },
  ): void {
    switch (action.kind) {
      case "openShop": {
        // Tell the client to open its shop UI. Server is authoritative —
        // the client must send buy/sell messages back for the server to validate.
        client.send("shop_open", { shopId: action.payload });
        break;
      }
      case "giveQuest": {
        const questId = action.payload ?? "";
        const def = QUESTS[questId];
        if (!def) {
          client.send("quest_error", { questId, reason: "Unknown quest." });
          break;
        }
        // Check if already accepted/complete/turnedIn.
        const existing = player.questState.find((q) => q.questId === questId);
        if (existing && existing.status === "active") {
          client.send("quest_error", { questId, reason: "Quest already in progress." });
          break;
        }
        if (existing && existing.status === "complete") {
          client.send("quest_error", { questId, reason: "Quest ready for turn-in." });
          break;
        }
        if (existing && existing.status === "turnedIn") {
          client.send("quest_error", { questId, reason: "Quest already completed." });
          break;
        }
        if (def.requiredLevel !== undefined && player.level < def.requiredLevel) {
          client.send("quest_error", { questId, reason: `Requires level ${def.requiredLevel}.` });
          break;
        }
        // Build objective descriptions.
        const objectiveInfos = def.objectives.map((obj, idx) => ({
          kind: obj.kind,
          description: describeQuestObjectiveForClient(questId, idx),
          target: getQuestObjTarget(obj),
        }));
        // Store pending offer on player for validation on accept.
        player.pendingQuestOffer = questId;
        client.send("quest_offer", {
          questId: def.id,
          questName: def.name,
          giverNpcId: def.giverNpcId,
          giverNpcName: npc.name,
          objectives: objectiveInfos,
          rewards: {
            mesos: def.rewards.mesos,
            exp: def.rewards.exp,
            items: def.rewards.items ? [...def.rewards.items] : [],
          },
          requiredLevel: def.requiredLevel,
        } satisfies QuestOfferPayload);
        break;
      }
      case "advanceJob": {
        const targetArchetype = action.payload?.toUpperCase() as ClassArchetype | undefined;
        const payload = this.executeAdvanceJob(client, player, targetArchetype);
        if (payload) {
          client.send(MessageType.JOB_ADVANCE, payload);
        }
        break;
      }
      case "travel": {
        // Validate destination map exists.
        const mapId = action.payload;
        if (!mapId || !getMap(mapId)) {
          client.send(MessageType.USE_PORTAL, {
            message: "That destination is not available right now.",
          } satisfies FerryBlockedPayload);
          break;
        }

        // Check + deduct mesos fee (authoritative).
        const fee = action.fee ?? 0;
        if (fee > 0) {
          if (player.mesos < fee) {
            client.send(MessageType.USE_PORTAL, {
              message: `You need ${fee} mesos for this trip. You have ${player.mesos}.`,
            } satisfies FerryBlockedPayload);
            break;
          }
          player.mesos -= fee;
          accountStore.setMesos(player.charId, player.mesos);
        }

        this.persistPlayer(player);
        client.send(MessageType.TRAVEL, {
          mapId,
          spawnId: "playerSpawn",
        } satisfies TravelPayload);
        break;
      }
      case "openStorage": {
        client.send("storage_open");
        break;
      }
      case "enterPQ": {
        client.send("pq_enter", { pqId: action.payload });
        break;
      }
      case "end":
      default:
        break;
    }
  }

  /** End a dialog conversation and clear the player's dialog state. */
  private endDialog(client: Client, player: Player): void {
    const npcId = player.dialogNpcId;
    player.dialogNpcId = "";
    player.dialogNodeIndex = 0;
    if (npcId) {
      client.send(MessageType.DIALOG_END, { npcId } satisfies DialogEndPayload);
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────
  onJoin(
    client: Client,
    options: { name?: string; charId?: string; spawnId?: string; generation?: string } = {},
  ): void {
    // Identity is the server-verified accountId from onAuth (client.auth) — NEVER
    // options.accountId, which is attacker-controlled.
    const accountId = (client.auth?.accountId ?? client.sessionId).slice(0, 64);

    // ─── Ban check: banned accounts cannot join. ────────────────────────────
    const acc = accountStore.getAccount(accountId);
    if (acc?.banned) {
      client.send(MessageType.SERVER_ANNOUNCEMENT, {
        text: acc.banReason || "Your account has been banned.",
      } satisfies ServerAnnouncementPayload);
      // Delay disconnect so the client receives the message.
      setTimeout(() => {
        try {
          client.leave();
        } catch {
          /* already gone */
        }
      }, 500);
      return;
    }

    let character: CharacterRecord | undefined;
    let isNewAccount = false;
    let isNewCharacter = false;

    if (options.charId) {
      const requested = accountStore.getCharacter(options.charId);
      // Ownership gate: only load the requested character if it belongs to the
      // authenticated account. Otherwise ignore it (a client may not load someone
      // else's character by passing their charId).
      if (requested && requested.accountId === accountId) {
        character = requested;
      }
    }
    if (!character) {
      // Fall back to the first character of the account, or create a default one.
      const chars = accountStore.listCharacters(accountId);
      character = chars[0];
      if (chars.length === 0) isNewAccount = true;
    }
    if (!character) {
      // Auto-provision a default BEGINNER character so a brand-new account is
      // immediately playable. Player-chosen names go through CREATE_CHARACTER,
      // which validates them and rejects collisions with `name_taken`; here we
      // only need a free system name, so ask the store for a guaranteed-unique
      // one rather than silently mangling client-supplied input.
      const defaultName = accountStore.generateUniqueName(options.name || "Adventurer");
      character = accountStore.createCharacter(accountId, {
        name: defaultName,
        archetype: ClassArchetype.BEGINNER,
        appearance: randomizeAppearance(),
      });
      isNewCharacter = true;
    }

    const archetype = character.archetype as ClassArchetype;
    const def = getClass(archetype);
    const stats = autoAssign(character.level, def.primaryStat);

    const player = new Player();
    player.accountId = accountId;
    player.charId = character.charId;
    player.name = character.name;
    player.archetype = character.archetype;
    player.level = character.level;
    player.maxHp = maxHpForLevel(archetype, character.level);
    player.hp = character.stats.HP || player.maxHp;
    player.maxMp = maxMpForLevel(archetype, character.level);
    player.mp = character.stats.MP || player.maxMp;
    player.str = character.stats.STR || stats.STR;
    player.dex = character.stats.DEX || stats.DEX;
    player.intel = character.stats.INT || stats.INT;
    player.luk = character.stats.LUK || stats.LUK;
    player.exp = character.exp;
    player.ap = character.ap;
    player.sp = character.sp;
    player.mesos = character.mesos;
    // Use spawnId from travel, or fall back to saved position, or default spawn.
    const spawnPoint = options.spawnId ? this.map.spawnPoints[options.spawnId] : undefined;
    player.x = spawnPoint?.x ?? character.x ?? this.map.playerSpawn.x;
    player.y = spawnPoint?.y ?? character.y ?? this.map.playerSpawn.y;
    player.vy = 0;
    player.vx = 0;
    player.grounded = true;

    // Sync appearance so clients can render the character.
    const app = character.appearance;
    player.gender = app.gender;
    player.skinId = app.skinId;
    player.hairId = app.hairId;
    player.hairColorId = app.hairColorId;
    player.faceId = app.faceId;
    player.outfitId = app.outfitId;

    // Expire timed cash cosmetics before applying overlays.
    accountStore.expireCashItems(character.charId);
    // Overlay equipped cash cosmetics on top of base appearance.
    if (character.equippedCash) {
      for (const [cat, entry] of Object.entries(character.equippedCash)) {
        const cashDef = getCashItem(entry.itemId);
        if (!cashDef?.appearanceOverride) continue;
        const fields = appearanceFieldsForCategory(cat as CashCategory);
        for (const field of fields) {
          const val = cashDef.appearanceOverride[field];
          if (val !== undefined) {
            (player as unknown as Record<keyof CharacterAppearance, string>)[field] = val;
          }
        }
      }
    }

    // Restore previously owned items from the durable character.
    for (const rec of Object.values(character.inventory)) {
      const item = new InventoryItem();
      item.uid = rec.uid;
      item.defId = rec.defId;
      item.baseRank = rec.baseRank;
      item.potentialTier = rec.potentialTier;
      item.lines = rec.lines;
      item.minted = rec.minted;
      // Restore potential lines if present on the record.
      if ((rec as unknown as Record<string, unknown>).potentialLines) {
        item.potentialLines = JSON.stringify(
          (rec as unknown as Record<string, unknown>).potentialLines,
        );
      }
      item.count = rec.count ?? 1;
      player.inventory.set(item.uid, item);
    }

    // Restore equipped gear from the durable character.
    if (character.equipped) {
      for (const [slot, uid] of Object.entries(character.equipped)) {
        player.equipped.set(slot, uid);
      }
    }

    // Resolve attack type from equipped weapon → class fallback.
    const invLookup = (uid: string) => player.inventory.get(uid)?.defId;
    const equippedRec = Object.fromEntries(player.equipped.entries());
    player.attackType = resolveAttackType(equippedRec, invLookup, player.archetype);

    // Load quest state from the durable character, merging any new quests.
    player.questState = ensureQuestStates(character.quests ?? []);

    // Reset daily quests if the UTC day has rolled over.
    const nowMs = Date.now();
    resetDailyQuests(player.questState, nowMs);
    accountStore.updateCharacter(player.charId, {
      quests: player.questState,
      lastDailyResetAt: nowMs,
    });

    // Claim the daily login gift (server-authoritative, once per UTC day).
    const loginGiftReward = grantDailyLoginGift(
      player.level,
      character.lastDailyLoginGiftAt,
      nowMs,
    );
    if (loginGiftReward) {
      player.mesos += loginGiftReward.mesos;
      player.exp += loginGiftReward.exp;
      accountStore.updateCharacter(player.charId, {
        mesos: player.mesos,
        exp: player.exp,
        lastDailyLoginGiftAt: nowMs,
      });
    }

    // Restore learned skills from the durable character.
    player.learnedSkills = character.learnedSkills ?? [];
    player.skillBook = character.skillBook ?? {};
    player.jobTier = character.jobTier ?? 0;
    player.branchId = character.branchId ?? "";

    // Restore retention system state from the durable character.
    player.codex = character.codex ?? {};
    player.fame = character.fame ?? { fame: 0, fameHistory: {} };
    player.displayFame = player.fame.fame;
    player.achievements = character.achievements ?? createAchievementProgress();
    player.totalMesosEarned = character.totalMesosEarned ?? 0;
    player.totalQuestsCompleted = character.totalQuestsCompleted ?? 0;
    player.totalItemsCollected = character.totalItemsCollected ?? 0;
    player.quickslots = character.quickslots ?? [];

    // ── Backfill achievement progress on join (catches pre-system characters) ─
    // Level backfill: ensure level_reached progress reflects current level.
    const currentLevelProgress = player.achievements["level_10"]?.[0] ?? 0;
    if (currentLevelProgress < player.level) {
      this.processAchievementUnlocks(
        player,
        updateAchievementProgress(
          player.achievements,
          "level_reached",
          player.level - currentLevelProgress,
        ),
      );
    }
    // Mesos backfill.
    const currentMesosProgress = player.achievements["mesos_mogul"]?.[0] ?? 0;
    if (player.totalMesosEarned > currentMesosProgress) {
      this.processAchievementUnlocks(
        player,
        updateAchievementProgress(
          player.achievements,
          "mesos_earned",
          player.totalMesosEarned - currentMesosProgress,
        ),
      );
    }
    // Quests backfill.
    const currentQuestProgress = player.achievements["quest_beginner"]?.[0] ?? 0;
    if (player.totalQuestsCompleted > currentQuestProgress) {
      this.processAchievementUnlocks(
        player,
        updateAchievementProgress(
          player.achievements,
          "quests_completed",
          player.totalQuestsCompleted - currentQuestProgress,
        ),
      );
    }
    // Items backfill.
    const currentItemsProgress = player.achievements["collector"]?.[0] ?? 0;
    if (player.totalItemsCollected > currentItemsProgress) {
      this.processAchievementUnlocks(
        player,
        updateAchievementProgress(
          player.achievements,
          "items_collected",
          player.totalItemsCollected - currentItemsProgress,
        ),
      );
    }
    player.settings = character.settings ?? structuredClone(DEFAULT_SETTINGS);
    player.autoPot = character.autoPot ?? {
      hpEnabled: false,
      hpThreshold: 50,
      mpEnabled: false,
      mpThreshold: 50,
      hpPotionId: "pot.large_hp",
      mpPotionId: "pot.large_mp",
    };
    player.macros = character.macros ?? [];
    player.exploration = character.exploration ?? { slots: [] };
    player.ownedTitles = new ArraySchema<string>(...(character.ownedTitles ?? []));
    player.equippedTitle = character.equippedTitle ?? "";

    this.state.players.set(client.sessionId, player);

    // Restore familiar collection from durable character.
    if (FAMILIAR_ENABLED) {
      const famColl = character.familiars ?? structuredClone(EMPTY_FAMILIAR_COLLECTION);
      this.familiarCollections.set(client.sessionId, famColl);
      // Re-summon previously summoned familiars at the player's position.
      for (const mobId of famColl.summoned.slice(0, FAMILIAR_MAX_SUMMONED)) {
        const mobDef = getMobDef(mobId);
        if (!mobDef) continue;
        const stats = deriveFamiliarStats(mobDef);
        const fam = new Familiar();
        fam.mobId = mobId;
        fam.ownerSession = client.sessionId;
        fam.x = player.x + (Math.random() - 0.5) * 40;
        fam.y = player.y - 20;
        fam.hp = stats.hp;
        fam.maxHp = stats.hp;
        fam.speed = stats.speed;
        fam.facing = 1;
        fam.instanceId = `fam_${++this.idCounter}`;
        fam.familiarKey = mobId;
        this.state.familiars.set(mobId, fam);
      }
      // Send familiar sync to client.
      client.send(MessageType.FAMILIAR_SYNC, {
        registered: famColl.registered,
        summoned: famColl.summoned,
      } satisfies FamiliarSyncPayload);
    }

    // Send the quickslot layout to the client.
    client.send(MessageType.QUICKSLOT_LAYOUT, {
      slots: player.quickslots,
    } satisfies QuickSlotLayoutPayload);

    // Send the player's saved settings to the client.
    client.send(MessageType.SETTINGS_SYNC, {
      settings: player.settings,
    } satisfies SettingsPayload);

    // Send auto-pot config to the client.
    client.send(MessageType.AUTO_POT_SYNC, {
      config: player.autoPot,
    } satisfies AutoPotSyncPayload);

    // Send skill macros to the client.
    client.send(MessageType.MACRO_LAYOUT, {
      macros: player.macros,
    } satisfies MacroLayoutPayload);
    this.sessionAccount.set(client.sessionId, accountId);

    // Expose the player's role so the client can gate GM-only UI.
    //
    // The authoritative channel is the synced schema field `player.role` (set below):
    // state sync is delivery-guaranteed and order-independent, whereas a one-shot
    // message sent from onJoin can arrive BEFORE the client has registered its
    // onMessage handlers (the join promise resolves after onJoin returns) and be
    // silently dropped — which previously disabled the GM console for admins. We
    // also still send the legacy `playerRole` message as a belt-and-suspenders hint.
    const role = acc?.role ?? "player";
    player.role = role;
    client.send("playerRole" as string, { role });

    // Send initial quest log to the client.
    sendQuestUpdate(client, player.questState);

    // Send daily login gift status to the client (auto-claimed above if eligible).
    client.send(MessageType.DAILY_LOGIN_GIFT_SYNC, {
      claimable: false,
      reward: getDailyLoginReward(player.level),
      dateKey: utcDateKey(nowMs),
      claimed: !!loginGiftReward,
    } satisfies DailyLoginGiftSyncPayload);

    // Send initial guidance milestone.
    sendGuidanceSync(client, player.questState, player.level);

    // Send bonus hunting map info to the client.
    sendBonusHuntSync(client, this.state.mapId, nowMs);

    // Send initial codex sync.
    const codexResult = evaluateCodexMilestones(player.codex);
    client.send(MessageType.CODEX_SYNC, {
      codex: player.codex,
      statBonus: {
        STR: codexResult.totalStatBonus.STR ?? 0,
        DEX: codexResult.totalStatBonus.DEX ?? 0,
        INT: codexResult.totalStatBonus.INT ?? 0,
        LUK: codexResult.totalStatBonus.LUK ?? 0,
        HP: codexResult.totalStatBonus.HP ?? 0,
        MP: codexResult.totalStatBonus.MP ?? 0,
      },
      expBonus: codexResult.totalExpBonus,
    } satisfies CodexSyncPayload);

    // Send initial achievement sync.
    const achievementSnaps = getAllAchievementSnapshots(player.achievements).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      completed: s.completed,
      progress: s.progress,
      rewards: s.rewards,
    }));
    client.send(MessageType.ACHIEVEMENT_SYNC, {
      achievements: achievementSnaps,
    } satisfies AchievementSyncPayload);

    // Send initial title sync.
    client.send(MessageType.TITLE_SYNC, {
      ownedTitles: player.ownedTitles,
      equippedTitle: player.equippedTitle,
    } satisfies TitleSyncPayload);

    // Send active live-ops events to the client.
    client.send(MessageType.EVENTS_SYNC, {
      events: getActiveEvents(),
    } satisfies EventsSyncPayload);

    // Register online with the guild manager for cross-room chat relay.
    guildManager.registerOnline(
      client.sessionId,
      character.charId,
      character.name,
      player.level,
      this.state.mapId,
      (type: string | number, payload: unknown) => client.send(type, payload),
    );

    // Send initial guild state if the player is in a guild.
    if (guildManager.inGuild(character.charId)) {
      client.send(MessageType.GUILD_UPDATE, guildManager.buildUpdate(character.charId));
    }

    // Register online with the global party manager for cross-map party support.
    partyManager.registerOnline(
      client.sessionId,
      character.charId,
      character.name,
      player.level,
      this.state.mapId,
      (type: string | number, payload: unknown) => client.send(type, payload),
    );

    // Send initial party state if the player is already in a party (cross-map rejoin).
    if (partyManager.inParty(character.charId)) {
      client.send(MessageType.PARTY_UPDATE, partyManager.buildUpdate(character.charId));
    }

    // Send the map's NPC roster so the client can render + interact with them.
    // Dialog trees stay server-only — the client only sees id/name/pos/role/sprite.
    const npcs = getNpcsForMap(this.state.mapId).map((n) => ({
      id: n.id,
      name: n.name,
      x: n.x,
      y: n.y,
      spriteKey: n.spriteKey,
      role: n.role,
    }));
    client.send("map_npcs", { npcs });

    // ─── Single-live-session guard ─────────────────────────────────────────
    // Claim the ONE allowed live session for this character. Policy: kick the OLDER
    // session. A client relocating between maps/channels echoes the generation token it
    // was issued (options.generation), so the brief onJoin↔onLeave overlap of a transfer
    // is recognised as the same session moving — never a duplicate login. A genuine
    // second login (no token, or a stale one) instead kicks the older session.
    const claim = channelRegistry.claimSession({
      charId: character.charId,
      sessionId: client.sessionId,
      generation: typeof options.generation === "string" ? options.generation : undefined,
      kick: (reason: string) => {
        try {
          client.send(MessageType.FORCE_LOGOUT, { reason } satisfies ForceLogoutPayload);
        } catch {
          /* old transport already gone */
        }
        try {
          client.leave(DUPLICATE_LOGIN_CLOSE_CODE);
        } catch {
          /* already disconnected */
        }
      },
    });
    // Hand the (new or carried-over) generation back so the client echoes it on transfer.
    client.send(MessageType.SESSION_GENERATION, {
      generation: claim.generation,
    } satisfies SessionGenerationPayload);
    if (claim.kickedOlderSession) {
      console.log(
        `[MapRoom] duplicate login for char ${character.charId} (${character.name}) — kicked older session`,
      );
    }

    // Register with the global channel registry for cross-channel whisper + channel counts.
    channelRegistry.register({
      sessionId: client.sessionId,
      charId: character.charId,
      playerName: character.name,
      level: player.level,
      mapId: this.state.mapId,
      channel: this.channel,
      send: (type: string | number, payload: unknown) => client.send(type, payload),
    });

    // Send the channel list so the client can display the channel-select UI.
    client.send(MessageType.CHANNEL_LIST, {
      channels: channelRegistry.getChannelCounts(this.state.mapId, CHANNELS_PER_MAP),
      current: this.channel,
    } satisfies ChannelListPayload);

    // ── Analytics ────────────────────────────────────────────────────────
    this.sessionStartMs.set(client.sessionId, Date.now());
    track(AnalyticsEventType.SESSION_START, accountId, character.charId, {
      roomType: "map",
      mapId: this.state.mapId,
    });
    if (isNewAccount) {
      track(AnalyticsEventType.ACCOUNT_CREATED, accountId, character.charId, {
        createdAt: character.createdAt,
      });
    }
    if (isNewCharacter) {
      track(AnalyticsEventType.CHARACTER_CREATED, accountId, character.charId, {
        class: character.archetype,
        name: character.name,
      });
    }

    // ─── Moderation init: chat history ring buffer + blocked list sync ──────
    this.chatHistory.set(client.sessionId, []);
    client.send(MessageType.BLOCKED_LIST_RESULT, {
      blockedNames: acc?.blockedPlayers ?? [],
    } satisfies BlockedListResultPayload);

    // ─── Friends: register online, sync list, broadcast online status ──────
    friendManager.registerOnline({
      sessionId: client.sessionId,
      accountId,
      charId: character.charId,
      name: character.name,
      level: player.level,
      mapId: this.state.mapId,
      send: (type: string | number, payload: unknown) => client.send(type, payload),
    });
    this.sendFriendListToClient(client, accountId);
    friendManager.broadcastStatus(
      accountId,
      character.charId,
      character.name,
      player.level,
      true,
      this.state.mapId,
    );

    this.logJoin(client, accountId, {
      charId: character.charId,
      mapId: this.state.mapId,
      charLevel: player.level,
      newAccount: isNewAccount,
      newCharacter: isNewCharacter,
    });
  }

  // ─── Graceful reconnection (Colyseus 0.17) ────────────────────────────────
  // Fired on an UNEXPECTED disconnect (flaky network), NOT on a consented leave —
  // those route straight to `onLeave`. We hold the player's entity in room state for a
  // short grace window so `client.reconnect()` resumes them in place. The Player stays
  // in `this.state.players` (so the same sessionId is reused — no duplicate ghost) and
  // registries are left registered; `onReconnect` re-binds the new socket's `send`.
  // If the window elapses, Colyseus calls `onLeave` for full cleanup + persistence.
  onDrop(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    this.roomLog.info("client dropped — holding for reconnect", {
      sessionId: client.sessionId,
      accountId: this.accountIdForSession(client.sessionId),
      graceSeconds: RECONNECT_GRACE_SECONDS,
    });
    // Returns a promise that resolves on reconnect / rejects on timeout; Colyseus drives
    // the onReconnect/onLeave fall-through, so we don't need to await it here.
    void this.allowReconnection(client, RECONNECT_GRACE_SECONDS);
  }

  onReconnect(client: Client): void {
    const accountId = this.sessionAccount.get(client.sessionId);
    if (!accountId) return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    // Mark the held entity live again so remote clients clear the "disconnected" state.
    player.connected = true;

    // Re-register guild, channel, and friend tracking.
    guildManager.registerOnline(
      client.sessionId,
      player.charId,
      player.name,
      player.level,
      this.state.mapId,
      (type: string | number, payload: unknown) => client.send(type, payload),
    );
    channelRegistry.register({
      sessionId: client.sessionId,
      charId: player.charId,
      playerName: player.name,
      level: player.level,
      mapId: this.state.mapId,
      channel: this.channel,
      send: (type: string | number, payload: unknown) => client.send(type, payload),
    });
    friendManager.registerOnline({
      sessionId: client.sessionId,
      accountId,
      charId: player.charId,
      name: player.name,
      level: player.level,
      mapId: this.state.mapId,
      send: (type: string | number, payload: unknown) => client.send(type, payload),
    });
    this.sendFriendListToClient(client, accountId);
    friendManager.broadcastStatus(
      accountId,
      player.charId,
      player.name,
      player.level,
      true,
      this.state.mapId,
    );

    // Re-sync initial state.
    client.send(MessageType.QUICKSLOT_LAYOUT, {
      slots: player.quickslots,
    } satisfies QuickSlotLayoutPayload);
    client.send(MessageType.SETTINGS_SYNC, { settings: player.settings } satisfies SettingsPayload);
    client.send(MessageType.AUTO_POT_SYNC, { config: player.autoPot } satisfies AutoPotSyncPayload);
    client.send(MessageType.MACRO_LAYOUT, { macros: player.macros } satisfies MacroLayoutPayload);
    sendQuestUpdate(client, player.questState);
    sendGuidanceSync(client, player.questState, player.level);
    sendBonusHuntSync(client, this.state.mapId, Date.now());
    const codexResult = evaluateCodexMilestones(player.codex);
    client.send(MessageType.CODEX_SYNC, {
      codex: player.codex,
      statBonus: {
        STR: codexResult.totalStatBonus.STR ?? 0,
        DEX: codexResult.totalStatBonus.DEX ?? 0,
        INT: codexResult.totalStatBonus.INT ?? 0,
        LUK: codexResult.totalStatBonus.LUK ?? 0,
        HP: codexResult.totalStatBonus.HP ?? 0,
        MP: codexResult.totalStatBonus.MP ?? 0,
      },
      expBonus: codexResult.totalExpBonus,
    } satisfies CodexSyncPayload);
    client.send(MessageType.BLOCKED_LIST_RESULT, {
      blockedNames: accountStore.getAccount(accountId)?.blockedPlayers ?? [],
    } satisfies BlockedListResultPayload);

    this.roomLog.info("client reconnected", {
      sessionId: client.sessionId,
      accountId,
      charId: player.charId,
    });
  }

  onLeave(client: Client): void {
    // Cancel any active trade involving this player.
    this.cancelTradeForSession(client.sessionId, "Player left.");

    // Unregister from the global party manager.
    // Party membership persists across map changes (only online tracking is removed).
    partyManager.unregisterOnline(client.sessionId);

    const player = this.state.players.get(client.sessionId);

    // ─── Party cleanup on true disconnect ──────────────────────────────────
    // During a map transfer the new room's onJoin already registered a fresh session
    // for this charId *before* the old room's onLeave fires, so getOnlineByChar will
    // find the new session. For a real disconnect no other session exists and we can
    // safely remove the player from their party (reassigning leader if needed).
    if (player && !partyManager.getOnlineByChar(player.charId)) {
      const leaveResult = partyManager.leave(player.charId);
      if (leaveResult && leaveResult.party.members.size > 0) {
        partyManager.syncPartyToAllMembers(leaveResult.party);
        const chatText = `${player.name} disconnected.${leaveResult.wasLeader ? " Leader reassigned." : ""}`;
        for (const cid of leaveResult.party.members.keys()) {
          const om = partyManager.getOnlineByChar(cid);
          if (om) {
            om.send(MessageType.CHAT, {
              sessionId: "",
              name: "Party",
              text: chatText,
            });
          }
        }
      }
    }

    const accountId = this.sessionAccount.get(client.sessionId);
    if (player && accountId) {
      const startMs = this.sessionStartMs.get(client.sessionId) ?? Date.now();
      track(AnalyticsEventType.SESSION_END, accountId, player.charId, {
        roomType: "map",
        mapId: this.state.mapId,
        durationMs: Date.now() - startMs,
        level: player.level,
      });
      track(AnalyticsEventType.DISCONNECT_BY_MAP, accountId, player.charId, {
        mapId: this.state.mapId,
        level: player.level,
      });
    }
    // Dismiss all familiars for this player.
    this.dismissAllFamiliars(client.sessionId);
    this.familiarCollections.delete(client.sessionId);

    if (player) {
      this.persistPlayer(player);
    }
    // Unregister from guild online tracking.
    guildManager.unregisterOnline(client.sessionId);
    // Unregister from the global channel registry.
    channelRegistry.unregister(client.sessionId);
    // Release the single-live-session ownership — but only if THIS session still owns
    // it. During a transfer the new session already claimed ownership, so this old
    // session's late onLeave must not clobber the new one (sessionId mismatch → no-op).
    if (player) {
      channelRegistry.releaseSession(player.charId, client.sessionId);
    }

    // ─── Friends: broadcast offline status then unregister ─────────────────
    if (player && accountId) {
      friendManager.broadcastStatus(accountId, player.charId, player.name, player.level, false);
    }
    friendManager.unregisterOnline(client.sessionId);

    this.state.players.delete(client.sessionId);
    this.lastChatAt.delete(client.sessionId);
    this.chatHistory.delete(client.sessionId);
    this.sessionAccount.delete(client.sessionId);
    this.sessionStartMs.delete(client.sessionId);
    // Clean up rate limiters to avoid memory leak.
    this.inputLimiter.delete(client.sessionId);
    this.skillCastLimiter.delete(client.sessionId);
    this.pickupLimiter.delete(client.sessionId);
    this.macroCastLimiter.delete(client.sessionId);
    this.logLeave(client, { charId: player?.charId });
  }

  // ─── Guild (persistent cross-map social) ───────────────────────────────────

  private handleGuildCreate(client: Client, msg: GuildCreatePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const name = msg?.name?.trim();
    const color = msg?.color ?? 0x3b82f6;
    if (!name || name.length < 2) {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: "Guild name must be 2+ characters.",
      } satisfies GuildResultPayload);
      return;
    }

    // Deduct mesos cost (guild creation is a currency sink).
    if (player.mesos < GUILD_CREATE_COST) {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: `Need ${GUILD_CREATE_COST} mesos to create a guild.`,
      } satisfies GuildResultPayload);
      return;
    }
    player.mesos -= GUILD_CREATE_COST;
    accountStore.setMesos(player.charId, player.mesos);
    accountStore.burnMesos(player.charId, GUILD_CREATE_COST, "guild_create");

    const result = guildManager.createGuild(player.charId, player.name, player.level, name, color);
    if (typeof result === "string") {
      // Refund on failure.
      player.mesos += GUILD_CREATE_COST;
      accountStore.setMesos(player.charId, player.mesos);
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: result,
      } satisfies GuildResultPayload);
      return;
    }

    client.send(MessageType.GUILD_RESULT, {
      success: true,
      message: `Guild "${result.name}" created!`,
    } satisfies GuildResultPayload);
    client.send(MessageType.GUILD_UPDATE, guildManager.buildUpdate(player.charId));
    console.log(`[MapRoom] guild created: ${result.name} (${result.guildId}) by ${player.name}`);
  }

  private handleGuildInvite(client: Client, msg: GuildInvitePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const targetSessionId = msg?.targetSessionId;
    if (!targetSessionId) return;

    const target = this.state.players.get(targetSessionId);
    if (!target) {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: "Player not found.",
      } satisfies GuildResultPayload);
      return;
    }

    // Proximity check — guild invites require both players to be nearby on the same map.
    const dx = Math.abs(player.x - target.x);
    const dy = Math.abs(player.y - target.y);
    if (dx > TRADE_RANGE_X || dy > TRADE_RANGE_Y) {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: "Too far away to invite.",
      } satisfies GuildResultPayload);
      return;
    }

    // Block check.
    const senderAccId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
    const targetAccId = this.sessionAccount.get(targetSessionId);
    if (
      accountStore.hasBlocked(senderAccId, target.name) ||
      (targetAccId && accountStore.hasBlocked(targetAccId, player.name))
    ) {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: "Cannot invite this player.",
      } satisfies GuildResultPayload);
      return;
    }

    const err = guildManager.invite(player.charId, targetSessionId);
    if (err) {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: err,
      } satisfies GuildResultPayload);
      return;
    }

    // Notify the target.
    const targetClient = this.clients.find((c) => c.sessionId === targetSessionId);
    const guild = guildManager.getGuildForChar(player.charId);
    if (targetClient && guild) {
      targetClient.send(MessageType.GUILD_INVITE_RECEIVED, {
        fromSessionId: client.sessionId,
        fromName: player.name,
        guildName: guild.name,
      } satisfies GuildInviteReceivedPayload);
    }

    client.send(MessageType.GUILD_RESULT, {
      success: true,
      message: `Guild invite sent to ${target.name}.`,
    } satisfies GuildResultPayload);
  }

  private handleGuildAccept(client: Client, msg: GuildAcceptPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const fromSessionId = msg?.fromSessionId;
    if (!fromSessionId) return;

    const result = guildManager.acceptInvite(
      client.sessionId,
      player.charId,
      player.name,
      player.level,
      fromSessionId,
    );
    if (typeof result === "string") {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: result,
      } satisfies GuildResultPayload);
      return;
    }

    // Push guild update to all online members.
    guildManager.pushUpdateToGuild(result.guild, (sid, payload) => {
      const c = this.clients.find((cl) => cl.sessionId === sid);
      if (c) c.send(MessageType.GUILD_UPDATE, payload);
    });

    // Also push to other rooms by broadcasting via each member's registered session.
    // (The guildManager already tracks all online sessions; we iterate them.)
    this.relayGuildUpdateToAllOnline(result.guild);

    // Chat notification to all online guild members (cross-room).
    for (const om of guildManager.getAllGuildOnline(player.charId)) {
      om.send(MessageType.CHAT, {
        sessionId: "",
        name: "Guild",
        text: `${player.name} joined the guild!`,
      });
    }
  }

  private handleGuildLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = guildManager.leave(player.charId);
    if (!result) {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: "You are not in a guild.",
      } satisfies GuildResultPayload);
      return;
    }

    client.send(MessageType.GUILD_UPDATE, {
      guildId: "",
      guildName: "",
      emblem: { color: 0, label: "" },
      members: [],
      createdDate: 0,
    } satisfies GuildUpdatePayload);
    client.send(MessageType.GUILD_RESULT, {
      success: true,
      message: "You left the guild.",
    } satisfies GuildResultPayload);

    // If the guild still exists, push update to remaining members.
    if (result.guild.roster.size > 0) {
      this.relayGuildUpdateToAllOnline(result.guild);
    }
  }

  private handleGuildKick(client: Client, msg: GuildKickPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const targetCharId = msg?.targetCharId;
    if (!targetCharId) return;

    // Resolve the target's name for the notification.
    const targetChar = accountStore.getCharacter(targetCharId);
    const result = guildManager.kick(player.charId, targetCharId);
    if (typeof result === "string") {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: result,
      } satisfies GuildResultPayload);
      return;
    }

    // Push update to all remaining online members.
    if (result.guild.roster.size > 0) {
      this.relayGuildUpdateToAllOnline(result.guild);
    }

    // Notify the kicker.
    client.send(MessageType.GUILD_RESULT, {
      success: true,
      message: `Kicked ${targetChar?.name ?? targetCharId}.`,
    } satisfies GuildResultPayload);

    // Notify the kicked player if they're online anywhere (cross-room via send callbacks).
    for (const om of guildManager.getAllGuildOnline(targetCharId)) {
      om.send(MessageType.GUILD_UPDATE, {
        guildId: "",
        guildName: "",
        emblem: { color: 0, label: "" },
        members: [],
        createdDate: 0,
      } satisfies GuildUpdatePayload);
      om.send(MessageType.CHAT, {
        sessionId: "",
        name: "Guild",
        text: `You have been kicked from the guild by ${player.name}.`,
      });
    }
  }

  private handleGuildRank(client: Client, msg: GuildRankPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const targetCharId = msg?.targetCharId;
    const newRank = msg?.newRank;
    if (!targetCharId || !newRank) return;

    const err = guildManager.changeRank(player.charId, targetCharId, newRank);
    if (err) {
      client.send(MessageType.GUILD_RESULT, {
        success: false,
        message: err,
      } satisfies GuildResultPayload);
      return;
    }

    // Push update to all online members.
    const guild = guildManager.getGuildForChar(player.charId);
    if (guild) this.relayGuildUpdateToAllOnline(guild);

    client.send(MessageType.GUILD_RESULT, {
      success: true,
      message: `Rank changed to ${newRank}.`,
    } satisfies GuildResultPayload);
  }

  private handleGuildChat(client: Client, msg: GuildChatPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg?.text) return;

    let text = msg.text.trim().slice(0, CHAT_MAX_LEN);
    text = filterProfanity(text);
    if (text.length === 0) return;

    // Relay to all online guild members across all rooms via the guild manager's send callbacks.
    const recipients = guildManager.getGuildChatRecipients(player.charId);
    for (const om of recipients) {
      om.send(MessageType.GUILD_CHAT_RELAY, {
        senderName: player.name,
        text,
      } satisfies GuildChatRelayPayload);
    }
  }

  private handlePartyChat(client: Client, msg: PartyChatPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg?.text) return;

    // Mute check.
    const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
    if (accountStore.isMuted(accountId)) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "System",
        text: "You are currently muted.",
      });
      return;
    }

    // Rate limit.
    const now = Date.now();
    const last = this.lastChatAt.get(client.sessionId) ?? 0;
    if (now - last < CHAT_RATE_LIMIT_MS) return;
    this.lastChatAt.set(client.sessionId, now);

    let text = msg.text.trim().slice(0, CHAT_MAX_LEN);
    text = filterProfanity(text);
    if (text.length === 0) return;

    if (!partyManager.inParty(player.charId)) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: "You are not in a party.",
      });
      return;
    }

    // Relay to all party members via cross-room send callbacks.
    const recipients = partyManager.getPartyChatRecipients(player.charId);
    for (const om of recipients) {
      om.send(MessageType.PARTY_CHAT_RELAY, {
        senderName: player.name,
        text,
      } satisfies PartyChatRelayPayload);
    }
    // Also send to the sender.
    client.send(MessageType.PARTY_CHAT_RELAY, {
      senderName: player.name,
      text,
    } satisfies PartyChatRelayPayload);
  }

  /** Relay a guild update to all online members across rooms via stored send callbacks. */
  private relayGuildUpdateToAllOnline(guild: import("../guildManager").GuildRecord): void {
    for (const charId of guild.roster.keys()) {
      const payload = guildManager.buildUpdate(charId);
      const online = guildManager.getAllGuildOnline(charId);
      for (const om of online) {
        if (om.charId === charId) {
          om.send(MessageType.GUILD_UPDATE, payload);
        }
      }
    }
  }

  // ─── Channel system ───────────────────────────────────────────────────────

  /**
   * Handle a channel-switch request. Persists the current player, closes any active trade,
   * unregisters from the channel registry, and tells the client to leave + rejoin the new channel.
   */
  private handleChannelSwitch(client: Client, msg: ChannelSwitchPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const targetChannel = msg?.channel;
    if (targetChannel === undefined || targetChannel === null) return;
    if (targetChannel < 0 || targetChannel >= CHANNELS_PER_MAP) return;
    if (targetChannel === this.channel) return; // already on this channel

    // Cancel any active trade.
    this.cancelTradeForSession(client.sessionId, "Switching channels.");

    // Persist the player state so the new channel can load it.
    this.persistPlayer(player);

    // Unregister from channel registry (will re-register in the new room's onJoin).
    channelRegistry.unregister(client.sessionId);

    // Unregister from guild tracking (will re-register in the new room's onJoin).
    guildManager.unregisterOnline(client.sessionId);

    // Tell the client to leave this room and join the target channel.
    client.send(MessageType.CHANNEL_SWITCH_RESULT, {
      mapId: this.state.mapId,
      channel: targetChannel,
      spawnId: "playerSpawn",
    } satisfies ChannelSwitchResultPayload);

    console.log(`[MapRoom] ${player.name} switching ch${this.channel} → ch${targetChannel}`);
  }

  /**
   * Handle a cross-channel whisper. Looks up the target player in the global channel registry.
   */
  private handleWhisper(client: Client, msg: WhisperPayload): void {
    const sender = this.state.players.get(client.sessionId);
    if (!sender || !msg?.targetName || !msg?.text) return;

    let text = msg.text.trim().slice(0, CHAT_MAX_LEN);
    text = filterProfanity(text);
    if (text.length === 0) return;

    const target = channelRegistry.findByName(msg.targetName);
    if (!target) {
      client.send(MessageType.WHISPER_FAILED, {
        targetName: msg.targetName,
        reason: "Player not found.",
      } satisfies WhisperFailedPayload);
      return;
    }

    // Don't whisper yourself.
    if (target.sessionId === client.sessionId) {
      client.send(MessageType.WHISPER_FAILED, {
        targetName: msg.targetName,
        reason: "You cannot whisper yourself.",
      } satisfies WhisperFailedPayload);
      return;
    }

    // Mute check: muted players cannot whisper.
    const senderAccountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
    if (accountStore.isMuted(senderAccountId)) {
      client.send(MessageType.WHISPER_FAILED, {
        targetName: msg.targetName,
        reason: "You are currently muted.",
      } satisfies WhisperFailedPayload);
      return;
    }

    // Block check: sender or target may have blocked the other.
    if (accountStore.hasBlocked(senderAccountId, target.playerName)) {
      client.send(MessageType.WHISPER_FAILED, {
        targetName: msg.targetName,
        reason: "You have blocked this player.",
      } satisfies WhisperFailedPayload);
      return;
    }
    // Look up the target's account to check if they blocked the sender.
    const targetAcc = channelRegistry.findByName(target.playerName);
    if (targetAcc) {
      // We need to iterate accounts to find the target's accountId. For efficiency,
      // we store accountId in the registry info via a helper. For now, we check
      // by scanning sessionAccount map if the target is in this room, or skip.
      const targetPlayerEntry = this.state.players.get(target.sessionId);
      if (targetPlayerEntry) {
        const targetAccId = this.sessionAccount.get(target.sessionId);
        if (targetAccId && accountStore.hasBlocked(targetAccId, sender.name)) {
          client.send(MessageType.WHISPER_FAILED, {
            targetName: msg.targetName,
            reason: "This player cannot receive whispers from you.",
          } satisfies WhisperFailedPayload);
          return;
        }
      }
    }

    // Send the whisper to the target.
    target.send(MessageType.WHISPER_RELAY, {
      senderName: sender.name,
      text,
    } satisfies WhisperRelayPayload);

    // Confirm to the sender via chat.
    client.send(MessageType.CHAT, {
      sessionId: "",
      name: "Whisper",
      text: `→ ${target.playerName}: ${text}`,
    });
  }

  // ─── Friends / Buddy list ───────────────────────────────────────────────────

  private handleFriendAdd(client: Client, msg: FriendAddPayload): void {
    const sender = this.state.players.get(client.sessionId);
    if (!sender || !msg?.targetName) return;
    const senderAccountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;

    // Find the target character by name.
    const targetChar = accountStore.getCharacterByName(msg.targetName);
    if (!targetChar) {
      client.send(MessageType.FRIEND_RESULT, {
        success: false,
        message: `Player "${msg.targetName}" not found.`,
      } satisfies FriendResultPayload);
      return;
    }

    // Can't add yourself.
    if (targetChar.accountId === senderAccountId) {
      client.send(MessageType.FRIEND_RESULT, {
        success: false,
        message: "You cannot add yourself.",
      } satisfies FriendResultPayload);
      return;
    }

    // Check block lists.
    if (accountStore.hasBlocked(senderAccountId, targetChar.name)) {
      client.send(MessageType.FRIEND_RESULT, {
        success: false,
        message: "You have blocked this player.",
      } satisfies FriendResultPayload);
      return;
    }
    const targetAcc = accountStore.getAccount(targetChar.accountId);
    if (targetAcc && accountStore.hasBlocked(targetChar.accountId, sender.name)) {
      client.send(MessageType.FRIEND_RESULT, {
        success: false,
        message: "This player cannot receive friend requests from you.",
      } satisfies FriendResultPayload);
      return;
    }

    // Attempt to add (bidirectional).
    const err = friendManager.addFriend(senderAccountId, targetChar.accountId);
    if (err) {
      client.send(MessageType.FRIEND_RESULT, {
        success: false,
        message: err,
      } satisfies FriendResultPayload);
      return;
    }

    // Persist both directions.
    accountStore.addFriend(senderAccountId, targetChar.accountId);
    accountStore.addFriend(targetChar.accountId, senderAccountId);

    client.send(MessageType.FRIEND_RESULT, {
      success: true,
      message: `${targetChar.name} added to your friends list.`,
    } satisfies FriendResultPayload);

    // Send updated friend list to sender.
    this.sendFriendListToClient(client, senderAccountId);

    // If the target is online, notify the sender of their status and notify the target too.
    const targetOnline = friendManager.findByAccountId(targetChar.accountId);
    if (targetOnline) {
      // Tell the sender that the new friend is online.
      client.send(MessageType.ONLINE_STATUS, {
        updates: [
          {
            charId: targetChar.charId,
            name: targetChar.name,
            online: true,
            mapId: targetOnline.mapId,
          },
        ],
      } satisfies OnlineStatusPayload);
      targetOnline.send(MessageType.FRIEND_RESULT, {
        success: true,
        message: `${sender.name} added you as a friend.`,
      } satisfies FriendResultPayload);
      this.sendFriendListToAccountId(targetChar.accountId);
    }
  }

  private handleFriendRemove(client: Client, msg: FriendRemovePayload): void {
    const sender = this.state.players.get(client.sessionId);
    if (!sender || !msg?.targetName) return;
    const senderAccountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;

    const targetChar = accountStore.getCharacterByName(msg.targetName);
    if (!targetChar) {
      client.send(MessageType.FRIEND_RESULT, {
        success: false,
        message: `Player "${msg.targetName}" not found.`,
      } satisfies FriendResultPayload);
      return;
    }

    if (!friendManager.areFriends(senderAccountId, targetChar.accountId)) {
      client.send(MessageType.FRIEND_RESULT, {
        success: false,
        message: `${targetChar.name} is not on your friends list.`,
      } satisfies FriendResultPayload);
      return;
    }

    friendManager.removeFriend(senderAccountId, targetChar.accountId);
    accountStore.removeFriend(senderAccountId, targetChar.accountId);
    accountStore.removeFriend(targetChar.accountId, senderAccountId);

    client.send(MessageType.FRIEND_RESULT, {
      success: true,
      message: `${targetChar.name} removed from your friends list.`,
    } satisfies FriendResultPayload);

    this.sendFriendListToClient(client, senderAccountId);

    // Notify the target if online.
    const targetOnline = friendManager.findByAccountId(targetChar.accountId);
    if (targetOnline) {
      targetOnline.send(MessageType.FRIEND_REMOVED, {
        charId: sender.charId,
        name: sender.name,
      } satisfies FriendRemovedPayload);
      this.sendFriendListToAccountId(targetChar.accountId);
    }
  }

  /** Build and send a full FRIEND_LIST to a client. */
  private sendFriendListToClient(client: Client, accountId: string): void {
    const friends = friendManager.buildFriendList(
      accountId,
      (acctId) => {
        const rec = accountStore.listCharacters(acctId)[0];
        return rec ? { charId: rec.charId, name: rec.name, level: rec.level } : undefined;
      },
      (acctId) => {
        const info = friendManager.findByAccountId(acctId);
        return info ? { online: true, mapId: info.mapId } : { online: false };
      },
    );
    client.send(MessageType.FRIEND_LIST, { friends } satisfies FriendListPayload);
  }

  /** Build and send a full FRIEND_LIST to all online sessions of a given accountId. */
  private sendFriendListToAccountId(accountId: string): void {
    const friends = friendManager.buildFriendList(
      accountId,
      (acctId) => {
        const rec = accountStore.listCharacters(acctId)[0];
        return rec ? { charId: rec.charId, name: rec.name, level: rec.level } : undefined;
      },
      (acctId) => {
        const fInfo = friendManager.findByAccountId(acctId);
        return fInfo ? { online: true, mapId: fInfo.mapId } : { online: false };
      },
    );
    const payload = { friends } satisfies FriendListPayload;
    // Send to every online session for this account.
    const info = friendManager.findByAccountId(accountId);
    if (info) {
      info.send(MessageType.FRIEND_LIST, payload);
    }
  }

  // ─── Quest accept / decline handlers ───────────────────────────────
  private handleQuestAccept(client: Client, msg: QuestAcceptPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    const questId = msg?.questId;
    if (!questId) return;
    // Validate the pending offer matches.
    if (player.pendingQuestOffer !== questId) return;
    player.pendingQuestOffer = undefined;
    const result = acceptQuest(player.questState, questId, player.level);
    if (typeof result === "string") {
      client.send("quest_error", { questId, reason: result });
    } else {
      sendQuestUpdate(client, player.questState);
      sendGuidanceSync(client, player.questState, player.level);
      this.persistPlayer(player);
      const acct = this.sessionAccount.get(client.sessionId);
      if (acct) {
        track(AnalyticsEventType.QUEST_ACCEPT, acct, player.charId, {
          questId,
          level: player.level,
        });
      }
    }
  }

  private handleQuestDecline(client: Client, msg: QuestDeclinePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const questId = msg?.questId;
    if (!questId) return;
    if (player.pendingQuestOffer !== questId) return;
    player.pendingQuestOffer = undefined;
    // Dialog was already ended by the client closing the offer panel.
  }

  private handleQuestTurninAccept(client: Client, msg: QuestTurninAcceptPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    const questId = msg?.questId;
    if (!questId) return;
    if (player.pendingQuestTurnin !== questId) return;
    player.pendingQuestTurnin = undefined;
    const def = QUESTS[questId];
    const questExp = def?.rewards.exp ?? 0;
    const jobTierBefore = player.jobTier;
    const archetypeBefore = player.archetype;
    const err = turnInQuest(player.questState, questId, player);
    if (!err) {
      // Track lifetime quest completions.
      player.totalQuestsCompleted += 1;
      accountStore.incrementLifetimeCounter(player.charId, "totalQuestsCompleted", 1);
      client.send("quest_turnin", {
        questId,
        questName: def?.name ?? questId,
        mesos: def?.rewards.mesos ?? 0,
        exp: questExp,
        items: def?.rewards.items ? [...def.rewards.items] : [],
      });
      const qcAcct = this.sessionAccount.get(client.sessionId);
      if (qcAcct) {
        track(AnalyticsEventType.QUEST_COMPLETE, qcAcct, player.charId, {
          questId,
          exp: questExp,
          mesos: def?.rewards.mesos ?? 0,
          level: player.level,
        });
        // ── Tutorial step funnel ──────────────────────────────────────────
        const tutorialIdx = TUTORIAL_QUEST_CHAIN.indexOf(questId);
        if (tutorialIdx !== -1) {
          track(AnalyticsEventType.TUTORIAL_STEP, qcAcct, player.charId, {
            questId,
            stepIndex: tutorialIdx,
            totalSteps: TUTORIAL_QUEST_CHAIN.length,
            level: player.level,
            completed: tutorialIdx === TUTORIAL_QUEST_CHAIN.length - 1,
          });
        }
      }
      const expResult = grantExp(player, questExp);
      this.persistPlayer(player);
      if (expResult.leveledUp) {
        this.broadcast(MessageType.LEVEL_UP, {
          level: player.level,
          levelsGained: expResult.levelsGained,
          ap: player.ap,
          sp: player.sp,
          maxHp: player.maxHp,
          maxMp: player.maxMp,
        } satisfies LevelUpPayload);
        const qLvAcct = this.sessionAccount.get(client.sessionId);
        if (qLvAcct) {
          track(AnalyticsEventType.LEVEL_UP, qLvAcct, player.charId, {
            level: player.level,
            levelsGained: expResult.levelsGained,
            class: player.archetype,
          });
        }
        if (progressObjectives(player.questState, "level", String(player.level), 1)) {
          sendQuestUpdate(client, player.questState);
        }
        sendGuidanceSync(client, player.questState, player.level);
        // ── Achievements: level_reached from quest EXP ──────────────────
        this.processAchievementUnlocks(
          player,
          updateAchievementProgress(player.achievements, "level_reached", expResult.levelsGained),
        );
      }
      // ── Achievements: quests_completed ───────────────────────────────
      this.processAchievementUnlocks(
        player,
        updateAchievementProgress(player.achievements, "quests_completed", 1),
      );
      // ── Job advancement notification ──────────────────────────────────
      const jobAdvanced =
        def?.rewards.jobAdvanceToTier !== undefined &&
        (player.jobTier !== jobTierBefore || player.archetype !== archetypeBefore);
      if (jobAdvanced) {
        client.send(MessageType.JOB_ADVANCE, {
          success: true,
          archetype: player.archetype,
          jobTier: player.jobTier,
          branchId: player.branchId || undefined,
          message: `You are now a ${getClass(player.archetype as ClassArchetype).name}!`,
        });
        const jaAcct = this.sessionAccount.get(client.sessionId);
        if (jaAcct) {
          track(AnalyticsEventType.JOB_ADVANCE, jaAcct, player.charId, {
            jobTier: player.jobTier,
            class: player.archetype,
            level: player.level,
          });
        }
      }
      sendQuestUpdate(client, player.questState);
      sendGuidanceSync(client, player.questState, player.level);
    }
    // Start dialog after turn-in.
    const npc = NPCS[player.dialogNpcId ?? ""] as NpcDef | undefined;
    if (npc) {
      player.dialogNodeIndex = 0;
      this.sendDialogNode(client, player, npc, 0);
    }
  }

  private handleQuestTurninDecline(client: Client, msg: QuestTurninDeclinePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const questId = msg?.questId;
    if (!questId) return;
    if (player.pendingQuestTurnin !== questId) return;
    player.pendingQuestTurnin = undefined;
    // Start dialog without turning in.
    const npc = NPCS[player.dialogNpcId ?? ""] as NpcDef | undefined;
    if (npc) {
      player.dialogNodeIndex = 0;
      this.sendDialogNode(client, player, npc, 0);
    }
  }

  private handleQuestAbandon(client: Client, msg: QuestAbandonPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    const questId = msg?.questId;
    if (!questId) return;
    const result = abandonQuest(player.questState, questId);
    if (typeof result === "string") {
      client.send("quest_error", { questId, reason: result });
    } else {
      sendQuestUpdate(client, player.questState);
      sendGuidanceSync(client, player.questState, player.level);
      this.persistPlayer(player);
    }
  }

  onDispose(): void {
    // Final flush so a graceful shutdown (room close / server restart) loses nothing,
    // then checkpoint the WAL into the main DB file.
    this.persistAllPlayers();
    try {
      persistGuildsAndFriends();
    } catch (err) {
      this.roomLog.error("guild/friend persist on dispose failed", { err });
    }
    try {
      accountStore.checkpoint();
    } catch (err) {
      this.roomLog.error("checkpoint on dispose failed", { err });
    }
    this.logDispose({ mapName: this.map?.name, channel: this.channel });
  }

  // ─── Job Advancement ─────────────────────────────────────────────────
  private static readonly ADVANCEABLE: ReadonlySet<string> = new Set([
    ClassArchetype.WARRIOR,
    ClassArchetype.MAGE,
    ClassArchetype.ARCHER,
    ClassArchetype.THIEF,
    ClassArchetype.PIRATE,
  ]);

  /**
   * Attempt job advancement. Returns a `JobAdvancePayload` to send to the client,
   * or `null` if the server already handled it (2nd-job branch list sent directly).
   */
  private executeAdvanceJob(
    client: Client,
    player: Player,
    targetArchetype: ClassArchetype | undefined,
  ): JobAdvancePayload | null {
    if (!targetArchetype || !MapRoom.ADVANCEABLE.has(targetArchetype)) {
      return { success: false, message: "Invalid class choice." };
    }

    // ── 1st-job advancement (Beginner → class) ──
    if (player.archetype === ClassArchetype.BEGINNER) {
      if (player.level < 10) {
        return {
          success: false,
          message: `You must be at least level 10 to advance. (Current: ${player.level})`,
        };
      }

      const prevArchetype = player.archetype as ClassArchetype;
      player.archetype = targetArchetype;
      player.jobTier = 1;

      // Recompute maxHp/maxMp for the new class at the current level.
      player.maxHp = maxHpForLevel(targetArchetype, player.level);
      player.hp = player.maxHp;
      player.maxMp = maxMpForLevel(targetArchetype, player.level);
      player.mp = player.maxMp;

      // Grant the new class's tier-1 skills.
      const newClass = getClass(targetArchetype);
      const tier1 = newClass.jobTiers.find((t) => t.tier === 1);
      if (tier1) {
        const existing = new Set(player.learnedSkills);
        for (const skill of tier1.skills) {
          if (!existing.has(skill.id)) player.learnedSkills.push(skill.id);
        }
      }

      this.persistPlayer(player);
      const acct1 = this.sessionAccount.get(client.sessionId);
      if (acct1) {
        track(AnalyticsEventType.JOB_ADVANCE, acct1, player.charId, {
          jobTier: 1,
          class: targetArchetype,
          level: player.level,
        });
      }
      console.log(
        `[MapRoom] 1st-job advancement: ${prevArchetype} → ${targetArchetype} (Lv${player.level}) ` +
          `char ${player.charId}.`,
      );
      return {
        success: true,
        archetype: targetArchetype,
        jobTier: 1,
        message: `You are now a ${newClass.name}!`,
      };
    }

    // ── 2nd-job advancement (class at tier 1 → branch selection at tier 2) ──
    if (player.archetype === targetArchetype && player.jobTier === 1) {
      if (player.level < 30) {
        return {
          success: false,
          message: `You must be at least level 30 for 2nd-job advancement. (Current: ${player.level})`,
        };
      }

      // Check that the prerequisite advancement quest is completed or turned in.
      // It may already be auto-turned-in by handleTalkNpc before the dialog opens.
      const prereqQuest = getAdvancementQuest(targetArchetype, 2);
      if (prereqQuest) {
        const qs = player.questState.find((q) => q.questId === prereqQuest.id);
        if (!qs || (qs.status !== "complete" && qs.status !== "turnedIn")) {
          return {
            success: false,
            message: `Complete the "${prereqQuest.name}" quest before advancing.`,
          };
        }
      }

      // Validate that branches exist for this archetype.
      const branches = getBranchesForArchetype(targetArchetype as ClassArchetype);
      if (branches.length === 0) {
        return {
          success: false,
          message: "No specializations available for your class yet.",
        };
      }

      // Send the branch list to the client — the client shows the selection panel.
      const branchListPayload: BranchListPayload = {
        branches: branches.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
        })),
        archetype: targetArchetype,
      };
      client.send(MessageType.BRANCH_LIST, branchListPayload);
      // Return null — the server will send JOB_ADVANCE after the client picks a branch.
      return null;
    }

    // Already advanced past tier 1, or mismatched archetype.
    return {
      success: false,
      message: `You are already a ${player.archetype}. You cannot advance again here.`,
    };
  }

  /** Handle the client's branch selection for 2nd-job advancement. */
  private handleBranchChoice(client: Client, msg: BranchChoicePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const branchId = msg?.branchId;
    if (!branchId) return;

    // Must be eligible: archetype matches, tier 1, level ≥ 30.
    if (player.jobTier !== 1 || player.level < 30) {
      client.send(MessageType.JOB_ADVANCE, {
        success: false,
        message: "You are not eligible for 2nd-job advancement.",
      });
      return;
    }

    const archetype = player.archetype as ClassArchetype;

    // Re-check prerequisite quest (defense in-depth — client could bypass dialog).
    const prereqQuest = getAdvancementQuest(archetype, 2);
    if (prereqQuest) {
      const qs = player.questState.find((q) => q.questId === prereqQuest.id);
      if (!qs || (qs.status !== "complete" && qs.status !== "turnedIn")) {
        client.send(MessageType.JOB_ADVANCE, {
          success: false,
          message: `Complete the "${prereqQuest.name}" quest before advancing.`,
        });
        return;
      }
    }

    const branch = getBranch(archetype, branchId);
    if (!branch) {
      client.send(MessageType.JOB_ADVANCE, {
        success: false,
        message: "Invalid specialization choice.",
      });
      return;
    }

    // ── Apply the branch advancement ──
    player.branchId = branchId;
    player.jobTier = 2;

    // Full heal on advancement.
    player.maxHp = maxHpForLevel(archetype, player.level);
    player.hp = player.maxHp;
    player.maxMp = maxMpForLevel(archetype, player.level);
    player.mp = player.maxMp;

    // Grant tier-2 skills from the chosen branch.
    const tier2 = branch.jobTiers.find((t) => t.tier === 2);
    if (tier2) {
      const existing = new Set(player.learnedSkills);
      for (const skill of tier2.skills) {
        if (!existing.has(skill.id)) player.learnedSkills.push(skill.id);
      }
    }

    this.persistPlayer(player);
    const acct2 = this.sessionAccount.get(client.sessionId);
    if (acct2) {
      track(AnalyticsEventType.JOB_ADVANCE, acct2, player.charId, {
        jobTier: 2,
        class: archetype,
        branchId,
        level: player.level,
      });
    }
    console.log(
      `[MapRoom] 2nd-job advancement: ${archetype} → ${branch.name} (${branchId}) (Lv${player.level}) ` +
        `char ${player.charId}.`,
    );

    client.send(MessageType.JOB_ADVANCE, {
      success: true,
      archetype,
      branchId,
      jobTier: 2,
      message: `You are now a ${branch.name}!`,
    });
  }

  // ─── Party (group play, session-scoped) ────────────────────────────────────

  private handlePartyInvite(client: Client, msg: PartyInvitePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const targetName = msg?.targetName?.trim();
    if (!targetName) return;

    // Resolve target by name in the global online registry (cross-map).
    const targetOm = partyManager.getOnlineByChar(this.findCharIdByName(targetName));
    if (!targetOm) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: `Player "${targetName}" not found online.`,
      });
      return;
    }

    // Block check: either player may have blocked the other.
    const senderAccId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
    if (accountStore.hasBlocked(senderAccId, targetOm.name)) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: "Cannot invite this player.",
      });
      return;
    }

    const err = partyManager.invite(player.charId, player.name, targetName);
    if (err) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: err,
      });
      return;
    }

    // Confirm to the inviter (invite notification is sent by partyManager.invite).
    client.send(MessageType.CHAT, {
      sessionId: "",
      name: "Party",
      text: `Party invite sent to ${targetOm.name}.`,
    });
  }

  private handlePartyAccept(client: Client, msg: PartyAcceptPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const fromCharId = msg?.fromCharId;
    if (!fromCharId) return;

    const fromOm = partyManager.getOnlineByChar(fromCharId);
    if (!fromOm) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: "Inviter is no longer online.",
      });
      return;
    }

    const result = partyManager.accept(
      player.charId,
      player.name,
      player.level,
      this.state.mapId,
      fromCharId,
    );

    if (typeof result === "string") {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: result,
      });
      return;
    }

    // Broadcast party update to all members (including cross-room).
    partyManager.syncPartyToAllMembers(result.party);

    // Notify all members via chat (cross-room).
    const memberNames = result.party.members.size;
    const chatText = `${player.name} joined the party! (${memberNames} members)`;
    for (const charId of result.party.members.keys()) {
      const om = partyManager.getOnlineByChar(charId);
      if (om) {
        om.send(MessageType.CHAT, {
          sessionId: "",
          name: "Party",
          text: chatText,
        });
      }
    }
  }

  private handlePartyLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = partyManager.leave(player.charId);
    if (!result) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: "You are not in a party.",
      });
      return;
    }

    // Notify remaining members via cross-room send callbacks.
    const chatText = `${player.name} left the party.${result.wasLeader ? " Leader reassigned." : ""}`;
    for (const charId of result.party.members.keys()) {
      const om = partyManager.getOnlineByChar(charId);
      if (om) {
        om.send(MessageType.CHAT, {
          sessionId: "",
          name: "Party",
          text: chatText,
        });
      }
    }

    // Send the leaving player a "no party" update.
    client.send(MessageType.PARTY_UPDATE, {
      partyId: "",
      members: [],
      lootRule: "ffa",
    } satisfies PartyUpdatePayload);

    // Sync remaining members (cross-room).
    if (result.party.members.size > 0) {
      partyManager.syncPartyToAllMembers(result.party);
    }
  }

  private handlePartyKick(client: Client, msg: PartyKickPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const targetCharId = msg?.targetCharId;
    if (!targetCharId) return;

    const result = partyManager.kick(player.charId, targetCharId);
    if (typeof result === "string") {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: result,
      });
      return;
    }

    // Notify the kicked player via cross-room send callback.
    const kickedOm = partyManager.getOnlineByChar(targetCharId);
    if (kickedOm) {
      kickedOm.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: `You have been kicked from the party by ${player.name}.`,
      });
      kickedOm.send(MessageType.PARTY_UPDATE, {
        partyId: "",
        members: [],
        lootRule: "ffa",
      } satisfies PartyUpdatePayload);
    }

    // Sync remaining members (cross-room).
    partyManager.syncPartyToAllMembers(result.party);

    // Notify remaining members via cross-room send callbacks.
    const chatText = `${result.kickedName} was kicked from the party.`;
    for (const charId of result.party.members.keys()) {
      const om = partyManager.getOnlineByChar(charId);
      if (om) {
        om.send(MessageType.CHAT, {
          sessionId: "",
          name: "Party",
          text: chatText,
        });
      }
    }
  }

  // ─── Party loot rule ──────────────────────────────────────────────────────
  private handlePartySetLootRule(client: Client, msg: PartySetLootRulePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg?.lootRule) return;

    const err = partyManager.setLootRule(player.charId, msg.lootRule);
    if (err) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party",
        text: err,
      });
      return;
    }

    const party = partyManager.getPartyByChar(player.charId);
    if (party) {
      partyManager.syncPartyToAllMembers(party);
      // Notify all members.
      for (const charId of party.members.keys()) {
        const om = partyManager.getOnlineByChar(charId);
        if (om) {
          om.send(MessageType.CHAT, {
            sessionId: "",
            name: "Party",
            text: `${player.name} changed the loot rule to ${msg.lootRule}.`,
          });
        }
      }
    }
  }

  // ─── LFG / Party Finder ──────────────────────────────────────────────────
  private handleLfgPost(client: Client, msg: LfgPostPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg) return;

    const result = partyManager.postLfg(
      player.charId,
      player.name,
      player.level,
      msg.contentType ?? "grind",
      msg.levelMin ?? 1,
      msg.levelMax ?? 200,
      msg.message ?? "",
    );

    if (typeof result === "string") {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party Finder",
        text: result,
      });
      return;
    }

    client.send(MessageType.CHAT, {
      sessionId: "",
      name: "Party Finder",
      text: `Listing posted: ${result.contentType} (Lv${result.levelMin}–${result.levelMax}).`,
    });
  }

  private handleLfgList(client: Client): void {
    const listings = partyManager.getLfgListings();
    client.send(MessageType.LFG_LIST_RESULT, { listings } satisfies LfgListResultPayload);
  }

  private handleLfgJoin(client: Client, msg: LfgJoinPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg?.listingId) return;

    const result = partyManager.joinLfg(
      player.charId,
      player.name,
      player.level,
      this.state.mapId,
      msg.listingId,
    );

    if (typeof result === "string") {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "Party Finder",
        text: result,
      });
      return;
    }

    // Broadcast party update to all members.
    partyManager.syncPartyToAllMembers(result.party);

    // Notify all members.
    for (const charId of result.party.members.keys()) {
      const om = partyManager.getOnlineByChar(charId);
      if (om) {
        om.send(MessageType.CHAT, {
          sessionId: "",
          name: "Party Finder",
          text: `${player.name} joined via Party Finder! (${result.party.members.size} members)`,
        });
      }
    }
  }

  private handleLfgRemove(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const removed = partyManager.removeLfg(player.charId);
    client.send(MessageType.CHAT, {
      sessionId: "",
      name: "Party Finder",
      text: removed ? "Listing removed." : "No active listing found.",
    });
  }

  // ─── Character persistence ────────────────────────────────────────────────
  /** Write the live Player state back to the durable CharacterRecord. */
  /**
   * Write a player's full authoritative state through to the durable store.
   *
   * This is the single source of truth for "what survives a disconnect / crash":
   * it snapshots the *entire* live `Player` schema (transform, vitals, progression,
   * stats, mesos, inventory, equipment, titles, quests, skills, and every
   * retention/QoL sub-system) into one transactional row write. Called on every
   * major event (level-up, trade, shop, travel, job advance), on `onLeave`, on the
   * periodic autosave, and on `onDispose` — so no single path is load-bearing.
   */
  private persistPlayer(player: Player): void {
    if (!player.charId) return;

    // Build equipped map from the synced schema.
    const equipped: Record<string, string> = {};
    player.equipped.forEach((uid, slot) => {
      equipped[slot] = uid;
    });

    // Snapshot the full inventory from the synced schema (the live source of truth),
    // preserving potential lines, flame bonus stats, star-force, and stack counts.
    const inventory: Record<string, import("../persistence/store").ItemRecord> = {};
    player.inventory.forEach((item, uid) => {
      let potentialLines: PotentialLine[];
      try {
        potentialLines = JSON.parse(item.potentialLines || "[]") as PotentialLine[];
      } catch {
        potentialLines = [];
      }
      let bonusStats: BonusStatLine[] | undefined;
      try {
        const parsed = JSON.parse(item.bonusStats || "[]") as BonusStatLine[];
        if (Array.isArray(parsed) && parsed.length > 0) bonusStats = parsed;
      } catch {
        bonusStats = undefined;
      }
      inventory[uid] = {
        uid: item.uid,
        defId: item.defId,
        baseRank: item.baseRank,
        potentialTier: item.potentialTier,
        lines: item.lines,
        minted: item.minted,
        potentialLines,
        ...(bonusStats ? { bonusStats } : {}),
        stars: item.stars,
        count: item.count,
      };
    });

    const sessionId = this.findSessionByPlayer(player);
    const familiars = sessionId ? this.familiarCollections.get(sessionId) : undefined;

    accountStore.updateCharacter(player.charId, {
      // Progression
      level: player.level,
      exp: player.exp,
      ap: player.ap,
      sp: player.sp,
      jobTier: player.jobTier,
      branchId: player.branchId,
      // Stats + vitals (HP/MP carry current values; maxHp/maxMp persisted for fidelity)
      stats: {
        STR: player.str,
        DEX: player.dex,
        INT: player.intel,
        LUK: player.luk,
        HP: player.hp,
        MP: player.mp,
      },
      maxHp: player.maxHp,
      maxMp: player.maxMp,
      mesos: player.mesos,
      // Transform (map + position so a reload resumes exactly where you left off)
      x: player.x,
      y: player.y,
      mapId: this.state.mapId || "meadowfield",
      // Items + equipment
      inventory,
      equipped,
      // Quests + skills
      quests: player.questState,
      learnedSkills: player.learnedSkills,
      skillBook: player.skillBook,
      // Cosmetics / titles
      ownedTitles: player.ownedTitles ? [...player.ownedTitles] : [],
      equippedTitle: player.equippedTitle,
      // Retention systems
      codex: player.codex,
      fame: player.fame,
      achievements: player.achievements,
      totalMesosEarned: player.totalMesosEarned,
      totalQuestsCompleted: player.totalQuestsCompleted,
      totalItemsCollected: player.totalItemsCollected,
      // QoL: quickslots, settings, auto-pot, macros, idle exploration
      quickslots: player.quickslots,
      settings: player.settings,
      autoPot: player.autoPot,
      macros: player.macros,
      exploration: player.exploration,
      familiars: familiars ?? undefined,
    });
  }

  /**
   * Flush every connected player's full state to the durable store. Used by the
   * periodic autosave and the graceful-shutdown path. Per-player failures are
   * isolated so one bad record can't abort the whole sweep.
   */
  private persistAllPlayers(): void {
    this.state.players.forEach((player) => {
      try {
        this.persistPlayer(player);
      } catch (err) {
        console.error(`[MapRoom] autosave failed for ${player.charId || "unknown"}:`, err);
      }
    });
  }

  // ─── Name validation ──────────────────────────────────────────────────────
  /**
   * Authoritative name check: format + profanity + reserved words (shared
   * format rules) plus global uniqueness. Returns a `{ code, message }` error
   * so callers can surface a distinct `name_taken` case, or `null` when valid.
   */
  private validateCharacterName(name: string): { code: string; message: string } | null {
    const formatError = validateCharacterNameFormat(name);
    if (formatError) return { code: "invalid_name", message: formatError };
    if (accountStore.characterNameExists(name.trim())) {
      return { code: NAME_TAKEN_CODE, message: NAME_TAKEN_MESSAGE };
    }
    return null;
  }

  // ─── CREATE_CHARACTER / DELETE_CHARACTER handlers ──────────────────────────
  private handleCreateCharacter(client: Client, msg: CreateCharacterPayload): void {
    const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
    const name = msg?.name ?? "";
    const err = this.validateCharacterName(name);
    if (err) {
      client.send("character_error", { reason: err.message, code: err.code });
      return;
    }
    if (accountStore.listCharacters(accountId).length >= MAX_CHARACTERS_PER_ACCOUNT) {
      client.send("character_error", {
        reason: `You can only have ${MAX_CHARACTERS_PER_ACCOUNT} characters.`,
      });
      return;
    }

    // ── Resolve class archetype from the payload ──────────────────────────
    const rawClass = (msg?.class ?? "").trim().toUpperCase();
    if (rawClass !== "" && !MapRoom.ADVANCEABLE.has(rawClass)) {
      client.send("character_error", {
        reason: `Invalid class '${msg?.class}'. Valid classes: WARRIOR, MAGE, ARCHER, THIEF, PIRATE.`,
      });
      return;
    }
    const requestedArchetype =
      rawClass !== "" ? (rawClass as ClassArchetype) : ClassArchetype.BEGINNER;

    const appearance = msg?.appearance ?? randomizeAppearance();
    const rec = accountStore.createCharacter(accountId, {
      name: name.trim(),
      archetype: requestedArchetype,
      appearance,
    });
    const className = getClass(requestedArchetype).name;
    client.send("character_created", { charId: rec.charId, name: rec.name, className });
    console.log(
      `[MapRoom] character created ${rec.charId} (${rec.name}) class=${className} for ${accountId}`,
    );
  }

  // ─── Cash Shop ─────────────────────────────────────────────────────────────
  private handleBuyCashItem(client: Client, msg: BuyCashItemPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const accountId = player.accountId;
    const itemId = msg?.itemId;
    if (!itemId) {
      client.send(MessageType.BUY_CASH_ITEM, {
        success: false,
        message: "Missing itemId.",
      } satisfies BuyCashItemResultPayload);
      return;
    }

    const def = getCashItem(itemId);
    if (!def) {
      client.send(MessageType.BUY_CASH_ITEM, {
        success: false,
        itemId,
        message: "Item not found in catalog.",
      } satisfies BuyCashItemResultPayload);
      return;
    }

    // Already owned?
    if (accountStore.hasCashItem(accountId, itemId)) {
      client.send(MessageType.BUY_CASH_ITEM, {
        success: false,
        itemId,
        message: "Already owned.",
      } satisfies BuyCashItemResultPayload);
      return;
    }

    // Deduct premium currency.
    if (!accountStore.spendCash(accountId, def.price)) {
      client.send(MessageType.BUY_CASH_ITEM, {
        success: false,
        itemId,
        message: `Not enough Maple Crystals. Need ${def.price}.`,
      } satisfies BuyCashItemResultPayload);
      return;
    }

    // Add to account cash inventory.
    accountStore.addCashInventory(accountId, itemId);
    const balance = accountStore.getCash(accountId);

    client.send(MessageType.BUY_CASH_ITEM, {
      success: true,
      itemId,
      balance,
      message: `Purchased ${def.name} for ${def.price} MC.`,
    } satisfies BuyCashItemResultPayload);
    console.log(`[MapRoom] cash buy ${itemId} by ${accountId} → balance ${balance}`);
  }

  private handleEquipCashItem(client: Client, msg: EquipCashItemPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const accountId = player.accountId;
    const charId = player.charId;
    const itemId = msg?.itemId;
    if (!itemId) {
      client.send(MessageType.EQUIP_CASH_ITEM, {
        success: false,
        message: "Missing itemId.",
      } satisfies EquipCashItemResultPayload);
      return;
    }

    // Must own the cash item.
    if (!accountStore.hasCashItem(accountId, itemId)) {
      client.send(MessageType.EQUIP_CASH_ITEM, {
        success: false,
        itemId,
        message: "You do not own this cash item.",
      } satisfies EquipCashItemResultPayload);
      return;
    }

    const def = getCashItem(itemId);
    if (!def) {
      client.send(MessageType.EQUIP_CASH_ITEM, {
        success: false,
        itemId,
        message: "Item not found in catalog.",
      } satisfies EquipCashItemResultPayload);
      return;
    }

    const category = def.category as CashCategory;

    // Only categories with appearance overrides can be equipped visually.
    const fields = appearanceFieldsForCategory(category);
    if (fields.length === 0) {
      client.send(MessageType.EQUIP_CASH_ITEM, {
        success: false,
        itemId,
        category,
        message: `Cannot equip a ${category} item cosmetically.`,
      } satisfies EquipCashItemResultPayload);
      return;
    }

    // Toggle: if the same item is already equipped, unequip it.
    const currentEquipped = accountStore.getEquippedCash(charId, category);
    if (currentEquipped?.itemId === itemId) {
      // Unequip — revert appearance fields to base.
      accountStore.unequipCashCategory(charId, category);
      const charRec = accountStore.getCharacter(charId);
      if (charRec) {
        const base = charRec.appearance;
        for (const field of fields) {
          (player as unknown as Record<keyof CharacterAppearance, string>)[field] = base[field];
        }
      }
      client.send(MessageType.EQUIP_CASH_ITEM, {
        success: true,
        itemId,
        category,
        equipped: false,
        message: `Unequipped ${def.name}.`,
      } satisfies EquipCashItemResultPayload);
      return;
    }

    // Equip — apply appearance override, recording durationDays for expiry tracking.
    accountStore.equipCashItem(charId, itemId, category, def.durationDays);
    if (def.appearanceOverride) {
      for (const field of fields) {
        const val = def.appearanceOverride[field];
        if (val !== undefined) {
          (player as unknown as Record<keyof CharacterAppearance, string>)[field] = val;
        }
      }
    }

    client.send(MessageType.EQUIP_CASH_ITEM, {
      success: true,
      itemId,
      category,
      equipped: true,
      message: `Equipped ${def.name}.`,
    } satisfies EquipCashItemResultPayload);
    console.log(`[MapRoom] cash equip ${itemId} (${category}) on ${charId}`);
  }

  private handleCashInfo(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const accountId = player.accountId;
    const charId = player.charId;

    const balance = accountStore.getCash(accountId);
    const owned = [...(accountStore.getOrCreate(accountId).cashInventory ?? [])];

    // Build equipped map: category → itemId
    const equipped: Record<string, string> = {};
    const charRec = accountStore.getCharacter(charId);
    if (charRec?.equippedCash) {
      for (const [cat, entry] of Object.entries(charRec.equippedCash)) {
        equipped[cat] = entry.itemId;
      }
    }

    client.send(MessageType.CASH_INFO, {
      balance,
      owned,
      equipped,
      charId,
    } satisfies CashInfoPayload);
  }

  private handleDeleteCharacter(client: Client, msg: DeleteCharacterPayload): void {
    const charId = msg?.charId;
    if (!charId) {
      client.send("character_error", { reason: "Missing charId." });
      return;
    }
    const rec = accountStore.getCharacter(charId);
    if (!rec) {
      client.send("character_error", { reason: "Character not found." });
      return;
    }
    // Only the owner can delete.
    const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
    if (rec.accountId !== accountId) {
      client.send("character_error", { reason: "Not your character." });
      return;
    }
    // Don't allow deleting a character that's currently online.
    for (const player of this.state.players.values()) {
      if (player.charId === charId) {
        client.send("character_error", { reason: "Character is currently online." });
        return;
      }
    }
    accountStore.deleteCharacter(charId);
    client.send("character_deleted", { charId });
    console.log(`[MapRoom] character deleted ${charId} by ${accountId}`);
  }

  // ─── Gear Equip / Unequip ─────────────────────────────────────────────────
  private handleEquip(client: Client, msg: EquipItemPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const uid = msg?.uid;
    if (!uid) return;

    // Item must exist in the player's inventory.
    const invItem = player.inventory.get(uid);
    if (!invItem) {
      client.send("equip_result", { success: false, message: "Item not in inventory." });
      return;
    }

    const def = getItemDef(invItem.defId);
    if (!def) {
      client.send("equip_result", { success: false, message: "Unknown item." });
      return;
    }

    // Authoritative requirement check — never trust the client.
    const equipCheck = canEquip(def, {
      level: player.level,
      stats: {
        STR: player.str,
        DEX: player.dex,
        INT: player.intel,
        LUK: player.luk,
        HP: player.hp,
        MP: player.mp,
      },
      archetype: player.archetype as ClassArchetype,
    });
    if (!equipCheck.ok) {
      client.send("equip_result", {
        success: false,
        message: equipCheck.reason ?? `Cannot equip ${def.name}.`,
      });
      return;
    }

    // ── Fame gate enforcement (rings require fame ≥ 100) ──
    const fameGateSlot = def.slot.startsWith("RING") ? "ring" : def.slot.toLowerCase();
    const fameCheck = meetsFameGate(player.fame.fame, fameGateSlot);
    if (!fameCheck.meets) {
      client.send("equip_result", {
        success: false,
        message: `Requires ${fameCheck.required} Fame, have ${player.fame.fame}.`,
      });
      return;
    }

    const slot =
      def.slot === EquipSlot.RING
        ? resolveRingSlot(player.equipped as unknown as Map<string, string>)
        : def.slot;

    // Equip: if slot is already occupied, the old item is simply unequipped (stays in bag).
    if (player.equipped.has(slot)) {
      player.equipped.delete(slot);
      accountStore.unequipItem(player.charId, slot);
    }

    player.equipped.set(slot, uid);
    accountStore.equipItem(player.charId, slot, uid);

    // Update attack type from equipped weapon.
    const invLookup = (id: string) => player.inventory.get(id)?.defId;
    const equippedRec = Object.fromEntries(player.equipped.entries());
    player.attackType = resolveAttackType(equippedRec, invLookup, player.archetype);

    client.send("equip_result", {
      success: true,
      slot,
      uid,
      message: `Equipped ${def.name}.`,
    });
    console.log(`[MapRoom] equip ${player.name}: ${def.name} → ${slot}`);
  }

  private handleUnequip(client: Client, msg: UnequipItemPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const slot = msg?.slot;
    if (!slot) return;

    if (!player.equipped.has(slot)) {
      client.send("equip_result", { success: false, message: "Slot not equipped." });
      return;
    }

    player.equipped.delete(slot);
    accountStore.unequipItem(player.charId, slot);

    // Update attack type from equipped weapon.
    const invLookup = (id: string) => player.inventory.get(id)?.defId;
    const equippedRec = Object.fromEntries(player.equipped.entries());
    player.attackType = resolveAttackType(equippedRec, invLookup, player.archetype);

    client.send("equip_result", {
      success: true,
      slot,
      message: `Unequipped ${slot}.`,
    });
    console.log(`[MapRoom] unequip ${player.name}: ${slot}`);
  }

  // ─── General Store (NPC mesos shop) ────────────────────────────────────────
  private handleBuyFromShop(client: Client, msg: BuyFromShopPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const shopId = msg?.shopId;
    const itemId = msg?.itemId;
    const qty = msg?.qty ?? 1;
    if (!shopId || !itemId || qty < 1) {
      client.send(MessageType.BUY_FROM_SHOP, {
        success: false,
        itemId: itemId ?? "",
        message: "Invalid shop buy request.",
      } satisfies BuyFromShopResultPayload);
      return;
    }

    const shop = getShopDef(shopId);
    if (!shop) {
      client.send(MessageType.BUY_FROM_SHOP, {
        success: false,
        itemId,
        message: "Shop not found.",
      } satisfies BuyFromShopResultPayload);
      return;
    }

    // NPC proximity: player must be near a shop NPC on this map.
    if (!this.isNearShopNpc(player, shopId)) {
      client.send(MessageType.BUY_FROM_SHOP, {
        success: false,
        itemId,
        message: "You must be near the shop NPC.",
      } satisfies BuyFromShopResultPayload);
      return;
    }

    const slot = shop.slots.find((s) => s.itemId === itemId);
    if (!slot) {
      client.send(MessageType.BUY_FROM_SHOP, {
        success: false,
        itemId,
        message: "Item not sold here.",
      } satisfies BuyFromShopResultPayload);
      return;
    }

    // Stock enforcement: reject if limited stock is exhausted.
    if (slot.stock !== undefined) {
      const remaining = this.getRemainingStock(shopId, itemId, slot.stock);
      if (qty > remaining) {
        client.send(MessageType.BUY_FROM_SHOP, {
          success: false,
          itemId,
          message: `Not enough stock. ${remaining} left.`,
        } satisfies BuyFromShopResultPayload);
        return;
      }
    }

    const totalCost = slot.buyPrice * qty;
    if (player.mesos < totalCost) {
      client.send(MessageType.BUY_FROM_SHOP, {
        success: false,
        itemId,
        message: `Not enough mesos. Need ${totalCost}, have ${player.mesos}.`,
      } satisfies BuyFromShopResultPayload);
      return;
    }

    // Inventory capacity: check the target tab has room before deducting mesos.
    const targetTab = tabForItem(itemId);
    const maxStack = targetTab === "EQUIP" ? 1 : targetTab === "USE" ? 100 : 200;
    if (maxStack === 1) {
      // Non-stackable: each unit needs a slot.
      const used = this.countTabEntries(player, targetTab);
      if (used + qty > TAB_CAPACITY[targetTab]) {
        client.send(MessageType.BUY_FROM_SHOP, {
          success: false,
          itemId,
          message: `${targetTab} inventory is full.`,
        } satisfies BuyFromShopResultPayload);
        return;
      }
    } else {
      // Stackable: check if existing stacks have room, or empty slots exist.
      let spaceAvailable = 0;
      player.inventory.forEach((item) => {
        if (item.defId === itemId) spaceAvailable += maxStack - (item.count || 1);
      });
      // Also count empty slots as potential new stacks.
      const used = this.countTabEntries(player, targetTab);
      spaceAvailable += (TAB_CAPACITY[targetTab] - used) * maxStack;
      if (spaceAvailable < qty) {
        client.send(MessageType.BUY_FROM_SHOP, {
          success: false,
          itemId,
          message: `${targetTab} inventory is full.`,
        } satisfies BuyFromShopResultPayload);
        return;
      }
    }

    // Deduct mesos.
    player.mesos -= totalCost;
    accountStore.setMesos(player.charId, player.mesos);

    if (isConsumable(itemId)) {
      // Stack: find existing stack or create new.
      let existingUid: string | undefined;
      player.inventory.forEach((item, uid) => {
        if (item.defId === itemId) existingUid = uid;
      });
      const existing = existingUid ? player.inventory.get(existingUid) : undefined;
      if (existingUid && existing) {
        existing.count = (existing.count || 1) + qty;
        // Persist updated count.
        const rec = accountStore.getItem(player.charId, existingUid);
        if (rec) {
          rec.count = existing.count;
          const char = accountStore.getCharacter(player.charId);
          if (char) {
            accountStore.updateCharacter(player.charId, {
              inventory: { ...char.inventory },
            });
          }
        }
      } else {
        // Create new stack.
        const item = new InventoryItem();
        item.uid = `item_${++this.idCounter}`;
        item.defId = itemId;
        item.baseRank = "NORMAL";
        item.potentialTier = "NORMAL";
        item.lines = 0;
        item.count = qty;
        player.inventory.set(item.uid, item);
        accountStore.addItem(player.charId, {
          uid: item.uid,
          defId: item.defId,
          baseRank: item.baseRank,
          potentialTier: item.potentialTier,
          lines: 0,
          minted: false,
          count: qty,
        });
      }
    } else {
      // Equipment: create a new instance per unit (each with random potential).
      for (let i = 0; i < qty; i++) {
        const item = new InventoryItem();
        item.uid = `item_${++this.idCounter}`;
        item.defId = itemId;
        item.baseRank = "NORMAL";
        const tier = rollPotential();
        item.potentialTier = tier;
        const potentials = rollPotentialLines(tier);
        item.lines = potentials.length;
        item.potentialLines = JSON.stringify(potentials);
        item.count = 1;
        player.inventory.set(item.uid, item);
        accountStore.addItem(player.charId, {
          uid: item.uid,
          defId: item.defId,
          baseRank: item.baseRank,
          potentialTier: item.potentialTier,
          lines: item.lines,
          minted: false,
          potentialLines: potentials,
          count: 1,
        });
      }
    }

    // Decrement stock if limited.
    if (slot.stock !== undefined) {
      const key = `${shopId}:${itemId}`;
      this.shopStock.set(key, (this.shopStock.get(key) ?? slot.stock) - qty);
    }

    client.send(MessageType.BUY_FROM_SHOP, {
      success: true,
      itemId,
      mesos: player.mesos,
      message: `Bought ${qty}x ${itemId} for ${totalCost} mesos.`,
    } satisfies BuyFromShopResultPayload);
    console.log(`[MapRoom] shop buy ${qty}x ${itemId} by ${player.name} → mesos ${player.mesos}`);
  }

  private handleSellToShop(client: Client, msg: SellToShopPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    // NPC proximity: must be near any shop NPC on this map.
    const npcs = getNpcsForMap(this.state.mapId);
    let nearShopNpc = false;
    for (const npc of npcs) {
      if (npc.role !== "shop") continue;
      const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
      if (dist <= NPC_INTERACT_RANGE) {
        nearShopNpc = true;
        break;
      }
    }
    if (!nearShopNpc) {
      client.send(MessageType.SELL_TO_SHOP, {
        success: false,
        uid: msg?.uid ?? "",
        message: "You must be near a shop NPC.",
      } satisfies SellToShopResultPayload);
      return;
    }

    const uid = msg?.uid;
    const qty = msg?.qty ?? 1;
    if (!uid || qty < 1) {
      client.send(MessageType.SELL_TO_SHOP, {
        success: false,
        uid: uid ?? "",
        message: "Invalid sell request.",
      } satisfies SellToShopResultPayload);
      return;
    }

    const invItem = player.inventory.get(uid);
    if (!invItem) {
      client.send(MessageType.SELL_TO_SHOP, {
        success: false,
        uid,
        message: "Item not in inventory.",
      } satisfies SellToShopResultPayload);
      return;
    }

    // Cannot sell equipped items.
    for (const equippedUid of player.equipped.values()) {
      if (equippedUid === uid) {
        client.send(MessageType.SELL_TO_SHOP, {
          success: false,
          uid,
          message: "Cannot sell an equipped item. Unequip it first.",
        } satisfies SellToShopResultPayload);
        return;
      }
    }

    // Look up sell price across all shops.
    const sellPrice = getItemSellPrice(invItem.defId);
    if (sellPrice === undefined) {
      client.send(MessageType.SELL_TO_SHOP, {
        success: false,
        uid,
        message: "This item cannot be sold to a shop.",
      } satisfies SellToShopResultPayload);
      return;
    }

    const itemQty = invItem.count || 1;
    if (qty > itemQty) {
      client.send(MessageType.SELL_TO_SHOP, {
        success: false,
        uid,
        message: `Only ${itemQty} in stack.`,
      } satisfies SellToShopResultPayload);
      return;
    }

    const totalSell = sellPrice * qty;

    // Decrement stack or remove.
    if (qty >= itemQty) {
      player.inventory.delete(uid);
      accountStore.removeItem(player.charId, uid);
    } else {
      invItem.count = itemQty - qty;
      const rec = accountStore.getItem(player.charId, uid);
      if (rec) {
        rec.count = invItem.count;
        const char = accountStore.getCharacter(player.charId);
        if (char) {
          accountStore.updateCharacter(player.charId, {
            inventory: { ...char.inventory },
          });
        }
      }
    }

    // Credit mesos.
    player.mesos += totalSell;
    accountStore.setMesos(player.charId, player.mesos);

    // ── Achievements: mesos_earned from selling ──────────────────────────
    this.processAchievementUnlocks(
      player,
      updateAchievementProgress(player.achievements, "mesos_earned", totalSell),
    );

    client.send(MessageType.SELL_TO_SHOP, {
      success: true,
      uid,
      mesos: player.mesos,
      message: `Sold ${qty}x ${invItem.defId} for ${totalSell} mesos.`,
    } satisfies SellToShopResultPayload);
    console.log(
      `[MapRoom] shop sell ${qty}x ${invItem.defId} by ${player.name} → mesos ${player.mesos}`,
    );
  }

  // ─── Shared Account Storage ─────────────────────────────────────────────────

  /** Push the full stash contents to a client. */
  private pushStorageSync(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const rec = accountStore.getCharacter(player.charId);
    if (!rec) return;
    const items = accountStore.getStorage(rec.accountId).map((item) => ({
      uid: item.uid,
      defId: item.defId,
      baseRank: item.baseRank,
      potentialTier: item.potentialTier,
      lines: item.lines,
      count: item.count ?? 1,
    }));
    client.send(MessageType.STORAGE_SYNC, { items, capacity: STORAGE_CAPACITY });
  }

  /** Deposit an item from the character's inventory into the account stash. */
  private handleStorageDeposit(client: Client, msg: StorageDepositPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const uid = msg?.uid;
    if (!uid) {
      client.send(MessageType.STORAGE_DEPOSIT, {
        success: false,
        message: "Missing item uid.",
      } satisfies StorageResultPayload);
      return;
    }

    // Only allow deposit while near a storage NPC (role === 'storage').
    if (!this.isNearStorageNpc(player)) {
      client.send(MessageType.STORAGE_DEPOSIT, {
        success: false,
        message: "You must be near a Storage NPC.",
      } satisfies StorageResultPayload);
      return;
    }

    // Cannot deposit an equipped item — must unequip first.
    for (const equippedUid of player.equipped.values()) {
      if (equippedUid === uid) {
        client.send(MessageType.STORAGE_DEPOSIT, {
          success: false,
          message: "Unequip the item first.",
        } satisfies StorageResultPayload);
        return;
      }
    }

    const qty = msg?.qty;
    const result = accountStore.depositToStorage(player.charId, uid, qty);
    if (!result.ok) {
      client.send(MessageType.STORAGE_DEPOSIT, {
        success: false,
        message: result.reason ?? "Deposit failed.",
      } satisfies StorageResultPayload);
      return;
    }

    // Send the deposit result BEFORE the sync, so the client handler fires first.
    client.send(MessageType.STORAGE_DEPOSIT, {
      success: true,
      message: "Item deposited.",
    } satisfies StorageResultPayload);

    // Sync the in-memory player state: remove the item from the Colyseus player.inventory map.
    player.inventory.delete(uid);
    this.pushStorageSync(client);
    console.log(`[MapRoom] storage deposit ${uid} by ${player.name}`);
  }

  /** Withdraw an item from the account stash into the character's inventory. */
  private handleStorageWithdraw(client: Client, msg: StorageWithdrawPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const uid = msg?.uid;
    if (!uid) {
      client.send(MessageType.STORAGE_WITHDRAW, {
        success: false,
        message: "Missing item uid.",
      } satisfies StorageResultPayload);
      return;
    }

    if (!this.isNearStorageNpc(player)) {
      client.send(MessageType.STORAGE_WITHDRAW, {
        success: false,
        message: "You must be near a Storage NPC.",
      } satisfies StorageResultPayload);
      return;
    }

    const qty = msg?.qty;
    const result = accountStore.withdrawFromStorage(player.charId, uid, qty);
    if (!result.ok) {
      client.send(MessageType.STORAGE_WITHDRAW, {
        success: false,
        message: result.reason ?? "Withdraw failed.",
      } satisfies StorageResultPayload);
      return;
    }

    client.send(MessageType.STORAGE_WITHDRAW, {
      success: true,
      message: "Item withdrawn.",
    } satisfies StorageResultPayload);

    // Sync the item into the in-memory Colyseus player.inventory.
    // The withdrawn item gets uid = `item_${stashUid}` — look it up deterministically.
    const newInvUid = `item_${uid}`;
    const withdrawnItem = accountStore.getItem(player.charId, newInvUid);
    if (withdrawnItem) {
      const syncItem = new InventoryItem();
      syncItem.uid = withdrawnItem.uid;
      syncItem.defId = withdrawnItem.defId;
      syncItem.baseRank = withdrawnItem.baseRank;
      syncItem.potentialTier = withdrawnItem.potentialTier;
      syncItem.lines = withdrawnItem.lines;
      syncItem.count = withdrawnItem.count ?? 1;
      player.inventory.set(withdrawnItem.uid, syncItem);
    }
    this.pushStorageSync(client);
    console.log(`[MapRoom] storage withdraw ${uid} by ${player.name}`);
  }

  /** Check if the player is within range of a storage NPC on this map. */
  private isNearStorageNpc(player: Player): boolean {
    const npcs = getNpcsForMap(this.state.mapId);
    for (const npc of npcs) {
      if (npc.role !== "storage") continue;
      const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
      if (dist <= NPC_INTERACT_RANGE) return true;
    }
    return false;
  }

  /** Check if the player is within range of any NPC that offers the given shop. */
  private isNearShopNpc(player: Player, shopId: string): boolean {
    const shop = getShopDef(shopId);
    if (!shop) return false;
    // Check the primary npcId first (fast path).
    const primary = NPCS[shop.npcId] as NpcDef | undefined;
    if (primary && primary.mapId === this.state.mapId) {
      const dist = Math.hypot(primary.x - player.x, primary.y - player.y);
      if (dist <= NPC_INTERACT_RANGE) return true;
    }
    // Fall back: scan all NPCs on this map that offer this shop.
    const npcs = getNpcsForMap(this.state.mapId);
    const npcIds = getShopNpcIds(shopId);
    for (const npc of npcs) {
      if (!npcIds.includes(npc.id)) continue;
      const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
      if (dist <= NPC_INTERACT_RANGE) return true;
    }
    return false;
  }

  /** Count how many distinct inventory entries belong to a given tab. */
  private countTabEntries(player: Player, tab: InventoryTab): number {
    let count = 0;
    player.inventory.forEach((item) => {
      if (tabForItem(item.defId) === tab) count++;
    });
    return count;
  }

  /** Get or initialize the remaining stock for a shop slot. */
  private getRemainingStock(shopId: string, itemId: string, initial: number): number {
    const key = `${shopId}:${itemId}`;
    const existing = this.shopStock.get(key);
    if (existing !== undefined) return existing;
    this.shopStock.set(key, initial);
    return initial;
  }

  // ─── Equipment Repair (mesos sink) ─────────────────────────────────────────

  /**
   * Repair equipment — pays a mesos upkeep fee. The fee is 5% of the item's shop
   * buy price (or a flat minimum of 5 mesos). This is a hard mesos sink: the fee
   * is burned from circulation and recorded in the treasury.
   */
  private handleRepairEquipment(client: Client, msg: RepairEquipmentPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    let totalCost = 0;
    const REPAIR_RATE = 0.05; // 5% of base shop buy price
    const REPAIR_MIN = 5;

    if (msg?.uid) {
      // Repair a single specific item (must be in inventory or equipped).
      const invItem = player.inventory.get(msg.uid);
      const equippedUid = msg.uid;
      let defId: string | undefined;
      if (invItem) {
        defId = invItem.defId;
      } else {
        // Check equipped items.
        for (const [, uid] of player.equipped) {
          if (uid === equippedUid) {
            const rec = accountStore.getItem(player.charId, uid);
            if (rec) defId = rec.defId;
          }
        }
      }
      if (!defId) {
        client.send(MessageType.REPAIR_EQUIPMENT, {
          success: false,
          cost: 0,
          mesos: player.mesos,
          message: "Item not found.",
        } satisfies RepairResultPayload);
        return;
      }
      const shopPrice = this.getItemBuyPrice(defId);
      totalCost = Math.max(REPAIR_MIN, Math.floor(shopPrice * REPAIR_RATE));
    } else {
      // Repair all equipped items.
      for (const [, uid] of player.equipped) {
        const rec = accountStore.getItem(player.charId, uid);
        if (!rec) continue;
        const shopPrice = this.getItemBuyPrice(rec.defId);
        totalCost += Math.max(REPAIR_MIN, Math.floor(shopPrice * REPAIR_RATE));
      }
    }

    if (totalCost <= 0) {
      client.send(MessageType.REPAIR_EQUIPMENT, {
        success: false,
        cost: 0,
        mesos: player.mesos,
        message: "Nothing to repair.",
      } satisfies RepairResultPayload);
      return;
    }

    // Authoritative burn: deduct mesos + record in treasury.
    if (!accountStore.burnMesos(player.charId, totalCost, "equipment_repair")) {
      client.send(MessageType.REPAIR_EQUIPMENT, {
        success: false,
        cost: 0,
        mesos: player.mesos,
        message: `Not enough mesos. Need ${totalCost}.`,
      } satisfies RepairResultPayload);
      return;
    }

    {
      const char = accountStore.getCharacter(player.charId);
      if (char) player.mesos = char.mesos;
    }
    client.send(MessageType.REPAIR_EQUIPMENT, {
      success: true,
      cost: totalCost,
      mesos: player.mesos,
      message: `Repaired equipment for ${totalCost} mesos.`,
    } satisfies RepairResultPayload);
    console.log(
      `[MapRoom] repair ${player.name}: ${totalCost} mesos burned (treasury: ${treasuryStore.snapshot().totalBurned})`,
    );
  }

  // ─── Cube Reroll (potential reroll — the signature gacha loop) ──────────────

  /**
   * Authoritatively reroll an item's potential tier + bonus stat lines.
   * Consumes CUBE_REROLL_COST mesos, applies the public weighted table, persists,
   * and broadcasts the before/after to the client.
   *
   * This is the off-chain MVP of the Cube system. On-chain (Phase 2), this becomes
   * an $MAPLE spend + Chainlink VRF call in the smart contract.
   */
  private handleCubeReroll(client: Client, msg: CubeRerollPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const uid = msg?.uid;
    if (!uid || typeof uid !== "string") {
      client.send(MessageType.CUBE_REROLL, {
        success: false,
        message: "Invalid item uid.",
      } satisfies CubeRerollResultPayload);
      return;
    }

    // ── 1. Find the item in inventory ─────────────────────────────────────────
    const invItem = player.inventory.get(uid);
    if (!invItem) {
      client.send(MessageType.CUBE_REROLL, {
        success: false,
        message: "Item not found in inventory.",
      } satisfies CubeRerollResultPayload);
      return;
    }

    // ── 2. Capture BEFORE state ────────────────────────────────────────────────
    const prevTier = invItem.potentialTier;
    let prevLines: PotentialLine[] = [];
    if (invItem.potentialLines) {
      try {
        prevLines = JSON.parse(invItem.potentialLines) as PotentialLine[];
      } catch {
        prevLines = [];
      }
    }

    // ── 3. Burn mesos (authoritative — deducted + recorded in treasury) ────────
    if (!accountStore.burnMesos(player.charId, CUBE_REROLL_COST, "cube_reroll")) {
      client.send(MessageType.CUBE_REROLL, {
        success: false,
        message: `Not enough mesos. Cube reroll costs ${CUBE_REROLL_COST}.`,
      } satisfies CubeRerollResultPayload);
      return;
    }
    {
      const char = accountStore.getCharacter(player.charId);
      if (char) player.mesos = char.mesos;
    }

    // ── 4. Roll new potential (authoritative — server-only RNG) ────────────────
    // Use Date.now() as a simple seed for the verifiable roll shape.
    // On-chain this becomes the Chainlink VRF request seed.
    const rollSeed = Date.now();
    // Deterministic mulberry32 PRNG seeded from rollSeed — no Math.random() contamination.
    let _rngState = rollSeed >>> 0;
    const rng = (): number => {
      _rngState = (_rngState + 0x6d2b79f5) | 0;
      let t = Math.imul(_rngState ^ (_rngState >>> 15), 1 | _rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let prevBonusStats: import("@maple/shared").BonusStatLine[] | undefined;
    if (invItem.bonusStats) {
      try {
        prevBonusStats = JSON.parse(invItem.bonusStats);
      } catch {
        /* ignore */
      }
    }
    const rerolled = rerollPotential(
      {
        uid,
        defId: invItem.defId,
        baseRank: invItem.baseRank as import("@maple/shared").BaseRank,
        potentialTier: prevTier as import("@maple/shared").PotentialTier,
        potentialLines: prevLines,
        ...(prevBonusStats ? { bonusStats: prevBonusStats } : {}),
      },
      rng,
    );

    // ── 5. Update Colyseus state ──────────────────────────────────────────────
    invItem.potentialTier = rerolled.potentialTier;
    invItem.potentialLines = JSON.stringify(rerolled.potentialLines);
    invItem.lines = rerolled.potentialLines.length;

    // ── 6. Flag legendary mints (Phase 2 hook) ──────────────────────────────
    const mintPending = isMintWorthy(rerolled.potentialTier);
    if (mintPending) {
      console.log(
        `[MapRoom] ★ LEGENDARY REROLL ★ ${player.name} rolled ${rerolled.potentialTier} on ${invItem.defId} (uid=${uid}) — mintPending`,
      );
    }

    // ── 7. Persist to store ───────────────────────────────────────────────────
    accountStore.addItem(player.charId, {
      uid,
      defId: invItem.defId,
      baseRank: invItem.baseRank,
      potentialTier: rerolled.potentialTier,
      lines: rerolled.potentialLines.length,
      minted: invItem.minted,
      potentialLines: [...rerolled.potentialLines],
      ...(mintPending ? { mintPending: true } : {}),
    });

    // ── 8. Build verifiable-roll shape ────────────────────────────────────────
    const verifiable = createVerifiableRoll(rollSeed, rerolled.potentialTier);

    // ── 9. Broadcast before/after to the client ───────────────────────────────
    client.send(MessageType.CUBE_REROLL, {
      success: true,
      uid,
      prevTier,
      prevLines,
      newTier: rerolled.potentialTier,
      newLines: rerolled.potentialLines,
      mesos: player.mesos,
      rollSeed: verifiable.seed,
      rollCommitment: verifiable.commitment,
      ...(mintPending ? { mintPending: true } : {}),
      message: `Rerolled ${prevTier} → ${rerolled.potentialTier} for ${CUBE_REROLL_COST} mesos.${mintPending ? " ★ Legendary — mint pending!" : ""}`,
    } satisfies CubeRerollResultPayload);

    console.log(
      `[MapRoom] cube ${player.name}: ${prevTier} → ${rerolled.potentialTier} (${rerolled.potentialLines.length} lines, ${CUBE_REROLL_COST} mesos burned)`,
    );
  }

  // ─── Flame (Bonus Stat Reroll) ─────────────────────────────────────────────

  /**
   * Authoritatively re-roll an item's bonus (flame) stat lines.
   * Consumes FLAME_REROLL_COST mesos, rolls new bonus stats using item level scaling,
   * persists, and broadcasts the before/after to the client.
   */
  private handleFlameReroll(client: Client, msg: FlameRerollPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const uid = msg?.uid;
    if (!uid || typeof uid !== "string") {
      client.send(MessageType.FLAME_REROLL, {
        success: false,
        message: "Invalid item uid.",
      } satisfies FlameRerollResultPayload);
      return;
    }

    // ── 1. Find the item in inventory ─────────────────────────────────────────
    const invItem = player.inventory.get(uid);
    if (!invItem) {
      client.send(MessageType.FLAME_REROLL, {
        success: false,
        message: "Item not found in inventory.",
      } satisfies FlameRerollResultPayload);
      return;
    }

    // ── 2. Capture BEFORE state ────────────────────────────────────────────────
    let prevBonus: BonusStatLine[] = [];
    if (invItem.bonusStats) {
      try {
        prevBonus = JSON.parse(invItem.bonusStats) as BonusStatLine[];
      } catch {
        prevBonus = [];
      }
    }

    // ── 3. Burn mesos (authoritative — deducted + recorded in treasury) ────────
    if (!accountStore.burnMesos(player.charId, FLAME_REROLL_COST, "flame_reroll")) {
      client.send(MessageType.FLAME_REROLL, {
        success: false,
        message: `Not enough mesos. Flame reroll costs ${FLAME_REROLL_COST}.`,
      } satisfies FlameRerollResultPayload);
      return;
    }
    {
      const char = accountStore.getCharacter(player.charId);
      if (char) player.mesos = char.mesos;
    }

    // ── 4. Roll new bonus stats (server-only RNG) ──────────────────────────────
    const rollSeed = Date.now();
    let _rngState = rollSeed >>> 0;
    const rng = (): number => {
      _rngState = (_rngState + 0x6d2b79f5) | 0;
      let t = Math.imul(_rngState ^ (_rngState >>> 15), 1 | _rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const def = getItemDef(invItem.defId);
    const itemLevel = def?.levelReq ?? 1;
    const rerolled = rerollBonusStats(
      {
        uid,
        defId: invItem.defId,
        baseRank: invItem.baseRank as import("@maple/shared").BaseRank,
        potentialTier: invItem.potentialTier as import("@maple/shared").PotentialTier,
        potentialLines: [],
      },
      itemLevel,
      rng,
    );
    const newBonus = rerolled.bonusStats ?? [];

    // ── 5. Update Colyseus state ──────────────────────────────────────────────
    invItem.bonusStats = JSON.stringify(newBonus);

    // ── 6. Persist to store ───────────────────────────────────────────────────
    // Carry forward stars so flame reroll doesn't erase star-force progress.
    accountStore.addItem(player.charId, {
      uid,
      defId: invItem.defId,
      baseRank: invItem.baseRank,
      potentialTier: invItem.potentialTier,
      lines: invItem.lines,
      minted: invItem.minted,
      potentialLines: invItem.potentialLines ? JSON.parse(invItem.potentialLines) : [],
      bonusStats: [...newBonus],
      ...(invItem.stars !== undefined ? { stars: invItem.stars } : {}),
    });

    // ── 7. Broadcast before/after to the client ───────────────────────────────
    client.send(MessageType.FLAME_REROLL, {
      success: true,
      uid,
      prevBonus,
      newBonus,
      mesos: player.mesos,
      message: `Flame re-rolled for ${FLAME_REROLL_COST} mesos.`,
    } satisfies FlameRerollResultPayload);

    console.log(
      `[MapRoom] flame ${player.name}: ${newBonus.length} lines on ${invItem.defId} (uid=${uid}, ${FLAME_REROLL_COST} mesos burned)`,
    );
  }

  // ─── Base-Rank Upgrade (NORMAL→ENHANCED→STARFORGED→MYTHIC) ─────────────────

  /**
   * Authoritatively attempt a single base-rank upgrade step on an inventory item.
   * Charges mesos + upgrade shards (both are mesos/material sinks), rolls success
   * with server RNG, applies the rank change, and persists + broadcasts the result.
   */
  private handleUpgradeItem(client: Client, msg: UpgradeItemPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const uid = msg?.uid;
    if (!uid || typeof uid !== "string") {
      client.send(MessageType.UPGRADE_ITEM, {
        success: false,
        message: "Invalid item uid.",
      } satisfies UpgradeItemResultPayload);
      return;
    }

    // ── 1. Find the item in inventory ────────────────────────────────────────
    const invItem = player.inventory.get(uid);
    if (!invItem) {
      client.send(MessageType.UPGRADE_ITEM, {
        success: false,
        message: "Item not found in inventory.",
      } satisfies UpgradeItemResultPayload);
      return;
    }

    // ── 2. Resolve current rank and check it isn't already max ────────────────
    const currentRank = invItem.baseRank as import("@maple/shared").BaseRank;
    const nextRank = nextBaseRank(currentRank);
    if (!nextRank) {
      client.send(MessageType.UPGRADE_ITEM, {
        success: false,
        uid,
        prevRank: currentRank,
        newRank: currentRank,
        message: "Item is already at maximum rank (Mythic).",
      } satisfies UpgradeItemResultPayload);
      return;
    }

    // ── 3. Compute costs ─────────────────────────────────────────────────────
    const mesosCost = upgradeCost(nextRank);
    const shardCount = upgradeMaterialCost(nextRank);

    // ── 4. Check mesos balance ───────────────────────────────────────────────
    if (player.mesos < mesosCost) {
      client.send(MessageType.UPGRADE_ITEM, {
        success: false,
        uid,
        prevRank: currentRank,
        newRank: currentRank,
        message: `Not enough mesos. Upgrade costs ${mesosCost} mesos, you have ${player.mesos}.`,
      } satisfies UpgradeItemResultPayload);
      return;
    }

    // ── 5. Check upgrade shards ──────────────────────────────────────────────
    let shardUid: string | null = null;
    let shardCountAvailable = 0;
    player.inventory.forEach((item, itemUid) => {
      if (item.defId === UPGRADE_SHARD_DEF_ID) {
        shardUid = itemUid;
        shardCountAvailable += item.count;
      }
    });
    if (shardCountAvailable < shardCount) {
      client.send(MessageType.UPGRADE_ITEM, {
        success: false,
        uid,
        prevRank: currentRank,
        newRank: currentRank,
        message: `Not enough ${"Aether Shard"}s. Need ${shardCount}, have ${shardCountAvailable}.`,
      } satisfies UpgradeItemResultPayload);
      return;
    }

    // ── 6. Burn mesos (authoritative) ────────────────────────────────────────
    if (!accountStore.burnMesos(player.charId, mesosCost, "rank_upgrade")) {
      client.send(MessageType.UPGRADE_ITEM, {
        success: false,
        uid,
        prevRank: currentRank,
        newRank: currentRank,
        message: `Failed to deduct ${mesosCost} mesos.`,
      } satisfies UpgradeItemResultPayload);
      return;
    }
    {
      const char = accountStore.getCharacter(player.charId);
      if (char) player.mesos = char.mesos;
    }

    // ── 7. Consume upgrade shards ────────────────────────────────────────────
    if (shardUid) {
      const shardItem = player.inventory.get(shardUid);
      if (shardItem) {
        const remaining = shardCountAvailable - shardCount;
        if (remaining <= 0) {
          player.inventory.delete(shardUid);
          accountStore.removeItem(player.charId, shardUid);
        } else {
          shardItem.count = remaining;
          accountStore.addItem(player.charId, {
            uid: shardUid,
            defId: UPGRADE_SHARD_DEF_ID,
            baseRank: "NORMAL",
            potentialTier: "RARE",
            lines: 0,
            minted: false,
            count: remaining,
          });
        }
      }
    }

    // ── 8. Roll upgrade (authoritative server RNG) ───────────────────────────
    const rollSeed = Date.now();
    let _rngState = rollSeed >>> 0;
    const rng = (): number => {
      _rngState = (_rngState + 0x6d2b79f5) | 0;
      let t = Math.imul(_rngState ^ (_rngState >>> 15), 1 | _rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const result = upgradeBaseRank(currentRank, { rng, allowDowngrade: false });

    // ── 9. Apply result ─────────────────────────────────────────────────────
    if (!result) {
      // Shouldn't reach here (checked above), but safety.
      client.send(MessageType.UPGRADE_ITEM, {
        success: false,
        uid,
        prevRank: currentRank,
        newRank: currentRank,
        message: "Item is already at maximum rank.",
      } satisfies UpgradeItemResultPayload);
      return;
    }

    const newRank = result.newRank;
    const success = result.ok;
    const downgraded = !success && "downgraded" in result && result.downgraded === true;

    // Update Colyseus state
    invItem.baseRank = newRank;

    // Persist — carry forward bonusStats and stars so rank-up
    // doesn't erase existing flame / star-force data.
    accountStore.addItem(player.charId, {
      uid,
      defId: invItem.defId,
      baseRank: newRank,
      potentialTier: invItem.potentialTier,
      lines: invItem.lines,
      minted: invItem.minted,
      potentialLines: invItem.potentialLines ? JSON.parse(invItem.potentialLines) : [],
      ...(invItem.bonusStats ? { bonusStats: JSON.parse(invItem.bonusStats) } : {}),
      ...(invItem.stars !== undefined ? { stars: invItem.stars } : {}),
    });

    // ── 10. Broadcast ────────────────────────────────────────────────────────
    const label = getBaseRankInfo(newRank).label;
    client.send(MessageType.UPGRADE_ITEM, {
      success,
      uid,
      prevRank: currentRank,
      newRank,
      mesos: player.mesos,
      downgraded: downgraded || undefined,
      message: success
        ? `Upgrade succeeded! ${currentRank} → ${newRank} (${label}) for ${mesosCost} mesos + ${shardCount} shards.`
        : downgraded
          ? `Upgrade failed. ${currentRank} → ${newRank} (demoted). ${mesosCost} mesos + ${shardCount} shards consumed.`
          : `Upgrade failed. ${currentRank} rank unchanged. ${mesosCost} mesos + ${shardCount} shards consumed.`,
    } satisfies UpgradeItemResultPayload);

    if (success) {
      console.log(
        `[MapRoom] ★ RANK UP ★ ${player.name}: ${currentRank} → ${newRank} on ${invItem.defId} (uid=${uid})`,
      );
    } else {
      console.log(
        `[MapRoom] rank-up FAIL ${player.name}: ${currentRank} on ${invItem.defId} (uid=${uid})`,
      );
    }
  }

  // ─── Star Force (per-star enhancement) ──────────────────────────────────────
  private handleStarForce(client: Client, msg: StarForcePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const uid = msg?.uid;
    if (!uid || typeof uid !== "string") {
      client.send(MessageType.STAR_FORCE, {
        success: false,
        message: "Invalid item uid.",
      } satisfies StarForceResultPayload);
      return;
    }

    // ── 1. Find the item in inventory ────────────────────────────────────────
    const invItem = player.inventory.get(uid);
    if (!invItem) {
      client.send(MessageType.STAR_FORCE, {
        success: false,
        message: "Item not found in inventory.",
      } satisfies StarForceResultPayload);
      return;
    }

    // ── 2. Check current stars and max ───────────────────────────────────────
    const currentStars = invItem.stars ?? 0;
    if (currentStars >= 15 /* MAX_STARS */) {
      client.send(MessageType.STAR_FORCE, {
        success: false,
        uid,
        prevStars: currentStars,
        newStars: currentStars,
        message: "Item already at maximum stars (15★).",
      } satisfies StarForceResultPayload);
      return;
    }

    // ── 3. Check that a star-force tier exists for this star level ────────────
    const sfTier = getStarForceTier(currentStars);
    if (!sfTier) {
      client.send(MessageType.STAR_FORCE, {
        success: false,
        uid,
        prevStars: currentStars,
        newStars: currentStars,
        message: "No star-force data for this star level.",
      } satisfies StarForceResultPayload);
      return;
    }

    // ── 4. Compute costs ─────────────────────────────────────────────────────
    const mesosCost = starForceCost(currentStars);
    const shardCount = starForceMaterialCost(currentStars);

    // ── 5. Check mesos balance ───────────────────────────────────────────────
    if (player.mesos < mesosCost) {
      client.send(MessageType.STAR_FORCE, {
        success: false,
        uid,
        prevStars: currentStars,
        newStars: currentStars,
        message: `Not enough mesos. Star Force costs ${mesosCost} mesos, you have ${player.mesos}.`,
      } satisfies StarForceResultPayload);
      return;
    }

    // ── 6. Check upgrade shards ──────────────────────────────────────────────
    let shardUid: string | null = null;
    let shardCountAvailable = 0;
    player.inventory.forEach((item, itemUid) => {
      if (item.defId === UPGRADE_SHARD_DEF_ID) {
        shardUid = itemUid;
        shardCountAvailable += item.count;
      }
    });
    if (shardCountAvailable < shardCount) {
      client.send(MessageType.STAR_FORCE, {
        success: false,
        uid,
        prevStars: currentStars,
        newStars: currentStars,
        message: `Not enough Aether Shards. Need ${shardCount}, have ${shardCountAvailable}.`,
      } satisfies StarForceResultPayload);
      return;
    }

    // ── 7. Burn mesos (authoritative) ────────────────────────────────────────
    if (!accountStore.burnMesos(player.charId, mesosCost, "star_force")) {
      client.send(MessageType.STAR_FORCE, {
        success: false,
        uid,
        prevStars: currentStars,
        newStars: currentStars,
        message: `Failed to deduct ${mesosCost} mesos.`,
      } satisfies StarForceResultPayload);
      return;
    }
    {
      const char = accountStore.getCharacter(player.charId);
      if (char) player.mesos = char.mesos;
    }

    // ── 8. Consume upgrade shards ────────────────────────────────────────────
    if (shardUid) {
      const shardItem = player.inventory.get(shardUid);
      if (shardItem) {
        const remaining = shardCountAvailable - shardCount;
        if (remaining <= 0) {
          player.inventory.delete(shardUid);
          accountStore.removeItem(player.charId, shardUid);
        } else {
          shardItem.count = remaining;
          accountStore.addItem(player.charId, {
            uid: shardUid,
            defId: UPGRADE_SHARD_DEF_ID,
            baseRank: "NORMAL",
            potentialTier: "RARE",
            lines: 0,
            minted: false,
            count: remaining,
          });
        }
      }
    }

    // ── 9. Roll star force (authoritative server RNG) ─────────────────────────
    const rollSeed = Date.now();
    let _rngState = rollSeed >>> 0;
    const rng = (): number => {
      _rngState = (_rngState + 0x6d2b79f5) | 0;
      let t = Math.imul(_rngState ^ (_rngState >>> 15), 1 | _rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const result = rollStarForce(currentStars, rng);
    if (!result) {
      client.send(MessageType.STAR_FORCE, {
        success: false,
        uid,
        prevStars: currentStars,
        newStars: currentStars,
        message: "Item is already at maximum stars.",
      } satisfies StarForceResultPayload);
      return;
    }

    const { outcome, newStars } = result;

    // ── 10. Apply result ────────────────────────────────────────────────────
    if (outcome === "destroy") {
      // Item is destroyed — remove from inventory entirely.
      player.inventory.delete(uid);
      accountStore.removeItem(player.charId, uid);

      client.send(MessageType.STAR_FORCE, {
        success: false,
        outcome: "destroy",
        uid,
        prevStars: currentStars,
        newStars: 0,
        mesos: player.mesos,
        message: `Star Force failed! The item was DESTROYED. ${mesosCost} mesos + ${shardCount} shards consumed.`,
      } satisfies StarForceResultPayload);
      console.log(
        `[MapRoom] ★ STAR DESTROYED ★ ${player.name}: ${invItem.defId} (uid=${uid}) at ${currentStars}★`,
      );
      return;
    }

    if (outcome === "success") {
      invItem.stars = newStars;
    }
    // On fail, stars stay the same (newStars === currentStars).

    // Persist — carry forward bonusStats so star-force doesn't erase flame data.
    accountStore.addItem(player.charId, {
      uid,
      defId: invItem.defId,
      baseRank: invItem.baseRank,
      potentialTier: invItem.potentialTier,
      lines: invItem.lines,
      minted: invItem.minted,
      stars: outcome === "success" ? newStars : currentStars,
      potentialLines: invItem.potentialLines ? JSON.parse(invItem.potentialLines) : [],
      ...(invItem.bonusStats ? { bonusStats: JSON.parse(invItem.bonusStats) } : {}),
    });

    // ── 11. Broadcast ───────────────────────────────────────────────────────
    const label =
      outcome === "success" ? `${currentStars}★ → ${newStars}★` : `${currentStars}★ unchanged`;
    client.send(MessageType.STAR_FORCE, {
      success: outcome === "success",
      outcome,
      uid,
      prevStars: currentStars,
      newStars: outcome === "success" ? newStars : currentStars,
      mesos: player.mesos,
      message:
        outcome === "success"
          ? `Star Force succeeded! ${label} for ${mesosCost} mesos + ${shardCount} shards.`
          : `Star Force failed. ${label}. ${mesosCost} mesos + ${shardCount} shards consumed.`,
    } satisfies StarForceResultPayload);

    if (outcome === "success") {
      console.log(
        `[MapRoom] ★ STAR FORCE ★ ${player.name}: ${currentStars}★ → ${newStars}★ on ${invItem.defId} (uid=${uid})`,
      );
    } else {
      console.log(
        `[MapRoom] star-force FAIL ${player.name}: ${currentStars}★ on ${invItem.defId} (uid=${uid})`,
      );
    }
  }

  /** Look up the shop buy price for an item (used for repair cost calculation). */
  private getItemBuyPrice(defId: string): number {
    const shop = getShopDef("shop.meadow_basic");
    if (!shop) return 0;
    const slot = shop.slots.find((s) => s.itemId === defId);
    return slot?.buyPrice ?? 0;
  }

  // ─── AP Spending ─────────────────────────────────────────────────────────
  private handleSpendAp(client: Client, msg: SpendApPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const stat = msg?.stat;
    const validStats = ["STR", "DEX", "INT", "LUK", "HP", "MP"] as const;
    if (!stat || !validStats.includes(stat)) {
      client.send("spend_ap_result", { success: false, message: "Invalid stat." });
      return;
    }

    if (player.ap <= 0) {
      client.send("spend_ap_result", { success: false, message: "No AP remaining." });
      return;
    }

    const currentStats = {
      STR: player.str,
      DEX: player.dex,
      INT: player.intel,
      LUK: player.luk,
      HP: player.hp,
      MP: player.mp,
    };
    const newStats = spendAp(currentStats, stat);

    player.str = newStats.STR;
    player.dex = newStats.DEX;
    player.intel = newStats.INT;
    player.luk = newStats.LUK;
    player.ap -= 1;

    if (stat === "HP") {
      player.maxHp += 10;
      player.hp = newStats.HP;
    } else if (stat === "MP") {
      player.maxMp += 6;
      player.mp = newStats.MP;
    }

    this.persistPlayer(player);

    client.send("spend_ap_result", {
      success: true,
      stat,
      ap: player.ap,
      str: player.str,
      dex: player.dex,
      intel: player.intel,
      luk: player.luk,
      hp: player.hp,
      maxHp: player.maxHp,
      mp: player.mp,
      maxMp: player.maxMp,
    });
    console.log(`[MapRoom] ${player.name} spent 1 AP → ${stat} (ap remaining: ${player.ap})`);
  }

  // ─── SP Spending (Skill Learning) ──────────────────────────────────────
  private handleSkillBook(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    client.send(MessageType.SKILL_BOOK, {
      book: { ...player.skillBook },
    } satisfies SkillBookResponsePayload);
  }

  private handleLearnSkill(client: Client, msg: LearnSkillPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const skillId = msg?.skillId;
    if (!skillId || typeof skillId !== "string") {
      client.send(MessageType.LEARN_SKILL, {
        success: false,
        skillId: skillId ?? "",
        message: "Missing or invalid skillId.",
      } satisfies LearnSkillResultPayload);
      return;
    }

    // Must have unspent SP.
    if (player.sp <= 0) {
      client.send(MessageType.LEARN_SKILL, {
        success: false,
        skillId,
        message: "No SP remaining.",
      } satisfies LearnSkillResultPayload);
      return;
    }

    // Delegate to the shared pure validator — checks job tier, levelReq,
    // prerequisites, max level, and total SP budget, and branch-choice gate.
    const result = learnSkill(
      player.skillBook,
      player.archetype as ClassArchetype,
      player.level,
      skillId,
      player.branchId || undefined,
    );

    if (!result.ok) {
      client.send(MessageType.LEARN_SKILL, {
        success: false,
        skillId,
        message: result.reason ?? "Skill learn rejected.",
      } satisfies LearnSkillResultPayload);
      return;
    }

    // Apply authoritatively.
    if (result.book) player.skillBook = result.book;
    player.sp -= 1;

    this.persistPlayer(player);

    // Broadcast the updated book to the requesting client.
    client.send(MessageType.LEARN_SKILL, {
      success: true,
      skillId,
      sp: player.sp,
      book: { ...player.skillBook },
      message: `Learned ${skillId} (sp remaining: ${player.sp}).`,
    } satisfies LearnSkillResultPayload);

    console.log(
      `[MapRoom] ${player.name} learned ${skillId} (sp remaining: ${player.sp}, book size: ${spSpent(player.skillBook)})`,
    );
  }

  // ─── Quickslot Hotbar ───────────────────────────────────────────────────

  private handleSkillCast(client: Client, msg: SkillCastPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    const skillId = msg?.skillId;
    if (!skillId || typeof skillId !== "string") {
      client.send(MessageType.SKILL_CAST, {
        success: false,
        skillId: skillId ?? "",
        cooldownMs: 0,
        message: "Missing skillId.",
      } satisfies SkillCastResultPayload);
      return;
    }

    // 1. Find the SkillDef.
    const skill = allSkillsForClass(player.archetype as ClassArchetype).find(
      (s) => s.id === skillId,
    );
    if (!skill) {
      client.send(MessageType.SKILL_CAST, {
        success: false,
        skillId,
        cooldownMs: 0,
        message: `Unknown skill "${skillId}" for ${player.archetype}.`,
      } satisfies SkillCastResultPayload);
      return;
    }

    // 2. Check learned.
    const learnedLvl = player.skillBook[skillId] ?? 0;
    if (learnedLvl <= 0) {
      client.send(MessageType.SKILL_CAST, {
        success: false,
        skillId,
        cooldownMs: 0,
        message: "Skill not learned.",
      } satisfies SkillCastResultPayload);
      return;
    }

    // 3. Check cooldown.
    const remainingCd = player.skillCooldowns.get(skillId) ?? 0;
    if (remainingCd > 0) {
      client.send(MessageType.SKILL_CAST, {
        success: false,
        skillId,
        cooldownMs: remainingCd,
        message: `Skill on cooldown (${Math.ceil(remainingCd / 1000)}s).`,
      } satisfies SkillCastResultPayload);
      return;
    }

    // 4. Resolve MP cost.
    const stats = skillStatAt(skill, learnedLvl);
    if (player.mp < stats.mpCost) {
      client.send(MessageType.SKILL_CAST, {
        success: false,
        skillId,
        cooldownMs: 0,
        message: `Not enough MP (${player.mp}/${stats.mpCost}).`,
      } satisfies SkillCastResultPayload);
      return;
    }

    // 5. Deduct MP, set cooldown.
    player.mp -= stats.mpCost;
    if (stats.cooldownMs > 0) {
      player.skillCooldowns.set(skillId, stats.cooldownMs);
    }

    // 6. Apply effect based on skill kind.
    if (skill.kind === "buff" && stats.buffEffect) {
      // Buff skill — apply effect server-side and broadcast to clients.
      const effect = skillBuffToStatusEffect(
        skillId,
        stats.buffEffect,
        stats.buffDurationMs,
        player.name,
      );
      player.activeEffects = applyEffect(player.activeEffects, effect);
      player.effectElapsed.set(skillId, 0);

      // Broadcast status effects for client UI.
      this.syncPlayerEffects(player);
    } else if (skill.kind === "active") {
      // Attack skill — use skill's damagePercent and hitCount instead of defaults.
      const base = this.buildAttackerStats(player);
      const attackerStats = {
        ...base,
        skillDamagePercent: stats.damagePercent,
        hitCount: stats.hitCount,
      };

      const targetCount = stats.targetCount;
      let hitCount = 0;
      // Hoist session lookup out of the mob loop — constant for this caster.
      const casterSession = this.findSessionByPlayer(player);
      this.state.mobs.forEach((mob) => {
        if (mob.dead) return;
        if (hitCount >= targetCount) return;
        // Use magic range for skill attacks (more generous).
        if (!this.inRange(mob, player, ATTACK_RANGE_MAGIC)) return;
        hitCount++;

        const mobDef = getMobDef(mob.mobId);
        const effectiveDef = getEffectiveMobDef(mobDef, mob.isElite);
        const defender: DefenderCombatStats = {
          wDef: effectiveDef?.wDef ?? 0,
          mDef: effectiveDef?.mDef ?? 0,
          avoid: effectiveDef?.avoid ?? 0,
          level: effectiveDef?.level ?? 1,
        };
        const result = computeDamage(attackerStats, defender, {
          element: skill.element,
          targetElementMods: mobDef?.elementMods,
        });
        if (result.hit && result.total > 0) {
          mob.hp -= result.total;
          mob.hit = true;
          mob.hitTimer = 120;
          if (mob.hp <= 0) this.killMob(mob, player);
        }
        this.broadcast(MessageType.COMBAT_HIT, {
          targetKey: this.mobKeyByRef.get(mob) ?? "",
          attackerSession: casterSession,
          damage: result.total,
          crit: result.crit,
          hit: result.hit,
          mobHp: Math.max(0, mob.hp),
          mobMaxHp: mob.maxHp,
          elementMultiplier: result.elementMultiplier,
        } satisfies CombatHitPayload);

        // Apply debuff from skill to the hit mob.
        if (stats.debuffEffect && result.hit && !mob.dead) {
          const debuffs = skillDebuffToStatusEffects(skillId, stats.debuffEffect, player.name);
          for (const debuff of debuffs) {
            mob.activeEffects = applyEffect(mob.activeEffects, debuff);
            mob.effectElapsed.set(debuff.id, 0);
          }
        }
      });
    }

    // 7. Return success with cooldown.
    client.send(MessageType.SKILL_CAST, {
      success: true,
      skillId,
      cooldownMs: stats.cooldownMs,
      message: `Cast ${skill.name}.`,
    } satisfies SkillCastResultPayload);
  }

  private handleUseConsumable(client: Client, msg: UseConsumablePayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const defId = msg?.defId;
    if (!defId || typeof defId !== "string") {
      client.send(MessageType.USE_CONSUMABLE, {
        success: false,
        defId: defId ?? "",
        cooldownMs: 0,
        message: "Missing defId.",
      } satisfies UseConsumableResultPayload);
      return;
    }

    // 1. Look up consumable definition.
    const conDef = getConsumableDef(defId);
    if (!conDef) {
      client.send(MessageType.USE_CONSUMABLE, {
        success: false,
        defId,
        cooldownMs: 0,
        message: `Unknown consumable "${defId}".`,
      } satisfies UseConsumableResultPayload);
      return;
    }

    // 2. Check player has the item in inventory with count > 0.
    let foundUid = "";
    let foundCount = 0;
    player.inventory.forEach((item, uid) => {
      if (item.defId === defId && item.count > 0) {
        foundUid = uid;
        foundCount = item.count;
      }
    });
    if (!foundUid) {
      client.send(MessageType.USE_CONSUMABLE, {
        success: false,
        defId,
        cooldownMs: 0,
        message: "Item not in inventory.",
      } satisfies UseConsumableResultPayload);
      return;
    }

    // 3. Check cooldown.
    const remainingCd = player.consumableCooldowns.get(defId) ?? 0;
    if (remainingCd > 0) {
      client.send(MessageType.USE_CONSUMABLE, {
        success: false,
        defId,
        cooldownMs: remainingCd,
        message: `On cooldown (${Math.ceil(remainingCd / 1000)}s).`,
      } satisfies UseConsumableResultPayload);
      return;
    }

    // 4. Apply effect.
    const effect = conDef.effect;
    if (effect.kind === "heal") {
      if (effect.hp) {
        if (effect.percent) {
          player.hp = Math.min(
            player.maxHp,
            player.hp + Math.floor((player.maxHp * effect.hp) / 100),
          );
        } else {
          player.hp = Math.min(player.maxHp, player.hp + effect.hp);
        }
      }
      if (effect.mp) {
        if (effect.percent) {
          player.mp = Math.min(
            player.maxMp,
            player.mp + Math.floor((player.maxMp * effect.mp) / 100),
          );
        } else {
          player.mp = Math.min(player.maxMp, player.mp + effect.mp);
        }
      }
    } else if (effect.kind === "buff") {
      this.broadcast(MessageType.STATUS_EFFECTS, {
        effects: [
          {
            id: defId,
            kind: "buff",
            label: conDef.name,
            stacks: 1,
            durationMs: effect.durationMs,
            remainingMs: effect.durationMs,
          },
        ],
      });
    } else if (effect.kind === "recall") {
      // Recall — teleport to destination (handled via travel message).
      // For now, heal to full as fallback.
      player.hp = player.maxHp;
      player.mp = player.maxMp;
    }

    // 5. Decrement item count (remove if 0).
    const invItem = player.inventory.get(foundUid);
    if (invItem) {
      if (foundCount <= 1) {
        player.inventory.delete(foundUid);
      } else {
        invItem.count = foundCount - 1;
      }
    }

    // 6. Set cooldown.
    if (conDef.cooldownMs > 0) {
      player.consumableCooldowns.set(defId, conDef.cooldownMs);
    }

    // 7. Return success.
    client.send(MessageType.USE_CONSUMABLE, {
      success: true,
      defId,
      cooldownMs: conDef.cooldownMs,
      message: `Used ${conDef.name}.`,
    } satisfies UseConsumableResultPayload);
  }

  private handleQuickslotLayout(client: Client, msg: QuickSlotLayoutPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.charId) return;
    const slots = msg?.slots;
    if (!Array.isArray(slots)) return;
    // Validate: max 12 entries, each is null or {type, id}.
    const validated: typeof player.quickslots = [];
    for (let i = 0; i < Math.min(slots.length, 12); i++) {
      const s = slots[i];
      if (s && (s.type === "skill" || s.type === "consumable") && typeof s.id === "string") {
        validated.push({ type: s.type, id: s.id });
      } else {
        validated.push(null);
      }
    }
    player.quickslots = validated;
    accountStore.setQuickslots(player.charId, validated);
  }

  private handleSettingsSync(client: Client, msg: SettingsPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.charId) return;
    const incoming = msg?.settings;
    if (!incoming || typeof incoming !== "object") return;

    // Merge with defaults to ensure all fields are present.
    const settings = structuredClone(DEFAULT_SETTINGS);
    if (incoming.keyMap && typeof incoming.keyMap === "object") {
      settings.keyMap = incoming.keyMap;
    }
    if (incoming.video && typeof incoming.video === "object") {
      settings.video = { ...settings.video, ...incoming.video };
    }
    if (incoming.audio && typeof incoming.audio === "object") {
      settings.audio = { ...settings.audio, ...incoming.audio };
    }
    if (incoming.gameplay && typeof incoming.gameplay === "object") {
      settings.gameplay = { ...settings.gameplay, ...incoming.gameplay };
    }

    player.settings = settings;
    accountStore.setSettings(player.charId, settings);
  }

  // ─── Combat QoL: Loot-All ───────────────────────────────────────────────

  private handlePickupAll(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const now = Date.now();
    // Throttle: max 1 loot-all per 300ms per player.
    const lastLootAll = this.lastLootAllAt.get(client.sessionId) ?? 0;
    if (now - lastLootAll < 300) return;
    this.lastLootAllAt.set(client.sessionId, now);

    const toPickup: string[] = [];
    this.state.loot.forEach((drop, uid) => {
      const dist = Math.hypot(drop.x - player.x, drop.y - player.y);
      if (dist <= PICKUP_RANGE) toPickup.push(uid);
    });

    let actuallyPicked = 0;
    for (const uid of toPickup) {
      // Re-validate each drop — it may have been picked up or despawned.
      const drop = this.state.loot.get(uid);
      if (!drop) continue;
      const dist = Math.hypot(drop.x - player.x, drop.y - player.y);
      if (dist > PICKUP_RANGE) continue;

      // Ownership window check (same as handlePickup).
      if (!this.canLoot(client.sessionId, player.charId, drop)) continue;

      // Party loot rule check (same as handlePickup).
      if (!partyManager.canPickup(player.charId)) continue;

      // ── Capacity check per drop (same as handlePickup) ─────────────────
      const targetTab = tabForItem(drop.defId);
      const maxStack = MAX_STACK[targetTab];
      if (maxStack === 1) {
        const used = this.countTabEntries(player, targetTab);
        if (used >= TAB_CAPACITY[targetTab]) continue; // tab full, skip this drop
      } else {
        let spaceAvailable = 0;
        player.inventory.forEach((item) => {
          if (item.defId === drop.defId) spaceAvailable += maxStack - (item.count || 1);
        });
        const used = this.countTabEntries(player, targetTab);
        spaceAvailable += (TAB_CAPACITY[targetTab] - used) * maxStack;
        if (spaceAvailable < 1) continue; // no room, skip this drop
      }

      // ── Try stacking first ─────────────────────────────────────────────
      if (maxStack > 1) {
        let stacked = false;
        player.inventory.forEach((existing, existingUid) => {
          if (stacked) return;
          if (existing.defId === drop.defId && (existing.count || 1) < maxStack) {
            existing.count = (existing.count || 1) + 1;
            const rec = accountStore.getItem(player.charId, existingUid);
            if (rec) {
              rec.count = existing.count;
              const char = accountStore.getCharacter(player.charId);
              if (char) {
                accountStore.updateCharacter(player.charId, {
                  inventory: { ...char.inventory },
                });
              }
            }
            stacked = true;
          }
        });
        if (stacked) {
          actuallyPicked++;
          this.state.loot.delete(drop.uid);
          if (progressObjectives(player.questState, "collect", drop.defId, 1)) {
            sendQuestUpdate(client, player.questState);
          }
          continue;
        }
      }

      // ── Create new inventory entry ─────────────────────────────────────
      const item = new InventoryItem();
      item.uid = `item_${++this.idCounter}`;
      item.defId = drop.defId;
      item.potentialTier = drop.potentialTier;
      item.lines = drop.lines;
      item.baseRank = "NORMAL";
      const potentials = rollPotentialLines(
        drop.potentialTier as import("@maple/shared").PotentialTier,
      );
      item.potentialLines = JSON.stringify(potentials);
      item.count = 1;
      player.inventory.set(item.uid, item);

      accountStore.addItem(player.charId, {
        uid: item.uid,
        defId: item.defId,
        baseRank: item.baseRank,
        potentialTier: item.potentialTier,
        lines: item.lines,
        minted: false,
        potentialLines: potentials,
      });

      if (drop.legendary) {
        this.pendingMints.push({
          session: client.sessionId,
          itemUid: item.uid,
          defId: item.defId,
          tier: drop.potentialTier,
        });
      }

      this.state.loot.delete(drop.uid);
      actuallyPicked++;

      if (progressObjectives(player.questState, "collect", item.defId, 1)) {
        sendQuestUpdate(client, player.questState);
      }
    }
    // ── Achievements: items_collected from loot-all ──────────────────────
    if (actuallyPicked > 0) {
      player.totalItemsCollected += actuallyPicked;
      accountStore.incrementLifetimeCounter(player.charId, "totalItemsCollected", actuallyPicked);
      this.processAchievementUnlocks(
        player,
        updateAchievementProgress(player.achievements, "items_collected", actuallyPicked),
      );
    }
  }

  // ─── Inventory Sort (server-authoritative) ─────────────────────────────────

  private handleInventorySort(client: Client, msg: InventorySortPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.charId) return;
    const tab = msg?.tab;
    if (tab !== "EQUIP" && tab !== "USE" && tab !== "ETC" && tab !== "CASH") return;

    // Collect all non-equipped items in this tab.
    const equippedUids = new Set<string>();
    player.equipped.forEach((uid) => equippedUids.add(uid));

    const tabItems: { uid: string; item: InventoryItem }[] = [];
    const otherItems: { uid: string; item: InventoryItem }[] = [];
    player.inventory.forEach((item, uid) => {
      if (equippedUids.has(uid)) return;
      if (tabForItem(item.defId) === tab) {
        tabItems.push({ uid, item });
      } else {
        otherItems.push({ uid, item });
      }
    });

    // Sort: by defId ascending, then count descending.
    tabItems.sort((a, b) => {
      const defCmp = a.item.defId.localeCompare(b.item.defId);
      if (defCmp !== 0) return defCmp;
      return (b.item.count || 1) - (a.item.count || 1);
    });

    // Re-insert in sorted order: delete all tab items, then re-set in order.
    for (const { uid } of tabItems) player.inventory.delete(uid);
    for (const { uid, item } of tabItems) player.inventory.set(uid, item);
    // Re-insert non-tab items (preserving their original order).
    for (const { uid, item } of otherItems) player.inventory.set(uid, item);
  }

  // ─── Combat QoL: Skill Macros ───────────────────────────────────────────

  private handleMacroCast(client: Client, msg: MacroCastPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    const macroId = msg?.macroId;
    if (!macroId || typeof macroId !== "string") return;

    const macro = player.macros.find((m) => m.id === macroId);
    if (!macro) return;

    // Execute each step independently — reused handlers validate + send results.
    for (const step of macro.steps) {
      if (step.type === "skill") {
        this.handleSkillCast(client, { skillId: step.id });
      } else if (step.type === "consumable") {
        this.handleUseConsumable(client, { defId: step.id });
      }
    }
  }

  private handleMacroLayout(client: Client, msg: MacroLayoutPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.charId) return;
    const incoming = msg?.macros;
    if (!Array.isArray(incoming)) return;

    // Validate: max 5 macros, max 10 steps each.
    const validated: SkillMacro[] = [];
    for (let i = 0; i < Math.min(incoming.length, 5); i++) {
      const m = incoming[i];
      if (!m || typeof m.id !== "string" || typeof m.name !== "string" || !Array.isArray(m.steps))
        continue;
      const steps: MacroStep[] = [];
      for (let j = 0; j < Math.min(m.steps.length, 10); j++) {
        const s = m.steps[j];
        if (s && (s.type === "skill" || s.type === "consumable") && typeof s.id === "string") {
          steps.push({ type: s.type, id: s.id });
        }
      }
      if (steps.length > 0) {
        validated.push({ id: m.id, name: m.name.slice(0, 32), steps });
      }
    }
    player.macros = validated;
    accountStore.setMacros(player.charId, validated);
  }

  private handleAutoPotSync(client: Client, msg: AutoPotSyncPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.charId) return;
    const incoming = msg?.config;
    if (!incoming || typeof incoming !== "object") return;

    const config: AutoPotConfig = {
      hpEnabled: !!incoming.hpEnabled,
      hpThreshold: Math.max(0, Math.min(100, Number(incoming.hpThreshold) || 50)),
      mpEnabled: !!incoming.mpEnabled,
      mpThreshold: Math.max(0, Math.min(100, Number(incoming.mpThreshold) || 50)),
      hpPotionId:
        typeof incoming.hpPotionId === "string" && isConsumable(incoming.hpPotionId)
          ? incoming.hpPotionId
          : "pot.large_hp",
      mpPotionId:
        typeof incoming.mpPotionId === "string" && isConsumable(incoming.mpPotionId)
          ? incoming.mpPotionId
          : "pot.large_mp",
    };
    player.autoPot = config;
    accountStore.setAutoPot(player.charId, config);
  }

  // ─── Two-Party Trade ───────────────────────────────────────────────────

  /** Look up the active trade for a session (either side). */
  private getTradeForSession(sessionId: string): TradeSession | undefined {
    return this.activeTrades.get(sessionId);
  }

  /** Cancel + clean up a trade, notifying both parties. */
  private cancelTradeForSession(sessionId: string, reason: string): void {
    const trade = this.activeTrades.get(sessionId);
    if (!trade) return;
    this.cancelTrade(trade, reason);
  }

  /** Cancel a trade and notify both clients. */
  private cancelTrade(trade: TradeSession, reason: string): void {
    this.activeTrades.delete(trade.a.sessionId);
    this.activeTrades.delete(trade.b.sessionId);
    const payload: TradeResultPayload = {
      success: false,
      itemsReceived: [],
      itemsSent: [],
      mesosReceived: 0,
      mesosSent: 0,
      message: reason,
    };
    const aClient = this.findClientBySession(trade.a.sessionId);
    const bClient = this.findClientBySession(trade.b.sessionId);
    aClient?.send(MessageType.TRADE_RESULT, payload);
    bClient?.send(MessageType.TRADE_RESULT, payload);
    console.log(`[MapRoom] trade cancelled: ${reason}`);
  }

  /** Find a Colyseus Client by session id. */
  private findClientBySession(sessionId: string): Client | undefined {
    for (const c of this.clients) {
      if (c.sessionId === sessionId) return c;
    }
    return undefined;
  }

  /** Push the current trade state to both parties. */
  private pushTradeState(trade: TradeSession): void {
    const aClient = this.findClientBySession(trade.a.sessionId);
    const bClient = this.findClientBySession(trade.b.sessionId);
    if (aClient) {
      aClient.send(MessageType.TRADE_UPDATE, {
        partnerSessionId: trade.b.sessionId,
        partnerName: trade.b.player.name,
        myOffer: [...trade.a.offerItems],
        myMesos: trade.a.offerMesos,
        partnerOffer: [...trade.b.offerItems],
        partnerMesos: trade.b.offerMesos,
        myLocked: trade.a.locked,
        partnerLocked: trade.b.locked,
        myConfirmed: trade.a.confirmed,
        partnerConfirmed: trade.b.confirmed,
      } satisfies TradeUpdatePayload);
    }
    if (bClient) {
      bClient.send(MessageType.TRADE_UPDATE, {
        partnerSessionId: trade.a.sessionId,
        partnerName: trade.a.player.name,
        myOffer: [...trade.b.offerItems],
        myMesos: trade.b.offerMesos,
        partnerOffer: [...trade.a.offerItems],
        partnerMesos: trade.a.offerMesos,
        myLocked: trade.b.locked,
        partnerLocked: trade.a.locked,
        myConfirmed: trade.b.confirmed,
        partnerConfirmed: trade.a.confirmed,
      } satisfies TradeUpdatePayload);
    }
  }

  /** Validate that a player owns an item (in inventory, not equipped). */
  private validateItemOwnership(player: Player, uid: string): boolean {
    if (!player.inventory.has(uid)) return false;
    for (const equippedUid of player.equipped.values()) {
      if (equippedUid === uid) return false;
    }
    return true;
  }

  /** Count unique inventory items for capacity check. */
  private countInventoryItems(player: Player): number {
    let count = 0;
    player.inventory.forEach(() => count++);
    return count;
  }

  // ─── Trade: Invite ─────────────────────────────────────────────────────
  private handleTradeInvite(client: Client, msg: TradeInvitePayload): void {
    const sender = this.state.players.get(client.sessionId);
    if (!sender || sender.dead) return;

    const targetSid = msg?.targetSessionId;
    if (!targetSid) return;

    // Cannot invite yourself.
    if (targetSid === client.sessionId) {
      client.send(MessageType.TRADE_RESULT, {
        success: false,
        itemsReceived: [],
        itemsSent: [],
        mesosReceived: 0,
        mesosSent: 0,
        message: "Cannot trade with yourself.",
      } satisfies TradeResultPayload);
      return;
    }

    // Target must exist.
    const target = this.state.players.get(targetSid);
    if (!target || target.dead) return;

    // Proximity check.
    const dx = Math.abs(sender.x - target.x);
    const dy = Math.abs(sender.y - target.y);
    if (dx > TRADE_RANGE_X || dy > TRADE_RANGE_Y) {
      client.send(MessageType.TRADE_RESULT, {
        success: false,
        itemsReceived: [],
        itemsSent: [],
        mesosReceived: 0,
        mesosSent: 0,
        message: "Too far away to trade.",
      } satisfies TradeResultPayload);
      return;
    }

    // Block check: either player may have blocked the other.
    const senderAccId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
    const targetAccId = this.sessionAccount.get(targetSid);
    if (
      accountStore.hasBlocked(senderAccId, target.name) ||
      (targetAccId && accountStore.hasBlocked(targetAccId, sender.name))
    ) {
      client.send(MessageType.TRADE_RESULT, {
        success: false,
        itemsReceived: [],
        itemsSent: [],
        mesosReceived: 0,
        mesosSent: 0,
        message: "Cannot trade with this player.",
      } satisfies TradeResultPayload);
      return;
    }

    // Same-account check: prevent self-trading between alts.
    if (targetAccId && senderAccId === targetAccId) {
      client.send(MessageType.TRADE_RESULT, {
        success: false,
        itemsReceived: [],
        itemsSent: [],
        mesosReceived: 0,
        mesosSent: 0,
        message: "Cannot trade with your own account.",
      } satisfies TradeResultPayload);
      return;
    }

    // Neither party can already be in a trade.
    if (this.activeTrades.has(client.sessionId)) {
      client.send(MessageType.TRADE_RESULT, {
        success: false,
        itemsReceived: [],
        itemsSent: [],
        mesosReceived: 0,
        mesosSent: 0,
        message: "You are already in a trade.",
      } satisfies TradeResultPayload);
      return;
    }
    if (this.activeTrades.has(targetSid)) {
      client.send(MessageType.TRADE_RESULT, {
        success: false,
        itemsReceived: [],
        itemsSent: [],
        mesosReceived: 0,
        mesosSent: 0,
        message: "That player is already in a trade.",
      } satisfies TradeResultPayload);
      return;
    }

    // Create the trade session.
    const tradeId = `trade_${++this.tradeSeq}`;
    const trade: TradeSession = {
      id: tradeId,
      a: {
        sessionId: client.sessionId,
        charId: sender.charId,
        player: sender,
        offerItems: [],
        offerMesos: 0,
        locked: false,
        confirmed: false,
      },
      b: {
        sessionId: targetSid,
        charId: target.charId,
        player: target,
        offerItems: [],
        offerMesos: 0,
        locked: false,
        confirmed: false,
      },
      phase: "negotiating",
    };

    this.activeTrades.set(client.sessionId, trade);
    this.activeTrades.set(targetSid, trade);

    // Notify both parties.
    this.pushTradeState(trade);
    console.log(`[MapRoom] trade invite: ${sender.name} → ${target.name}`);
  }

  // ─── Trade: Accept ─────────────────────────────────────────────────────
  private handleTradeAccept(client: Client, msg: TradeAcceptPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const _fromSid = msg?.fromSessionId;
    if (!_fromSid) return;

    const trade = this.activeTrades.get(client.sessionId);
    if (!trade) return;
    // This player must be side b and phase must be negotiating.
    if (trade.b.sessionId !== client.sessionId) return;
    if (trade.phase !== "negotiating") return;

    // Accept just means "I'm ready" — push state so both see the window.
    this.pushTradeState(trade);
  }

  // ─── Trade: Reject ─────────────────────────────────────────────────────
  private handleTradeReject(client: Client, msg: TradeRejectPayload): void {
    const _fromSid = msg?.fromSessionId;
    if (!_fromSid) return;

    const trade = this.activeTrades.get(client.sessionId);
    if (!trade) return;
    if (trade.b.sessionId !== client.sessionId) return;

    this.cancelTrade(trade, "Trade rejected.");
  }

  // ─── Trade: Cancel ─────────────────────────────────────────────────────
  private handleTradeCancel(client: Client): void {
    const trade = this.activeTrades.get(client.sessionId);
    if (!trade) return;
    this.cancelTrade(trade, "Trade cancelled.");
  }

  // ─── Trade: Offer ──────────────────────────────────────────────────────
  private handleTradeOffer(client: Client, msg: TradeOfferPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const trade = this.activeTrades.get(client.sessionId);
    if (!trade) return;
    if (trade.phase !== "negotiating") return;

    // Identify which side this client is.
    const side = trade.a.sessionId === client.sessionId ? trade.a : trade.b;
    const otherSide = trade.a.sessionId === client.sessionId ? trade.b : trade.a;

    // If either side is locked, reject further modifications.
    if (side.locked || otherSide.locked) {
      client.send(MessageType.TRADE_RESULT, {
        success: false,
        itemsReceived: [],
        itemsSent: [],
        mesosReceived: 0,
        mesosSent: 0,
        message: "Cannot modify offer after locking.",
      } satisfies TradeResultPayload);
      return;
    }

    // Reset confirm if offers change.
    side.confirmed = false;
    otherSide.confirmed = false;
    trade.phase = "negotiating";

    // Handle mesos offer.
    if (msg.mesos !== undefined) {
      const mesos = Math.max(0, Math.floor(msg.mesos));
      if (mesos > player.mesos) {
        client.send(MessageType.TRADE_RESULT, {
          success: false,
          itemsReceived: [],
          itemsSent: [],
          mesosReceived: 0,
          mesosSent: 0,
          message: `Not enough mesos. You have ${player.mesos}.`,
        } satisfies TradeResultPayload);
        return;
      }
      side.offerMesos = mesos;
    }

    // Handle item offer.
    if (msg.itemUid) {
      const uid = msg.itemUid;
      const add = msg.add !== false; // default: add

      if (add) {
        // Validate: item must be in inventory and not equipped.
        if (!this.validateItemOwnership(player, uid)) {
          client.send(MessageType.TRADE_RESULT, {
            success: false,
            itemsReceived: [],
            itemsSent: [],
            mesosReceived: 0,
            mesosSent: 0,
            message: "Item not in inventory or is equipped.",
          } satisfies TradeResultPayload);
          return;
        }

        // Don't allow duplicate uids in the same offer.
        if (side.offerItems.includes(uid)) {
          client.send(MessageType.TRADE_RESULT, {
            success: false,
            itemsReceived: [],
            itemsSent: [],
            mesosReceived: 0,
            mesosSent: 0,
            message: "Item already in your offer.",
          } satisfies TradeResultPayload);
          return;
        }

        side.offerItems.push(uid);
      } else {
        // Remove from offer.
        const idx = side.offerItems.indexOf(uid);
        if (idx === -1) {
          client.send(MessageType.TRADE_RESULT, {
            success: false,
            itemsReceived: [],
            itemsSent: [],
            mesosReceived: 0,
            mesosSent: 0,
            message: "Item not in your offer.",
          } satisfies TradeResultPayload);
          return;
        }
        side.offerItems.splice(idx, 1);
      }
    }

    this.pushTradeState(trade);
  }

  // ─── Trade: Lock ───────────────────────────────────────────────────────
  private handleTradeLock(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const trade = this.activeTrades.get(client.sessionId);
    if (!trade) return;
    if (trade.phase !== "negotiating") return;

    const side = trade.a.sessionId === client.sessionId ? trade.a : trade.b;
    const otherSide = trade.a.sessionId === client.sessionId ? trade.b : trade.a;

    // Re-validate: all offered items must still be in the player's inventory and not equipped.
    for (const uid of side.offerItems) {
      if (!this.validateItemOwnership(player, uid)) {
        this.cancelTrade(trade, "Offered item no longer available.");
        return;
      }
    }

    // Re-validate mesos.
    if (side.offerMesos > player.mesos) {
      this.cancelTrade(trade, "Not enough mesos for your offer.");
      return;
    }

    // Capacity pre-check: the other side must have room for all items we're sending.
    const otherInvCount = this.countInventoryItems(otherSide.player);
    if (otherInvCount + side.offerItems.length > TRADE_MAX_INVENTORY_SLOTS) {
      client.send(MessageType.TRADE_RESULT, {
        success: false,
        itemsReceived: [],
        itemsSent: [],
        mesosReceived: 0,
        mesosSent: 0,
        message: `Partner inventory full (${otherInvCount}/${TRADE_MAX_INVENTORY_SLOTS}).`,
      } satisfies TradeResultPayload);
      return;
    }
    // Check our own capacity for receiving.
    const myInvCount = this.countInventoryItems(player);
    if (myInvCount + otherSide.offerItems.length > TRADE_MAX_INVENTORY_SLOTS) {
      client.send(MessageType.TRADE_RESULT, {
        success: false,
        itemsReceived: [],
        itemsSent: [],
        mesosReceived: 0,
        mesosSent: 0,
        message: `Your inventory full (${myInvCount}/${TRADE_MAX_INVENTORY_SLOTS}).`,
      } satisfies TradeResultPayload);
      return;
    }

    side.locked = true;

    // If both locked, capture lock-time snapshots and advance to locked phase.
    if (otherSide.locked) {
      trade.phase = "locked";
      trade.lockSnapshot = {
        a: snapshotPlayer(trade.a.player),
        b: snapshotPlayer(trade.b.player),
      };
    }

    this.pushTradeState(trade);
    console.log(`[MapRoom] trade lock: ${player.name}`);
  }

  // ─── Trade: Confirm (and execute) ──────────────────────────────────────
  private handleTradeConfirm(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const trade = this.activeTrades.get(client.sessionId);
    if (!trade) return;
    if (trade.phase !== "locked") return;

    const side = trade.a.sessionId === client.sessionId ? trade.a : trade.b;
    const otherSide = trade.a.sessionId === client.sessionId ? trade.b : trade.a;

    // Must be locked to confirm.
    if (!side.locked) return;

    side.confirmed = true;

    // If both confirmed, execute the atomic swap.
    if (otherSide.confirmed) {
      this.executeTrade(trade);
      return;
    }

    this.pushTradeState(trade);
  }

  // ─── Trade: Atomic Execution ───────────────────────────────────────────
  private executeTrade(trade: TradeSession): void {
    const playerA = trade.a.player;
    const playerB = trade.b.player;

    // ═══ RE-VALIDATE EVERYTHING AT COMMIT TIME ═══
    // This is the critical anti-dupe gate: re-check inventory state, equipped items,
    // mesos, and lock-time snapshots before transferring anything.

    // 0. Proximity re-check: players must still be near each other.
    const execDx = Math.abs(playerA.x - playerB.x);
    const execDy = Math.abs(playerA.y - playerB.y);
    if (execDx > TRADE_RANGE_X * 2 || execDy > TRADE_RANGE_Y * 2) {
      this.cancelTrade(trade, "Trade failed: players moved too far apart.");
      return;
    }

    // 1. Both players must still be alive and in the room.
    if (!this.state.players.has(trade.a.sessionId) || !this.state.players.has(trade.b.sessionId)) {
      this.cancelTrade(trade, "A player left during trade.");
      return;
    }
    if (playerA.dead || playerB.dead) {
      this.cancelTrade(trade, "A player died during trade.");
      return;
    }

    // 2. Re-validate all items still exist in the offerer's inventory and are not equipped.
    for (const uid of trade.a.offerItems) {
      if (!this.validateItemOwnership(playerA, uid)) {
        this.cancelTrade(trade, "Trade failed: offered item no longer valid.");
        return;
      }
    }
    for (const uid of trade.b.offerItems) {
      if (!this.validateItemOwnership(playerB, uid)) {
        this.cancelTrade(trade, "Trade failed: offered item no longer valid.");
        return;
      }
    }

    // 3. Re-validate mesos.
    if (trade.a.offerMesos > playerA.mesos) {
      this.cancelTrade(trade, "Trade failed: not enough mesos.");
      return;
    }
    if (trade.b.offerMesos > playerB.mesos) {
      this.cancelTrade(trade, "Trade failed: not enough mesos.");
      return;
    }

    // 4. Re-validate lock-time snapshots (detect mid-trade inventory mutations).
    if (trade.lockSnapshot) {
      const snapA = snapshotPlayer(playerA);
      const snapB = snapshotPlayer(playerB);
      const snapAItems = new Set(snapA.itemUids);
      const snapBItems = new Set(snapB.itemUids);
      // Inventory must not have changed between lock and confirm.
      if (
        snapA.itemUids.length !== trade.lockSnapshot.a.itemUids.length ||
        snapA.mesos !== trade.lockSnapshot.a.mesos ||
        snapB.itemUids.length !== trade.lockSnapshot.b.itemUids.length ||
        snapB.mesos !== trade.lockSnapshot.b.mesos
      ) {
        this.cancelTrade(trade, "Trade failed: inventory changed during lock.");
        return;
      }
      // Deep compare: every uid from lock must still be present.
      for (const uid of trade.lockSnapshot.a.itemUids) {
        if (!snapAItems.has(uid)) {
          this.cancelTrade(trade, "Trade failed: inventory changed during lock.");
          return;
        }
      }
      for (const uid of trade.lockSnapshot.b.itemUids) {
        if (!snapBItems.has(uid)) {
          this.cancelTrade(trade, "Trade failed: inventory changed during lock.");
          return;
        }
      }
    }

    // 5. Capacity re-check at commit.
    const aInvCount = this.countInventoryItems(playerA);
    const bInvCount = this.countInventoryItems(playerB);
    if (
      aInvCount - trade.a.offerItems.length + trade.b.offerItems.length >
      TRADE_MAX_INVENTORY_SLOTS
    ) {
      this.cancelTrade(trade, "Trade failed: your inventory would overflow.");
      return;
    }
    if (
      bInvCount - trade.b.offerItems.length + trade.a.offerItems.length >
      TRADE_MAX_INVENTORY_SLOTS
    ) {
      this.cancelTrade(trade, "Trade failed: partner inventory would overflow.");
      return;
    }

    // ═══ EXECUTE THE SWAP ═══
    const itemsSentA: string[] = [];
    const itemsSentB: string[] = [];
    const mesosSentA = trade.a.offerMesos;
    const mesosSentB = trade.b.offerMesos;

    // Transfer items from A → B.
    for (const uid of trade.a.offerItems) {
      const removed = this.removeInventoryItem(playerA, uid);
      if (removed) {
        this.addInventoryItem(playerB, removed);
        itemsSentA.push(uid);
      }
    }

    // Transfer items from B → A.
    for (const uid of trade.b.offerItems) {
      const removed = this.removeInventoryItem(playerB, uid);
      if (removed) {
        this.addInventoryItem(playerA, removed);
        itemsSentB.push(uid);
      }
    }

    // Transfer mesos.
    if (mesosSentA > 0) {
      playerA.mesos -= mesosSentA;
      playerB.mesos += mesosSentA;
    }
    if (mesosSentB > 0) {
      playerB.mesos -= mesosSentB;
      playerA.mesos += mesosSentB;
    }
    // Persist mesos for both.
    accountStore.setMesos(playerA.charId, playerA.mesos);
    accountStore.setMesos(playerB.charId, playerB.mesos);

    // Persist both players.
    this.persistPlayer(playerA);
    this.persistPlayer(playerB);

    // Clean up trade state.
    this.activeTrades.delete(trade.a.sessionId);
    this.activeTrades.delete(trade.b.sessionId);

    // Notify both parties.
    const aClient = this.findClientBySession(trade.a.sessionId);
    const bClient = this.findClientBySession(trade.b.sessionId);
    aClient?.send(MessageType.TRADE_RESULT, {
      success: true,
      itemsReceived: itemsSentB,
      itemsSent: itemsSentA,
      mesosReceived: mesosSentB,
      mesosSent: mesosSentA,
      message: "Trade completed successfully!",
    } satisfies TradeResultPayload);
    bClient?.send(MessageType.TRADE_RESULT, {
      success: true,
      itemsReceived: itemsSentA,
      itemsSent: itemsSentB,
      mesosReceived: mesosSentA,
      mesosSent: mesosSentB,
      message: "Trade completed successfully!",
    } satisfies TradeResultPayload);

    console.log(
      `[MapRoom] trade completed: ${playerA.name} ↔ ${playerB.name} ` +
        `(${itemsSentA.length}+${itemsSentB.length} items, ${mesosSentA}+${mesosSentB} mesos)`,
    );

    // ── Analytics: trade completion ─────────────────────────────────────
    const tradeAcctA = this.sessionAccount.get(trade.a.sessionId);
    const tradeAcctB = this.sessionAccount.get(trade.b.sessionId);
    if (tradeAcctA) {
      track(AnalyticsEventType.TRADE_COMPLETE, tradeAcctA, trade.a.charId, {
        itemCountA: itemsSentA.length,
        itemCountB: itemsSentB.length,
        mesosA: mesosSentA,
        mesosB: mesosSentB,
        level: playerA.level,
      });
    }
    if (tradeAcctB) {
      track(AnalyticsEventType.TRADE_COMPLETE, tradeAcctB, trade.b.charId, {
        itemCountA: itemsSentA.length,
        itemCountB: itemsSentB.length,
        mesosA: mesosSentA,
        mesosB: mesosSentB,
        level: playerB.level,
      });
    }
  }

  /** Remove an item from a player's inventory (schema + durable store). */
  private removeInventoryItem(
    player: Player,
    uid: string,
  ): import("../persistence/store").ItemRecord | undefined {
    const invItem = player.inventory.get(uid);
    if (!invItem) return undefined;

    let potentialLines: import("@maple/shared").PotentialLine[] = [];
    if (invItem.potentialLines) {
      try {
        potentialLines = JSON.parse(invItem.potentialLines);
      } catch {
        potentialLines = [];
      }
    }
    let bonusStatsParsed: import("@maple/shared").BonusStatLine[] | undefined;
    if (invItem.bonusStats) {
      try {
        bonusStatsParsed = JSON.parse(invItem.bonusStats);
      } catch {
        bonusStatsParsed = undefined;
      }
    }
    const record: import("../persistence/store").ItemRecord = {
      uid: invItem.uid,
      defId: invItem.defId,
      baseRank: invItem.baseRank,
      potentialTier: invItem.potentialTier,
      lines: invItem.lines,
      minted: invItem.minted,
      potentialLines,
      ...(bonusStatsParsed ? { bonusStats: bonusStatsParsed } : {}),
      count: invItem.count,
    };

    player.inventory.delete(uid);
    accountStore.removeItem(player.charId, uid);
    return record;
  }

  /** Add an item to a player's inventory (schema + durable store). */
  private addInventoryItem(
    player: Player,
    record: import("../persistence/store").ItemRecord,
  ): void {
    const item = new InventoryItem();
    item.uid = record.uid;
    item.defId = record.defId;
    item.baseRank = record.baseRank;
    item.potentialTier = record.potentialTier;
    item.lines = record.lines;
    item.minted = record.minted;
    if (record.potentialLines) {
      item.potentialLines = JSON.stringify(record.potentialLines);
    }
    if (record.bonusStats) {
      item.bonusStats = JSON.stringify(record.bonusStats);
    }
    item.count = record.count ?? 1;

    player.inventory.set(item.uid, item);
    accountStore.addItem(player.charId, record);
  }

  // ─── Familiar system ──────────────────────────────────────────────────────

  private handleFamiliarSummon(client: Client, msg: FamiliarSummonPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;
    const mobId = msg?.mobId;
    if (!mobId || !isFamiliarCard(familiarCardId(mobId))) return;

    const coll = this.familiarCollections.get(client.sessionId);
    if (!coll) return;
    if (!coll.registered.includes(mobId)) {
      client.send(MessageType.FAMILIAR_CARD_DROP, {
        mobId,
        mobName: getMobDef(mobId)?.name ?? mobId,
      } satisfies FamiliarCardDropPayload);
      return;
    }
    if (coll.summoned.includes(mobId)) return; // already summoned
    if (coll.summoned.length >= FAMILIAR_MAX_SUMMONED) {
      client.send(MessageType.CHAT, {
        sessionId: "",
        name: "System",
        text: `You can only summon ${FAMILIAR_MAX_SUMMONED} familiars at a time.`,
      });
      return;
    }

    const mobDef = getMobDef(mobId);
    if (!mobDef) return;
    const stats = deriveFamiliarStats(mobDef);
    const fam = new Familiar();
    fam.mobId = mobId;
    fam.ownerSession = client.sessionId;
    fam.x = player.x + (Math.random() - 0.5) * 40;
    fam.y = player.y - 20;
    fam.hp = stats.hp;
    fam.maxHp = stats.hp;
    fam.speed = stats.speed;
    fam.facing = 1;
    fam.instanceId = `fam_${++this.idCounter}`;
    fam.familiarKey = mobId;
    this.state.familiars.set(mobId, fam);

    coll.summoned.push(mobId);
    accountStore.updateCharacter(player.charId, { familiars: coll });
    client.send(MessageType.FAMILIAR_SYNC, {
      registered: coll.registered,
      summoned: coll.summoned,
    } satisfies FamiliarSyncPayload);
  }

  private handleFamiliarDismiss(client: Client, msg: FamiliarDismissPayload): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const mobId = msg?.mobId;
    if (!mobId) return;

    const coll = this.familiarCollections.get(client.sessionId);
    if (!coll) return;
    const idx = coll.summoned.indexOf(mobId);
    if (idx === -1) return;

    coll.summoned.splice(idx, 1);
    this.state.familiars.delete(mobId);
    accountStore.updateCharacter(player.charId, { familiars: coll });
    client.send(MessageType.FAMILIAR_SYNC, {
      registered: coll.registered,
      summoned: coll.summoned,
    } satisfies FamiliarSyncPayload);
  }

  /** Dismiss all familiars for a session (used on disconnect). */
  private dismissAllFamiliars(sessionId: string): void {
    const coll = this.familiarCollections.get(sessionId);
    if (!coll) return;
    for (const mobId of coll.summoned) {
      this.state.familiars.delete(mobId);
    }
    coll.summoned.length = 0;
  }

  /** Familiar AI tick: follow owner → chase mob → attack. */
  private tickFamiliar(fam: Familiar, dt: number): void {
    if (fam.dead) return;
    if (fam.hitTimer > 0) {
      fam.hitTimer -= dt;
      if (fam.hitTimer <= 0) fam.hit = false;
    }
    if (fam.attackCooldown > 0) fam.attackCooldown -= dt;

    const owner = this.state.players.get(fam.ownerSession);
    if (!owner || owner.dead) {
      // Owner gone or dead — just idle in place.
      fam.aiState = "idle";
      return;
    }

    const mobDef = getMobDef(fam.mobId);
    const speed = fam.speed || mobDef?.speed || 0.5;

    // Find the nearest alive, non-dead mob for aggro.
    let nearestMob: Mob | null = null;
    let nearestDist = Infinity;
    this.state.mobs.forEach((mob) => {
      if (mob.dead) return;
      const dx = Math.abs(mob.x - fam.x);
      const dy = Math.abs(mob.y - fam.y);
      if (dx <= FAMILIAR_AGGRO_RANGE && dy <= FAMILIAR_AGGRO_VERT) {
        const dist = dx + dy * 0.5;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestMob = mob;
        }
      }
    });

    switch (fam.aiState) {
      case "idle":
      case "follow": {
        // Move toward owner, stay within ~80px.
        const dx = owner.x - fam.x;
        const dy = owner.y - fam.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 80) {
          fam.x += Math.sign(dx) * speed;
          fam.facing = dx >= 0 ? 1 : -1;
        }
        // Snap Y loosely.
        if (Math.abs(dy) > 40) {
          fam.y += Math.sign(dy) * speed * 0.6;
        }
        fam.grounded = true;
        // Check for aggro.
        if (nearestMob) {
          fam.aiState = "chase";
          fam.targetMobKey = this.mobKeyByRef.get(nearestMob) ?? "";
        }
        break;
      }
      case "chase": {
        const target = this.state.mobs.get(fam.targetMobKey);
        if (!target || target.dead) {
          fam.aiState = "follow";
          fam.targetMobKey = "";
          break;
        }
        const dx = target.x - fam.x;
        const dy = target.y - fam.y;
        const dist = Math.hypot(dx, dy);
        // Deaggro if too far.
        if (dist > FAMILIAR_DEAGGRO_RANGE) {
          fam.aiState = "follow";
          fam.targetMobKey = "";
          break;
        }
        // In attack range?
        if (dist <= FAMILIAR_ATTACK_RANGE && fam.attackCooldown <= 0) {
          fam.aiState = "attack";
          break;
        }
        // Chase.
        fam.x += Math.sign(dx) * speed * 1.3;
        fam.y += Math.sign(dy) * speed * 0.8;
        fam.facing = dx >= 0 ? 1 : -1;
        break;
      }
      case "attack": {
        const target = this.state.mobs.get(fam.targetMobKey);
        if (!target || target.dead) {
          fam.aiState = "follow";
          fam.targetMobKey = "";
          break;
        }
        // Deal damage.
        const primary = getClass(owner.archetype as ClassArchetype).primaryStat;
        const equippedRec = Object.fromEntries(owner.equipped.entries());
        const bonus = resolveEquippedBonus(
          equippedRec,
          (uid) => {
            const item = owner.inventory.get(uid);
            return item ? getItemDef(item.defId) : undefined;
          },
          (uid) => {
            const item = owner.inventory.get(uid);
            return (item?.baseRank ?? "NORMAL") as import("@maple/shared").BaseRank;
          },
          (uid) => {
            const item = owner.inventory.get(uid);
            if (!item?.potentialLines) return [];
            try {
              return JSON.parse(item.potentialLines) as import("@maple/shared").PotentialLine[];
            } catch {
              return [];
            }
          },
          (uid) => {
            const item = owner.inventory.get(uid);
            if (!item?.bonusStats) return [];
            try {
              const parsed = JSON.parse(item.bonusStats) as import("@maple/shared").BonusStatLine[];
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          },
        );

        // Set bonuses from matching gear.
        const equippedDefIds = Object.values(equippedRec)
          .map((uid) => {
            const item = owner.inventory.get(uid);
            return item ? getItemDef(item.defId)?.id : undefined;
          })
          .filter((id): id is string => id !== undefined);
        const setBonus = computeSetBonuses(equippedDefIds);

        const equipBonus: Record<string, number> = {
          atk: bonus.atk + setBonus.atk,
          mAtk: 0,
          wDef: bonus.wDef + setBonus.wDef,
          mDef: bonus.mDef + setBonus.mDef,
          critRate: 0,
          speed: bonus.speed + setBonus.speed,
          jump: bonus.jump + setBonus.jump,
          accuracy: 0,
        };
        const stats = {
          STR: owner.str + bonus.str + setBonus.STR,
          DEX: owner.dex + bonus.dex + setBonus.DEX,
          INT: owner.intel + bonus.int + setBonus.INT,
          LUK: owner.luk + bonus.luk + setBonus.LUK,
          HP: owner.hp + bonus.hp + setBonus.HP,
          MP: owner.mp + bonus.mp + setBonus.MP,
        };
        const passive = passiveEffectBonus(owner.archetype as ClassArchetype, owner.skillBook);
        const activeBuff = aggregateSecondary(owner.activeEffects);
        const effectBonus = mergeBonus(passive, activeBuff);
        const secondary = deriveSecondary(stats, primary, equipBonus, effectBonus);
        const damage = Math.max(1, Math.round(secondary.atk * FAMILIAR_DAMAGE_FRACTION));

        target.hp -= damage;
        target.hit = true;
        target.hitTimer = 120;
        if (target.hp <= 0) this.killMob(target, owner);

        this.broadcast(MessageType.COMBAT_HIT, {
          targetKey: this.mobKeyByRef.get(target) ?? "",
          attackerSession: fam.ownerSession,
          damage,
          crit: false,
          hit: true,
          mobHp: Math.max(0, target.hp),
          mobMaxHp: target.maxHp,
        } satisfies CombatHitPayload);

        fam.attackCooldown = FAMILIAR_ATTACK_COOLDOWN_MS;
        fam.aiState = "chase";
        break;
      }
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Build a human-readable objective description for the quest offer panel. */
function describeQuestObjectiveForClient(questId: string, objIndex: number): string {
  const def = QUESTS[questId];
  if (!def) return "objective";
  const obj = def.objectives[objIndex];
  if (!obj) return "objective";
  switch (obj.kind) {
    case "kill": {
      const mobName = obj.mobId.split(".").pop() ?? obj.mobId;
      return `Defeat ${mobName} (0/${obj.count})`;
    }
    case "collect": {
      const itemName = obj.itemId.split(".").pop() ?? obj.itemId;
      return `Collect ${itemName} (0/${obj.count})`;
    }
    case "talk": {
      const npcName = obj.npcId.split(".").pop() ?? obj.npcId;
      return `Talk to ${npcName}`;
    }
    case "level": {
      return `Reach level ${obj.level}`;
    }
    default:
      return "objective";
  }
}

/** Return the target count for a quest objective. */
function getQuestObjTarget(obj: { kind: string; count?: number; level?: number }): number {
  switch (obj.kind) {
    case "kill":
      return obj.count ?? 1;
    case "collect":
      return obj.count ?? 1;
    case "talk":
      return 1;
    case "level":
      return 1;
    default:
      return 1;
  }
}
