import { useEffect, useRef, useState } from "react";

import { useUIStore } from "@/ui/store";

/**
 * DamageVignette — a red screen-edge flash that fires whenever the local
 * player takes damage.
 *
 * Reads the player's `hp` from the HUD snapshot on every push and triggers
 * a brief red vignette whenever HP *drops*. The vignette fades out over
 * 300 ms via a CSS transition on opacity.
 *
 * Non-interactive, pointer-events-none.
 */

const FLASH_DURATION_MS = 250;

export function DamageVignette() {
  const hp = useUIStore((s) => s.hud.hp);
  const maxHp = useUIStore((s) => s.hud.maxHp);
  const prevHp = useRef(hp);
  const [flash, setFlash] = useState(false);
  const timerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  useEffect(() => {
    if (hp < prevHp.current && prevHp.current > 0 && hp > 0) {
      // Clear any pending timer from a previous flash.
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);

      setFlash(true);
      timerRef.current = window.setTimeout(() => {
        setFlash(false);
        timerRef.current = null;
      }, FLASH_DURATION_MS);
    }
    prevHp.current = hp;

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [hp]);

  // Don't render at all when there's no flash to show and HP is full.
  if (!flash && hp >= maxHp) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40 transition-opacity"
      style={{
        opacity: flash ? 1 : 0,
        background:
          "radial-gradient(ellipse at center, transparent 40%, rgba(220,38,38,0.35) 100%)",
        transitionDuration: "300ms",
      }}
      aria-hidden
    />
  );
}
