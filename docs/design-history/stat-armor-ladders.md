# Plan: Add INT/DEX/LUK Armor Ladders

## Problem

Armor in `packages/shared/src/items.ts` is overwhelmingly STR-statted. Mages (INT), archers/pirates (DEX), and thieves (LUK) must wear off-stat gear. Some pieces exist (e.g. `hat.woven_circlet`, `top.mages_robe`, `hat.rogue_cowl`, `shoes.threadbare_sandals`) but the coverage is spotty — many slots and level bands have zero non-STR options.

## What Exists Today

| Slot | INT pieces | DEX pieces | LUK pieces |
|------|-----------|-----------|-----------|
| HAT | lv10 woven_circlet, lv30 sage_circlet, lv50 arcane_diadem | NONE | lv20 rogue_cowl |
| TOP | lv10 mages_robe | NONE | lv20 rogues_wrap |
| BOTTOM | NONE | NONE | NONE |
| OVERALL | NONE | NONE | NONE |
| GLOVES | lv20 mages_mitts | NONE | lv30 rogues_fingerwraps |
| SHOES | NONE | lv5 threadbare, lv10 worn, lv30 steel_toed, lv50 obsidian, lv60 aetherbound | lv20 windwalker |
| CAPE | lv40 mages_cape_of_warding | lv5 worn, lv10 travelers, lv20 archers_windcloak, lv60 aethersilk | NONE |
| SHIELD | ALL warrior-locked | ALL warrior-locked | ALL warrior-locked |

## Approach

Add ~128 new `ItemDef` entries mirroring the STR ladder's stat/defense/req curve with class-appropriate flavor, plus document SHIELD design decision, then update NPC shops with starter-level pieces.

### Stat Curves (mirroring STR)

**INT (Mage):** ~50% wDef, ~130% mDef vs STR equivalents. mpBonus instead of hpBonus. No speed penalty. `classReq: [ClassArchetype.MAGE]`. `reqInt` primary, `reqDex` secondary.

**DEX (Archer):** ~80% wDef, ~90% mDef vs STR equivalents. Moderate hpBonus. Small speed bonus. `classReq: [ClassArchetype.ARCHER]` for hat/gloves/cape; open for top/bottom/shoes/overall (pirates also DEX-primary). `reqDex` primary, `reqStr` secondary.

**LUK (Thief):** ~60% wDef, ~70% mDef vs STR equivalents. Lower hpBonus. Speed bonus. `classReq: [ClassArchetype.THIEF]`. `reqLuk` primary, `reqDex` secondary.

### ID Naming Convention

- INT: `hat.arcane_apprentice_hood` (lv5), `hat.arcane_circlet` (lv20), `hat.arcane_crown` (lv40), `hat.celestial_tiara` (lv60) — existing: woven_circlet (lv10), sage_circlet (lv30), arcane_diadem (lv50)
- DEX: `hat.gale_cap` (lv5), `hat.wind_cap` (lv10), `hat.ranger_cap` (lv20), `hat.storm_cap` (lv30), `hat.gale_helm` (lv40), `hat.storm_helm` (lv50), `hat.tempest_helm` (lv60)
- LUK: `hat.shadow_hood` (lv5), `hat.night_cowl` (lv10), existing rogue_cowl (lv20), `hat.night_cowl_30` etc.

### Files to Change

1. **`packages/shared/src/items.ts`** — Add new `ItemDef` entries in each armor section (HAT, TOP, BOTTOM, OVERALL, GLOVES, SHOES, CAPE). Add design note comment on SHIELD section explaining warrior-only.

2. **`packages/shared/src/shops.ts`** — Add starter-level (lv5/lv10) new armor pieces to NPC shop stock:
   - `shop.meadow_equip` / `shop.harbor_equip`: Add DEX starter pieces (archer hometown)
   - `shop.sylvan_equip`: Add INT starter pieces (mage hometown)
   - `shop.dusk_equip`: Add LUK starter pieces (thief hometown)
   - `shop.crag_equip`: Already has warrior starter pieces
   - `shop.crossway_equip`: Mixed town, add representative pieces

### New Items by Slot (only missing pieces)

**HAT** — Add 17 items: INT lv5/20/40/60, DEX lv5/10/20/30/40/50/60, LUK lv5/10/30/40/50/60

**TOP** — Add 19 items: INT lv5/20/30/40/50/60, DEX lv5/10/20/30/40/50/60, LUK lv5/10/30/40/50/60

**BOTTOM** — Add 21 items: INT/DEX/LUK lv5/10/20/30/40/50/60 each

**OVERALL** — Add 21 items: INT/DEX/LUK lv5/10/20/30/40/50/60 each

**GLOVES** — Add 19 items: INT lv5/10/30/40/50/60, DEX lv5/10/20/30/40/50/60, LUK lv5/10/20/40/50/60

**SHOES** — Add 15 items: INT lv5/10/20/30/40/50/60, DEX lv20/40, LUK lv5/10/30/40/50/60

**CAPE** — Add 16 items: INT lv5/10/20/30/50/60, DEX lv30/40/50, LUK lv5/10/20/30/40/50/60

**SHIELD** — No new items. Add comment: shields stay warrior-only because all other classes use two-handed weapons (wand/staff, bow/crossbow, dagger/claw, gun/knuckle).

### Shop Updates

Add to each class-town equip shop:
- **Starter pieces** (lv5 baseStatBonus 1-2, buyPrice 80-120) and **lv10 pieces** (buyPrice 150-300)
- Mage town (sylvan_equip): INT hat, top, bottom, gloves, shoes, cape, overall
- Archer town (meadow_equip/harbor_equip): DEX hat, top, bottom, gloves, cape, overall
- Thief town (dusk_equip): LUK hat, top, bottom, gloves, shoes, cape, overall

## Verification

1. `pnpm --filter @maple/shared test` — all tests pass (especially armor-catalog.test.ts which checks defense ascends per level band, IDs use correct prefix, classReq validity)
2. `pnpm typecheck` — no TypeScript errors
3. Spot-check: new items are equippable by the correct class with appropriate stat requirements

## Steps

1. Add new HAT items (INT/DEX/LUK) after existing hat entries in items.ts
2. Add new TOP items after existing top entries
3. Add new BOTTOM items after existing bottom entries
4. Add new OVERALL items after existing overall entries
5. Add new GLOVES items after existing gloves entries
6. Add new SHOES items after existing shoes entries
7. Add new CAPE items after existing cape entries
8. Add SHIELD warrior-only documentation comment
9. Update shop.sylvan_equip with INT starter armor
10. Update shop.meadow_equip and shop.harbor_equip with DEX starter armor
11. Update shop.dusk_equip with LUK starter armor
12. Update shop.crag_equip and shop.crossway_equip with representative pieces
13. Run `pnpm --filter @maple/shared test` — fix any failures
14. Run `pnpm typecheck` — fix any errors
