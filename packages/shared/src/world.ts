/**
 * World geometry — multi-map registry for CryptoMaple zones.
 *
 * Single source of truth for all platform / ladder / portal / spawn data.
 * Imported by both the authoritative Colyseus server and the Phaser client.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Visual-set identifier for biome-specific parallax backgrounds and terrain palettes. */
export type BiomeVisualSet =
  | "pastoral"
  | "forest"
  | "rocky"
  | "urban"
  | "swamp"
  | "market"
  | "sky"
  | "snow"
  | "underground"
  | "underwater"
  | "jungle";

/** A vertical collision segment — blocks horizontal movement within its height range. */
export interface Wall {
  readonly id: number;
  /** Horizontal position of the wall (single-pixel-thick line). */
  readonly x: number;
  /** World-space y of the wall's top edge (smaller y = higher on screen). */
  readonly y1: number;
  /** World-space y of the wall's bottom edge. */
  readonly y2: number;
}

/** A walkable platform segment (flat or gently sloped). */
export interface Foothold {
  readonly id: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** If true, this foothold cannot be dropped through (e.g. the ground floor). */
  readonly solid?: boolean;
  /** If true, the foothold is icy — the player slides/has reduced traction. */
  readonly slippery?: boolean;
}

/** Climbable vertical structure (ladder or rope). */
export interface Ladder {
  readonly id: number;
  /** Horizontal centre of the ladder. */
  readonly x: number;
  /** World-space y of the top rung (smaller y = higher on screen). */
  readonly yTop: number;
  /** World-space y of the bottom rung. */
  readonly yBottom: number;
  readonly kind: "ladder" | "rope";
}

/** Where a specific mob type spawns on a particular foothold. */
export interface MobSpawnZone {
  readonly footholdId: number;
  readonly mobId: string;
  readonly count: number;
}

/** A boss mob that spawns on a timed interval (field bosses) or via item summon. */
export interface BossSpawnZone extends MobSpawnZone {
  /** Interval in ms between timed respawns. Omit for item-summoned bosses. */
  readonly respawnIntervalMs?: number;
}

/** A portal linking two maps at a given position. */
export interface Portal {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly toMapId: string;
  readonly toSpawnId?: string;
  readonly label: string;
  readonly requiresLevel?: number;
  /** When true the destination zone is not yet available in the alpha. */
  readonly comingSoon?: boolean;
  /**
   * When present the portal represents a scheduled transport (airship, boat,
   * train) rather than an instant warp. The server must gate boarding so that
   * players can only use the portal while a transport window is active.
   *
   * Scheduling model (server-side):
   *  - Pick an epoch (e.g. server start time) and compute:
   *    `phase = (Date.now() - epoch) % intervalMs`
   *  - The transport is *boarding* when `phase < windowMs`.
   *  - During boarding the server accepts the teleport; outside the window
   *    the portal is visible but returns an "awaiting departure" message.
   *  - When the window closes, teleport all boarded players simultaneously.
   */
  readonly schedule?: {
    /** How often the transport departs (ms). E.g. 300_000 = every 5 min. */
    readonly intervalMs: number;
    /** How long the boarding window stays open before departure (ms). */
    readonly windowMs: number;
  };
}

/** Full map definition for any zone. */
export interface GameMap {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly footholds: readonly Foothold[];
  readonly ladders: readonly Ladder[];
  readonly spawns: readonly MobSpawnZone[];
  readonly portals: readonly Portal[];
  /** Named spawn points; playerSpawn is the default respawn location. */
  readonly spawnPoints: Record<string, { readonly x: number; readonly y: number }>;
  readonly playerSpawn: { readonly x: number; readonly y: number };
  /** Vertical collision segments that block horizontal movement. */
  readonly walls?: readonly Wall[];
  /** Boss encounters that require special spawn conditions (timed, item-summoned). */
  readonly bossSpawns?: readonly BossSpawnZone[];
  /** When true the map is underwater — swimming physics apply (reduced gravity, free vertical movement). */
  readonly swimming?: boolean;
  /** Audio key for this map's region background music. Omit for silence. */
  readonly bgmKey?: string;
  /** Visual-set key driving biome-specific parallax backgrounds and terrain palette. Default: "pastoral". */
  readonly bgSet?: BiomeVisualSet;
}

/** @deprecated Use {@link GameMap} directly. Kept for backward compat. */
export type MeadowfieldMap = GameMap;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Interpolate the ground y-position along a foothold at the given world x.
 *
 * Works for both flat (y1 === y2) and gently sloped segments.
 * When `x` is outside the segment's horizontal range the closest endpoint y
 * is returned (clamped).
 */
export function groundYAt(fh: Foothold, x: number): number {
  if (fh.x1 === fh.x2) return Math.min(fh.y1, fh.y2); // degenerate vertical → top edge
  const t = clamp((x - fh.x1) / (fh.x2 - fh.x1), 0, 1);
  return fh.y1 + t * (fh.y2 - fh.y1);
}

/**
 * Find the nearest foothold whose x-range contains `x` and whose y is at or
 * below the given point (useful for landing / gravity resolution).
 *
 * When multiple candidates exist the one closest to `y` (smallest vertical gap)
 * is returned.
 */
export function findFootholdBelow(map: GameMap, x: number, y: number): Foothold | undefined {
  let best: Foothold | undefined;
  let bestDist = Infinity;

  for (const fh of map.footholds) {
    const minX = Math.min(fh.x1, fh.x2);
    const maxX = Math.max(fh.x1, fh.x2);
    if (x < minX || x > maxX) continue;

    const groundY = groundYAt(fh, x);
    // Must be at or below the point (remember screen-y increases downward).
    if (groundY < y) continue;

    const dist = groundY - y;
    if (dist < bestDist) {
      bestDist = dist;
      best = fh;
    }
  }

  return best;
}

/**
 * Find a ladder whose horizontal centre is within `tol` pixels of `x` and
 * whose vertical span includes `y`.
 */
export function ladderAt(map: GameMap, x: number, y: number, tol = 24): Ladder | undefined {
  for (const lad of map.ladders) {
    if (Math.abs(lad.x - x) > tol) continue;
    if (y >= lad.yTop && y <= lad.yBottom) return lad;
  }
  return undefined;
}

/**
 * Clamp a horizontal position so it does not cross any wall segment.
 *
 * Given the player/mob moved from `prevX` to `newX` at height `y`, return the
 * clamped x that does not pass through any wall whose vertical span includes `y`.
 * The result sits 1 px on the safe side of any intersected wall so the entity
 * never rests exactly on the wall pixel (preventing sticky-corner edge cases).
 */
export function clampXByWalls(
  walls: readonly Wall[],
  prevX: number,
  newX: number,
  y: number,
): number {
  let result = newX;
  for (const w of walls) {
    if (y < w.y1 || y > w.y2) continue;
    // Crossing from left to right through the wall.
    if (prevX < w.x && result >= w.x) {
      result = w.x - 1;
    }
    // Crossing from right to left through the wall.
    else if (prevX > w.x && result <= w.x) {
      result = w.x + 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Dawn Isle — pastoral tutorial zone (Maple Island parity) Lv 1–10
// ---------------------------------------------------------------------------
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ─────────────────────────────────────────────── 1600
//   │ ┌──────┐ y=120                                    │
//   │ │GUIDE │                       ┌─────┐ y=240      │  ← Split Road of Destiny:
//   │ └──────┘            ┌────┐ ARC │ a fork in the road,
//   │  ║                  │MAGE│y=320 └─────┘ ┌────┐    │   each instructor on
//   │  ║L            ┌────┐      y=320 │THIEF│ │      │   their own branch ledge.
//   │  ║A    ┌────┐  │ /\ │      ┌────┐      │  ╔═══╗   │
//   │  ║D    │WAR │ y=400         │PIR │y=400 ║DOCK║   │
//   │  ║     └────┘ ┌──────────────────┐ y=470 ╚═══╝   │
//   │  ║       ╔══╗ │   FORK BASE PLAZA│  ╔══╗  y=500   │
//   │  ╚══╗    ╚══╝ └──────────────────┘  ╚══╝          │
//   └──────────────────────┬───────────────────────────┘
//      GROUND PLAT  y=580                              700
//   0 ─────────────────────────────────────────────── 1600
//
// Zones: guide-NPC ledge (upper-left), the Split Road of Destiny — a forking
//        road where each of the five job instructors stands on their own
//        distinct alcove/branch ledge (a class signpost in living form) — and
//        the ferry dock (far right) → Heartland Harbor.

const DAWN_GROUND_Y = 580;

const DAWN_ISLE_SPAWNS: readonly MobSpawnZone[] = [
  // Friendly snails on the ground — easiest targets
  { footholdId: 0, mobId: "mob.friendly_snail", count: 5 },
  // Green puffs roaming the fork-base plaza — slightly harder
  { footholdId: 2, mobId: "mob.green_puff", count: 3 },
  // Dawn shrooms near the guide ledge — toughest starter mob
  { footholdId: 1, mobId: "mob.dawn_shroom", count: 2 },
];

export const DAWN_ISLE: GameMap = {
  id: "dawn_isle",
  name: "Dawn Isle",
  bgmKey: "town",
  bgSet: "pastoral",
  width: 1600,
  height: 700,

  footholds: [
    // Ground floor (flat)
    { id: 0, x1: 0, y1: DAWN_GROUND_Y, x2: 1600, y2: DAWN_GROUND_Y, solid: true },
    // Guide-NPC ledge (y=120, x 80–300) — the tutorial high ground (upper-left)
    { id: 1, x1: 80, y1: 120, x2: 300, y2: 120 },
    // Fork Base Plaza (y=470, x 360–1240) — where the Split Road of Destiny forks
    { id: 2, x1: 360, y1: 470, x2: 1240, y2: 470 },
    // Warrior alcove — left-low branch (y=400, x 260–420)
    { id: 3, x1: 260, y1: 400, x2: 420, y2: 400 },
    // Mage alcove — left-high branch (y=320, x 470–650)
    { id: 4, x1: 470, y1: 320, x2: 650, y2: 320 },
    // Archer alcove — centre peak branch (y=240, x 710–890)
    { id: 5, x1: 710, y1: 240, x2: 890, y2: 240 },
    // Thief alcove — right-high branch (y=320, x 950–1130)
    { id: 6, x1: 950, y1: 320, x2: 1130, y2: 320 },
    // Pirate alcove — right-low branch (y=400, x 1180–1340)
    { id: 7, x1: 1180, y1: 400, x2: 1340, y2: 400 },
    // Ferry dock platform (y=500, x 1420–1600)
    { id: 8, x1: 1420, y1: 500, x2: 1600, y2: 500 },
  ],

  ladders: [
    // Ground → guide ledge (far-left tutorial climb)
    { id: 0, x: 160, yTop: 120, yBottom: DAWN_GROUND_Y, kind: "ladder" },
    // Ground → fork base plaza (central Split Road climb)
    { id: 1, x: 800, yTop: 470, yBottom: DAWN_GROUND_Y, kind: "ladder" },
    // Fork base → warrior alcove (left-low branch)
    { id: 2, x: 390, yTop: 400, yBottom: 470, kind: "ladder" },
    // Fork base → mage alcove (left-high branch)
    { id: 3, x: 560, yTop: 320, yBottom: 470, kind: "ladder" },
    // Fork base → archer alcove (centre peak — continues the central spine)
    { id: 4, x: 800, yTop: 240, yBottom: 470, kind: "rope" },
    // Fork base → thief alcove (right-high branch)
    { id: 5, x: 1040, yTop: 320, yBottom: 470, kind: "ladder" },
    // Fork base → pirate alcove (right-low branch)
    { id: 6, x: 1210, yTop: 400, yBottom: 470, kind: "ladder" },
    // Ground → ferry dock (far right)
    { id: 7, x: 1480, yTop: 500, yBottom: DAWN_GROUND_Y, kind: "ladder" },
  ],

  spawns: DAWN_ISLE_SPAWNS,

  portals: [
    // Ferry to Heartland Harbor — requires Lv 10
    {
      id: "ferry_to_harbor",
      x: 1500,
      y: 500,
      toMapId: "heartland_harbor",
      toSpawnId: "dock",
      label: "⛵ Ferry to Tidewatch Harbor",
      requiresLevel: 10,
    },
  ],

  spawnPoints: {
    // Where new characters appear on Dawn Isle
    arrival: { x: 200, y: DAWN_GROUND_Y - 40 },
    // Near the guide NPC (upper-left ledge)
    guide: { x: 225, y: 120 - 40 },
    // Split Road of Destiny (fork base plaza, job instructors branch off above)
    split_road: { x: 800, y: 470 - 40 },
    // By the ferry dock (far right)
    dock: { x: 1500, y: 500 - 40 },
  },

  playerSpawn: { x: 200, y: DAWN_GROUND_Y - 40 },

  // ── Walls: cliff faces that block horizontal movement ─────────────────────
  walls: [
    // Left cliff face — prevents walking off the guide-ledge side above ground
    { id: 0, x: 70, y1: 120, y2: DAWN_GROUND_Y },
    // Right cliff face — separates mainland platforms from the ferry dock approach
    { id: 1, x: 1360, y1: 400, y2: DAWN_GROUND_Y },
  ],
};

// ---------------------------------------------------------------------------
// Heartland Harbor — arrival town (Lith Harbor parity / Tidewatch Harbor) Lv 10–15
// ---------------------------------------------------------------------------
//
// Visual layout:
//
//   0 ──────────────────────────── 1400
//   │   ┌──────────┐ y=200        │
//   │   │LOOKOUT   │              │
//   │   └──────────┘              │
//   │        ╔═══╗                │
//   │        ║ L ║ ┌────────────┐ │ y=400
//   │        ║ A ║ │  TOWN-PLT  │ │
//   │        ║ D ║ └────────────┘ │
//   │        ╚═══╝                │
//   └──┬──────────────────────────┘
//      │  DOCK-PLT   y=620        800
//   0 ──────────────────────────── 1400
//
// Player arrives at the dock (bottom-left) and can head right into town.
// Portal on the right side leads to Meadowfield.

const HARBOR_GROUND_Y = 620;

// Safe town — zero hostile mob spawns.
const HEARTLAND_HARBOR_SPAWNS: readonly MobSpawnZone[] = [];

export const HEARTLAND_HARBOR: GameMap = {
  id: "heartland_harbor",
  name: "Tidewatch Harbor",
  bgmKey: "town",
  bgSet: "pastoral",
  width: 1400,
  height: 800,

  footholds: [
    // Ground / dock level (flat)
    { id: 0, x1: 0, y1: HARBOR_GROUND_Y, x2: 1400, y2: HARBOR_GROUND_Y, solid: true },
    // Town platform (y=400, x 400–1100)
    { id: 1, x1: 400, y1: 400, x2: 1100, y2: 400 },
    // Lookout / upper walkway (y=200, x 200–600)
    { id: 2, x1: 200, y1: 200, x2: 600, y2: 200 },
  ],

  ladders: [
    // Dock → town platform
    { id: 0, x: 500, yTop: 400, yBottom: HARBOR_GROUND_Y, kind: "ladder" },
    // Town → lookout
    { id: 1, x: 400, yTop: 200, yBottom: 400, kind: "ladder" },
  ],

  spawns: HEARTLAND_HARBOR_SPAWNS,

  portals: [
    // Portal onward to Meadowfield
    {
      id: "to_meadowfield",
      x: 1250,
      y: HARBOR_GROUND_Y - 40,
      toMapId: "meadowfield",
      toSpawnId: "east_gate",
      label: "🌿 Road to Meadowfield",
    },
    // Path to Crossway hub (left side of dock)
    {
      id: "to_crossway",
      x: 300,
      y: HARBOR_GROUND_Y - 40,
      toMapId: "crossway",
      toSpawnId: "from_harbor",
      label: "🌳 Crossway Hub",
    },
    // Entrance to the Harbor Docks combat zone (right side of dock)
    {
      id: "to_docks",
      x: 1100,
      y: HARBOR_GROUND_Y - 40,
      toMapId: "harbor_docks",
      toSpawnId: "entry",
      label: "⚔️ Harbor Docks",
    },
  ],

  spawnPoints: {
    // Where the ferry drops you off
    dock: { x: 200, y: HARBOR_GROUND_Y - 40 },
    // Centre of town
    town: { x: 750, y: 400 - 40 },
    // Near the lookout
    lookout: { x: 400, y: 200 - 40 },
    // Arriving from Crossway
    from_crossway: { x: 300, y: HARBOR_GROUND_Y - 40 },
  },

  playerSpawn: { x: 200, y: HARBOR_GROUND_Y - 40 },
};

// ---------------------------------------------------------------------------
// Harbor Docks — bilge & dock combat zone Lv 4–10
// ---------------------------------------------------------------------------
//
// A grimy, plank-by-plank combat zone along the harbor waterfront. Rusted
// chain fences, barnacle-encrusted pilings, and stacked cargo crates create
// a vertically layered dock. Rat swarms infest the lower bilge; ghostly
// deckhand specters haunt the upper rigging.
//
// Visual layout:
//
//   0 ──────────────────────────── 1400
//   │    ┌──────────┐ y=160          │
//   │    │ CROW'S   │  (rigging)
//   │    │ NEST     │
//   │    └──────────┘
//   │  ╔══╗ ┌──────────┐ y=320      │
//   │  ║RP║ │ UPPER    │           │
//   │  ╚══╝ │ DECK    │           │
//   │       └──────────┘           │
//   │  ╔══╗  ┌────────────┐ y=480 │
//   │  ║LD║  │ CRATE ROW  │      │
//   │  ╚══╝  └────────────┘      │
//   │       ╔══╗                  │
//   │       ║LD║                  │
//   │       ╚══╝                  │
//   └──────────┬──────────────────┘
//      BILGE PLANKS  y=640        1400
//   0 ────────────────────────────
//
// Waterlogged wooden planks along the waterfront. Crates and coils of rope
// form mid-tier platforms. Ghostly crew haunt the upper deck.

const HARBOR_DOCKS_GROUND_Y = 640;

export const HARBOR_DOCKS: GameMap = {
  id: "harbor_docks",
  name: "Harbor Docks",
  bgmKey: "field",
  bgSet: "pastoral",
  width: 1400,
  height: 720,

  footholds: [
    // ── Bilge planks (ground level — waterlogged wood) ──────────────────
    { id: 0, x1: 0, y1: HARBOR_DOCKS_GROUND_Y, x2: 1400, y2: HARBOR_DOCKS_GROUND_Y, solid: true },

    // ── Crate row (y≈480, x 200–1100) — stacked cargo crates ────────────
    { id: 1, x1: 200, y1: 480, x2: 1100, y2: 480 },

    // ── Upper deck (y≈320, x 300–1000) — old ship planking ──────────────
    { id: 2, x1: 300, y1: 320, x2: 1000, y2: 320 },

    // ── Crow's nest (y≈160, x 400–700) — highest lookout point ─────────
    { id: 3, x1: 400, y1: 160, x2: 700, y2: 160 },

    // ── Side pier (y≈540, x 1100–1350) — narrow side platform ───────────
    { id: 4, x1: 1100, y1: 540, x2: 1350, y2: 540 },
  ],

  ladders: [
    // Bilge planks → crate row (left)
    { id: 0, x: 350, yTop: 480, yBottom: HARBOR_DOCKS_GROUND_Y, kind: "ladder" },

    // Bilge planks → crate row (centre)
    { id: 1, x: 750, yTop: 480, yBottom: HARBOR_DOCKS_GROUND_Y, kind: "ladder" },

    // Crate row → upper deck (centre)
    { id: 2, x: 600, yTop: 320, yBottom: 480, kind: "ladder" },

    // Upper deck → crow's nest (centre)
    { id: 3, x: 550, yTop: 160, yBottom: 320, kind: "rope" },

    // Crate row → side pier (right)
    { id: 4, x: 1050, yTop: 480, yBottom: 540, kind: "rope" },

    // Side pier → bilge planks (far right)
    { id: 5, x: 1250, yTop: 540, yBottom: HARBOR_DOCKS_GROUND_Y, kind: "ladder" },
  ],

  spawns: [
    // Dock rats swarming the bilge planks
    { footholdId: 0, mobId: "mob.dock_rat", count: 7 },
    // Barnacle crabs skittering among the crates
    { footholdId: 1, mobId: "mob.barnacle_crab", count: 5 },
    // Harbor gulls circling the upper deck
    { footholdId: 2, mobId: "mob.harbor_gull", count: 4 },
    // Deckhand specters haunting the crow's nest
    { footholdId: 3, mobId: "mob.deckhand_specter", count: 3 },
    // Bilge rats on the side pier
    { footholdId: 4, mobId: "mob.bilge_rat", count: 3 },
  ],

  portals: [
    // Back to Tidewatch Harbor town
    {
      id: "return_to_harbor",
      x: 100,
      y: HARBOR_DOCKS_GROUND_Y - 40,
      toMapId: "heartland_harbor",
      toSpawnId: "dock",
      label: "⚓ Return to Tidewatch Harbor",
    },
  ],

  spawnPoints: {
    // Entry from the harbor town waterfront
    entry: { x: 100, y: HARBOR_DOCKS_GROUND_Y - 40 },
    // Crate row landing
    crate_row: { x: 650, y: 480 - 40 },
  },

  playerSpawn: { x: 100, y: HARBOR_DOCKS_GROUND_Y - 40 },

  // ── Walls: dock structures that block horizontal movement ──────────────────
  walls: [
    // Left dock wall — cliff face at the dock's left boundary
    { id: 0, x: 40, y1: 160, y2: HARBOR_DOCKS_GROUND_Y },
    // Right cargo wall — vertical barrier near the crate row / upper deck edge
    { id: 1, x: 1080, y1: 320, y2: 480 },
  ],
};

// ---------------------------------------------------------------------------
// Meadowfield — pastoral starter town (Henesys parity) Lv 10–20
// ---------------------------------------------------------------------------
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────────────── 1600
//   │            ┌──────────┐  y=180       │
//   │            │ TOP-PLAT │              │
//   │            └──────────┘              │
//   │     ╔═══╗                            │
//   │     ║ L ║ ┌─────────────────┐ y=360  │
//   │     ║ A ║ │   UPPER-PLAT    │        │
//   │     ║ D ║ └─────────────────┘        │
//   │     ╚═══╝                            │
//   │          ┌──────────────┐  y=540     │
//   │          │  MID-PLAT    │            │
//   │          └──────────────┘            │
//   │     ╔═══╗  ╔═══╗                    │
//   │     ║ L ║  ║ R ║                    │
//   │     ║ A ║  ║ O ║                    │
//   │     ║ D ║  ║ P ║                    │
//   │     ╚═══╝  ╚═══╝                    │
//   └────────────┬────────────────────────┘
//          GROUND PLAT  y=780  (slope: left high → right low)
//   0 ──────────────────────────────────── 1600
//                                             900
// ---------------------------------------------------------------------------

const GROUND_Y_LEFT = 750;
const GROUND_Y_RIGHT = 800; // gentle slope down to the right

export const MEADOWFIELD: GameMap = {
  id: "meadowfield",
  name: "Meadowfield",
  bgmKey: "field",
  bgSet: "pastoral",
  width: 1600,
  height: 900,

  footholds: [
    // ── Ground floor (gentle slope left → right) ───────────────────────
    { id: 0, x1: 0, y1: GROUND_Y_LEFT, x2: 1600, y2: GROUND_Y_RIGHT, solid: true },

    // ── Mid platform (y≈540, x 400–900) ───────────────────────────────
    { id: 1, x1: 400, y1: 540, x2: 900, y2: 540 },

    // ── Upper platform (y≈360, x 300–1000) ────────────────────────────
    { id: 2, x1: 300, y1: 360, x2: 1000, y2: 360 },

    // ── Top platform (y≈180, x 550–850) ───────────────────────────────
    { id: 3, x1: 550, y1: 180, x2: 850, y2: 180 },

    // ── Small ledge on the far right (bonus, y≈480) ────────────────────
    { id: 4, x1: 1200, y1: 480, x2: 1500, y2: 480 },
  ],

  ladders: [
    // Ground → Mid (left side)
    { id: 0, x: 450, yTop: 540, yBottom: GROUND_Y_LEFT, kind: "ladder" },

    // Mid → Upper (centre)
    { id: 1, x: 650, yTop: 360, yBottom: 540, kind: "ladder" },

    // Upper → Top (centre-left)
    { id: 2, x: 580, yTop: 180, yBottom: 360, kind: "ladder" },

    // Rope: Upper right → far-right ledge
    { id: 3, x: 1100, yTop: 360, yBottom: 480, kind: "rope" },
  ],

  spawns: [
    // Green mushrooms on the ground (easiest — entry-level for Lv 10 arrivals)
    { footholdId: 0, mobId: "mob.green_mushroom", count: 4 },
    // Mushrooms mixing on the ground (Lv 12)
    { footholdId: 0, mobId: "mob.mushroom", count: 4 },
    // Mushrooms on the mid platform (Lv 12)
    { footholdId: 1, mobId: "mob.mushroom", count: 3 },
    // Meadow beetles on the mid platform (Lv 16)
    { footholdId: 1, mobId: "mob.meadow_beetle", count: 3 },
    // Thornback hoppers on the upper platform (Lv 18)
    { footholdId: 2, mobId: "mob.thornback_hopper", count: 3 },
    // Crows and feral bunnies on the top (Lv 12–14)
    { footholdId: 3, mobId: "mob.crow", count: 2 },
    { footholdId: 3, mobId: "mob.feral_bunny", count: 3 },
    // Meadow beetles patrolling the far ledge (Lv 16)
    { footholdId: 4, mobId: "mob.meadow_beetle", count: 3 },
  ],

  portals: [
    // Portal back to Dawn Isle (ferry return)
    {
      id: "return_to_dawn",
      x: 150,
      y: GROUND_Y_LEFT - 40,
      toMapId: "dawn_isle",
      toSpawnId: "dock",
      label: "⛵ Return to Dawn Isle",
    },
    // Portal back to Tidewatch Harbor (town return)
    {
      id: "return_to_harbor",
      x: 1450,
      y: GROUND_Y_RIGHT - 40,
      toMapId: "heartland_harbor",
      toSpawnId: "dock",
      label: "⚓ Return to Tidewatch Harbor",
    },
    // Forest path to Sylvanreach (centre of the ground)
    {
      id: "to_sylvanreach",
      x: 800,
      y: (GROUND_Y_LEFT + GROUND_Y_RIGHT) / 2 - 40,
      toMapId: "sylvanreach",
      toSpawnId: "from_meadowfield",
      label: "🌲 Treetop Path to Sylvanreach",
    },
    // Rocky road to Craghold (left-centre of the ground)
    {
      id: "to_craghold",
      x: 500,
      y: (GROUND_Y_LEFT + GROUND_Y_RIGHT) / 2 - 40,
      toMapId: "craghold",
      toSpawnId: "from_meadowfield",
      label: "🏔️ Rocky Road to Craghold",
    },
    // Neon-lit tunnel to Dusk Ward (centre-right of the ground)
    {
      id: "to_dusk_ward",
      x: 1050,
      y: (GROUND_Y_LEFT + GROUND_Y_RIGHT) / 2 - 40,
      toMapId: "dusk_ward",
      toSpawnId: "from_meadowfield",
      label: "🌃 Subway to Dusk Ward",
    },
    // Path to Crossway hub (ground, far right)
    {
      id: "to_crossway",
      x: 1350,
      y: (GROUND_Y_LEFT + GROUND_Y_RIGHT) / 2 - 40,
      toMapId: "crossway",
      toSpawnId: "from_meadowfield",
      label: "🌳 Crossway Hub",
    },
  ],

  bossSpawns: [{ footholdId: 0, mobId: "mob.tidemaw", count: 1, respawnIntervalMs: 180_000 }],

  spawnPoints: {
    // Default entry from the harbor ferry (east side of map)
    east_gate: { x: 1400, y: GROUND_Y_RIGHT - 40 },
    // Default spawn / respawn
    village: { x: 200, y: GROUND_Y_LEFT - 40 },
    // Arriving from Crossway
    from_crossway: { x: 1300, y: (GROUND_Y_LEFT + GROUND_Y_RIGHT) / 2 - 40 },
  },

  playerSpawn: { x: 200, y: GROUND_Y_LEFT - 40 },

  // ── Walls: cliff faces that block horizontal movement ─────────────────────
  walls: [
    // Left cliff wall — prevents walking off the left side above ground
    { id: 0, x: 40, y1: 180, y2: GROUND_Y_LEFT },
    // Right cliff wall — near the harbor-portal approach
    { id: 1, x: 1560, y1: 480, y2: GROUND_Y_RIGHT },
  ],
};

// ---------------------------------------------------------------------------
// Sylvanreach — treetop forest city (Ellinia parity) Lv 10–20
// ---------------------------------------------------------------------------
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────── 1400
//   │       ┌──────┐  y=100        │
//   │       │CROWN │  fairy NPC    │
//   │       └──────┘               │
//   │     ╔══╗                    │
//   │     ║RP║ ┌──────────┐ y=260 │
//   │     ╚══╝ │ UPPER    │       │
//   │          │ TRUNK    │       │
//   │          └──────────┘       │
//   │  ╔══╗  ┌────────────┐ y=420 │
//   │  ║LD║  │  MAIN DECK │       │
//   │  ╚══╝  │  mage NPC  │       │
//   │        └────────────┘       │
//   │    ╔══╗  ┌───────────┐y=580 │
//   │    ║LD║  │ LOWER     │      │
//   │    ╚══╝  │ BRANCH    │      │
//   │          └───────────┘      │
//   │   ╔══╗ ╔══╗                │
//   │   ║LD║ ║RP║                │
//   │   ╚══╝ ╚══╝                │
//   └────┬───────────────────────┘
//        │  ROOT-BASE  y=760      1400
//   0 ────────────────────────────
//
// Treetop city built around a giant ancient tree. Players enter from the
// root base (left) via Meadowfield. Climbing ladders and ropes reveals
// progressively higher treetop platforms. Safe zone — zero mob spawns.

const SYLVAN_GROUND_Y = 760;

// Safe town — zero hostile mob spawns.
const SYLVANREACH_SPAWNS: readonly MobSpawnZone[] = [];

export const SYLVANREACH: GameMap = {
  id: "sylvanreach",
  name: "Sylvanreach",
  bgmKey: "forest",
  bgSet: "forest",
  width: 1400,
  height: 900,

  footholds: [
    // ── Root base / ground level ─────────────────────────────────────
    { id: 0, x1: 0, y1: SYLVAN_GROUND_Y, x2: 1400, y2: SYLVAN_GROUND_Y, solid: true },

    // ── Lower branch (y≈580, x 200–900) ────────────────────────────
    { id: 1, x1: 200, y1: 580, x2: 900, y2: 580 },

    // ── Main deck (y≈420, x 300–1000) — central town hub ───────────
    { id: 2, x1: 300, y1: 420, x2: 1000, y2: 420 },

    // ── Upper trunk (y≈260, x 400–800) ─────────────────────────────
    { id: 3, x1: 400, y1: 260, x2: 800, y2: 260 },

    // ── Crown platform (y≈100, x 500–700) — fairy NPC perch ────────
    { id: 4, x1: 500, y1: 100, x2: 700, y2: 100 },

    // ── Dock / exit platform (right side, y≈660) ────────────────────
    { id: 5, x1: 1100, y1: 660, x2: 1350, y2: 660 },
  ],

  ladders: [
    // Root base → lower branch (left)
    { id: 0, x: 350, yTop: 580, yBottom: SYLVAN_GROUND_Y, kind: "ladder" },

    // Lower branch → main deck (centre-left)
    { id: 1, x: 450, yTop: 420, yBottom: 580, kind: "ladder" },

    // Main deck → upper trunk (centre)
    { id: 2, x: 550, yTop: 260, yBottom: 420, kind: "ladder" },

    // Upper trunk → crown (centre)
    { id: 3, x: 600, yTop: 100, yBottom: 260, kind: "rope" },

    // Main deck → dock / exit platform (right)
    { id: 4, x: 1150, yTop: 420, yBottom: 660, kind: "rope" },
  ],

  spawns: SYLVANREACH_SPAWNS,

  portals: [
    // Path back to Meadowfield (root base, left side)
    {
      id: "return_to_meadowfield",
      x: 100,
      y: SYLVAN_GROUND_Y - 40,
      toMapId: "meadowfield",
      toSpawnId: "east_gate",
      label: "🌿 Forest Path to Meadowfield",
    },
    // Trail to Sylvanreach Canopy (exit platform, right side)
    {
      id: "to_canopy",
      x: 1250,
      y: 660 - 40,
      toMapId: "sylvanreach_canopy",
      toSpawnId: "entry",
      label: "🍃 Climb to the Canopy",
    },
    // Stairway down to Sylvanreach Roots (root base, right side)
    {
      id: "to_roots",
      x: 1100,
      y: SYLVAN_GROUND_Y - 40,
      toMapId: "sylvanreach_roots",
      toSpawnId: "entry",
      label: "🌿 Descend to the Roots",
    },
    // Path to Crossway hub (root base, left-centre)
    {
      id: "to_crossway",
      x: 200,
      y: SYLVAN_GROUND_Y - 40,
      toMapId: "crossway",
      toSpawnId: "from_sylvanreach",
      label: "🌳 Crossway Hub",
    },
  ],

  spawnPoints: {
    // Arriving from Meadowfield (root base, left)
    from_meadowfield: { x: 200, y: SYLVAN_GROUND_Y - 40 },
    // Central town hub (main deck)
    mage_hall: { x: 650, y: 420 - 40 },
    // Fairy NPC (crown platform)
    fairy_grove: { x: 600, y: 100 - 40 },
    // Exit to canopy fields (dock area)
    to_canopy: { x: 1250, y: 660 - 40 },
    // Exit to root fields (root base, right)
    to_roots: { x: 1100, y: SYLVAN_GROUND_Y - 40 },
    // Arriving from Crossway
    from_crossway: { x: 200, y: SYLVAN_GROUND_Y - 40 },
  },

  playerSpawn: { x: 200, y: SYLVAN_GROUND_Y - 40 },
};

// ---------------------------------------------------------------------------
// Sylvanreach Canopy — upper-branch combat zone Lv 10–15
// ---------------------------------------------------------------------------
//
// Visual layout:
//
//   0 ──────────────────────────── 1400
//   │   ┌────────┐ y=150          │
//   │   │HIGH-R │  (rope bridge)  │
//   │   └────────┘                 │
//   │        ┌──────────┐ y=300    │
//   │   ╔══╗ │ HIGH-L   │         │
//   │   ║RP║ └──────────┘         │
//   │   ╚══╝                      │
//   │  ┌─────────────────┐ y=480  │
//   │  │   MID CANOPY    │       │
//   │  └─────────────────┘       │
//   │ ╔══╗  ╔══╗                 │
//   │ ║LD║  ║RP║                 │
//   │ ╚══╝  ╚══╝                 │
//   └────────────┬────────────────┘
//       LOW BRANCH  y=620        1400
//   0 ────────────────────────────
//
// Leafy canopy combat zone. Three tiers of branches connected by
// ladders and rope bridges. Wisps and moths drift among the leaves.

export const SYLVANREACH_CANOPY: GameMap = {
  id: "sylvanreach_canopy",
  name: "Sylvanreach Canopy",
  bgmKey: "forest",
  bgSet: "forest",
  width: 1400,
  height: 700,

  footholds: [
    // ── Low branch (ground-level of canopy) ─────────────────────────
    { id: 0, x1: 0, y1: 620, x2: 1400, y2: 620, solid: true },

    // ── Mid canopy (y≈480, x 100–1100) ─────────────────────────────
    { id: 1, x1: 100, y1: 480, x2: 1100, y2: 480 },

    // ── High canopy left (y≈300, x 200–750) ────────────────────────
    { id: 2, x1: 200, y1: 300, x2: 750, y2: 300 },

    // ── High canopy right / rope bridge (y≈150, x 400–800) ──────────
    { id: 3, x1: 400, y1: 150, x2: 800, y2: 150 },
  ],

  ladders: [
    // Low branch → mid canopy (left)
    { id: 0, x: 200, yTop: 480, yBottom: 620, kind: "ladder" },

    // Mid canopy → high canopy left (centre-left)
    { id: 1, x: 400, yTop: 300, yBottom: 480, kind: "ladder" },

    // High canopy left → rope bridge (centre)
    { id: 2, x: 550, yTop: 150, yBottom: 300, kind: "rope" },

    // Mid canopy → far-right perch
    { id: 3, x: 1050, yTop: 480, yBottom: 620, kind: "rope" },
  ],

  spawns: [
    // Forest wisps along the mid canopy
    { footholdId: 1, mobId: "mob.forest_wisp", count: 5 },
    // Canopy moths on the high branches
    { footholdId: 2, mobId: "mob.canopy_moth", count: 4 },
    // Bark spiders near the rope bridge
    { footholdId: 3, mobId: "mob.bark_spider", count: 2 },
  ],

  bossSpawns: [{ footholdId: 3, mobId: "mob.rotwood", count: 1, respawnIntervalMs: 180_000 }],

  portals: [
    // Back to Sylvanreach town
    {
      id: "return_to_town",
      x: 50,
      y: 620 - 40,
      toMapId: "sylvanreach",
      toSpawnId: "to_canopy",
      label: "🏙️ Return to Sylvanreach",
    },
  ],

  spawnPoints: {
    // Entry from the town dock area
    entry: { x: 100, y: 620 - 40 },
    // Mid canopy landing
    mid_canopy: { x: 600, y: 480 - 40 },
  },

  playerSpawn: { x: 100, y: 620 - 40 },
};

// ---------------------------------------------------------------------------
// Sylvanreach Roots — ground-level root zone Lv 15–20
// ---------------------------------------------------------------------------
//
// Visual layout:
//
//   0 ──────────────────────────── 1400
//   │          ┌─────────┐ y=280   │
//   │   ╔══╗   │ ROOT MOUND│       │
//   │   ║LD║   └─────────┘        │
//   │   ╚══╝                      │
//   │      ┌──────────┐ y=420     │
//   │      │FALLEN LOG│           │
//   │      └──────────┘           │
//   │   ╔══╗                      │
//   │   ║LD║                      │
//   │   ╚══╝                      │
//   └──────────┬──────────────────┘
//        ROOT FLOOR  y=580        1400
//   0 ────────────────────────────
//
// Dark, damp zone among the giant tree's roots. Crawlers lurk in the
// shadows; tough sprites guard the root mound.

export const SYLVANREACH_ROOTS: GameMap = {
  id: "sylvanreach_roots",
  name: "Sylvanreach Roots",
  bgmKey: "dungeon",
  bgSet: "forest",
  width: 1400,
  height: 700,

  footholds: [
    // ── Root floor (ground level) ───────────────────────────────────
    { id: 0, x1: 0, y1: 580, x2: 1400, y2: 580, solid: true },

    // ── Fallen log (y≈420, x 300–800) ──────────────────────────────
    { id: 1, x1: 300, y1: 420, x2: 800, y2: 420 },

    // ── Root mound (y≈280, x 500–1100) ─────────────────────────────
    { id: 2, x1: 500, y1: 280, x2: 1100, y2: 280 },
  ],

  ladders: [
    // Root floor → fallen log (centre-left)
    { id: 0, x: 500, yTop: 420, yBottom: 580, kind: "ladder" },

    // Fallen log → root mound (centre-right)
    { id: 1, x: 900, yTop: 280, yBottom: 420, kind: "ladder" },
  ],

  spawns: [
    // Root crawlers along the floor
    { footholdId: 0, mobId: "mob.root_crawler", count: 6 },
    // Sylvan sprites on the fallen log
    { footholdId: 1, mobId: "mob.sylvan_sprite", count: 4 },
    // Bark spiders guarding the root mound
    { footholdId: 2, mobId: "mob.bark_spider", count: 3 },
  ],

  portals: [
    // Back to Sylvanreach town
    {
      id: "return_to_town",
      x: 100,
      y: 580 - 40,
      toMapId: "sylvanreach",
      toSpawnId: "to_roots",
      label: "🏙️ Return to Sylvanreach",
    },
  ],

  spawnPoints: {
    // Entry from the town root base
    entry: { x: 100, y: 580 - 40 },
    // Fallen log landing
    fallen_log: { x: 550, y: 420 - 40 },
  },

  playerSpawn: { x: 100, y: 580 - 40 },
};

// ---------------------------------------------------------------------------
// Craghold — rocky desert plateau warrior town (Perion parity) Lv 10–20
// ---------------------------------------------------------------------------
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────── 1600
//   │     ┌──────────┐ y=160        │
//   │     │ SPIRE    │  warrior     │
//   │     │ PEAK     │  trainer     │
//   │     └──────────┘              │
//   │  ╔══╗ ┌────────────┐ y=320   │
//   │  ║LD║ │ UPPER LEDGE│        │
//   │  ╚══╝ └────────────┘        │
//   │       ┌──────────────┐y=480 │
//   │       │ TRAINING     │      │
//   │       │ GROUNDS      │      │
//   │       └──────────────┘      │
//   │  ╔══╗  ╔══╗                │
//   │  ║LD║  ║LD║                │
//   │  ╚══╝  ╚══╝                │
//   └──────────┬──────────────────┘
//        GROUND PLATEAU  y=660    1600
//   0 ────────────────────────────
//
// Warrior home town on a rocky desert plateau. Prehistoric stone
// architecture, dinosaur-bone arches, forge NPCs. Safe zone.

const CRAG_GROUND_Y = 660;

// Safe town — zero hostile mob spawns.
const CRAGHOLD_SPAWNS: readonly MobSpawnZone[] = [];

export const CRAGHOLD: GameMap = {
  id: "craghold",
  name: "Craghold",
  bgmKey: "dungeon",
  bgSet: "rocky",
  width: 1600,
  height: 800,

  footholds: [
    // ── Ground plateau (flat) ─────────────────────────────────────────
    { id: 0, x1: 0, y1: CRAG_GROUND_Y, x2: 1600, y2: CRAG_GROUND_Y, solid: true },

    // ── Training grounds (y≈480, x 300–1100) ─────────────────────────
    { id: 1, x1: 300, y1: 480, x2: 1100, y2: 480 },

    // ── Upper ledge (y≈320, x 400–900) ──────────────────────────────
    { id: 2, x1: 400, y1: 320, x2: 900, y2: 320 },

    // ── Spire peak (y≈160, x 500–800) — warrior trainer NPC ────────
    { id: 3, x1: 500, y1: 160, x2: 800, y2: 160 },

    // ── Exit platform (right side, y≈560) ─────────────────────────────
    { id: 4, x1: 1250, y1: 560, x2: 1550, y2: 560 },
  ],

  ladders: [
    // Ground → training grounds (left)
    { id: 0, x: 400, yTop: 480, yBottom: CRAG_GROUND_Y, kind: "ladder" },

    // Training grounds → upper ledge (centre)
    { id: 1, x: 650, yTop: 320, yBottom: 480, kind: "ladder" },

    // Upper ledge → spire peak (centre)
    { id: 2, x: 600, yTop: 160, yBottom: 320, kind: "rope" },

    // Training grounds → exit platform (right)
    { id: 3, x: 1200, yTop: 480, yBottom: 560, kind: "ladder" },
  ],

  spawns: CRAGHOLD_SPAWNS,

  portals: [
    // Path back to Meadowfield (left side of ground)
    {
      id: "return_to_meadowfield",
      x: 150,
      y: CRAG_GROUND_Y - 40,
      toMapId: "meadowfield",
      toSpawnId: "east_gate",
      label: "🏔️ Road to Meadowfield",
    },
    // Trail to Craghold Cliffs (exit platform, right side)
    {
      id: "to_cliffs",
      x: 1400,
      y: 560 - 40,
      toMapId: "craghold_cliffs",
      toSpawnId: "entry",
      label: "🪨 Craghold Cliffs",
    },
    // Stairway down to Craghold Quarry (ground, right-centre)
    {
      id: "to_quarry",
      x: 1050,
      y: CRAG_GROUND_Y - 40,
      toMapId: "craghold_quarry",
      toSpawnId: "entry",
      label: "⛏️ Descend to the Quarry",
    },
    // Path to Crossway hub (ground, left-centre)
    {
      id: "to_crossway",
      x: 300,
      y: CRAG_GROUND_Y - 40,
      toMapId: "crossway",
      toSpawnId: "from_craghold",
      label: "🌳 Crossway Hub",
    },
  ],

  spawnPoints: {
    // Arriving from Meadowfield (left side)
    from_meadowfield: { x: 200, y: CRAG_GROUND_Y - 40 },
    // Warrior trainer (spire peak)
    spire: { x: 650, y: 160 - 40 },
    // Training grounds
    training: { x: 700, y: 480 - 40 },
    // Exit to cliffs
    to_cliffs: { x: 1400, y: 560 - 40 },
    // Exit to quarry
    to_quarry: { x: 1050, y: CRAG_GROUND_Y - 40 },
    // Arriving from Crossway
    from_crossway: { x: 300, y: CRAG_GROUND_Y - 40 },
  },

  playerSpawn: { x: 200, y: CRAG_GROUND_Y - 40 },
};

// ---------------------------------------------------------------------------
// Craghold Cliffs — rocky cliff combat zone Lv 10–15
// ---------------------------------------------------------------------------
//
// Visual layout:
//
//   0 ──────────────────────────── 1400
//   │    ┌─────────┐ y=140          │
//   │    │LEDGE-R  │ (hawk nest)   │
//   │    └─────────┘               │
//   │      ┌──────────┐ y=280      │
//   │ ╔══╗ │ LEDGE-M  │           │
//   │ ║RP║ └──────────┘           │
//   │ ╚══╝                        │
//   │ ┌───────────────┐ y=440     │
//   │ │  CLIFF SHELF  │          │
//   │ └───────────────┘          │
//   │ ╔══╗  ╔══╗                 │
//   │ ║LD║  ║LD║                 │
//   │ ╚══╝  ╚══╝                 │
//   └──────────┬──────────────────┘
//      CLIFF BASE  y=620         1400
//   0 ────────────────────────────
//
// Rocky cliff faces at the edge of the Craghold plateau. Lizards and
// beetles skitter across the stone; hawks nest on the upper ledges.

export const CRAGHOLD_CLIFFS: GameMap = {
  id: "craghold_cliffs",
  name: "Craghold Cliffs",
  bgmKey: "dungeon",
  bgSet: "rocky",
  width: 1400,
  height: 700,

  footholds: [
    // ── Cliff base (ground level) ─────────────────────────────────────
    { id: 0, x1: 0, y1: 620, x2: 1400, y2: 620, solid: true },

    // ── Cliff shelf (y≈440, x 100–1100) ──────────────────────────────
    { id: 1, x1: 100, y1: 440, x2: 1100, y2: 440 },

    // ── Ledge mid (y≈280, x 200–800) ────────────────────────────────
    { id: 2, x1: 200, y1: 280, x2: 800, y2: 280 },

    // ── Ledge right / hawk nest (y≈140, x 350–700) ──────────────────
    { id: 3, x1: 350, y1: 140, x2: 700, y2: 140 },
  ],

  ladders: [
    // Cliff base → shelf (left)
    { id: 0, x: 250, yTop: 440, yBottom: 620, kind: "ladder" },

    // Shelf → ledge mid (centre-left)
    { id: 1, x: 400, yTop: 280, yBottom: 440, kind: "ladder" },

    // Ledge mid → hawk nest (centre)
    { id: 2, x: 500, yTop: 140, yBottom: 280, kind: "rope" },

    // Shelf → far-right perch
    { id: 3, x: 1050, yTop: 440, yBottom: 620, kind: "rope" },
  ],

  spawns: [
    // Rock lizards on the cliff base
    { footholdId: 0, mobId: "mob.rock_lizard", count: 6 },
    // Fossil beetles on the shelf
    { footholdId: 1, mobId: "mob.fossil_beetle", count: 5 },
    // Cliff hawks on the ledge
    { footholdId: 2, mobId: "mob.cliff_hawk", count: 3 },
    // A hawk alpha at the nest
    { footholdId: 3, mobId: "mob.cliff_hawk", count: 2 },
  ],

  bossSpawns: [{ footholdId: 3, mobId: "mob.gelatinarch", count: 1, respawnIntervalMs: 240_000 }],

  portals: [
    // Back to Craghold town
    {
      id: "return_to_town",
      x: 50,
      y: 620 - 40,
      toMapId: "craghold",
      toSpawnId: "to_cliffs",
      label: "🏙️ Return to Craghold",
    },
  ],

  spawnPoints: {
    // Entry from Craghold town
    entry: { x: 100, y: 620 - 40 },
    // Cliff shelf landing
    shelf: { x: 600, y: 440 - 40 },
  },

  playerSpawn: { x: 100, y: 620 - 40 },
};

// ---------------------------------------------------------------------------
// Craghold Quarry — deep pit combat zone Lv 15–20
// ---------------------------------------------------------------------------
//
// Visual layout:
//
//   0 ──────────────────────────── 1600
//   │        ┌──────────┐ y=180     │
//   │   ╔══╗ │ CRUSH DECK│          │
//   │   ║LD║ └──────────┘          │
//   │   ╚══╝                       │
//   │      ┌──────────┐ y=340      │
//   │      │MID LEDGE │            │
//   │      └──────────┘            │
//   │   ╔══╗  ┌────────────┐y=500  │
//   │   ║LD║  │  QUARRY    │       │
//   │   ╚══╝  │  FLOOR     │       │
//   │          └────────────┘       │
//   │ ╔══╗  ╔══╗                   │
//   │ ║LD║  ║RP║                   │
//   │ ╚══╝  ╚══╝                   │
//   └──────────────┬───────────────┘
//        PIT BOTTOM  y=680         1600
//   0 ────────────────────────────
//
// Deep quarry pit carved into the plateau. Crabs scuttle between boulders;
// stone golems guard the lower depths.

export const CRAGHOLD_QUARRY: GameMap = {
  id: "craghold_quarry",
  name: "Craghold Quarry",
  bgmKey: "dungeon",
  bgSet: "rocky",
  width: 1600,
  height: 800,

  footholds: [
    // ── Pit bottom (ground level) ─────────────────────────────────────
    { id: 0, x1: 0, y1: 680, x2: 1600, y2: 680, solid: true },

    // ── Quarry floor (y≈500, x 200–1200) ─────────────────────────────
    { id: 1, x1: 200, y1: 500, x2: 1200, y2: 500 },

    // ── Mid ledge (y≈340, x 400–1000) ───────────────────────────────
    { id: 2, x1: 400, y1: 340, x2: 1000, y2: 340 },

    // ── Crush deck (y≈180, x 500–900) ───────────────────────────────
    { id: 3, x1: 500, y1: 180, x2: 900, y2: 180 },

    // ── Side ledge (y≈420, x 1200–1500) ──────────────────────────────
    { id: 4, x1: 1200, y1: 420, x2: 1500, y2: 420 },
  ],

  ladders: [
    // Pit bottom → quarry floor (centre-left)
    { id: 0, x: 350, yTop: 500, yBottom: 680, kind: "ladder" },

    // Quarry floor → mid ledge (centre)
    { id: 1, x: 600, yTop: 340, yBottom: 500, kind: "ladder" },

    // Mid ledge → crush deck (centre)
    { id: 2, x: 700, yTop: 180, yBottom: 340, kind: "ladder" },

    // Quarry floor → side ledge (right)
    { id: 3, x: 1150, yTop: 420, yBottom: 500, kind: "rope" },

    // Side ledge → pit bottom (far right)
    { id: 4, x: 1400, yTop: 420, yBottom: 680, kind: "rope" },
  ],

  spawns: [
    // Quarry crabs at the pit bottom (Lv 16)
    { footholdId: 0, mobId: "mob.quarry_crab", count: 5 },
    // Quarry crabs on the quarry floor
    { footholdId: 1, mobId: "mob.quarry_crab", count: 5 },
    // Boulder golems on the mid ledge (Lv 18)
    { footholdId: 2, mobId: "mob.boulder_golem", count: 4 },
    // Boulder golems on the crush deck
    { footholdId: 3, mobId: "mob.boulder_golem", count: 3 },
    // Mixed — crabs and golems on the side ledge
    { footholdId: 4, mobId: "mob.quarry_crab", count: 3 },
  ],

  portals: [
    // Back to Craghold town
    {
      id: "return_to_town",
      x: 50,
      y: 680 - 40,
      toMapId: "craghold",
      toSpawnId: "to_quarry",
      label: "🏙️ Return to Craghold",
    },
  ],

  spawnPoints: {
    // Entry from Craghold town
    entry: { x: 100, y: 680 - 40 },
    // Quarry floor landing
    quarry_floor: { x: 700, y: 500 - 40 },
  },

  playerSpawn: { x: 100, y: 680 - 40 },
};

// ---------------------------------------------------------------------------
// Dusk Ward — neon night city thief town (Kerning City parity) Lv 10–20
// ---------------------------------------------------------------------------
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────── 1500
//   │       ┌──────┐  y=140         │
//   │       │SKYBRG│  (skybridge)   │
//   │       └──────┘                │
//   │     ╔══╗  ┌──────────┐ y=300  │
//   │     ║LD║  │ NEON PLT │       │
//   │     ╚══╝  └──────────┘       │
//   │  ╔══╗  ┌─────────────┐ y=480 │
//   │  ║LD║  │ MARKET PLT  │      │
//   │  ╚══╝  └─────────────┘      │
//   │       ╔══╗                   │
//   │       ║LD║                   │
//   │       ╚══╝                   │
//   └──────────┬───────────────────┘
//       STREET LEVEL  y=680        1500
//   0 ────────────────────────────
//
// Thief home town. Neon-lit streets, flickering holographic signs, dark
// alleyways between brutalist towers. Safe zone — zero mob spawns.
// Portals lead to Meadowfield (overworld) and the underground subway/backalley.

const DUSK_GROUND_Y = 680;

// Safe town — zero hostile mob spawns.
const DUSK_WARD_SPAWNS: readonly MobSpawnZone[] = [];

export const DUSK_WARD: GameMap = {
  id: "dusk_ward",
  name: "Dusk Ward",
  bgmKey: "dungeon",
  bgSet: "urban",
  width: 1500,
  height: 800,

  footholds: [
    // ── Street level (flat) ───────────────────────────────────────────
    { id: 0, x1: 0, y1: DUSK_GROUND_Y, x2: 1500, y2: DUSK_GROUND_Y, solid: true },

    // ── Market platform (y≈480, x 300–1100) — shops & vendor NPCs ────
    { id: 1, x1: 300, y1: 480, x2: 1100, y2: 480 },

    // ── Neon platform (y≈300, x 400–1000) — thief trainer area ────────
    { id: 2, x1: 400, y1: 300, x2: 1000, y2: 300 },

    // ── Skybridge (y≈140, x 500–800) — rooftop overlook ──────────────
    { id: 3, x1: 500, y1: 140, x2: 800, y2: 140 },

    // ── Subway entrance platform (y≈560, x 1000–1400) ──────────────────
    { id: 4, x1: 1000, y1: 560, x2: 1400, y2: 560 },
  ],

  ladders: [
    // Street → market platform (left)
    { id: 0, x: 400, yTop: 480, yBottom: DUSK_GROUND_Y, kind: "ladder" },

    // Market platform → neon platform (centre)
    { id: 1, x: 600, yTop: 300, yBottom: 480, kind: "ladder" },

    // Neon platform → skybridge (centre)
    { id: 2, x: 650, yTop: 140, yBottom: 300, kind: "ladder" },

    // Street → subway entrance platform (right)
    { id: 3, x: 1100, yTop: 560, yBottom: DUSK_GROUND_Y, kind: "ladder" },

    // Subway entrance → market platform (right side)
    { id: 4, x: 1050, yTop: 480, yBottom: 560, kind: "rope" },
  ],

  spawns: DUSK_WARD_SPAWNS,

  portals: [
    // Path back to Meadowfield (left side of street)
    {
      id: "return_to_meadowfield",
      x: 150,
      y: DUSK_GROUND_Y - 40,
      toMapId: "meadowfield",
      toSpawnId: "east_gate",
      label: "🌿 Road to Meadowfield",
    },
    // Descent into the subway system (subway entrance platform)
    {
      id: "to_subway",
      x: 1300,
      y: 560 - 40,
      toMapId: "dusk_ward_subway",
      toSpawnId: "entry",
      label: "🚇 Descend to the Subway",
    },
    // Back-alley entrance (street level, right-centre)
    {
      id: "to_backalley",
      x: 800,
      y: DUSK_GROUND_Y - 40,
      toMapId: "dusk_ward_backalley",
      toSpawnId: "entry",
      label: "🌑 Enter the Backalleys",
    },
    // Path to Crossway hub (street level, left-centre)
    {
      id: "to_crossway",
      x: 300,
      y: DUSK_GROUND_Y - 40,
      toMapId: "crossway",
      toSpawnId: "from_dusk_ward",
      label: "🌳 Crossway Hub",
    },
  ],

  spawnPoints: {
    // Arriving from Meadowfield (left side of street)
    from_meadowfield: { x: 200, y: DUSK_GROUND_Y - 40 },
    // Central street
    street: { x: 600, y: DUSK_GROUND_Y - 40 },
    // Market area (shops & vendors)
    market: { x: 700, y: 480 - 40 },
    // Thief trainer (neon platform)
    trainer: { x: 650, y: 300 - 40 },
    // Rooftop skybridge
    skybridge: { x: 650, y: 140 - 40 },
    // Subway entrance
    to_subway: { x: 1300, y: 560 - 40 },
    // Arriving from Crossway
    from_crossway: { x: 300, y: DUSK_GROUND_Y - 40 },
  },

  playerSpawn: { x: 200, y: DUSK_GROUND_Y - 40 },
};

// ---------------------------------------------------------------------------
// Dusk Ward Subway — underground tunnel combat zone Lv 10–15
// ---------------------------------------------------------------------------
//
// Visual layout:
//
//   0 ──────────────────────────── 1600
//   │          ┌──────────┐ y=140    │
//   │   ╔══╗   │ UPPER    │         │
//   │   ║LD║   │ TUNNEL   │         │
//   │   ╚══╝   └──────────┘         │
//   │      ╔══╗  ┌──────────┐ y=320 │
//   │      ║LD║  │ MID      │      │
//   │      ╚══╝  │ PLATFORM │      │
//   │             └──────────┘      │
//   │  ╔══╗   ╔══╗  ┌─────────┐y=500│
//   │  ║LD║   ║LD║  │ LOWER   │    │
//   │  ╚══╝   ╚══╝  │ PLATFORM│    │
//   │                └─────────┘    │
//   │     ╔══╗  ╔══╗               │
//   │     ║LD║  ║RP║               │
//   │     ╚══╝  ╚══╝               │
//   └──────────────┬───────────────┘
//       TRACK BED  y=660           1600
//   0 ────────────────────────────
//
// Abandoned subway tunnels beneath Dusk Ward. Rat swarms, flickering
// tunnel lights, rusted rail lines. Three tiers of platforms connected
// by maintenance ladders. Lots of vertical ladders — the signature.

export const DUSK_WARD_SUBWAY: GameMap = {
  id: "dusk_ward_subway",
  name: "Dusk Ward Subway",
  bgmKey: "cave",
  bgSet: "underground",
  width: 1600,
  height: 760,

  footholds: [
    // ── Track bed (ground level) ──────────────────────────────────────
    { id: 0, x1: 0, y1: 660, x2: 1600, y2: 660, solid: true },

    // ── Lower platform (y≈500, x 200–1200) ────────────────────────────
    { id: 1, x1: 200, y1: 500, x2: 1200, y2: 500 },

    // ── Mid platform (y≈320, x 350–1100) ─────────────────────────────
    { id: 2, x1: 350, y1: 320, x2: 1100, y2: 320 },

    // ── Upper tunnel (y≈140, x 400–1000) ─────────────────────────────
    { id: 3, x1: 400, y1: 140, x2: 1000, y2: 140 },

    // ── Side maintenance ledge (y≈420, x 1200–1500) ────────────────────
    { id: 4, x1: 1200, y1: 420, x2: 1500, y2: 420 },
  ],

  ladders: [
    // Track bed → lower platform (left)
    { id: 0, x: 300, yTop: 500, yBottom: 660, kind: "ladder" },

    // Track bed → lower platform (centre)
    { id: 1, x: 700, yTop: 500, yBottom: 660, kind: "ladder" },

    // Lower platform → mid platform (centre-left)
    { id: 2, x: 450, yTop: 320, yBottom: 500, kind: "ladder" },

    // Lower platform → mid platform (centre-right)
    { id: 3, x: 900, yTop: 320, yBottom: 500, kind: "ladder" },

    // Mid platform → upper tunnel (centre)
    { id: 4, x: 600, yTop: 140, yBottom: 320, kind: "ladder" },

    // Lower platform → side maintenance ledge (right)
    { id: 5, x: 1150, yTop: 420, yBottom: 500, kind: "rope" },

    // Side maintenance ledge → track bed (far right)
    { id: 6, x: 1400, yTop: 420, yBottom: 660, kind: "rope" },
  ],

  spawns: [
    // Neon rats scurrying along the track bed
    { footholdId: 0, mobId: "mob.neon_rat", count: 7 },
    // Tunnel bats on the lower platform
    { footholdId: 1, mobId: "mob.tunnel_bat", count: 5 },
    // Spark drones hovering on the mid platform
    { footholdId: 2, mobId: "mob.spark_drone", count: 4 },
    // Rail sentinels guarding the upper tunnel
    { footholdId: 3, mobId: "mob.rail_sentinel", count: 3 },
    // Mixed vermin on the maintenance ledge
    { footholdId: 4, mobId: "mob.neon_rat", count: 4 },
  ],

  portals: [
    // Back to Dusk Ward town (track bed, left side)
    {
      id: "return_to_town",
      x: 100,
      y: 660 - 40,
      toMapId: "dusk_ward",
      toSpawnId: "to_subway",
      label: "🏙️ Return to Dusk Ward",
    },
  ],

  spawnPoints: {
    // Entry from the Dusk Ward subway entrance
    entry: { x: 100, y: 660 - 40 },
    // Lower platform landing
    lower_platform: { x: 600, y: 500 - 40 },
    // Mid platform landing
    mid_platform: { x: 650, y: 320 - 40 },
  },

  playerSpawn: { x: 100, y: 660 - 40 },
};

// ---------------------------------------------------------------------------
// Dusk Ward Backalley — narrow alley combat zone Lv 15–20
// ---------------------------------------------------------------------------
//
// Visual layout:
//
//   0 ──────────────────────────── 1400
//   │   ┌──────┐ y=100              │
//   │   │ROOFTP│  (escape route)    │
//   │   └──────┘                    │
//   │  ╔══╗ ┌──────────┐ y=250     │
//   │  ║RP║ │ FIRESCAP │          │
//   │  ╚══╝ │ UPPER    │          │
//   │       └──────────┘          │
//   │  ╔══╗ ┌────────────┐ y=400  │
//   │  ║LD║ │ DRN CHNNL  │       │
//   │  ╚══╝ └────────────┘       │
//   │  ╔══╗  ╔══╗ ┌──────────┐y=540│
//   │  ║LD║  ║LD║ │ MID ALLEY│    │
//   │  ╚══╝  ╚══╝ └──────────┘    │
//   │      ╔══╗                   │
//   │      ║LD║                   │
//   │      ╚══╝                   │
//   └──────┬──────────────────────┘
//     ALLEY FLOOR  y=680          1400
//   0 ────────────────────────────
//
// Narrow back-alley corridors behind the neon towers. Fire escapes, rusted
// drainage channels, shadowy overhangs. The densest ladder network in the
// game — every tier reachable from multiple angles.

export const DUSK_WARD_BACKALLEY: GameMap = {
  id: "dusk_ward_backalley",
  name: "Dusk Ward Backalleys",
  bgmKey: "dungeon",
  bgSet: "urban",
  width: 1400,
  height: 780,

  footholds: [
    // ── Alley floor (ground level) ────────────────────────────────────
    { id: 0, x1: 0, y1: 680, x2: 1400, y2: 680, solid: true },

    // ── Mid alley (y≈540, x 150–1100) ────────────────────────────────
    { id: 1, x1: 150, y1: 540, x2: 1100, y2: 540 },

    // ── Drainage channel (y≈400, x 250–1000) ─────────────────────────
    { id: 2, x1: 250, y1: 400, x2: 1000, y2: 400 },

    // ── Fire escape upper (y≈250, x 300–800) ─────────────────────────
    { id: 3, x1: 300, y1: 250, x2: 800, y2: 250 },

    // ── Rooftop escape (y≈100, x 200–500) ────────────────────────────
    { id: 4, x1: 200, y1: 100, x2: 500, y2: 100 },

    // ── Right-side catwalk (y≈350, x 1100–1350) ───────────────────────
    { id: 5, x1: 1100, y1: 350, x2: 1350, y2: 350 },
  ],

  ladders: [
    // Alley floor → mid alley (left)
    { id: 0, x: 250, yTop: 540, yBottom: 680, kind: "ladder" },

    // Alley floor → mid alley (centre)
    { id: 1, x: 600, yTop: 540, yBottom: 680, kind: "ladder" },

    // Mid alley → drainage channel (left)
    { id: 2, x: 350, yTop: 400, yBottom: 540, kind: "ladder" },

    // Mid alley → drainage channel (centre-right)
    { id: 3, x: 850, yTop: 400, yBottom: 540, kind: "ladder" },

    // Drainage channel → fire escape (centre)
    { id: 4, x: 500, yTop: 250, yBottom: 400, kind: "ladder" },

    // Fire escape → rooftop escape (left)
    { id: 5, x: 350, yTop: 100, yBottom: 250, kind: "rope" },

    // Drainage channel → right-side catwalk (right)
    { id: 6, x: 1100, yTop: 350, yBottom: 400, kind: "rope" },

    // Right-side catwalk → mid alley (far right)
    { id: 7, x: 1200, yTop: 350, yBottom: 540, kind: "rope" },

    // Alley floor → right-side catwalk (far right)
    { id: 8, x: 1300, yTop: 350, yBottom: 680, kind: "ladder" },
  ],

  spawns: [
    // Shadow thugs lurking on the alley floor
    { footholdId: 0, mobId: "mob.shadow_thug", count: 6 },
    // Neon spiders on the mid alley
    { footholdId: 1, mobId: "mob.neon_spider", count: 5 },
    // Arc wraiths in the drainage channel
    { footholdId: 2, mobId: "mob.arc_wraith", count: 4 },
    // Shadow thugs patrolling the fire escape
    { footholdId: 3, mobId: "mob.shadow_thug", count: 3 },
    // Neon spiders on the catwalk
    { footholdId: 5, mobId: "mob.neon_spider", count: 3 },
  ],

  bossSpawns: [{ footholdId: 4, mobId: "mob.sporemother", count: 1, respawnIntervalMs: 240_000 }],

  portals: [
    // Back to Dusk Ward town (alley floor, left side)
    {
      id: "return_to_town",
      x: 100,
      y: 680 - 40,
      toMapId: "dusk_ward",
      toSpawnId: "street",
      label: "🏙️ Return to Dusk Ward",
    },
  ],

  spawnPoints: {
    // Entry from the Dusk Ward back-alley entrance
    entry: { x: 100, y: 680 - 40 },
    // Mid alley landing
    mid_alley: { x: 500, y: 540 - 40 },
    // Drainage channel
    drainage: { x: 600, y: 400 - 40 },
    // Fire escape
    fire_escape: { x: 550, y: 250 - 40 },
  },

  playerSpawn: { x: 100, y: 680 - 40 },
};

// ---------------------------------------------------------------------------
// Crossway — central Heartland hub (Six Path Crossway parallel)
// ---------------------------------------------------------------------------
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────────────── 2000
//   │          SILVAN         DUSK         │
//   │           \\              //           │
//   │            \\    ╔════╗  //            │
//   │             \\   ║ FM ║ //             │
//   │              \\  ║PLT ║/              │
//   │    ┌──────────\\═╩════╩═//──────────┐ │
//   │    │           ║ HUB  ║            │ │ y=440
//   │    │           ║FLATS ║            │ │
//   │    └───────────╚══════╝────────────┘ │
//   │   CRAG          \\/          HARBOR   │
//   │                   \\/                 │
//   │               ╔════════╗             │
//   │               ║ MIR    ║             │
//   │               ║ PATH   ║             │
//   │  ╔══╗         ╚════════╝    ╔══╗    │
//   │  ║LD║                       ║LD║    │
//   │  ╚══╝                       ╚══╝    │
//   └────────────┬────────────────────────┘
//        GROUND PLAT  y=680                2000
//   0 ────────────────────────────────────
//
// The central crossroads of the Heartland. A giant world-tree shades the
// hub flats where players gather, trade, and socialise. Paths radiate to
// every Heartland town. The Free Market entrance sits on an upper platform.
// Safe zone — zero mob spawns.

const CROSSWAY_GROUND_Y = 680;

// Safe zone — zero hostile mob spawns.
const CROSSWAY_SPAWNS: readonly MobSpawnZone[] = [];

export const CROSSWAY: GameMap = {
  id: "crossway",
  name: "Crossway",
  bgmKey: "town",
  bgSet: "pastoral",
  width: 2000,
  height: 800,

  footholds: [
    // ── Ground platform (flat) ───────────────────────────────────────
    { id: 0, x1: 0, y1: CROSSWAY_GROUND_Y, x2: 2000, y2: CROSSWAY_GROUND_Y, solid: true },

    // ── Hub flats (y≈440, x 400–1600) — central gathering area ──────
    { id: 1, x1: 400, y1: 440, x2: 1600, y2: 440 },

    // ── Free Market platform (y≈240, x 700–1300) ────────────────────
    { id: 2, x1: 700, y1: 240, x2: 1300, y2: 240 },

    // ── Left branch ledge (y≈520, x 100–400) — Craghold path ────────
    { id: 3, x1: 100, y1: 520, x2: 400, y2: 520 },

    // ── Right branch ledge (y≈520, x 1600–1900) — Harbor path ───────
    { id: 4, x1: 1600, y1: 520, x2: 1900, y2: 520 },
  ],

  ladders: [
    // Ground → hub flats (centre)
    { id: 0, x: 1000, yTop: 440, yBottom: CROSSWAY_GROUND_Y, kind: "ladder" },

    // Hub flats → Free Market platform (centre)
    { id: 1, x: 1000, yTop: 240, yBottom: 440, kind: "ladder" },

    // Ground → left branch (left)
    { id: 2, x: 250, yTop: 520, yBottom: CROSSWAY_GROUND_Y, kind: "ladder" },

    // Ground → right branch (right)
    { id: 3, x: 1750, yTop: 520, yBottom: CROSSWAY_GROUND_Y, kind: "ladder" },
  ],

  spawns: CROSSWAY_SPAWNS,

  portals: [
    // To Tidewatch Harbor (right branch, ground)
    {
      id: "to_harbor",
      x: 1850,
      y: 520 - 40,
      toMapId: "heartland_harbor",
      toSpawnId: "from_crossway",
      label: "⚓ Tidewatch Harbor",
    },
    // To Meadowfield (right side of hub flats)
    {
      id: "to_meadowfield",
      x: 1500,
      y: 440 - 40,
      toMapId: "meadowfield",
      toSpawnId: "from_crossway",
      label: "🌿 Meadowfield",
    },
    // To Sylvanreach (left side of hub flats)
    {
      id: "to_sylvanreach",
      x: 600,
      y: 440 - 40,
      toMapId: "sylvanreach",
      toSpawnId: "from_crossway",
      label: "🌲 Sylvanreach",
    },
    // To Craghold (left branch, ground)
    {
      id: "to_craghold",
      x: 150,
      y: 520 - 40,
      toMapId: "craghold",
      toSpawnId: "from_crossway",
      label: "🏔️ Craghold",
    },
    // To Dusk Ward (left side of hub flats)
    {
      id: "to_dusk_ward",
      x: 500,
      y: 440 - 40,
      toMapId: "dusk_ward",
      toSpawnId: "from_crossway",
      label: "🌃 Dusk Ward",
    },
    // To Mirefen (centre of ground)
    {
      id: "to_mirefen",
      x: 1000,
      y: CROSSWAY_GROUND_Y - 40,
      toMapId: "mirefen",
      toSpawnId: "from_crossway",
      label: "🍄 Mirefen",
    },
    // Free Market entrance (Free Market platform)
    {
      id: "to_free_market",
      x: 1000,
      y: 240 - 40,
      toMapId: "free_market",
      toSpawnId: "entry",
      label: "🏪 Free Market",
    },
    // Airship to Skyhaven (Far Reaches expansion — scheduled transport)
    {
      id: "airship_to_skyhaven",
      x: 1800,
      y: CROSSWAY_GROUND_Y - 40,
      toMapId: "skyhaven",
      toSpawnId: "from_airship",
      label: "✈️ Airship to Skyhaven",
      requiresLevel: 30,
      schedule: {
        intervalMs: 300_000, // departs every 5 minutes
        windowMs: 60_000, // 60-second boarding window
      },
    },
    // Dragon Airship to Drakemoor (Far Reaches endgame expansion — requires Lv 100)
    {
      id: "airship_to_drakemoor",
      x: 1700,
      y: CROSSWAY_GROUND_Y - 40,
      toMapId: "drakemoor",
      toSpawnId: "from_airship",
      label: "🐉 Dragon Airship to Drakemoor",
      requiresLevel: 100,
      comingSoon: true,
      schedule: {
        intervalMs: 300_000, // departs every 5 minutes
        windowMs: 60_000, // 60-second boarding window
      },
    },
  ],

  spawnPoints: {
    // Default spawn (hub flats)
    hub: { x: 1000, y: 440 - 40 },
    // Arriving from Tidewatch Harbor
    from_harbor: { x: 1850, y: 520 - 40 },
    // Arriving from Meadowfield
    from_meadowfield: { x: 1500, y: 440 - 40 },
    // Arriving from Sylvanreach
    from_sylvanreach: { x: 600, y: 440 - 40 },
    // Arriving from Craghold
    from_craghold: { x: 150, y: 520 - 40 },
    // Arriving from Dusk Ward
    from_dusk_ward: { x: 500, y: 440 - 40 },
    // Arriving from Mirefen
    from_mirefen: { x: 1000, y: CROSSWAY_GROUND_Y - 40 },
    // Free Market entrance
    free_market: { x: 1000, y: 240 - 40 },
    // Airship departure platform (right edge of ground)
    sky_dock: { x: 1800, y: CROSSWAY_GROUND_Y - 40 },
    // Dragon airship departure platform
    dragon_dock: { x: 1700, y: CROSSWAY_GROUND_Y - 40 },
  },

  playerSpawn: { x: 1000, y: 440 - 40 },
};

// ---------------------------------------------------------------------------
// Mirefen — quiet swamp town (Sleepywood parallel) Lv 20–30
// ---------------------------------------------------------------------------
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────── 1500
//   │      ┌──────────┐ y=180        │
//   │      │ RUINS    │  dungeon     │
//   │      │ GATE     │  entrance    │
//   │      └──────────┘              │
//   │   ╔══╗  ┌──────────┐ y=360    │
//   │   ║LD║  │ BOG PLT  │         │
//   │   ╚══╝  └──────────┘         │
//   │      ┌──────────────┐ y=540   │
//   │      │  SWAMP WALK  │         │
//   │      └──────────────┘         │
//   │   ╔══╗  ╔══╗                 │
//   │   ║LD║  ║RP║                 │
//   │   ╚══╝  ╚══╝                 │
//   └──────────┬───────────────────┘
//     MARSH BANK  y=700             1500
//   0 ────────────────────────────
//
// A quiet, misty swamp settlement on the edge of an ancient ruin complex.
// Boardwalks over murky water, glowing mushrooms, firefly lanterns. Safe
// town — zero mob spawns. The ruins gate leads to the first instanced
// dungeon.

const MIREFEN_GROUND_Y = 700;

// Safe town — zero hostile mob spawns.
const MIREFEN_SPAWNS: readonly MobSpawnZone[] = [];

export const MIREFEN: GameMap = {
  id: "mirefen",
  name: "Mirefen",
  bgmKey: "forest",
  bgSet: "swamp",
  width: 1500,
  height: 800,

  footholds: [
    // ── Marsh bank / ground level ────────────────────────────────────
    { id: 0, x1: 0, y1: MIREFEN_GROUND_Y, x2: 1500, y2: MIREFEN_GROUND_Y, solid: true },

    // ── Swamp walk (y≈540, x 200–1100) ──────────────────────────────
    { id: 1, x1: 200, y1: 540, x2: 1100, y2: 540 },

    // ── Bog platform (y≈360, x 350–900) ─────────────────────────────
    { id: 2, x1: 350, y1: 360, x2: 900, y2: 360 },

    // ── Ruins gate platform (y≈180, x 500–800) ──────────────────────
    { id: 3, x1: 500, y1: 180, x2: 800, y2: 180 },

    // ── Dock platform (right side, y≈600, x 1100–1400) ──────────────
    { id: 4, x1: 1100, y1: 600, x2: 1400, y2: 600 },
  ],

  ladders: [
    // Marsh bank → swamp walk (left)
    { id: 0, x: 400, yTop: 540, yBottom: MIREFEN_GROUND_Y, kind: "ladder" },

    // Swamp walk → bog platform (centre)
    { id: 1, x: 600, yTop: 360, yBottom: 540, kind: "ladder" },

    // Bog platform → ruins gate (centre)
    { id: 2, x: 650, yTop: 180, yBottom: 360, kind: "rope" },

    // Marsh bank → dock platform (right)
    { id: 3, x: 1050, yTop: 600, yBottom: MIREFEN_GROUND_Y, kind: "rope" },

    // Dock platform → swamp walk (right)
    { id: 4, x: 1100, yTop: 540, yBottom: 600, kind: "ladder" },
  ],

  spawns: MIREFEN_SPAWNS,

  portals: [
    // Path back to Crossway (dock area, right side)
    {
      id: "to_crossway",
      x: 1350,
      y: 600 - 40,
      toMapId: "crossway",
      toSpawnId: "from_mirefen",
      label: "🌳 Return to Crossway",
    },
    // Entrance to the Mirefen Ruins dungeon (ruins gate platform)
    {
      id: "to_ruins",
      x: 650,
      y: 180 - 40,
      toMapId: "mirefen_ruins",
      toSpawnId: "entry",
      label: "🏚️ Enter the Ruins",
      requiresLevel: 20,
    },
  ],

  spawnPoints: {
    // Arriving from Crossway (dock area)
    from_crossway: { x: 1250, y: 600 - 40 },
    // Central swamp walk
    boardwalk: { x: 650, y: 540 - 40 },
    // Ruins gate
    ruins_gate: { x: 650, y: 180 - 40 },
  },

  playerSpawn: { x: 1250, y: 600 - 40 },
};

// ---------------------------------------------------------------------------
// Mirefen Ruins — instanced dungeon combat zone Lv 20–30
// ---------------------------------------------------------------------------
//
// Visual layout:
//
//   0 ──────────────────────────── 1600
//   │    ┌──────────┐ y=140           │
//   │    │ BOMB CHM │  (boss spawn)   │
//   │    └──────────┘                 │
//   │ ╔══╗  ┌────────────┐ y=300     │
//   │ ║RP║  │ UPPER HALL │          │
//   │ ╚══╝  └────────────┘          │
//   │    ┌───────────────┐ y=460    │
//   │    │  MAIN CORRIDOR│          │
//   │    └───────────────┘          │
//   │ ╔══╗  ╔══╗  ┌──────────┐y=600│
//   │ ║LD║  ║LD║  │ FOYER    │    │
//   │ ╚══╝  ╚══╝  └──────────┘    │
//   │      ╔══╗                    │
//   │      ║LD║                    │
//   │      ╚══╝                    │
//   └──────────┬───────────────────┘
//     ENTRANCE HALL  y=720          1600
//   0 ────────────────────────────
//
// Crumbling stone ruins beneath Mirefen. Waterlogged corridors, crumbling
// pillars, eerie bioluminescent moss. First instanced dungeon — tougher
// mobs than the overworld. A boss lurks in the innermost chamber.

const RUINS_GROUND_Y = 720;

export const MIREFEN_RUINS: GameMap = {
  id: "mirefen_ruins",
  name: "Mirefen Ruins",
  bgmKey: "dungeon",
  bgSet: "swamp",
  width: 1600,
  height: 800,

  footholds: [
    // ── Entrance hall (ground level) ──────────────────────────────────
    { id: 0, x1: 0, y1: RUINS_GROUND_Y, x2: 1600, y2: RUINS_GROUND_Y, solid: true },

    // ── Foyer (y≈600, x 200–1200) ────────────────────────────────────
    { id: 1, x1: 200, y1: 600, x2: 1200, y2: 600 },

    // ── Main corridor (y≈460, x 300–1100) ────────────────────────────
    { id: 2, x1: 300, y1: 460, x2: 1100, y2: 460 },

    // ── Upper hall (y≈300, x 400–1000) ───────────────────────────────
    { id: 3, x1: 400, y1: 300, x2: 1000, y2: 300 },

    // ── Bomb chamber / boss room (y≈140, x 500–900) ──────────────────
    { id: 4, x1: 500, y1: 140, x2: 900, y2: 140 },

    // ── Side alcove (y≈520, x 1100–1450) ─────────────────────────────
    { id: 5, x1: 1100, y1: 520, x2: 1450, y2: 520 },
  ],

  ladders: [
    // Entrance hall → foyer (centre-left)
    { id: 0, x: 400, yTop: 600, yBottom: RUINS_GROUND_Y, kind: "ladder" },

    // Foyer → main corridor (centre)
    { id: 1, x: 600, yTop: 460, yBottom: 600, kind: "ladder" },

    // Main corridor → upper hall (centre)
    { id: 2, x: 700, yTop: 300, yBottom: 460, kind: "ladder" },

    // Upper hall → bomb chamber (centre)
    { id: 3, x: 750, yTop: 140, yBottom: 300, kind: "rope" },

    // Foyer → side alcove (right)
    { id: 4, x: 1050, yTop: 520, yBottom: 600, kind: "rope" },

    // Side alcove → entrance hall (far right)
    { id: 5, x: 1350, yTop: 520, yBottom: RUINS_GROUND_Y, kind: "ladder" },
  ],

  spawns: [
    // Bog lurkers in the entrance hall
    { footholdId: 0, mobId: "mob.bog_lurker", count: 6 },
    // Mire toads on the foyer
    { footholdId: 1, mobId: "mob.mire_toad", count: 5 },
    // Ruins sentinels in the main corridor
    { footholdId: 2, mobId: "mob.ruins_sentinel", count: 4 },
    // Ruins horrors in the upper hall
    { footholdId: 3, mobId: "mob.ruins_horror", count: 3 },
    // Moss wraiths in the upper hall
    { footholdId: 3, mobId: "mob.moss_wraith", count: 2 },
    // Deep swamp things in the side alcove
    { footholdId: 5, mobId: "mob.deep_swamp_thing", count: 4 },
    // Mixed mobs in the side alcove
    { footholdId: 5, mobId: "mob.bog_lurker", count: 3 },
  ],

  bossSpawns: [
    // The dungeon boss — Bogmaw, the Ruin Behemoth
    { footholdId: 4, mobId: "mob.bogmaw", count: 1, respawnIntervalMs: 300_000 },
    // Void Wisp is item-summoned only (no respawnIntervalMs)
    { footholdId: 4, mobId: "mob.void_wisp", count: 1 },
  ],

  portals: [
    // Back to Mirefen town (entrance hall, left side)
    {
      id: "return_to_town",
      x: 100,
      y: RUINS_GROUND_Y - 40,
      toMapId: "mirefen",
      toSpawnId: "ruins_gate",
      label: "🍄 Return to Mirefen",
    },
  ],

  spawnPoints: {
    // Entry from Mirefen town
    entry: { x: 100, y: RUINS_GROUND_Y - 40 },
    // Foyer landing
    foyer: { x: 700, y: 600 - 40 },
    // Boss chamber
    boss: { x: 700, y: 140 - 40 },
  },

  playerSpawn: { x: 100, y: RUINS_GROUND_Y - 40 },
};

// ---------------------------------------------------------------------------
// Free Market — player trading hub (stub, attached to Crossway)
// ---------------------------------------------------------------------------
//
// The Free Market is the central player-to-player trading zone. Currently a
// stub — the full vendor stall / auction house UI is a later milestone.
// Safe zone — zero mob spawns.

const FM_GROUND_Y = 600;

// Safe zone — zero hostile mob spawns.
const FM_SPAWNS: readonly MobSpawnZone[] = [];

export const FREE_MARKET: GameMap = {
  id: "free_market",
  name: "Free Market",
  bgmKey: "market",
  bgSet: "market",
  width: 1200,
  height: 700,

  footholds: [
    // ── Main trading floor (flat) ────────────────────────────────────
    { id: 0, x1: 0, y1: FM_GROUND_Y, x2: 1200, y2: FM_GROUND_Y, solid: true },

    // ── Upper gallery (y≈300, x 200–1000) ────────────────────────────
    { id: 1, x1: 200, y1: 300, x2: 1000, y2: 300 },
  ],

  ladders: [
    // Trading floor → upper gallery (centre)
    { id: 0, x: 600, yTop: 300, yBottom: FM_GROUND_Y, kind: "ladder" },
  ],

  spawns: FM_SPAWNS,

  portals: [
    // Exit back to Crossway
    {
      id: "exit_to_crossway",
      x: 100,
      y: FM_GROUND_Y - 40,
      toMapId: "crossway",
      toSpawnId: "free_market",
      label: "🌳 Return to Crossway",
    },
  ],

  spawnPoints: {
    // Entry from Crossway
    entry: { x: 100, y: FM_GROUND_Y - 40 },
  },

  playerSpawn: { x: 100, y: FM_GROUND_Y - 40 },
};

// ---------------------------------------------------------------------------
// Skyhaven — floating sky port town (Orbis parallel) Lv 30–45
// ---------------------------------------------------------------------------
//
// First region of the Far Reaches expansion continent. A cluster of floating
// sky islands connected by air bridges and rope lifts. The gateway hub for
// all expansion content — ships, airships, and sky-rides depart from here.
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────── 1800
//   │    ┌───────────┐ y=100         │
//   │    │ WIND SPIRE│  sky trainer  │
//   │    └───────────┘               │
//   │  ╔══╗ ┌────────────┐ y=260    │
//   │  ║RP║ │ UPPER ISLE │          │
//   │  ╚══╝ └────────────┘          │
//   │      ┌──────────────┐ y=420   │
//   │ ╔══╗ │  DOCK ISLE   │        │
//   │ ║LD║ └──────────────┘        │
//   │ ╚══╝                          │
//   │       ┌──────────────┐ y=560 │
//   │       │  HARBOR PLT  │       │
//   │       └──────────────┘       │
//   │ ╔══╗  ╔══╗                  │
//   │ ║LD║  ║RP║                  │
//   │ ╚══╝  ╚══╝                  │
//   └──────────┬───────────────────┘
//      CLOUD DECK  y=720           1800
//   0 ────────────────────────────
//
// Floating islands above the cloud sea. Crystalline buildings, glowing
// rune-bridges, and the airship dock on the right side. Safe zone — zero
// hostile mob spawns.

const SKYHAVEN_GROUND_Y = 720;

// Safe town — zero hostile mob spawns.
const SKYHAVEN_SPAWNS: readonly MobSpawnZone[] = [];

export const SKYHAVEN: GameMap = {
  id: "skyhaven",
  name: "Skyhaven",
  bgmKey: "sky",
  bgSet: "sky",
  width: 1800,
  height: 800,

  footholds: [
    // ── Cloud deck / ground island (flat) ──────────────────────────────
    { id: 0, x1: 0, y1: SKYHAVEN_GROUND_Y, x2: 1800, y2: SKYHAVEN_GROUND_Y, solid: true },

    // ── Harbor platform (y≈560, x 200–1000) — airship dock area ────────
    { id: 1, x1: 200, y1: 560, x2: 1000, y2: 560 },

    // ── Dock isle (y≈420, x 400–1200) — central town hub ──────────────
    { id: 2, x1: 400, y1: 420, x2: 1200, y2: 420 },

    // ── Upper isle (y≈260, x 500–1000) — shops & services ─────────────
    { id: 3, x1: 500, y1: 260, x2: 1000, y2: 260 },

    // ── Wind spire (y≈100, x 600–900) — sky trainer NPC ───────────────
    { id: 4, x1: 600, y1: 100, x2: 900, y2: 100 },

    // ── Departure dock (right side, y≈480, x 1400–1750) — airship to Heartland ─
    { id: 5, x1: 1400, y1: 480, x2: 1750, y2: 480 },
  ],

  ladders: [
    // Cloud deck → harbor platform (left)
    { id: 0, x: 400, yTop: 560, yBottom: SKYHAVEN_GROUND_Y, kind: "ladder" },

    // Harbor platform → dock isle (centre-left)
    { id: 1, x: 550, yTop: 420, yBottom: 560, kind: "ladder" },

    // Dock isle → upper isle (centre)
    { id: 2, x: 700, yTop: 260, yBottom: 420, kind: "ladder" },

    // Upper isle → wind spire (centre)
    { id: 3, x: 750, yTop: 100, yBottom: 260, kind: "rope" },

    // Cloud deck → departure dock (right)
    { id: 4, x: 1350, yTop: 480, yBottom: SKYHAVEN_GROUND_Y, kind: "ladder" },

    // Departure dock → dock isle (right side)
    { id: 5, x: 1300, yTop: 420, yBottom: 480, kind: "rope" },
  ],

  spawns: SKYHAVEN_SPAWNS,

  portals: [
    // Airship back to Crossway (scheduled transport, mirrors the outbound)
    {
      id: "airship_to_crossway",
      x: 1575,
      y: 480 - 40,
      toMapId: "crossway",
      toSpawnId: "sky_dock",
      label: "✈️ Airship to Crossway",
      requiresLevel: 30,
      schedule: {
        intervalMs: 300_000, // every 5 minutes
        windowMs: 60_000, // 60-second boarding window
      },
    },
    // Path to Driftpeaks sky fields (cloud deck, left side)
    {
      id: "to_driftpeaks",
      x: 150,
      y: SKYHAVEN_GROUND_Y - 40,
      toMapId: "skyhaven_driftpeaks",
      toSpawnId: "entry",
      label: "🌤️ Ascend to the Driftpeaks",
    },
    // Airship to Frosthold (scheduled transport, Far Reaches expansion)
    {
      id: "airship_to_frosthold",
      x: 1500,
      y: 480 - 40,
      toMapId: "frosthold",
      toSpawnId: "from_airship",
      label: "❄️ Airship to Frosthold",
      requiresLevel: 35,
      schedule: {
        intervalMs: 300_000, // departs every 5 minutes
        windowMs: 60_000, // 60-second boarding window
      },
    },
    // Boat to Tideways (scheduled transport, underwater expansion)
    {
      id: "boat_to_tideways",
      x: 1575,
      y: SKYHAVEN_GROUND_Y - 40,
      toMapId: "tideways",
      toSpawnId: "from_boat",
      label: "⛵ Boat to Tideways",
      requiresLevel: 35,
      comingSoon: true,
      schedule: {
        intervalMs: 300_000, // departs every 5 minutes
        windowMs: 60_000, // 60-second boarding window
      },
    },
  ],

  spawnPoints: {
    // Arriving from airship (departure dock area)
    from_airship: { x: 1575, y: 480 - 40 },
    // Central town hub (dock isle)
    town: { x: 800, y: 420 - 40 },
    // Sky trainer (wind spire)
    trainer: { x: 750, y: 100 - 40 },
    // Airship departure platform
    departure: { x: 1575, y: 480 - 40 },
    // Driftpeaks trailhead
    to_driftpeaks: { x: 150, y: SKYHAVEN_GROUND_Y - 40 },
    // Frosthold airship platform
    frosthold_dock: { x: 1500, y: 480 - 40 },
    // Tideways boat dock (same cloud deck platform)
    tideways_dock: { x: 1575, y: SKYHAVEN_GROUND_Y - 40 },
  },

  playerSpawn: { x: 1575, y: 480 - 40 },
};

// ---------------------------------------------------------------------------
// Skyhaven Driftpeaks — floating rock combat zone Lv 30–40
// ---------------------------------------------------------------------------
//
// Jagged rock islands drifting through the cloud sea. Wind sprites, sky
// serpents, and thunder hawks patrol the floating platforms. A wide-open
// vertical zone — the signature feel of the Far Reaches.
//
// Visual layout:
//
//   0 ──────────────────────────── 1600
//   │     ┌──────────┐ y=120          │
//   │     │ ZEPHYR   │  (top island)  │
//   │     │ SPIRE    │                │
//   │     └──────────┘                │
//   │  ╔══╗  ┌──────────┐ y=280      │
//   │  ║RP║  │ MID ROCK │            │
//   │  ╚══╝  └──────────┘            │
//   │      ┌──────────────┐ y=440    │
//   │      │  DRIFT SHELF │          │
//   │      └──────────────┘          │
//   │ ╔══╗  ╔══╗                    │
//   │ ║LD║  ║LD║                    │
//   │ ╚══╝  ╚══╝                    │
//   └────────────┬───────────────────┘
//      BASE ROCK  y=640              1600
//   0 ────────────────────────────
//
// Three tiers of floating rock platforms. Wind howls between the gaps;
// players must watch for knockback winds on higher tiers.

export const SKYHAVEN_DRIFTPEAKS: GameMap = {
  id: "skyhaven_driftpeaks",
  name: "Skyhaven Driftpeaks",
  bgmKey: "sky",
  bgSet: "sky",
  width: 1600,
  height: 740,

  footholds: [
    // ── Base rock (ground level of the lowest island) ───────────────────
    { id: 0, x1: 0, y1: 640, x2: 1600, y2: 640, solid: true },

    // ── Drift shelf (y≈440, x 200–1200) ────────────────────────────────
    { id: 1, x1: 200, y1: 440, x2: 1200, y2: 440 },

    // ── Mid rock (y≈280, x 300–1000) ───────────────────────────────────
    { id: 2, x1: 300, y1: 280, x2: 1000, y2: 280 },

    // ── Zephyr spire (y≈120, x 500–800) — highest island ───────────────
    { id: 3, x1: 500, y1: 120, x2: 800, y2: 120 },

    // ── Side pinnacle (y≈360, x 1200–1500) ──────────────────────────────
    { id: 4, x1: 1200, y1: 360, x2: 1500, y2: 360 },
  ],

  ladders: [
    // Base rock → drift shelf (left)
    { id: 0, x: 350, yTop: 440, yBottom: 640, kind: "ladder" },

    // Base rock → drift shelf (centre)
    { id: 1, x: 800, yTop: 440, yBottom: 640, kind: "ladder" },

    // Drift shelf → mid rock (centre)
    { id: 2, x: 600, yTop: 280, yBottom: 440, kind: "ladder" },

    // Mid rock → zephyr spire (centre)
    { id: 3, x: 650, yTop: 120, yBottom: 280, kind: "rope" },

    // Drift shelf → side pinnacle (right)
    { id: 4, x: 1150, yTop: 360, yBottom: 440, kind: "rope" },

    // Side pinnacle → base rock (far right)
    { id: 5, x: 1400, yTop: 360, yBottom: 640, kind: "rope" },
  ],

  spawns: [
    // Wind sprites on the drift shelf
    { footholdId: 1, mobId: "mob.wind_sprite", count: 6 },
    // Sky serpents on the mid rock
    { footholdId: 2, mobId: "mob.sky_serpent", count: 4 },
    // Thunder hawks at the zephyr spire
    { footholdId: 3, mobId: "mob.thunder_hawk", count: 3 },
    // Mixed wind sprites on the side pinnacle
    { footholdId: 4, mobId: "mob.wind_sprite", count: 4 },
  ],

  bossSpawns: [
    // Tempest Lord — storm titan boss on the zephyr spire
    { footholdId: 3, mobId: "mob.tempest_lord", count: 1, respawnIntervalMs: 300_000 },
  ],

  portals: [
    // Back to Skyhaven town
    {
      id: "return_to_skyhaven",
      x: 100,
      y: 640 - 40,
      toMapId: "skyhaven",
      toSpawnId: "to_driftpeaks",
      label: "🏙️ Return to Skyhaven",
    },
  ],

  spawnPoints: {
    // Entry from Skyhaven town
    entry: { x: 100, y: 640 - 40 },
    // Drift shelf landing
    drift_shelf: { x: 700, y: 440 - 40 },
  },

  playerSpawn: { x: 100, y: 640 - 40 },
};

// ---------------------------------------------------------------------------
// Frosthold — snow mountain town (El Nath parallel) Lv 35–50
// ---------------------------------------------------------------------------
//
// First snow biome payoff zone. A fortified mountain settlement perched on
// a glacial shelf — stone keep walls, icicle-laden rooftops, warm forge
// glow from within. The airship dock connects back to Skyhaven.
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────── 1800
//   │     ┌──────────┐ y=100          │
//     │     │ KEEP    │  frost mage   │
//     │     │ SPIRE   │  trainer      │
//     │     └──────────┘              │
//     │  ╔══╗ ┌────────────┐ y=260   │
//     │  ║RP║ │ UPPER WALL │         │
//     │  ╚══╝ └────────────┘         │
//     │      ┌──────────────┐ y=420  │
//     │ ╔══╗ │  TOWN PLAZA  │       │
//     │ ║LD║ └──────────────┘       │
//     │ ╚══╝                         │
//     │       ┌──────────────┐ y=560 │
//     │       │  DOCK SHELF  │       │
//     │       └──────────────┘       │
//     │ ╔══╗  ╔══╗                  │
//     │ ║LD║  ║RP║                  │
//     │ ╚══╝  ╚══╝                  │
//     └──────────┬───────────────────┘
//       SNOW DECK  y=720             1800
//   0 ────────────────────────────
//
// Frozen mountain settlement. Snow-laden stone buildings, glowing lanterns,
// evergreen trees frosted white. Safe zone — zero hostile mob spawns.

const FROSTHOLD_GROUND_Y = 720;

// Safe town — zero hostile mob spawns.
const FROSTHOLD_SPAWNS: readonly MobSpawnZone[] = [];

export const FROSTHOLD: GameMap = {
  id: "frosthold",
  name: "Frosthold",
  bgmKey: "cave",
  bgSet: "snow",
  width: 1800,
  height: 800,

  footholds: [
    // ── Snow deck / ground level (flat) ──────────────────────────────
    { id: 0, x1: 0, y1: FROSTHOLD_GROUND_Y, x2: 1800, y2: FROSTHOLD_GROUND_Y, solid: true },

    // ── Dock shelf (y≈560, x 200–1000) — airship dock area ────────────
    { id: 1, x1: 200, y1: 560, x2: 1000, y2: 560, slippery: true },

    // ── Town plaza (y≈420, x 400–1200) — central hub, shops & NPCs ────
    { id: 2, x1: 400, y1: 420, x2: 1200, y2: 420 },

    // ── Upper wall (y≈260, x 500–1000) — armoury & services ───────────
    { id: 3, x1: 500, y1: 260, x2: 1000, y2: 260, slippery: true },

    // ── Keep spire (y≈100, x 600–900) — frost mage trainer NPC ────────
    { id: 4, x1: 600, y1: 100, x2: 900, y2: 100 },

    // ── Departure dock (right side, y≈480, x 1400–1750) — airship to Skyhaven ─
    { id: 5, x1: 1400, y1: 480, x2: 1750, y2: 480, slippery: true },

    // ── Slope trail ledge (left side, y≈560, x 0–250) — path to slopes ──
    { id: 6, x1: 0, y1: 560, x2: 250, y2: 560, slippery: true },

    // ── Cave mouth platform (right side, y≈560, x 1100–1400) ───────────
    { id: 7, x1: 1100, y1: 560, x2: 1400, y2: 560, slippery: true },
  ],

  ladders: [
    // Snow deck → dock shelf (left)
    { id: 0, x: 400, yTop: 560, yBottom: FROSTHOLD_GROUND_Y, kind: "ladder" },

    // Dock shelf → town plaza (centre-left)
    { id: 1, x: 550, yTop: 420, yBottom: 560, kind: "ladder" },

    // Town plaza → upper wall (centre)
    { id: 2, x: 700, yTop: 260, yBottom: 420, kind: "ladder" },

    // Upper wall → keep spire (centre)
    { id: 3, x: 750, yTop: 100, yBottom: 260, kind: "rope" },

    // Snow deck → departure dock (right)
    { id: 4, x: 1350, yTop: 480, yBottom: FROSTHOLD_GROUND_Y, kind: "ladder" },

    // Departure dock → town plaza (right side)
    { id: 5, x: 1300, yTop: 420, yBottom: 480, kind: "rope" },

    // Snow deck → slope trail ledge (far left)
    { id: 6, x: 150, yTop: 560, yBottom: FROSTHOLD_GROUND_Y, kind: "rope" },

    // Town plaza → cave mouth platform (right)
    { id: 7, x: 1150, yTop: 420, yBottom: 560, kind: "ladder" },
  ],

  spawns: FROSTHOLD_SPAWNS,

  portals: [
    // Airship back to Skyhaven (scheduled transport)
    {
      id: "airship_to_skyhaven",
      x: 1575,
      y: 480 - 40,
      toMapId: "skyhaven",
      toSpawnId: "frosthold_dock",
      label: "✈️ Airship to Skyhaven",
      requiresLevel: 35,
      schedule: {
        intervalMs: 300_000, // every 5 minutes
        windowMs: 60_000, // 60-second boarding window
      },
    },
    // Path to Frosthold Slopes (slope trail ledge, far left)
    {
      id: "to_slopes",
      x: 80,
      y: 560 - 40,
      toMapId: "frosthold_slopes",
      toSpawnId: "entry",
      label: "🏔️ Ascend the Frozen Slopes",
      requiresLevel: 35,
    },
    // Path to Frosthold Icecave (cave mouth platform, right side)
    {
      id: "to_icecave",
      x: 1250,
      y: 560 - 40,
      toMapId: "frosthold_icecave",
      toSpawnId: "entry",
      label: "🧊 Enter the Ice Cavern",
      requiresLevel: 40,
    },
  ],

  spawnPoints: {
    // Arriving from airship (departure dock area)
    from_airship: { x: 1575, y: 480 - 40 },
    // Central town hub (town plaza)
    town: { x: 800, y: 420 - 40 },
    // Frost mage trainer (keep spire)
    trainer: { x: 750, y: 100 - 40 },
    // Airship departure platform
    departure: { x: 1575, y: 480 - 40 },
    // Frozen slopes trailhead
    to_slopes: { x: 80, y: 560 - 40 },
    // Icecave entrance
    to_icecave: { x: 1250, y: 560 - 40 },
  },

  playerSpawn: { x: 1575, y: 480 - 40 },
};

// ---------------------------------------------------------------------------
// Frosthold Slopes — snow mountain combat zone Lv 35–45
// ---------------------------------------------------------------------------
//
// Blizzard-swept mountain slopes above Frosthold. Jagged ice shelves and
// wind-carved stone ledges. Frost wolves prowl the lower slopes; ice
// elementals guard the frozen peaks. Glacius Prime, the frost titan, reigns
// from the highest ledge.
//
// Visual layout:
//
//   0 ──────────────────────────── 1800
//   │     ┌──────────┐ y=100          │
//   │     │ TITAN    │  (boss spawn)  │
//   │     │ LEDGE    │                │
//   │     └──────────┘                │
//   │  ╔══╗  ┌──────────┐ y=260      │
//   │  ║RP║  │ HIGH SHELF│           │
//   │  ╚══╝  └──────────┘            │
//   │      ┌──────────────┐ y=420    │
//   │      │  MID SLOPE   │          │
//   │      └──────────────┘          │
//   │ ╔══╗  ╔══╗  ┌──────────┐y=560 │
//   │ ║LD║  ║LD║  │ ICE SHELF│      │
//   │ ╚══╝  ╚══╝  └──────────┘      │
//   │       ╔══╗                     │
//   │       ║LD║                     │
//   │       ╚══╝                     │
//   └────────────┬───────────────────┘
//      BASE CAMP  y=700              1800
//   0 ────────────────────────────
//
// Blizzard winds buffet the upper tiers. Icy platforms throughout —
// the signature slippery terrain of the snow biome.

export const FROSTHOLD_SLOPES: GameMap = {
  id: "frosthold_slopes",
  name: "Frosthold Slopes",
  bgmKey: "sky",
  bgSet: "snow",
  width: 1800,
  height: 800,

  footholds: [
    // ── Base camp (ground level) ─────────────────────────────────────
    { id: 0, x1: 0, y1: 700, x2: 1800, y2: 700, solid: true },

    // ── Ice shelf (y≈560, x 200–1400) — frost wolves territory ────────
    { id: 1, x1: 200, y1: 560, x2: 1400, y2: 560, slippery: true },

    // ── Mid slope (y≈420, x 300–1200) — ice elementals territory ──────
    { id: 2, x1: 300, y1: 420, x2: 1200, y2: 420, slippery: true },

    // ── High shelf (y≈260, x 400–1100) — mixed elite mobs ─────────────
    { id: 3, x1: 400, y1: 260, x2: 1100, y2: 260, slippery: true },

    // ── Titan ledge (y≈100, x 500–900) — boss spawn ───────────────────
    { id: 4, x1: 500, y1: 100, x2: 900, y2: 100 },

    // ── Side ridge (y≈480, x 1300–1700) — roaming frost wraiths ───────
    { id: 5, x1: 1300, y1: 480, x2: 1700, y2: 480, slippery: true },
  ],

  ladders: [
    // Base camp → ice shelf (left)
    { id: 0, x: 350, yTop: 560, yBottom: 700, kind: "ladder" },

    // Base camp → ice shelf (centre)
    { id: 1, x: 800, yTop: 560, yBottom: 700, kind: "ladder" },

    // Ice shelf → mid slope (centre)
    { id: 2, x: 600, yTop: 420, yBottom: 560, kind: "ladder" },

    // Mid slope → high shelf (centre)
    { id: 3, x: 700, yTop: 260, yBottom: 420, kind: "ladder" },

    // High shelf → titan ledge (centre)
    { id: 4, x: 650, yTop: 100, yBottom: 260, kind: "rope" },

    // Ice shelf → side ridge (right)
    { id: 5, x: 1250, yTop: 480, yBottom: 560, kind: "rope" },

    // Side ridge → base camp (far right)
    { id: 6, x: 1600, yTop: 480, yBottom: 700, kind: "rope" },
  ],

  spawns: [
    // Frost wolves patrolling the ice shelf
    { footholdId: 1, mobId: "mob.frost_wolf", count: 6 },
    // Ice elementals on the mid slope
    { footholdId: 2, mobId: "mob.ice_elemental", count: 5 },
    // Snow wraiths on the high shelf
    { footholdId: 3, mobId: "mob.snow_wraith", count: 4 },
    // Frost wolves roaming the side ridge
    { footholdId: 5, mobId: "mob.frost_wolf", count: 3 },
  ],

  bossSpawns: [
    // Glacius Prime — frost titan boss on the titan ledge
    { footholdId: 4, mobId: "mob.glacius_prime", count: 1, respawnIntervalMs: 300_000 },
  ],

  portals: [
    // Back to Frosthold town (base camp, left side)
    {
      id: "return_to_town",
      x: 100,
      y: 700 - 40,
      toMapId: "frosthold",
      toSpawnId: "to_slopes",
      label: "❄️ Return to Frosthold",
    },
  ],

  spawnPoints: {
    // Entry from Frosthold town
    entry: { x: 100, y: 700 - 40 },
    // Ice shelf landing
    ice_shelf: { x: 700, y: 560 - 40 },
    // Titan ledge (boss)
    titan_ledge: { x: 700, y: 100 - 40 },
  },

  playerSpawn: { x: 100, y: 700 - 40 },
};

// ---------------------------------------------------------------------------
// Frosthold Icecave — underground ice cavern combat zone Lv 40–50
// ---------------------------------------------------------------------------
//
// A frozen cavern beneath the Frosthold mountains. Stalactites of blue ice,
// luminescent frost crystals, underground glacial rivers. Cave-dwelling ice
// creatures and ancient frozen horrors lurk in the deeper chambers.
//
// Visual layout:
//
//   0 ──────────────────────────── 1600
//   │      ┌──────────┐ y=120          │
//   │ ╔══╗ │ DEEP     │  (boss spawn)  │
//   │ ║RP║ │ CHAMBER  │               │
//   │ ╚══╝ └──────────┘               │
//   │    ┌──────────────┐ y=280       │
//   │    │ CRYSTAL GALLERY│           │
//   │    └──────────────┘            │
//   │ ╔══╗  ╔══╗ ┌──────────┐ y=440 │
//   │ ║LD║  ║LD║ │ FROST HALL│      │
//   │ ╚══╝  ╚══╝ └──────────┘      │
//   │       ╔══╗  ╔══╗              │
//   │       ║LD║  ║RP║              │
//   │       ╚══╝  ╚══╝              │
//   └────────────┬───────────────────┘
//      CAVE MOUTH  y=620             1600
//   0 ────────────────────────────
//
// The cave narrows as players descend deeper. Crystal-lined walls glow
// faintly blue. The deepest chamber houses the region's most fearsome
// beast — a glacial abomination sealed in ancient ice.

export const FROSTHOLD_ICECAVE: GameMap = {
  id: "frosthold_icecave",
  name: "Frosthold Icecave",
  bgmKey: "cave",
  width: 1600,
  height: 720,

  footholds: [
    // ── Cave mouth (ground level) ────────────────────────────────────
    { id: 0, x1: 0, y1: 620, x2: 1600, y2: 620, solid: true },

    // ── Frost hall (y≈440, x 200–1200) — frost crawlers territory ──────
    { id: 1, x1: 200, y1: 440, x2: 1200, y2: 440, slippery: true },

    // ── Crystal gallery (y≈280, x 300–1100) — crystal guardians ───────
    { id: 2, x1: 300, y1: 280, x2: 1100, y2: 280, slippery: true },

    // ── Deep chamber (y≈120, x 400–1000) — boss spawn ──────────────────
    { id: 3, x1: 400, y1: 120, x2: 1000, y2: 120 },

    // ── Side tunnel (y≈360, x 1200–1500) — elite frost wraiths ─────────
    { id: 4, x1: 1200, y1: 360, x2: 1500, y2: 360, slippery: true },
  ],

  ladders: [
    // Cave mouth → frost hall (left)
    { id: 0, x: 350, yTop: 440, yBottom: 620, kind: "ladder" },

    // Cave mouth → frost hall (centre)
    { id: 1, x: 700, yTop: 440, yBottom: 620, kind: "ladder" },

    // Frost hall → crystal gallery (centre)
    { id: 2, x: 600, yTop: 280, yBottom: 440, kind: "ladder" },

    // Crystal gallery → deep chamber (centre)
    { id: 3, x: 650, yTop: 120, yBottom: 280, kind: "rope" },

    // Frost hall → side tunnel (right)
    { id: 4, x: 1150, yTop: 360, yBottom: 440, kind: "rope" },

    // Side tunnel → cave mouth (far right)
    { id: 5, x: 1400, yTop: 360, yBottom: 620, kind: "rope" },
  ],

  spawns: [
    // Frost crawlers skittering along the frost hall
    { footholdId: 1, mobId: "mob.frost_crawler", count: 6 },
    // Crystal guardians guarding the crystal gallery
    { footholdId: 2, mobId: "mob.crystal_guardian", count: 5 },
    // Glacial shards near the deep chamber entrance
    { footholdId: 2, mobId: "mob.glacial_shard", count: 3 },
    // Permafrost revenants in the side tunnel (Lv 48)
    { footholdId: 4, mobId: "mob.permafrost_revenant", count: 4 },
    // Frost banshees in the deeper side tunnel (Lv 50)
    { footholdId: 4, mobId: "mob.frost_banshee", count: 3 },
  ],

  bossSpawns: [
    // The glacial abomination — ancient frozen boss in the deep chamber
    { footholdId: 3, mobId: "mob.glacial_abomination", count: 1, respawnIntervalMs: 300_000 },
  ],

  portals: [
    // Back to Frosthold town (cave mouth, left side)
    {
      id: "return_to_town",
      x: 100,
      y: 620 - 40,
      toMapId: "frosthold",
      toSpawnId: "to_icecave",
      label: "❄️ Return to Frosthold",
    },
  ],

  spawnPoints: {
    // Entry from Frosthold town cave mouth
    entry: { x: 100, y: 620 - 40 },
    // Frost hall landing
    frost_hall: { x: 600, y: 440 - 40 },
    // Deep chamber (boss)
    deep_chamber: { x: 700, y: 120 - 40 },
  },

  playerSpawn: { x: 100, y: 620 - 40 },
};

// ---------------------------------------------------------------------------
// Dusk Ward Subway PQ — instanced Party Quest maps (Lv 20–30)
// ---------------------------------------------------------------------------
//
// A multi-stage instanced PQ inspired by Kerning City's subway PQ.
// Five maps: staging → mob hunt → jump quest → puzzle room → boss.

// ── Stage 0: Staging Area ──────────────────────────────────────────────────
// Flat lobby where the party gathers before the run begins. The NPC portal
// at the right edge warps the party into stage 1 when the run starts.

const PQ_STAGING_GROUND_Y = 600;

const DUSK_SUBWAY_PQ_STAGING_SPAWNS: readonly MobSpawnZone[] = [];

export const DUSK_SUBWAY_PQ_STAGING: GameMap = {
  id: "dusk_subway_pq_staging",
  name: "Subway PQ — Staging Area",
  bgmKey: "cave",
  width: 1200,
  height: 700,

  footholds: [
    { id: 0, x1: 0, y1: PQ_STAGING_GROUND_Y, x2: 1200, y2: PQ_STAGING_GROUND_Y, solid: true },
  ],

  ladders: [],

  spawns: DUSK_SUBWAY_PQ_STAGING_SPAWNS,

  portals: [
    {
      id: "pq_enter_stage1",
      x: 1050,
      y: PQ_STAGING_GROUND_Y - 40,
      toMapId: "dusk_subway_pq_stage1",
      toSpawnId: "entry",
      label: "🚇 Enter the Tunnels",
    },
    {
      id: "pq_leave",
      x: 100,
      y: PQ_STAGING_GROUND_Y - 40,
      toMapId: "dusk_ward_subway",
      toSpawnId: "entry",
      label: "🔙 Leave the PQ",
    },
  ],

  spawnPoints: {
    entry: { x: 300, y: PQ_STAGING_GROUND_Y - 40 },
  },

  playerSpawn: { x: 300, y: PQ_STAGING_GROUND_Y - 40 },
};

// ── Stage 1: Mob Hunt (collect subway passes) ──────────────────────────────
// Wider tunnel with multiple tiers of platforms. Subway Horrors and Overseers
// patrol every level. The party must collect enough passes to advance.

export const DUSK_SUBWAY_PQ_STAGE1: GameMap = {
  id: "dusk_subway_pq_stage1",
  name: "Subway PQ — Infested Tunnels",
  bgmKey: "cave",
  width: 1800,
  height: 800,

  footholds: [
    // Track bed
    { id: 0, x1: 0, y1: 680, x2: 1800, y2: 680, solid: true },
    // Lower platform (y≈520, x 100–1500)
    { id: 1, x1: 100, y1: 520, x2: 1500, y2: 520 },
    // Mid platform (y≈360, x 200–1400)
    { id: 2, x1: 200, y1: 360, x2: 1400, y2: 360 },
    // Upper maintenance walk (y≈200, x 400–1200)
    { id: 3, x1: 400, y1: 200, x2: 1200, y2: 200 },
  ],

  ladders: [
    { id: 0, x: 300, yTop: 520, yBottom: 680, kind: "ladder" },
    { id: 1, x: 900, yTop: 520, yBottom: 680, kind: "ladder" },
    { id: 2, x: 500, yTop: 360, yBottom: 520, kind: "ladder" },
    { id: 3, x: 1100, yTop: 360, yBottom: 520, kind: "ladder" },
    { id: 4, x: 700, yTop: 200, yBottom: 360, kind: "rope" },
  ],

  spawns: [
    { footholdId: 0, mobId: "mob.subway_horror", count: 6 },
    { footholdId: 1, mobId: "mob.subway_horror", count: 5 },
    { footholdId: 2, mobId: "mob.subway_overseer", count: 4 },
    { footholdId: 3, mobId: "mob.subway_overseer", count: 3 },
  ],

  portals: [
    {
      id: "return_to_staging",
      x: 100,
      y: 680 - 40,
      toMapId: "dusk_subway_pq_staging",
      toSpawnId: "entry",
      label: "🔙 Return to Staging",
    },
    {
      id: "pq_enter_stage2",
      x: 1650,
      y: 680 - 40,
      toMapId: "dusk_subway_pq_stage2",
      toSpawnId: "entry",
      label: "➡️ Proceed to the Rails",
    },
  ],

  spawnPoints: {
    entry: { x: 150, y: 680 - 40 },
  },

  playerSpawn: { x: 150, y: 680 - 40 },
};

// ── Stage 2: Jump Quest ─────────────────────────────────────────────────────
// Scattered platforms with gaps. The party must platform up through a series
// of small footholds to reach the portal at the top. Falling respawns you
// at the bottom.

export const DUSK_SUBWAY_PQ_STAGE2: GameMap = {
  id: "dusk_subway_pq_stage2",
  name: "Subway PQ — Broken Rails",
  bgmKey: "cave",
  width: 1200,
  height: 800,

  footholds: [
    // Floor (fall respawn)
    { id: 0, x1: 0, y1: 720, x2: 1200, y2: 720, solid: true },
    // Tier 1 platforms (scattered small footholds)
    { id: 1, x1: 100, y1: 580, x2: 260, y2: 580 },
    { id: 2, x1: 360, y1: 520, x2: 480, y2: 520 },
    { id: 3, x1: 560, y1: 600, x2: 700, y2: 600 },
    // Tier 2 platforms
    { id: 4, x1: 150, y1: 440, x2: 320, y2: 440 },
    { id: 5, x1: 420, y1: 380, x2: 560, y2: 380 },
    { id: 6, x1: 650, y1: 440, x2: 800, y2: 440 },
    // Tier 3 platforms
    { id: 7, x1: 250, y1: 280, x2: 400, y2: 280 },
    { id: 8, x1: 500, y1: 240, x2: 660, y2: 240 },
    // Top platform — portal target
    { id: 9, x1: 350, y1: 120, x2: 550, y2: 120 },
  ],

  ladders: [
    { id: 0, x: 200, yTop: 580, yBottom: 720, kind: "ladder" },
    { id: 1, x: 300, yTop: 280, yBottom: 440, kind: "rope" },
  ],

  spawns: [
    // No mobs — pure platforming challenge
  ],

  portals: [
    {
      id: "return_to_staging",
      x: 100,
      y: 720 - 40,
      toMapId: "dusk_subway_pq_staging",
      toSpawnId: "entry",
      label: "🔙 Return to Staging",
    },
    {
      id: "pq_enter_stage3",
      x: 450,
      y: 120 - 40,
      toMapId: "dusk_subway_pq_stage3",
      toSpawnId: "entry",
      label: "➡️ Enter the Signal Room",
    },
  ],

  spawnPoints: {
    entry: { x: 100, y: 720 - 40 },
  },

  playerSpawn: { x: 100, y: 720 - 40 },
};

// ── Stage 3: Puzzle / Combo Room ────────────────────────────────────────────
// A central platform where the party must solve a signal-combo puzzle.
// The server evaluates the puzzle; the map provides the arena.

export const DUSK_SUBWAY_PQ_STAGE3: GameMap = {
  id: "dusk_subway_pq_stage3",
  name: "Subway PQ — Signal Room",
  bgmKey: "cave",
  width: 1200,
  height: 700,

  footholds: [
    // Ground
    { id: 0, x1: 0, y1: 600, x2: 1200, y2: 600, solid: true },
    // Central puzzle platform (y≈360)
    { id: 1, x1: 200, y1: 360, x2: 1000, y2: 360 },
    // Upper ledge (y≈180)
    { id: 2, x1: 400, y1: 180, x2: 800, y2: 180 },
  ],

  ladders: [
    { id: 0, x: 600, yTop: 360, yBottom: 600, kind: "ladder" },
    { id: 1, x: 600, yTop: 180, yBottom: 360, kind: "rope" },
  ],

  spawns: [
    // Puzzle room — no combat, server-side logic
  ],

  portals: [
    {
      id: "return_to_staging",
      x: 100,
      y: 600 - 40,
      toMapId: "dusk_subway_pq_staging",
      toSpawnId: "entry",
      label: "🔙 Return to Staging",
    },
    {
      id: "pq_enter_stage4",
      x: 600,
      y: 180 - 40,
      toMapId: "dusk_subway_pq_stage4",
      toSpawnId: "entry",
      label: "➡️ Descend to the Boss",
    },
  ],

  spawnPoints: {
    entry: { x: 600, y: 600 - 40 },
  },

  playerSpawn: { x: 600, y: 600 - 40 },
};

// ── Stage 4: Boss Room ──────────────────────────────────────────────────────
// A wide arena with a central platform. The Gaze of the Abyss (curse-eye)
// spawns on the upper platform. Defeating it and reaching the exit portal
// completes the PQ.

export const DUSK_SUBWAY_PQ_STAGE4: GameMap = {
  id: "dusk_subway_pq_stage4",
  name: "Subway PQ — Eye of the Abyss",
  bgmKey: "cave",
  width: 1400,
  height: 750,

  footholds: [
    // Arena floor
    { id: 0, x1: 0, y1: 640, x2: 1400, y2: 640, solid: true },
    // Mid arena platform (y≈420, x 200–1200)
    { id: 1, x1: 200, y1: 420, x2: 1200, y2: 420 },
    // Boss pedestal (y≈200, x 400–1000)
    { id: 2, x1: 400, y1: 200, x2: 1000, y2: 200 },
    // Exit ledge (y≈280, x 1100–1350)
    { id: 3, x1: 1100, y1: 280, x2: 1350, y2: 280 },
  ],

  ladders: [
    { id: 0, x: 400, yTop: 420, yBottom: 640, kind: "ladder" },
    { id: 1, x: 700, yTop: 200, yBottom: 420, kind: "rope" },
    { id: 2, x: 1150, yTop: 280, yBottom: 420, kind: "rope" },
  ],

  spawns: [],

  bossSpawns: [
    // The boss — Gaze of the Abyss
    { footholdId: 2, mobId: "mob.subway_curse_eye", count: 1, respawnIntervalMs: 300_000 },
  ],

  portals: [
    {
      id: "return_to_staging",
      x: 100,
      y: 640 - 40,
      toMapId: "dusk_subway_pq_staging",
      toSpawnId: "entry",
      label: "🔙 Return to Staging",
    },
    {
      id: "pq_complete",
      x: 1225,
      y: 280 - 40,
      toMapId: "dusk_ward_subway",
      toSpawnId: "entry",
      label: "🎉 Complete PQ",
    },
  ],

  spawnPoints: {
    entry: { x: 200, y: 640 - 40 },
    boss: { x: 700, y: 200 - 40 },
  },

  playerSpawn: { x: 200, y: 640 - 40 },
};

// ---------------------------------------------------------------------------
// Tideways — underwater coastal town (Aqua Road parallel) Lv 35–60
// ---------------------------------------------------------------------------
//
// An underwater settlement built around coral towers and sunken-ship
// architecture. Luminescent jellyfish drift lazily overhead; schools of
// silver fish dart between coral pillars. A scheduled boat ride from
// Skyhaven delivers adventurers to the Tideways dock.
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────── 1600
//   │    ┌───────────┐ y=100         │
//   │    │ CORAL SPIRE│  (NPC area)   │
//   │    └───────────┘               │
//   │  ╔══╗ ┌────────────┐ y=260    │
//   │  ║RP║ │ UPPER REEF │          │
//   │  ╚══╝ └────────────┘          │
//   │      ┌──────────────┐ y=420   │
//   │ ╔══╗ │  TOWN PLAZA  │        │
//   │ ║LD║ └──────────────┘        │
//   │ ╚══╝                          │
//   │       ┌──────────────┐ y=560 │
//   │       │  DOCK PLAT   │       │
//   │       └──────────────┘       │
//   │ ╔══╗  ╔══╗                  │
//   │ ║LD║  ║RP║                  │
//   │ ╚══╝  ╚══╝                  │
//   └──────────┬───────────────────┘
//      SEABED  y=700               1600
//   0 ────────────────────────────
//
// Safe underwater town — zero hostile mob spawns. Bioluminescent coral
// and kelp forests frame the architecture. Swimming physics apply here.

const TIDEWAYS_GROUND_Y = 700;

// Safe town — zero hostile mob spawns.
const TIDEWAYS_SPAWNS: readonly MobSpawnZone[] = [];

export const TIDEWAYS: GameMap = {
  id: "tideways",
  name: "Tideways",
  swimming: true,
  bgmKey: "cave",
  width: 1600,
  height: 800,

  footholds: [
    // ── Seabed / ground level (flat) ──────────────────────────────────
    { id: 0, x1: 0, y1: TIDEWAYS_GROUND_Y, x2: 1600, y2: TIDEWAYS_GROUND_Y, solid: true },

    // ── Dock platform (y≈560, x 200–1100) — boat arrival area ─────────
    { id: 1, x1: 200, y1: 560, x2: 1100, y2: 560 },

    // ── Town plaza (y≈420, x 300–1200) — central hub, shops & NPCs ────
    { id: 2, x1: 300, y1: 420, x2: 1200, y2: 420 },

    // ── Upper reef (y≈260, x 400–1000) — services & trainers ─────────
    { id: 3, x1: 400, y1: 260, x2: 1000, y2: 260 },

    // ── Coral spire (y≈100, x 500–900) — NPC area ────────────────────
    { id: 4, x1: 500, y1: 100, x2: 900, y2: 100 },

    // ── Departure dock (right side, y≈480, x 1300–1550) ───────────────
    { id: 5, x1: 1300, y1: 480, x2: 1550, y2: 480 },

    // ── Reef trail ledge (left side, y≈560, x 0–250) ──────────────────
    { id: 6, x1: 0, y1: 560, x2: 250, y2: 560 },
  ],

  ladders: [
    // Seabed → dock platform (left)
    { id: 0, x: 400, yTop: 560, yBottom: TIDEWAYS_GROUND_Y, kind: "ladder" },

    // Dock platform → town plaza (centre-left)
    { id: 1, x: 550, yTop: 420, yBottom: 560, kind: "ladder" },

    // Town plaza → upper reef (centre)
    { id: 2, x: 700, yTop: 260, yBottom: 420, kind: "ladder" },

    // Upper reef → coral spire (centre)
    { id: 3, x: 750, yTop: 100, yBottom: 260, kind: "rope" },

    // Seabed → departure dock (right)
    { id: 4, x: 1350, yTop: 480, yBottom: TIDEWAYS_GROUND_Y, kind: "ladder" },

    // Seabed → reef trail ledge (far left)
    { id: 5, x: 150, yTop: 560, yBottom: TIDEWAYS_GROUND_Y, kind: "rope" },
  ],

  spawns: TIDEWAYS_SPAWNS,

  portals: [
    // Boat back to Skyhaven (scheduled transport)
    {
      id: "boat_to_skyhaven",
      x: 1425,
      y: 480 - 40,
      toMapId: "skyhaven",
      toSpawnId: "tideways_dock",
      label: "⛵ Boat to Skyhaven",
      requiresLevel: 35,
      schedule: {
        intervalMs: 300_000, // every 5 minutes
        windowMs: 60_000, // 60-second boarding window
      },
    },
    // Path to Pearlgate Reef (reef trail ledge, far left)
    {
      id: "to_reef",
      x: 80,
      y: 560 - 40,
      toMapId: "tideways_reef",
      toSpawnId: "entry",
      label: "🐚 Dive to the Reef",
      requiresLevel: 35,
      comingSoon: true,
    },
    // Path to Pearlgate Abyss (dock platform, right side)
    {
      id: "to_abyss",
      x: 1050,
      y: 560 - 40,
      toMapId: "tideways_abyss",
      toSpawnId: "entry",
      label: "🦑 Descend to the Abyss",
      requiresLevel: 45,
      comingSoon: true,
    },
  ],

  spawnPoints: {
    // Arriving from boat (departure dock area)
    from_boat: { x: 1425, y: 480 - 40 },
    // Central town hub (town plaza)
    town: { x: 800, y: 420 - 40 },
    // Coral spire (NPC area)
    trainer: { x: 750, y: 100 - 40 },
    // Boat departure platform
    departure: { x: 1425, y: 480 - 40 },
    // Reef trailhead
    to_reef: { x: 80, y: 560 - 40 },
    // Abyss entrance
    to_abyss: { x: 1050, y: 560 - 40 },
  },

  playerSpawn: { x: 1425, y: 480 - 40 },
};

// ---------------------------------------------------------------------------
// Tideways Reef — underwater coral combat zone Lv 35–45
// ---------------------------------------------------------------------------
//
// Sunlit coral gardens teeming with hostile sea life. Anglerfish prowl the
// crevices, jellyfish drift between coral spires, and pufferfish bob along
// the seabed. The first combat zone of the underwater region.
//
// Visual layout:
//
//   0 ──────────────────────────── 1600
//   │     ┌──────────┐ y=100          │
//   │     │ TOP REEF │  (anglerfish)  │
//   │     └──────────┘                │
//   │  ╔══╗  ┌──────────┐ y=260      │
//   │  ║RP║  │ MID REEF │            │
//   │  ╚══╝  └──────────┘            │
//   │      ┌──────────────┐ y=420    │
//   │      │  CORAL PLAT  │          │
//   │      └──────────────┘          │
//   │ ╔══╗  ╔══╗                    │
//   │ ║LD║  ║LD║                    │
//   │ ╚══╝  ╚══╝                    │
//   └────────────┬───────────────────┘
//      SEABED  y=620                1600
//   0 ────────────────────────────
//
// Bioluminescent coral and kelp fronds. The shallow reef is bright and
// colourful — the deeper you go the darker and more dangerous it gets.

export const TIDEWAYS_REEF: GameMap = {
  id: "tideways_reef",
  name: "Tideways Reef",
  swimming: true,
  bgmKey: "cave",
  width: 1600,
  height: 720,

  footholds: [
    // ── Seabed (ground level) ──────────────────────────────────────────
    { id: 0, x1: 0, y1: 620, x2: 1600, y2: 620, solid: true },

    // ── Coral platform (y≈420, x 200–1200) ────────────────────────────
    { id: 1, x1: 200, y1: 420, x2: 1200, y2: 420 },

    // ── Mid reef (y≈260, x 300–1100) ─────────────────────────────────
    { id: 2, x1: 300, y1: 260, x2: 1100, y2: 260 },

    // ── Top reef (y≈100, x 400–1000) ─────────────────────────────────
    { id: 3, x1: 400, y1: 100, x2: 1000, y2: 100 },

    // ── Side kelp ledge (y≈360, x 1200–1500) ──────────────────────────
    { id: 4, x1: 1200, y1: 360, x2: 1500, y2: 360 },
  ],

  ladders: [
    // Seabed → coral platform (left)
    { id: 0, x: 350, yTop: 420, yBottom: 620, kind: "ladder" },

    // Seabed → coral platform (centre)
    { id: 1, x: 700, yTop: 420, yBottom: 620, kind: "ladder" },

    // Coral platform → mid reef (centre)
    { id: 2, x: 600, yTop: 260, yBottom: 420, kind: "ladder" },

    // Mid reef → top reef (centre)
    { id: 3, x: 650, yTop: 100, yBottom: 260, kind: "rope" },

    // Coral platform → side kelp ledge (right)
    { id: 4, x: 1150, yTop: 360, yBottom: 420, kind: "rope" },

    // Side kelp ledge → seabed (far right)
    { id: 5, x: 1400, yTop: 360, yBottom: 620, kind: "rope" },
  ],

  spawns: [
    // Jellyfish drifting along the seabed
    { footholdId: 0, mobId: "mob.reef_jellyfish", count: 6 },
    // Sea urchins scuttling on the coral platform
    { footholdId: 1, mobId: "mob.sea_urchin", count: 5 },
    // Pufferfish floating around the mid reef
    { footholdId: 2, mobId: "mob.pufferfish", count: 4 },
    // Anglerfish lurking at the top reef
    { footholdId: 3, mobId: "mob.anglerfish", count: 3 },
    // Mixed mobs on the kelp ledge
    { footholdId: 4, mobId: "mob.reef_jellyfish", count: 4 },
  ],

  portals: [
    // Back to Tideways town (seabed, left side)
    {
      id: "return_to_town",
      x: 100,
      y: 620 - 40,
      toMapId: "tideways",
      toSpawnId: "to_reef",
      label: "🏠 Return to Tideways",
      comingSoon: true,
    },
  ],

  playerSpawn: { x: 100, y: 620 - 40 },

  spawnPoints: {
    entry: { x: 100, y: 620 - 40 },
  },
};

// ---------------------------------------------------------------------------
// Tideways Abyss — deep-sea combat zone Lv 45–60
// ---------------------------------------------------------------------------
//
// The sunless depths below the reef. Crushed stone, hydrothermal vents,
// and bioluminescent bacteria provide the only light. Tiger sharks patrol
// the open water; abyssal kraken spawn tentacles in the deepest trench.
//
// Visual layout:
//
//   0 ──────────────────────────── 1600
//   │      ┌──────────┐ y=120          │
//   │ ╔══╗ │ DEEP     │  (boss spawn)  │
//   │ ║RP║ │ TRENCH   │               │
//   │ ╚══╝ └──────────┘               │
//   │    ┌──────────────┐ y=280       │
//   │    │ VENT SHELF   │            │
//   │    └──────────────┘            │
//   │ ╔══╗  ╔══╗ ┌──────────┐ y=440 │
//   │ ║LD║  ║LD║ │ MID ABYSS │      │
//   │ ╚══╝  ╚══╝ └──────────┘      │
//   │       ╔══╗  ╔══╗              │
//   │       ║LD║  ║RP║              │
//   │       ╚══╝  ╚══╝              │
//   └────────────┬───────────────────┘
//      ABYSSAL FLOOR  y=640          1600
//   0 ────────────────────────────
//
// Crushing darkness with pockets of bioluminescence. The deepest zone
// of the underwater region — the Kraken lurks in the trench at the very top.

export const TIDEWAYS_ABYSS: GameMap = {
  id: "tideways_abyss",
  name: "Tideways Abyss",
  swimming: true,
  bgmKey: "dungeon",
  width: 1600,
  height: 720,

  footholds: [
    // ── Abyssal floor (ground level) ───────────────────────────────────
    { id: 0, x1: 0, y1: 640, x2: 1600, y2: 640, solid: true },

    // ── Mid abyss (y≈440, x 200–1200) — tiger sharks territory ─────────
    { id: 1, x1: 200, y1: 440, x2: 1200, y2: 440 },

    // ── Vent shelf (y≈280, x 300–1100) — tiger sharks + anglerfish ────
    { id: 2, x1: 300, y1: 280, x2: 1100, y2: 280 },

    // ── Deep trench (y≈120, x 400–1000) — boss spawn ───────────────────
    { id: 3, x1: 400, y1: 120, x2: 1000, y2: 120 },

    // ── Side vent (y≈360, x 1200–1500) — anglerfish packs ──────────────
    { id: 4, x1: 1200, y1: 360, x2: 1500, y2: 360 },
  ],

  ladders: [
    // Abyssal floor → mid abyss (left)
    { id: 0, x: 350, yTop: 440, yBottom: 640, kind: "ladder" },

    // Abyssal floor → mid abyss (centre)
    { id: 1, x: 700, yTop: 440, yBottom: 640, kind: "ladder" },

    // Mid abyss → vent shelf (centre)
    { id: 2, x: 600, yTop: 280, yBottom: 440, kind: "ladder" },

    // Vent shelf → deep trench (centre)
    { id: 3, x: 650, yTop: 120, yBottom: 280, kind: "rope" },

    // Mid abyss → side vent (right)
    { id: 4, x: 1150, yTop: 360, yBottom: 440, kind: "rope" },

    // Side vent → abyssal floor (far right)
    { id: 5, x: 1400, yTop: 360, yBottom: 640, kind: "rope" },
  ],

  spawns: [
    // Tiger sharks patrolling the abyssal floor
    { footholdId: 0, mobId: "mob.tiger_shark", count: 6 },
    // Tiger sharks on the mid abyss
    { footholdId: 1, mobId: "mob.tiger_shark", count: 5 },
    // Mixed predators on the vent shelf
    { footholdId: 2, mobId: "mob.anglerfish", count: 4 },
    { footholdId: 2, mobId: "mob.tiger_shark", count: 3 },
    // Sea serpents patrolling the vent shelf
    { footholdId: 2, mobId: "mob.sea_serpent", count: 3 },
    // Anglerfish packs on the side vent
    { footholdId: 4, mobId: "mob.anglerfish", count: 5 },
  ],

  bossSpawns: [
    // The Kraken — abyssal boss in the deep trench
    { footholdId: 3, mobId: "mob.kraken", count: 1, respawnIntervalMs: 300_000 },
  ],

  portals: [
    // Back to Tideways town (abyssal floor, left side)
    {
      id: "return_to_town",
      x: 100,
      y: 640 - 40,
      toMapId: "tideways",
      toSpawnId: "to_abyss",
      label: "🏠 Return to Tideways",
      comingSoon: true,
    },
  ],

  playerSpawn: { x: 100, y: 640 - 40 },

  spawnPoints: {
    entry: { x: 100, y: 640 - 40 },
  },
};

// ---------------------------------------------------------------------------
// Drakemoor — dragon jungle hub town (Leafre parity) Lv 100+
// ---------------------------------------------------------------------------
//
// The first true endgame zone. A colossal jungle choked with ancient trees
// and volcanic vents. The settlement is carved into the trunk of a petrified
// dragon-spine tree — half-natural, half-ruined architecture. Accessible from
// Crossway via a scheduled airship that requires Lv 100.
//
// Visual layout (screen coordinates, origin top-left):
//
//   0 ──────────────────────────── 1800
//   │    ┌───────────┐ y=100        │
//   │    │ VOLCANIC  │  (endgame    │
//   │    │ SPIRE     │   guide NPC) │
//   │    └───────────┘              │
//   │  ╔══╗ ┌────────────┐ y=260   │
//   │  ║RP║ │ UPPER RAMP │         │
//   │  ╚══╝ └────────────┘         │
//   │      ┌──────────────┐ y=420  │
//   │ ╔══╗ │  MARKET PLT  │       │
//   │ ║LD║ └──────────────┘       │
//   │ ╚══╝                         │
//   │       ┌──────────────┐ y=560 │
//   │       │  DRAGON DOCK │       │
//   │       └──────────────┘       │
//   │ ╔══╗  ╔══╗                  │
//   │ ║LD║  ║RP║                  │
//   │ ╚══╝  ╚══╝                  │
//   └──────────┬───────────────────┘
//      ROOT DECK  y=720            1800
//   0 ────────────────────────────
//
// Safe town — zero hostile mob spawns. Volcanic haze drifts overhead;
// massive dragon bones jut from the jungle canopy as structural pillars.

const DRAKEMOOR_GROUND_Y = 720;

const DRAKEMOOR_SPAWNS: readonly MobSpawnZone[] = [];

export const DRAKEMOOR: GameMap = {
  id: "drakemoor",
  name: "Drakemoor",
  bgmKey: "dungeon",
  width: 1800,
  height: 800,

  footholds: [
    // ── Root deck / ground level ────────────────────────────────────
    { id: 0, x1: 0, y1: DRAKEMOOR_GROUND_Y, x2: 1800, y2: DRAKEMOOR_GROUND_Y, solid: true },

    // ── Dragon dock (y≈560, x 200–1000) — airship arrival ───────────
    { id: 1, x1: 200, y1: 560, x2: 1000, y2: 560 },

    // ── Market platform (y≈420, x 400–1200) — shops & NPCs ─────────
    { id: 2, x1: 400, y1: 420, x2: 1200, y2: 420 },

    // ── Upper ramp (y≈260, x 500–1000) — services & armourer ──────
    { id: 3, x1: 500, y1: 260, x2: 1000, y2: 260 },

    // ── Volcanic spire (y≈100, x 600–900) — endgame guide NPC ─────
    { id: 4, x1: 600, y1: 100, x2: 900, y2: 100 },

    // ── Departure dock (right side, y≈480, x 1400–1750) ───────────
    { id: 5, x1: 1400, y1: 480, x2: 1750, y2: 480 },

    // ── Jungle trail ledge (left side, y≈560, x 0–250) ─────────────
    { id: 6, x1: 0, y1: 560, x2: 250, y2: 560 },

    // ── Abyss gate platform (right side, y≈560, x 1100–1400) ──────
    { id: 7, x1: 1100, y1: 560, x2: 1400, y2: 560 },
  ],

  ladders: [
    // Root deck → dragon dock (left)
    { id: 0, x: 400, yTop: 560, yBottom: DRAKEMOOR_GROUND_Y, kind: "ladder" },
    // Dragon dock → market platform (centre-left)
    { id: 1, x: 550, yTop: 420, yBottom: 560, kind: "ladder" },
    // Market platform → upper ramp (centre)
    { id: 2, x: 700, yTop: 260, yBottom: 420, kind: "ladder" },
    // Upper ramp → volcanic spire (centre)
    { id: 3, x: 750, yTop: 100, yBottom: 260, kind: "rope" },
    // Root deck → departure dock (right)
    { id: 4, x: 1350, yTop: 480, yBottom: DRAKEMOOR_GROUND_Y, kind: "ladder" },
    // Departure dock → market platform (right)
    { id: 5, x: 1300, yTop: 420, yBottom: 480, kind: "rope" },
    // Root deck → jungle trail ledge (far left)
    { id: 6, x: 125, yTop: 560, yBottom: DRAKEMOOR_GROUND_Y, kind: "rope" },
    // Market platform → abyss gate platform (right)
    { id: 7, x: 1150, yTop: 420, yBottom: 560, kind: "ladder" },
  ],

  spawns: DRAKEMOOR_SPAWNS,

  portals: [
    // Airship back to Crossway (scheduled transport, requires Lv 100)
    {
      id: "airship_to_crossway",
      x: 1575,
      y: 480 - 40,
      toMapId: "crossway",
      toSpawnId: "sky_dock",
      label: "✈️ Airship to Crossway",
      requiresLevel: 100,
      schedule: {
        intervalMs: 300_000,
        windowMs: 60_000,
      },
    },
    // Path to Jungle Floor combat zone (jungle trail ledge, far left)
    {
      id: "to_jungle_floor",
      x: 80,
      y: 560 - 40,
      toMapId: "drakemoor_jungle_floor",
      toSpawnId: "entry",
      label: "🌿 Brave the Jungle Floor",
      requiresLevel: 90,
      comingSoon: true,
    },
    // Path to Dragon Abyss combat zone (abyss gate platform, right)
    {
      id: "to_dragon_abyss",
      x: 1250,
      y: 560 - 40,
      toMapId: "drakemoor_dragon_abyss",
      toSpawnId: "entry",
      label: "🐉 Descend to the Dragon Abyss",
      requiresLevel: 110,
      comingSoon: true,
    },
  ],

  spawnPoints: {
    from_airship: { x: 1575, y: 480 - 40 },
    town: { x: 800, y: 420 - 40 },
    trainer: { x: 750, y: 100 - 40 },
    departure: { x: 1575, y: 480 - 40 },
    to_jungle_floor: { x: 80, y: 560 - 40 },
    to_dragon_abyss: { x: 1250, y: 560 - 40 },
  },

  playerSpawn: { x: 1575, y: 480 - 40 },
};

// ---------------------------------------------------------------------------
// Drakemoor Jungle Floor — dense jungle combat zone Lv 90–110
// ---------------------------------------------------------------------------
//
// A suffocatingly dense jungle floor. Bioluminescent fungi illuminate the
// understory. Vipers coil around vine-choked pillars; fang beetles burrow
// through fallen logs. Multiple tiers of tangled root platforms create a
// layered combat arena. Dense spawns — the signature endgame grind.
//
// Visual layout:
//
//   0 ──────────────────────────── 1800
//   │     ┌──────────┐ y=100          │
//   │     │ CANOPY   │  (vine wraiths)│
//   │     │ NEST     │                │
//   │     └──────────┘                │
//   │  ╔══╗  ┌──────────┐ y=260      │
//   │  ║RP║  │ HIGH ROOT│            │
//   │  ╚══╝  └──────────┘            │
//   │      ┌──────────────┐ y=420    │
//   │      │  MID VINE    │          │
//   │      └──────────────┘          │
//   │ ╔══╗  ╔══╗  ┌──────────┐y=560 │
//   │ ║LD║  ║LD║  │ LOW ROOT │     │
//   │ ╚══╝  ╚══╝  └──────────┘     │
//   │       ╔══╗                    │
//   │       ║LD║                    │
//   │       ╚══╝                    │
//   └────────────┬───────────────────┘
//      JUNGLE FLOOR  y=700           1800
//   0 ────────────────────────────
//
// Overgrown ruins and massive root networks form the combat platforms.
// Vines and fungi everywhere — a visually distinct biome.

export const DRAKEMOOR_JUNGLE_FLOOR: GameMap = {
  id: "drakemoor_jungle_floor",
  name: "Drakemoor Jungle Floor",
  bgmKey: "forest",
  width: 1800,
  height: 780,

  footholds: [
    // ── Jungle floor (ground level) ─────────────────────────────────
    { id: 0, x1: 0, y1: 700, x2: 1800, y2: 700, solid: true },
    // ── Low root network (y≈560, x 100–1500) ────────────────────────
    { id: 1, x1: 100, y1: 560, x2: 1500, y2: 560 },
    // ── Mid vine bridge (y≈420, x 200–1400) ─────────────────────────
    { id: 2, x1: 200, y1: 420, x2: 1400, y2: 420 },
    // ── High root shelf (y≈260, x 300–1200) ─────────────────────────
    { id: 3, x1: 300, y1: 260, x2: 1200, y2: 260 },
    // ── Canopy nest (y≈100, x 500–900) ─────────────────────────────
    { id: 4, x1: 500, y1: 100, x2: 900, y2: 100 },
    // ── Side hollow (y≈380, x 1500–1750) ────────────────────────────
    { id: 5, x1: 1500, y1: 380, x2: 1750, y2: 380 },
  ],

  ladders: [
    // Jungle floor → low root (left)
    { id: 0, x: 300, yTop: 560, yBottom: 700, kind: "ladder" },
    // Jungle floor → low root (centre)
    { id: 1, x: 900, yTop: 560, yBottom: 700, kind: "ladder" },
    // Low root → mid vine (centre)
    { id: 2, x: 600, yTop: 420, yBottom: 560, kind: "ladder" },
    // Mid vine → high root (centre)
    { id: 3, x: 700, yTop: 260, yBottom: 420, kind: "ladder" },
    // High root → canopy nest (centre)
    { id: 4, x: 650, yTop: 100, yBottom: 260, kind: "rope" },
    // Mid vine → side hollow (right)
    { id: 5, x: 1450, yTop: 380, yBottom: 420, kind: "rope" },
    // Side hollow → jungle floor (far right)
    { id: 6, x: 1650, yTop: 380, yBottom: 700, kind: "rope" },
  ],

  spawns: [
    // Jungle vipers coiling across the floor
    { footholdId: 0, mobId: "mob.jungle_viper", count: 8 },
    // Fang beetles burrowing through roots
    { footholdId: 1, mobId: "mob.fang_beetle", count: 7 },
    // Dragon skeletons on the mid vine
    { footholdId: 2, mobId: "mob.dragon_skeleton", count: 6 },
    // Vine wraiths on the high root shelf
    { footholdId: 3, mobId: "mob.vine_wraith", count: 5 },
    // Mixed predators in the canopy nest
    { footholdId: 4, mobId: "mob.crimson_drake", count: 3 },
    // Dense vipers in the side hollow
    { footholdId: 5, mobId: "mob.jungle_viper", count: 5 },
  ],

  portals: [
    // Back to Drakemoor town
    {
      id: "return_to_town",
      x: 100,
      y: 700 - 40,
      toMapId: "drakemoor",
      toSpawnId: "to_jungle_floor",
      label: "🏠 Return to Drakemoor",
      comingSoon: true,
    },
  ],

  playerSpawn: { x: 100, y: 700 - 40 },

  spawnPoints: {
    entry: { x: 100, y: 700 - 40 },
  },
};

// ---------------------------------------------------------------------------
// Drakemoor Dragon Abyss — volcanic dragon lair combat zone Lv 110–120
// ---------------------------------------------------------------------------
//
// The deepest reaches of Drakemoor — a volcanic chasm where ancient drakes
// nest among obsidian spires and rivers of molten magma. The air shimmers
// with heat distortion. Crimson drakes, shadow wyrms, and firedrake broodlings
// patrol every tier. At the deepest point lies the lair of Pyroclasm, the
// Dragon Sovereign — the first true endgame raid boss.
//
// Visual layout:
//
//   0 ──────────────────────────── 1800
//   │      ┌──────────┐ y=120          │
//   │ ╔══╗ │ SOVEREIGN│  (raid boss)  │
//   │ ║RP║ │ LAIR     │               │
//   │ ╚══╝ └──────────┘               │
//   │    ┌──────────────┐ y=280       │
//   │    │ OBSIDIAN     │            │
//   │    │ SPIRE        │            │
//   │    └──────────────┘            │
//   │ ╔══╗  ╔══╗ ┌──────────┐ y=440 │
//   │ ║LD║  ║LD║ │ MAGMA    │      │
//   │ ╚══╝  ╚══╝ │ SHELF    │      │
//   │            └──────────┘       │
//   │       ╔══╗  ╔══╗              │
//   │       ║LD║  ║RP║              │
//   │       ╚══╝  ╚══╝              │
//   └────────────┬───────────────────┘
//      CHASM MOUTH  y=640            1800
//   0 ────────────────────────────
//
// Volcanic terrain with obsidian platforms and magma rivers below. Heat haze
// on every tier. The sovereign lair is at the deepest point.

export const DRAKEMOOR_DRAGON_ABYSS: GameMap = {
  id: "drakemoor_dragon_abyss",
  name: "Drakemoor Dragon Abyss",
  bgmKey: "dungeon",
  width: 1800,
  height: 720,

  footholds: [
    // ── Chasm mouth (ground level) ──────────────────────────────────
    { id: 0, x1: 0, y1: 640, x2: 1800, y2: 640, solid: true },
    // ── Magma shelf (y≈440, x 100–1500) ─────────────────────────────
    { id: 1, x1: 100, y1: 440, x2: 1500, y2: 440 },
    // ── Obsidian spire (y≈280, x 200–1400) ──────────────────────────
    { id: 2, x1: 200, y1: 280, x2: 1400, y2: 280 },
    // ── Sovereign lair (y≈120, x 400–1000) — raid boss spawn ────────
    { id: 3, x1: 400, y1: 120, x2: 1000, y2: 120 },
    // ── Side vent (y≈360, x 1500–1750) ──────────────────────────────
    { id: 4, x1: 1500, y1: 360, x2: 1750, y2: 360 },
  ],

  ladders: [
    // Chasm mouth → magma shelf (left)
    { id: 0, x: 350, yTop: 440, yBottom: 640, kind: "ladder" },
    // Chasm mouth → magma shelf (centre)
    { id: 1, x: 800, yTop: 440, yBottom: 640, kind: "ladder" },
    // Magma shelf → obsidian spire (centre)
    { id: 2, x: 600, yTop: 280, yBottom: 440, kind: "ladder" },
    // Obsidian spire → sovereign lair (centre)
    { id: 3, x: 650, yTop: 120, yBottom: 280, kind: "rope" },
    // Magma shelf → side vent (right)
    { id: 4, x: 1450, yTop: 360, yBottom: 440, kind: "rope" },
    // Side vent → chasm mouth (far right)
    { id: 5, x: 1650, yTop: 360, yBottom: 640, kind: "rope" },
  ],

  spawns: [
    // Crimson drakes patrolling the chasm mouth
    { footholdId: 0, mobId: "mob.crimson_drake", count: 7 },
    // Ember turtles on the magma shelf
    { footholdId: 1, mobId: "mob.ember_turtle", count: 6 },
    // Shadow wyrms on the obsidian spire
    { footholdId: 2, mobId: "mob.shadow_wyrm", count: 5 },
    // Firedrake broodlings near the sovereign lair
    { footholdId: 2, mobId: "mob.firedrake_broodling", count: 4 },
    // Mixed drakes in the side vent
    { footholdId: 4, mobId: "mob.crimson_drake", count: 4 },
  ],

  bossSpawns: [
    // Pyroclasm — the Dragon Sovereign raid boss
    { footholdId: 3, mobId: "mob.pyroclasm", count: 1, respawnIntervalMs: 600_000 },
  ],

  portals: [
    // Back to Drakemoor town
    {
      id: "return_to_town",
      x: 100,
      y: 640 - 40,
      toMapId: "drakemoor",
      toSpawnId: "to_dragon_abyss",
      label: "🏠 Return to Drakemoor",
      comingSoon: true,
    },
  ],

  playerSpawn: { x: 100, y: 640 - 40 },

  spawnPoints: {
    entry: { x: 100, y: 640 - 40 },
  },
};

// ---------------------------------------------------------------------------
// Map registry
// ---------------------------------------------------------------------------

/** Every registered map keyed by its id. */
export const MAPS: Record<string, GameMap> = {
  [DAWN_ISLE.id]: DAWN_ISLE,
  [HEARTLAND_HARBOR.id]: HEARTLAND_HARBOR,
  [HARBOR_DOCKS.id]: HARBOR_DOCKS,
  [CROSSWAY.id]: CROSSWAY,
  [MEADOWFIELD.id]: MEADOWFIELD,
  [SYLVANREACH.id]: SYLVANREACH,
  [SYLVANREACH_CANOPY.id]: SYLVANREACH_CANOPY,
  [SYLVANREACH_ROOTS.id]: SYLVANREACH_ROOTS,
  [CRAGHOLD.id]: CRAGHOLD,
  [CRAGHOLD_CLIFFS.id]: CRAGHOLD_CLIFFS,
  [CRAGHOLD_QUARRY.id]: CRAGHOLD_QUARRY,
  [DUSK_WARD.id]: DUSK_WARD,
  [DUSK_WARD_SUBWAY.id]: DUSK_WARD_SUBWAY,
  [DUSK_WARD_BACKALLEY.id]: DUSK_WARD_BACKALLEY,
  [DUSK_SUBWAY_PQ_STAGING.id]: DUSK_SUBWAY_PQ_STAGING,
  [DUSK_SUBWAY_PQ_STAGE1.id]: DUSK_SUBWAY_PQ_STAGE1,
  [DUSK_SUBWAY_PQ_STAGE2.id]: DUSK_SUBWAY_PQ_STAGE2,
  [DUSK_SUBWAY_PQ_STAGE3.id]: DUSK_SUBWAY_PQ_STAGE3,
  [DUSK_SUBWAY_PQ_STAGE4.id]: DUSK_SUBWAY_PQ_STAGE4,
  [MIREFEN.id]: MIREFEN,
  [MIREFEN_RUINS.id]: MIREFEN_RUINS,
  [FREE_MARKET.id]: FREE_MARKET,
  [SKYHAVEN.id]: SKYHAVEN,
  [SKYHAVEN_DRIFTPEAKS.id]: SKYHAVEN_DRIFTPEAKS,
  [FROSTHOLD.id]: FROSTHOLD,
  [FROSTHOLD_SLOPES.id]: FROSTHOLD_SLOPES,
  [FROSTHOLD_ICECAVE.id]: FROSTHOLD_ICECAVE,
  [TIDEWAYS.id]: TIDEWAYS,
  [TIDEWAYS_REEF.id]: TIDEWAYS_REEF,
  [TIDEWAYS_ABYSS.id]: TIDEWAYS_ABYSS,
  [DRAKEMOOR.id]: DRAKEMOOR,
  [DRAKEMOOR_JUNGLE_FLOOR.id]: DRAKEMOOR_JUNGLE_FLOOR,
  [DRAKEMOOR_DRAGON_ABYSS.id]: DRAKEMOOR_DRAGON_ABYSS,
};

/** Retrieve a map by id, or undefined if not found. */
export function getMap(id: string): GameMap | undefined {
  return MAPS[id];
}

// ---------------------------------------------------------------------------
// Combat-map helpers (runes + treasure boxes)
// ---------------------------------------------------------------------------

/** A map is a combat map if it has mob spawns. Towns and safe zones have zero. */
export function isCombatMap(map: GameMap): boolean {
  return map.spawns.length > 0;
}

// ─── Death return map ───────────────────────────────────────────────────────

/**
 * Combat-zone id → parent town id for death respawn.
 * Maps without an entry respawn on their own playerSpawn (i.e. towns).
 */
export const DEATH_RETURN_MAP: Record<string, string> = {
  meadowfield: "crossway",
  harbor_docks: "heartland_harbor",
  sylvanreach_canopy: "sylvanreach",
  sylvanreach_roots: "sylvanreach",
  craghold_cliffs: "craghold",
  craghold_quarry: "craghold",
  dusk_ward_subway: "dusk_ward",
  dusk_ward_backalley: "dusk_ward",
  dusk_subway_pq_staging: "dusk_ward",
  dusk_subway_pq_stage1: "dusk_ward",
  dusk_subway_pq_stage2: "dusk_ward",
  dusk_subway_pq_stage3: "dusk_ward",
  dusk_subway_pq_stage4: "dusk_ward",
  mirefen_ruins: "mirefen",
  skyhaven_driftpeaks: "skyhaven",
  frosthold_slopes: "frosthold",
  frosthold_icecave: "frosthold",
  tideways_reef: "tideways",
  tideways_abyss: "tideways",
  drakemoor_jungle_floor: "drakemoor",
  drakemoor_dragon_abyss: "drakemoor",
};

/** Resolve the map a player should respawn on after dying on `mapId`. */
export function getDeathReturnMapId(mapId: string): string {
  return DEATH_RETURN_MAP[mapId] ?? mapId;
}

/** How often (ms) a rune spawns on a combat map. */
export const RUNE_SPAWN_INTERVAL_MS = 60_000;
/** How long (ms) a rune stays on the ground before despawning. */
export const RUNE_LIFETIME_MS = 30_000;
/** How long (ms) the rune buff lasts once activated. */
export const RUNE_BUFF_DURATION_MS = 20_000;

/** How often (ms) a treasure box spawns on a combat map. */
export const TREASURE_SPAWN_INTERVAL_MS = 90_000;
/** How long (ms) a box stays before despawning. */
export const TREASURE_LIFETIME_MS = 45_000;
/** Base HP for treasure boxes. */
export const TREASURE_BOX_HP = 500;
/** Proximity range (px) for rune activation. */
export const RUNE_INTERACT_RANGE = 60;

// ---------------------------------------------------------------------------
// Internal utils
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
