import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * World map slice — bridge state for the React world map overlay (replacing the
 * legacy Phaser node-graph in UI.ts).
 *
 * The Phaser `UIScene` pushes a computed snapshot (nodes + links + regions) and
 * registers an imperative `travelTo` action so React can trigger `MAP_TRAVEL`
 * without touching Colyseus directly.
 */

/** Snapshot of a map node for the world map overlay. */
export interface WorldMapNode {
  id: string;
  name: string;
  /** Region key this map belongs to (e.g. "dawn_isle", "heartland", "far_reaches"). */
  region: string;
  /** Whether the player is currently on this map. */
  isCurrent: boolean;
  /** Whether this map is directly connected to the current map via portal. */
  isConnected: boolean;
  /** Whether the connection is coming-soon gated. */
  comingSoon: boolean;
  /** Level requirement to travel here (from the portal), or 0 if none. */
  requiresLevel: number;
  /** Whether the player meets the level requirement. */
  meetsLevel: boolean;
  /** Whether the map has been discovered (visited this session). */
  discovered: boolean;
  /** Number of players on this map (only accurate for current map). */
  playerCount: number;
  /** Whether clicking this node should trigger travel. */
  clickable: boolean;
}

/** Snapshot of a portal link between two maps (for drawing connection lines). */
export interface WorldMapLink {
  fromId: string;
  toId: string;
  /** Whether this link originates from the current map. */
  isFromCurrent: boolean;
  /** Whether the link is coming-soon gated. */
  comingSoon: boolean;
}

/** A region group on the world map. */
export interface WorldMapRegion {
  key: string;
  label: string;
  /** Level band hint for display (e.g. "1–10"). */
  levelBand: string;
  /** Map IDs belonging to this region. */
  mapIds: string[];
  /** CSS gradient / background colour for the region card. */
  gradient: string;
}

export interface WorldMapSnapshot {
  /** Master toggle. */
  open: boolean;
  /** Current map ID. */
  currentMapId: string;
  /** All nodes with computed states. */
  nodes: WorldMapNode[];
  /** Connection lines between nodes. */
  links: WorldMapLink[];
  /** Region definitions for layout. */
  regions: WorldMapRegion[];
  /** Player level (for level-gate checks). */
  playerLevel: number;
  /** Set of map IDs the player has visited this session. */
  discoveredMaps: string[];
}

export interface WorldMapActions {
  /** Send MAP_TRAVEL to the server. Wired by the Phaser scene. */
  travelTo(targetMapId: string): void;
}

export interface WorldMapSlice {
  worldMap: WorldMapSnapshot;
  worldMapActions: WorldMapActions | null;
  setWorldMap: (patch: Partial<WorldMapSnapshot>) => void;
  setWorldMapOpen: (open: boolean) => void;
  setWorldMapActions: (actions: WorldMapActions | null) => void;
}

const EMPTY_WORLD_MAP: WorldMapSnapshot = {
  open: false,
  currentMapId: "dawn_isle",
  nodes: [],
  links: [],
  regions: [],
  playerLevel: 1,
  discoveredMaps: [],
};

export const createWorldMapSlice: StateCreator<UIState, [], [], WorldMapSlice> = (set) => ({
  worldMap: EMPTY_WORLD_MAP,
  worldMapActions: null,

  setWorldMap: (patch) => set((s) => ({ worldMap: { ...s.worldMap, ...patch } })),
  setWorldMapOpen: (open) => set((s) => ({ worldMap: { ...s.worldMap, open } })),
  setWorldMapActions: (actions) => set({ worldMapActions: actions }),
});
