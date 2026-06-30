# Economy UIs — Implementation Plan

## Goal

Add four economy panels to `packages/client`: (1) NPC Shop buy/sell (already exists as GeneralStoreScene), (2) Player-to-player Trade window, (3) Free Market enhanced browse/buy, (4) Storage/bank deposit-withdraw. All reuse existing HUD styling, inventory slot patterns, and item tooltip components.

## Current State

- **NPC Shop**: `GeneralStoreScene` is **complete** — Buy/Sell tabs, mesos balance, qty selector, server-bound buy/sell messages. ✅ No work needed.
- **Free Market**: `MarketScene` is **functional** — wallet column, listings, buy/cancel, price-entry modal. Needs: search bar, rarity-tier filter dropdown, rarity-colored listing borders, buy confirmation modal.
- **Trade**: No client scene exists. Server message types (`TRADE_INVITE`..`TRADE_RESULT`) and payload types (`TradeUpdatePayload`, `TradeResultPayload`) are defined in `packages/shared/src/net.ts`.
- **Storage**: No client scene exists. Server message types (`STORAGE_DEPOSIT`, `STORAGE_WITHDRAW`, `STORAGE_SYNC`) and payloads (`StorageSyncPayload`, `StorageResultPayload`) are defined in `packages/shared/src/net.ts`.

## Server Status

- **NPC Shop** (`BUY_FROM_SHOP` / `SELL_TO_SHOP`): ✅ Server handlers exist in TownRoom
- **Market** (`MARKET_*`): ✅ MarketRoom is fully implemented
- **Trade** (`TRADE_*`): ⚠️ Message types + payload types defined in `shared/net.ts`, but **no server handlers yet**. Client UI will send correct messages but won't get responses until server is built.
- **Storage** (`STORAGE_*`): ⚠️ Message types + payload types defined in `shared/net.ts`, but **no server handlers yet**. Client UI will send correct messages but won't get responses until server is built.

The client scenes are **server-agnostic** — they listen for message types that already exist in `@maple/shared` and will work as soon as the server implements handlers.

## Architecture

All panels follow the established pattern (GeneralStoreScene, CashShopScene):
- Standalone `Phaser.Scene` subclasses with scrim + panel overlay
- Bucket arrays (`staticObjs`, `dynamicObjs`, etc.) for cheap rebuild on resize
- Shared visual tokens (FONT, PALETTE, TEXT) copied from existing scenes
- Keyboard close via ESC/M with armed flag
- Connect to town room via registry polling (`this.registry.get("room")`)
- Server-authoritative: send intents, re-render from responses
- Toast notifications for success/error feedback

## Files to Create

### 1. `packages/client/src/scenes/Trade.ts` — Player-to-Player Trade Window

Two-column panel (left = "You", right = "Partner") with the two-phase lock/confirm flow:

**UI Layout:**
```
┌──────────────────────────────────────────────┐
│  Trade with: <PartnerName>              [✕]  │
├────────────────────┬─────────────────────────┤
│    Your Offer      │     Partner's Offer     │
│  ┌──────────────┐  │  ┌───────────────────┐  │
│  │ item slots   │  │  │ item slots        │  │
│  │ (click to    │  │  │ (read-only,       │  │
│  │  toggle)     │  │  │  colored by       │  │
│  └──────────────┘  │  │  rarity)           │  │
│  Mesos: [____]     │  │  Mesos: 1,234     │  │
├────────────────────┴─────────────────────────┤
│  [Lock]  [Confirm]  [Cancel]                 │
│  Status: waiting / locked / confirmed        │
└──────────────────────────────────────────────┘
```

**State machine (mirrors server):**
1. `offering` — both players can add/remove items + type mesos amounts
2. `locked` — one or both have locked; offer columns show padlock icon + dimmed; no more edits
3. `confirmed` — both locked and confirmed; "Trade complete!" toast; auto-close after 1.5s

**Key behaviors:**
- Click items in own inventory to toggle offer in/out (sends `TRADE_OFFER`)
- Mesos input via number key capture (same pattern as MarketScene price-entry)
- Lock button: `TRADE_LOCK` → partner sees your column locked
- Confirm button: `TRADE_CONFIRM` → both confirmed = trade executes
- Cancel: `TRADE_CANCEL` → closes window
- `TRADE_UPDATE` message: full state sync → re-render both columns
- `TRADE_RESULT` message: success/fail toast + auto-close
- Items shown with rarity-colored swatches (same tierColor pattern as inventory panel)

**Key bindings:** ESC to cancel, number keys for mesos entry, Enter to confirm mesos value.

### 2. `packages/client/src/scenes/Storage.ts` — Storage/Bank Deposit-Withdraw Window

Two-column panel (left = "Your Inventory", right = "Storage Vault"):

**UI Layout:**
```
┌──────────────────────────────────────────────┐
│  Storage Vault                    [✕]        │
│  Capacity: 12 / 24 slots                    │
├────────────────────┬─────────────────────────┤
│    Your Items      │     Stashed Items       │
│  ┌──────────────┐  │  ┌───────────────────┐  │
│  │ items with   │  │  │ items with        │  │
│  │ rarity color │  │  │ rarity color      │  │
│  │ + [Deposit]  │  │  │ + [Withdraw]      │  │
│  └──────────────┘  │  └───────────────────┘  │
│                    │                         │
│  Empty state       │  Empty state            │
└────────────────────┴─────────────────────────┘
```

**Server messages:**
- Open: send `TALK_NPC` with storage NPC id → server responds with `STORAGE_SYNC`
- Deposit: `STORAGE_DEPOSIT { uid, qty? }` → server re-syncs via `STORAGE_SYNC`
- Withdraw: `STORAGE_WITHDRAW { uid, qty? }` → server re-syncs via `STORAGE_SYNC`
- Result messages: `StorageResultPayload` → toast feedback

**Key behaviors:**
- Left column: player's bagged (unequipped) inventory items, each with a "Deposit" button
- Right column: stashed items from `StorageSyncPayload`, each with a "Withdraw" button
- Capacity counter in header
- Rarity-colored swatches on all items (same pattern as inventory/market)
- Items dimmed/disabled when stash is full (deposit) or inventory is full (withdraw)

### 3. Enhance `packages/client/src/scenes/Market.ts` — Search & Rarity Filters

Add to the existing MarketScene:
- **Search bar** at the top of the listings column (text input, same pattern as chat)
- **Filter row**: tier filter buttons (All / Rare / Epic / Unique / Legendary) + sort toggle
- **Rarity-colored listing borders**: each listing row gets a 2px left border in the item's tier color
- **Buy confirmation**: before executing `MARKET_BUY`, show a confirmation card with item name, price, and calculated fee

### 4. Update `packages/client/src/main.ts` — Register New Scenes

Add `TradeScene` and `StorageScene` to the scene array.

## Files to Modify

| File | Change |
|------|--------|
| `packages/client/src/main.ts` | Add TradeScene + StorageScene to scene array |
| `packages/client/src/scenes/Market.ts` | Add search bar, tier filter buttons, rarity border on listings, buy confirmation modal |

## Reused Components / Patterns

- **Item slot rendering**: Same pattern as `addBaggedRow` / `addEquippedRow` in UIScene — tier swatch + name (BaseRank color) + meta text
- **Item tooltip**: Same tooltip approach as UIScene's `showItemTooltip` — built dynamically from `getItemDef()`, `getPotentialTierInfo()`, `getBaseRankInfo()`
- **Visual tokens**: Identical FONT, PALETTE, TEXT constants (copied per scene, matching existing convention)
- **Mesos display**: Same coin texture + text pattern
- **Toast notifications**: Same pattern as MarketScene/GeneralStoreScene
- **Key-arm pattern**: Same `armed` flag + `KEY_ARM_MS` to prevent immediate close

## Risks

1. **Trade window inventory sync**: The trade scene reads the player's inventory from `room.state.players.get(room.sessionId).inventory` — same as UIScene. Must handle the case where inventory changes while trade is open.
2. **Market search**: For the enhanced Market we use `MARKET_BROWSE` with filter params and render the paginated `MARKET_BROWSE_RESULT`.
3. **Storage NPC interaction**: Storage will open via a `storage_open` message from the server (matching the `shop_open` pattern), triggered by the Storage Keep NPC dialog. We also add a 'B' keyboard shortcut for testing.

## Verification

1. `pnpm --filter @maple/client build` — typecheck + Vite build must pass
2. Visual: all four panels open/close without console errors
3. Trade: two-trade flow (lock → confirm) renders correct states
4. Market: search filters listings, rarity colors visible
5. Storage: deposit/withdraw updates both columns

## Steps

1. Create `packages/client/src/scenes/Trade.ts` — full TradeScene with two-column layout, mesos input, lock/confirm/cancel buttons, state machine driven by `TRADE_UPDATE`/`TRADE_RESULT` messages
2. Create `packages/client/src/scenes/Storage.ts` — full StorageScene with two-column layout, deposit/withdraw buttons, capacity display, driven by `STORAGE_SYNC`/`STORAGE_RESULT` messages
3. Enhance `packages/client/src/scenes/Market.ts` — add search text input, tier filter row (All/Rare/Epic/Unique/Legendary buttons), rarity-colored left border on listing rows, buy confirmation modal showing item + price + fee
4. Update `packages/client/src/main.ts` — import and register TradeScene + StorageScene
5. Run `pnpm --filter @maple/client build` to verify typecheck + build passes
