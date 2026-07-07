/**
 * Region definitions and node positions for the React world map.
 *
 * These drive the illustrated region/continent layout. Each region is a visual
 * grouping of maps that share a biome/vibe. Positions are percentage-based
 * (0–100) so the layout scales with the viewport.
 */

export interface RegionDef {
  key: string;
  label: string;
  levelBand: string;
  /** Gradient CSS for the region card background. */
  gradient: string;
  /** Border color for the region card. */
  borderColor: string;
  /** Emoji icon for the region. */
  icon: string;
  /** Map IDs in this region (display order). */
  mapIds: string[];
}

export interface NodePosition {
  mapId: string;
  /** x position as percentage of region card width (0–100). */
  x: number;
  /** y position as percentage of region card height (0–100). */
  y: number;
}

export interface RegionLayout {
  regionKey: string;
  /** x position as percentage of the map viewport (0–100). */
  x: number;
  /** y position as percentage of the map viewport (0–100). */
  y: number;
  /** Width as percentage of the map viewport. */
  w: number;
  /** Height as percentage of the map viewport. */
  h: number;
}

/** Region definitions matching WORLD.md structure. */
export const REGIONS: RegionDef[] = [
  {
    key: "dawn_isle",
    label: "Dawn Isle",
    levelBand: "Lv 1–10",
    gradient: "linear-gradient(135deg, #2d5a27 0%, #4a8c3f 50%, #6ab856 100%)",
    borderColor: "#6ab856",
    icon: "🌅",
    mapIds: ["dawn_isle"],
  },
  {
    key: "heartland",
    label: "The Heartland",
    levelBand: "Lv 10–30",
    gradient: "linear-gradient(135deg, #1e3a5f 0%, #2d5f8e 50%, #4a8fc4 100%)",
    borderColor: "#4a8fc4",
    icon: "🌳",
    mapIds: [
      "heartland_harbor",
      "harbor_docks",
      "crossway",
      "meadowfield",
      "sylvanreach",
      "sylvanreach_canopy",
      "sylvanreach_roots",
      "craghold",
      "craghold_cliffs",
      "craghold_quarry",
      "dusk_ward",
      "dusk_ward_subway",
      "dusk_ward_backalley",
      "dusk_subway_pq_staging",
      "dusk_subway_pq_stage1",
      "dusk_subway_pq_stage2",
      "dusk_subway_pq_stage3",
      "dusk_subway_pq_stage4",
      "mirefen",
      "mirefen_ruins",
      "free_market",
    ],
  },
  {
    key: "far_reaches",
    label: "Far Reaches",
    levelBand: "Lv 30–120+",
    gradient: "linear-gradient(135deg, #3b1a5e 0%, #6b3fa0 50%, #9b6dd7 100%)",
    borderColor: "#9b6dd7",
    icon: "🌌",
    mapIds: [
      "skyhaven",
      "skyhaven_driftpeaks",
      "frosthold",
      "frosthold_slopes",
      "frosthold_icecave",
      "tideways",
      "tideways_reef",
      "tideways_abyss",
      "drakemoor",
      "drakemoor_jungle_floor",
      "drakemoor_dragon_abyss",
    ],
  },
];

/** Region viewport positions (percentage-based layout for the illustrated map). */
export const REGION_LAYOUTS: RegionLayout[] = [
  // Dawn Isle — small, top-left island
  { regionKey: "dawn_isle", x: 4, y: 8, w: 20, h: 32 },
  // Heartland — large central continent
  { regionKey: "heartland", x: 26, y: 4, w: 46, h: 40 },
  // Far Reaches — right side continent
  { regionKey: "far_reaches", x: 74, y: 6, w: 24, h: 44 },
];

/** Sub-zone groupings within regions for the Heartland node layout. */
export const HEARTLAND_SUBZONES = [
  {
    label: "Harbor",
    mapIds: ["heartland_harbor", "harbor_docks"],
    y: 80,
  },
  {
    label: "Crossway",
    mapIds: ["crossway", "free_market"],
    y: 55,
  },
  {
    label: "Meadowfield",
    mapIds: ["meadowfield"],
    y: 30,
  },
  {
    label: "Sylvanreach",
    mapIds: ["sylvanreach", "sylvanreach_canopy", "sylvanreach_roots"],
    y: 30,
  },
  {
    label: "Craghold",
    mapIds: ["craghold", "craghold_cliffs", "craghold_quarry"],
    y: 55,
  },
  {
    label: "Dusk Ward",
    mapIds: [
      "dusk_ward",
      "dusk_ward_subway",
      "dusk_ward_backalley",
      "dusk_subway_pq_staging",
      "dusk_subway_pq_stage1",
      "dusk_subway_pq_stage2",
      "dusk_subway_pq_stage3",
      "dusk_subway_pq_stage4",
    ],
    y: 55,
  },
  {
    label: "Mirefen",
    mapIds: ["mirefen", "mirefen_ruins"],
    y: 80,
  },
];

/** Sub-zone groupings within the Far Reaches. */
export const FAR_REACHES_SUBZONES = [
  {
    label: "Skyhaven",
    mapIds: ["skyhaven", "skyhaven_driftpeaks"],
    y: 15,
  },
  {
    label: "Frosthold",
    mapIds: ["frosthold", "frosthold_slopes", "frosthold_icecave"],
    y: 40,
  },
  {
    label: "Tideways",
    mapIds: ["tideways", "tideways_reef", "tideways_abyss"],
    y: 65,
  },
  {
    label: "Drakemoor",
    mapIds: ["drakemoor", "drakemoor_jungle_floor", "drakemoor_dragon_abyss"],
    y: 85,
  },
];

/** Compute (x%, y%) positions for each map node within a sub-zone. */
export function getNodePosition(mapId: string, regionKey: string): { x: number; y: number } {
  if (regionKey === "dawn_isle") {
    return { x: 50, y: 50 };
  }

  if (regionKey === "heartland") {
    for (const zone of HEARTLAND_SUBZONES) {
      const idx = zone.mapIds.indexOf(mapId);
      if (idx === -1) continue;
      const count = zone.mapIds.length;
      // Spread nodes horizontally within the sub-zone row.
      const xStep = count > 1 ? 80 / (count - 1) : 0;
      return { x: 10 + idx * xStep, y: zone.y };
    }
  }

  if (regionKey === "far_reaches") {
    for (const zone of FAR_REACHES_SUBZONES) {
      const idx = zone.mapIds.indexOf(mapId);
      if (idx === -1) continue;
      const count = zone.mapIds.length;
      const xStep = count > 1 ? 80 / (count - 1) : 0;
      return { x: 10 + idx * xStep, y: zone.y };
    }
  }

  return { x: 50, y: 50 };
}
