#!/usr/bin/env tsx
/**
 * Pacing Simulation — full Lv 1→60 time-to-level analysis.
 *
 * Uses actual combat sub-map spawn data (not town maps).
 * Validates kills-per-level, zone coverage, and time estimates.
 */

import { expForLevel } from "../src/progression.js";
import { MOBS, type MobDef } from "../src/mobs.js";

// ── Combat zone data (from world.ts inline spawns) ───────────────────────

interface CombatZone {
  id: string;
  name: string;
  levelBand: [number, number];
  mobs: { id: string; mobId: string; level: number; exp: number; count: number }[];
  totalMobs: number;
}

function mobLevel(id: string): number {
  return MOBS[id]?.level ?? 0;
}
function mobExp(id: string): number {
  return MOBS[id]?.exp ?? 0;
}

const ZONES: CombatZone[] = [
  {
    id: "dawn_isle",
    name: "Dawn Isle",
    levelBand: [1, 10],
    mobs: [
      {
        id: "snail",
        mobId: "mob.friendly_snail",
        level: mobLevel("mob.friendly_snail"),
        exp: mobExp("mob.friendly_snail"),
        count: 5,
      },
      {
        id: "puff",
        mobId: "mob.green_puff",
        level: mobLevel("mob.green_puff"),
        exp: mobExp("mob.green_puff"),
        count: 3,
      },
      {
        id: "shroom",
        mobId: "mob.dawn_shroom",
        level: mobLevel("mob.dawn_shroom"),
        exp: mobExp("mob.dawn_shroom"),
        count: 2,
      },
    ],
    totalMobs: 10,
  },
  {
    id: "harbor_docks",
    name: "Harbor Docks",
    levelBand: [4, 12],
    mobs: [
      { id: "dock_rat", mobId: "mob.dock_rat", level: 4, exp: mobExp("mob.dock_rat"), count: 7 },
      {
        id: "barnacle",
        mobId: "mob.barnacle_crab",
        level: 5,
        exp: mobExp("mob.barnacle_crab"),
        count: 5,
      },
      { id: "gull", mobId: "mob.harbor_gull", level: 6, exp: mobExp("mob.harbor_gull"), count: 4 },
      {
        id: "specter",
        mobId: "mob.deckhand_specter",
        level: 8,
        exp: mobExp("mob.deckhand_specter"),
        count: 3,
      },
      { id: "bilge", mobId: "mob.bilge_rat", level: 10, exp: mobExp("mob.bilge_rat"), count: 3 },
    ],
    totalMobs: 22,
  },
  {
    id: "meadowfield",
    name: "Meadowfield",
    levelBand: [10, 18],
    mobs: [
      {
        id: "green_mush",
        mobId: "mob.green_mushroom",
        level: 10,
        exp: mobExp("mob.green_mushroom"),
        count: 4,
      },
      { id: "mushroom", mobId: "mob.mushroom", level: 12, exp: mobExp("mob.mushroom"), count: 6 },
      {
        id: "beetle",
        mobId: "mob.meadow_beetle",
        level: 16,
        exp: mobExp("mob.meadow_beetle"),
        count: 6,
      },
      {
        id: "hopper",
        mobId: "mob.thornback_hopper",
        level: 18,
        exp: mobExp("mob.thornback_hopper"),
        count: 3,
      },
      { id: "crow", mobId: "mob.crow", level: 12, exp: mobExp("mob.crow"), count: 2 },
      {
        id: "bunny",
        mobId: "mob.feral_bunny",
        level: 14,
        exp: mobExp("mob.feral_bunny"),
        count: 3,
      },
    ],
    totalMobs: 24,
  },
  {
    id: "sylvanreach_canopy",
    name: "Sylvanreach Canopy",
    levelBand: [10, 14],
    mobs: [
      { id: "wisp", mobId: "mob.forest_wisp", level: 10, exp: mobExp("mob.forest_wisp"), count: 5 },
      { id: "moth", mobId: "mob.canopy_moth", level: 12, exp: mobExp("mob.canopy_moth"), count: 4 },
      {
        id: "spider",
        mobId: "mob.bark_spider",
        level: 14,
        exp: mobExp("mob.bark_spider"),
        count: 2,
      },
    ],
    totalMobs: 11,
  },
  {
    id: "sylvanreach_roots",
    name: "Sylvanreach Roots",
    levelBand: [14, 17],
    mobs: [
      {
        id: "crawler",
        mobId: "mob.root_crawler",
        level: 15,
        exp: mobExp("mob.root_crawler"),
        count: 6,
      },
      {
        id: "sprite",
        mobId: "mob.sylvan_sprite",
        level: 17,
        exp: mobExp("mob.sylvan_sprite"),
        count: 4,
      },
      {
        id: "spider",
        mobId: "mob.bark_spider",
        level: 14,
        exp: mobExp("mob.bark_spider"),
        count: 3,
      },
    ],
    totalMobs: 13,
  },
  {
    id: "craghold_cliffs",
    name: "Craghold Cliffs",
    levelBand: [10, 14],
    mobs: [
      {
        id: "lizard",
        mobId: "mob.rock_lizard",
        level: 10,
        exp: mobExp("mob.rock_lizard"),
        count: 6,
      },
      {
        id: "beetle",
        mobId: "mob.fossil_beetle",
        level: 12,
        exp: mobExp("mob.fossil_beetle"),
        count: 5,
      },
      { id: "hawk", mobId: "mob.cliff_hawk", level: 14, exp: mobExp("mob.cliff_hawk"), count: 5 },
    ],
    totalMobs: 16,
  },
  {
    id: "craghold_quarry",
    name: "Craghold Quarry",
    levelBand: [16, 18],
    mobs: [
      {
        id: "crab",
        mobId: "mob.quarry_crab",
        level: 16,
        exp: mobExp("mob.quarry_crab"),
        count: 13,
      },
      {
        id: "golem",
        mobId: "mob.boulder_golem",
        level: 18,
        exp: mobExp("mob.boulder_golem"),
        count: 7,
      },
    ],
    totalMobs: 20,
  },
  {
    id: "dusk_ward_subway",
    name: "Dusk Ward Subway",
    levelBand: [10, 15],
    mobs: [
      { id: "neon_rat", mobId: "mob.neon_rat", level: 10, exp: mobExp("mob.neon_rat"), count: 11 },
      { id: "bat", mobId: "mob.tunnel_bat", level: 11, exp: mobExp("mob.tunnel_bat"), count: 5 },
      {
        id: "drone",
        mobId: "mob.spark_drone",
        level: 13,
        exp: mobExp("mob.spark_drone"),
        count: 4,
      },
      {
        id: "sentinel",
        mobId: "mob.rail_sentinel",
        level: 15,
        exp: mobExp("mob.rail_sentinel"),
        count: 3,
      },
    ],
    totalMobs: 23,
  },
  {
    id: "dusk_ward_backalley",
    name: "Dusk Ward Backalley",
    levelBand: [15, 19],
    mobs: [
      { id: "thug", mobId: "mob.shadow_thug", level: 16, exp: mobExp("mob.shadow_thug"), count: 9 },
      {
        id: "spider",
        mobId: "mob.neon_spider",
        level: 17,
        exp: mobExp("mob.neon_spider"),
        count: 8,
      },
      { id: "wraith", mobId: "mob.arc_wraith", level: 19, exp: mobExp("mob.arc_wraith"), count: 4 },
    ],
    totalMobs: 21,
  },
  {
    id: "subway_pq",
    name: "Subway PQ",
    levelBand: [20, 24],
    mobs: [
      {
        id: "horror",
        mobId: "mob.subway_horror",
        level: 20,
        exp: mobExp("mob.subway_horror"),
        count: 9,
      },
      {
        id: "stalker",
        mobId: "mob.subway_stalker",
        level: 22,
        exp: mobExp("mob.subway_stalker"),
        count: 4,
      },
      {
        id: "overseer",
        mobId: "mob.subway_overseer",
        level: 24,
        exp: mobExp("mob.subway_overseer"),
        count: 6,
      },
    ],
    totalMobs: 19,
  },
  {
    id: "mirefen_ruins",
    name: "Mirefen Ruins",
    levelBand: [20, 29],
    mobs: [
      { id: "lurker", mobId: "mob.bog_lurker", level: 20, exp: mobExp("mob.bog_lurker"), count: 9 },
      { id: "toad", mobId: "mob.mire_toad", level: 22, exp: mobExp("mob.mire_toad"), count: 5 },
      {
        id: "sentinel",
        mobId: "mob.ruins_sentinel",
        level: 25,
        exp: mobExp("mob.ruins_sentinel"),
        count: 4,
      },
      {
        id: "horror",
        mobId: "mob.ruins_horror",
        level: 28,
        exp: mobExp("mob.ruins_horror"),
        count: 3,
      },
      {
        id: "wraith",
        mobId: "mob.moss_wraith",
        level: 27,
        exp: mobExp("mob.moss_wraith"),
        count: 2,
      },
      {
        id: "thing",
        mobId: "mob.deep_swamp_thing",
        level: 29,
        exp: mobExp("mob.deep_swamp_thing"),
        count: 4,
      },
    ],
    totalMobs: 27,
  },
  {
    id: "skyhaven_driftpeaks",
    name: "Skyhaven Driftpeaks",
    levelBand: [30, 38],
    mobs: [
      {
        id: "wind",
        mobId: "mob.wind_sprite",
        level: 30,
        exp: mobExp("mob.wind_sprite"),
        count: 10,
      },
      {
        id: "serpent",
        mobId: "mob.sky_serpent",
        level: 34,
        exp: mobExp("mob.sky_serpent"),
        count: 4,
      },
      {
        id: "hawk",
        mobId: "mob.thunder_hawk",
        level: 38,
        exp: mobExp("mob.thunder_hawk"),
        count: 3,
      },
    ],
    totalMobs: 17,
  },
  {
    id: "frosthold_slopes",
    name: "Frosthold Slopes",
    levelBand: [35, 42],
    mobs: [
      { id: "wolf", mobId: "mob.frost_wolf", level: 35, exp: mobExp("mob.frost_wolf"), count: 9 },
      {
        id: "elemental",
        mobId: "mob.ice_elemental",
        level: 38,
        exp: mobExp("mob.ice_elemental"),
        count: 5,
      },
      {
        id: "wraith",
        mobId: "mob.snow_wraith",
        level: 42,
        exp: mobExp("mob.snow_wraith"),
        count: 4,
      },
    ],
    totalMobs: 18,
  },
  {
    id: "frosthold_icecave",
    name: "Frosthold Icecave",
    levelBand: [40, 50],
    mobs: [
      {
        id: "crawler",
        mobId: "mob.frost_crawler",
        level: 40,
        exp: mobExp("mob.frost_crawler"),
        count: 6,
      },
      {
        id: "guardian",
        mobId: "mob.crystal_guardian",
        level: 44,
        exp: mobExp("mob.crystal_guardian"),
        count: 5,
      },
      {
        id: "shard",
        mobId: "mob.glacial_shard",
        level: 50,
        exp: mobExp("mob.glacial_shard"),
        count: 3,
      },
      {
        id: "revenant",
        mobId: "mob.permafrost_revenant",
        level: 48,
        exp: mobExp("mob.permafrost_revenant"),
        count: 4,
      },
      {
        id: "banshee",
        mobId: "mob.frost_banshee",
        level: 50,
        exp: mobExp("mob.frost_banshee"),
        count: 3,
      },
    ],
    totalMobs: 21,
  },
  {
    id: "tideways_reef",
    name: "Tideways Reef",
    levelBand: [35, 45],
    mobs: [
      {
        id: "jelly",
        mobId: "mob.reef_jellyfish",
        level: 35,
        exp: mobExp("mob.reef_jellyfish"),
        count: 10,
      },
      { id: "urchin", mobId: "mob.sea_urchin", level: 38, exp: mobExp("mob.sea_urchin"), count: 5 },
      { id: "puffer", mobId: "mob.pufferfish", level: 40, exp: mobExp("mob.pufferfish"), count: 4 },
      { id: "angler", mobId: "mob.anglerfish", level: 45, exp: mobExp("mob.anglerfish"), count: 3 },
    ],
    totalMobs: 22,
  },
  {
    id: "tideways_abyss",
    name: "Tideways Abyss",
    levelBand: [45, 55],
    mobs: [
      {
        id: "shark",
        mobId: "mob.tiger_shark",
        level: 50,
        exp: mobExp("mob.tiger_shark"),
        count: 14,
      },
      { id: "angler", mobId: "mob.anglerfish", level: 45, exp: mobExp("mob.anglerfish"), count: 7 },
      {
        id: "serpent",
        mobId: "mob.sea_serpent",
        level: 55,
        exp: mobExp("mob.sea_serpent"),
        count: 7,
      },
    ],
    totalMobs: 28,
  },
];

// ── Timing constants ─────────────────────────────────────────────────────

const KILL_TIME_S = 1.0;
const TRAVEL_TIME_S = 0.5;
const RESPAWN_BASE_S = 15;
const RESPAWN_JITTER_AVG_S = 1.5;
const ELITE_CHANCE = 0.05;
const ELITE_EXP_MULT = 3;

// ── Helpers ──────────────────────────────────────────────────────────────

function bestMob(level: number): MobDef {
  let best: MobDef | undefined;
  for (const mob of Object.values(MOBS)) {
    if (mob.isBoss) continue;
    if (mob.level <= level && (!best || mob.exp > best.exp)) best = mob;
  }
  return best!;
}

function zoneForMob(mobId: string): CombatZone | undefined {
  return ZONES.find((z) => z.mobs.some((m) => m.mobId === mobId));
}

function killsPerMinute(density: number): number {
  if (density === 0) return 0;
  const respawnS = RESPAWN_BASE_S + RESPAWN_JITTER_AVG_S;
  const clearTime = density * (KILL_TIME_S + TRAVEL_TIME_S);
  return (density / Math.max(clearTime, respawnS * 0.6)) * 60;
}

function expectedExpPerKill(baseExp: number): number {
  return baseExp * (1 - ELITE_CHANCE) + baseExp * ELITE_EXP_MULT * ELITE_CHANCE;
}

// ── Simulation ───────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  Pacing Simulation — Lv 1→60 Time-to-Level Analysis");
console.log("═══════════════════════════════════════════════════════════════════════\n");

console.log("## Kills-per-Level Table (Lv 1→60)\n");
console.log(
  "Lv | EXP Req | Best Mob              | MobLv | MobEXP | Zone                 | Dens | Kills | Time",
);
console.log(
  "---|---------|-----------------------|-------|--------|----------------------|------|-------|-------",
);

let totalMinutes = 0;
const killsPerLevel: number[] = [];
const issues: string[] = [];

for (let lv = 1; lv <= 60; lv++) {
  const expNeeded = expForLevel(lv);
  const mob = bestMob(lv);
  const kills = Math.ceil(expNeeded / mob.exp);
  const zone = zoneForMob(mob.id);
  const density = zone?.totalMobs ?? 0;
  const kpm = killsPerMinute(density);
  const expPerKill = expectedExpPerKill(mob.exp);
  const expPerMin = kpm * expPerKill;
  const timeMinutes = expPerMin > 0 ? expNeeded / expPerMin : Infinity;

  totalMinutes += timeMinutes;
  killsPerLevel.push(kills);

  // Check for walls
  if (lv - mob.level > 5 && lv > 3) {
    issues.push(`Lv ${lv}: best mob ${mob.id} is ${lv - mob.level} levels below`);
  }
  if (timeMinutes > 5 && lv > 5) {
    issues.push(`Lv ${lv}: ${timeMinutes.toFixed(1)} min/level — too slow`);
  }
  if (kpm === 0) {
    issues.push(`Lv ${lv}: no spawns available (0 kills/min)`);
  }

  const zoneName = (zone?.name ?? "???").padEnd(22).slice(0, 22);
  const timeStr = timeMinutes === Infinity ? "∞" : `${timeMinutes.toFixed(1)}m`;
  console.log(
    `${String(lv).padStart(2)} | ${String(expNeeded).padStart(7)} | ${mob.id.padEnd(23)} | ${String(mob.level).padStart(5)} | ${String(mob.exp).padStart(6)} | ${zoneName} | ${String(density).padStart(4)} | ${String(kills).padStart(5)} | ${timeStr.padStart(6)}`,
  );
}

console.log(
  `\n  Total Lv 1→60: ${(totalMinutes / 60).toFixed(1)}h (${totalMinutes.toFixed(0)} min)\n`,
);

// ── Zone coverage ────────────────────────────────────────────────────────

console.log("## Zone Coverage (combat sub-maps)\n");
for (const zone of ZONES) {
  const mobLevels = zone.mobs.map((m) => m.level).sort((a, b) => a - b);
  const minLv = mobLevels[0]!;
  const maxLv = mobLevels[mobLevels.length - 1]!;
  const gap = maxLv - minLv;
  console.log(
    `  ${zone.name.padEnd(25)} ${zone.levelBand[0]}–${zone.levelBand[1]} | mobs ${minLv}–${maxLv} (gap ${gap}) | ${String(zone.totalMobs).padStart(2)} mobs`,
  );
}

// ── Dead band detection ──────────────────────────────────────────────────

console.log("\n## Dead Band / Wall Detection\n");

// Check every level 1-60 has a mob within 3 levels
let walls = 0;
for (let lv = 1; lv <= 60; lv++) {
  const mob = bestMob(lv);
  if (lv - mob.level > 3 && lv > 3) {
    console.log(
      `  🔴 Lv ${lv}: best mob is ${mob.id} (Lv ${mob.level}) — ${lv - mob.level} level gap`,
    );
    walls++;
  }
}

// Check for kills/level spikes (no level > 2× average of neighbors)
let spikes = 0;
for (let i = 1; i < killsPerLevel.length - 1; i++) {
  const prev = killsPerLevel[i - 1]!;
  const curr = killsPerLevel[i]!;
  const next = killsPerLevel[i + 1]!;
  const avg = (prev + next) / 2;
  if (curr > avg * 2 + 1) {
    console.log(`  🔴 Lv ${i + 1}: ${curr} kills (spike — avg neighbors ${avg.toFixed(1)})`);
    spikes++;
  }
}

// Check monotonic trend
const earlyMedian = median(killsPerLevel.slice(0, 10));
const lateMedian = median(killsPerLevel.slice(49, 60));
console.log(`\n  Early (Lv 1–10) median kills/level: ${earlyMedian}`);
console.log(`  Late  (Lv 50–60) median kills/level: ${lateMedian}`);
console.log(
  `  Monotonic trend: ${lateMedian > earlyMedian ? "✅ yes" : "❌ no — late game easier than early"}`,
);

if (walls === 0 && spikes === 0 && issues.length === 0) {
  console.log("\n  ✅ No dead bands, walls, or spikes detected!\n");
} else {
  for (const issue of issues) console.log(`  🔴 ${issue}`);
  console.log();
}

// ── Summary ──────────────────────────────────────────────────────────────

const allKills = killsPerLevel;
const avgKills = allKills.reduce((a, b) => a + b, 0) / allKills.length;
console.log("## Summary\n");
console.log(
  `  Kills/level range: ${Math.min(...allKills)}–${Math.max(...allKills)} (avg ${avgKills.toFixed(1)})`,
);
console.log(`  Estimated Lv 1→60: ${(totalMinutes / 60).toFixed(1)} hours`);
console.log(`  Walls: ${walls} | Spikes: ${spikes} | Issues: ${issues.length}`);

// ── Time-to-level by zone ────────────────────────────────────────────────

console.log("\n## Time-to-Level by Zone\n");
const zoneTimes = new Map<string, number>();
for (let lv = 1; lv <= 60; lv++) {
  const mob = bestMob(lv);
  const zone = zoneForMob(mob.id);
  const name = zone?.name ?? "???";
  const expNeeded = expForLevel(lv);
  const kpm = killsPerMinute(zone?.totalMobs ?? 0);
  const expPerMin = kpm * expectedExpPerKill(mob.exp);
  const t = expPerMin > 0 ? expNeeded / expPerMin : 0;
  zoneTimes.set(name, (zoneTimes.get(name) ?? 0) + t);
}
for (const [name, time] of [...zoneTimes.entries()].sort((a, b) => a[1] - b[1])) {
  console.log(`  ${name.padEnd(25)} ${(time / 60).toFixed(1)}h`);
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}
