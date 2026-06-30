import { useEffect, useRef, useState } from "react";

import { Button } from "@/ui/components/ui/button";
import { useUIStore, type IntroActions } from "@/ui/store";

/**
 * IntroPanel — the Dawn Isle intro cinematic.
 *
 * React migration of the legacy hand-drawn Phaser `IntroScene`. The scene is a
 * thin controller that publishes the line sequence + registers a `complete`
 * action; this component plays the lines (fade in → hold → crossfade) and
 * handles skip-on-key/click, then calls `complete()` — which the scene wires to
 * its finish() (mark intro seen + fade into MapScene for Dawn Isle).
 */

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

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0c1019]"
      onClick={skip}
    >
      <p
        className="max-w-[70%] text-center text-lg leading-relaxed text-[#cfe8b4] transition-opacity duration-500 ease-out"
        style={{ opacity: visible ? 1 : 0 }}
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
        className="absolute bottom-8 text-xs text-muted-foreground hover:text-foreground"
      >
        Press any key to skip…
      </Button>
    </div>
  );
}
