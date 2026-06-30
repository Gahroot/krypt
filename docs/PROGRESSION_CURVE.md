# Progression Curve — Balance Documentation

## EXP Curve (piecewise)

The EXP required to level from `level` → `level + 1` follows a piecewise formula
in `packages/shared/src/progression.ts`:

```
Level  1–9  :   80 + 20 × level      (gentle linear ramp)
Level 10–29 :  200 + 30 × level      (moderate Heartland grind)
Level 30–69 : 1000 + 10 × level²     (Far Reaches expansion)
Level 70+   : 4000 + 30 × level²     (endgame ceiling)
```

### Key breakpoints

| Level | EXP needed | Cumulative to Lv |
|-------|-----------|-----------------|
| 1→2 | 100 | 100 |
| 5→6 | 180 | 620 |
| 10→11 | 500 | 1,620 |
| 20→21 | 800 | 7,120 |
| 29→30 | 1,070 | 13,230 |
| 30→31 | 10,000 | 14,300 |
| 40→41 | 17,000 | 75,300 |
| 50→51 | 26,000 | 251,300 |
| 60→61 | 37,000 | 685,300 |
| 69→70 | 48,610 | 1,464,300 |
| 70→71 | 151,000 | 1,615,300 |

## Mob EXP Scaling

### Heartland mobs (Lv 1–29): `20 + floor(level² / 6)`
Gentle quadratic. Provides 7–14 kills per level in the Lv 10–29 range.

### Expansion mobs (Lv 30–65): Aggressively scaled
Far Reaches mobs give 3–4× more EXP than Heartland mobs at the same
level count, matching the steeper Lv 30+ EXP curve.

| Mob Level | Mob EXP | Best example |
|-----------|---------|--------------|
| 1 | 21 | Friendly Snail |
| 10 | 37 | Rock Lizard, Forest Wisp |
| 20 | 87 | Bog Lurker, Subway Horror |
| 30 | 600 | Wind Sprite (Skyhaven) |
| 40 | 800 | Thunder Hawk, Ice Elemental |
| 50 | 1,100 | Glacial Shard (Icecave) |
| 60 | 1,500 | Frost Banshee (Icecave) |

### Field Boss EXP (~8–20× normal mob at same level)

| Boss | Level | EXP |
|------|-------|-----|
| Mano | 8 | 500 |
| Stumpy | 12 | 800 |
| King Slime | 15 | 1,000 |
| Mushmom | 18 | 1,300 |
| Jr. Balrog | 22 | 2,000 |
| Subway Curse Eye (PQ) | 28 | 1,500 |
| Bogmaw (dungeon) | 30 | 2,000 |
| Glacius Prime (field) | 45 | 8,000 |
| Glacial Abomination (dungeon) | 50 | 10,000 |

## Kills-per-Level Summary

The simulation test (`tests/progression-curve-sim.test.ts`) validates
that the curve produces these kill counts:

| Level Range | Kills/Level | Feel |
|-------------|-------------|------|
| 1–5 | 5–8 | Fast — tutorial pacing |
| 5–10 | 8–14 | Quick — hook the player |
| 10–20 | 10–14 | Steady Heartland grind |
| 20–29 | 7–10 | Comfortable — approaching expansion |
| 29→30 | 7→17 | Expansion gate (intentional jump) |
| 30–40 | 17–23 | Far Reaches grind |
| 40–50 | 21–28 | Frosthold depths |
| 50–60 | 24–28 | Endgame approach |
| 60–69 | 25–33 | Deliberate — earned power |

The Lv 29→30 transition is an intentional "expansion gate" — the player
moves from Heartland content (Lv 10–29 mobs giving 7–10 kills/level) to
Far Reaches content (Lv 30+ mobs giving 17–23 kills/level). This matches
classic MapleStory where traveling to Orbis/Aqua Road/etc. marks a clear
difficulty increase.

## Quest EXP as Leveling Supplement

Each region's quest chain provides ~30–50% of the total EXP needed
to progress through its level band. Quests supplement grinding so that
a player who completes all quests in a region gains 2–4 bonus levels.

## Region ↔ Mob Level Mapping (WORLD.md parity)

| Region | WORLD.md Band | Mob Levels | Status |
|--------|---------------|-----------|--------|
| Dawn Isle | 1–10 | 1, 2, 3 | ✅ |
| Tidewatch Harbor | 10–15 | 4 (dock rat) | ✅ |
| Meadowfield | 10–20 | 2, 4, 6, 12 | ✅ |
| Sylvanreach Canopy | 10–15 | 10, 12, 14 | ✅ |
| Sylvanreach Roots | 15–20 | 14, 15, 17 | ✅ |
| Craghold Cliffs | 10–15 | 10, 12, 14 | ✅ |
| Craghold Quarry | 15–20 | 10, 16, 18 | ✅ |
| Dusk Ward Subway | 10–15 | 10, 11, 13, 15 | ✅ |
| Dusk Ward Backalley | 15–20 | 16, 17, 19 | ✅ |
| Mirefen Ruins | 20–30 | 20, 22, 25, 27, 28, 29 | ✅ |
| Skyhaven Driftpeaks | 30–40 | 30, 34, 38 | ✅ |
| Frosthold Slopes | 35–45 | 35, 38, 42 | ✅ |
| Frosthold Icecave | 40–65 | 40, 44, 50, 55, 60 | ✅ |

## Drop Cadence

Boss drops provide meaningful gear upgrades at satisfying intervals:

- **Field bosses** (Mano, Stumpy, King Slime, Mushmom, Jr. Balrog):
  15–25% chance per slot, RARE–EPIC minimum potential.
  ~2–3 boss kills to get a gear piece → every ~10–15 min of field boss hunting.

- **Dungeon bosses** (Subway Curse Eye, Bogmaw, Glacial Abomination):
  10–14% chance per weapon slot, RARE–UNIQUE minimum potential.
  One dungeon run (15–20 min) gives ~2–3 drops.

- **Normal mob drops**: 3–8% per slot per kill.
  At ~15–20 kills/level, a player sees ~1–2 equipment drops every 2–3 levels.
  Gear naturally upgrades as they move to higher-level regions.
