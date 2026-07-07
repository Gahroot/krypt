/**
 * MarketRoom — the Free Market (off-chain, Mesos). An authoritative order book: clients send
 * list/buy/cancel/browse *requests*; the server validates funds + ownership against the shared
 * AccountStore, escrows items, moves Mesos, and takes a protocol fee (the reskinned MTS tax).
 *
 * **Store Permit gate:** Only characters carrying a Store Permit item in their inventory may list
 * items. This mirrors MapleStory's cash-shop-gated FM access. The permit is NOT consumed on use.
 *
 * The synced state is the public order book. Each client also receives a private `wallet` push
 * (their Mesos + inventory) so the UI knows what they can list/afford — never broadcast to others.
 *
 * This is the soft market. The on-chain Premium Market ($MAPLE) is Phase 2.
 */
import { Client } from "colyseus";
import { AuthedRoom } from "./AuthedRoom";
import {
  FreeMarket,
  getItemDef,
  getPotentialTierInfo,
  PotentialTier,
  randomizeAppearance,
  type MarketSearchFilter,
  type ShopListing,
} from "@maple/shared";

import { MarketState } from "./schema/MarketState";
import { Listing } from "./schema/Listing";
import { BuyOrder as BuyOrderSchema } from "./schema/BuyOrder";
import {
  accountStore,
  marketStore,
  buyOrderStore,
  priceHistoryStore,
  treasuryStore,
  type ItemRecord,
  type ListingRecord,
  type BuyOrderRecord,
} from "../persistence/store";
import { track } from "../analytics";
import { AnalyticsEventType } from "../analyticsEvents";
import {
  RateLimiter,
  sanitizePrice,
  sanitizeQty,
  sanitizeListingId,
  sanitizeString,
  sanitizeDuration,
  sanitizeBidAmount,
  logAnomaly,
} from "../validate";

// ─── Store Permit ─────────────────────────────────────────────────────────────

/**
 * defId of the item that gates market listing access. A character must carry at least one
 * of these in their inventory to open a shop / list items. NOT consumed on use.
 */
export const STORE_PERMIT_DEFID = "cash.store_permit";

// ─── Message payloads ─────────────────────────────────────────────────────────

interface ListMsg {
  itemUid: string;
  price: number;
  pricePerUnit?: number;
  qty?: number;
  duration?: number; // ms before expiry (0 = no expiry)
  listingType?: string; // "fixed" | "auction"
}
interface IdMsg {
  listingId: string;
}
interface BrowseMsg {
  slot?: string;
  levelMin?: number;
  levelMax?: number;
  potentialTier?: string;
  baseRank?: string;
  priceMin?: number;
  priceMax?: number;
  query?: string;
  sortBy?: string;
  sortOrder?: string;
  offset?: number;
  limit?: number;
}
interface PlaceBuyOrderMsg {
  defId: string;
  maxPrice: number;
  qty?: number;
}
interface BidMsg {
  listingId: string;
  amount: number;
}
interface PriceHistoryMsg {
  defId: string;
}

// ─── Room ─────────────────────────────────────────────────────────────────────

export class MarketRoom extends AuthedRoom<MarketState> {
  state = new MarketState();
  maxClients = 100;

  /** Hard cap on listing price to prevent overflow / absurd values. */
  private static readonly MAX_LIST_PRICE = 1_000_000_000;
  /** Rate limiter for list/buy/cancel actions: 10/sec per client. */
  private actionLimiter = new RateLimiter(10, 0.01);

  /** sessionId → persistent charId. */
  private charBySession = new Map<string, string>();

  /** sessionId → timestamp (ms) when the player joined (for session duration). */
  private sessionStartMs = new Map<string, number>();

  /** charId → accountId for analytics. */
  private accountByChar = new Map<string, string>();

  /** Track first market list per charId for analytics. */
  private marketListedChars = new Set<string>();

  /** Track first market buy per charId for analytics. */
  private marketBoughtChars = new Set<string>();

  /** Pure in-memory order book used for search/filter (mirrors Colyseus state). */
  private book = new FreeMarket();

  /** Interval (ms) between sweeps for expired listings/auctions. */
  private static readonly SWEEP_INTERVAL_MS = 1_000;
  private sweepTimer?: ReturnType<typeof setInterval>;

  messages = {
    list: (client: Client, msg: ListMsg) => this.handleList(client, msg),
    buy: (client: Client, msg: IdMsg) => this.handleBuy(client, msg),
    cancel: (client: Client, msg: IdMsg) => this.handleCancel(client, msg),
    browse: (client: Client, msg: BrowseMsg) => this.handleBrowse(client, msg),
    place_buy_order: (client: Client, msg: PlaceBuyOrderMsg) =>
      this.handlePlaceBuyOrder(client, msg),
    cancel_buy_order: (client: Client, msg: { buyOrderId: string }) =>
      this.handleCancelBuyOrder(client, msg),
    bid: (client: Client, msg: BidMsg) => this.handleBid(client, msg),
    price_history: (client: Client, msg: PriceHistoryMsg) => this.handlePriceHistory(client, msg),
  };

  onCreate(): void {
    // Hydrate the synced order book from durable storage.
    for (const rec of marketStore.all()) {
      const listing = listingFromRecord(rec);
      this.state.listings.set(rec.listingId, listing);
      this.book.addListing(toShopListing(rec));
    }
    // Hydrate buy orders.
    for (const rec of buyOrderStore.all()) {
      const schema = buyOrderToSchema(rec);
      this.state.buyOrders.set(rec.buyOrderId, schema);
      this.book.addBuyOrder(buyOrderToShared(rec));
    }
    // Start the sweep timer for expired listings/auctions.
    this.sweepTimer = setInterval(() => this.sweepExpired(), MarketRoom.SWEEP_INTERVAL_MS);
    this.logCreate({
      listings: this.state.listings.size,
      buyOrders: this.state.buyOrders.size,
    });
  }

  /** Resolve accountId from a session for error/lifecycle log context. */
  protected override accountIdForSession(sessionId: string): string | undefined {
    const charId = this.charBySession.get(sessionId);
    return charId ? this.accountByChar.get(charId) : undefined;
  }

  onJoin(client: Client, options: { charId?: string } = {}): void {
    // Trusted, server-verified identity from onAuth — never options.accountId.
    const accountId = (client.auth?.accountId ?? client.sessionId).slice(0, 64);
    let charId: string | undefined;
    if (options.charId) {
      const requested = accountStore.getCharacter(options.charId);
      // Only honor a requested charId that belongs to the authenticated account.
      if (requested && requested.accountId === accountId) charId = requested.charId;
    }
    if (!charId) {
      const chars = accountStore.listCharacters(accountId);
      charId = chars[0]?.charId;
    }
    if (!charId) {
      // No character yet — create a default one so the market is explorable.
      const rec = accountStore.createCharacter(accountId, {
        name: "Trader",
        archetype: "BEGINNER",
        appearance: randomizeAppearance(),
      });
      charId = rec.charId;
    }
    this.charBySession.set(client.sessionId, charId);
    this.accountByChar.set(charId, accountId);
    this.sessionStartMs.set(client.sessionId, Date.now());
    track(AnalyticsEventType.SESSION_START, accountId, charId, {
      roomType: "market",
      mapId: "freemarket",
    });
    this.pushWallet(client);
    this.logJoin(client, accountId, { charId });
  }

  onDrop(client: Client): void {
    this.allowReconnection(client, 30);
  }

  onReconnect(client: Client): void {
    // Re-push wallet so the client has an accurate view after reconnect.
    this.pushWallet(client);
    this.roomLog.info("client reconnected", {
      sessionId: client.sessionId,
      accountId: this.accountIdForSession(client.sessionId),
    });
  }

  onLeave(client: Client): void {
    const charId = this.charBySession.get(client.sessionId);
    const accountId = charId ? this.accountByChar.get(charId) : undefined;
    if (charId && accountId) {
      const startMs = this.sessionStartMs.get(client.sessionId) ?? Date.now();
      track(AnalyticsEventType.SESSION_END, accountId, charId, {
        roomType: "market",
        mapId: "freemarket",
        durationMs: Date.now() - startMs,
        level: 0,
      });
    }
    this.logLeave(client, { charId });
    this.charBySession.delete(client.sessionId);
    this.sessionStartMs.delete(client.sessionId);
  }

  onDispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    accountStore.persistNow();
    marketStore.persistNow();
    buyOrderStore.persistNow();
    this.logDispose();
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  /** List an item. Requires a Store Permit in inventory. */
  private handleList(client: Client, msg: ListMsg): void {
    if (!this.actionLimiter.consume(client.sessionId)) {
      logAnomaly(client.sessionId, "rate_limit", "market_list");
      return this.reject(client, "Too many requests. Please slow down.");
    }
    const charId = this.charBySession.get(client.sessionId);
    if (!charId) return;

    // ── Sanitize itemUid ─────────────────────────────────────────────────
    const itemUid =
      typeof msg?.itemUid === "string" && msg.itemUid.length > 0 && msg.itemUid.length <= 64
        ? msg.itemUid
        : null;
    if (!itemUid) {
      logAnomaly(client.sessionId, "malformed", "market_list_uid");
      return this.reject(client, "Invalid item.");
    }

    // ── Store Permit gate ────────────────────────────────────────────────
    if (!this.hasStorePermit(charId)) {
      return this.reject(client, "You need a Store Permit to open a shop.");
    }

    // ── Price validation ────────────────────────────────────────────────
    const rawPrice = msg?.pricePerUnit ?? msg?.price;
    const pricePerUnit = sanitizePrice(rawPrice, MarketRoom.MAX_LIST_PRICE);
    if (pricePerUnit === null) {
      return this.reject(client, "Price must be a positive number.");
    }

    // ── Quantity (defaults to 1 for equips) ─────────────────────────────
    const qty = sanitizeQty(msg?.qty) ?? 1;

    // ── Item ownership ──────────────────────────────────────────────────
    const item = accountStore.getItem(charId, itemUid);
    if (!item) return this.reject(client, "You don't own that item.");

    // Stackable check: can't list more than the character owns.
    if (item.count !== undefined && item.count < qty) {
      return this.reject(client, "You don't have enough of that item.");
    }

    // ── Listing type + expiry ──────────────────────────────────────────
    const listingType = msg?.listingType === "auction" ? "auction" : "fixed";
    const duration = sanitizeDuration(msg?.duration);
    const endsAt = duration > 0 ? Date.now() + duration : 0;

    // ── Escrow: remove from inventory, place on the book ────────────────
    accountStore.removeItem(charId, item.uid);
    const totalPrice = pricePerUnit * qty;
    const rec = marketStore.add({
      sellerId: charId,
      sellerName: shortName(accountStore.getCharacter(charId)?.name ?? charId),
      item: qty === 1 ? item : { ...item, count: qty },
      price: totalPrice,
      listingType,
      endsAt,
      currentBid: 0,
      highBidderCharId: "",
    });
    const syncListing = listingFromRecord(rec);
    this.state.listings.set(rec.listingId, syncListing);
    this.book.addListing(toShopListing(rec));

    this.pushWallet(client);
    // Analytics: first-time list tracking.
    const listAcct = this.accountByChar.get(charId);
    if (listAcct) {
      if (!this.marketListedChars.has(charId)) {
        this.marketListedChars.add(charId);
        track(AnalyticsEventType.MARKET_FIRST_LIST, listAcct, charId, {
          itemDefId: item.defId,
          price: totalPrice,
        });
      }
    }
    console.log(
      `[market] list ${rec.listingId}: ${item.defId} ×${qty} for ${pricePerUnit}/ea (${totalPrice} total) [${listingType}]`,
    );

    // ── Auto-match: check if any buy orders can fill this listing ────────
    if (listingType === "fixed") {
      this.autoMatchBuyOrders(toShopListing(rec));
    }
  }

  /** Cancel a listing the caller owns. Returns the escrowed item. */
  private handleCancel(client: Client, msg: IdMsg): void {
    if (!this.actionLimiter.consume(client.sessionId)) {
      logAnomaly(client.sessionId, "rate_limit", "market_cancel");
      return this.reject(client, "Too many requests. Please slow down.");
    }
    const listingId = sanitizeListingId(msg?.listingId);
    if (!listingId) {
      logAnomaly(client.sessionId, "malformed", "market_cancel_id");
      return this.reject(client, "Invalid listing.");
    }
    const charId = this.charBySession.get(client.sessionId);
    if (!charId) return;

    const rec = marketStore.get(listingId);
    if (!rec) return this.reject(client, "Listing not found.");
    if (rec.sellerId !== charId) return this.reject(client, "Not your listing.");

    // Return the escrowed item to the seller.
    accountStore.addItem(charId, rec.item);
    marketStore.remove(rec.listingId);
    this.state.listings.delete(rec.listingId);
    this.book.removeListing(rec.listingId);

    this.pushWallet(client);
    console.log(`[market] cancel ${rec.listingId}`);
  }

  /** Buy a listing. Buyer pays mesos; seller receives minus fee. */
  private handleBuy(client: Client, msg: IdMsg): void {
    if (!this.actionLimiter.consume(client.sessionId)) {
      logAnomaly(client.sessionId, "rate_limit", "market_buy");
      return this.reject(client, "Too many requests. Please slow down.");
    }
    const listingId = sanitizeListingId(msg?.listingId);
    if (!listingId) {
      logAnomaly(client.sessionId, "malformed", "market_buy_id");
      return this.reject(client, "Invalid listing.");
    }
    const buyerCharId = this.charBySession.get(client.sessionId);
    if (!buyerCharId) return;

    const rec = marketStore.get(listingId);
    if (!rec) return this.reject(client, "Listing no longer available.");
    if (rec.sellerId === buyerCharId) return this.reject(client, "You can't buy your own listing.");

    if (!accountStore.spendMesos(buyerCharId, rec.price)) {
      return this.reject(client, "Not enough Mesos.");
    }

    // Settle: item → buyer; proceeds (minus fee) → seller.
    // The fee is the sink: it leaves circulation and is recorded in the treasury.
    accountStore.addItem(buyerCharId, rec.item);
    const fee = Math.floor((rec.price * this.state.feeBps) / 10_000);
    accountStore.addMesos(rec.sellerId, rec.price - fee);
    if (fee > 0) treasuryStore.recordBurn(fee, "fm_tax");
    priceHistoryStore.record(rec.item.defId, rec.price);

    marketStore.remove(rec.listingId);
    this.state.listings.delete(rec.listingId);
    this.book.removeListing(rec.listingId);

    this.pushWallet(client);
    this.pushWalletToChar(rec.sellerId); // update the seller if they're online
    // Analytics: sale tracking (buyer side).
    const buyerAcct = this.accountByChar.get(buyerCharId);
    if (buyerAcct) {
      track(AnalyticsEventType.MARKET_SALE, buyerAcct, buyerCharId, {
        itemDefId: rec.item.defId,
        price: rec.price,
        isSeller: false,
      });
      // First-time buyer tracking.
      if (!this.marketBoughtChars.has(buyerCharId)) {
        this.marketBoughtChars.add(buyerCharId);
        track(AnalyticsEventType.MARKET_FIRST_BUY, buyerAcct, buyerCharId, {
          itemDefId: rec.item.defId,
          price: rec.price,
        });
      }
    }
    // Analytics: sale tracking (seller side).
    const sellerAcct = this.accountByChar.get(rec.sellerId);
    if (sellerAcct) {
      track(AnalyticsEventType.MARKET_SALE, sellerAcct, rec.sellerId, {
        itemDefId: rec.item.defId,
        price: rec.price,
        isSeller: true,
      });
    }
    console.log(`[market] buy ${rec.listingId}: ${rec.item.defId} for ${rec.price} (fee ${fee})`);
  }

  /** Browse / search all listings with filters. Paginated. */
  private handleBrowse(client: Client, msg: BrowseMsg): void {
    const charId = this.charBySession.get(client.sessionId);
    if (!charId) return;

    // Sanitize query string (strip null bytes, cap length).
    const query = sanitizeString(msg?.query, 64) || undefined;

    const filter: MarketSearchFilter = {
      ...(msg?.slot && { slot: sanitizeString(msg.slot, 16) as MarketSearchFilter["slot"] }),
      ...(msg?.levelMin !== undefined && {
        levelMin: Math.max(0, Math.floor(Number(msg.levelMin)) || 0),
      }),
      ...(msg?.levelMax !== undefined && {
        levelMax: Math.max(0, Math.floor(Number(msg.levelMax)) || 0),
      }),
      ...(msg?.potentialTier && {
        potentialTier: sanitizeString(msg.potentialTier, 16) as PotentialTier,
      }),
      ...(msg?.baseRank && {
        baseRank: sanitizeString(msg.baseRank, 16) as MarketSearchFilter["baseRank"],
      }),
      ...(msg?.priceMin !== undefined && {
        priceMin: Math.max(0, Math.floor(Number(msg.priceMin)) || 0),
      }),
      ...(msg?.priceMax !== undefined && {
        priceMax: Math.max(0, Math.floor(Number(msg.priceMax)) || 0),
      }),
      ...(query && { query }),
      ...(msg?.sortBy && { sortBy: msg.sortBy as MarketSearchFilter["sortBy"] }),
      ...(msg?.sortOrder && { sortOrder: msg.sortOrder as MarketSearchFilter["sortOrder"] }),
    };

    const results = this.book.search(filter);

    // Paginate.
    const offset = Math.max(0, Math.floor(Number(msg?.offset)) || 0);
    const limit = Math.min(100, Math.max(1, Math.floor(Number(msg?.limit)) || 20));
    const page = results.slice(offset, offset + limit);

    client.send("browse_result", {
      listings: page.map((l) => {
        const def = getItemDef(l.defId);
        return {
          listingId: l.id,
          sellerId: l.sellerId,
          sellerName: l.sellerName,
          defId: l.defId,
          uid: l.uid,
          qty: l.qty,
          pricePerUnit: l.pricePerUnit,
          totalPrice: l.pricePerUnit * l.qty,
          baseRank: l.baseRank,
          potentialTier: l.potentialTier,
          lines: l.lines,
          itemName: def !== undefined ? def.name : l.defId,
          listingType: l.listingType,
          endsAt: l.endsAt,
          currentBid: l.currentBid,
        };
      }),
      total: results.length,
      offset,
      limit,
    });
  }

  // ─── MTS: Buy Orders ──────────────────────────────────────────────────────

  /** Place a buy order (want-to-buy). Escrows mesos from the buyer. */
  private handlePlaceBuyOrder(client: Client, msg: PlaceBuyOrderMsg): void {
    if (!this.actionLimiter.consume(client.sessionId)) {
      logAnomaly(client.sessionId, "rate_limit", "market_buy_order");
      return this.reject(client, "Too many requests. Please slow down.");
    }
    const charId = this.charBySession.get(client.sessionId);
    if (!charId) return;

    const defId =
      typeof msg?.defId === "string" && msg.defId.length > 0 && msg.defId.length <= 64
        ? msg.defId
        : null;
    if (!defId) {
      logAnomaly(client.sessionId, "malformed", "market_buy_order_defid");
      return this.reject(client, "Invalid item id.");
    }

    const maxPrice = sanitizeBidAmount(msg?.maxPrice, MarketRoom.MAX_LIST_PRICE);
    if (maxPrice === null) {
      return this.reject(client, "Max price must be a positive number.");
    }

    const qty = sanitizeQty(msg?.qty) ?? 1;
    const totalEscrow = maxPrice * qty;

    // Escrow mesos from buyer.
    if (!accountStore.spendMesos(charId, totalEscrow)) {
      return this.reject(client, "Not enough Mesos.");
    }

    const buyerName = shortName(accountStore.getCharacter(charId)?.name ?? charId);
    const rec = buyOrderStore.add({
      buyerCharId: charId,
      buyerName,
      defId,
      maxPrice,
      qty,
      mesosEscrowed: totalEscrow,
    });

    const schema = buyOrderToSchema(rec);
    this.state.buyOrders.set(rec.buyOrderId, schema);
    this.book.addBuyOrder(buyOrderToShared(rec));

    this.pushWallet(client);

    const acct = this.accountByChar.get(charId);
    if (acct) {
      track(AnalyticsEventType.MARKET_BUY_ORDER, acct, charId, {
        itemDefId: defId,
        maxPrice,
        autoFilled: false,
      });
    }
    console.log(`[market] buy order ${rec.buyOrderId}: want ${defId} ×${qty} @ ≤${maxPrice}/ea`);

    // Auto-match: check if any existing listings can fill this buy order.
    this.autoMatchListingsForBuyOrder(buyOrderToShared(rec));
  }

  /** Cancel a buy order the caller owns. Returns escrowed mesos. */
  private handleCancelBuyOrder(client: Client, msg: { buyOrderId: string }): void {
    if (!this.actionLimiter.consume(client.sessionId)) {
      logAnomaly(client.sessionId, "rate_limit", "market_cancel_buy_order");
      return this.reject(client, "Too many requests. Please slow down.");
    }
    const buyOrderId = sanitizeListingId(msg?.buyOrderId);
    if (!buyOrderId) {
      logAnomaly(client.sessionId, "malformed", "market_cancel_buy_order_id");
      return this.reject(client, "Invalid buy order.");
    }
    const charId = this.charBySession.get(client.sessionId);
    if (!charId) return;

    const rec = buyOrderStore.get(buyOrderId);
    if (!rec) return this.reject(client, "Buy order not found.");
    if (rec.buyerCharId !== charId) return this.reject(client, "Not your buy order.");

    // Return escrowed mesos.
    accountStore.addMesos(charId, rec.mesosEscrowed);
    buyOrderStore.remove(rec.buyOrderId);
    this.state.buyOrders.delete(rec.buyOrderId);
    this.book.removeBuyOrder(rec.buyOrderId);

    this.pushWallet(client);
    console.log(
      `[market] cancel buy order ${rec.buyOrderId} (refunded ${rec.mesosEscrowed} mesos)`,
    );
  }

  // ─── MTS: Auction Bidding ──────────────────────────────────────────────────

  /** Place a bid on an auction listing. */
  private handleBid(client: Client, msg: BidMsg): void {
    if (!this.actionLimiter.consume(client.sessionId)) {
      logAnomaly(client.sessionId, "rate_limit", "market_bid");
      return this.reject(client, "Too many requests. Please slow down.");
    }
    const listingId = sanitizeListingId(msg?.listingId);
    if (!listingId) {
      logAnomaly(client.sessionId, "malformed", "market_bid_id");
      return this.reject(client, "Invalid listing.");
    }
    const bidderCharId = this.charBySession.get(client.sessionId);
    if (!bidderCharId) return;

    const rec = marketStore.get(listingId);
    if (!rec) return this.reject(client, "Listing not found.");
    if (rec.listingType !== "auction")
      return this.reject(client, "This listing is not an auction.");
    if (rec.sellerId === bidderCharId)
      return this.reject(client, "You can't bid on your own auction.");
    if (rec.endsAt > 0 && rec.endsAt <= Date.now())
      return this.reject(client, "This auction has ended.");

    const amount = sanitizeBidAmount(msg?.amount, MarketRoom.MAX_LIST_PRICE);
    if (amount === null || amount <= rec.currentBid) {
      return this.reject(
        client,
        `Bid must exceed the current bid of ${rec.currentBid.toLocaleString()} Mesos.`,
      );
    }

    // If there's a previous high bidder, refund their escrowed mesos.
    if (rec.highBidderCharId && rec.highBidderCharId !== bidderCharId) {
      accountStore.addMesos(rec.highBidderCharId, rec.currentBid);
      this.pushWalletToChar(rec.highBidderCharId);
    }

    // Escrow the new bid.
    if (!accountStore.spendMesos(bidderCharId, amount)) {
      return this.reject(client, "Not enough Mesos.");
    }

    // Update the record.
    marketStore.updateBid(listingId, amount, bidderCharId);
    rec.currentBid = amount;
    rec.highBidderCharId = bidderCharId;

    // Sync to Colyseus state.
    const syncListing = listingFromRecord(rec);
    this.state.listings.set(listingId, syncListing);

    this.pushWallet(client);
    // Update the previous high bidder's wallet if they're online.

    const acct = this.accountByChar.get(bidderCharId);
    if (acct) {
      track(AnalyticsEventType.MARKET_AUCTION_BID, acct, bidderCharId, {
        itemDefId: rec.item.defId,
        bidAmount: amount,
        isHighBidder: true,
      });
    }
    console.log(`[market] bid ${listingId}: ${rec.item.defId} now ${amount} by ${bidderCharId}`);
  }

  // ─── MTS: Price History ────────────────────────────────────────────────────

  /** Return price history for a given item def. */
  private handlePriceHistory(client: Client, msg: PriceHistoryMsg): void {
    const defId =
      typeof msg?.defId === "string" && msg.defId.length > 0 && msg.defId.length <= 64
        ? msg.defId
        : null;
    if (!defId) return;

    const entries = priceHistoryStore.recent(defId, 50);
    client.send("price_history_result", {
      defId,
      entries: entries.map((e) => ({ salePrice: e.salePrice, soldAt: e.soldAt })),
    });
  }

  // ─── MTS: Auto-Match & Sweep ───────────────────────────────────────────────

  /** Auto-match existing buy orders against a new fixed-price listing. */
  private autoMatchBuyOrders(listing: ShopListing): void {
    const matches = this.book.findMatchingBuyOrders(listing);
    for (const order of matches) {
      // The buy order's maxPrice is what they're willing to pay; settle at listing price.
      const settlePrice = listing.pricePerUnit;
      const rec = marketStore.get(listing.id);
      if (!rec) continue; // listing may have been consumed by a prior iteration

      const buyerCharId = order.buyerCharId;
      // The buy order escrow covers the purchase — no spend from buyer's current balance.

      // Transfer item to buyer.
      accountStore.addItem(buyerCharId, rec.item);

      // Pay seller minus fee from escrow.
      const fee = Math.floor((settlePrice * this.state.feeBps) / 10_000);
      accountStore.addMesos(rec.sellerId, settlePrice - fee);
      if (fee > 0) treasuryStore.recordBurn(fee, "fm_tax");

      // Refund the remaining escrow to the buyer (escrowed − settlePrice).
      const escrowRefund = order.mesosEscrowed - settlePrice;
      if (escrowRefund > 0) accountStore.addMesos(buyerCharId, escrowRefund);

      // Record price history.
      priceHistoryStore.record(rec.item.defId, settlePrice);

      // Remove the buy order.
      buyOrderStore.remove(order.id);
      this.state.buyOrders.delete(order.id);
      this.book.removeBuyOrder(order.id);

      // Remove the listing.
      marketStore.remove(rec.listingId);
      this.state.listings.delete(rec.listingId);
      this.book.removeListing(rec.listingId);

      // Push wallets.
      this.pushWalletToChar(buyerCharId);
      this.pushWalletToChar(rec.sellerId);

      // Analytics.
      const buyerAcct = this.accountByChar.get(buyerCharId);
      if (buyerAcct) {
        track(AnalyticsEventType.MARKET_SALE, buyerAcct, buyerCharId, {
          itemDefId: rec.item.defId,
          price: settlePrice,
          isSeller: false,
        });
        track(AnalyticsEventType.MARKET_BUY_ORDER, buyerAcct, buyerCharId, {
          itemDefId: rec.item.defId,
          maxPrice: order.maxPrice,
          autoFilled: true,
        });
      }
      const sellerAcct = this.accountByChar.get(rec.sellerId);
      if (sellerAcct) {
        track(AnalyticsEventType.MARKET_SALE, sellerAcct, rec.sellerId, {
          itemDefId: rec.item.defId,
          price: settlePrice,
          isSeller: true,
        });
      }
      console.log(
        `[market] auto-fill buy order ${order.id} ← listing ${rec.listingId} (${rec.item.defId} @ ${settlePrice})`,
      );
      break; // fill the best bid first; the next sweep handles the rest
    }
  }

  /** Auto-match existing fixed-price listings against a new buy order. */
  private autoMatchListingsForBuyOrder(order: import("@maple/shared").BuyOrder): void {
    const matches = this.book.findMatchingListings(order);
    if (matches.length === 0) return;

    // Fill the cheapest listing.
    const listing = matches[0];
    const rec = marketStore.get(listing.id);
    if (!rec) return;

    const settlePrice = listing.pricePerUnit;
    // The buy order escrow covers the purchase — no spend from buyer's current balance.

    // Transfer item to buyer.
    accountStore.addItem(order.buyerCharId, rec.item);

    // Pay seller minus fee from escrow.
    const fee = Math.floor((settlePrice * this.state.feeBps) / 10_000);
    accountStore.addMesos(rec.sellerId, settlePrice - fee);
    if (fee > 0) treasuryStore.recordBurn(fee, "fm_tax");

    // Refund the remaining escrow to the buyer (escrowed − settlePrice).
    const escrowRefund = order.mesosEscrowed - settlePrice;
    if (escrowRefund > 0) accountStore.addMesos(order.buyerCharId, escrowRefund);

    // Record price history.
    priceHistoryStore.record(rec.item.defId, settlePrice);

    // Remove the buy order.
    buyOrderStore.remove(order.id);
    this.state.buyOrders.delete(order.id);
    this.book.removeBuyOrder(order.id);

    // Remove the listing.
    marketStore.remove(rec.listingId);
    this.state.listings.delete(rec.listingId);
    this.book.removeListing(rec.listingId);

    // Push wallets.
    this.pushWalletToChar(order.buyerCharId);
    this.pushWalletToChar(rec.sellerId);

    console.log(
      `[market] auto-fill listing ${rec.listingId} ← buy order ${order.id} (${rec.item.defId} @ ${settlePrice})`,
    );
  }

  /** Sweep expired listings and auctions. Runs on a timer. */
  private sweepExpired(): void {
    const now = Date.now();
    for (const listing of this.book.allListings()) {
      if (listing.endsAt > 0 && listing.endsAt <= now) {
        this.expireListing(listing);
      }
    }
  }

  /** Expire a listing: return item to seller (or settle auction). */
  private expireListing(listing: ShopListing): void {
    const rec = marketStore.get(listing.id);
    if (!rec) return;

    if (rec.listingType === "auction" && rec.currentBid > 0 && rec.highBidderCharId) {
      // Settle auction to the highest bidder.
      const fee = Math.floor((rec.currentBid * this.state.feeBps) / 10_000);
      accountStore.addItem(rec.highBidderCharId, rec.item);
      accountStore.addMesos(rec.sellerId, rec.currentBid - fee);
      if (fee > 0) treasuryStore.recordBurn(fee, "fm_tax");

      priceHistoryStore.record(rec.item.defId, rec.currentBid);
      this.pushWalletToChar(rec.highBidderCharId);
      this.pushWalletToChar(rec.sellerId);

      const highBidderAcct = this.accountByChar.get(rec.highBidderCharId);
      if (highBidderAcct) {
        track(AnalyticsEventType.MARKET_SALE, highBidderAcct, rec.highBidderCharId, {
          itemDefId: rec.item.defId,
          price: rec.currentBid,
          isSeller: false,
        });
      }
      const sellerAcct = this.accountByChar.get(rec.sellerId);
      if (sellerAcct) {
        track(AnalyticsEventType.MARKET_SALE, sellerAcct, rec.sellerId, {
          itemDefId: rec.item.defId,
          price: rec.currentBid,
          isSeller: true,
        });
        track(AnalyticsEventType.MARKET_AUCTION_END, sellerAcct, rec.sellerId, {
          itemDefId: rec.item.defId,
          finalPrice: rec.currentBid,
          sold: true,
        });
      }
      console.log(
        `[market] auction expired ${rec.listingId}: sold to ${rec.highBidderCharId} @ ${rec.currentBid}`,
      );
    } else {
      // No bids or fixed listing: return item to seller.
      accountStore.addItem(rec.sellerId, rec.item);
      this.pushWalletToChar(rec.sellerId);
      console.log(`[market] listing expired ${rec.listingId}: item returned to ${rec.sellerId}`);
    }

    marketStore.remove(rec.listingId);
    this.state.listings.delete(rec.listingId);
    this.book.removeListing(rec.listingId);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Check if the character carries a Store Permit. */
  private hasStorePermit(charId: string): boolean {
    const rec = accountStore.getCharacter(charId);
    if (!rec) return false;
    for (const item of Object.values(rec.inventory)) {
      if (item.defId === STORE_PERMIT_DEFID) return true;
    }
    return false;
  }

  /** Wallet sync (private, per-client). */
  private pushWallet(client: Client): void {
    const charId = this.charBySession.get(client.sessionId);
    if (!charId) return;
    const rec = accountStore.getCharacter(charId);
    if (!rec) return;
    client.send("wallet", {
      mesos: rec.mesos,
      items: Object.values(rec.inventory).map(decorateItem),
    });
  }

  private pushWalletToChar(charId: string): void {
    for (const [sessionId, cid] of this.charBySession) {
      if (cid === charId) {
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) this.pushWallet(client);
      }
    }
  }

  private reject(client: Client, reason: string): void {
    client.send("market_error", { reason });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function shortName(name: string): string {
  return name.length <= 12 ? name : `${name.slice(0, 10)}…`;
}

/** Attach display labels (item name, tier color) the client needs to render a listing/wallet item. */
function decorateItem(item: ItemRecord) {
  const def = getItemDef(item.defId);
  const tierInfo = getPotentialTierInfo(item.potentialTier as PotentialTier);
  return {
    ...item,
    name: def !== undefined ? def.name : item.defId,
    tierLabel: tierInfo?.label ?? "Normal",
    tierColor: tierInfo?.color ?? "#aaa",
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
  listing.listingType = rec.listingType ?? "fixed";
  listing.endsAt = rec.endsAt ?? 0;
  listing.currentBid = rec.currentBid ?? 0;
  listing.highBidderCharId = rec.highBidderCharId ?? "";
  return listing;
}

/** Convert a persistence ListingRecord to a shared ShopListing for the pure FreeMarket aggregate. */
function toShopListing(rec: ListingRecord): ShopListing {
  return {
    id: rec.listingId,
    sellerId: rec.sellerId,
    sellerName: rec.sellerName,
    defId: rec.item.defId,
    uid: rec.item.uid || undefined,
    qty: rec.item.count ?? 1,
    pricePerUnit: Math.floor(rec.price / (rec.item.count ?? 1)),
    baseRank: rec.item.baseRank,
    potentialTier: rec.item.potentialTier,
    lines: rec.item.lines,
    createdAt: rec.createdAt,
    listingType: (rec.listingType as "fixed" | "auction") ?? "fixed",
    endsAt: rec.endsAt ?? 0,
    currentBid: rec.currentBid ?? 0,
    highBidderCharId: rec.highBidderCharId ?? "",
  };
}

function buyOrderToSchema(rec: BuyOrderRecord): BuyOrderSchema {
  const schema = new BuyOrderSchema();
  schema.buyOrderId = rec.buyOrderId;
  schema.buyerCharId = rec.buyerCharId;
  schema.buyerName = rec.buyerName;
  schema.defId = rec.defId;
  schema.maxPrice = rec.maxPrice;
  schema.qty = rec.qty;
  schema.mesosEscrowed = rec.mesosEscrowed;
  schema.createdAt = rec.createdAt;
  return schema;
}

function buyOrderToShared(rec: BuyOrderRecord): import("@maple/shared").BuyOrder {
  return {
    id: rec.buyOrderId,
    buyerCharId: rec.buyerCharId,
    buyerName: rec.buyerName,
    defId: rec.defId,
    maxPrice: rec.maxPrice,
    qty: rec.qty,
    mesosEscrowed: rec.mesosEscrowed,
    createdAt: rec.createdAt,
  };
}
