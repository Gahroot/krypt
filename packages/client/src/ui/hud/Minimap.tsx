import { Users } from "lucide-react";

import { useUIStore } from "@/ui/store";

/**
 * Minimap — the always-on top-left minimap frame ported from Phaser.
 *
 * Pure renderer: static map geometry (footholds / ladders / portals / NPCs) and
 * live entity dots are pushed in the HUD snapshot in map-space units; the SVG
 * `viewBox` maps them into the frame. Non-interactive, so it inherits the
 * click-through host.
 */

const FRAME_W = 152;
const DRAW_H = 84;

export function Minimap() {
  const minimap = useUIStore((s) => s.hud.minimap);
  if (!minimap) return null;

  const { width, height } = minimap;

  return (
    <div className="absolute left-3 top-3 w-[152px] select-none rounded-md border border-border bg-background/85 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center justify-between px-2 pt-1.5 text-[10px]">
        <span className="truncate font-semibold text-slate-200">{minimap.mapName}</span>
        <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
          <Users className="size-3" />
          {minimap.playerCount}
        </span>
      </div>

      <div className="px-1 pb-1.5 pt-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={FRAME_W - 8}
          height={DRAW_H}
          preserveAspectRatio="none"
          className="block rounded-sm bg-black/40"
        >
          {minimap.footholds.map((f, i) => (
            <line
              key={`fh${i}`}
              x1={f.x1}
              y1={f.y1}
              x2={f.x2}
              y2={f.y2}
              stroke="#4a6a4a"
              strokeWidth={height / 60}
            />
          ))}
          {minimap.ladders.map((l, i) => (
            <line
              key={`ld${i}`}
              x1={l.x}
              y1={l.yTop}
              x2={l.x}
              y2={l.yBottom}
              stroke="#8a7a5a"
              strokeWidth={height / 60}
            />
          ))}
          {minimap.portals.map((p, i) => (
            <circle key={`pt${i}`} cx={p.x} cy={p.y} r={height / 40} fill="#22d3ee" />
          ))}
          {minimap.npcs.map((n, i) => (
            <circle key={`npc${i}`} cx={n.x} cy={n.y} r={height / 40} fill="#22c55e" />
          ))}
          {minimap.dots.map((d, i) => (
            <circle
              key={`dot${i}`}
              cx={d.x}
              cy={d.y}
              r={d.kind === "self" ? height / 28 : height / 40}
              fill={d.kind === "self" ? "#facc15" : d.kind === "mob" ? "#ef4444" : "#94a3b8"}
              stroke={d.kind === "self" ? "#ffffff" : undefined}
              strokeWidth={d.kind === "self" ? height / 80 : 0}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
