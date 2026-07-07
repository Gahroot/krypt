import { useCallback, useEffect, useMemo } from "react";
import { X } from "lucide-react";

import { Button } from "@/ui/components/ui/button";
import { uiStore, useUIStore, type WorldMapNode, type WorldMapLink } from "@/ui/store";
import { REGIONS, REGION_LAYOUTS, getNodePosition } from "@/ui/worldMapData";

/**
 * WorldMapPanel — illustrated region/continent world map (replaces the legacy
 * Phaser node-graph overlay from UI.ts ~2851–3270).
 *
 * Visual style: region cards with gradient backgrounds, map nodes with state
 * indicators (current/connected/locked/coming-soon/undiscovered), SVG connection
 * lines, and player location highlight.
 *
 * Toggle: W key → store.worldMap.open. Close: W / ESC.
 */

// ─── Node visual constants ────────────────────────────────────────────────
const NODE_COLORS = {
  current: { bg: "#facc15", stroke: "#ffffff", text: "#facc15" },
  connected: { bg: "#3b82f6", stroke: "#93c5fd", text: "#93c5fd" },
  locked: { bg: "#6b4c3b", stroke: "#8b6914", text: "#a88b6d" },
  comingSoon: { bg: "#78716c", stroke: "#57534e", text: "#a8a29e" },
  undiscovered: { bg: "#1a1a2e", stroke: "#333344", text: "#4a5568" },
} as const;

// ─── Helper: determine visual state for a node ─────────────────────────────
function getNodeVisual(node: WorldMapNode) {
  if (node.isCurrent) return { ...NODE_COLORS.current, label: node.name, showYou: true };
  if (node.isConnected && node.comingSoon)
    return {
      ...NODE_COLORS.comingSoon,
      label: node.name,
      lockText: "🚧 Coming Soon",
      showYou: false,
    };
  if (node.isConnected && !node.meetsLevel)
    return {
      ...NODE_COLORS.locked,
      label: node.name,
      lockText: `🔒 Lv.${node.requiresLevel}`,
      showYou: false,
    };
  if (node.isConnected) return { ...NODE_COLORS.connected, label: node.name, showYou: false };
  if (node.discovered) return { ...NODE_COLORS.undiscovered, label: node.name, showYou: false };
  return { ...NODE_COLORS.undiscovered, label: "???", showYou: false };
}

// ─── SVG connection lines between nodes ─────────────────────────────────────
function ConnectionLines({
  links,
  nodePositions,
  currentMapId,
}: {
  links: WorldMapLink[];
  nodePositions: Map<string, { cx: number; cy: number }>;
  currentMapId: string;
}) {
  const drawn = useMemo(() => {
    const keys = new Set<string>();
    const result: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      highlight: boolean;
      comingSoon: boolean;
    }[] = [];
    for (const link of links) {
      const key = [link.fromId, link.toId].sort().join("|");
      if (keys.has(key)) continue;
      keys.add(key);
      const a = nodePositions.get(link.fromId);
      const b = nodePositions.get(link.toId);
      if (!a || !b) continue;
      const highlight =
        (link.fromId === currentMapId && link.isFromCurrent) ||
        (link.toId === currentMapId && link.isFromCurrent);
      result.push({
        x1: a.cx,
        y1: a.cy,
        x2: b.cx,
        y2: b.cy,
        highlight,
        comingSoon: link.comingSoon,
      });
    }
    return result;
  }, [links, nodePositions, currentMapId]);

  if (drawn.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {drawn.map((line, i) => (
        <line
          key={`${line.x1}-${line.y1}-${line.x2}-${line.y2}-${i}`}
          x1={`${line.x1}%`}
          y1={`${line.y1}%`}
          x2={`${line.x2}%`}
          y2={`${line.y2}%`}
          stroke={line.highlight ? "#3b82f6" : line.comingSoon ? "#57534e" : "#4a6a4a"}
          strokeWidth={line.highlight ? 2.5 : 1}
          strokeOpacity={line.highlight ? 0.9 : 0.35}
          strokeDasharray={line.comingSoon ? "4 4" : undefined}
        />
      ))}
    </svg>
  );
}

// ─── Single map node ───────────────────────────────────────────────────────
function MapNode({ node, onClick }: { node: WorldMapNode; onClick: () => void }) {
  const visual = getNodeVisual(node);
  const isClickable = node.clickable && !node.isCurrent;

  return (
    <button
      type="button"
      className={`absolute flex flex-col items-center transition-transform ${
        isClickable ? "cursor-pointer hover:scale-125" : "cursor-default"
      }`}
      style={{
        left: `${getNodePosition(node.id, node.region).x}%`,
        top: `${getNodePosition(node.id, node.region).y}%`,
        transform: "translate(-50%, -50%)",
      }}
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
      title={isClickable ? `Travel to ${node.name}` : undefined}
    >
      {/* "YOU" indicator */}
      {visual.showYou && (
        <span className="mb-0.5 text-[9px] font-bold leading-none" style={{ color: visual.text }}>
          ▼ YOU
        </span>
      )}

      {/* Node circle */}
      <div
        className="flex items-center justify-center rounded-full border-2 shadow-lg"
        style={{
          width: 28,
          height: 28,
          backgroundColor: visual.bg,
          borderColor: visual.stroke,
          boxShadow: node.isCurrent ? `0 0 12px ${visual.bg}` : undefined,
        }}
      />

      {/* Map name */}
      <span
        className="mt-0.5 max-w-[80px] truncate text-center text-[9px] font-medium leading-tight"
        style={{ color: visual.text }}
      >
        {visual.label}
      </span>

      {/* Lock / coming-soon text */}
      {"lockText" in visual && visual.lockText && (
        <span className="text-[8px] leading-none" style={{ color: visual.text }}>
          {visual.lockText}
        </span>
      )}

      {/* Player count (only for current map) */}
      {node.isCurrent && node.playerCount > 0 && (
        <span className="text-[8px] leading-none text-slate-400">{node.playerCount} here</span>
      )}
    </button>
  );
}

// ─── Region card ───────────────────────────────────────────────────────────
function RegionCard({
  label,
  levelBand,
  gradient,
  borderColor,
  icon,
  nodes,
  layout,
  onTravel,
}: {
  regionKey: string;
  label: string;
  levelBand: string;
  gradient: string;
  borderColor: string;
  icon: string;
  nodes: WorldMapNode[];
  layout: { x: number; y: number; w: number; h: number };
  onTravel: (mapId: string) => void;
}) {
  const hasContent = nodes.length > 0;
  const anyCurrent = nodes.some((n) => n.isCurrent);

  return (
    <div
      className="absolute overflow-hidden rounded-xl border-2 shadow-lg transition-shadow"
      style={{
        left: `${layout.x}%`,
        top: `${layout.y}%`,
        width: `${layout.w}%`,
        height: `${layout.h}%`,
        background: gradient,
        borderColor: anyCurrent ? "#facc15" : borderColor,
        boxShadow: anyCurrent ? `0 0 20px ${borderColor}40` : undefined,
      }}
    >
      {/* Region header */}
      <div className="flex items-center gap-1.5 border-b border-white/10 px-2.5 py-1.5">
        <span className="text-sm">{icon}</span>
        <h3 className="font-display text-xs font-bold tracking-wide text-white">{label}</h3>
        <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-white/70">
          {levelBand}
        </span>
      </div>

      {/* Region body — relative container for node positioning */}
      <div className="relative h-[calc(100%-2rem)]">
        {!hasContent && (
          <div className="flex h-full items-center justify-center text-[10px] text-white/40">
            Undiscovered
          </div>
        )}
        {nodes.map((node) => (
          <MapNode key={node.id} node={node} onClick={() => onTravel(node.id)} />
        ))}
      </div>
    </div>
  );
}

// ─── Main panel ────────────────────────────────────────────────────────────
export function WorldMapPanel() {
  const open = useUIStore((s) => s.worldMap.open);
  const nodes = useUIStore((s) => s.worldMap.nodes);
  const links = useUIStore((s) => s.worldMap.links);
  const regions = useUIStore((s) => s.worldMap.regions);
  const currentMapId = useUIStore((s) => s.worldMap.currentMapId);
  const actions = useUIStore((s) => s.worldMapActions);

  const close = useCallback(() => {
    uiStore.getState().setWorldMapOpen(false);
  }, []);

  const handleTravel = useCallback(
    (targetMapId: string) => {
      actions?.travelTo(targetMapId);
    },
    [actions],
  );

  // W / ESC to close.
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "w" || e.key === "W") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  // Compute node positions for connection lines (percentage-based within the full viewport).
  const nodePositions = useMemo(() => {
    const posMap = new Map<string, { cx: number; cy: number }>();
    for (const region of REGION_LAYOUTS) {
      const regionNodes = nodes.filter((n) => n.region === region.regionKey);
      for (const node of regionNodes) {
        const localPos = getNodePosition(node.id, node.region);
        // Convert local region % to viewport %
        const cx = region.x + (localPos.x / 100) * region.w;
        const cy = region.y + 8 + (localPos.y / 100) * (region.h - 16);
        posMap.set(node.id, { cx, cy });
      }
    }
    return posMap;
  }, [nodes]);

  if (!open) return null;

  // Group nodes by region.
  const nodesByRegion = new Map<string, WorldMapNode[]>();
  for (const node of nodes) {
    const list = nodesByRegion.get(node.region) ?? [];
    list.push(node);
    nodesByRegion.set(node.region, list);
  }

  // Determine which regions to show.
  const activeRegionKeys = regions.map((r) => r.key);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col bg-black/75 backdrop-blur-sm motion-safe:animate-panel-in">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3">
        <h1 className="font-display text-lg font-bold tracking-wide text-white">World Map</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">Press W or ESC to close</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-slate-400 hover:text-white"
            onClick={close}
            aria-label="Close world map"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Map body — region cards + connection lines */}
      <div className="relative mx-4 mb-4 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#0f1729]/90">
        {/* SVG connection lines */}
        <ConnectionLines links={links} nodePositions={nodePositions} currentMapId={currentMapId} />

        {/* Region cards */}
        {REGIONS.map((regionDef) => {
          const layout = REGION_LAYOUTS.find((l) => l.regionKey === regionDef.key);
          if (!layout) return null;
          // Only show regions that have map definitions.
          if (!activeRegionKeys.includes(regionDef.key)) return null;
          const regionNodes = nodesByRegion.get(regionDef.key) ?? [];
          return (
            <RegionCard
              key={regionDef.key}
              regionKey={regionDef.key}
              label={regionDef.label}
              levelBand={regionDef.levelBand}
              gradient={regionDef.gradient}
              borderColor={regionDef.borderColor}
              icon={regionDef.icon}
              nodes={regionNodes}
              layout={layout}
              onTravel={handleTravel}
            />
          );
        })}

        {/* Legend */}
        <div className="absolute bottom-2 left-2 flex gap-3 rounded-lg bg-black/50 px-2.5 py-1.5 text-[9px]">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-yellow-400" /> You
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-blue-500" /> Connected
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-amber-800" /> Level Gate
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-full bg-stone-500" /> Coming Soon
          </span>
        </div>
      </div>
    </div>
  );
}
