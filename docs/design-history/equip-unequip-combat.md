# Equip/Unequip Combat Stats — Plan

## Finding: Already Implemented

After thorough codebase exploration, **every piece of this feature already exists** end-to-end:

### Server
- **Player schema** (`packages/server/src/rooms/schema/Player.ts:66`): `@type({ map: "string" }) equipped = new MapSchema<string>()`
- **CharacterRecord persistence** (`packages/server/src/persistence/store.ts:105`): `equipped?: Record<string, string>` with `equipItem()`/`unequipItem()` methods
- **MessageType** (`packages/shared/src/net.ts:40-41`): `EQUIP_ITEM: 16, UNEQUIP_ITEM: 17`
- **Payload types** (`packages/shared/src/net.ts:383-390`): `EquipItemPayload { uid }`, `UnequipItemPayload { slot }`
- **Message handlers** (`packages/server/src/rooms/MapRoom.ts:4003-4093`): `handleEquip` validates ownership, `canEquip()` (levelReq + classReq + statReq), slot matching, swap existing; `handleUnequip` validates slot exists
- **Combat integration** (`MapRoom.ts:1416-1491`): `playerDamage()` and `buildAttackerStats()` use `resolveEquippedBonus()` which computes baseAttack × BaseRank statMultiplier + baseStatBonus × statMultiplier + potential lines

### Shared
- **resolveEquippedBonus** (`packages/shared/src/items.ts:2471-2506`): pure function, scales by rank multiplier, handles potential lines
- **canEquip** (`packages/shared/src/items.ts:2358-2384`): validates levelReq, classReq, stat requirements

### Client
- **Inventory panel** (I key, `UI.ts:1277-1553`): "Equipment" section (equipped, click-to-unequip), "Bag" section (bagged, click-to-equip), stat summary at top
- **Paper doll** (E key, `UI.ts:1812-1909`): all slots displayed, click-to-unequip, tooltip support

### Tests
- **`packages/server/test/equip.ts`**: 3 tests — weapon raises damage, level-gating enforced, equip/unequip cycle

## Verification Steps

1. Run `pnpm --filter @maple/server test` — verify all tests pass including equip.ts
2. Run `pnpm --filter @maple/client build` — verify client builds
3. Run `pnpm -r typecheck` — verify no type errors

No implementation work needed.
