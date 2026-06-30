import { useEffect, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/components/ui/tooltip";
import { cn } from "@/ui/lib/utils";
import { useUIStore, type HudSkillSlot } from "@/ui/store";

/**
 * SkillBar — the always-on quickslot hotbar ported from the legacy Phaser bar.
 *
 * Renders the HUD snapshot's resolved skill slots and drives the game purely
 * through `hudActions.useSkill(index)` (which the scene wires to SKILL_CAST /
 * USE_CONSUMABLE). Each slot is an interactive button (`pointer-events-auto`);
 * empty/disabled slots stay click-through. Cooldowns animate locally from the
 * snapshot's `cooldownEndAt` epoch via a conic-gradient sweep, so Phaser never
 * has to republish per frame.
 */

function SkillSlot({
  slot,
  now,
  onUse,
}: {
  slot: HudSkillSlot;
  now: number;
  onUse: (index: number) => void;
}) {
  const empty = slot.kind === null;
  const remaining = Math.max(0, slot.cooldownEndAt - now);
  const onCooldown = remaining > 0 && slot.cooldownTotalMs > 0;
  const sweepDeg = onCooldown ? (remaining / slot.cooldownTotalMs) * 360 : 0;
  const disabled = empty || onCooldown || !slot.usable;

  const button = (
    <button
      type="button"
      data-slot="skill-slot"
      disabled={disabled}
      onClick={() => onUse(slot.index)}
      className={cn(
        "pointer-events-auto relative flex size-10 select-none flex-col items-center justify-center overflow-hidden rounded-md border text-[9px] font-semibold leading-none transition-colors",
        empty
          ? "border-border/60 bg-black/40 text-muted-foreground/50"
          : slot.usable && !onCooldown
            ? "border-border bg-card text-slate-100 hover:border-primary hover:bg-accent"
            : "border-border/50 bg-black/60 text-muted-foreground",
      )}
    >
      {!empty && (
        <span className="px-0.5 text-center leading-tight tabular-nums">{slot.label}</span>
      )}

      {/* Cooldown radial sweep + remaining seconds. */}
      {onCooldown && (
        <>
          <span
            className="pointer-events-none absolute inset-0"
            style={{
              background: `conic-gradient(rgba(0,0,0,0.6) ${sweepDeg}deg, transparent 0deg)`,
            }}
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
            {Math.ceil(remaining / 1000)}
          </span>
        </>
      )}

      {/* Stack count (consumables). */}
      {slot.count !== undefined && slot.count > 1 && (
        <span className="pointer-events-none absolute right-0.5 top-0.5 text-[8px] font-bold text-yellow-300 drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
          {slot.count}
        </span>
      )}

      {/* Key-binding hint. */}
      <span className="pointer-events-none absolute bottom-0.5 left-0.5 text-[8px] text-muted-foreground">
        {slot.key}
      </span>
    </button>
  );

  if (empty) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">
        <span className="font-semibold">{slot.fullName}</span>
        {!slot.usable && <span className="ml-1 text-muted-foreground">(unavailable)</span>}
      </TooltipContent>
    </Tooltip>
  );
}

export function SkillBar() {
  const skills = useUIStore((s) => s.hud.skills);
  const useSkill = useUIStore((s) => s.hudActions?.useSkill);
  const [now, setNow] = useState(() => Date.now());

  // Tick locally only while a cooldown is running, so the sweep animates without
  // Phaser republishing every frame.
  const anyCooldown = skills.some((s) => s.cooldownEndAt > now);
  useEffect(() => {
    if (!anyCooldown) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [anyCooldown]);

  if (skills.length === 0) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="absolute bottom-3 right-3 flex gap-1 rounded-lg border border-border bg-background/85 p-1.5 shadow-2xl backdrop-blur-sm">
        {skills.map((slot) => (
          <SkillSlot key={slot.index} slot={slot} now={now} onUse={(i) => useSkill?.(i)} />
        ))}
      </div>
    </TooltipProvider>
  );
}
