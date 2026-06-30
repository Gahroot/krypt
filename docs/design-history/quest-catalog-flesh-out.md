# Plan: Flesh Out Quest Catalog Lv 1–70

## Context
The quest catalog currently covers Lv 1-30 with gaps: no prereq chains between areas, no collect/turn-in quests with etc items, no Skyhaven (Lv 30-40) or Frosthold (Lv 35-55) quests. Players have no guided path past Mirefen (Lv 30). Goal: MapleStory-early-game density — always a next quest from Lv 1 to ~70.

## What exists today
- **Quests**: ~40 quests, mostly kill quests. Some collect quests use equip items. No prereqQuestId field.
- **Items catalog** (ITEMS): Only equipment (weapons/armor/accessories). No etc/collectible items.
- **Mobs**: Full Lv 1-60 mob coverage including Skyhaven (wind_sprite, sky_serpent, thunder_hawk) and Frosthold (frost_wolf, ice_elemental, snow_wraith, crystal_guardian, frost_crawler, permafrost_revenant, frost_banshee, glacial_abomination boss).
- **NPCs**: No Skyhaven or Frosthold NPCs.
- **Tests**: quest-integrity.test.ts and npcs-quests.test.ts validate npc/item/mob references resolve.

## Changes

### 1. Add `prereqQuestId` to QuestDef (`packages/shared/src/quests.ts`)
- Add optional `readonly prereqQuestId?: string` field to the `QuestDef` interface.

### 2. Add ETC items catalog (`packages/shared/src/items.ts`)
Create an `EtcItemDef` interface and `ETC_ITEMS` catalog with ~20 collectible quest items:
- Dawn Isle: `etc.snail_shell`, `etc.green_puff_fiber`
- Harbor: `etc.rat_whisker`, `etc.cargo_manifest`
- Meadowfield: `etc.slime_jelly`, `etc.mushroom_cap`, `etc.hopper_thorn`
- Sylvanreach: `etc.wisp_dust`, `etc.moth_wing`, `etc.spider_silk`
- Craghold: `etc.lizard_scale`, `etc.beetle_shell`, `etc.hawk_feather`
- Dusk Ward: `etc.neon_tag`, `etc.bat_wing`
- Mirefen: `etc.bog_sample`, `etc.ruins_tablet`
- Skyhaven: `etc.sky_crystal`, `etc.serpent_scale`
- Frosthold: `etc.frost_fang`, `etc.ice_shard`, `etc.frozen_heart`

### 3. Add Skyhaven + Frosthold NPCs (`packages/shared/src/npcs.ts`)
New NPCs with guide/shop/storage/quest roles:
- `npc.skyhaven_guide` (mapId: skyhaven) — Windkeeper Zara
- `npc.skyhaven_shop` (mapId: skyhaven) — Cloud Trader Aeron
- `npc.skyhaven_storage` (mapId: skyhaven) — Sky Vault Sentinel
- `npc.skyhaven_quest` (mapId: skyhaven) — Driftpeak Scout Kael
- `npc.frosthold_guide` (mapId: frosthold) — Frost Warden Eira
- `npc.frosthold_shop` (mapId: frosthold) — Ice Trader Bjorn
- `npc.frosthold_storage` (mapId: frosthold) — Permafrost Vault
- `npc.frosthold_quest` (mapId: frosthold) — Expedition Leader Saga

### 4. Add ~45 new quests (`packages/shared/src/quests.ts`)
**Level coverage target — always a next quest:**

| Level | Quest | Type | Region |
|-------|-------|------|--------|
| 1 | dawn_tutorial | talk | Dawn Isle |
| 1 | dawn_trio | kill | Dawn Isle |
| 3 | dawn_step_jump | talk | Dawn Isle |
| 3 | dawn_step_loot | collect | Dawn Isle |
| 3 | dawn_step_inventory | talk | Dawn Isle |
| 3 | dawn_level3 | level | Dawn Isle |
| 5 | dawn_shroom_hunt (new) | kill | Dawn Isle |
| 6 | dawn_puff_patrol (new) | kill+collect | Dawn Isle |
| 8 | dawn_ready (new) | level | Dawn Isle |
| 8 | dawn_ferry | talk | Dawn Isle |
| 3 | harbor_welcome | talk | Harbor |
| 3 | harbor_rat_roundup | kill | Harbor |
| 4 | harbor_lost_cargo | collect | Harbor |
| 5 | harbor_rat_whiskers (new) | collect | Harbor |
| 7 | harbor_captains_log (new) | talk chain | Harbor |
| 10 | harbor_ready | level | Harbor |
| 8 | meadow_green_goo (new) | kill | Meadowfield |
| 10 | meadow_slimes | kill | Meadowfield |
| 10 | meadow_mushroom_madness (new) | kill+collect | Meadowfield |
| 12 | meadow_hopper_hunt (new) | kill | Meadowfield |
| 14 | meadow_crow_control (new) | kill | Meadowfield |
| 10 | sylvan_welcome | talk | Sylvanreach |
| 10 | sylvan_forest_clearing | kill | Sylvanreach |
| 10 | sylvan_wisp_essence (new) | collect | Sylvanreach |
| 12 | sylvan_canopy_pests | kill | Sylvanreach |
| 14 | sylvan_spider_silk (new) | collect | Sylvanreach |
| 15 | sylvan_root_patrol | kill | Sylvanreach |
| 17 | sylvan_sprite_dance (new) | kill+collect | Sylvanreach |
| 20 | sylvan_heart | level | Sylvanreach |
| 10 | crag_welcome | talk | Craghold |
| 10 | crag_lizard_roundup | kill | Craghold |
| 11 | crag_scale_quest (new) | collect | Craghold |
| 13 | crag_beetle_bounty (new) | kill | Craghold |
| 14 | crag_hawk_watch | kill | Craghold |
| 16 | crag_quarry_depths | kill | Craghold |
| 17 | crag_crab_catch (new) | collect | Craghold |
| 20 | crag_iron_will | level | Craghold |
| 10 | dusk_welcome | talk | Dusk Ward |
| 10 | dusk_subway_sweep | kill | Dusk Ward |
| 11 | dusk_tag_collection (new) | collect | Dusk Ward |
| 13 | dusk_rail_patrol | kill | Dusk Ward |
| 15 | dusk_drone_hunt (new) | kill | Dusk Ward |
| 16 | dusk_backalley_cleanup | kill | Dusk Ward |
| 20 | dusk_shadow_end | level | Dusk Ward |
| 15 | crossway_welcome | talk | Crossway |
| 15 | crossway_messenger | talk | Crossway |
| 18 | crossway_defender | kill | Crossway |
| 20 | crossway_escort (new) | talk chain | Crossway |
| 22 | crossway_relic_hunt (new) | collect | Crossway |
| 25 | crossway_champion | level | Crossway |
| 20 | mirefen_welcome | talk | Mirefen |
| 20 | mirefen_bog_purge | kill | Mirefen |
| 22 | mirefen_bog_sample (new) | collect | Mirefen |
| 25 | mirefen_sentinel_relics | kill | Mirefen |
| 26 | mirefen_tablet_quest (new) | collect | Mirefen |
| 27 | mirefen_wraith_hunt | kill | Mirefen |
| 28 | mirefen_ruin_behemoth | kill | Mirefen |
| 30 | skyhaven_arrival (new) | talk | Skyhaven |
| 30 | skyhaven_wind_sprite_hunt (new) | kill | Skyhaven |
| 32 | skyhaven_crystal_gathering (new) | collect | Skyhaven |
| 35 | skyhaven_serpent_hunt (new) | kill | Skyhaven |
| 38 | skyhaven_thunder_hawk_flight (new) | kill | Skyhaven |
| 40 | skyhaven_sky_master (new) | level | Skyhaven |
| 35 | frosthold_arrival (new) | talk | Frosthold |
| 35 | frosthold_wolf_patrol (new) | kill | Frosthold |
| 37 | frosthold_fang_collection (new) | collect | Frosthold |
| 38 | frosthold_elemental_purge (new) | kill | Frosthold |
| 42 | frosthold_crystal_hunt (new) | collect | Frosthold |
| 45 | frosthold_icecave_descent (new) | talk | Frosthold |
| 50 | frosthold_revenant_hunt (new) | kill | Frosthold |
| 55 | frosthold_banshee_bane (new) | kill | Frosthold |
| 55 | frosthold_frozen_heart (new) | collect | Frosthold |

**Prereq chain wiring:**
- Dawn Isle: tutorial → trio → jump → loot → inventory → level3 → shroom_hunt → puff_patrol → ready → ferry
- Harbor: welcome → rat_roundup → lost_cargo → rat_whiskers → captains_log → ready
- Meadowfield: green_goo → slimes → mushroom_madness → hopper_hunt → crow_control
- Sylvanreach: welcome → forest_clearing → wisp_essence → canopy_pests → spider_silk → root_patrol → sprite_dance → heart
- Craghold: welcome → lizard_roundup → scale_quest → beetle_bounty → hawk_watch → quarry_depths → crab_catch → iron_will
- Dusk Ward: welcome → subway_sweep → tag_collection → rail_patrol → drone_hunt → backalley_cleanup → shadow_end
- Crossway: welcome → messenger → defender → escort → relic_hunt → champion
- Mirefen: welcome → bog_purge → bog_sample → sentinel_relics → tablet_quest → wraith_hunt → ruin_behemoth
- Skyhaven: arrival → wind_sprite_hunt → crystal_gathering → serpent_hunt → thunder_hawk_flight → sky_master
- Frosthold: arrival → wolf_patrol → fang_collection → elemental_purge → crystal_hunt → icecave_descent → revenant_hunt → banshee_bane → frozen_heart

### 5. Add etc item drops to mob drop tables (`packages/shared/src/mobs.ts`)
Add 1-2 `etc.*` drop entries to relevant mobs so collect quests are completable.

### 6. Update tests (`packages/shared/tests/`)
- Update `quest-integrity.test.ts`: add test that collect objective etc itemIds resolve in `ETC_ITEMS`.
- Update `npcs-quests.test.ts`: add Skyhaven/Frosthold to knownMapIds.
- Add new test: every quest with `prereqQuestId` resolves to a real quest id.

### 7. Run `pnpm --filter @maple/shared typecheck && pnpm --filter @maple/shared test`

## Risks
- Large data entry — easy to typo an id. Tests will catch any mismatches.
- `prereqQuestId` is a new optional field — no breaking changes to existing quests.

## Steps
1. Add `prereqQuestId?: string` to `QuestDef` interface in quests.ts
2. Add `EtcItemDef` interface and `ETC_ITEMS` catalog to items.ts (~22 items)
3. Add Skyhaven + Frosthold NPCs (8 NPCs) to npcs.ts
4. Add etc item drops to relevant mob drop tables in mobs.ts
5. Rewrite quests.ts: add ~45 new quests with prereq chains, all collect/kill/talk/level types, covering Lv 1-70
6. Update quest-integrity.test.ts: add ETC_ITEMS validation for collect objectives + prereqQuestId validation
7. Update npcs-quests.test.ts: add Skyhaven/Frosthold to knownMapIds
8. Run typecheck and tests
