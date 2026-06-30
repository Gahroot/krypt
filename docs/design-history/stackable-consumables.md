# Stackable Consumables (HP/MP Potions)

## Overview
Add consumable items (potions) that restore HP/MP, stack in inventory, and can be used via the UI or quick-slot hotbar.

## Architecture Decisions
- **Separate catalog** (`CONSUMABLES`) rather than extending `ItemDef` — consumables don't have equip slots, primary stats, or base attack. A parallel `ConsumableDef` interface is cleaner.
- **Stacking via count on `InventoryItem`** schema — one uid per stack, `count` field tracks quantity. On pickup of a consumable that already exists in inventory, increment count instead of creating a new entry.
- **Both TownRoom and MapRoom** get the USE_ITEM handler since both are active game rooms.
- **Quick-slot hotbar** wires keys 1-8 to the first consumable items in inventory. Clicking "Use" in the inventory panel also works.

---

## Step 1 — Shared: ConsumableDef + CONSUMABLES catalog

**File:** `packages/shared/src/items.ts`

Add after the `ITEMS` catalog (~line 155):

```ts
export interface ConsumableDef {
  readonly id: string;
  readonly name: string;
  readonly restoreHp?: number;
  readonly restoreMp?: number;
  /** Mesos buy price (for NPC shops). */
  readonly mesos: number;
}

export const CONSUMABLES: Record<string, ConsumableDef> = {
  "con.hp_potion_s": {
    id: "con.hp_potion_s",
    name: "Small HP Potion",
    restoreHp: 50,
    mesos: 20,
  },
  "con.hp_potion_m": {
    id: "con.hp_potion_m",
    name: "Medium HP Potion",
    restoreHp: 150,
    mesos: 60,
  },
  "con.mp_potion_s": {
    id: "con.mp_potion_s",
    name: "Small MP Potion",
    restoreMp: 30,
    mesos: 25,
  },
  "con.mp_potion_m": {
    id: "con.mp_potion_m",
    name: "Medium MP Potion",
    restoreMp: 100,
    mesos: 75,
  },
};

export function getConsumableDef(defId: string): ConsumableDef | undefined {
  return CONSUMABLES[defId];
}
```

## Step 2 — Shared: MessageType.USE_ITEM + payload types

**File:** `packages/shared/src/net.ts`

Add `USE_ITEM: 18` to the `MessageType` const (after `UNEQUIP_ITEM: 17`).

Add payload interfaces:

```ts
/** Client → server: use a consumable item from inventory. */
export interface UseItemPayload {
  uid: string;
}

/** Server → client: result of a use-item attempt. */
export interface UseItemResultPayload {
  success: boolean;
  message: string;
  /** New HP value (only on success, for immediate UI update). */
  hp?: number;
  /** New MP value. */
  mp?: number;
  /** Remaining count of the item (0 = consumed). */
  count?: number;
}
```

## Step 3 — Shared: Vitest test for CONSUMABLES catalog

**File:** `packages/shared/tests/consumables.test.ts` (new)

```ts
import { describe, it, expect } from "vitest";
import { CONSUMABLES, getConsumableDef } from "../src/items.js";

describe("consumable catalog", () => {
  it("has at least 3 potions", () => {
    expect(Object.keys(CONSUMABLES).length).toBeGreaterThanOrEqual(3);
  });

  for (const [id, def] of Object.entries(CONSUMABLES)) {
    it(`${id} has a name and positive mesos price`, () => {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.mesos).toBeGreaterThan(0);
    });

    it(`${id} restores at least one of HP or MP`, () => {
      expect((def.restoreHp ?? 0) + (def.restoreMp ?? 0)).toBeGreaterThan(0);
    });
  }

  it("getConsumableDef returns the correct def", () => {
    const def = getConsumableDef("con.hp_potion_s");
    expect(def).toBeDefined();
    expect(def!.restoreHp).toBe(50);
  });

  it("getConsumableDef returns undefined for unknown id", () => {
    expect(getConsumableDef("nonexistent")).toBeUndefined();
  });
});
```

## Step 4 — Server: InventoryItem schema — add `count`

**File:** `packages/server/src/rooms/schema/InventoryItem.ts`

Add:
```ts
@type("uint16") count = 1;
```

## Step 5 — Server: ItemRecord persistence — add optional `count`

**File:** `packages/server/src/persistence/store.ts`

Add `count?: number` to `ItemRecord` interface. All existing code reads/writes `ItemRecord` but doesn't use `count`, so this is backward-compatible (defaults to 1 at runtime).

## Step 6 — Server: Server types re-export

**File:** `packages/server/src/types.ts`

Add to the re-exports:
```ts
type UseItemPayload,
type UseItemResultPayload,
```

## Step 7 — Server: USE_ITEM handler in TownRoom

**File:** `packages/server/src/rooms/TownRoom.ts`

Import `getConsumableDef` from `@maple/shared`. Import `UseItemPayload` from types.

Add message handler:
```ts
[MessageType.USE_ITEM]: (client: Client, msg: UseItemPayload) => {
  this.handleUseItem(client, msg);
},
```

Add handler method:
```ts
private handleUseItem(client: Client, msg: UseItemPayload): void {
  const player = this.state.players.get(client.sessionId);
  if (!player) return;
  const uid = msg?.uid;
  if (!uid) return;

  const invItem = player.inventory.get(uid);
  if (!invItem) {
    client.send("use_item_result", { success: false, message: "Item not in inventory." });
    return;
  }

  const conDef = getConsumableDef(invItem.defId);
  if (!conDef) {
    client.send("use_item_result", { success: false, message: "Item is not consumable." });
    return;
  }

  // Check if this potion would have any effect at all.
  const hpFull = !conDef.restoreHp || player.hp >= player.maxHp;
  const mpFull = !conDef.restoreMp || player.mp >= player.maxMp;
  if (hpFull && mpFull) {
    client.send("use_item_result", { success: false, message: "Already at full HP/MP." });
    return;
  }

  // Apply restores, clamped to max.
  if (conDef.restoreHp) {
    player.hp = Math.min(player.hp + conDef.restoreHp, player.maxHp);
  }
  if (conDef.restoreMp) {
    player.mp = Math.min(player.mp + conDef.restoreMp, player.maxMp);
  }

  // Decrement stack.
  invItem.count = Math.max(0, (invItem.count || 1) - 1);
  if (invItem.count <= 0) {
    player.inventory.delete(uid);
    accountStore.removeItem(player.charId, uid);
  } else {
    // Update persisted count.
    const rec = accountStore.getItem(player.charId, uid);
    if (rec) {
      rec.count = invItem.count;
      accountStore.updateCharacter(player.charId, { inventory: { ...accountStore.getCharacter(player.charId)!.inventory } });
    }
  }

  client.send("use_item_result", {
    success: true,
    message: `Used ${conDef.name}.`,
    hp: player.hp,
    mp: player.mp,
    count: invItem.count > 0 ? invItem.count : undefined,
  });
}
```

## Step 8 — Server: USE_ITEM handler in MapRoom

Same as Step 7 but in `packages/server/src/rooms/MapRoom.ts`. Identical handler logic — both rooms share the same imports and patterns.

## Step 9 — Server: Stacking on pickup

**Files:** `TownRoom.ts` and `MapRoom.ts` — `handlePickup` method

Before creating a new `InventoryItem` on pickup, check if the dropped item is a consumable and the player already has one with the same `defId`. If so, increment `count` on the existing stack instead of creating a new entry.

```ts
// In handlePickup, after determining the drop exists and player is in range:
const conDef = getConsumableDef(drop.defId);
if (conDef) {
  // Find existing stack in inventory.
  let existingUid: string | undefined;
  player.inventory.forEach((item, uid) => {
    if (item.defId === drop.defId) existingUid = uid;
  });
  if (existingUid) {
    const existing = player.inventory.get(existingUid)!;
    existing.count = (existing.count || 1) + 1;
    // Persist the updated count.
    const rec = accountStore.getItem(player.charId, existingUid);
    if (rec) {
      rec.count = existing.count;
      accountStore.updateCharacter(player.charId, { inventory: { ...accountStore.getCharacter(player.charId)!.inventory } });
    }
    this.state.loot.delete(drop.uid);
    return;
  }
}
// ... existing new-item creation code follows
```

Also update the new-item creation to set `item.count = 1` explicitly and persist `count` in the `addItem` call.

**Note on persistence flush:** `getItem()` returns a reference to the mutable `ItemRecord` in the store map. Mutating `rec.count` directly is safe. Trigger a flush via `accountStore.updateCharacter(player.charId, {})` (no-op patch, but calls `flush()`).

## Step 10 — Client: InventoryItemView — add `count`

**File:** `packages/client/src/state-views.ts`

Add `count: number;` to `InventoryItemView`.

## Step 11 — Client: Consumable hotbar + use-from-inventory

**File:** `packages/client/src/scenes/UI.ts`

### 11a. Import USE_ITEM
Add `UseItemPayload, UseItemResultPayload` to the `@maple/shared` import. Import `CONSUMABLES, getConsumableDef`.

### 11b. Quick-slot wiring
- Store a `private quickSlots: InventoryItemView[] = []` array.
- In `bindRoom`, listen for `MessageType.USE_ITEM` messages to get confirmation.
- In `renderInventory()`, after building the `bagged` array, filter for consumables and populate `quickSlots`.
- Bind keyboard keys `keydown-ONE` through `keydown-EIGHT` to send `MessageType.USE_ITEM` for the corresponding quick slot item.

### 11c. Consumable rows in inventory
In `addBaggedRow`, check if the item is a consumable. If so, show count (e.g. "×5") and a "Use" label instead of "equip". Make the click handler send `USE_ITEM`.

### 11d. Quick-slot visual update
In `drawQuickSlots`, show consumable icon/name text in occupied slots. Update when inventory changes.

### 11e. USE_ITEM response listener
In `bindRoom`, listen for `"use_item_result"` messages and flash a brief notification (similar to quest turn-in notification) showing heal amount or error message.

## Step 12 — Server test: USE_ITEM verification

**File:** `packages/server/test/consumables.ts` (new)

Test script that:
1. Boots the room, joins a player
2. Manually injects an HP potion into the player's inventory
3. Sets HP below max
4. Sends USE_ITEM
5. Asserts HP increased by the restore amount, count decremented
6. Sets HP to max, sends USE_ITEM, asserts "Already at full HP/MP" failure
7. Uses the potion until count = 0, asserts inventory entry is removed
8. Verifies cannot overheal past maxHp

Add to server's `package.json` test script chain.

## Steps

1. Add `ConsumableDef` interface and `CONSUMABLES` catalog + `getConsumableDef()` to `packages/shared/src/items.ts`
2. Add `USE_ITEM: 18` to `MessageType` in `packages/shared/src/net.ts`, plus `UseItemPayload` and `UseItemResultPayload` interfaces
3. Create `packages/shared/tests/consumables.test.ts` with vitest tests for the catalog
4. Add `@type("uint16") count = 1` to `packages/server/src/rooms/schema/InventoryItem.ts`
5. Add `count?: number` to `ItemRecord` in `packages/server/src/persistence/store.ts`
6. Add `UseItemPayload` and `UseItemResultPayload` re-exports to `packages/server/src/types.ts`
7. Add USE_ITEM handler to `packages/server/src/rooms/TownRoom.ts` (import getConsumableDef, register message, implement handleUseItem)
8. Add USE_ITEM handler to `packages/server/src/rooms/MapRoom.ts` (same logic)
9. Add consumable stacking logic to `handlePickup` in both TownRoom.ts and MapRoom.ts
10. Add `count: number` to `InventoryItemView` in `packages/client/src/state-views.ts`
11. Wire consumable quick-slot keys (1-8) and "Use" click action in `packages/client/src/scenes/UI.ts`
12. Create `packages/server/test/consumables.ts` integration test and add to test chain in `package.json`
13. Run verification: `pnpm --filter @maple/shared test`, `pnpm --filter @maple/server test`, `pnpm --filter @maple/client build`, `pnpm -r typecheck`
