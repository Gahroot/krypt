# Server Hardening for Public Alpha

## Goal
Harden the authoritative server (MapRoom, MarketRoom, PartyQuestRoom) by validating/clamping all inbound messages, adding per-client rate limiting on high-frequency messages, enabling Colyseus reconnection, and proving it all with a test that sends adversarial inputs.

## Context
- **No TownRoom exists** — MapRoom handles all map types. Three rooms to harden: MapRoom, MarketRoom, PartyQuestRoom.
- Many handlers already validate well (chat has rate limiting + profanity filter, pickup range checked, trade re-validates at commit, skill cast checks cooldown/MP/learned). The gaps are: input garbage, rate-limiting on high-frequency channels, reconnection, and missing null/type guards on some messages.
- TypeScript strict mode, ESM, `strictNullChecks: false` in tsconfig.
- Colyseus 0.17 has `onDrop` (disconnect → grace window), `onReconnect` (came back), `onLeave` (final departure after grace). We use this lifecycle for reconnection.

## New file: `packages/server/src/validate.ts`

Shared validation utilities:

```ts
// Token-bucket rate limiter keyed by sessionId
export class RateLimiter {
  // consume(sessionId) → returns true if allowed, false if throttled
}

// Clamp input message fields
export function sanitizeInputData(msg: unknown): InputData | null
// Returns null if shape is wrong. Clamps tick to [0, 2^31), ensures all booleans.

export function sanitizeString(val: unknown, maxLen: number): string
// Strips null bytes, trims, caps length. Returns "" if not a string.

export function sanitizePrice(val: unknown, max?: number): number | null
// Returns null if not finite/positive. Clamps to max.

export function sanitizeQty(val: unknown, max?: number): number | null

export function sanitizeListingId(val: unknown): string | null
// Non-empty string ≤64 chars.

export function logAnomaly(sessionId: string, type: string, detail: string): void
// Logs via existing logger.ts with structured meta.
```

## Changes to `MapRoom.ts`

### Reconnection (Colyseus 0.17 lifecycle)
- Add `onDrop(client)` that calls `this.allowReconnection(client, 30)` — keeps player in state during grace window. No cleanup runs.
- Add `onReconnect(client)` that re-registers guild/channel/friend tracking, re-sends initial syncs (quest, guidance, codex, settings).
- `onLeave(client)` stays as-is — fires only after grace expires (client didn't reconnect), so existing cleanup is correct.

### Per-client rate limiters (new private fields)
```ts
private inputLimiter = new RateLimiter(120, 1_000);    // 120/sec high-freq input
private skillCastLimiter = new RateLimiter(10, 1_000);  // 10/sec skill/consumable
private pickupLimiter = new RateLimiter(20, 1_000);     // 20/sec pickup
private macroCastLimiter = new RateLimiter(5, 1_000);   // 5/sec macro
```

### Message handler hardening

**INPUT** (line 431): Sanitize via `sanitizeInputData`, add `inputLimiter`, log anomalies.

**CHAT** (line 445): Already solid. Add `sanitizeString` null-byte strip before `trim().slice()`.

**PICKUP** (line 441): Add null-byte + type check on `msg.uid`. Add `pickupLimiter`.

**PICKUP_ALL** (line 606): Already rate-limited (300ms). Add anomaly log on throttle.

**SKILL_CAST** (line 592): Add `skillCastLimiter`, sanitize string `skillId`.

**USE_CONSUMABLE** (line 595): Add `skillCastLimiter` (shared bucket), sanitize string `defId`.

**MACRO_CAST** (line 609): Add `macroCastLimiter`. Validate `msg.macroId` is string.

**All other handlers**: Add top-of-function `if (!msg) return;` null guards where missing. Handlers: handleGuildCreate, handlePartyInvite, handleTradeInvite, handleTalkNpc, handleDialogChoice, handleBuyFromShop, handleSellToShop, handleSpendAp, handleLearnSkill, handleBranchChoice, handleFriendAdd/Remove, handleWhisper, handleChannelSwitch, handleFeedbackSubmit, handlePlayerReport, handleBlockPlayer, handleUnblockPlayer, handleGuideTravel.

### Economy idempotency
- handlePickup: Already atomic. Add early-exit if loot was already picked up.
- executeTrade: Already excellent — re-validates everything at commit, snapshots inventory. No changes.
- handleBuyFromShop/handleSellToShop: Already validate balance + capacity before deducting. No changes.

## Changes to `MarketRoom.ts`

### Reconnection
- Add `onDrop(client)` calling `this.allowReconnection(client, 30)`.
- Add `onReconnect(client)` to re-push wallet.
- `onLeave` stays as-is.

### Rate limiter
```ts
private actionLimiter = new RateLimiter(10, 1_000); // list/buy/cancel: 10/sec
```

### Message handler hardening

**list**: Add `actionLimiter`, sanitize `itemUid` (non-empty string ≤64), sanitize price via `sanitizePrice`, sanitize qty via `sanitizeQty`. Enforce `MAX_LIST_PRICE = 1_000_000_000`.

**buy**: Add `actionLimiter`, sanitize `listingId` via `sanitizeListingId`.

**cancel**: Add `actionLimiter`, sanitize `listingId`.

**browse**: Clamp `offset`/`limit`, sanitize `query` (strip null bytes, max 64 chars), sanitize `slot`/`sortBy`/`sortOrder` to known string values.

## Changes to `PartyQuestRoom.ts`

### Reconnection
- Add `onDrop(client)` calling `this.allowReconnection(client, 30)`.
- `onLeave` stays as-is.

### Rate limiter
```ts
private contributeLimiter = new RateLimiter(20, 1_000); // 20/sec
```

### handleContribute (line 333)
- Add `contributeLimiter`.
- Validate `msg.amount` is a finite positive number. Clamp to `progress.target - progress.current` (can't overshoot).

## New test: `packages/server/test/hardenedInputs.ts`

Test cases using `@colyseus/testing`:
1. **Malformed input**: Send `null`, `{}`, `{left: "yes"}`, `{tick: NaN}`, `{tick: Infinity}` as INPUT → player position unchanged.
2. **Oversized chat**: Send chat with 10,000-char string → message truncated to 120.
3. **Spam input**: Send 200 INPUT messages in rapid succession → rate limiter drops excess.
4. **Spam skill cast**: Send 50 SKILL_CAST messages rapidly → only 10 allowed per second.
5. **Malformed pickup**: Send PICKUP with `uid: 12345` (number, not string) → ignored.
6. **PQ contribute overflow**: Send contribute with `amount: Infinity` → clamped/rejected.
7. **State integrity check**: After all adversarial inputs, verify player HP/MP/mesos/inventory unchanged (no corruption).

Register in `packages/server/package.json` test script.

## Steps
1. Create `packages/server/src/validate.ts` with RateLimiter, sanitizeInputData, sanitizeString, sanitizePrice, sanitizeQty, sanitizeListingId, logAnomaly.
2. Integrate validation into MapRoom: INPUT, CHAT, PICKUP, PICKUP_ALL, SKILL_CAST, USE_CONSUMABLE, MACRO_CAST, and add null guards to all other handlers.
3. Add reconnection support to MapRoom (onDrop → allowReconnection, onReconnect → re-register).
4. Integrate validation into MarketRoom: list/buy/cancel/browse + onDrop/onReconnect reconnection.
5. Integrate validation into PartyQuestRoom: contribute + onDrop reconnection.
6. Create `packages/server/test/hardenedInputs.ts` test.
7. Register test in `packages/server/package.json` test script.
8. Run `pnpm --filter @maple/server typecheck` and `pnpm --filter @maple/server test` — fix any issues.
