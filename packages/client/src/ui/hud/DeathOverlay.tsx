import { useUIStore } from "@/ui/store";

/**
 * Full-screen death overlay shown while the local player is dead.
 *
 * Displays a dark overlay with a respawn countdown. The player cannot act
 * during this time — input is already blocked server-side.
 */
export function DeathOverlay() {
  const dead = useUIStore((s) => s.hud.dead);
  const countdownMs = useUIStore((s) => s.hud.respawnCountdownMs);

  if (!dead) return null;

  const seconds = Math.max(0, Math.ceil(countdownMs / 1000));

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      {/* Skull icon */}
      <div className="mb-4 text-6xl select-none">💀</div>

      {/* Heading */}
      <h2
        className="mb-2 text-3xl font-bold tracking-wide"
        style={{ color: "#f87171", textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}
      >
        You have fallen!
      </h2>

      {/* Countdown */}
      <p className="text-lg" style={{ color: "#d1d5db", textShadow: "0 1px 4px rgba(0,0,0,0.5)" }}>
        Respawning in{" "}
        <span className="font-mono font-bold" style={{ color: "#fbbf24" }}>
          {seconds}s
        </span>
        …
      </p>

      {/* Subtle hint */}
      <p className="mt-6 text-sm" style={{ color: "#6b7280" }}>
        Returning to town…
      </p>
    </div>
  );
}
