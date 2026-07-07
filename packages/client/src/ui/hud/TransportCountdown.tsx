import { useEffect, useState } from "react";
import { useUIStore } from "@/ui/store";

/**
 * TransportCountdown — the "wait at the dock" ritual banner.
 *
 * Shown while the player is boarded on a scheduled transport (airship, boat,
 * sky-ride). Displays a live countdown, the transport label, and a passenger
 * count. The server pushes TRANSPORT_STATUS every second; the client
 * interpolates locally between updates for a smooth tick.
 */
export function TransportCountdown() {
  const transport = useUIStore((s) => s.transport);
  const [now, setNow] = useState(Date.now);

  // Tick locally every 200 ms for smooth countdown interpolation.
  useEffect(() => {
    if (!transport) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [transport]);

  if (!transport) return null;

  // Interpolate remaining ms from the last server snapshot.
  const elapsed = now - transport.receivedAt;
  const remainingMs = Math.max(0, transport.departInMs - elapsed);
  const remainingSec = Math.ceil(remainingMs / 1000);

  return (
    <div
      className="pointer-events-none fixed top-4 left-1/2 z-40 -translate-x-1/2"
      style={{ animation: "fadeSlideDown 0.3s ease-out" }}
    >
      <div
        className="flex flex-col items-center gap-1 rounded-xl px-6 py-3 shadow-lg"
        style={{
          background: "rgba(15, 23, 42, 0.85)",
          border: "1px solid rgba(147, 197, 253, 0.4)",
          backdropFilter: "blur(8px)",
        }}
      >
        {/* Transport label */}
        <span className="text-sm font-semibold tracking-wide" style={{ color: "#93c5fd" }}>
          {transport.portalLabel}
        </span>

        {/* Countdown */}
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-2xl font-mono font-bold tabular-nums"
            style={{
              color: remainingSec <= 5 ? "#fbbf24" : "#e2e8f0",
              textShadow:
                remainingSec <= 5
                  ? "0 0 12px rgba(251, 191, 36, 0.5)"
                  : "0 1px 4px rgba(0,0,0,0.4)",
              transition: "color 0.3s, text-shadow 0.3s",
            }}
          >
            {remainingSec}
          </span>
          <span className="text-xs" style={{ color: "#94a3b8" }}>
            sec until departure
          </span>
        </div>

        {/* Passenger count */}
        <span className="text-xs" style={{ color: "#64748b" }}>
          🧍 {transport.boardedCount} {transport.boardedCount === 1 ? "passenger" : "passengers"}{" "}
          aboard
        </span>
      </div>

      {/* Inject keyframe animation (only once) */}
      <style>{`
        @keyframes fadeSlideDown {
          from { opacity: 0; transform: translate(-50%, -10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}
