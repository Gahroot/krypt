import { useEffect, useState } from "react";

import { cn } from "@/ui/lib/utils";
import { useUIStore, type CoachMarkPosition } from "@/ui/store";

/**
 * CoachMarks — the onboarding hint overlay (a spotlight pill).
 *
 * React migration of the legacy hand-drawn Phaser `CoachMarksScene` pill. The
 * scene is still the driver: it polls the registry `coachmark:<id>` flags, gates
 * by the per-character "seen" set, owns the auto-dismiss timer, and persists
 * dismissal. It pushes the active hint in as a snapshot; this component only
 * renders it.
 *
 * The overlay is intentionally `pointer-events-none` (like the original
 * non-interactive Phaser pill) so any key press or canvas click still reaches
 * Phaser's input — preserving the exact "dismiss on any key/click" behavior.
 */

/** Map the snapshot position to layout classes for the pill wrapper. */
const POSITION_CLASS: Record<CoachMarkPosition, string> = {
  "center-bottom": "inset-x-0 bottom-16 items-end justify-center",
  center: "inset-0 items-center justify-center",
  "top-left": "left-6 top-20 items-start justify-start",
};

export function CoachMarks() {
  const mark = useUIStore((s) => s.coachMark);
  const [shown, setShown] = useState(false);

  // Re-trigger the entrance animation each time a new hint appears.
  useEffect(() => {
    if (!mark) {
      setShown(false);
      return;
    }
    setShown(false);
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [mark]);

  if (!mark) return null;

  return (
    <div className={cn("pointer-events-none absolute z-40 flex", POSITION_CLASS[mark.position])}>
      <div
        className={cn(
          "relative flex max-w-[420px] items-center gap-3.5 rounded-xl border-2 border-primary/70 bg-popover/95 px-4 py-3 shadow-2xl backdrop-blur-sm transition-all duration-300 ease-out",
          shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        {/* Spotlight glow drawing the eye to the hint. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-6 -z-10 rounded-[28px] bg-primary/10 blur-2xl"
        />

        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-2xl"
          aria-hidden
        >
          {mark.icon}
        </span>

        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-bold text-primary">{mark.title}</span>
          <span className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
            {mark.detail}
          </span>
        </div>
      </div>
    </div>
  );
}
