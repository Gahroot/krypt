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

The emotional arc: a new player starts in a safe, cozy, green tutorial. They pick a class, land in a warm
pastoral hub, and the world slowly reveals it's *enormous and varied* — every region a totally different
vibe. That escalating variety is the retention engine. Build the calm core first; the variety is the payoff.

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
- **Inter-continent travel:** ships / trains / sky-rides on timers between Heartland ↔ Far Reaches (the
  scheduled-boat ritual is iconic and cheap to build).
- **Class home towns:** each starter class "lives" in a themed town — gives every biome an identity + reason to visit.
- **Dungeons & party content:** swamp/ruins (Mirefen) as the first instanced dungeon; party-quest style group content later.

---

## Build status (June 2026) — slice shipped, world expanding
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
- **Not built yet (the backlog):** the back half of the arc — the Tideways (underwater), Cogtown, Sector
  Zero, Sunmarch/Alkest, Long Vale, Drakemoor (endgame) and the Timeless Spire, plus the faction isles.

> Rule: every new region added later must bring a *genuinely different* vibe (movement, palette, enemies).
> Variety is the product. Sameness is death.

---

*This is the content bible. `PLANNING.md` = the systems & business plan. The slice is built — now we widen
the world region by region.*
