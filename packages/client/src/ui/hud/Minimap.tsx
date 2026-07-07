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
  const toggleOn = useUIStore((s) => s.hud.hudToggles.minimap);
  if (!minimap || !toggleOn) return null;

  const { width, height } = minimap;

  return (
    <div className="absolute left-3 top-3 max-w-[min(152px,calc(100vw-6rem))] w-[152px] select-none rounded-md border border-border bg-background/92 shadow-2xl">
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
          {minimap.npcs.map((n, i) => {
            const r = height / 40;
            // Quest-relevant NPCs get distinct colours/shapes so the player
            // always knows where to go. "guide" = current guidance objective.
            if (n.quest === "guide") {
              // Pulsing diamond — the most prominent marker on the minimap.
              const s = r * 1.6;
              return (
                <g key={`npc${i}`}>
                  <polygon
                    points={`${n.x},${n.y - s} ${n.x + s},${n.y} ${n.x},${n.y + s} ${n.x - s},${n.y}`}
                    fill="#f97316"
                    stroke="#ffffff"
                    strokeWidth={height / 60}
                  >
                    <animate
                      attributeName="opacity"
                      values="1;0.55;1"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                  </polygon>
                  {/* small star glyph inside */}
                  <text
                    x={n.x}
                    y={n.y + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#fff"
                    fontSize={height / 14}
                    fontFamily="sans-serif"
                    fontWeight="bold"
                  >
                    ★
                  </text>
                </g>
              );
            }
            if (n.quest === "turnin") {
              return (
                <circle
                  key={`npc${i}`}
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill="#60a5fa"
                  stroke="#ffffff"
                  strokeWidth={height / 80}
                />
              );
            }
            if (n.quest === "active") {
              return <circle key={`npc${i}`} cx={n.x} cy={n.y} r={r * 0.85} fill="#9ca3af" />;
            }
            if (n.quest === "available") {
              return (
                <circle
                  key={`npc${i}`}
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill="#facc15"
                  stroke="#ffffff"
                  strokeWidth={height / 80}
                />
              );
            }
            // Default — regular NPC.
            return <circle key={`npc${i}`} cx={n.x} cy={n.y} r={r} fill="#22c55e" />;
          })}
          {minimap.dots.map((d, i) => {
            const r = d.kind === "self" ? height / 28 : height / 40;
            const fill = d.kind === "self" ? "#facc15" : d.kind === "mob" ? "#ef4444" : "#94a3b8";
            // Diamond for self, triangle for other players, circle for mobs.
            // Shape differentiation so minimap dots are identifiable without color.
            if (d.kind === "self") {
              // Diamond (rotated square)
              const s = r * 0.9;
              return (
                <polygon
                  key={`dot${i}`}
                  points={`${d.x},${d.y - s} ${d.x + s},${d.y} ${d.x},${d.y + s} ${d.x - s},${d.y}`}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={height / 80}
                />
              );
            }
            if (d.kind === "player") {
              // Triangle pointing up
              const s = r * 1.1;
              return (
                <polygon
                  key={`dot${i}`}
                  points={`${d.x},${d.y - s} ${d.x - s * 0.87},${d.y + s * 0.5} ${d.x + s * 0.87},${d.y + s * 0.5}`}
                  fill={fill}
                />
              );
            }
            // Mob — circle (default)
            return <circle key={`dot${i}`} cx={d.x} cy={d.y} r={r} fill={fill} />;
          })}
        </svg>
      </div>
    </div>
  );
}
