# Accessory Expansion Plan

## Overview
Expand the accessory system from 7 slot types × 3 mono-STR tiers to a full system with lv60 tiers, 4 stat variants per tier (STR/DEX/INT/LUK), and 3 new slot types (MEDAL, BADGE, POCKET) plus multi-ring slots (RING_2..4).

## Files to Change

### 1. `packages/shared/src/items.ts` — Enum + Items + Helper

**EquipSlot enum** — add 6 new members:
```
MEDAL, BADGE, POCKET, RING_2, RING_3, RING_4
```

**New items (~139 total):**
- For each of the 7 existing accessory slots: add 3 missing stat variants at lv10/30/50 + all 4 variants at lv60 (7×3×3 + 7×4 = 91 items)
- For 3 new slots (MEDAL/BADGE/POCKET): 4 stats × 4 levels = 48 items
- All items follow existing naming convention: `{prefix}.{themed_name}`
- New prefixes: `medal.`, `badge.`, `pocket.`
- Defensive stats (wDef/mDef/hpBonus/mpBonus) scale by level matching existing slot patterns
- baseStatBonus: lv10=2, lv30=4, lv50=7, lv60=10

**New helper** — `resolveRingSlot(equipped)`:
- Exported function in items.ts
- Scans RING → RING_2 → RING_3 → RING_4 for first empty slot
- Falls back to RING if all full
- Both Map and Record inputs supported

### 2. `packages/server/src/rooms/MapRoom.ts` — Equip Logic (~line 4743)

Import `resolveRingSlot` from shared. In `handleEquip`, replace:
```ts
const slot = def.slot;
```
with:
```ts
const slot = def.slot === EquipSlot.RING ? resolveRingSlot(player.equipped) : def.slot;
```

This allows any ring item to fill the first available ring slot.

### 3. `packages/client/src/scenes/UI.ts` — Equip Panel (~line 183)

Update `EQUIP_SLOT_ORDER` to include new slots in classic MapleStory paper-doll layout:
```ts
WEAPON, HAT, FACE_ACCESSORY, EYE_ACCESSORY, EARRING, PENDANT,
TOP, OVERALL, CAPE, SHIELD, BOTTOM, GLOVES, BELT,
RING, RING_2, RING_3, RING_4, SHOES, SHOULDER,
MEDAL, BADGE, POCKET
```

Panel height is dynamic (auto-sizes to row count) — no width/height constants need changing.

### 4. `packages/shared/tests/accessory-catalog.test.ts`

- Add MEDAL, BADGE, POCKET to `ACCESSORY_SLOTS` array
- Add `medal.`, `badge.`, `pocket.` to `SLOT_PREFIXES`
- Update `EXPECTED_BANDS` from `[10, 30, 50]` to `[10, 30, 50, 60]`
- Update multi-ring note comment

### 5. `packages/shared/tests/armor-catalog.test.ts`

- Add MEDAL, BADGE, POCKET to `ARMOR_SLOTS` and `SLOT_PREFIXES`

## Verification

```bash
pnpm --filter @maple/shared test   # vitest — accessory-catalog + armor-catalog + can-equip
pnpm typecheck                     # tsc --noEmit across all packages
```

## Steps

1. Edit `EquipSlot` enum in `packages/shared/src/items.ts` — add MEDAL, BADGE, POCKET, RING_2, RING_3, RING_4
2. Add `resolveRingSlot()` helper in `packages/shared/src/items.ts` after `canEquip()`
3. Replace accessory items section (lines 2160–2455) in `packages/shared/src/items.ts` with expanded catalog (~139 new items with stat variants and lv60 tiers)
4. Update `handleEquip` in `packages/server/src/rooms/MapRoom.ts` (~line 4743) to use `resolveRingSlot` for RING items
5. Update `EQUIP_SLOT_ORDER` in `packages/client/src/scenes/UI.ts` (line 183) to include new slots
6. Update `packages/shared/tests/accessory-catalog.test.ts` — add new slots, prefixes, lv60 band
7. Update `packages/shared/tests/armor-catalog.test.ts` — add MEDAL/BADGE/POCKET to ARMOR_SLOTS and SLOT_PREFIXES
8. Run `pnpm --filter @maple/shared test` — verify all tests pass
9. Run `pnpm typecheck` — verify no type errors
