# World & Content Spine — "A Little Bit of Everything"

The long-term content map. The design goal, straight from the vision: **start calm and normal, then open
into a sprawling world that's a little bit of everything** — snow, desert, ocean, sky, jungle, neon city,
even space. This is MapleStory's single best trick and we parity it.

> **Strategy: Parity-then-diverge.** We clone MapleStory's proven *structure, pacing, and biome variety*
> closely while it's just us. Once we have a team, we diverge the art, lore, and names into something fully
> our own. **Legal line:** game structure/mechanics aren't copyrightable — only specific art, names, and
> lore are. Every name below is a **placeholder reskin**; we ship zero MapleStory assets, names, or files.

---

## The Progression Arc (the feel)

```
CALM ──────────────────────────────────────────────────► CHAOS / "EVERYTHING"
Tutorial isle → pastoral hub continent → snow → ocean → toy/clock → desert → jungle/dragons → cosmic endgame
   Lv 1–10         Lv 10–30            Lv 30 ───────────────────────────────────────────► Lv 100+
```

The emotional arc opens with a brief cinematic — stillness, then light, then the promise of scale:

```
Silence → Dawn breaks → "this is only the beginning" → Guide Iris → gameplay
```

A new character sees this once (skippable), then lands on Dawn Isle with a clear first objective.
The hook: *this small island is the calm before something enormous.* Every region past the
Heartland is a totally different biome, palette, and vibe — snow mountains, open ocean, sky
kingdoms, dragon jungles, neon cities, clockwork towns. That escalating variety is the retention
engine. The intro plants the seed; the Far Reaches pay it off.

**Build the calm core first; the variety is the payoff.**

---

## Region Map (parity targets → our reskins)

### 1. Tutorial Isle — the calm start
| Field | Value |
|---|---|
| Placeholder name | **Dawn Isle** |
| MapleStory parallel (our ref) | Maple Island (Amherst / Southperry) |
| Biome / vibe | Soft green meadows, gentle cliffs, calm. "Everything is okay here." |
| Level band | 1–10 |
| Purpose | Teach movement, attack, jump, inventory, first mesos. One-way trip out at Lv 10. |

### 2. The Heartland — the hub continent (1st/2nd class advancement)
One central continent, a hub crossroads, and ~6 themed towns each tied to a class archetype.

| Placeholder town | MS parallel | Biome / vibe | Class home | Level band |
|---|---|---|---|---|
| **Crossway** (central hub) | Six Path Crossway | Giant world-tree crossroads connecting all towns + the Free Market | — (social/market hub) | — |
| **Tidewatch Harbor** | Lith Harbor | Fishing port, arrival town | Pirate | 10–15 |
| **Meadowfield** | Henesys | Pastoral, mushroom houses, sunny — the cozy starter town | Archer | 10–20 |
| **Sylvanreach** | Ellinia | Treetop forest city, fairies, magic | Mage | 10–20 |
| **Craghold** | Perion | Rocky desert plateau, prehistoric, tough | Warrior | 10–20 |
| **Dusk Ward** | Kerning City | Neon night city, urban, subway | Thief | 10–20 |
| **Mirefen** | Sleepywood | Quiet swamp + ruins, first dungeon access | — (neutral dungeon town) | 20–30 |

### 3. The Far Reaches — the "everything" expansion continent
The payoff. Seven wildly different biome regions reached by ship/train/sky. This is where "a little bit of
everything" lives.

| Placeholder region/town | MS parallel | Biome / vibe | Level band |
|---|---|---|---|
| **Skyhaven** (sky port) | Orbis | Floating sky islands, airships, clouds | 30–45 |
| **Frosthold** | El Nath | Snow mountains, blizzards, ice caves | 35–50 |
| **The Tideways → Pearlgate** | Aqua Road | Fully underwater, swimming movement, reefs | 35–60 |
| **Cogtown** | Ludibrium | Giant toy/clock-tower town, gears, whimsical sci-fi | 40–70 |
| **Sector Zero** | Omega Sector | Aliens + UFOs, retro-sci-fi, lasers | 50–70 |
| **Sunmarch → Alkest** | Ariant / Magatia | Arabian desert + an alchemy city | 40–70 |
| **Long Vale** | Mu Lung Garden | Wuxia / oriental mountains, martial arts | 50–70 |
| **Drakemoor** | Leafre | Dragon jungle, giant beasts — first true endgame zone | 100+ |
| **The Timeless Spire** | Temple of Time | Cosmic/abstract endgame, time-bending | 120+ |

### 4. Faction Isles & beyond (post-MVP, long tail)
| Placeholder | MS parallel | Hook |
|---|---|---|
| **Aerie** | Ereve | Floating knight academy — alternate class storyline start |
| **Hoarfrost Isle** | Rien | Snowbound, a lost-hero warrior class |
| **Ironhollow** | Edelstein | Industrial resistance town — "rebel" faction classes |
| **New Brighton** | Masteria | Western metropolis — past-meets-future cultural mashup |

---

## Connective Tissue (parity these systems too)
- **Hub + spokes:** a central crossroads (Crossway) links the Heartland towns; the Free Market is attached to it.
- **Inter-continent travel:** ships / trains / sky-rides on timers between Heartland ↔ Far Reaches —
  **built and live.** Boarding windows, live countdown banner, group departure. Data-driven schedule via
  `schedule.intervalMs` / `windowMs` per portal in `world.ts`.
- **Class home towns:** each starter class "lives" in a themed town — gives every biome an identity + reason to visit.
- **Dungeons & party content:** swamp/ruins (Mirefen) as the first instanced dungeon; party-quest style group content later.

---

## Verified Difficulty Curve (July 2026)

Every combat map's mob levels verified against the intended zone bands. A player can grind
zone-to-zone without hitting an over- or under-leveled wall.

| Zone | Map | Mob Levels | Band |
|---|---|---|---|
| **Dawn Isle** | Dawn Isle | 1, 2, 3 | 1–10 |
| **Tidewatch Harbor** | Harbor Docks | 4, 5, 6, 8, 10 | 4–10 |
| **Meadowfield** | Meadowfield | 10, 12, 14, 16, 18 | 10–20 |
| **Sylvanreach** | Canopy | 10, 12, 14 | 10–15 |
| | Roots | 14, 15, 17 | 15–20 |
| **Craghold** | Cliffs | 10, 12, 14 | 10–15 |
| | Quarry | 16, 18 | 15–20 |
| **Dusk Ward** | Subway | 10, 11, 13, 15 | 10–15 |
| | Backalleys | 16, 17, 19 | 15–20 |
| | Subway PQ | 20, 22, 24, boss 28 | 20–30 |
| **Mirefen** | Ruins | 20, 22, 25, 27, 28, 29, boss 30 | 20–30 |
| **Skyhaven** | Driftpeaks | 30, 34, 38, boss 40 | 30–45 |
| **Frosthold** | Slopes | 35, 38, 42, boss 45 | 35–45 |
| | Icecave | 40, 44, 48, 50, boss 50 | 40–50 |
| **Tideways** | Reef | 35, 38, 40, 45 | 35–45 |
| | Abyss | 45, 50, 55, boss 55 | 45–60 |
| **Drakemoor** | Jungle Floor | 90, 95, 100, 105, 110 | 90–110 |
| | Dragon Abyss | 110, 115, 118, 120, boss 120 | 110–120 |

**Class home towns** — each has appropriate Lv 10+ entry content:
- **Meadowfield (Archer):** green_mushroom 10 → mushroom 12 → meadow_beetle 16 → thornback_hopper 18
- **Sylvanreach (Mage):** forest_wisp 10 → canopy_moth 12 → bark_spider 14 → root_crawler 15 → sylvan_sprite 17
- **Craghold (Warrior):** rock_lizard 10 → fossil_beetle 12 → cliff_hawk 14 → quarry_crab 16 → boulder_golem 18
- **Dusk Ward (Thief):** neon_rat 10 → tunnel_bat 11 → spark_drone 13 → rail_sentinel 15 → shadow_thug 16 → arc_wraith 19
- **Tidewatch Harbor (Pirate):** dock_rat 4 → barnacle_crab 5 → harbor_gull 6 → deckhand_specter 8 → bilge_rat 10

**Grind path progression** (no gaps or spikes):
```
Lv 1-3   Dawn Isle → Lv 4-10 Harbor Docks
Lv 10-18 Meadowfield / Sylvanreach / Craghold / Dusk Ward (parallel Heartland zones)
Lv 20-30 Mirefen Ruins + Subway PQ
Lv 30-40 Skyhaven Driftpeaks
Lv 35-45 Frosthold Slopes / Tideways Reef (parallel Far Reaches zones)
Lv 40-50 Frosthold Icecave
Lv 45-55 Tideways Abyss
Lv 90-120 Drakemoor (endgame)
```

> Gap at Lv 60–90 is intentional — Cogtown, Sector Zero, Sunmarch/Alkest, Long Vale (planned)
> will fill this range.

---

## Build status (July 2026) — slice shipped, world expanding
The original MVP slice (one town, one class, one mob) is **done and surpassed**. Where the map stands now:

- **Authored & live (joinable rooms):** **all 33 maps in `world.ts` are registered as Colyseus rooms**
  (with channels) and playable today — Dawn Isle, the full Heartland (Meadowfield, Sylvanreach, Craghold,
  Dusk Ward, Crossway, Tidewatch Harbor, Mirefen + dungeons), the first Far Reaches biomes (Skyhaven,
  Frosthold + their sub-maps), and the Dusk Subway party-quest maps. The room list is derived from the
  shared `MAPS` registry in `packages/server/src/app.config.ts`, so every authored zone is joinable
  without a hand-maintained list.
- **All five classes** (Warrior, Mage, Archer, Thief, Pirate) are specced with branching job trees; **74
  mobs (12 bosses)**, two-layer rarity loot, the Free Market, quests, parties, guilds and party quests are
  all in. Buffs/passives, status effects, and the elemental damage triangle are wired into live combat.
- **Scheduled transport (airship/boat/sky-ride) — LIVE:** The Heartland ↔ Far Reaches ferry ritual
  is fully implemented. Scheduled portals (Crossway↔Skyhaven airship, Skyhaven↔Frosthold airship, etc.)
  enforce boarding windows server-side: players board during the 60-second window, see a live countdown
  banner on the client, and are teleported together when the window closes. Timing is data-driven via
  `schedule.intervalMs` and `schedule.windowMs` in `world.ts` portal definitions. **Ferrymaster Cole**
  NPC on Dawn Isle handles the tutorial ferry (NPC dialog-based, not scheduled). Automated test coverage
  in `test/scheduledTransport.ts`.
- **Not built yet (the backlog):** Cogtown, Sector Zero, Sunmarch/Alkest, Long Vale,
  the Timeless Spire, and the faction isles.

> Rule: every new region added later must bring a *genuinely different* vibe (movement, palette, enemies).
> Variety is the product. Sameness is death.

---

## Alpha Test — Shipped vs Coming Soon (July 2026)

Testers can only reach **content-complete zones**. Incomplete zones are gated via
`comingSoon` portals and excluded from direct room joins (`EXCLUDED_MAPS` in
`app.config.ts`). Portal gating is enforced server-side in both `checkPortalProximity`
and the `MAP_TRAVEL` handler.

### ✅ Shipped (27 maps — testers can reach all of these)

| Region | Maps | Level Band |
|---|---|---|
| **Dawn Isle** | `dawn_isle` | 1–10 |
| **Heartland** | `heartland_harbor`, `harbor_docks`, `crossway`, `meadowfield`, `sylvanreach`, `sylvanreach_canopy`, `sylvanreach_roots`, `craghold`, `craghold_cliffs`, `craghold_quarry`, `dusk_ward`, `dusk_ward_subway`, `dusk_ward_backalley`, `mirefen`, `mirefen_ruins` | 10–30 |
| **Dusk Subway PQ** | `dusk_subway_pq_staging`, `dusk_subway_pq_stage1`–`stage4` | 20–30 |
| **Free Market** | `free_market` | — |
| **Far Reaches (partial)** | `skyhaven`, `skyhaven_driftpeaks`, `frosthold`, `frosthold_slopes`, `frosthold_icecave` | 30–50 |

### 🚧 Coming Soon (6 maps — portal-gated, not joinable)

| Region | Maps | Level Band | Gated from |
|---|---|---|---|
| **The Tideways** | `tideways`, `tideways_reef`, `tideways_abyss` | 35–60 | Skyhaven (boat) |
| **Drakemoor** | `drakemoor`, `drakemoor_jungle_floor`, `drakemoor_dragon_abyss` | 90–120 | Crossway (airship) |

### ❌ Not yet built (5 zones — no map definitions in `MAPS` registry)

| Zone | Planned Level Band | Notes |
|---|---|---|
| **Cogtown** | 40–70 | Toy/clockwork biome |
| **Sector Zero** | 50–70 | Alien/UFO biome |
| **Sunmarch → Alkest** | 40–70 | Desert + alchemy city |
| **Long Vale** | 50–70 | Wuxia/martial arts |
| **The Timeless Spire** | 120+ | Cosmic endgame |

### Enforcement points

1. **`Portal.comingSoon` flag** (`packages/shared/src/world.ts`) — all 10 portals
   targeting gated zones are marked `comingSoon: true`.
2. **Server `checkPortalProximity`** (`MapRoom.ts`) — blocks physical portal use
   with "🚧 Coming Soon" message.
3. **Server `MAP_TRAVEL` handler** (`MapRoom.ts`) — blocks world-map quick-travel
   to gated zones.
4. **`EXCLUDED_MAPS`** (`app.config.ts`) — 6 gated map IDs prevent direct room
   joins via matchmaking.
5. **Client portal rendering** (`MapScene.ts`) — coming-soon portals render as
   amber orbs with "🚧 Coming Soon" prompt.
6. **Client world map** (`UI.ts`) — coming-soon nodes show as warm gray,
   non-clickable, with "🚧 Coming Soon" label.

---

*This is the content bible. `PLANNING.md` = the systems & business plan. The slice is built — now we widen
the world region by region.*
