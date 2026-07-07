import { useUIStore } from "@/ui/store";

/**
 * LowHpOverlay — a persistent pulsing red vignette around the screen edges
 * shown whenever the local player's HP drops below 25 %.
 *
 * Uses a CSS animation for the pulsing opacity so it's smooth even when the
 * store only updates infrequently. Fades out cleanly when HP recovers above
 * the threshold.
 *
 * Non-interactive, pointer-events-none.
 */

const LOW_HP_THRESHOLD = 0.25;

export function LowHpOverlay() {
  const hp = useUIStore((s) => s.hud.hp);
  const maxHp = useUIStore((s) => s.hud.maxHp);
  const dead = useUIStore((s) => s.hud.dead);

  const lowHp = maxHp > 0 && hp / maxHp < LOW_HP_THRESHOLD && hp > 0 && !dead;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-30 transition-opacity duration-500"
      style={{
        opacity: lowHp ? 1 : 0,
        background:
          "radial-gradient(ellipse at center, transparent 30%, rgba(185,28,28,0.22) 70%, rgba(185,28,28,0.38) 100%)",
        animation: lowHp ? "low-hp-pulse 1.2s ease-in-out infinite" : "none",
      }}
      aria-hidden
    />
  );
}
