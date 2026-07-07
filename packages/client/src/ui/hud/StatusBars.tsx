import { useMemo } from "react";
import { Coins } from "lucide-react";

import { Progress } from "@/ui/components/ui/progress";
import { cn } from "@/ui/lib/utils";
import { useUIStore } from "@/ui/store";

/**
 * StatusBars — the always-on player vitals nameplate (HP / MP / EXP +
 * class / level / mesos).
 *
 * Pure renderer of the HUD snapshot (no Phaser, no actions). Mostly
 * non-interactive (inherits click-through host), except for a tiny dismiss
 * toggle button that opts into `pointer-events-auto`. Bars reuse the shared
 * shadcn `Progress`, recolored per-vital by retargeting the indicator slot
 * via a Tailwind arbitrary variant.
 *
 * Low-HP warning: when HP drops below 25 %, the bar border pulses red, the
 * HP bar darkens, and a pulsing vignette overlay appears at the edges of the
 * screen (rendered in the parent HUD via LowHpOverlay).
 */

// ─── Class label formatting ────────────────────────────────────────────────
const CLASS_LABELS: Record<string, string> = {
  BEGINNER: "Beginner",
  WARRIOR: "Warrior",
  MAGE: "Mage",
  ARCHER: "Archer",
  THIEF: "Thief",
  PIRATE: "Pirate",
};

function formatClass(archetype: string): string {
  return CLASS_LABELS[archetype] ?? archetype.charAt(0) + archetype.slice(1).toLowerCase();
}

function formatMeso(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ─── Sub-components ────────────────────────────────────────────────────────

interface VitalBarProps {
  value: number;
  max: number;
  /** Tailwind class applied to the progress indicator (fill color). */
  fillClass: string;
  /** Centered overlay text. */
  label: string;
}

function VitalBar({ value, max, fillClass, label }: VitalBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="relative h-3.5 w-full">
      <Progress
        value={pct}
        className={cn(
          "h-3.5 rounded-sm bg-black/55 [&_[data-slot=progress-indicator]]:transition-[width,transform]",
          fillClass,
        )}
      />
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
        {label}
      </span>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function StatusBars() {
  const hud = useUIStore((s) => s.hud);
  const toggle = useUIStore((s) => s.toggleHudElement);

  const lowHp = hud.maxHp > 0 && hud.hp / hud.maxHp < 0.25 && hud.hp > 0;
  const className = useMemo(() => formatClass(hud.archetype), [hud.archetype]);

  if (!hud.hudToggles.statusBars) return null;

  return (
    <div className="absolute bottom-3 left-1/2 z-10 max-w-[min(420px,calc(100vw-2rem))] w-[420px] -translate-x-1/2 select-none">
      {/* Low-HP pulsing border wrapper */}
      <div
        className={cn(
          "rounded-lg border border-border bg-background/92 px-3 py-2 shadow-2xl transition-all duration-300",
          lowHp && "animate-pulse border-red-500/70 shadow-[0_0_18px_-2px_rgba(239,68,68,0.45)]",
        )}
      >
        {/* Header row: name + class + level + mesos */}
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[13px] font-bold text-slate-50">{hud.name}</span>
            <span className="shrink-0 text-[11px] font-semibold text-primary">Lv.{hud.level}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{className}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-amber-300">
            <Coins className="size-3" />
            <span>{formatMeso(hud.mesos)}</span>
          </div>
        </div>

        {/* HP / MP bars */}
        <div className="flex flex-col gap-1">
          <VitalBar
            value={hud.hp}
            max={hud.maxHp}
            fillClass={cn(
              "[&_[data-slot=progress-indicator]]:transition-[width,transform]",
              lowHp
                ? "[&_[data-slot=progress-indicator]]:bg-red-600"
                : "[&_[data-slot=progress-indicator]]:bg-red-500",
            )}
            label={`HP ${Math.max(0, hud.hp)} / ${hud.maxHp}`}
          />
          <VitalBar
            value={hud.mp}
            max={hud.maxMp}
            fillClass="[&_[data-slot=progress-indicator]]:bg-blue-500"
            label={`MP ${Math.max(0, hud.mp)} / ${hud.maxMp}`}
          />
        </div>

        {/* EXP strip — thin, full width */}
        <div className="relative mt-1.5 h-2.5 w-full">
          <Progress
            value={Math.min(100, hud.expRatio * 100)}
            className="h-2.5 rounded-sm bg-black/55 [&_[data-slot=progress-indicator]]:bg-[#9ad06b] [&_[data-slot=progress-indicator]]:transition-[width,transform]"
          />
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
            EXP {hud.expPct}%
          </span>
        </div>
        {/* Low-HP warning text — motion + icon supplement the red color signal */}
        {lowHp && (
          <div className="mt-1 flex items-center justify-center gap-1 text-[11px] font-bold text-red-400">
            <span aria-hidden>⚠</span> LOW HP
          </div>
        )}
      </div>

      {/* Tiny toggle button — bottom-right of status bars */}
      <button
        type="button"
        onClick={() => toggle("statusBars")}
        className="pointer-events-auto absolute -right-2 -top-2 z-20 flex size-4 items-center justify-center rounded-full border border-border bg-background/90 text-[9px] text-muted-foreground opacity-0 shadow transition-opacity hover:opacity-100"
        title="Toggle status bars"
      >
        ×
      </button>
    </div>
  );
}
