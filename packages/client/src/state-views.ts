/**
 * Lightweight client-side views of the server's synced schema. Mirrors the @type fields on the
 * server's Player/Mob/LootDrop so scenes get autocomplete + type-safety without importing server
 * code into the browser bundle. Keep in sync with packages/server/src/rooms/schema/*.
 */
import type { MapSchema } from "@colyseus/schema";

export interface InventoryItemView {
  uid: string;
  defId: string;
  baseRank: string;
  potentialTier: string;
  lines: number;
  /** Potential bonus lines as JSON string: [{"stat":"ATK","percent":9}, ...]. */
  potentialLines: string;
  /** Flame bonus stats as JSON string: [{"stat":"STR","value":5,"tier":"RARE"}, ...]. */
  bonusStats: string;
  minted: boolean;
  /** Star Force level (0–15). */
  stars: number;
  count: number;
}

export interface PlayerView {
  x: number;
  y: number;
  facing: number;
  tick: number;
  name: string;
  archetype: string;
  /** Moderation role: "player" | "gm" | "admin" (gates GM-only UI). */
  role: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  dead: boolean;
  connected: boolean;
  str: number;
  dex: number;
  intel: number;
  luk: number;
  exp: number;
  ap: number;
  sp: number;
  mesos: number;
  attacking: boolean;
  // Side-scroller physics
  vy: number;
  grounded: boolean;
  climbing: boolean;
  ladderId: number;
  inventory: MapSchema<InventoryItemView>;
  equipped: MapSchema<string>;
  comboCount: number;
  knockbackVx: number;
  // Appearance (synced from server Player schema)
  gender: string;
  skinId: string;
  hairId: string;
  hairColorId: string;
  faceId: string;
  outfitId: string;
  // Titles
  equippedTitle: string;
  ownedTitles: string[];
  // Identity
  charId: string;
  /** Branch specialization id (e.g. "berserker"), set on 2nd-job advancement. */
  branchId: string;
  // Fame (synced from server — field is displayFame to avoid clash with FameState)
  displayFame: number;
}

export interface MobView {
  mobId: string;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  hit: boolean;
  vy: number;
  grounded: boolean;
  isElite: boolean;
  bossTelegraph: string;
  stunned: boolean;
}

export interface ProjectileView {
  id: string;
  ownerId: string;
  ownerMobId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  damage: number;
  kind: string;
  dead: boolean;
}

export interface LootView {
  uid: string;
  defId: string;
  potentialTier: string;
  lines: number;
  x: number;
  y: number;
  legendary: boolean;
}

export interface FamiliarView {
  mobId: string;
  ownerSession: string;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  hit: boolean;
}

export interface TownStateView {
  mapWidth: number;
  mapHeight: number;
  players: MapSchema<PlayerView>;
  mobs: MapSchema<MobView>;
  loot: MapSchema<LootView>;
  familiars: MapSchema<FamiliarView>;
  projectiles: MapSchema<ProjectileView>;
}

// ─── Party (group play, session-scoped) ───────────────────────────────────────────────────────

/** A single party member as received via PARTY_UPDATE. */
export interface PartyMemberView {
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
  leader: boolean;
}

// ─── Free Market (market_room) ───────────────────────────────────────────────────────────────────
// Mirrors packages/server/src/rooms/schema/{MarketState,Listing}.ts — keep in sync.

/** One item posted for sale on the Free Market for a Mesos price. */
export interface ListingView {
  listingId: string;
  sellerId: string;
  sellerName: string;
  defId: string;
  baseRank: string;
  potentialTier: string;
  lines: number;
  price: number;
  createdAt: number;
  /** Listing type: "fixed" (immediate buy) or "auction" (bidding). */
  listingType: string;
  /** Epoch-ms when the listing expires (0 = no expiry). */
  endsAt: number;
  /** Current highest bid for auctions (0 for fixed). */
  currentBid: number;
  /** charId of the current highest bidder ("" if none). */
  highBidderCharId: string;
}

/** A buy order (want-to-buy) posted by a player. */
export interface BuyOrderView {
  buyOrderId: string;
  buyerCharId: string;
  buyerName: string;
  defId: string;
  maxPrice: number;
  qty: number;
  mesosEscrowed: number;
  createdAt: number;
}

/** The synced order book published by MarketRoom. */
export interface MarketStateView {
  listings: MapSchema<ListingView>;
  buyOrders: MapSchema<BuyOrderView>;
  /** Protocol fee in basis points taken from each sale (250 = 2.5%). */
  feeBps: number;
}

// ─── Guild (persistent cross-map social) ─────────────────────────────────────────

/** A single guild member as received via GUILD_UPDATE. */
export interface GuildMemberView {
  charId: string;
  name: string;
  level: number;
  rank: string;
  online: boolean;
}

/** Full guild state pushed by the server. */
export interface GuildUpdateView {
  guildId: string;
  guildName: string;
  emblem: { color: number; label: string };
  members: GuildMemberView[];
  createdDate: number;
}

// ─── Friends / Buddy list ───────────────────────────────────────────────────────

/** A single friend as received via FRIEND_LIST. */
export interface FriendEntryView {
  charId: string;
  name: string;
  level: number;
  online: boolean;
  mapId?: string;
}

/** Mirrors StatusEffectInfo from @maple/shared/net — a single active buff/debuff. */
export interface StatusEffectView {
  id: string;
  kind: string;
  label: string;
  stacks: number;
  durationMs: number;
  remainingMs: number;
}

/**
 * A wallet item as delivered by MarketRoom's PRIVATE `wallet` message (not synced schema). It's an
 * inventory item the server has decorated with display labels (see `decorateItem` in MarketRoom).
 */
export interface WalletItemView extends InventoryItemView {
  name: string;
  tierLabel: string;
  tierColor: string;
}

/** Payload shape of MarketRoom's private `wallet` push. */
export interface WalletMessage {
  mesos: number;
  items: WalletItemView[];
}
