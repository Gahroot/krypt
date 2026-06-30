# NPC Shops Implementation Plan

## Summary

Extend the existing shop infrastructure to add `npcId` validation, `stock` tracking, `sellPriceFor()` helper, more shops (general per town + class-weapon), and server-side NPC proximity / inventory capacity enforcement. A comprehensive tsx test covers buy, sell, and insufficient-funds rejection.

## Current State

- `packages/shared/src/shops.ts` — `ShopDef { id, name, slots: ShopSlot[] }` with `ShopSlot { itemId, buyPrice, sellPrice }`. Only 2 shops: `shop.meadow_basic`, `shop.harbor_basics`. Helpers: `getShopDef`, `getItemSellPrice`, `getShopItemName`.
- `packages/shared/src/net.ts` — `BUY_FROM_SHOP` (18) and `SELL_TO_SHOP` (19) message types already exist with payloads. `SellToShopPayload` lacks `shopId`.
- `packages/server/src/rooms/MapRoom.ts` — `handleBuyFromShop` / `handleSellToShop` exist but: no NPC proximity check, no stock enforcement, no inventory capacity check, no `shopId` on sell.
- `packages/shared/src/npcs.ts` — Only 2 shop NPCs: `npc.meadow_shop` (meadowfield), `npc.harbor_shop` (heartland_harbor).
- `packages/server/test/generalStore.ts` — Existing test covers buy/sell/reject but not NPC proximity/stock/capacity.

---

## Changes

### 1. `packages/shared/src/shops.ts` — Data Model + Catalog

**Interface changes:**
- Rename `ShopSlot` → `ShopEntry`: `{ defId: string; buyPrice: number; stock?: number }` (remove stored `sellPrice`, add `stock?`)
- Add `npcId` to `ShopDef`: `{ id; npcId; name; entries }`
- Keep `slots` as a deprecated alias pointing to `entries` for backward compat (or just rename — server is the only consumer and we update it)
- Export `SELL_FRACTION = 0.25` (25% of buy price)

**New helper:**
- `sellPriceFor(defId: string): number | undefined` — looks up the entry across all shops, returns `Math.floor(entry.buyPrice * SELL_FRACTION)`.

**Update existing helpers:**
- `getItemSellPrice(itemId)` → reimplement via `sellPriceFor`
- `getShopItemName(itemId)` → unchanged (already works)

**Catalog additions** (new shops, linked to new NPC ids):

| Shop ID | NPC ID | Map | Contents |
|---|---|---|---|
| `shop.dawn_basic` (NEW) | `npc.dawn_shop` (NEW) | dawn_isle | Starter potions + bronze sword + cap |
| `shop.meadow_basic` (UPDATE) | `npc.meadow_shop` | meadowfield | Potions + basic gear (existing, update structure) |
| `shop.harbor_basics` (UPDATE) | `npc.harbor_shop` | heartland_harbor | Potions + basic gear (existing, update structure) |
| `shop.craghold_general` (NEW) | `npc.craghold_shop` (NEW) | craghold | Potions |
| `shop.sylvanreach_general` (NEW) | `npc.sylvanreach_shop` (NEW) | sylvanreach | Potions |
| `shop.dusk_ward_general` (NEW) | `npc.dusk_shop` (NEW) | dusk_ward | Potions |
| `shop.mirefen_general` (NEW) | `npc.mirefen_shop` (NEW) | mirefen | Potions + scrolls |
| `shop.craghold_weapons` (NEW) | `npc.craghold_weapons` (NEW) | craghold | Swords + blunt weapons (warrior) |
| `shop.sylvanreach_weapons` (NEW) | `npc.sylvanreach_weapons` (NEW) | sylvanreach | Wands + staves (mage) |
| `shop.meadow_weapons` (NEW) | `npc.meadow_weapons` (NEW) | meadowfield | Bows + crossbows (archer) |
| `shop.dusk_weapons` (NEW) | `npc.dusk_weapons` (NEW) | dusk_ward | Daggers + claws (thief) |
| `shop.harbor_weapons` (NEW) | `npc.harbor_weapons` (NEW) | heartland_harbor | Guns + knuckles (pirate) |

**Stock values** — most entries unlimited (no `stock` field). A few high-tier items get limited stock (e.g., `stock: 3` for the strongest weapons).

### 2. `packages/shared/src/npcs.ts` — New Shop NPCs

Add 9 new NPC entries for the shops listed above. Each has `role: "shop"` and a dialog tree ending with `action: { kind: "openShop", payload: "<shop.id>" }`.

- `npc.dawn_shop` on `dawn_isle` — "Provisioner Mae"
- `npc.craghold_shop` on `craghold` — "Supply Keeper Borin"
- `npc.sylvanreach_shop` on `sylvanreach` — "Apothecary Thistle"
- `npc.dusk_shop` on `dusk_ward` — "Vendor Rizzo"
- `npc.mirefen_shop` on `mirefen` — "Swamp Trader Nix"
- `npc.craghold_weapons` on `craghold` — "Armorer Grund"
- `npc.sylvanreach_weapons` on `sylvanreach` — "Runeforge Sage"
- `npc.meadow_weapons` on `meadowfield` — "Fletcher Rowan"
- `npc.dusk_weapons` on `dusk_ward` — "Blade Broker Vex"
- `npc.harbor_weapons` on `heartland_harbor` — "Gunsmith Tide"

### 3. `packages/shared/src/net.ts` — Protocol Updates

- Add `shopId: string` to `SellToShopPayload` so the server can validate NPC proximity on sell too.
- Re-export in `packages/server/src/types.ts` (already re-exports everything via `*`).

### 4. `packages/server/src/rooms/MapRoom.ts` — Server Handlers

**`handleBuyFromShop`:**
1. Validate shop exists (already done)
2. **NEW:** Look up `shop.npcId` → `NPCS[npcId]` → verify `npc.mapId === this.state.mapId`
3. Validate item in shop (already done)
4. **NEW:** Check stock — if `entry.stock !== undefined`, ensure remaining > 0, decrement on buy
5. Validate mesos (already done)
6. **NEW:** Check inventory capacity — use `tabForItem(defId)` + check tab has space (for stackables: check max stack + empty slots; for equips: check empty slots). Use shared `addItem`/`removeItem` helpers or the `player.inventory` MapSchema. For now, do a capacity pre-check: count items in the relevant tab vs `TAB_CAPACITY`.
7. Deduct mesos atomically (already done)
8. Add item to inventory (already done, refine with capacity check)

**`handleSellToShop`:**
1. **NEW:** Accept `shopId` from payload
2. **NEW:** Validate shop exists, NPC is in player's map (same as buy)
3. Validate item in inventory (already done)
4. Cannot sell equipped (already done)
5. Look up sell price via `sellPriceFor(defId)` from the shared shop entry
6. Validate quantity (already done)
7. Remove item / decrement stack (already done)
8. Credit mesos atomically (already done)

**Import changes:**
- Add `sellPriceFor` and `TAB_CAPACITY`, `tabForItem` (or `MAX_STACK`) from `@maple/shared` imports
- Already imports `NPCS`, `getShopDef`, `getItemSellPrice` — replace `getItemSellPrice` usage with `sellPriceFor`

### 5. `packages/server/test/shop.test.ts` — New Focused Test

A focused tsx test (runnable via `npx tsx test/shop.test.ts`) covering:

1. **Buy success:** Send `BUY_FROM_SHOP` with valid shop + item → mesos decrease, item appears in inventory
2. **Sell success:** Send `SELL_TO_SHOP` with `shopId` + inventory uid → mesos increase, item removed/reduced
3. **Insufficient funds:** Buy when mesos < cost → rejected with `success: false`
4. **NPC proximity:** Buy from a shop whose NPC is NOT on the current map → rejected
5. **Stock enforcement:** Buy the last unit of a stocked item → succeeds; buy again → rejected

Uses the same `@colyseus/testing` boot pattern as existing tests.

---

## Files Modified

| File | Change |
|---|---|
| `packages/shared/src/shops.ts` | Interface update + sellPriceFor + catalog expansion |
| `packages/shared/src/npcs.ts` | 10 new shop NPCs |
| `packages/shared/src/net.ts` | Add `shopId` to `SellToShopPayload` |
| `packages/server/src/rooms/MapRoom.ts` | NPC proximity, stock, capacity enforcement |
| `packages/server/src/types.ts` | Auto-updated via re-export (no manual change needed) |
| `packages/server/test/shop.test.ts` | New test file |

---

## Verification

1. `pnpm --filter @maple/shared typecheck` — shared compiles
2. `pnpm --filter @maple/shared test` — existing vitest pass (no shared tests break)
3. `npx tsx test/shop.test.ts` — new shop test passes
4. `npx tsx test/generalStore.ts` — existing generalStore test still passes (backward compat)
5. `pnpm typecheck` — full monorepo type check passes
6. `pnpm lint` — no new lint errors

---

## Steps

1. Update `packages/shared/src/shops.ts` — new interfaces (ShopEntry, ShopDef with npcId, stock), sellPriceFor helper, SELL_FRACTION constant, expand SHOPS catalog to ~12 shops
2. Update `packages/shared/src/npcs.ts` — add 10 new shop NPCs with openShop dialog actions
3. Update `packages/shared/src/net.ts` — add `shopId: string` to `SellToShopPayload`
4. Update `packages/server/src/rooms/MapRoom.ts` — import sellPriceFor/TAB_CAPACITY/tabForItem, add NPC proximity validation in both handlers, add stock enforcement in buy handler, add inventory capacity check in buy handler
5. Create `packages/server/test/shop.test.ts` — buy success, sell success, insufficient-funds rejection, NPC proximity rejection, stock enforcement
6. Run typecheck and lint to verify everything compiles
7. Run tests to verify they pass
