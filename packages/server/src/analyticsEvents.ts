/**
 * Structured analytics events emitted by the server for alpha-success measurement.
 *
 * Privacy: every event carries `accountHash` — a SHA-256 hex digest of the raw
 * accountId. No PII (names, IPs, etc.) is ever written.
 *
 * The canonical payload types live here; rooms call `analytics.track(event)` and
 * the store appends to the durable log.
 */

// ─── Event type enum ────────────────────────────────────────────────────────

export const AnalyticsEventType = {
  /** New account shell created via `getOrCreate`. */
  ACCOUNT_CREATED: "account_created",
  /** First character on an account created. */
  CHARACTER_CREATED: "character_created",
  /** Player enters a room (town / map / market). */
  SESSION_START: "session_start",
  /** Player leaves a room. */
  SESSION_END: "session_end",
  /** At least one level gained from an EXP grant. */
  LEVEL_UP: "level_up",
  /** Job tier advanced (1st or 2nd). */
  JOB_ADVANCE: "job_advance",
  /** Quest accepted by the player. */
  QUEST_ACCEPT: "quest_accept",
  /** Quest successfully turned in (rewards granted). */
  QUEST_COMPLETE: "quest_complete",
  /** Player listed an item on the Free Market for the first time. */
  MARKET_FIRST_LIST: "market_first_list",
  /** A market sale occurred (item purchased by another player). */
  MARKET_SALE: "market_sale",
  /** A boss mob was killed by a player. */
  BOSS_KILL: "boss_kill",
  /** A party quest run completed (success or fail). */
  PARTY_QUEST_RUN: "party_quest_run",
  /** Player died (HP hit 0). */
  DEATH: "death",
  /** Player disconnected / left a room, keyed by map. */
  DISCONNECT_BY_MAP: "disconnect_by_map",
  /** Player purchased from the Free Market for the first time. */
  MARKET_FIRST_BUY: "market_first_buy",
  /** A buy order was placed or auto-filled. */
  MARKET_BUY_ORDER: "market_buy_order",
  /** A bid was placed on an auction listing. */
  MARKET_AUCTION_BID: "market_auction_bid",
  /** An auction listing ended (settlement or expiry). */
  MARKET_AUCTION_END: "market_auction_end",
  /** Player completed a tutorial step (Dawn Isle chain). */
  TUTORIAL_STEP: "tutorial_step",
  /** Player-to-player direct trade completed. */
  TRADE_COMPLETE: "trade_complete",
} as const;

export type AnalyticsEventType = (typeof AnalyticsEventType)[keyof typeof AnalyticsEventType];

// ─── Payload types (one per event) ──────────────────────────────────────────

export interface AccountCreatedPayload {
  /** Unix-ms timestamp of account creation. */
  createdAt: number;
}

export interface CharacterCreatedPayload {
  /** Class archetype chosen (e.g. "BEGINNER", "WARRIOR"). */
  class: string;
  /** Character name. */
  name: string;
}

export interface SessionStartPayload {
  /** Room type the player joined. */
  roomType: string;
  /** Map id (for MapRoom) or zone name. */
  mapId: string;
}

export interface SessionEndPayload {
  /** Room type the player left. */
  roomType: string;
  /** Map id (for MapRoom) or zone name. */
  mapId: string;
  /** Duration of the session in milliseconds. */
  durationMs: number;
  /** Player level at session end. */
  level: number;
}

export interface LevelUpPayload {
  /** New level after the gain. */
  level: number;
  /** Number of levels gained in this tick. */
  levelsGained: number;
  /** Class archetype. */
  class: string;
}

export interface JobAdvancePayload {
  /** New job tier (1 or 2). */
  jobTier: number;
  /** New class archetype after advancement. */
  class: string;
  /** Branch id (only for 2nd-job). */
  branchId?: string;
  /** Player level at advancement. */
  level: number;
}

export interface QuestAcceptPayload {
  /** Quest definition id. */
  questId: string;
  /** Player level at accept. */
  level: number;
}

export interface QuestCompletePayload {
  /** Quest definition id. */
  questId: string;
  /** EXP granted by the quest. */
  exp: number;
  /** Mesos granted by the quest. */
  mesos: number;
  /** Player level after completion (may be higher if quest EXP triggered a level-up). */
  level: number;
}

export interface MarketFirstListPayload {
  /** defId of the item listed. */
  itemDefId: string;
  /** Listing price in mesos. */
  price: number;
}

export interface MarketSalePayload {
  /** defId of the item sold. */
  itemDefId: string;
  /** Sale price in mesos. */
  price: number;
  /** Whether the reporting player is the seller (true) or buyer (false). */
  isSeller: boolean;
}

export interface BossKillPayload {
  /** Mob definition id of the boss. */
  mobId: string;
  /** Boss name (for readability). */
  name: string;
  /** Player level at kill. */
  level: number;
}

export interface PartyQuestRunPayload {
  /** Party quest definition id. */
  pqId: string;
  /** Whether the run succeeded. */
  success: boolean;
  /** Number of players who participated. */
  playerCount: number;
}

export interface DeathPayload {
  /** Map id where the death occurred. */
  mapId: string;
  /** Player level at death. */
  level: number;
}

export interface DisconnectByMapPayload {
  /** Map id the player was on when they disconnected. */
  mapId: string;
  /** Player level at disconnect. */
  level: number;
}

export interface MarketFirstBuyPayload {
  /** defId of the item purchased. */
  itemDefId: string;
  /** Purchase price in mesos. */
  price: number;
}

export interface MarketBuyOrderPayload {
  /** defId of the item the buy order is for. */
  itemDefId: string;
  /** Max price in mesos. */
  maxPrice: number;
  /** True if the buy order was auto-filled immediately. */
  autoFilled: boolean;
}

export interface MarketAuctionBidPayload {
  /** defId of the auction item. */
  itemDefId: string;
  /** Bid amount in mesos. */
  bidAmount: number;
  /** Whether this bidder is the new high bidder. */
  isHighBidder: boolean;
}

export interface MarketAuctionEndPayload {
  /** defId of the auction item. */
  itemDefId: string;
  /** Final sale price (highest bid). */
  finalPrice: number;
  /** True if the auction had at least one bid. */
  sold: boolean;
}

export interface TutorialStepPayload {
  /** Quest id that constitutes this tutorial step. */
  questId: string;
  /** Zero-based index in the tutorial chain. */
  stepIndex: number;
  /** Total number of steps in the tutorial chain. */
  totalSteps: number;
  /** Player level when this step was completed. */
  level: number;
  /** Whether this was the final step (tutorial complete). */
  completed: boolean;
}

export interface TradeCompletePayload {
  /** Number of items player A gave. */
  itemCountA: number;
  /** Number of items player B gave. */
  itemCountB: number;
  /** Mesos player A sent. */
  mesosA: number;
  /** Mesos player B sent. */
  mesosB: number;
  /** Player level at time of trade. */
  level: number;
}

// ─── Discriminated union for type-safe tracking ─────────────────────────────

export type AnalyticsPayload =
  | { type: typeof AnalyticsEventType.ACCOUNT_CREATED; payload: AccountCreatedPayload }
  | { type: typeof AnalyticsEventType.CHARACTER_CREATED; payload: CharacterCreatedPayload }
  | { type: typeof AnalyticsEventType.SESSION_START; payload: SessionStartPayload }
  | { type: typeof AnalyticsEventType.SESSION_END; payload: SessionEndPayload }
  | { type: typeof AnalyticsEventType.LEVEL_UP; payload: LevelUpPayload }
  | { type: typeof AnalyticsEventType.JOB_ADVANCE; payload: JobAdvancePayload }
  | { type: typeof AnalyticsEventType.QUEST_ACCEPT; payload: QuestAcceptPayload }
  | { type: typeof AnalyticsEventType.QUEST_COMPLETE; payload: QuestCompletePayload }
  | { type: typeof AnalyticsEventType.MARKET_FIRST_LIST; payload: MarketFirstListPayload }
  | { type: typeof AnalyticsEventType.MARKET_SALE; payload: MarketSalePayload }
  | { type: typeof AnalyticsEventType.BOSS_KILL; payload: BossKillPayload }
  | { type: typeof AnalyticsEventType.PARTY_QUEST_RUN; payload: PartyQuestRunPayload }
  | { type: typeof AnalyticsEventType.DEATH; payload: DeathPayload }
  | { type: typeof AnalyticsEventType.DISCONNECT_BY_MAP; payload: DisconnectByMapPayload }
  | { type: typeof AnalyticsEventType.MARKET_FIRST_BUY; payload: MarketFirstBuyPayload }
  | { type: typeof AnalyticsEventType.MARKET_BUY_ORDER; payload: MarketBuyOrderPayload }
  | { type: typeof AnalyticsEventType.MARKET_AUCTION_BID; payload: MarketAuctionBidPayload }
  | { type: typeof AnalyticsEventType.MARKET_AUCTION_END; payload: MarketAuctionEndPayload }
  | { type: typeof AnalyticsEventType.TUTORIAL_STEP; payload: TutorialStepPayload }
  | { type: typeof AnalyticsEventType.TRADE_COMPLETE; payload: TradeCompletePayload };
