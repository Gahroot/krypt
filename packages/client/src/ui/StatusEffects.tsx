import { Progress } from "@/ui/components/ui/progress";
import { cn } from "@/ui/lib/utils";
import { useUIStore, type StatusEffectSnapshot } from "@/ui/store";

/**
 * StatusEffects — the always-on buff/debuff icon strip (lives in the HUD layer).
 *
 * React port of the hand-drawn Phaser `buildStatusEffects` / `renderStatusEffects`.
 * Pure renderer of the bridge snapshot (store/statusEffects.ts): the scene owns
 * the authoritative list and ticks the countdowns, republishing on change. Each
 * icon shows a kind emoji, a remaining-time bar, a seconds countdown, and a stack
 * badge. Non-interactive, so it inherits the click-through host.
 */

/** Per-kind tile tint (Tailwind class on the indicator + ring). */
const KIND_BG: Record<string, string> = {
  buff: "bg-blue-600/85",
  debuff: "bg-red-600/85",
  stun: "bg-amber-500/85",
  hot: "bg-green-500/85",
  dot: "bg-red-500/85",
};

const KIND_FILL: Record<string, string> = {
  buff: "[&_[data-slot=progress-indicator]]:bg-blue-400",
  debuff: "[&_[data-slot=progress-indicator]]:bg-red-400",
  stun: "[&_[data-slot=progress-indicator]]:bg-amber-300",
  hot: "[&_[data-slot=progress-indicator]]:bg-green-300",
  dot: "[&_[data-slot=progress-indicator]]:bg-red-300",
};

/** Map a status-effect kind + label to an emoji icon (port of effectEmoji). */
function effectEmoji(kind: string, label: string): string {
  const l = label.toLowerCase();
  switch (kind) {
    case "stun":
      return "⭐";
    case "hot":
      return "❤️";
    case "dot":
      return "🔥";
    case "debuff":
      if (l.includes("slow")) return "🐌";
      if (l.includes("poison")) return "☠️";
      return "⬇️";
    case "buff":
      if (l.includes("atk") || l.includes("power") || l.includes("rally")) return "⚔️";
      if (l.includes("def") || l.includes("guard") || l.includes("iron")) return "🛡️";
      if (l.includes("speed") || l.includes("haste")) return "💨";
      if (l.includes("hp") || l.includes("heal")) return "💚";
      if (l.includes("mp") || l.includes("mana")) return "💙";
      return "✨";
    default:
      return "🔮";
  }
}

function EffectIcon({ effect }: { effect: StatusEffectSnapshot }) {
  const ratio =
    effect.durationMs > 0 ? Math.max(0, Math.min(1, effect.remainingMs / effect.durationMs)) : 0;
  const secs = Math.max(0, Math.ceil(effect.remainingMs / 1000));

  return (
    <div className="flex w-8 flex-col items-center gap-0.5">
      <div
        className={cn(
          "relative flex size-8 items-center justify-center rounded-md border border-white/30 text-base",
          KIND_BG[effect.kind] ?? "bg-slate-600/85",
        )}
        title={`${effect.label} — ${secs}s`}
      >
        <span>{effectEmoji(effect.kind, effect.label)}</span>
        {effect.stacks > 1 && (
          <span className="absolute -top-1 -right-1 rounded bg-black/70 px-1 text-[8px] font-bold text-amber-300">
            {effect.stacks}
          </span>
        )}
        <Progress
          value={ratio * 100}
          className={cn(
            "absolute inset-x-0.5 bottom-0.5 h-[3px] bg-black/45",
            KIND_FILL[effect.kind] ?? "[&_[data-slot=progress-indicator]]:bg-slate-300",
          )}
        />
      </div>
      <span className="text-[9px] tabular-nums text-muted-foreground">{secs}s</span>
    </div>
  );
}

export function StatusEffects() {
  const effects = useUIStore((s) => s.statusEffects);

  if (effects.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-[72px] left-1/2 flex -translate-x-1/2 select-none gap-1 rounded-lg border border-border bg-background/80 px-1.5 py-1 shadow-lg backdrop-blur-sm">
      {effects.map((e) => (
        <EffectIcon key={e.id} effect={e} />
      ))}
    </div>
  );
}
