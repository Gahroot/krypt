import { useEffect, useRef, useState } from "react";

import { Button } from "@/ui/components/ui/button";
import { useUIStore, type IntroActions } from "@/ui/store";

/**
 * IntroPanel — the Dawn Isle intro cinematic.
 *
 * Four atmospheric beats fade in and crossfade: stillness → dawn → mystery →
 * the promise of scale + first objective. The background gradient warms with
 * each beat (cold black → pre-dawn amber) to reinforce the emotional arc.
 * Any keypress or click skips immediately. The scene's `complete()` marks the
 * intro as seen and transitions into MapScene for Dawn Isle.
 */

/** Per-beat visual config — background gradient, text color, and font size. */
const BEAT_STYLES = [
  { bg: "#050810", text: "#8fa89a", size: "text-lg" }, // stillness — dim, ethereal
  { bg: "#0a1628", text: "#b5d4a4", size: "text-xl" }, // dawn — warmer, larger
  { bg: "#111c2e", text: "#cfe8b4", size: "text-xl" }, // mystery — standard warmth
  { bg: "#1a2538", text: "#ddeec8", size: "text-xl" }, // call to action — confident, bright
] as const;

const FADE_IN_MS = 500;
const FADE_OUT_MS = 400;

export function IntroPanel() {
  const open = useUIStore((s) => s.introOpen);
  const intro = useUIStore((s) => s.intro);
  const actions = useUIStore((s) => s.introActions);

  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  // Keep the latest actions in a ref so the sequence effect needn't restart.
  const actionsRef = useRef<IntroActions | null>(actions);
  actionsRef.current = actions;
  // Guard against firing complete() more than once (skip + natural end race).
  const doneRef = useRef(false);

  const lines = intro.lines;

  useEffect(() => {
    if (!open || lines.length === 0) return;
    doneRef.current = false;
    let cancelled = false;
    const timers: number[] = [];

    const finish = (): void => {
      if (doneRef.current) return;
      doneRef.current = true;
      actionsRef.current?.complete();
    };

    let i = 0;
    const playLine = (): void => {
      if (cancelled) return;
      const line = lines[i];
      if (!line) {
        finish();
        return;
      }
      setIndex(i);
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, 20),
      );
      // Begin fade-out after the line has faded in and held.
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) setVisible(false);
        }, FADE_IN_MS + line.holdMs),
      );
      // Advance once the fade-out completes.
      timers.push(
        window.setTimeout(
          () => {
            i += 1;
            playLine();
          },
          FADE_IN_MS + line.holdMs + FADE_OUT_MS,
        ),
      );
    };
    playLine();

    // Skip on any key or click — advances immediately to the end.
    const skip = (): void => finish();
    window.addEventListener("keydown", skip);

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      window.removeEventListener("keydown", skip);
    };
  }, [open, lines]);

  if (!open) return null;

  const skip = (): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    actions?.complete();
  };

  const line = lines[index];
  const beat = (BEAT_STYLES[index] ?? BEAT_STYLES[0]) as (typeof BEAT_STYLES)[number];

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        background: `radial-gradient(ellipse at 50% 60%, ${beat.bg}ee, ${beat.bg})`,
        transition: "background 1.2s ease-out",
      }}
      onClick={skip}
    >
      <p
        className={`max-w-[68%] text-center ${beat.size} leading-relaxed transition-opacity duration-500 ease-out`}
        style={{
          opacity: visible ? 1 : 0,
          color: beat.text,
          textShadow: `0 0 40px ${beat.text}22`,
          whiteSpace: "pre-line",
        }}
      >
        {line?.text ?? ""}
      </p>

      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          skip();
        }}
        className="absolute bottom-8 text-xs tracking-wide text-muted-foreground/60 hover:text-foreground/80 transition-colors"
      >
        Press any key to skip…
      </Button>
    </div>
  );
}
