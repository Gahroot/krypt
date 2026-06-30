/**
 * Progression Curve Simulation — validates the EXP curve + mob EXP tuning
 * produces smooth, monotonic kills-per-level across the full Lv 1→70 range.
 *
 * We validate levels 1–69 (the grind TO reach level 70). At each level,
 * we find the highest-EXP regular mob available and compute kills needed.
 *
 * Key properties asserted:
 *   1. No dead zones: kills-per-level stays within 5–35 at every level.
 *   2. No spikes: no level requires >2× the average of its neighbours.
 *   3. Monotonic trend: late-game grind is harder than early-game.
 *   4. Region coverage: mobs exist for every level band.
 */

import { describe, it, expect } from "vitest";
import { expForLevel } from "../src/progression.js";
import { MOBS } from "../src/mobs.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * For a given level, find the best mob to grind (highest EXP whose level
 * is ≤ the player's level).
 */
function bestMobForLevel(level: number): { id: string; exp: number; level: number } {
  let best: { id: string; exp: number; level: number } | undefined;

  for (const mob of Object.values(MOBS)) {
    if (mob.isBoss) continue;
    if (mob.level <= level) {
      if (!best || mob.exp > best.exp) {
        best = { id: mob.id, exp: mob.exp, level: mob.level };
      }
    }
  }

  // best is guaranteed non-undefined since MOBS always has regular mobs
  return best!;
}

/** Compute kills needed to go from `level` → `level + 1` using the best mob. */
function killsForLevel(level: number): number {
  const expNeeded = expForLevel(level);
  const mob = bestMobForLevel(level);
  return Math.ceil(expNeeded / mob.exp);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("progression curve simulation", () => {
  // Validate levels 1–69 (the grind TO reach level 70)
  const killsPerLevel: number[] = [];
  const mobUsedPerLevel: string[] = [];

  for (let lv = 1; lv <= 69; lv++) {
    killsPerLevel.push(killsForLevel(lv));
    mobUsedPerLevel.push(bestMobForLevel(lv).id);
  }

  it("no dead zones: kills-per-level stays within 5–35 at every level", () => {
    for (const kills of killsPerLevel) {
      expect(kills).toBeGreaterThanOrEqual(5);
      expect(kills).toBeLessThanOrEqual(35);
    }
  });

  it("no spikes: no level requires >2× the average of its neighbours", () => {
    for (let i = 1; i < killsPerLevel.length - 1; i++) {
      const prev = killsPerLevel[i - 1]!;
      const curr = killsPerLevel[i]!;
      const next = killsPerLevel[i + 1]!;
      const avg = (prev + next) / 2;
      expect(curr).toBeLessThanOrEqual(avg * 2 + 1);
    }
  });

  it("monotonic trend: late-game grind is harder than early-game", () => {
    const early = killsPerLevel.slice(0, 10); // Lv 1–10
    const late = killsPerLevel.slice(49, 69); // Lv 50–70
    const median = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };
    expect(median(late)).toBeGreaterThan(median(early));
  });

  it("early game is fast: Lv 1–5 requires ≤10 kills per level", () => {
    for (let lv = 1; lv <= 5; lv++) {
      expect(killsPerLevel[lv - 1]!).toBeLessThanOrEqual(10);
    }
  });

  it("Heartland grind: Lv 10–25 requires 8–15 kills per level", () => {
    for (let i = 9; i <= 24; i++) {
      const kills = killsPerLevel[i]!;
      expect(kills).toBeGreaterThanOrEqual(8);
      expect(kills).toBeLessThanOrEqual(15);
    }
  });

  it("expansion grind: Lv 30–49 requires 17–27 kills per level", () => {
    for (let i = 29; i <= 48; i++) {
      const kills = killsPerLevel[i]!;
      expect(kills).toBeGreaterThanOrEqual(17);
      expect(kills).toBeLessThanOrEqual(27);
    }
  });

  it("late game: Lv 55–69 requires 19–35 kills per level", () => {
    for (let i = 54; i <= 68; i++) {
      const kills = killsPerLevel[i]!;
      expect(kills).toBeGreaterThanOrEqual(19);
      expect(kills).toBeLessThanOrEqual(35);
    }
  });

  it("EXP curve is strictly increasing below MAX_LEVEL", () => {
    for (let lv = 1; lv < 69; lv++) {
      expect(expForLevel(lv)).toBeLessThan(expForLevel(lv + 1));
    }
  });

  it("every level 1–69 has a valid mob to grind", () => {
    for (let lv = 1; lv <= 69; lv++) {
      const mob = bestMobForLevel(lv);
      expect(mob).toBeDefined();
      expect(mob.exp).toBeGreaterThan(0);
    }
  });

  // ── Region coverage audit ───────────────────────────────────────────────

  it("Dawn Isle (Lv 1-3) has mobs covering the band", () => {
    const dawnMobs = Object.values(MOBS).filter((m) => !m.isBoss && m.level >= 1 && m.level <= 3);
    expect(dawnMobs.length).toBeGreaterThanOrEqual(3);
  });

  it("Heartland Lv 4-12 has mobs covering the band", () => {
    const heartlandMobs = Object.values(MOBS).filter(
      (m) => !m.isBoss && m.level >= 4 && m.level <= 12,
    );
    expect(heartlandMobs.length).toBeGreaterThanOrEqual(4);
  });

  it("Craghold/Sylvanreach/Dusk Ward Lv 10-19 has mobs", () => {
    const midMobs = Object.values(MOBS).filter((m) => !m.isBoss && m.level >= 10 && m.level <= 19);
    expect(midMobs.length).toBeGreaterThanOrEqual(6);
  });

  it("Mirefen Lv 20-30 has mobs covering the band", () => {
    const mirefenMobs = Object.values(MOBS).filter(
      (m) => !m.isBoss && m.level >= 20 && m.level <= 30,
    );
    expect(mirefenMobs.length).toBeGreaterThanOrEqual(4);
  });

  it("Skyhaven Lv 30-40 has mobs covering the band", () => {
    const skyMobs = Object.values(MOBS).filter((m) => !m.isBoss && m.level >= 30 && m.level <= 40);
    expect(skyMobs.length).toBeGreaterThanOrEqual(3);
  });

  it("Frosthold Lv 35-60 has mobs covering the band", () => {
    const frostMobs = Object.values(MOBS).filter(
      (m) => !m.isBoss && m.level >= 35 && m.level <= 60,
    );
    expect(frostMobs.length).toBeGreaterThanOrEqual(5);
  });

  // ── Detailed curve table (for debugging / documentation) ────────────────

  it("prints the kills-per-level table (informational)", () => {
    const lines: string[] = [
      "Lv | EXP Needed | Best Mob          | Mob EXP | Kills",
      "---|------------|-------------------|---------|------",
    ];
    for (let lv = 1; lv <= 69; lv++) {
      const expNeeded = expForLevel(lv);
      const mob = bestMobForLevel(lv);
      const kills = killsPerLevel[lv - 1]!;
      lines.push(
        `${String(lv).padStart(2)} | ${String(expNeeded).padStart(10)} | ${mob.id.padEnd(19)} | ${String(mob.exp).padStart(7)} | ${String(kills).padStart(5)}`,
      );
    }
    console.log("\n" + lines.join("\n"));
    expect(true).toBe(true);
  });
});
