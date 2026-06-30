# Design Plan Index

Triage of the 58 design plans that lived in `.ezcoder/plans/`, verified against `packages/*/src` on 2026-06-30.

- **Shipped** plans are archived in this folder (`docs/design-history/`).
- **Partial** and **not-started** plans remain active in `.ezcoder/plans/` — they still have pending work.

Status reflects what exists in code, not what the plan intended.

## Summary

| Status | Count | Location |
| --- | --- | --- |
| shipped | 38 | `docs/design-history/` |
| partial | 1 | `.ezcoder/plans/` |
| not-started | 19 | `.ezcoder/plans/` |

---

## Shipped (archived here)

| Plan | Note | Key files |
| --- | --- | --- |
| accessory-expansion | MEDAL/BADGE/POCKET/RING_2-4 slots + lv60 stat-variant items | `shared/src/items.ts`, `server/src/rooms/MapRoom.ts`, `client/src/scenes/UI.ts` |
| action-combat | Knockback, i-frames, combo counter | `server/src/rooms/MapRoom.ts`, `server/src/rooms/schema/Player.ts`, `server/src/bossManager.ts` |
| active-skill-casting | Effects model: activeEffects, tickEffects, aggregateSecondary | `server/src/rooms/MapRoom.ts`, `server/src/rooms/schema/Player.ts`, `shared/src/effects.ts` |
| alpha-deploy | /healthz, /metrics, CORS_ORIGIN, MONITOR_SECRET, structured logger | `server/src/app.config.ts`, `server/src/logger.ts` |
| appearance-rendering | Procedural per-player appearance textures rendered in MapScene | `client/src/art/textures.ts`, `client/src/scenes/MapScene.ts`, `client/src/state-views.ts` |
| channels | ChannelRegistry singleton, channel switch/whisper, /channels endpoint | `server/src/channelRegistry.ts`, `server/src/rooms/MapRoom.ts`, `server/src/app.config.ts` |
| chat-system | Party/whisper chat handlers with profanity filter | `server/src/rooms/MapRoom.ts`, `shared/src/profanity.ts` |
| combat-qol-ui | SettingsUI Combat QoL tab (auto-pot, macros) | `client/src/scenes/SettingsUI.ts`, `client/src/scenes/UI.ts` |
| combat-qol | Pickup-all, macro cast/layout, auto-pot sync, migration 006 | `server/src/rooms/MapRoom.ts`, `server/src/persistence/store.ts`, `server/src/rooms/schema/Player.ts` |
| cross-map-parties | PartyManager singleton, loot rules, LFG listings | `server/src/partyManager.ts`, `server/src/rooms/MapRoom.ts` |
| db-store-cleanup | Migration test uses MIGRATION_COUNT; importFileData covers new columns | `server/test/dbMigration.ts`, `server/src/persistence/importFileData.ts` |
| economy-uis | Trade and Storage scenes wired; Market rebuilt in React | `client/src/scenes/Trade.ts`, `client/src/scenes/Storage.ts`, `client/src/scenes/Market.ts` |
| equip-system | EQUIP/UNEQUIP, resolveEquippedBonus, canEquip, equipped schema | `shared/src/items.ts`, `shared/src/net.ts`, `server/src/rooms/MapRoom.ts`, `server/src/rooms/schema/Player.ts` |
| equip-unequip-combat | Same equip feature verified end-to-end through combat | `shared/src/items.ts`, `server/src/rooms/MapRoom.ts`, `server/src/rooms/schema/Player.ts` |
| familiar-system | familiars catalog, Familiar schema, TownState map, drop + summon AI | `shared/src/familiars.ts`, `server/src/rooms/schema/Familiar.ts`, `server/src/rooms/schema/TownState.ts`, `server/src/rooms/MapRoom.ts` |
| field-bosses | Five boss mobs + BossManager (phases, encounters) | `shared/src/mobs.ts`, `server/src/bossManager.ts` |
| first-session-ux | CoachMarks, Loading, Intro scenes registered | `client/src/scenes/CoachMarks.ts`, `client/src/scenes/Loading.ts`, `client/src/scenes/Intro.ts` |
| friends-buddy-assessment | friendManager + FRIEND_ADD handlers + client panel | `server/src/friendManager.ts`, `server/src/rooms/MapRoom.ts`, `client/src/scenes/UI.ts` |
| gm-admin-tooling | gmCommands.ts: handleGmCommand, audit log, role-check, GM_COMMAND | `server/src/gmCommands.ts`, `server/src/rooms/MapRoom.ts`, `shared/src/net.ts` |
| item-tooltip-parity | ItemTooltip uses canEquip with Unusable banner + per-req display | `client/src/ui/ItemTooltip.tsx` |
| item-tooltips | Rich React tooltip: rank color, tier border, reqs, set bonuses | `client/src/ui/ItemTooltip.tsx`, `client/src/ui/InventoryPanel.tsx`, `client/src/ui/EquipmentPanel.tsx` |
| job-branches | JobBranch, branchSkillsFor, learnSkill branch gating + test | `shared/src/classes.ts`, `shared/src/skillbook.ts` |
| mts-market-features | Buy orders, auctions, price history; migration 015 | `shared/src/market.ts`, `server/src/rooms/MarketRoom.ts`, `server/src/rooms/schema/BuyOrder.ts`, `server/src/persistence/store.ts` |
| multi-character-accounts | CharacterRecord, character CRUD, Player.charId, charBySession | `server/src/persistence/store.ts`, `server/src/rooms/MarketRoom.ts`, `server/src/rooms/schema/Player.ts` |
| npc-shops | ShopEntry/stock, sellPriceFor, NPC proximity + stock enforcement | `shared/src/shops.ts`, `shared/src/npcs.ts`, `server/src/rooms/MapRoom.ts` |
| quest-catalog-flesh-out | prereqQuestId, ETC_ITEMS catalog, Skyhaven/Frosthold chains | `shared/src/quests.ts`, `shared/src/items.ts`, `shared/src/npcs.ts` |
| quest-engine | questEngine.ts accept/turnIn/progress, QUEST_UPDATE, questState + test | `server/src/questEngine.ts`, `server/src/rooms/schema/Player.ts`, `shared/src/net.ts` |
| quickslot-hotbar | SKILL_CAST/USE_CONSUMABLE, quickslots, cooldowns, UI hotbar; migration 004 | `shared/src/net.ts`, `client/src/backend.ts`, `server/src/rooms/MapRoom.ts`, `client/src/scenes/UI.ts` |
| rune-treasure-box | RUNE/TREASURE messages, RuneManager, TreasureBoxManager | `server/src/runeManager.ts`, `server/src/treasureBoxManager.ts`, `shared/src/world.ts`, `shared/src/net.ts` |
| scaffold | Monorepo bootstrapped; full combat/loot/market loop (MapRoom replaces TownRoom) | `shared/src/rarity.ts`, `shared/src/stats.ts`, `server/src/rooms/MapRoom.ts`, `client/src/scenes/MapScene.ts` |
| server-hardening | validate.ts (RateLimiter/sanitizers), reconnection + test | `server/src/validate.ts`, `server/src/rooms/MapRoom.ts`, `server/test/hardenedInputs.ts` |
| settings-menu | Shared/client keybindings, SettingsUI, SETTINGS_SYNC; migration 005 | `shared/src/keybindings.ts`, `client/src/scenes/SettingsUI.ts`, `server/src/persistence/migrations/005_settings.sql` |
| skill-learning-casting | LEARN_SKILL/SKILL_CAST, skillBook, MP/cooldown casting, skill panel | `shared/src/skillbook.ts`, `server/src/rooms/MapRoom.ts`, `client/src/scenes/UI.ts` |
| sqlite-persistence | db.ts (better-sqlite3, WAL, migration runner); store rewritten to SQL | `server/src/persistence/db.ts`, `server/src/persistence/store.ts`, `server/src/persistence/migrations/001_schema.sql` |
| stackable-consumables | CONSUMABLES catalog, count field, USE_CONSUMABLE, quick-slot UI | `shared/src/consumables.ts`, `server/src/rooms/schema/InventoryItem.ts`, `server/src/rooms/MapRoom.ts` |
| stat-armor-ladders | INT/DEX/LUK armor ladders (arcane_apprentice_hood, gale_cap, shadow_hood) | `shared/src/items.ts`, `shared/src/shops.ts` |
| tabbed-inventory | tabForItem/TAB_CAPACITY model + UI tab buckets, grid, reorder | `shared/src/inventory.ts`, `client/src/scenes/UI.ts` |
| title-system | TITLE_EQUIP/SYNC, Player title fields, sprite/UI render; migration 014 | `shared/src/net.ts`, `server/src/rooms/schema/Player.ts`, `server/src/rooms/MapRoom.ts`, `client/src/scenes/MapScene.ts` |

---

## Partial (still active)

| Plan | Note | Key files |
| --- | --- | --- |
| quest-catalog-expansion | Overlapping core shipped via quest-catalog-flesh-out; its distinct ETCS catalog and richer NPC set (cloudwatcher, trapper, frostcave_scholar) are absent | `shared/src/quests.ts`, `shared/src/items.ts`, `shared/src/npcs.ts` |

---

## Not started (still active)

| Plan | Note |
| --- | --- |
| auth-session | No auth.ts, /auth routes, AuthScene, or token helpers |
| character-select-screen | No CharacterSelect scene or /characters endpoint; Preload routes to character_create |
| character-select | Duplicate scope of character-select-screen; no scene or HTTP CRUD |
| death-penalty-respawn | No DEATH_EXP_PENALTY_BPS, expToNext, PLAYER_DIED, or death overlay |
| death-penalty-town-respawn | respawnPlayer uses map.playerSpawn only; no linkedTownId or EXP penalty |
| ground-drops | LootDrop lacks kind/mesos/ownerSessionId; no owner-lock, mesos drops, or DROP_PICKUP |
| guild-depth-features | No guild bank, levels, points, skills, or quests |
| inventory-migration | No inventorySync/_invTabs; server still uses flat MapSchema<InventoryItem> |
| inventory-tabs-migration | No InventorySlot/InventoryTabs schema; flat inventory model unchanged |
| mount-system | No mounts.ts, mountId, MOUNT_TOGGLE, or getMount |
| pet-system | No pets.ts, PetDef, PET_SUMMON, or pet food; only the cash-pet label exists |
| professions-system | No professions.ts, GatherNode/Recipe, CRAFT_ITEM, or professionLevels |
| real-party-quests | PQState lacks mobs/loot; no SpawnManager/combat, puzzles, or arena maps |
| repeatable-quests-and-login-gift | No weekly repeatable kind, WEEKLY_QUESTS, DAILY_LOGIN, or loginStreak |
| skill-effects | No skillEffects.ts, SKILL_CAST client listener, or SkillFx textures |
| skill-mechanics | No SummonDef/Summon schema; skills resolve as plain damage only |
| skill-visuals | No SkillEffectSystem or skill VFX listeners/textures |
| stat-identity-and-consistency | critRate still flat; no CRIT_WEIGHTS, hpApGain, or mpApGain |
| wire-scroll-system | SCROLLS/applyScroll remain dead code; no SCROLL_APPLY, schema field, or panel |
