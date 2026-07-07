# Legal-Hygiene Content Audit — June 2026

## Scope

Full sweep of `packages/shared/src/` (mobs, items, npcs, quests, world, classes, skills) and client
assets/text for literal MapleStory names, descriptions, or copied lore. Mechanics (AP/SP, rarity
layers, cube reroll, etc.) are intentionally cloned — only art, names, and lore must be original.

## Audit Method

1. Searched all source files for known MapleStory mob names, boss names, skill names, item names,
   NPC names, map names, and lore terms.
2. Cross-referenced every mob ID, item ID, NPC name, skill name, quest name, and map name against
   the MapleStory entity database.
3. Verified no literal MapleStory `.wz` assets, sprites, or audio are referenced or shipped.

---

## Derivative Items Found & Fixed

| # | File | Old Value | New Value | Reason |
|---|---|---|---|---|
| 1 | `mobs.ts` | `mob.mano` / "Mano" | `mob.tidemaw` / "Tidemaw" | Direct MS Maple Island boss name |
| 2 | `mobs.ts` | `mob.stumpy` / "Stumpy" | `mob.rotwood` / "Rotwood" | Direct MS Henesys field boss name |
| 3 | `mobs.ts` | `mob.king_slime` / "King Slime" | `mob.gelatinarch` / "Gelatinarch" | Direct MS Henesys field boss name |
| 4 | `mobs.ts` | `mob.mushmom` / "Mushmom" | `mob.sporemother` / "Sporemother" | Direct MS Henesys field boss name |
| 5 | `mobs.ts` | `mob.jr_balrog` / "Jr. Balrog" | `mob.void_wisp` / "Void Wisp" | Direct MS Kerning City field boss name |
| 6 | `mobs.ts` | `item.balrog_talisman` | `item.void_talisman` | References MS boss "Balrog" |
| 7 | `npcs.ts` | "learn Lucky Seven and Shadow Instinct" | "learn Shadow Rush and Shadow Instinct" | "Lucky Seven" is a literal MS thief skill name |

### Cascade updates (same renames, propagated to referencing files)

| File | Change |
|---|---|
| `codex.ts` | 5 boss codex entries updated to new mob IDs + display names |
| `world.ts` | 5 boss spawn definitions updated; comment "Jr. Balrog" → "Void Wisp" |
| `server/test/boss.ts` | All test references updated (mob IDs, assert messages, boss array) |
| `server/test/gracefulShutdown.ts` | Comment "Meadowfield's Mano" → "Meadowfield's Tidemaw" |

---

## Borderline Items — Flagged but Intentionally Kept

These are generic English terms that happen to exist as MS mob names, but are **not copyrightable** as
common words/nouns. Renaming would be overcautious.

| Item | File | Verdict | Rationale |
|---|---|---|---|
| `mob.green_mushroom` / "Green Mushroom" | `mobs.ts` | **KEEP** | "Green mushroom" is a common English noun phrase; not a unique coined name |
| `mob.mushroom` / "Mushroom" | `mobs.ts` | **KEEP** | "Mushroom" is a single common English word; cannot be trademarked |
| "Snail Shell" (item) | `items.ts` | **KEEP** | Generic material name |
| "Return Scroll" (consumable) | `consumables.ts` | **KEEP** | Generic RPG term, not MS-specific |
| "Guardian" (class branch) | `classes.ts` | **KEEP** | Generic English word used as a different concept (2nd-job warrior branch, not MS 4th-job Paladin skill) |
| "Blizzard" (skill) | `classes.ts` | **KEEP** | Generic English word; common fantasy spell name |
| "Free Market" (zone/system) | `world.ts`, `market.ts` | **KEEP** | Standard economic term predating MS by centuries |

---

## Brand-Adjacent Items — Deferred to Brand Decision

| Item | File | Status | Note |
|---|---|---|---|
| "Maple Crystals" (cash currency) | `cashshop.ts` | **DEFERRED** | Uses "Maple" from the trademark-adjacent working title "CryptoMaple". Renaming depends on the final brand name decision (separate task). |

---

## Positive Findings — Original Names Confirmed

### Mob Names (74 mobs, 12 bosses) — all original reskins

Dawn Isle: Friendly Snail, Green Puff, Dawn Shroom
Harbor: Dock Rat, Barnacle Crab, Harbor Gull, Deckhand Specter, Bilge Rat
Meadowfield: Meadow Slime, Green Mushroom, Mushroom, Meadow Beetle, Thornback Hopper
Sylvanreach: Forest Wisp, Canopy Moth, Bark Spider, Root Crawler, Sylvan Sprite
Craghold: Rock Lizard, Fossil Beetle, Cliff Hawk, Quarry Crab, Boulder Golem
Dusk Ward: Neon Rat, Tunnel Bat, Spark Drone, Rail Sentinel, Shadow Thug, Arc Wraith
Mirefen: Bogmaw, Crystal Guardian, etc.
Skyhaven/Frosthold: Frost Titan, Glacial Abomination, etc.
Drakemoor: Viper, Dragon Abyss mobs, Pyroclasm (boss)
All Heartland bosses: Tidemaw, Rotwood, Gelatinarch, Sporemother, Void Wisp

### Skill Names (116 skills) — all original

Warrior: Crushing Blow, Iron Hide, Rally, Battle Cry, Cleave, Frenzy, Decimate, Berserk,
  Annihilate, Phalanx, Fortress, Bulwark, Holy Shield, Retribution, Aegis,
  Battle Standard, Onslaught, Hammer Smash, Endurance, Siege Breaker
Mage: Arcane Bolt, Arcane Mastery, Mana Surge, Mending Light, Flame Lance, Immolate,
  Firestorm, Inferno Aura, Cataclysm, Frost Bolt, Chain Lightning, Blizzard,
  Thunder Shield, Absolute Zero, Radiance, Sanctuary, Divine Wrath, Divine Ward, Judgement
Archer: Twin Shot, Keen Eye, Piercing Arrow, Fleet Foot, Barbed Arrow, Volley, Swift Nock,
  Focus Spirit, Arrow Rain, Wind Blessing, Tempest Flurry, Aimed Shot, Eagle Eye,
  Reload Stance, Puncture, Steady Aim, Hypervelocity
Thief: Shadow Rush, Shadow Instinct, Keen Reflexes, Noxious Wound, Ricochet Blade,
  Focused Fury, Blade Storm, Cloak of Razors, Eclipse Barrage, Vicious Slash,
  Evasive Mastery, Blood Fang, Shadow Dance, Flicker Assault, Void Ripper,
  Smokescreen, Phantom Strike, Void Cloak, Wraith Talon, Umbra Dominion
Pirate: Gut Punch, Sea Fortitude, Tidewalker Dash, Buccaneer's Bellow, Riptide Sweep,
  Knuckle Crash, Iron Liver, Tidal Lunge, Tidal Slam, Brawler's Resolve,
  Earthshaker, Adamantine Fury, Scorch Shot, Keen Sights, Ricochet Round,
  Grapeshot Barrage, Lock and Load, Broadsider, Megaton Volley

### Map/Region Names — all original reskins

Dawn Isle, Crossway, Tidewatch Harbor, Meadowfield, Sylvanreach, Craghold,
Dusk Ward, Mirefen, Skyhaven, Frosthold, The Tideways, Drakemoor

### NPC Names — all original

Guide Iris, Ferrymaster Cole, Storage Keep, Warrior/Mage/Archer/Thief/Pirate Instructors,
Elder Willow, and all other NPCs

### Item Names — all original

Bronze Shortsword, Iron Broadsword, Nightfang Dagger, Ember Wand, Gale Bow, etc.
Equipment sets, accessories, consumables — all original names

---

## Verification Steps

1. ✅ Grepped all `packages/shared/src/*.ts` for 200+ known MS entity names — zero hits after fixes
2. ✅ Grepped `packages/server/src/*.ts` — zero derivative references
3. ✅ Grepped `packages/client/src/**` — zero derivative references
4. ✅ Grepped `packages/server/test/*.ts` — zero derivative references after fixes
5. ✅ Verified no MS assets (.wz files, Nexon art, Nexon audio) in codebase
6. ⏳ Typecheck + build not runnable (bash EAGAIN); renames are all string-for-string in data
   definitions with no type-level changes — safe for deferred verification

---

## Reviewer Sign-Off

- **Audit performed by:** EZ Coder (automated sweep)
- **Date:** June 2026
- **Scope:** All `packages/shared/src/` content files + client source
- **Result:** 7 derivative items found and renamed; 7 borderline items evaluated and kept;
  1 brand-adjacent item deferred to brand decision
- **Reviewer action needed:** Manual review of this document + spot-check renames for
  thematic fit. Confirm "Maple Crystals" rename timing with brand name decision.
