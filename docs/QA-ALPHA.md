# CryptoMaple — Alpha Acceptance Checklist

**Version:** 0.1.0-alpha  
**Date:** 2026-06-30  
**Status:** IN PROGRESS — server test suite currently RED (see Automated Test Results)

## Environment

| Requirement | Value |
|---|---|
| Node | ≥ 20 (pinned in `.nvmrc`) |
| pnpm | 11 |
| Database | SQLite (auto-created at `./data/maple.db`) |
| Start game | `pnpm dev` (Vite :5173, Colyseus :2567) |
| Run all tests | `pnpm -r test` |
| Typecheck | `pnpm -r typecheck` |
| Lint | `pnpm lint` |
| Build | `pnpm -r build` |

### Status legend

| Symbol | Meaning |
|---|---|
| ✅ PASS | Automated test green |
| ⚠️ FLAKY | Passes in isolation; fails intermittently under suite load (timing-dependent) |
| ❌ FAIL | Deterministic failure (real regression/bug) |
| 🔵 MANUAL | System exists and is wired, but has no automated test (manual QA only) |
| 🟡 STUB | Partial implementation; not reachable in normal play |

> Test files live in `packages/shared/tests/*.test.ts` (vitest), `packages/server/test/*.ts`
> (standalone tsx scripts), and `packages/client/src/ui/__tests__/*.test.tsx` (vitest + jsdom).
> Only **20 of the 36** server scripts are wired into `test:suite`; the rest exist but are not
> run by `pnpm -r test`. Statuses below reflect running each script directly.

## Summary

### Combat & progression

| System | Auto-tested? | Status | Known Issues |
|---|---|---|---|
| Combat formulas (hit/crit/defense/variance) | ✅ shared `combat.test.ts` | ✅ PASS | — |
| Combat (melee, MapRoom) | ✅ server `mobCombat.ts` | ⚠️ FLAKY | Mob aggro/damage timing-dependent under load |
| Combat (ranged, MapRoom) | ✅ server `rangedCombat.ts` | ✅ PASS | — |
| Skill combat / skill damage | ✅ shared `skill-combat.test.ts`, server `skillCast.ts` | ✅ PASS | Quickslot `SKILL_CAST` applies skill damage %; melee auto-attack still flat 100% |
| Elemental multipliers | ✅ shared `elemental-multiplier.test.ts` | ✅ PASS | Now wired into MapRoom via `computeDamage` (element + mob `elementMods`) |
| Status effects / buffs | ✅ shared `effects.test.ts` | ✅ PASS | — |
| Skills / SP | ✅ shared `skillbook.test.ts`, server `learnSkill.ts` | ✅ PASS | — |
| AP spend | ✅ server `spendAp.ts` | ✅ PASS | — |
| Progression / EXP | ✅ shared `progression.test.ts`, `progression-exp.test.ts`, `progression-curve-sim.test.ts`, server `progression.ts` | ✅ PASS | — |
| Classes / archetypes | ✅ shared `warrior-/mage-/archer-/thief-/pirate-archetype.test.ts`, `beginner.test.ts`, `classes-items.test.ts` | ✅ PASS | BEGINNER class is a thin stub (2 skills) |
| 2nd-job branches | ✅ shared `branch-system.test.ts` | ✅ PASS | — |
| Job advancement | ✅ shared `job-advancement-quests.test.ts`, server `jobAdvance.ts` | ✅ PASS | — |

### Items & equipment

| System | Auto-tested? | Status | Known Issues |
|---|---|---|---|
| Inventory | ✅ shared `inventory.test.ts`, client `InventoryPanel.test.tsx` | ✅ PASS | — |
| Equip / unequip | ✅ server `equip.ts`, `equipStatRejection.ts`, shared `can-equip.test.ts` | ⚠️ FLAKY | `equip.ts` weapon-damage accumulation timing-dependent; `equipStatRejection.ts` PASS |
| Equipment sets | ✅ shared `sets.test.ts` | ✅ PASS | — |
| Item catalogs (weapon/armor/accessory) | ✅ shared `weapon-catalog.test.ts`, `armor-catalog.test.ts`, `accessory-catalog.test.ts` | ✅ PASS | — |
| Stats | ✅ shared `stats.test.ts` | ✅ PASS | — |
| Bonus stats / Flame reroll | ✅ shared `bonus-stats.test.ts` | ✅ PASS | — |
| Cube reroll (potential) | ✅ shared `cube-reroll.test.ts`, server `cubeReroll.ts` | ✅ PASS | — |
| Base-rank upgrade | ✅ shared `upgrade-rank.test.ts`, server `upgradeRank.ts` | ✅ PASS | — |
| Star Force | ✅ shared `star-force.test.ts` | ✅ PASS | — |
| Drops / Rarity | ✅ shared `rarity.test.ts`, `boss-drops.test.ts` | ✅ PASS | — |
| Consumables (heal/buff) | ✅ shared `consumables.test.ts`, server `consumableUse.ts` | ❌ FAIL | `BUY_FROM_SHOP` of stackable HP potions rejected in `consumableUse.ts` |
| Scroll system (equip enhancement) | ❌ No | 🟡 STUB | `applyScroll()` exists in shared; no `APPLY_SCROLL` message, drop source, or shop slot |

### World & content

| System | Auto-tested? | Status | Known Issues |
|---|---|---|---|
| World geometry | ✅ shared `world.test.ts`, `world-integrity.test.ts` | ✅ PASS | — |
| Mobs | ✅ shared `mobs.test.ts` | ✅ PASS | — |
| NPCs / Dialog | ✅ shared `npcs-quests.test.ts`, server `npcs.ts` | ✅ PASS | — |
| Quests | ✅ shared `quest-integrity.test.ts`, server `quests.ts` | ✅ PASS | — |
| Daily quests | ✅ server `dailyQuests.ts` | ✅ PASS | — |
| Dawn Isle intro | ✅ shared `dawn-isle-intro.test.ts` | ✅ PASS | — |
| Guidance / Maple Guide | ✅ shared `guidance.test.ts` | ✅ PASS | — |
| Appearance | ✅ shared `appearance.test.ts` | ✅ PASS | — |
| Portals | ✅ server `portals.ts` | ✅ PASS | Scheduled-transport portals carry timetable metadata but MapRoom does not gate departures |
| Boss encounters | ✅ server `boss.ts` | ✅ PASS | — |
| Spawn system | ✅ server `spawnManager.ts` | ✅ PASS | Deterministic via injected jitter source |
| Party Quest | ✅ server `partyquest.ts` | ✅ PASS | `solve` puzzle objective still unevaluated |

### Economy & social

| System | Auto-tested? | Status | Known Issues |
|---|---|---|---|
| Free Market (list/browse/buy/cancel/tax) | ✅ shared `market-search.test.ts`, server `market.ts`, `market_trading.ts` | ✅ PASS | — |
| Free Market MTS extensions (buy orders, auctions, bids, price history) | ❌ No | 🔵 MANUAL | Implemented in `MarketRoom.ts`; no automated coverage |
| NPC Shops | ✅ server `generalStore.ts` | ✅ PASS | — |
| Cash Shop | ✅ shared `cashshop.test.ts`, server `cashshop.ts` | ✅ PASS | — |
| Storage / Bank | ✅ server `storageAndSinks.ts` | ✅ PASS | — |
| Trade (two-party) | ✅ server `trade.ts` | ✅ PASS | — |
| Party | ✅ server `party.ts` | ❌ FAIL | Leader disconnect leaves party at 2 members (reassign/removal bug) |
| LFG / Party Finder | ❌ No | 🔵 MANUAL | Implemented in `partyManager.ts` (`LFG_*`); no automated coverage |
| Guild | ✅ server `guild.ts` | ❌ FAIL | Guild chat mangled by profanity filter (see Known Issues #2) |
| Channels / Chat / Whisper | ✅ server `channels.ts` | ✅ PASS | — |
| Friends / Buddy list | ✅ server `friends.ts` | ❌ FAIL | Now implemented (`friendManager.ts`); whisper mangled by profanity filter (#2) |
| Codex / Fame / Achievements | ✅ shared `codex-achievements.test.ts`, server `fameDailyLimit.ts` | ✅ PASS | — |

### Companion, idle & cosmetic systems

| System | Auto-tested? | Status | Known Issues |
|---|---|---|---|
| Familiars (companion pets) | ❌ No | 🔵 MANUAL | `shared/familiars.ts`, schema `Familiar.ts`, `FAMILIAR_*` msgs; no test |
| Runes (map buff spawns) | ❌ No | 🔵 MANUAL | `runeManager.ts`, `RUNE_*` msgs; no test |
| Treasure Hunter boxes | ❌ No | 🔵 MANUAL | `treasureBoxManager.ts`, `TREASURE_*` msgs; no test |
| Titles | ❌ No | 🔵 MANUAL | `TITLE_EQUIP`/`TITLE_SYNC` handled in MapRoom; no test |
| Exploration Dispatch (idle collection) | ❌ No | 🔵 MANUAL | `EXPLORATION_*` handled in MapRoom; no test |
| Bonus Hunting (rotating daily map) | ❌ No | 🔵 MANUAL | `BONUS_HUNT_SYNC` via `questEngine.ts`; no dedicated test |
| World-map quick-travel | ❌ No | 🔵 MANUAL | `MAP_TRAVEL` handled in MapRoom; no test |

### Infrastructure & ops

| System | Auto-tested? | Status | Known Issues |
|---|---|---|---|
| Characters (create/delete/list) | ✅ server `characters.ts` | ✅ PASS | — |
| DB migration | ✅ server `dbMigration.ts` | ✅ PASS | — |
| DB persistence | ✅ server `dbStore.ts` | ✅ PASS | — |
| Input hardening / validation | ✅ server `hardenedInputs.ts` | ✅ PASS | — |
| GM / Admin commands | ✅ server `gmCommands.ts` | ✅ PASS | — |
| Smoke (full loop, all zones) | ✅ server `smoke.ts` | ⚠️ FLAKY | Mob-kill reward assertion timing-dependent under suite load |
| Moderation (report/block/announce) | ❌ No | 🔵 MANUAL | `PLAYER_REPORT`/`BLOCK_PLAYER`/`SERVER_ANNOUNCEMENT`; no dedicated test |
| Settings sync | ❌ No | 🔵 MANUAL | `SETTINGS_SYNC`; no dedicated test |

## Automated Test Results

Captured from a fresh `pnpm -r test` (2026-06-30):

```
packages/shared:  42 files, 3347 tests — ALL PASS (vitest)
packages/client:  1 file, 8 tests — PASS (vitest + jsdom; act() warnings only)
packages/server:  test:suite runs 20 of 36 tsx scripts — FAILS (exit 1)

  `pnpm -r test` aborts in the server package. The suite bails at the first
  failing script, which varies run-to-run because several combat/timing tests
  are FLAKY (pass alone, fail under load): smoke.ts, equip.ts, mobCombat.ts.

  Running every server script directly reveals 7 reds:
    ⚠️ FLAKY        smoke.ts, equip.ts, mobCombat.ts
    ❌ FAIL (det.)  consumableUse.ts, party.ts, friends.ts, guild.ts
  The other 29 server scripts pass.
```

> `pnpm -r test` is RED until the flaky combat tests are stabilized and the four
> deterministic failures are fixed. Shared and client suites are green.

---

## Core Loop Playtest

The full alpha loop: create account → Dawn Isle tutorial → class → grind → 2nd job → PQ → boss → market → shops → storage → social/idle systems.

### 1. Account & Character

- [ ] **Create account** — new account gets default mesos + empty inventory
- [ ] **Create character** — select archetype, customize appearance (skin/hair/face/outfit)
- [ ] **Name uniqueness** — duplicate names rejected with error
- [ ] **Delete character** — removes from DB, frees name
- [ ] **Multiple characters** — same account can have up to 6 characters
- [ ] *Automated:* `characters.ts`

### 2. Dawn Isle Tutorial

- [ ] **Spawn on Dawn Isle** — player starts at map spawn point
- [ ] **Talk to Guide Iris** — dialog tree with choices renders correctly
- [ ] **Accept quest "Pest Control"** — quest_offer → QUEST_ACCEPT → quest is active
- [ ] **Kill 5 friendly snails** — quest progress tracks 0→5/5
- [ ] **Complete quest** — turn-in via NPC talk, rewards granted (mesos + exp)
- [ ] **Navigate to Ferrymaster Cole** — walk to ferry portal on Dawn Isle
- [ ] **Take ferry to Heartland Harbor** — portal/transition to new map
- [ ] *Automated:* `quests.ts`, `npcs.ts`, `smoke.ts`, shared `dawn-isle-intro.test.ts`

### 3. 1st Job Advancement

- [ ] **Meet class instructor NPC** — dialog tree for advancement
- [ ] **Accept advancement quest** — quest_offer flow
- [ ] **Complete advancement objectives** — kill/collect/talk as required
- [ ] **Choose class** (Warrior/Mage/Archer/Thief/Pirate) — BEGINNER → Tier 1
- [ ] **Stats redistribute** — primary stat changes, new skills unlocked
- [ ] **Equip class weapon** — weapon type requirement enforced
- [ ] *Automated:* `jobAdvance.ts`, shared `job-advancement-quests.test.ts`, `beginner.test.ts`

### 4. Heartland Towns & Travel

- [ ] **Town hubs** — Heartland Harbor, Meadowfield, Sylvanreach, Craghold, Dusk Ward populated with mobs/NPCs/shops
- [ ] **Portal navigation** — walk into portal → map change → correct spawn
- [ ] **Level-gated portals** — portal requires minimum level
- [ ] **World-map quick-travel** — `MAP_TRAVEL` jumps to an unlocked node
- [ ] *Automated:* `portals.ts`, shared `world.test.ts`, `world-integrity.test.ts`

### 5. Grinding & Leveling (~Lv 30)

- [ ] **EXP curve** — fast (1–9), moderate (10–29), slow (30+)
- [ ] **Level-up grants AP/SP** — auto-assign or manual spend
- [ ] **HP/MP growth per level** — class-dependent scaling
- [ ] **Multi-level-up** — killing high-EXP mob skips levels
- [ ] **AP spend** — STR/DEX/INT/LUK/HP/MP allocation
- [ ] **SP spend** — skill learning with prerequisites and tier gating
- [ ] *Automated:* `progression.ts`, `spendAp.ts`, `learnSkill.ts`

### 6. 2nd Job Branch Advancement

- [ ] **Tier 2 branch quest** — available at correct level
- [ ] **Choose branch** (e.g., Warrior → Berserker/Guardian/Warlord)
- [ ] **Branch skills unlock** — new skill tier becomes available
- [ ] **Branch-specific stat bonuses** — different primary scaling
- [ ] *Automated:* `jobAdvance.ts`, shared `branch-system.test.ts`

### 7. Combat Systems

- [ ] **Melee attack (Z)** — attack animation, damage numbers, cooldown
- [ ] **Hit/miss** — accuracy vs avoidance formula
- [ ] **Critical hits** — base crit rate + multiplier
- [ ] **Defense mitigation** — `(def × 4) / (attacker_level + 2)`
- [ ] **Damage variance** — floor to ceil of base power
- [ ] **Ranged attacks** — arrow/bullet arc, multi-hit, range limits
- [ ] **Magic attacks** — AoE damage, MP cost, multi-target
- [ ] **Skill casting** — quickslot skill use, skill damage %, cooldown tracking
- [ ] **Elemental damage** — fire/ice/lightning/poison/dark multipliers applied server-side via `computeDamage`
- [ ] **Buff/debuff effects** — duration, tick rate, stat aggregation
- [ ] *Automated:* `mobCombat.ts` (⚠️ flaky), `rangedCombat.ts`, `skillCast.ts`, shared `combat.test.ts`, `effects.test.ts`, `elemental-multiplier.test.ts`

### 8. Mobs & Drops

- [ ] **Mob AI** — idle → wander → aggro → chase → attack cycle
- [ ] **Mob respawn** — zone capacity caps, staggered timers
- [ ] **Meso drops** — rollMesos per mob definition
- [ ] **Item drops** — per-entry chance roll, potential tier roll
- [ ] **Drop rarity** — RARE/EPIC/UNIQUE/LEGENDARY tiers
- [ ] **Loot pickup** — PICKUP / PICKUP_ALL, full-inventory rejection
- [ ] **Loot despawn** — timed ground items expire
- [ ] *Automated:* shared `mobs.test.ts`, `boss-drops.test.ts`, `rarity.test.ts`

### 9. Party Quest

- [ ] **Enter PQ** — NPC dialog action `enterPQ`
- [ ] **PQ room creation** — instanced room with timer
- [ ] **Multi-stage objectives** — kill-count, collect, reach-portal
- [ ] **Stage progression** — completing objective advances stage
- [ ] **Timer enforcement** — PQ fails on timeout
- [ ] **PQ rewards** — mesos, exp, items on success
- [ ] *Automated:* `partyquest.ts`

### 10. Field Boss

- [ ] **Boss spawn** — timed interval respawn
- [ ] **Boss HP bar** — broadcast boss_hp to clients
- [ ] **Multi-phase attacks** — phase transitions at HP thresholds
- [ ] **Summon adds** — boss spawns additional mobs
- [ ] **Damage ownership** — loot goes to highest damage dealer
- [ ] **Boss loot** — minPotentialTier guaranteed, legendaryEligible flag
- [ ] **Boss death broadcast** — boss_death message to all clients
- [ ] *Automated:* `boss.ts`

### 11. Free Market & MTS Extensions

- [ ] **Store Permit required** — list blocked without permit
- [ ] **List item (fixed price)** — escrow from inventory, create listing
- [ ] **List item (auction)** — `listingType: "auction"` with expiry
- [ ] **Browse/search** — filter by slot/level/tier/price/query
- [ ] **Buy listing** — mesos deducted, item transferred, fee taken
- [ ] **Place bid** — `MARKET_BID` raises current bid on an auction
- [ ] **Place buy order** — `MARKET_PLACE_BUY_ORDER`, matched against sellers
- [ ] **Browse buy orders** — `MARKET_BROWSE_BUY_ORDERS`
- [ ] **Price history** — `MARKET_PRICE_HISTORY` returns recent sale prices
- [ ] **Auction settle on expiry** — highest bidder wins, seller paid
- [ ] **Cancel listing / buy order** — escrow returned
- [ ] **Fee system** — tax burned to treasury
- [ ] *Automated:* `market.ts`, `market_trading.ts`, shared `market-search.test.ts` (MTS extensions: manual only)

### 12. NPC Shops

- [ ] **Buy from shop** — mesos deducted, item added to inventory
- [ ] **Buy stackable** — quantity > 1 (⚠️ currently failing for HP potions)
- [ ] **Sell to shop** — item removed, mesos credited at sell price
- [ ] **Insufficient mesos / full inventory** — buy rejected
- [ ] *Automated:* `generalStore.ts`, `consumableUse.ts` (❌ failing)

### 13. Storage / Bank

- [ ] **Deposit / withdraw item** — moves between inventory and shared storage
- [ ] **Cross-character access** — char A deposits, char B withdraws
- [ ] **Storage capacity** — full storage rejection
- [ ] *Automated:* `storageAndSinks.ts`

### 14. Trading

- [ ] **Invite / Accept / Reject** — two nearby players
- [ ] **Offer items/mesos** — both sides add to offer
- [ ] **Lock → Confirm** — both confirm → items + mesos swap
- [ ] **Cancel** — either side can cancel before confirm
- [ ] *Automated:* `trade.ts`

### 15. Chat & Channels

- [ ] **Say chat** — broadcast to room players
- [ ] **Whisper** — `WHISPER` to a specific player by name
- [ ] **Party / Guild chat** — scoped relays
- [ ] **Channel list / switch** — multiple channels per map, `CHANNEL_SWITCH`
- [ ] **Profanity filter** — blocked words masked (⚠️ over-masks; see Known Issues #2)
- [ ] **Rate limiting** — chat flood protection
- [ ] *Automated:* `channels.ts`

### 16. Party & LFG

- [ ] **Invite / accept** — form a party
- [ ] **Party display** — member list with leader flag
- [ ] **Leave / kick** — member removal, leader reassignment (❌ currently buggy on leader disconnect)
- [ ] **Loot rule** — `PARTY_SET_LOOT_RULE` (ffa / roundRobin / leader)
- [ ] **EXP sharing** — nearby members get bonus split
- [ ] **Max members** — 6-player cap
- [ ] **LFG post / list / join** — Party Finder listings (`LFG_*`), expire after timeout
- [ ] *Automated:* `party.ts` (❌ failing); LFG manual only

### 17. Guild

- [ ] **Create guild** — name + emblem, costs mesos
- [ ] **Invite / accept** — persistent membership
- [ ] **Leave / kick / disband** — roster management
- [ ] **Ranks** — master/officer/member permissions
- [ ] **Guild chat** — cross-room relay (❌ mangled by profanity filter)
- [ ] **Persistence** — survives server restart via SQLite
- [ ] *Automated:* `guild.ts` (❌ failing)

### 18. Friends / Buddy List

- [ ] **Add friend** — `FRIEND_ADD` by name
- [ ] **Remove friend** — `FRIEND_REMOVE`, both sides updated
- [ ] **Friend list** — `FRIEND_LIST` snapshot
- [ ] **Online status** — `ONLINE_STATUS` push on login/logout
- [ ] **Whisper a friend** — (❌ text mangled by profanity filter)
- [ ] *Automated:* `friends.ts` (❌ failing)

### 19. Equipment Enhancement

- [ ] **Cube reroll** — potential re-roll (gacha), costs mesos
- [ ] **Base rank upgrade** — NORMAL→ENHANCED→STARFORGED→MYTHIC
- [ ] **Star Force** — per-star enhancement with public odds, boom risk
- [ ] **Flame reroll** — bonus-stat reroll
- [ ] **Repair** — durability/mesos sink (`REPAIR_EQUIPMENT`)
- [ ] *Automated:* `cubeReroll.ts`, `upgradeRank.ts`, shared `star-force.test.ts`, `bonus-stats.test.ts`

### 20. Cash Shop

- [ ] **Buy cash item** — deducts cash currency
- [ ] **Equip cosmetic** — overrides appearance (hair/face/outfit/weapon-skin)
- [ ] **Duration expiry** — timed items removed after days
- [ ] *Automated:* `cashshop.ts`, shared `cashshop.test.ts`

### 21. Retention Systems

- [ ] **Monster Codex** — kill count per mob type, milestone thresholds
- [ ] **Fame** — give/receive, daily limit, fame gates
- [ ] **Achievements** — condition tracking + unlock toasts
- [ ] **Daily quests** — rotating daily objectives
- [ ] **Maple Guide / Guidance** — guided next-step suggestions, guide-travel
- [ ] **Bonus Hunting** — rotating daily bonus map
- [ ] *Automated:* `codex-achievements.test.ts`, `fameDailyLimit.ts`, `dailyQuests.ts`, shared `guidance.test.ts`

### 22. Familiars, Runes & Treasure

- [ ] **Familiar card drop** — `FAMILIAR_CARD_DROP` from mobs
- [ ] **Summon / dismiss familiar** — `FAMILIAR_SUMMON` / `FAMILIAR_DISMISS`, follows player
- [ ] **Rune spawn / activate** — `RUNE_SPAWN` on map, `RUNE_ACTIVATE` grants buff, despawns
- [ ] **Treasure box** — `TREASURE_SPAWN`, `TREASURE_HIT` to break, `TREASURE_DESTROY` drops loot
- [ ] *Automated:* none — manual QA only

### 23. Titles & Exploration

- [ ] **Equip title** — `TITLE_EQUIP` shows title above character; unequip with empty string
- [ ] **Title sync** — `TITLE_SYNC` lists owned + equipped on login
- [ ] **Exploration dispatch** — `EXPLORATION_START` sends idle collection run
- [ ] **Exploration claim** — `EXPLORATION_CLAIM` grants rewards after timer; `EXPLORATION_SYNC` shows state
- [ ] *Automated:* none — manual QA only

### 24. Save / Reconnect

- [ ] **Position persistence** — x/y saved on room leave
- [ ] **Inventory / equipment persistence** — survive server restart
- [ ] **Quest / skill state persistence** — active/completed quests and learned skills saved
- [ ] **Rejoin continuity** — same character, same state
- [ ] *Automated:* `characters.ts`, `dbStore.ts`, `dbMigration.ts`

---

## Pre-Existing Known Issues

1. **Server test suite is RED / flaky** — `pnpm -r test` aborts in the server package. `smoke.ts`, `equip.ts`, and `mobCombat.ts` pass in isolation but fail intermittently under suite load (combat/timing-dependent). The suite bails at whichever flaky test loses the race, so the failure point varies run-to-run.
2. **Profanity filter over-masks** — `filterProfanity()` in `shared/profanity.ts` uses substring matching (not word-boundary), so "Hello" → "****o" (matches "hell"). This deterministically breaks whisper (`friends.ts`) and guild chat (`guild.ts`) tests. Real bug: respect word boundaries before public release.
3. **Consumable shop purchase rejected** — buying stackable HP potions via `BUY_FROM_SHOP` (qty 3) fails in `consumableUse.ts`. Deterministic regression in the shop buy path for stackables.
4. **Party leader reassignment** — when the leader disconnects, the party still reports 2 members instead of removing the leaver and reassigning leadership (`party.ts`).
5. **Skill damage in melee auto-attack** — MapRoom `tryAttack` hardcodes `skillDamagePercent: 100` for auto-attacks; dedicated `SKILL_CAST` now applies skill-specific damage %.
6. **Scroll system STUB** — `applyScroll()` / `ScrollDef` exist in shared but there is no `APPLY_SCROLL` message, drop source, or shop slot, so equipment scrolling is unreachable in play.
7. **Untested-but-wired systems** — Familiars, Runes, Treasure boxes, Titles, Exploration dispatch, LFG/Party Finder, Free Market MTS extensions (buy orders/auctions/bids/price history), Bonus Hunting, Moderation, and Settings sync have no automated coverage.
8. **Scheduled transport not gated** — airship/boat portals carry `schedule` timetable metadata in `world.ts`, but MapRoom does not enforce departure windows (always traversable).
9. **PQ puzzle solver** — `solve` objective type defined but `PartyQuestRoom` doesn't evaluate puzzle solving.
10. **TownRoom is legacy** — `MapRoom` supersedes it for all features.
11. **BEGINNER class stub** — only 2 skills, minimal combat stats.
