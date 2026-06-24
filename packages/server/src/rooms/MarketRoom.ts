/**
 * MarketRoom — the Free Market (off-chain, Mesos). An authoritative order book: clients send
 * list/buy/cancel *requests*; the server validates funds + ownership against the shared AccountStore,
 * escrows items, moves Mesos, and takes a protocol fee (the reskinned MTS tax).
 *
 * The synced state is the public order book. Each client also receives a private `wallet` push
 * (their Mesos + inventory) so the UI knows what they can list/afford — never broadcast to others.
 *
 * This is the soft market. The on-chain Premium Market ($MAPLE) is Phase 2.
 */
import { Room, Client } from "colyseus";
import { getItemDef, getPotentialTierInfo, PotentialTier } from "@maple/shared";

import { MarketState } from "./schema/MarketState";
import { Listing } from "./schema/Listing";
import { accountStore, marketStore, type ItemRecord, type ListingRecord } from "../persistence/store";

interface ListMsg {
  itemUid: string;
  price: number;
}
interface IdMsg {
  listingId: string;
}

export class MarketRoom extends Room {
  state = new MarketState();
  maxClients = 100;

  /** sessionId → persistent accountId. */
  private accountBySession = new Map<string, string>();

  messages = {
    list: (client: Client, msg: ListMsg) => this.handleList(client, msg),
    buy: (client: Client, msg: IdMsg) => this.handleBuy(client, msg),
    cancel: (client: Client, msg: IdMsg) => this.handleCancel(client, msg),
  };

  onCreate(): void {
    // Hydrate the synced order book from durable storage.
    for (const rec of marketStore.all()) {
      this.state.listings.set(rec.listingId, listingFromRecord(rec));
    }
    console.log(`[market] Free Market room created (${this.state.listings.size} listings)`);
  }

  onJoin(client: Client, options: { accountId?: string } = {}): void {
    const accountId = (options.accountId || client.sessionId).slice(0, 64);
    this.accountBySession.set(client.sessionId, accountId);
    accountStore.getOrCreate(accountId);
    this.pushWallet(client);
    console.log("[market] join", client.sessionId, "account", accountId);
  }

  onLeave(client: Client): void {
    this.accountBySession.delete(client.sessionId);
  }

  onDispose(): void {
    accountStore.persistNow();
    marketStore.persistNow();
    console.log("[market] Free Market room disposed");
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────
  private handleList(client: Client, msg: ListMsg): void {
    const accountId = this.accountBySession.get(client.sessionId);
    if (!accountId) return;

    const price = Math.floor(Number(msg?.price));
    if (!Number.isFinite(price) || price <= 0) {
      return this.reject(client, "Price must be a positive number.");
    }

    const acc = accountStore.getOrCreate(accountId);
    const item = acc.inventory[msg?.itemUid];
    if (!item) return this.reject(client, "You don't own that item.");

    // Escrow: remove from inventory, place on the book.
    accountStore.removeItem(accountId, item.uid);
    const rec = marketStore.add({
      sellerId: accountId,
      sellerName: shortName(accountId),
      item,
      price,
    });
    this.state.listings.set(rec.listingId, listingFromRecord(rec));

    this.pushWallet(client);
    console.log(`[market] list ${rec.listingId}: ${item.defId} for ${price} mesos`);
  }

  private handleCancel(client: Client, msg: IdMsg): void {
    const accountId = this.accountBySession.get(client.sessionId);
    if (!accountId) return;

    const rec = marketStore.get(msg?.listingId);
    if (!rec) return this.reject(client, "Listing not found.");
    if (rec.sellerId !== accountId) return this.reject(client, "Not your listing.");

    // Return the escrowed item to the seller.
    accountStore.addItem(accountId, rec.item);
    marketStore.remove(rec.listingId);
    this.state.listings.delete(rec.listingId);

    this.pushWallet(client);
    console.log(`[market] cancel ${rec.listingId}`);
  }

  private handleBuy(client: Client, msg: IdMsg): void {
    const buyerId = this.accountBySession.get(client.sessionId);
    if (!buyerId) return;

    const rec = marketStore.get(msg?.listingId);
    if (!rec) return this.reject(client, "Listing no longer available.");
    if (rec.sellerId === buyerId) return this.reject(client, "You can't buy your own listing.");

    if (!accountStore.spendMesos(buyerId, rec.price)) {
      return this.reject(client, "Not enough Mesos.");
    }

    // Settle: item → buyer; proceeds (minus fee) → seller.
    accountStore.addItem(buyerId, rec.item);
    const fee = Math.floor((rec.price * this.state.feeBps) / 10_000);
    accountStore.addMesos(rec.sellerId, rec.price - fee);

    marketStore.remove(rec.listingId);
    this.state.listings.delete(rec.listingId);

    this.pushWallet(client);
    this.pushWalletToAccount(rec.sellerId); // update the seller if they're online
    console.log(`[market] buy ${rec.listingId}: ${rec.item.defId} for ${rec.price} (fee ${fee})`);
  }

  // ─── Wallet sync (private, per-client) ──────────────────────────────────────
  private pushWallet(client: Client): void {
    const accountId = this.accountBySession.get(client.sessionId);
    if (!accountId) return;
    const acc = accountStore.getOrCreate(accountId);
    client.send("wallet", {
      mesos: acc.mesos,
      items: Object.values(acc.inventory).map(decorateItem),
    });
  }

  private pushWalletToAccount(accountId: string): void {
    for (const [sessionId, accId] of this.accountBySession) {
      if (accId === accountId) {
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) this.pushWallet(client);
      }
    }
  }

  private reject(client: Client, reason: string): void {
    client.send("market_error", { reason });
  }
}

function shortName(accountId: string): string {
  return accountId.length <= 8 ? accountId : `${accountId.slice(0, 6)}…`;
}

/** Attach display labels (item name, tier color) the client needs to render a listing/wallet item. */
function decorateItem(item: ItemRecord) {
  const def = getItemDef(item.defId);
  const tierInfo = getPotentialTierInfo(item.potentialTier as PotentialTier);
  return {
    ...item,
    name: def ? def.name : item.defId,
    tierLabel: tierInfo.label,
    tierColor: tierInfo.color,
  };
}

function listingFromRecord(rec: ListingRecord): Listing {
  const listing = new Listing();
  listing.listingId = rec.listingId;
  listing.sellerId = rec.sellerId;
  listing.sellerName = rec.sellerName;
  listing.defId = rec.item.defId;
  listing.baseRank = rec.item.baseRank;
  listing.potentialTier = rec.item.potentialTier;
  listing.lines = rec.item.lines;
  listing.price = rec.price;
  listing.createdAt = rec.createdAt;
  return listing;
}
