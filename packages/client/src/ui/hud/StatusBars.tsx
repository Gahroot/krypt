import { Progress } from "@/ui/components/ui/progress";
import { cn } from "@/ui/lib/utils";
import { useUIStore } from "@/ui/store";

/**
 * StatusBars — the always-on player vitals nameplate (HP / MP / EXP) ported from
 * the legacy Phaser bottom bar.
 *
 * Pure renderer of the HUD snapshot (no Phaser, no actions). Non-interactive, so
 * it inherits the click-through host and never sets `pointer-events-auto`.
 * Bars reuse the shared shadcn `Progress`, recolored per-vital by retargeting the
 * indicator slot via a Tailwind arbitrary variant.
 */

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
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
        {label}
      </span>
    </div>
  );
}

export function StatusBars() {
  const hud = useUIStore((s) => s.hud);

  return (
    <div className="absolute bottom-3 left-1/2 w-[420px] max-w-[90vw] -translate-x-1/2 select-none rounded-lg border border-border bg-background/85 px-3 py-2 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {/* Name + level nameplate. */}
        <div className="flex w-[92px] shrink-0 flex-col leading-tight">
          <span className="truncate text-[13px] font-bold text-slate-50">{hud.name}</span>
          <span className="text-[11px] font-bold text-primary">Lv.{hud.level}</span>
        </div>

        {/* HP / MP bars. */}
        <div className="flex flex-1 flex-col gap-1">
          <VitalBar
            value={hud.hp}
            max={hud.maxHp}
            fillClass="[&_[data-slot=progress-indicator]]:bg-red-500"
            label={`${Math.max(0, hud.hp)} / ${hud.maxHp}`}
          />
          <VitalBar
            value={hud.mp}
            max={hud.maxMp}
            fillClass="[&_[data-slot=progress-indicator]]:bg-blue-500"
            label={`${Math.max(0, hud.mp)} / ${hud.maxMp}`}
          />
        </div>
      </div>

      {/* EXP strip — thin, full width. */}
      <div className="relative mt-1.5 h-2.5 w-full">
        <Progress
          value={Math.min(100, hud.expRatio * 100)}
          className="h-2.5 rounded-sm bg-black/55 [&_[data-slot=progress-indicator]]:bg-[#9ad06b] [&_[data-slot=progress-indicator]]:transition-[width,transform]"
        />
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
          EXP {hud.expPct}%
        </span>
      </div>
    </div>
  );
}
