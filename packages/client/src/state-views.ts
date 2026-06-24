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
  minted: boolean;
}

export interface PlayerView {
  x: number;
  y: number;
  facing: number;
  tick: number;
  name: string;
  archetype: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  dead: boolean;
  str: number;
  dex: number;
  intel: number;
  luk: number;
  exp: number;
  ap: number;
  sp: number;
  mesos: number;
  attacking: boolean;
  inventory: MapSchema<InventoryItemView>;
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

export interface TownStateView {
  mapWidth: number;
  mapHeight: number;
  players: MapSchema<PlayerView>;
  mobs: MapSchema<MobView>;
  loot: MapSchema<LootView>;
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
}

/** The synced order book published by MarketRoom. */
export interface MarketStateView {
  listings: MapSchema<ListingView>;
  /** Protocol fee in basis points taken from each sale (250 = 2.5%). */
  feeBps: number;
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
