/**
 * Network wire protocol — the input shape + message channels shared by client and server.
 * Lives in @maple/shared (dependency-free) so the browser never has to import server code.
 */

import type { InventoryTab } from "./inventory.js";

/** Per-tick input the client sends; the server is authoritative over the resulting movement. */
export interface InputData {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Melee attack pressed this tick. */
  attack: boolean;
  /** Jump pressed this tick. */
  jump: boolean;
  /** Interact / portal-activate pressed this tick (up-arrow or enter near a portal). */
  interact: boolean;
  /** Client tick counter, echoed back for reconciliation. */
  tick: number;
}

/** Message channels (numeric for compactness), used by both sides of Town/Map rooms. */
export const MessageType = {
  INPUT: 0,
  PICKUP: 1,
  CHAT: 2,
  CREATE_CHARACTER: 3,
  DELETE_CHARACTER: 4,
  USE_PORTAL: 5,
  TRAVEL: 6,
  TALK_NPC: 7,
  DIALOG: 8,
  DIALOG_CHOICE: 9,
  DIALOG_END: 10,
  QUEST_UPDATE: 11,
  JOB_ADVANCE: 12,
  BUY_CASH_ITEM: 13,
  EQUIP_CASH_ITEM: 14,
  CASH_INFO: 15,
  EQUIP_ITEM: 16,
  UNEQUIP_ITEM: 17,
  BUY_FROM_SHOP: 18,
  SELL_TO_SHOP: 19,
  SPEND_AP: 20,
  LEARN_SKILL: 21,
  SKILL_BOOK: 22,
  LEVEL_UP: 23,
  COMBAT_HIT: 24,
  STATUS_EFFECTS: 25,

  // ─── Two-party trade ────────────────────────────────────────
  TRADE_INVITE: 26,
  TRADE_ACCEPT: 27,
  TRADE_REJECT: 28,
  TRADE_CANCEL: 29,
  TRADE_OFFER: 30,
  TRADE_LOCK: 31,
  TRADE_CONFIRM: 32,
  TRADE_UPDATE: 33,
  TRADE_RESULT: 34,

  // ─── Free Market (off-chain Mesos order book) ──────────────────────
  MARKET_LIST: 35,
  MARKET_CANCEL: 36,
  MARKET_BROWSE: 37,
  MARKET_BUY: 38,
  MARKET_RESULT: 39,
  MARKET_BROWSE_RESULT: 40,
  MARKET_ERROR: 41,

  // ─── Shared Account Storage (stash) ────────────────────────────────
  STORAGE_DEPOSIT: 42,
  STORAGE_WITHDRAW: 43,
  STORAGE_SYNC: 44,

  // ─── Equipment repair / mesos sink ─────────────────────────────────
  REPAIR_EQUIPMENT: 45,

  // ─── Cube (potential reroll) ───────────────────────────────────────
  CUBE_REROLL: 46,

  // ─── Base-rank upgrade (NORMAL→ENHANCED→STARFORGED→MYTHIC) ─────────
  UPGRADE_ITEM: 47,

  // ─── Party (group play, session-scoped) ──────────────────────────
  PARTY_INVITE: 48,
  PARTY_ACCEPT: 49,
  PARTY_LEAVE: 50,
  PARTY_KICK: 51,
  PARTY_UPDATE: 52,
  PARTY_INVITE_RECEIVED: 53,

  // ─── Guild (persistent cross-map social) ───────────────────────────────
  GUILD_CREATE: 54,
  GUILD_INVITE: 55,
  GUILD_INVITE_RECEIVED: 56,
  GUILD_ACCEPT: 57,
  GUILD_LEAVE: 58,
  GUILD_KICK: 59,
  GUILD_RANK: 60,
  GUILD_UPDATE: 61,
  GUILD_CHAT: 62,
  GUILD_CHAT_RELAY: 63,
  GUILD_RESULT: 64,

  // ─── Channel system (multi-channel per map) ─────────────────────────────
  CHANNEL_LIST: 65,
  CHANNEL_SWITCH: 66,
  CHANNEL_SWITCH_RESULT: 67,
  WHISPER: 68,
  WHISPER_RELAY: 69,
  WHISPER_FAILED: 70,

  // ─── Codex / Fame / Achievements (retention systems) ──────────────────────
  GIVE_FAME: 71,
  FAME_RESULT: 72,
  CODEX_SYNC: 73,
  ACHIEVEMENT_SYNC: 74,
  ACHIEVEMENT_UNLOCK: 75,
  VIEW_CODEX: 76,
  VIEW_ACHIEVEMENTS: 77,

  // ─── Party Quest (instanced group content) ────────────────────────────────
  PQ_JOIN: 78,
  PQ_PROGRESS: 79,
  PQ_RESULT: 80,
  PQ_CONTRIBUTE: 81,

  // ─── 2nd-job branch advancement ─────────────────────────────────────
  BRANCH_LIST: 82,
  BRANCH_CHOICE: 83,

  // ─── Quickslot hotbar (skill cast + consumable use) ────────────────────
  SKILL_CAST: 84,
  USE_CONSUMABLE: 85,
  QUICKSLOT_LAYOUT: 86,

  // ─── Quest offer / turn-in UX ──────────────────────────────────────────────
  QUEST_ACCEPT: 87,
  QUEST_DECLINE: 88,
  QUEST_TURNIN_ACCEPT: 89,
  QUEST_TURNIN_DECLINE: 90,

  // ─── Friends / Buddy list ─────────────────────────────────────────────
  FRIEND_ADD: 91,
  FRIEND_REMOVE: 92,
  FRIEND_LIST: 93,
  FRIEND_RESULT: 94,
  FRIEND_REMOVED: 95,
  ONLINE_STATUS: 96,

  // ─── Guild enhancements ───────────────────────────────────────────────
  GUILD_DISBAND: 97,

  // ─── Settings sync (controls + video + audio + gameplay) ──────────────
  SETTINGS_SYNC: 98,

  // ─── Combat QoL ─────────────────────────────────────────────────────────
  PICKUP_ALL: 99,
  MACRO_CAST: 100,
  MACRO_LAYOUT: 101,
  AUTO_POT_SYNC: 102,

  // ─── Bug report / Feedback ─────────────────────────────────────────────
  FEEDBACK_SUBMIT: 103,

  // ─── Moderation (alpha admin tooling) ─────────────────────────────────
  PLAYER_REPORT: 104,
  PLAYER_REPORT_RESULT: 105,
  BLOCK_PLAYER: 106,
  UNBLOCK_PLAYER: 107,
  BLOCKED_LIST_RESULT: 108,
  SERVER_ANNOUNCEMENT: 109,
  MOD_ACTION_RESULT: 110,

  // ─── Party chat ──────────────────────────────────────────────────────
  PARTY_CHAT: 111,
  PARTY_CHAT_RELAY: 112,

  // ─── Guided progression (Maple Guide) ───────────────────────────────
  GUIDANCE_SYNC: 113,
  GUIDE_TRAVEL: 114,

  // ─── Bonus Hunting (rotating daily map) ──────────────────────────────
  BONUS_HUNT_SYNC: 115,

  // ─── Flame (bonus stat reroll) ──────────────────────────────────────
  FLAME_REROLL: 118,

  // ─── Star Force (per-star enhancement) ────────────────────────────────
  STAR_FORCE: 119,

  // ─── GM / Admin commands (in-game console) ──────────────────────────────
  GM_COMMAND: 116,
  GM_RESULT: 117,

  // ─── Familiar system (MapleStory-style companion pets) ──────────────────────
  FAMILIAR_SYNC: 120,
  FAMILIAR_SUMMON: 121,
  FAMILIAR_DISMISS: 122,
  FAMILIAR_CARD_DROP: 123,

  // ─── Exploration Dispatch (idle Monster Collection) ────────────────────────
  EXPLORATION_START: 124,
  EXPLORATION_CLAIM: 125,
  EXPLORATION_SYNC: 126,

  // ─── Runes (map buff spawns) ──────────────────────────────────────────────
  RUNE_SPAWN: 127,
  RUNE_DESPAWN: 128,
  RUNE_ACTIVATE: 129,

  // ─── Quest abandon ─────────────────────────────────────────────────────
  QUEST_ABANDON: 152,

  // ─── Treasure Hunter Boxes (destructible loot chests) ─────────────────────
  TREASURE_SPAWN: 130,
  TREASURE_HIT: 131,
  TREASURE_DESTROY: 132,
  TREASURE_DESPAWN: 151,

  // ─── Reactors (placed breakable/interactive objects) ──────────────────────
  REACTOR_SPAWN: 157,
  REACTOR_HIT: 153,
  REACTOR_DESTROY: 154,
  REACTOR_INTERACT: 155,
  REACTOR_DESPAWN: 156,

  // ─── Titles (equipped title above character) ────────────────────────────────
  TITLE_EQUIP: 133,
  TITLE_SYNC: 134,

  // ─── World map quick-travel (click a node on the world map) ─────────────────
  MAP_TRAVEL: 135,

  // ─── Free Market MTS extensions ──────────────────────────────────────
  MARKET_PLACE_BUY_ORDER: 136,
  MARKET_CANCEL_BUY_ORDER: 137,
  MARKET_BROWSE_BUY_ORDERS: 138,
  MARKET_BID: 139,
  MARKET_BUY_ORDER_RESULT: 140,
  MARKET_AUCTION_RESULT: 141,
  MARKET_PRICE_HISTORY: 142,

  // ─── Party loot rule ──────────────────────────────────────────────────
  PARTY_SET_LOOT_RULE: 143,

  // ─── LFG / Party Finder ────────────────────────────────────────────────
  LFG_POST: 144,
  LFG_LIST: 145,
  LFG_LIST_RESULT: 146,
  LFG_JOIN: 147,
  LFG_REMOVE: 148,

  // ─── Single-live-session guard ─────────────────────────────────────────
  // Server → client: the generation token a client must echo on map/channel
  // transfers so relocations aren't mistaken for a duplicate login.
  SESSION_GENERATION: 149,
  // Server → client: this session was kicked because the character logged in elsewhere.
  FORCE_LOGOUT: 150,

  // ─── Daily Login Gift (once-per-UTC-day reward) ────────────────────────
  DAILY_LOGIN_GIFT_SYNC: 153,
  DAILY_LOGIN_GIFT_CLAIM: 154,

  // ─── Inventory sort ───────────────────────────────────────────────────────
  INVENTORY_SORT: 155,

  // ─── Unstuck / Return to Town (self-recovery) ─────────────────────────────
  UNSTUCK_ACTION: 156,

  // ─── Live-ops events (date-gated feature flags) ─────────────────────────
  EVENTS_SYNC: 157,

  // ─── Scheduled transport (airship / boat / sky-ride) ─────────────────────
  /** Server → client: periodic countdown while boarded on scheduled transport. */
  TRANSPORT_STATUS: 158,
  /** Server → client: ship has departed — TRAVEL follows immediately. */
  TRANSPORT_DEPARTED: 159,

  // ─── Pet system (MapleStory-style auto-loot companion) ─────────────────────
  /** Client → server: summon a pet. */
  PET_SUMMON: 160,
  /** Client → server: dismiss the active pet. */
  PET_DISMISS: 161,
  /** Client → server: feed the active pet from inventory. */
  PET_FEED: 162,
  /** Server → client: full pet state sync (sent on join + after changes). */
  PET_SYNC: 163,

  // ─── Skill VFX (cast animation trigger) ─────────────────────────────────
  /** Server → client: broadcast a skill VFX event (cast animation, particles). */
  SKILL_VFX: 164,

  // ─── Emotes (expression bubbles above the head) ─────────────────────────
  /** Client → server: player triggered an emote. */
  EMOTE: 165,
  /** Server → client: broadcast an emote to all clients in the map. */
  EMOTE_DISPLAY: 166,
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/** Server → client: result of an unstuck / return-to-town action. */
export interface UnstuckResultPayload {
  success: boolean;
  message: string;
  /** Seconds remaining before the player can unstuck again (0 if just succeeded). */
  cooldownRemaining?: number;
}

/** Payload a player sends when chatting. */
export interface ChatPayload {
  text: string;
}

/** Broadcast shape the server pushes to every client on a chat message. */
export interface ChatMessage {
  sessionId: string;
  name: string;
  text: string;
}

// ─── Scoped chat ───────────────────────────────────────────────────────

/** Chat scope — determines routing + client tab. */
export type ChatScope = "map" | "whisper" | "party" | "guild";

/** Client → server: send a party chat message. */
export type PartyChatPayload = ChatPayload;

/** Server → client: party chat relay (same-room only). */
export interface PartyChatRelayPayload {
  senderName: string;
  text: string;
}

/** Client → server: create a new character on the account. */
export interface CreateCharacterPayload {
  name: string;
  gender: "M" | "F";
  /** Desired class archetype (WARRIOR|MAGE|ARCHER|THIEF|PIRATE). Defaults to BEGINNER. */
  class?: string;
  appearance: {
    gender: "M" | "F";
    skinId: string;
    hairId: string;
    hairColorId: string;
    faceId: string;
    outfitId: string;
  };
}

/** Client → server: delete a character by id. */
export interface DeleteCharacterPayload {
  charId: string;
}

/** Server → client: travel to another map. Client leaves current room and joins destination. */
export interface TravelPayload {
  mapId: string;
  spawnId: string;
}

/**
 * Server → client: the per-login generation token for the single-live-session guard.
 * The client stores it and echoes it as the `generation` join option on every map/channel
 * transfer so the relocation isn't treated as a duplicate login.
 */
export interface SessionGenerationPayload {
  generation: string;
}

/** Server → client: this session was forcibly logged out (e.g. logged in elsewhere). */
export interface ForceLogoutPayload {
  reason: string;
}

/** Server → client: portal use blocked (e.g. level requirement not met). */
export interface FerryBlockedPayload {
  message: string;
}

/** Server → client: periodic countdown while boarded on scheduled transport. */
export interface TransportStatusPayload {
  /** Human-readable transport label (e.g. "✈️ Airship to Skyhaven"). */
  portalLabel: string;
  /** Milliseconds remaining until departure. */
  departInMs: number;
  /** Number of players currently boarded. */
  boardedCount: number;
  /** Portal id (for client-side keying). */
  portalId: string;
}

/** Client → server: request travel via the world map (clicked a node). */
export interface MapTravelPayload {
  targetMapId: string;
}

/** Client → server: initiate conversation with an NPC. */
export interface TalkNpcPayload {
  npcId: string;
}

/** Server → client: a line of NPC dialog. */
export interface DialogLinePayload {
  npcId: string;
  npcName: string;
  text: string;
  /** If present, the client should show choice buttons (branch node). */
  choices?: readonly { label: string; index: number }[];
  /** True if this is a line node with more text following (client shows "Next"). */
  hasNext?: boolean;
}

/** Client → server: the player picked a dialog choice. */
export interface DialogChoicePayload {
  choiceIndex: number;
}

/** Server → client: the dialog has ended (all branches resolved). */
export interface DialogEndPayload {
  npcId: string;
}

/** Server → client: job advancement result. */
export interface JobAdvancePayload {
  success: boolean;
  /** The archetype key chosen (e.g. "ARCHER"), or undefined on failure. */
  archetype?: string;
  /** Branch id chosen for 2nd-job advancement (e.g. "berserker"), if applicable. */
  branchId?: string;
  /** Current job tier after advancement. */
  jobTier?: number;
  message: string;
}

/** Server → client: available branches for 2nd-job advancement. */
export interface BranchListPayload {
  readonly branches: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
  }[];
  readonly archetype: string;
}

/** Client → server: the player picked a branch for 2nd-job advancement. */
export interface BranchChoicePayload {
  readonly branchId: string;
}

/** Client → server: buy a cash shop item (account-wide purchase). */
export interface BuyCashItemPayload {
  itemId: string;
}

/** Server → client: result of a cash shop purchase attempt. */
export interface BuyCashItemResultPayload {
  success: boolean;
  itemId?: string;
  balance?: number;
  message: string;
}

/** Client → server: equip (or unequip) a cash item on a character. */
export interface EquipCashItemPayload {
  itemId: string;
  charId: string;
}

/** Server → client: result of a cash equip attempt. */
export interface EquipCashItemResultPayload {
  success: boolean;
  itemId?: string;
  category?: string;
  /** True if the item is now equipped; false if it was unequipped (toggle). */
  equipped?: boolean;
  message: string;
}

/** Client → server: request cash shop info (balance + owned items + equipped). */
export type CashInfoRequestPayload = Record<string, never>;

/** Client → server: buy an item from an NPC General Store. */
export interface BuyFromShopPayload {
  shopId: string;
  itemId: string;
  qty: number;
}

/** Server → client: result of a shop buy attempt. */
export interface BuyFromShopResultPayload {
  success: boolean;
  itemId: string;
  message: string;
  /** Updated mesos balance after the transaction. */
  mesos?: number;
}

/** Client → server: sell an inventory item to an NPC General Store. */
export interface SellToShopPayload {
  uid: string;
  qty: number;
}

/** Server → client: result of a shop sell attempt. */
export interface SellToShopResultPayload {
  success: boolean;
  uid: string;
  message: string;
  /** Updated mesos balance after the transaction. */
  mesos?: number;
}

/** Server → client: cash shop account snapshot (balance + owned + equipped items). */
export interface CashInfoPayload {
  /** Current Maple Crystals balance. */
  balance: number;
  /** Account-wide owned cash item ids. */
  owned: string[];
  /** Per-character equipped cash items: category → itemId. */
  equipped: Record<string, string>;
  /** The character id this info applies to. */
  charId: string;
}

/** Client → server: spend one AP into a stat. Server validates + applies authoritatively. */
export interface SpendApPayload {
  /** Target stat: STR | DEX | INT | LUK | HP | MP */
  stat: "STR" | "DEX" | "INT" | "LUK" | "HP" | "MP";
}

/** Client → server: spend one SP to learn (or level up) a skill. Server validates + applies. */
export interface LearnSkillPayload {
  /** The skill id to learn or level up (e.g. "warrior.crushing_blow"). */
  skillId: string;
}

/** Server → client: result of a learn-skill attempt. */
export interface LearnSkillResultPayload {
  success: boolean;
  /** The skill id that was attempted. */
  skillId: string;
  /** Updated SP remaining (only on success). */
  sp?: number;
  /** The updated skill book snapshot. */
  book?: Record<string, number>;
  /** Human-readable error (only on failure). */
  message: string;
}

/** Client → server: request the current skill book snapshot. */
export type SkillBookRequestPayload = Record<string, never>;

/** Server → client: the current skill book snapshot. */
export interface SkillBookResponsePayload {
  book: Record<string, number>;
}

/** Client → server: equip an inventory item into its slot. */
export interface EquipItemPayload {
  uid: string;
}

/** Client → server: unequip an item from a slot. */
export interface UnequipItemPayload {
  slot: string;
}

/** Server → client: a player levelled up. */
export interface LevelUpPayload {
  level: number;
  levelsGained: number;
  ap: number;
  sp: number;
  maxHp: number;
  maxMp: number;
}

/** Server → client: a player hit a mob (or mob hit a player). */
export interface CombatHitPayload {
  /** Mob key in room.state.mobs, or empty if it's mob→player. */
  targetKey: string;
  /** Session id of the attacker (empty if mob→player). */
  attackerSession: string;
  /** Damage dealt (0 = miss). */
  damage: number;
  /** Whether the hit was a critical. */
  crit: boolean;
  /** Whether the attack connected at all (false = full miss). */
  hit: boolean;
  /** Mob's remaining HP after this hit (for HP bar). */
  mobHp: number;
  /** Mob's max HP. */
  mobMaxHp: number;
  /** Elemental multiplier applied (1=neutral, 0=immune, 0.5=resist, 1.5=weak). Omitted for basic attacks (assumed 1). */
  elementMultiplier?: number;
}

/** Server → client: the local player's active status effects changed. */
export interface StatusEffectInfo {
  id: string;
  kind: string;
  label: string;
  stacks: number;
  durationMs: number;
  remainingMs: number;
}

/** Server → client: full status effect snapshot. */
export interface StatusEffectsPayload {
  effects: StatusEffectInfo[];
}

/** ─── Two-party direct trade ───────────────────────────────────────── */

/** Client → server: invite another player to trade. */
export interface TradeInvitePayload {
  /** Session id of the target player to invite. */
  targetSessionId: string;
}

/** Client → server: accept a pending trade invite. */
export interface TradeAcceptPayload {
  /** Session id of the inviter. */
  fromSessionId: string;
}

/** Client → server: reject a pending trade invite. */
export interface TradeRejectPayload {
  /** Session id of the inviter. */
  fromSessionId: string;
}

/** Client → server: cancel an active trade. */
export type TradeCancelPayload = Record<string, never>;

/** Client → server: add or remove an item/mesos from this player's offer. */
export interface TradeOfferPayload {
  /** Item uid to add to / remove from the offer. Omit to only change mesos. */
  itemUid?: string;
  /** True = add item to offer; false = remove item from offer. Default: true. */
  add?: boolean;
  /** Mesos this player is offering. Set to 0 to remove mesos. */
  mesos?: number;
}

/** Client → server: lock your offer (no more changes allowed). */
export type TradeLockPayload = Record<string, never>;

/** Client → server: confirm the locked trade (both must confirm to execute). */
export type TradeConfirmPayload = Record<string, never>;

/** Server → client: full trade window state update. */
export interface TradeUpdatePayload {
  /** The other player's session id. */
  partnerSessionId: string;
  /** The other player's name. */
  partnerName: string;
  /** This client's offered item uids. */
  myOffer: string[];
  /** This client's offered mesos. */
  myMesos: number;
  /** Partner's offered item uids. */
  partnerOffer: string[];
  /** Partner's offered mesos. */
  partnerMesos: number;
  /** Whether this client has locked. */
  myLocked: boolean;
  /** Whether the partner has locked. */
  partnerLocked: boolean;
  /** Whether this client has confirmed. */
  myConfirmed: boolean;
  /** Whether the partner has confirmed. */
  partnerConfirmed: boolean;
}

/** Server → client: trade ended — final result. */
export interface TradeResultPayload {
  success: boolean;
  /** Item uids received from partner (empty if cancelled or failed). */
  itemsReceived: string[];
  /** Item uids sent to partner (empty if cancelled or failed). */
  itemsSent: string[];
  /** Mesos received from partner. */
  mesosReceived: number;
  /** Mesos sent to partner. */
  mesosSent: number;
  message: string;
}

/** Server → client: full quest log snapshot. */
export interface QuestUpdatePayload {
  quests: {
    questId: string;
    name: string;
    status: string;
    /** True when this quest resets daily (shown as "Daily" badge in UI). */
    isRepeatable?: boolean;
    objectiveProgress: {
      kind: string;
      description: string;
      current: number;
      target: number;
    }[];
  }[];
}

// ─── Guided progression (Maple Guide) ─────────────────────────────────────────

/** Server → client: current guidance state snapshot. */
export interface GuidanceSyncPayload {
  milestoneId: string;
  title: string;
  description: string;
  mapId: string;
  teleportMapId?: string;
  targetNpcId?: string;
  steps: {
    label: string;
    completed: boolean;
    active: boolean;
    questId?: string;
    npcId?: string;
  }[];
  activeStepIndex: number;
  allComplete: boolean;
}

/** Client → server: request guided travel to the milestone's target map. */
export interface GuideTravelPayload {
  targetMapId: string;
}

// ─── Bonus Hunting (rotating daily map) ─────────────────────────────────────

/** Server → client: today's bonus hunting map info. */
export interface BonusHuntSyncPayload {
  /** The map id that has bonus today. */
  bonusMapId: string;
  /** True when the player is currently on the bonus map. */
  isActive: boolean;
  /** EXP multiplier on the bonus map (1.5). */
  expMultiplier: number;
  /** Drop rate multiplier on the bonus map (1.25). */
  dropMultiplier: number;
  /** Epoch-ms when the bonus resets (next UTC midnight). */
  endsAtUtcMidnight: number;
}

// ─── Free Market (off-chain Mesos order book) ─────────────────────────────────

/** Client → server: list an item from inventory on the Free Market. */
export interface MarketListPayload {
  /** uid of the item to list (from the seller's inventory). */
  itemUid: string;
  /** Mesos per unit the seller charges. */
  pricePerUnit: number;
  /** Quantity to list (1 for equips; ≥ 1 for stackables). */
  qty?: number;
}

/** Client → server: cancel a listing the caller owns. */
export interface MarketCancelPayload {
  listingId: string;
}

/** Client → server: browse/search all listings with optional filters. */
export interface MarketBrowsePayload {
  /** Filter by equipment slot. */
  slot?: string;
  /** Minimum level requirement. */
  levelMin?: number;
  /** Maximum level requirement. */
  levelMax?: number;
  /** Filter by potential tier (exact). */
  potentialTier?: string;
  /** Filter by base rank (exact). */
  baseRank?: string;
  /** Minimum total price. */
  priceMin?: number;
  /** Maximum total price. */
  priceMax?: number;
  /** Free-text search (item name / defId substring). */
  query?: string;
  /** Sort key: "price" | "level" | "newest". Default "newest". */
  sortBy?: string;
  /** Sort direction: "asc" | "desc". Default "asc". */
  sortOrder?: string;
  /** Page offset (0-based). */
  offset?: number;
  /** Page size. Default 20. */
  limit?: number;
}

/** Client → server: buy a listing. */
export interface MarketBuyPayload {
  listingId: string;
}

/** Server → client: result of a list / cancel / buy operation. */
export interface MarketResultPayload {
  success: boolean;
  /** The listing id affected (on list/buy/cancel). */
  listingId?: string;
  /** Updated mesos balance of the acting player. */
  mesos?: number;
  /** Total fee deducted (on buy, for the seller's reference). */
  fee?: number;
  message: string;
}

/** Server → client: paginated browse results. */
export interface MarketBrowseResultPayload {
  listings: {
    listingId: string;
    sellerId: string;
    sellerName: string;
    defId: string;
    uid?: string;
    qty: number;
    pricePerUnit: number;
    totalPrice: number;
    baseRank: string;
    potentialTier: string;
    lines: number;
    /** Enriched display name from ItemDef. */
    itemName: string;
  }[];
  total: number;
  offset: number;
  limit: number;
}

/** Server → client: market error (validation / auth failure). */
export interface MarketErrorPayload {
  reason: string;
}

// ─── Free Market MTS extensions ───────────────────────────────────────────────

/** Client → server: list an item with optional expiry (duration in ms). */
export interface MarketListWithExpiryPayload extends MarketListPayload {
  /** Duration in ms before the listing expires (0 = no expiry, default). Max 24h. */
  duration?: number;
  /** Listing type: "fixed" (default) or "auction". */
  listingType?: "fixed" | "auction";
}

/** Client → server: place a buy order (want-to-buy) for an item. */
export interface MarketPlaceBuyOrderPayload {
  /** Item definition id the buyer wants. */
  defId: string;
  /** Max price per unit in Mesos the buyer is willing to pay. */
  maxPrice: number;
  /** Quantity requested (always 1 for equips; defaults to 1). */
  qty?: number;
}

/** Client → server: cancel a buy order the caller owns. */
export interface MarketCancelBuyOrderPayload {
  buyOrderId: string;
}

/** Client → server: browse active buy orders. */
export interface MarketBrowseBuyOrdersPayload {
  /** Filter by item defId. */
  defId?: string;
  /** Page offset (0-based). */
  offset?: number;
  /** Page size. Default 20. */
  limit?: number;
}

/** Client → server: place a bid on an auction listing. */
export interface MarketBidPayload {
  /** Listing id of the auction to bid on. */
  listingId: string;
  /** Bid amount in Mesos (must exceed currentBid). */
  amount: number;
}

/** Server → client: paginated browse results (extended for auctions + expiry). */
export interface MarketBrowseResultPayloadV2 {
  listings: {
    listingId: string;
    sellerId: string;
    sellerName: string;
    defId: string;
    uid?: string;
    qty: number;
    pricePerUnit: number;
    totalPrice: number;
    baseRank: string;
    potentialTier: string;
    lines: number;
    itemName: string;
    /** Listing type: "fixed" or "auction". */
    listingType: "fixed" | "auction";
    /** Epoch-ms when the listing expires (0 = no expiry). */
    endsAt: number;
    /** Current highest bid for auctions (0 for fixed). */
    currentBid: number;
  }[];
  total: number;
  offset: number;
  limit: number;
}

/** Server → client: paginated buy order results. */
export interface MarketBrowseBuyOrdersResultPayload {
  buyOrders: {
    buyOrderId: string;
    buyerCharId: string;
    buyerName: string;
    defId: string;
    maxPrice: number;
    qty: number;
    itemName: string;
    createdAt: number;
  }[];
  total: number;
  offset: number;
  limit: number;
}

/** Server → client: price history for a specific item def. */
export interface MarketPriceHistoryPayload {
  defId: string;
  entries: {
    salePrice: number;
    soldAt: number;
  }[];
}

// ─── Shared Account Storage ───────────────────────────────────────────────────

/** Client → server: deposit an item from character inventory into the account stash. */
export interface StorageDepositPayload {
  /** uid of the item in the character's inventory to deposit. */
  uid: string;
  /** Quantity to deposit (1 for equips; ≥1 for stackables). Defaults to 1. */
  qty?: number;
}

/** Client → server: withdraw an item from the account stash into character inventory. */
export interface StorageWithdrawPayload {
  /** uid of the item in the account stash to withdraw. */
  uid: string;
  /** Quantity to withdraw (1 for equips; ≥1 for stackables). Defaults to 1. */
  qty?: number;
}

/** Server → client: full account stash sync (sent on open and after mutations). */
export interface StorageSyncPayload {
  /** Items currently in the account stash. */
  items: {
    uid: string;
    defId: string;
    baseRank: string;
    potentialTier: string;
    lines: number;
    count: number;
  }[];
  /** Max stash capacity (number of slots). */
  capacity: number;
}

/** Server → client: result of a storage deposit/withdraw attempt. */
export interface StorageResultPayload {
  success: boolean;
  /** The updated character mesos balance (if the operation had a fee). */
  mesos?: number;
  message: string;
}

// ─── Party (group play, session-scoped) ──────────────────────────────────────

/** Client → server: invite another player to join your party. */
export interface PartyInvitePayload {
  /** Target player name (resolved server-side for cross-map invites). */
  targetName: string;
}

/** Server → client: you received a party invite. */
export interface PartyInviteReceivedPayload {
  /** Char id of the inviter (stable across rooms). */
  fromCharId: string;
  /** Inviter's name. */
  fromName: string;
}

/** Client → server: accept a pending party invite. */
export interface PartyAcceptPayload {
  /** Char id of the inviter who sent the invite. */
  fromCharId: string;
}

/** Client → server: leave the current party. */
export type PartyLeavePayload = Record<string, never>;

/** Client → server: kick a member from the party (leader only). */
export interface PartyKickPayload {
  /** Char id of the member to kick. */
  targetCharId: string;
}

/** A single party member's snapshot (pushed to all party members). */
export interface PartyMemberSnapshot {
  charId: string;
  sessionId: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  dead: boolean;
  mapId: string;
  /** True if this member is the party leader. */
  leader: boolean;
}

/** Server → client: full party state snapshot (sent on every membership or stat change). */
export interface PartyUpdatePayload {
  /** The party id (empty string if the player is not in a party). */
  partyId: string;
  /** Current members. */
  members: PartyMemberSnapshot[];
  /** Current loot distribution rule. */
  lootRule: LootRule;
}

/** Loot distribution rule for party drops. */
export type LootRule = "ffa" | "roundRobin" | "leader";

/** Client → server: leader changes the party loot distribution rule. */
export interface PartySetLootRulePayload {
  lootRule: LootRule;
}

// ─── LFG / Party Finder ─────────────────────────────────────────────────────

/** Client → server: post a party finder / LFG listing. */
export interface LfgPostPayload {
  /** Content type (e.g. "boss", "grind", "pq", "quest"). */
  contentType: string;
  /** Minimum level for the listing. */
  levelMin: number;
  /** Maximum level for the listing. */
  levelMax: number;
  /** Free-text description of the listing. */
  message: string;
}

/** A single LFG listing as seen by the client. */
export interface LfgListingSnapshot {
  listingId: string;
  hostCharId: string;
  hostName: string;
  hostLevel: number;
  contentType: string;
  levelMin: number;
  levelMax: number;
  message: string;
  memberCount: number;
  maxMembers: number;
  createdAt: number;
}

/** Server → client: paginated LFG listing results. */
export interface LfgListResultPayload {
  listings: LfgListingSnapshot[];
}

/** Client → server: join an LFG listing (forms a party). */
export interface LfgJoinPayload {
  listingId: string;
}

/** Client → server: remove your own LFG listing. */
export interface LfgRemovePayload {
  listingId: string;
}

// ─── Equipment Repair / Mesos Sink ──────────────────────────────────────────

/** Client → server: request repair (upkeep) of all equipped or a specific item. */
export interface RepairEquipmentPayload {
  /** Optional uid of a specific item to repair. If omitted, repair all equipped. */
  uid?: string;
}

/** Server → client: result of a repair attempt. */
export interface RepairResultPayload {
  success: boolean;
  /** Total mesos spent on repair. */
  cost: number;
  /** Character's mesos balance after repair. */
  mesos: number;
  message: string;
}

// ─── Cube (Potential Reroll) ───────────────────────────────────────────────

/** Client → server: reroll an item's potential tier + bonus stat lines. */
export interface CubeRerollPayload {
  /** uid of the item in inventory to reroll. */
  uid: string;
}

/** Server → client: result of a cube reroll attempt. */
export interface CubeRerollResultPayload {
  success: boolean;
  /** uid of the rerolled item. */
  uid?: string;
  /** The item's potential tier BEFORE the reroll. */
  prevTier?: string;
  /** The item's potential lines BEFORE the reroll. */
  prevLines?: readonly { readonly stat: string; readonly percent: number }[];
  /** The item's potential tier AFTER the reroll. */
  newTier?: string;
  /** The item's potential lines AFTER the reroll. */
  newLines?: readonly { readonly stat: string; readonly percent: number }[];
  /** Mesos balance after the reroll. */
  mesos?: number;
  /** Hex-encoded seed for the verifiable roll (Phase 2: Chainlink VRF). */
  rollSeed?: string;
  /** Hex-encoded commitment for the verifiable roll. */
  rollCommitment?: string;
  /** True when the new tier is Legendary — signals the on-chain mint pipeline (Phase 2). */
  mintPending?: boolean;
  message: string;
}

// ─── Base-Rank Upgrade (NORMAL→ENHANCED→STARFORGED→MYTHIC) ───────────────

/** Client → server: request a base-rank upgrade on an inventory item. */
export interface UpgradeItemPayload {
  /** uid of the item in inventory to upgrade. */
  uid: string;
}

/** Server → client: result of a base-rank upgrade attempt. */
export interface UpgradeItemResultPayload {
  success: boolean;
  /** uid of the affected item. */
  uid?: string;
  /** The item's base rank BEFORE the attempt. */
  prevRank?: string;
  /** The item's base rank AFTER the attempt. */
  newRank?: string;
  /** True when the failure caused a rank demotion. */
  downgraded?: boolean;
  /** Mesos balance after the attempt. */
  mesos?: number;
  /** Materials remaining after the attempt. */
  materials?: number;
  message: string;
}

// ─── Flame (Bonus Stat Reroll) ─────────────────────────────────────────────

/** Client → server: re-roll an item's bonus (flame) stat lines. */
export interface FlameRerollPayload {
  /** uid of the item in inventory to re-roll. */
  uid: string;
}

/** Server → client: result of a flame re-roll attempt. */
export interface FlameRerollResultPayload {
  success: boolean;
  /** uid of the item. */
  uid?: string;
  /** The item's bonus stats BEFORE the re-roll. */
  prevBonus?: readonly { readonly stat: string; readonly value: number; readonly tier: string }[];
  /** The item's bonus stats AFTER the re-roll. */
  newBonus?: readonly { readonly stat: string; readonly value: number; readonly tier: string }[];
  /** Mesos balance after the re-roll. */
  mesos?: number;
  message: string;
}

// ─── Star Force (per-star enhancement) ──────────────────────────────────────

/** Client → server: attempt a star-force upgrade on an item. */
export interface StarForcePayload {
  /** uid of the item in inventory to star-force. */
  uid: string;
}

/** Server → client: result of a star-force attempt. */
export interface StarForceResultPayload {
  success: boolean;
  /** "success" | "fail" | "destroy" */
  outcome?: string;
  /** uid of the affected item (absent on destroy). */
  uid?: string;
  /** Star count BEFORE the attempt. */
  prevStars?: number;
  /** Star count AFTER the attempt (0 on destroy). */
  newStars?: number;
  /** Mesos balance after the attempt. */
  mesos?: number;
  message: string;
}

// ─── Guild (persistent cross-map social) ─────────────────────────────────────

/** Guild ranks — master > officer > member. */
export type GuildRank = "master" | "officer" | "member";

/** A single guild member as seen in the roster. */
export interface GuildMember {
  charId: string;
  name: string;
  level: number;
  rank: GuildRank;
  /** True if the member is currently online somewhere. */
  online: boolean;
}

/** Full guild state snapshot sent to all members. */
export interface GuildUpdatePayload {
  guildId: string;
  guildName: string;
  emblem: { color: number; label: string };
  members: GuildMember[];
  createdDate: number;
}

/** Client → server: create a new guild (costs mesos). */
export interface GuildCreatePayload {
  name: string;
  /** Emblem color as an integer (e.g. 0xff0000). */
  color: number;
}

/** Client → server: invite a player to join the guild. */
export interface GuildInvitePayload {
  targetSessionId: string;
}

/** Server → client: you received a guild invite. */
export interface GuildInviteReceivedPayload {
  fromSessionId: string;
  fromName: string;
  guildName: string;
}

/** Client → server: accept a pending guild invite. */
export interface GuildAcceptPayload {
  fromSessionId: string;
}

/** Client → server: leave the guild. */
export type GuildLeavePayload = Record<string, never>;

/** Client → server: kick a member from the guild. */
export interface GuildKickPayload {
  targetCharId: string;
}

/** Client → server: change a member's rank. */
export interface GuildRankPayload {
  targetCharId: string;
  newRank: GuildRank;
}

/** Client → server: send a guild chat message. */
export type GuildChatPayload = ChatPayload;

/** Server → client: guild chat from any online member across maps. */
export interface GuildChatRelayPayload {
  senderName: string;
  text: string;
}

/** Server → client: result of a guild action. */
export interface GuildResultPayload {
  success: boolean;
  message: string;
}

// ─── Channel system (multi-channel per map) ──────────────────────────────────

/** A single channel's info for the channel list. */
export interface ChannelInfo {
  channel: number;
  playerCount: number;
}

/** Server → client: list of available channels for the current map. */
export interface ChannelListPayload {
  channels: ChannelInfo[];
  current: number;
}

/** Client → server: request to switch to a different channel. */
export interface ChannelSwitchPayload {
  channel: number;
}

/** Server → client: result of a channel switch — client should leave + rejoin. */
export interface ChannelSwitchResultPayload {
  mapId: string;
  channel: number;
  spawnId: string;
}

/** Client → server: send a cross-channel whisper (direct message). */
export interface WhisperPayload {
  targetName: string;
  text: string;
}

/** Server → client: a whisper from another player (cross-channel). */
export interface WhisperRelayPayload {
  senderName: string;
  text: string;
}

/** Server → client: whisper target not found. */
export interface WhisperFailedPayload {
  targetName: string;
  reason: string;
}

// ─── Fame ───────────────────────────────────────────────────────────────────

/** Client → server: give (+1) or take (-1) fame from another player. */
export interface GiveFamePayload {
  /** Target character id. */
  targetCharId: string;
  /** Amount: +1 or -1. */
  amount: 1 | -1;
}

/** Server → client: result of a fame action. */
export interface FameResultPayload {
  success: boolean;
  /** The target's new fame value. */
  targetFame: number;
  /** This player's new fame value (if they were the target of a fame action). */
  myFame?: number;
  message: string;
}

// ─── Codex ──────────────────────────────────────────────────────────────────

/** Server → client: full codex sync (sent on login and after updates). */
export interface CodexSyncPayload {
  /** mobId → total kill count. */
  codex: Record<string, number>;
  /** Total accumulated stat bonuses from codex milestones. */
  statBonus: {
    STR: number;
    DEX: number;
    INT: number;
    LUK: number;
    HP: number;
    MP: number;
  };
  /** Total EXP bonus multiplier from codex (e.g. 0.03 = +3%). */
  expBonus: number;
}

/** Client → server: request codex data (view codex UI). */
export type ViewCodexPayload = Record<string, never>;

// ─── Runes (map buff spawns) ──────────────────────────────────────────────

/** Type of buff a rune grants when activated. */
export type RuneType = "exp" | "speed" | "atk";

/** Server → client: a rune has spawned on the map. */
export interface RuneSpawnPayload {
  /** Unique id for this rune instance. */
  runeId: string;
  /** X position on the map. */
  x: number;
  /** Y position on the map. */
  y: number;
  /** Type of buff the rune grants. */
  runeType: RuneType;
  /** Seconds remaining before the rune despawns. */
  lifetimeSec: number;
}

/** Server → client: a rune has been removed (activated or timed out). */
export interface RuneDespawnPayload {
  /** The rune id that was removed. */
  runeId: string;
}

/** Server → client: a rune was activated (buff granted). */
export interface RuneActivatePayload {
  /** The rune id that was activated. */
  runeId: string;
  /** Display name of the rune type (e.g. "EXP Boost"). */
  buffName: string;
  /** Duration in seconds of the granted buff. */
  durationSec: number;
}

// ─── Treasure Hunter Boxes ─────────────────────────────────────────────────

/** Server → client: a treasure box has spawned on the map. */
export interface TreasureSpawnPayload {
  /** Unique id for this box instance. */
  boxId: string;
  /** X position on the map. */
  x: number;
  /** Y position on the map. */
  y: number;
  /** Current HP. */
  hp: number;
  /** Max HP. */
  maxHp: number;
  /** Seconds remaining before the box despawns. */
  lifetimeSec: number;
}

/** Server → client: a treasure box took damage. */
export interface TreasureHitPayload {
  /** The box id that was hit. */
  boxId: string;
  /** Damage dealt this hit. */
  damage: number;
  /** Current HP after damage. */
  hp: number;
  /** Max HP. */
  maxHp: number;
}

/** Server → client: a treasure box was destroyed (drops awarded). */
export interface TreasureDestroyPayload {
  /** The box id that was destroyed. */
  boxId: string;
  /** EXP awarded. */
  exp: number;
  /** Mesos awarded. */
  mesos: number;
}

/** Server → client: a treasure box timed out (not destroyed). */
export interface TreasureDespawnPayload {
  /** The box id that despawned. */
  boxId: string;
}

// ─── Reactors (placed breakable/interactive objects) ─────────────────────────

/** Server → client: a reactor spawned (initial or respawn). */
export interface ReactorSpawnPayload {
  reactorId: string;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

/** Server → client: a reactor took damage. */
export interface ReactorHitPayload {
  reactorId: string;
  damage: number;
  hp: number;
  maxHp: number;
}

/** Server → client: a reactor was broken (drops awarded). */
export interface ReactorDestroyPayload {
  reactorId: string;
  exp: number;
  mesos: number;
}

/** Server → client: a reactor was interacted with (switch/mechanism triggered). */
export interface ReactorInteractPayload {
  reactorId: string;
  triggerType?: string;
  triggerData?: string;
}

/** Server → client: a reactor despawned (respawn timer started). */
export interface ReactorDespawnPayload {
  reactorId: string;
}

// ─── Exploration Dispatch ────────────────────────────────────────────────

/** Client → server: start an exploration dispatch. */
export interface ExplorationStartPayload {
  mobId: string;
  duration: "short" | "medium" | "long";
}

/** Client → server: claim completed exploration rewards. */
export type ExplorationClaimPayload = Record<string, never>;

/** Server → client: full exploration sync. */
export interface ExplorationSyncPayload {
  slots: {
    slotIndex: number;
    mobId: string;
    startAt: number;
    duration: string;
    durationMs: number;
    completeAt: number;
    claimed: boolean;
  }[];
  maxSlots: number;
  /** Number of registered codex entries (kill count >= 1). */
  registeredCount: number;
}

/** Server → client: result of starting an exploration. */
export interface ExplorationStartResultPayload {
  success: boolean;
  message: string;
}

/** Server → client: result of claiming exploration rewards. */
export interface ExplorationClaimResultPayload {
  success: boolean;
  claims: {
    slotIndex: number;
    mobId: string;
    mesos: number;
    items: string[];
  }[];
  totalMesos: number;
  totalItems: string[];
  message: string;
}

// ─── Achievements ───────────────────────────────────────────────────────────

/** A single achievement for display. */
export interface AchievementSnapshot {
  id: string;
  name: string;
  description: string;
  category: string;
  completed: boolean;
  progress: { current: number; target: number }[];
}

/** Server → client: full achievement sync (sent on login and after updates). */
export interface AchievementSyncPayload {
  achievements: AchievementSnapshot[];
}

/** Server → client: a single achievement was just unlocked. */
export interface AchievementUnlockPayload {
  achievementId: string;
  name: string;
  description: string;
  rewards: {
    mesos?: number;
    exp?: number;
    title?: string;
  };
}

/** Client → server: request achievement data (view achievements UI). */
export type ViewAchievementsPayload = Record<string, never>;

// ─── Quickslot Hotbar ────────────────────────────────────────────────────

/** Client → server: cast a skill from a quickslot. */
export interface SkillCastPayload {
  skillId: string;
}

/** Server → client: result of a skill cast attempt. */
export interface SkillCastResultPayload {
  success: boolean;
  skillId: string;
  cooldownMs: number;
  message: string;
}

/** Server → client: broadcast a skill VFX event for cast animation rendering. */
export interface SkillVfxPayload {
  /** Session id of the caster. */
  sessionId: string;
  /** Skill id that was cast. */
  skillId: string;
  /** Caster position (x, y). */
  x: number;
  y: number;
  /** Caster facing direction. */
  facing: number;
}

/** Client → server: use a consumable from a quickslot. */
export interface UseConsumablePayload {
  defId: string;
}

/** Server → client: result of a consumable use attempt. */
export interface UseConsumableResultPayload {
  success: boolean;
  defId: string;
  cooldownMs: number;
  message: string;
}

/** A single quickslot entry (client layout, persisted server-side). */
export interface QuickSlotEntry {
  type: "skill" | "consumable";
  id: string;
}

/** Server → client: full quickslot layout for this character. */
export interface QuickSlotLayoutPayload {
  slots: (QuickSlotEntry | null)[];
}

// ─── Party Quest payloads ──────────────────────────────────────────────────

/** Client → server: request to join a PQ instance. */
export interface PQJoinPayload {
  /** PQ definition id (key in PARTY_QUESTS). */
  pqId: string;
}

/** A snapshot of one stage's progress. */
export interface PQStageSnapshot {
  ordinal: number;
  label: string;
  objectiveKind: string;
  current: number;
  target: number;
  completed: boolean;
}

/** Server → client: broadcast current PQ run state every tick / on stage advance. */
export interface PQProgressPayload {
  pqId: string;
  /** Remaining time in seconds. */
  timeRemainingSec: number;
  /** 0-based index of the active stage. */
  activeStage: number;
  /** Number of completed stages. */
  stagesCleared: number;
  /** Total number of stages. */
  totalStages: number;
  /** Per-stage progress snapshots. */
  stages: PQStageSnapshot[];
  /** Number of players currently in the instance. */
  playerCount: number;
}

/** Server → client: final PQ result after all stages or timeout. */
export interface PQResultPayload {
  pqId: string;
  success: boolean;
  /** Reward exp per player (only on success). */
  exp?: number;
  /** Reward mesos per player (only on success). */
  mesos?: number;
  /** Item def ids granted (only on success). */
  items?: readonly string[];
  /** PQ set equip def id granted (only on success). */
  setEquipDefId?: string;
  /** Reason for failure (timeout / disconnected). */
  reason?: string;
}

/** Client → server: a player contributed to the current stage objective. */
export interface PQContributePayload {
  /** Contribution amount (e.g. mob kill count, item collected count). */
  amount: number;
  /** Optional context: mob id, item id, or puzzle id. */
  contextId?: string;
}

// ─── Quest offer / turn-in UX ──────────────────────────────────────────────

/** A single objective for the quest offer panel. */
export interface QuestObjectiveInfo {
  readonly kind: string;
  readonly description: string;
  readonly target: number;
}

/** Server → client: a quest is being offered (accept/decline). */
export interface QuestOfferPayload {
  readonly questId: string;
  readonly questName: string;
  readonly giverNpcId: string;
  readonly giverNpcName: string;
  readonly objectives: readonly QuestObjectiveInfo[];
  readonly rewards: {
    readonly mesos?: number;
    readonly exp?: number;
    readonly items?: readonly string[];
  };
  readonly requiredLevel?: number;
}

/** Client → server: the player accepted the offered quest. */
export interface QuestAcceptPayload {
  readonly questId: string;
}

/** Client → server: the player declined the offered quest. */
export interface QuestDeclinePayload {
  readonly questId: string;
}

/** Server → client: a quest is ready for turn-in (show rewards panel). */
export interface QuestTurninOfferPayload {
  readonly questId: string;
  readonly questName: string;
  readonly giverNpcId: string;
  readonly giverNpcName: string;
  readonly rewards: {
    readonly mesos?: number;
    readonly exp?: number;
    readonly items?: readonly string[];
  };
}

/** Client → server: the player confirmed quest turn-in. */
export interface QuestTurninAcceptPayload {
  readonly questId: string;
}

/** Client → server: the player declined the quest turn-in. */
export interface QuestTurninDeclinePayload {
  readonly questId: string;
}

/** Client → server: the player abandoned an active quest. */
export interface QuestAbandonPayload {
  readonly questId: string;
}

// ─── Friends / Buddy list ───────────────────────────────────────────────

/** A single friend entry pushed by the server. */
export interface FriendEntry {
  charId: string;
  name: string;
  level: number;
  online: boolean;
  /** Current map id (if online). */
  mapId?: string;
}

/** Client → server: add a player to the friends list by name. */
export interface FriendAddPayload {
  targetName: string;
}

/** Client → server: remove a player from the friends list. */
export interface FriendRemovePayload {
  targetName: string;
}

/** Server → client: full friends list sync (sent on login and after mutations). */
export interface FriendListPayload {
  friends: FriendEntry[];
}

/** Server → client: result of a friend action. */
export interface FriendResultPayload {
  success: boolean;
  message: string;
}

/** Server → client: a friend was removed (or removed you). */
export interface FriendRemovedPayload {
  charId: string;
  name: string;
}

/** Server → client: batch of online-status changes for friends. */
export interface OnlineStatusPayload {
  updates: { charId: string; name: string; online: boolean; mapId?: string }[];
}

// ─── Guild enhancements ───────────────────────────────────────────────────

/** Client → server: disband the guild (master only). */
export type GuildDisbandPayload = Record<string, never>;

// ─── Combat QoL: Auto-Pot / Loot-All / Skill Macros ────────────────────────

/** Auto-pot configuration: threshold-based auto-use of HP/MP potions. */
export interface AutoPotConfig {
  hpEnabled: boolean;
  /** HP threshold as percentage (0–100). Auto-pot fires when hp/maxHp * 100 < hpThreshold. */
  hpThreshold: number;
  mpEnabled: boolean;
  /** MP threshold as percentage (0–100). */
  mpThreshold: number;
  /** Consumable defId to use for HP (e.g. "pot.large_hp"). */
  hpPotionId: string;
  /** Consumable defId to use for MP (e.g. "pot.large_mp"). */
  mpPotionId: string;
}

/** Server → client / client → server: sync auto-pot config. */
export interface AutoPotSyncPayload {
  config: AutoPotConfig;
}

/** A single step in a skill macro. */
export interface MacroStep {
  type: "skill" | "consumable";
  id: string;
}

/** A player-defined skill macro: a named sequence of skills/consumables. */
export interface SkillMacro {
  id: string;
  name: string;
  steps: MacroStep[];
}

/** Client → server / server → client: sync skill macro definitions. */
export interface MacroLayoutPayload {
  macros: SkillMacro[];
}

/** Client → server: execute a skill macro by id. */
export interface MacroCastPayload {
  macroId: string;
}

// ─── Bug Report / Feedback ──────────────────────────────────────────────

/** Feedback category. */
export type FeedbackCategory = "bug" | "idea" | "balance";

/** Client → server: submit a bug report or feedback. */
export interface FeedbackSubmitPayload {
  category: FeedbackCategory;
  message: string;
  /** Client-reported context (auto-attached). */
  context: {
    mapId: string;
    x: number;
    y: number;
    level: number;
    archetype: string;
    clientVersion: string;
    serverVersion: string;
    logLines: string[];
    userAgent: string;
  };
}

/** Server → client: result of a feedback submission. */
export interface FeedbackResultPayload {
  success: boolean;
  message: string;
}

// ─── Moderation (alpha admin tooling) ─────────────────────────────────────

/** Client → server: report another player for misconduct. */
export interface PlayerReportPayload {
  /** Name of the player being reported. */
  targetName: string;
  /** Reason for the report (e.g. "cheating", "harassment", "spam"). */
  reason: string;
  /** Auto-attached recent chat context (last N messages involving the target). */
  chatContext: string[];
}

/** Server → client: result of a player report submission. */
export interface PlayerReportResultPayload {
  success: boolean;
  message: string;
}

/** Client → server: block a player (suppress their chat/whispers/trades/party invites). */
export interface BlockPlayerPayload {
  targetName: string;
}

/** Client → server: unblock a previously blocked player. */
export interface UnblockPlayerPayload {
  targetName: string;
}

/** Server → client: full blocked-list sync (sent on login and after mutations). */
export interface BlockedListResultPayload {
  blockedNames: string[];
}

/** Server → client: scrolling server-announcement banner broadcast. */
export interface ServerAnnouncementPayload {
  text: string;
}

/** Server → client: generic result for moderation actions (mute/kick/ban). */
export interface ModActionResultPayload {
  success: boolean;
  message: string;
}

// ─── Familiar system payloads ──────────────────────────────────────────────

/** Server → client: full familiar collection sync (sent on login and after changes). */
export interface FamiliarSyncPayload {
  registered: string[];
  summoned: string[];
}

/** Client → server: summon a familiar by its mob def id. */
export interface FamiliarSummonPayload {
  mobId: string;
}

/** Client → server: dismiss a summoned familiar. */
export interface FamiliarDismissPayload {
  mobId: string;
}

/** Server → client: you found a familiar card! */
export interface FamiliarCardDropPayload {
  mobId: string;
  mobName: string;
}

// ─── GM / Admin commands (in-game console) ─────────────────────────────────

/** Client → server: a GM command string (slash-prefixed). */
export interface GmCommandPayload {
  /** Raw command string, e.g. "/give mesos 1000" or "/tp meadowfield". */
  command: string;
}

/** Server → client: result of a GM command execution. */
export interface GmResultPayload {
  success: boolean;
  message: string;
}

/** An entry in the GM audit log. */
export interface GmAuditEntry {
  id: number;
  accountId: string;
  charName: string;
  command: string;
  targetPlayer: string;
  result: string;
  createdAt: number;
}

// ─── Titles ────────────────────────────────────────────────────────────────

/** Client → server: equip or unequip a title (empty string = unequip). */
export interface EquipTitlePayload {
  title: string;
}

/** Server → client: full title sync (sent on login and after changes). */
export interface TitleSyncPayload {
  ownedTitles: string[];
  equippedTitle: string;
}

// ─── Daily Login Gift (once-per-UTC-day reward) ────────────────────────────

/** Server → client: daily login gift status (sent on join, after claim). */
export interface DailyLoginGiftSyncPayload {
  /** Whether the gift is claimable right now. */
  claimable: boolean;
  /** The reward preview (always present so client can display it). */
  reward: { mesos: number; exp: number };
  /** Server UTC date key for display. */
  dateKey: string;
  /** True if this sync follows a successful claim. */
  claimed?: boolean;
}

// ─── Inventory Sort ───────────────────────────────────────────────────

/** Client → server: request server-side sort of an inventory tab. */
export interface InventorySortPayload {
  tab: InventoryTab;
}

// ─── Pet system payloads ─────────────────────────────────────────────────

/** Client → server: summon a pet by its def id. */
export interface PetSummonPayload {
  petId: string;
}

/** Client → server: dismiss the currently active pet. */
export type PetDismissPayload = Record<string, never>;

/** Client → server: feed the active pet with a consumable from inventory. */
export interface PetFeedPayload {
  /** The uid of the pet food consumable item in inventory. */
  itemUid: string;
}

/** Server → client: full pet state sync (sent on join and after changes). */
export interface PetSyncPayload {
  /** Active pet def id (empty string = no pet). */
  activePetId: string;
  /** Current fullness (0–100). */
  fullness: number;
  /** Whether the pet is currently summoned. */
  summoned: boolean;
  /** Pet x position (if summoned). */
  x: number;
  /** Pet y position (if summoned). */
  y: number;
}

// ─── Emote system payloads ─────────────────────────────────────────────────

/** Client → server: the player triggered an emote by id. */
export interface EmotePayload {
  emoteId: string;
}

/** Server → client: broadcast an emote from a player to everyone in the map. */
export interface EmoteDisplayPayload {
  sessionId: string;
  emoteId: string;
}
