import { useEffect, useState, useRef } from "react";
import { useUIStore } from "@/ui/store";
import type { EventSnapshot } from "@/ui/store/events";

/**
 * EventsNotice — a dismissible banner below the AlphaBanner showing active
 * live-ops events (double EXP, holiday events, etc.).
 *
 * Re-renders every minute to keep the countdown accurate. Dismissible per
 * session via localStorage — but auto-reappears when new events arrive that
 * weren't in the dismissed set.
 */

const DISMISS_KEY = "cryptomaple.eventsNotice.dismissed";

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable — banner stays visible.
  }
}

function formatTimeLeft(endAt: number): string {
  const remaining = Math.max(0, endAt - Date.now());
  if (remaining <= 0) return "";
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
  }
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

function EffectLabel({ effects }: { effects: EventSnapshot["effects"] }) {
  const parts: string[] = [];
  if (effects.expMultiplier && effects.expMultiplier > 1) {
    parts.push(`${effects.expMultiplier}× EXP`);
  }
  if (effects.dropMultiplier && effects.dropMultiplier > 1) {
    parts.push(`${effects.dropMultiplier}× Drops`);
  }
  if (effects.mesoMultiplier && effects.mesoMultiplier > 1) {
    parts.push(`${effects.mesoMultiplier}× Mesos`);
  }
  if (parts.length === 0) return null;
  return <span className="font-semibold">{parts.join(" · ")}</span>;
}

export function EventsNotice() {
  const events = useUIStore((s) => s.events);
  // Track which event IDs the user has explicitly dismissed this session.
  const dismissedRef = useRef<Set<string>>(loadDismissed());
  // Force re-render every 60s so the countdown stays accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Filter to events the user hasn't dismissed.
  const visible = events.filter((e) => !dismissedRef.current.has(e.id));
  if (visible.length === 0) return null;

  const handleDismissAll = () => {
    for (const e of events) dismissedRef.current.add(e.id);
    saveDismissed(dismissedRef.current);
    setTick((t) => t + 1); // force re-render
  };

  return (
    <div className="pointer-events-auto fixed top-8 left-1/2 z-40 flex max-w-lg -translate-x-1/2 flex-col gap-1 rounded-md border border-blue-500/30 bg-blue-950/80 px-3 py-1.5 shadow-lg backdrop-blur-sm">
      {visible.map((evt) => (
        <div key={evt.id} className="flex items-center gap-2 text-xs">
          <span style={{ color: evt.color ?? "#4FC3F7" }}>{evt.icon ?? "🎉"}</span>
          <span className="text-blue-100">{evt.name}</span>
          <EffectLabel effects={evt.effects} />
          <span className="ml-auto text-blue-400/70">{formatTimeLeft(evt.endAt)}</span>
        </div>
      ))}
      <button
        type="button"
        className="self-end rounded px-1.5 py-0.5 text-[10px] text-blue-400/70 hover:bg-blue-500/10 hover:text-blue-300"
        onClick={handleDismissAll}
      >
        ✕
      </button>
    </div>
  );
}
