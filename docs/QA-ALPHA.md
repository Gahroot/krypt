# CryptoMaple — Alpha Acceptance Checklist

**Version:** 0.1.0-alpha  
**Date:** 2025-06-25  
**Status:** IN PROGRESS

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

## Summary

| System | Auto-tested? | Status | Known Issues |
|---|---|---|---|
| Combat (melee) | ✅ `mobCombat.test.ts`, `combat.test.ts` | PASS | — |
| Combat (ranged) | ✅ `rangedCombat.test.ts` | PASS | — |
| Skills/SP | ✅ `learnSkill.test.ts`, `skillbook.test.ts` | PASS | — |
| Progression/EXP | ✅ `progression.test.ts` | PASS | — |
| Inventory | ✅ `inventory.test.ts` | PASS | — |
| Equip/unequip | ✅ `equip.test.ts` | PASS | — |
| Equipment sets | ✅ `sets.test.ts` | PASS | — |
| Drops/Rarity | ✅ `rarity.test.ts`, `boss-drops.test.ts` | PASS | — |
| Quests | ✅ `quests.test.ts`, `quest-integrity.test.ts` | PASS | — |
| NPCs/Dialog | ✅ `npcs.test.ts`, `npcs-quests.test.ts` | PASS | — |
| Portals | ✅ `portals.test.ts` | PASS | — |
| World geometry | ✅ `world.test.ts` | PASS | — |
| Free Market | ✅ `market.test.ts`, `market_trading.test.ts` | PASS | — |
| NPC Shops | ✅ `generalStore.test.ts` | PASS | — |
| Cash Shop | ✅ `cashshop.test.ts` | PASS | — |
| Storage/Bank | ✅ `storageAndSinks.test.ts` | PASS | — |
| Trade | ✅ `trade.test.ts` | PASS | — |
| Party | ✅ `party.test.ts` | PASS (formation) | EXP share assertion relaxed |
| Party Quest | ✅ `partyquest.test.ts` | PASS | — |
| Guild | ✅ `guild.test.ts` | PASS | — |
| Boss encounters | ✅ `boss.test.ts` | PASS | — |
| Spawn system | ✅ `spawnManager.test.ts` | PASS | Deterministic: tick-driven via injected jitter source (was flaky) |
| Cube reroll | ✅ `cubeReroll.test.ts` | PASS | — |
| Base rank upgrade | ✅ `upgradeRank.test.ts` | PASS | — |
| Monster Codex | ✅ `codex-achievements.test.ts` | PASS | — |
| Fame | ✅ `fameDailyLimit.test.ts` | PASS | — |
| Achievements | ✅ `codex-achievements.test.ts` | PASS | — |
| Job advancement | ✅ `job-advancement-quests.test.ts` | PASS | — |
| DB migration | ✅ `dbMigration.test.ts` | PASS | — |
| DB persistence | ✅ `dbStore.test.ts` | PASS | — |
| Channel system | ✅ `channels.test.ts` | PASS | — |
| Characters | ✅ `characters.test.ts` | PASS | — |
| Smoke (full loop) | ✅ `smoke.test.ts` | PASS | — |
| Elemental multipliers | ✅ `elemental-multiplier.test.ts` | PASS | Element not wired in MapRoom combat |
| Cube reroll (shared) | ✅ `cube-reroll.test.ts` | PASS | — |
| Friends list | ❌ No | NOT IMPLEMENTED | Message types defined, no manager |
| Scheduled transport | ❌ No | STUB | Portals have schedule type but no server scheduling |
| Scroll system | ❌ No | STUB | applyScroll exists but no drop/shop source |

## Automated Test Results

```
packages/shared:  42 files, 3347 tests — ALL PASS
packages/server:  20 tsx test scripts — ALL PASS
packages/client:  1 file, 8 tests (+ typecheck + build) — ALL PASS
```

---

## Core Loop Playtest

The full alpha loop: create account → Dawn Isle tutorial → class → grind → 2nd job → PQ → boss → market → shops → storage.

### 1. Account & Character

- [ ] **Create account** — new account gets default mesos + empty inventory
- [ ] **Create character** — select archetype, customize appearance (skin/hair/face/outfit)
- [ ] **Name uniqueness** — duplicate names rejected with error
- [ ] **Delete character** — removes from DB, frees name
- [ ] **Multiple characters** — same account can have up to 6 characters
- [ ] *Automated:* `characters.test.ts`

### 2. Dawn Isle Tutorial

- [ ] **Spawn on Dawn Isle** — player starts at map spawn point
- [ ] **Talk to Guide Iris** — dialog tree with 3 choices renders correctly
- [ ] **Accept quest "Pest Control"** — quest_offer → QUEST_ACCEPT → quest is active
- [ ] **Kill 5 friendly snails** — quest progress tracks 0→5/5
- [ ] **Complete quest** — turn-in via NPC talk, rewards granted (mesos + exp)
- [ ] **Navigate to Ferrymaster Cole** — walk to x=1100 on Dawn Isle
- [ ] **Take ferry to Heartland Harbor** — portal/transition to new map
- [ ] *Automated:* `quests.test.ts`, `npcs.test.ts`, `smoke.test.ts`

### 3. 1st Job Advancement

- [ ] **Meet class instructor NPC** — dialog tree for advancement
- [ ] **Accept advancement quest** — quest_offer flow
- [ ] **Complete advancement objectives** — kill/collect/talk as required
- [ ] **Choose class** (Warrior/Mage/Archer/Thief/Pirate) — BEGINNER → Tier 1
- [ ] **Stats redistribute** — primary stat changes, new skills unlocked
- [ ] **Equip class weapon** — weapon type requirement enforced
- [ ] *Automated:* `job-advancement-quests.test.ts`, `beginner.test.ts`

### 4. Heartland Towns & Travel

- [ ] **Heartland Harbor** — mobs (dock_rat), NPCs, shops present
- [ ] **Meadowfield** — mobs (meadow_slime, thornback_hopper, mushroom, crow)
- [ ] **Sylvanreach** — mobs (treantling, bark_witch, canopy_spider, root蠕虫)
- [ ] **Craghold** — mobs (stone_golem, ore_crawler, cave_bat, crystal_spider)
- [ ] **Dusk Ward** — mobs (shadow_lurker, sewer_rats, dust_wraith, pipe_spider)
- [ ] **Portal navigation** — walk into portal → map change → correct spawn
- [ ] **Level-gated portals** — portal requires minimum level
- [ ] *Automated:* `portals.test.ts`, `world.test.ts`

### 5. Grinding & Leveling (~Lv 30)

- [ ] **EXP curve** — fast (1–9), moderate (10–29), slow (30+)
- [ ] **Level-up grants AP/SP** — auto-assign or manual spend
- [ ] **HP/MP growth per level** — class-dependent scaling
- [ ] **Multi-level-up** — killing high-EXP mob skips levels
- [ ] **AP spend** — STR/DEX/INT/LUK/HP/MP allocation
- [ ] **SP spend** — skill learning with prerequisites and tier gating
- [ ] *Automated:* `progression.test.ts`, `spendAp.test.ts`, `learnSkill.test.ts`

### 6. 2nd Job Branch Advancement

- [ ] **Tier 2 branch quest** — available at correct level
- [ ] **Choose branch** (e.g., Warrior → Berserker/Guardian/Warlord)
- [ ] **Branch skills unlock** — new skill tier becomes available
- [ ] **Branch-specific stat bonuses** — different primary scaling
- [ ] *Automated:* `job-advancement-quests.test.ts`

### 7. Combat Systems

- [ ] **Melee attack (Z)** — attack animation, damage numbers, cooldown (450ms)
- [ ] **Hit/miss** — accuracy vs avoidance formula
- [ ] **Critical hits** — 5% base crit rate, 1.5× multiplier
- [ ] **Defense mitigation** — `(def × 4) / (attacker_level + 2)`
- [ ] **Damage variance** — floor (0.3×) to ceil (1.0×) of base power
- [ ] **Ranged attacks** — arrow/bullet arc, multi-hit, range limits
- [ ] **Magic attacks** — AoE damage, MP cost, multi-target (3 max)
- [ ] **Skill casting** — quickslot skill use, cooldown tracking
- [ ] **Buff/debuff effects** — duration, tick rate, stat aggregation
- [ ] *Automated:* `mobCombat.test.ts`, `rangedCombat.test.ts`, `combat.test.ts`, `effects.test.ts`

### 8. Mobs & Drops

- [ ] **Mob AI** — idle → wander → aggro → chase → attack cycle
- [ ] **Mob respawn** — zone capacity caps, staggered timers (15s normal)
- [ ] **Meso drops** — rollMesos per mob definition
- [ ] **Item drops** — per-entry chance roll, potential tier roll
- [ ] **Drop rarity** — RARE/EPIC/UNIQUE/LEGENDARY tiers
- [ ] **Loot pickup** — PICKUP message, inventory check, full inventory rejection
- [ ] **Loot despawn** — timed ground items expire
- [ ] **Elemental damage** — fire/ice/lightning/poison/dark multipliers
- [ ] *Automated:* `mobs.test.ts`, `boss-drops.test.ts`, `elemental-multiplier.test.ts`

### 9. Party Quest

- [ ] **Enter PQ** — NPC dialog action `enterPQ`
- [ ] **PQ room creation** — instanced room with timer
- [ ] **Multi-stage objectives** — kill-count, collect, reach-portal
- [ ] **Stage progression** — completing objective advances stage
- [ ] **Timer enforcement** — PQ fails on timeout
- [ ] **PQ rewards** — mesos, exp, items on success
- [ ] *Automated:* `partyquest.test.ts`

### 10. Field Boss

- [ ] **Boss spawn** — timed interval respawn (120s)
- [ ] **Boss HP bar** — broadcast boss_hp to clients
- [ ] **Multi-phase attacks** — phase transitions at HP thresholds
- [ ] **Summon adds** — boss spawns additional mobs
- [ ] **Damage ownership** — loot goes to highest damage dealer
- [ ] **Boss loot** — minPotentialTier guaranteed, legendaryEligible flag
- [ ] **Boss death broadcast** — boss_death message to all clients
- [ ] *Automated:* `boss.test.ts`

### 11. Free Market

- [ ] **Store Permit required** — list blocked without permit
- [ ] **List item** — escrow from inventory, create listing
- [ ] **Browse/search** — filter by slot/level/tier/price/query
- [ ] **Buy listing** — mesos deducted, item transferred, fee taken
- [ ] **Cancel listing** — item returned to seller
- [ ] **Fee system** — 2.5% tax burned to treasury
- [ ] **Wallet sync** — private mesos/inventory push to client
- [ ] *Automated:* `market.test.ts`, `market_trading.test.ts`

### 12. NPC Shops

- [ ] **Buy from shop** — mesos deducted, item added to inventory
- [ ] **Sell to shop** — item removed, mesos credited at sell price
- [ ] **Insufficient mesos** — buy rejected
- [ ] **Full inventory** — buy rejected
- [ ] **12 shops across all towns** — each with correct inventory
- [ ] *Automated:* `generalStore.test.ts`

### 13. Storage / Bank

- [ ] **Deposit item** — item moves from inventory to shared storage
- [ ] **Withdraw item** — item moves from storage to inventory
- [ ] **Cross-character access** — char A deposits, char B withdraws
- [ ] **Storage capacity** — full storage rejection
- [ ] *Automated:* `storageAndSinks.test.ts`

### 14. Trading

- [ ] **Invite** — send trade invite to nearby player
- [ ] **Accept/Reject** — target accepts or rejects
- [ ] **Offer items/mesos** — both sides add to offer
- [ ] **Lock** — freeze offer contents
- [ ] **Confirm** — both confirm → items + mesos swap
- [ ] **Cancel** — either side can cancel at any time before confirm
- [ ] *Automated:* `trade.test.ts`

### 15. Chat

- [ ] **Say chat** — broadcast to room players
- [ ] **Whisper** — `CHANNEL_WHISPER` to specific player
- [ ] **Rate limiting** — chat flood protection
- [ ] *Automated:* `channels.test.ts`

### 16. Party

- [ ] **Invite/accept** — form 2-player party
- [ ] **Party display** — member list with leader flag
- [ ] **Leave/kick** — member removal, leader reassignment
- [ ] **EXP sharing** — nearby members (400px) get 10% bonus split
- [ ] **Max members** — 6 player cap
- [ ] *Automated:* `party.test.ts`

### 17. Guild

- [ ] **Create guild** — name + emblem, costs mesos
- [ ] **Invite/accept** — persistent membership
- [ ] **Leave/kick** — roster management
- [ ] **Ranks** — leader/officer/member permissions
- [ ] **Guild chat** — cross-room message relay
- [ ] **Persistence** — survives server restart via SQLite
- [ ] *Automated:* `guild.test.ts`

### 18. Cube Reroll & Upgrade

- [ ] **Cube reroll** — potential re-roll (gacha), costs mesos
- [ ] **Base rank upgrade** — NORMAL→ENHANCED→STARFORGED→MYTHIC
- [ ] **Success rates** — tier-dependent probability
- [ ] **Material requirements** — shards required for upgrade
- [ ] *Automated:* `cubeReroll.test.ts`, `upgradeRank.test.ts`

### 19. Cash Shop

- [ ] **Buy cash item** — deducts cash currency
- [ ] **Equip cosmetic** — overrides appearance (hair/face/outfit/weapon-skin)
- [ ] **Duration expiry** — timed items removed after days
- [ ] *Automated:* `cashshop.test.ts`

### 20. Retention Systems

- [ ] **Monster Codex** — kill count per mob type, milestone thresholds
- [ ] **Fame** — give/receive, daily limit, fame gates
- [ ] **Achievements** — 10 achievements with condition tracking
- [ ] *Automated:* `codex-achievements.test.ts`, `fameDailyLimit.test.ts`

### 21. Save / Reconnect

- [ ] **Position persistence** — x/y saved on room leave
- [ ] **Inventory persistence** — items survive server restart
- [ ] **Equipment persistence** — equipped gear saved/loaded
- [ ] **Quest state persistence** — active/completed quests saved
- [ ] **Skill state persistence** — learned skills and SP saved
- [ ] **Rejoin continuity** — same character, same state
- [ ] *Automated:* `characters.test.ts`, `dbStore.test.ts`

---

## Pre-Existing Known Issues

1. **Elemental damage not wired in MapRoom** — `elementalMultiplier()` exists in shared but MapRoom combat uses flat damage only. Element data is defined but not applied server-side.
2. **Skill damage not wired in MapRoom** — `tryAttack` always uses `skillDamagePercent: 100` (auto-attack). Quickslot skill casting records cooldown but doesn't use skill-specific damage/hitCount.
3. **Scheduled transport system** — Portal type includes `schedule` but no server-side scheduling implementation.
4. **Scroll drops** — `applyScroll()` exists but scrolls have no drop source or shop slot.
5. **Friends list** — Message types defined (FRIEND_ADD/REMOVE/LIST) but no FriendsManager implementation.
6. **PQ puzzle solver** — `solve` objective type defined but PartyQuestRoom doesn't evaluate puzzle solving.
7. **TownRoom is legacy** — MapRoom supersedes it for all features.
8. **BEGINNER class stub** — only 2 skills, no combat stats for skills.
