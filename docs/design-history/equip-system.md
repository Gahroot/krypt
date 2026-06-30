# Gear Equip / Unequip + Combat Stat Integration

## Summary

Add a server-authoritative equipment system: players equip/unequip owned gear via new message types, the equipped map syncs to all clients via Colyseus schema, equipped items boost combat stats (baseAttack + scaled statBonus + potential lines), and the client inventory UI splits into equipped vs bagged with click-to-equip/unequip.

**Critical discovery**: `app.config.ts` uses `MapRoom` (not `TownRoom`) for meadowfield. All server changes target `MapRoom`. `TownRoom` is legacy.

## Files to Modify

| File | What Changes |
|------|-------------|
| `packages/shared/src/net.ts` | Add `EQUIP_ITEM: 16`, `UNEQUIP_ITEM: 17` + payload interfaces |
| `packages/shared/src/items.ts` | Export `resolveEquippedBonus()` helper |
| `packages/server/src/rooms/schema/Player.ts` | Add `@type({ map: "string" }) equipped` MapSchema |
| `packages/server/src/rooms/schema/InventoryItem.ts` | Add `@type("string") potentialLines` (JSON string) |
| `packages/server/src/rooms/schema/index.ts` | No changes needed |
| `packages/server/src/rooms/MapRoom.ts` | Add EQUIP/UNEQUIP handlers, update `playerDamage`, `tryAttack`, `onJoin`, `persistPlayer` |
| `packages/server/src/rooms/TownRoom.ts` | Mirror MapRoom changes (still used by some code paths) |
| `packages/server/src/persistence/store.ts` | Add `equipItem()`, `unequipItem()`, `getEquipped()` methods |
| `packages/server/src/types.ts` | Re-export new MessageType + payload types |
| `packages/client/src/state-views.ts` | Add `equipped: MapSchema<string>` to PlayerView |
| `packages/client/src/scenes/UI.ts` | Split inventory into equipped/bagged sections, add equip/unequip click handlers |
| `packages/server/test/equip.ts` | New test file: equip weapon → damage increases, level-gate enforced |

## Detailed Changes

### 1. Shared: MessageType + Payloads (`net.ts`)

Add after `CASH_INFO: 15`:
```ts
EQUIP_ITEM: 16,
UNEQUIP_ITEM: 17,
```

Add payload interfaces:
```ts
export interface EquipItemPayload { uid: string; }
export interface UnequipItemPayload { slot: string; }
```

### 2. Shared: `resolveEquippedBonus()` (`items.ts`)

Add a pure function that computes bonus stats from equipped gear. Used by both server (combat) and client (stat preview):

```ts
export function resolveEquippedBonus(
  equipped: Record<string, string>,
  inventory: Map<string, ItemInstance>,
): { atk: number; str: number; dex: number; int: number; luk: number }
```

Logic: for each equipped slot, look up the item's defId → ItemDef, apply `baseStatBonus * statMultiplier` to the appropriate primary stat, apply `baseAttack * statMultiplier` for weapons, then iterate potentialLines adding `percent` bonuses.

### 3. Server Schema: Player equipped map (`Player.ts`)

Add synced field:
```ts
@type({ map: "string" }) equipped = new MapSchema<string>();
```

Key = EquipSlot string (e.g. "WEAPON"), value = item uid.

### 4. Server Schema: InventoryItem potential lines (`InventoryItem.ts`)

Add:
```ts
@type("string") potentialLines = "[]";
```

Store as JSON string for simplicity (Colyseus doesn't have a nested array of primitives type). Server parses it when computing combat stats; client parses for stat preview.

### 5. Server: MapRoom changes (`MapRoom.ts`)

**New message handlers** in `messages` object:
```ts
[MessageType.EQUIP_ITEM]: (client, msg: EquipItemPayload) => this.handleEquip(client, msg),
[MessageType.UNEQUIP_ITEM]: (client, msg: UnequipItemPayload) => this.handleUnequip(client, msg),
```

**`handleEquip(client, { uid })`:**
1. Get player + inventory item by uid
2. Look up `getItemDef(item.defId)` → get `slot`
3. Validate: item exists in inventory, character level >= def.levelReq, slot is valid
4. If slot already occupied, move that item back to bag (just skip — items stay in inventory MapSchema, the equipped map is separate)
5. Set `player.equipped.set(slot, uid)`
6. Persist: `accountStore.equipItem(player.charId, slot, uid)`
7. Update attackType: `player.attackType = resolveAttackType(player.equipped, invDefIds, player.archetype)`
8. Broadcast equip_result

**`handleUnequip(client, { slot })`:**
1. Validate slot is equipped
2. `player.equipped.delete(slot)`
3. Persist: `accountStore.unequipItem(player.charId, slot)`
4. Update attackType

**`playerDamage(player)`:**
- After computing base `power`, add equipped weapon's `baseAttack * statMultiplier`
- Add potential line ATK bonuses

**`onJoin`:** Restore equipped from `character.equipped`, set on player schema.

**`persistPlayer`:** Include `equipped` field.

### 6. Persistence: equip/unequip methods (`store.ts`)

```ts
equipItem(charId: string, slot: string, uid: string): void
unequipItem(charId: string, slot: string): void
```

These read/write `rec.equipped` (already `Record<string, string>` on CharacterRecord).

### 7. Client: PlayerView (`state-views.ts`)

Add to PlayerView:
```ts
equipped: MapSchema<string>;
```

### 8. Client: UI inventory panel (`UI.ts`)

**Split `renderInventory()`** into two sections:
1. **Equipped section** — header "Equipment", iterate `player.equipped` entries, show slot label + item name + stats
2. **Bagged section** — header "Bag", items NOT in equipped map

**Add click handlers:**
- Bagged item click → `room.send(MessageType.EQUIP_ITEM, { uid })`
- Equipped item click → `room.send(MessageType.UNEQUIP_ITEM, { slot })`

**Add stat summary** at top: "ATK: XX  STR: XX  DEX: XX  INT: XX  LUK: XX" — computed client-side using same logic as server.

### 9. Test (`test/equip.ts`)

Using the same pattern as `rangedCombat.ts`:
1. Create a Warrior character, give it a Bronze Shortsword in inventory
2. Join room, verify base damage (no weapon equipped)
3. Send EQUIP_ITEM for the sword
4. Verify damage increased (weapon baseAttack + stat bonus)
5. Create a level-10-only weapon, verify level gate rejects at level 1
6. Test equip/unequip cycle
7. Test slot swap (equip weapon → equip different weapon)

## Verification

```bash
pnpm --filter @maple/server test    # runs new equip.ts test
pnpm --filter @maple/client build   # typecheck + vite build
pnpm -r typecheck                   # full monorepo typecheck
```

## Steps

1. Add `EQUIP_ITEM` and `UNEQUIP_ITEM` to `MessageType` in `packages/shared/src/net.ts`, plus `EquipItemPayload` and `UnequipItemPayload` interfaces
2. Add `resolveEquippedBonus()` function to `packages/shared/src/items.ts` that computes atk/stat bonuses from equipped gear
3. Add `@type({ map: "string" }) equipped = new MapSchema<string>()` to `packages/server/src/rooms/schema/Player.ts`
4. Add `@type("string") potentialLines = "[]"` to `packages/server/src/rooms/schema/InventoryItem.ts`
5. Add `equipItem()` and `unequipItem()` methods to `AccountStore` in `packages/server/src/persistence/store.ts`
6. Re-export new types from `packages/server/src/types.ts`
7. Update `resolveAttackType` in `packages/shared/src/items.ts` to accept equipped map as first param (only check equipped weapon for attack type)
8. Add `handleEquip` and `handleUnequip` methods to `MapRoom` with validation (ownership, levelReq, slot match)
9. Update `MapRoom.playerDamage()` to add equipped gear bonuses (baseAttack + statBonus * rankMultiplier + potential lines)
10. Update `MapRoom.tryAttack()` to pass equipped map to `resolveAttackType`
11. Update `MapRoom.onJoin()` to restore equipped from character record
12. Update `MapRoom.persistPlayer()` to save equipped map
13. Update `packages/client/src/state-views.ts` — add `equipped: MapSchema<string>` to PlayerView
14. Update `packages/client/src/scenes/UI.ts` — split inventory into equipped/bagged, add equip/unequip click handlers, add stat summary
15. Create `packages/server/test/equip.ts` — test weapon equip raises damage, level gate enforced
16. Run `pnpm --filter @maple/server test`, `pnpm --filter @maple/client build`, `pnpm -r typecheck`
