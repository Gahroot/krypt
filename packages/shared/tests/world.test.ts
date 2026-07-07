import { describe, it, expect } from "vitest";
import {
  groundYAt,
  findFootholdBelow,
  ladderAt,
  clampXByWalls,
  MEADOWFIELD,
  DAWN_ISLE,
  HEARTLAND_HARBOR,
  MAPS,
  getMap,
  type Foothold,
  type Wall,
} from "../src/world.js";
import { getMobDef } from "../src/mobs.js";

// ---------------------------------------------------------------------------
// groundYAt
// ---------------------------------------------------------------------------
describe("groundYAt", () => {
  it("returns y1 at the left edge of a flat segment", () => {
    const flat: Foothold = { id: 99, x1: 100, y1: 400, x2: 500, y2: 400 };
    expect(groundYAt(flat, 100)).toBe(400);
  });

  it("returns y2 at the right edge of a flat segment", () => {
    const flat: Foothold = { id: 99, x1: 100, y1: 400, x2: 500, y2: 400 };
    expect(groundYAt(flat, 500)).toBe(400);
  });

  it("interpolates linearly on a slope", () => {
    // slope: (0, 100) → (100, 200)  → midpoint at x=50 should be y=150
    const slope: Foothold = { id: 99, x1: 0, y1: 100, x2: 100, y2: 200 };
    expect(groundYAt(slope, 50)).toBe(150);
  });

  it("clamps below x1", () => {
    const fh: Foothold = { id: 99, x1: 100, y1: 300, x2: 200, y2: 400 };
    expect(groundYAt(fh, 0)).toBe(300);
  });

  it("clamps above x2", () => {
    const fh: Foothold = { id: 99, x1: 100, y1: 300, x2: 200, y2: 400 };
    expect(groundYAt(fh, 999)).toBe(400);
  });

  it("handles degenerate vertical segment (x1 === x2)", () => {
    const vert: Foothold = { id: 99, x1: 100, y1: 200, x2: 100, y2: 500 };
    expect(groundYAt(vert, 100)).toBe(200); // returns min(y1, y2)
  });

  it("works on the Meadowfield ground foothold", () => {
    const ground = MEADOWFIELD.footholds[0]!;
    // At x=0 → y1 (750); at x=1600 → y2 (800)
    expect(groundYAt(ground, 0)).toBe(750);
    expect(groundYAt(ground, 1600)).toBe(800);
    // Midpoint → average
    expect(groundYAt(ground, 800)).toBe(775);
  });
});

// ---------------------------------------------------------------------------
// findFootholdBelow
// ---------------------------------------------------------------------------
describe("findFootholdBelow", () => {
  it("returns the ground foothold when standing on it", () => {
    const ground = MEADOWFIELD.footholds[0]!;
    const result = findFootholdBelow(MEADOWFIELD, 400, ground.y1 - 1);
    expect(result?.id).toBe(ground.id);
  });

  it("returns the closest foothold below a point", () => {
    // Point above mid-platform (id 1, y=540, x 400–900)
    const result = findFootholdBelow(MEADOWFIELD, 600, 500);
    expect(result?.id).toBe(1);
  });

  it("returns undefined when x is outside all foothold ranges", () => {
    // x=1700 is beyond any foothold
    const result = findFootholdBelow(MEADOWFIELD, 1700, 100);
    expect(result).toBeUndefined();
  });

  it("picks the nearest foothold below when multiple overlap vertically", () => {
    // Directly above upper-platform (id 2, y=360) at x=600 —
    // both mid-platform (y=540) and ground (y~775) are also below,
    // but upper-platform (y=360) is the nearest below a point at y=350.
    const result = findFootholdBelow(MEADOWFIELD, 600, 350);
    expect(result?.id).toBe(2);
  });

  it("skips footholds whose x-range doesn't contain x", () => {
    // x=300 is only on ground (0–1600) and upper-platform (300–1000),
    // but NOT on mid-platform (400–900).
    // Point at y=350: upper-platform (id 2, y=360) is below.
    const result = findFootholdBelow(MEADOWFIELD, 300, 350);
    expect(result?.id).toBe(2);
  });

  it("returns the ground when above it and no higher platform is in range", () => {
    // x=50 is only reachable from ground (0–1600)
    const ground = MEADOWFIELD.footholds[0]!;
    const result = findFootholdBelow(MEADOWFIELD, 50, 700);
    expect(result?.id).toBe(ground.id);
  });
});

// ---------------------------------------------------------------------------
// ladderAt
// ---------------------------------------------------------------------------
describe("ladderAt", () => {
  it("finds a ladder when within tolerance and vertical range", () => {
    // Ladder id 0: x=450, yTop=540, yBottom=750
    const result = ladderAt(MEADOWFIELD, 450, 650);
    expect(result?.id).toBe(0);
  });

  it("returns undefined when x is outside tolerance", () => {
    // Ladder id 0 at x=450; check at x=500 with tol=24 → |diff|=50 > 24
    const result = ladderAt(MEADOWFIELD, 500, 650, 24);
    expect(result).toBeUndefined();
  });

  it("returns undefined when y is outside the ladder span", () => {
    // Ladder id 0: yTop=540, yBottom=750. y=500 is above the top.
    const result = ladderAt(MEADOWFIELD, 450, 500);
    expect(result).toBeUndefined();
  });

  it("respects custom tolerance", () => {
    // Ladder id 0 at x=450; check at x=470 with tol=30 → should find it
    const result = ladderAt(MEADOWFIELD, 470, 650, 30);
    expect(result?.id).toBe(0);
  });

  it("finds ropes by kind", () => {
    // Rope id 3: x=1100, yTop=360, yBottom=480
    const result = ladderAt(MEADOWFIELD, 1100, 420);
    expect(result?.kind).toBe("rope");
    expect(result?.id).toBe(3);
  });

  it("does not match a ladder outside vertical range even at correct x", () => {
    // Ladder id 1: x=650, yTop=360, yBottom=540. y=600 is below bottom.
    const result = ladderAt(MEADOWFIELD, 650, 600);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Map registry & portal integrity
// ---------------------------------------------------------------------------

describe("town has no hostile mob spawns", () => {
  it("heartland_harbor spawns array is empty", () => {
    expect(HEARTLAND_HARBOR.spawns).toHaveLength(0);
  });
});

describe("MAPS registry", () => {
  it("contains all three maps", () => {
    expect(MAPS["dawn_isle"]).toBe(DAWN_ISLE);
    expect(MAPS["heartland_harbor"]).toBe(HEARTLAND_HARBOR);
    expect(MAPS["meadowfield"]).toBe(MEADOWFIELD);
  });

  it("getMap returns the correct map or undefined", () => {
    expect(getMap("dawn_isle")).toBe(DAWN_ISLE);
    expect(getMap("nope")).toBeUndefined();
  });
});

describe("portal integrity", () => {
  for (const [mapId, gameMap] of Object.entries(MAPS)) {
    for (const portal of gameMap.portals) {
      it(`${mapId}.${portal.id} → ${portal.toMapId} resolves to a valid map`, () => {
        expect(
          MAPS[portal.toMapId],
          `Portal "${portal.id}" on "${mapId}" points to unknown map "${portal.toMapId}"`,
        ).toBeDefined();
      });

      if (portal.toSpawnId) {
        it(`${mapId}.${portal.id} → spawn "${portal.toSpawnId}" exists in ${portal.toMapId}`, () => {
          const dest = MAPS[portal.toMapId]!;
          expect(
            dest.spawnPoints[portal.toSpawnId!],
            `Portal "${portal.id}" on "${mapId}" references spawn "${portal.toSpawnId}" not found in "${portal.toMapId}"`,
          ).toBeDefined();
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Spawn ↔ MOBS consistency
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// clampXByWalls
// ---------------------------------------------------------------------------
describe("clampXByWalls", () => {
  const wall: Wall = { id: 0, x: 200, y1: 100, y2: 500 };

  it("blocks crossing from left to right", () => {
    // Player at x=150, moving right to x=210 → should be clamped to 199
    expect(clampXByWalls([wall], 150, 210, 300)).toBe(199);
  });

  it("blocks crossing from right to left", () => {
    // Player at x=250, moving left to x=190 → should be clamped to 201
    expect(clampXByWalls([wall], 250, 190, 300)).toBe(201);
  });

  it("does not block movement on the same side of the wall", () => {
    // Player at x=150, moving to x=180 (both left of wall) → no block
    expect(clampXByWalls([wall], 150, 180, 300)).toBe(180);
  });

  it("does not block when y is outside the wall's vertical range", () => {
    // Wall spans y=100–500; player at y=50 (above wall) can cross freely
    expect(clampXByWalls([wall], 150, 210, 50)).toBe(210);
    // Player at y=600 (below wall) can cross freely
    expect(clampXByWalls([wall], 150, 210, 600)).toBe(210);
  });

  it("allows standing at wall edge and moving away", () => {
    // Player at x=199 (just left of wall), moving left to x=180 → no block
    expect(clampXByWalls([wall], 199, 180, 300)).toBe(180);
    // Player at x=201 (just right of wall), moving right to x=220 → no block
    expect(clampXByWalls([wall], 201, 220, 300)).toBe(220);
  });

  it("returns the same position when no walls exist", () => {
    expect(clampXByWalls([], 150, 210, 300)).toBe(210);
  });

  it("handles multiple walls (blocks at first intersected wall)", () => {
    const walls: Wall[] = [
      { id: 0, x: 150, y1: 0, y2: 600 },
      { id: 1, x: 250, y1: 0, y2: 600 },
    ];
    // From x=100 to x=300 — hits wall at 150 first → clamped to 149
    expect(clampXByWalls(walls, 100, 300, 300)).toBe(149);
  });

  it("works with Dawn Isle walls from map data", () => {
    const walls = DAWN_ISLE.walls!;
    expect(walls.length).toBeGreaterThan(0);
    // Left cliff wall at x=70, y1=120, y2=580
    // Player at x=60 walking right at y=300 → should be blocked at 69
    expect(clampXByWalls(walls, 60, 80, 300)).toBe(69);
  });
});

describe("every spawn.mobId resolves via getMobDef", () => {
  for (const [mapId, gameMap] of Object.entries(MAPS)) {
    for (const spawn of gameMap.spawns) {
      it(`${mapId} spawn mobId "${spawn.mobId}" exists in MOBS`, () => {
        expect(
          getMobDef(spawn.mobId),
          `Map "${mapId}" spawns mob "${spawn.mobId}" which is not defined in MOBS`,
        ).toBeDefined();
      });
    }
  }
});
