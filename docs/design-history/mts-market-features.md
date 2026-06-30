# MTS-Style Free Market Features

## Overview

Extend the existing fixed-price-only Free Market with four MTS (MapleStory Trading System) features:
1. **Buy orders (want-to-buy)** — players bid on item types; matching sells auto-fill
2. **Timed auctions** — items listed with duration + bidding; mesos escrowed; expiry settlement
3. **Listing expiry** — optional TTL on fixed-price listings
4. **Price history** — per-item-def sale record surfaced in the UI

All features reuse the existing 2.5% fee/treasury sink. No breaking changes to existing flows.

---

## Architecture Decisions

- **Buy orders** are stored in-memory + SQLite (same as listings). Mesos are escrowed on placement. Auto-match runs on both `handleList` (new sell meets existing buy order) and `handlePlaceBuyOrder` (new buy order meets existing sell).
- **Auctions** extend the existing `Listing` schema with a new `listingType` field ("fixed"|"auction") plus `endsAt`, `currentBid`, `highBidderCharId`. A `setInterval` in `onCreate` sweeps expired auctions every 10s.
- **Listing expiry** adds an optional `expiresAt` field. Same sweep timer cleans expired fixed-price listings and returns items to sellers.
- **Price history** is a new SQLite table `price_history` recording each completed sale. Queried via a new message `price_history` sent on-demand. Cached in-memory for the current session.

---

## Files to Modify

### Shared (`packages/shared/src/`)

| File | Changes |
|------|---------|
| `market.ts` | Add `BuyOrder`, `AuctionListing` interfaces; add `expiresAt?` to `ShopListing`; add `PriceHistoryEntry`; add `FreeMarket.buyOrders` map + `addBuyOrder/removeBuyOrder/matchBuyOrders`; add `isExpired()` helper |
| `net.ts` | Add message codes: `MARKET_PLACE_BUY_ORDER(136)`, `MARKET_CANCEL_BUY_ORDER(137)`, `MARKET_BROWSE_BUY_ORDERS(138)`, `MARKET_BID(139)`, `MARKET_BUY_ORDER_RESULT(140)`, `MARKET_AUCTION_RESULT(141)`, `MARKET_PRICE_HISTORY(142)`. Add payload interfaces for each. Extend `MarketListPayload` with `duration?`. Extend `MarketBrowseResultPayload` listings with `listingType`, `endsAt?`, `currentBid?`. |

### Server (`packages/server/src/`)

| File | Changes |
|------|---------|
| `rooms/schema/Listing.ts` | Add `listingType: "string"` (default "fixed"), `endsAt: "number"` (0 = no expiry), `currentBid: "uint32"` (0 for fixed), `highBidderCharId: "string"` |
| `rooms/schema/MarketState.ts` | Add `buyOrders: MapSchema<BuyOrder>` synced schema |
| `rooms/schema/BuyOrder.ts` | **NEW** — Colyseus schema for buy orders |
| `rooms/MarketRoom.ts` | Add `handlePlaceBuyOrder`, `handleCancelBuyOrder`, `handleBrowseBuyOrders`, `handleBid`. Extend `handleList` with expiry + auto-match against buy orders. Add sweep timer for expired listings/auctions. Add `handlePriceHistory`. Extend `handleBuy` for auction support. |
| `persistence/store.ts` | Extend `ListingRecord` with `listingType`, `endsAt`, `currentBid`, `highBidderCharId`. Add `BuyOrderRecord` interface + `BuyOrderStore` class. Add `PriceHistoryStore` class + `price_history` table. Extend `MarketStore.add()` to accept new fields. |
| `persistence/migrations/015_market_mts.sql` | **NEW** — `ALTER TABLE listings ADD COLUMN`, `CREATE TABLE buy_orders`, `CREATE TABLE price_history` |
| `validate.ts` | Add `sanitizeDuration()`, `sanitizeBidAmount()` helpers |
| `analyticsEvents.ts` | Add `MARKET_BUY_ORDER: "market_buy_order"`, `MARKET_AUCTION_BID: "market_auction_bid"`, `MARKET_AUCTION_END: "market_auction_end"` |

### Client (`packages/client/src/`)

| File | Changes |
|------|---------|
| `scenes/Market.ts` | Add tab bar (Listings / Buy Orders / Price History). Add buy-order listing rows with "Want to Buy" button. Add auction rows with countdown timer + bid button. Add price history panel. Add bid-entry modal. Add buy-order placement modal. Show expiry countdown on expiring listings. |
| `state-views.ts` | Extend `ListingView` with `listingType`, `endsAt`, `currentBid`, `highBidderCharId`. Add `BuyOrderView`, `PriceHistoryEntryView`. Extend `MarketStateView` with `buyOrders`. |

### Tests

| File | Changes |
|------|---------|
| `packages/server/test/market.ts` | Add test cases: buy order placement + auto-match, auction bid + expiry settlement, listing expiry return, price history recording |

---

## Data Flow

### Buy Order Flow
```
Client: send("place_buy_order", { defId, maxPrice, filter })
Server: validate → escrow mesos from buyer → insert buy_orders table
         → sync to Colyseus state → auto-match against existing sell listings
         → if match found: settle (same as handleBuy)
         → if no match: order stays active
```

### Auction Flow
```
Client: send("list", { itemUid, pricePerUnit, duration: 300000 })  // 5 min
Server: validate → escrow item → create listing with listingType="auction", endsAt=now+duration
         → sync to state

Client: send("bid", { listingId, amount })
Server: validate amount > currentBid → escrow bid mesos → release previous bidder's mesos
         → update currentBid + highBidderCharId in state

Sweep timer (every 10s): for each auction where endsAt <= now
         → settle: item → highBidder, proceeds → seller, fee → treasury
         → if no bids: return item to seller
         → record price_history entry
```

### Listing Expiry Flow
```
Sweep timer: for each fixed listing where expiresAt > 0 and expiresAt <= now
         → return item to seller → remove from book + state
         → notify seller via pushWallet if online
```

### Price History Flow
```
Client: send("price_history", { defId })
Server: query price_history table WHERE def_id = ? ORDER BY sold_at DESC LIMIT 50
         → send("price_history_result", { entries: [...] })
```

---

## Verification Criteria

1. `pnpm --filter @maple/server test` passes — existing market test + new test cases
2. `pnpm typecheck` passes across all packages
3. All existing market flows (list/buy/cancel/browse) continue to work unchanged
4. New flows are exercised in tests: buy order → auto-match, auction → bid → expiry → settle, listing expiry → return, price_history → query

---

## Steps

1. Create migration `015_market_mts.sql` with `ALTER TABLE listings` columns + `buy_orders` table + `price_history` table
2. Extend `ListingRecord` in `packages/server/src/persistence/store.ts` with new fields; add `BuyOrderRecord`, `BuyOrderStore`, `PriceHistoryStore` classes
3. Extend `ShopListing` in `packages/shared/src/market.ts` with `expiresAt?`, `listingType?`; add `BuyOrder` and `PriceHistoryEntry` interfaces; extend `FreeMarket` class with buy order book + auto-match logic
4. Add new message codes + payload interfaces to `packages/shared/src/net.ts` (136–142)
5. Extend Colyseus schemas: `Listing.ts` (new fields), `BuyOrder.ts` (new), `MarketState.ts` (buyOrders map)
6. Extend `packages/client/src/state-views.ts` with new view types
7. Extend `MarketRoom.ts`: add handlers for `place_buy_order`, `cancel_buy_order`, `browse_buy_orders`, `bid`, `price_history`; extend `handleList` with expiry + auto-match; add sweep timer for expired listings/auctions; extend `handleBuy` for auction settlement
8. Add validation helpers to `validate.ts`: `sanitizeDuration`, `sanitizeBidAmount`
9. Add new analytics event types to `analyticsEvents.ts`
10. Extend `packages/client/src/scenes/Market.ts`: add tab bar, buy order rows, auction rows with countdown, bid modal, buy order placement modal, price history panel
11. Extend `packages/server/test/market.ts` with new test cases for all four features
12. Run `pnpm --filter @maple/server test` and `pnpm typecheck`; fix any failures
