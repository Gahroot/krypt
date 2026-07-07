import { useCallback, useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";

/**
 * MinimumResolutionNotice — a viewport gate for the alpha client.
 *
 * Two tiers:
 *   1. **Hard block** (< 1024 × 600): covers the entire viewport. The game UI
 *      physically cannot fit at this size — panels overlap, HUD clips.
 *   2. **Dismissable warning** (< 1280 × 768): a banner across the top. The
 *      game is playable but cramped; the tester can dismiss and continue.
 *
 * The component listens for `resize` events so rotating a tablet or dragging
 * the window edge immediately reflects the current tier. The dismiss state is
 * session-only (not persisted).
 *
 * Touch support: deferred for alpha. The notice mentions keyboard/mouse
 * requirement, and Phaser already receives pointer events (mouse + touch),
 * so the layout won't *break* on a tablet — but gameplay is not designed for
 * touch yet.
 */

/** Viewport widths that define the two tiers. */
const HARD_BLOCK_W = 1024;
const HARD_BLOCK_H = 600;
const SOFT_WARNING_W = 1280;
const SOFT_WARNING_H = 768;

function useViewport() {
  const [vp, setVp] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVp({ w: window.innerWidth, h: window.innerHeight }));
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return vp;
}

export function MinimumResolutionNotice() {
  const { w, h } = useViewport();
  const [dismissed, setDismissed] = useState(false);

  const isHardBlock = w < HARD_BLOCK_W || h < HARD_BLOCK_H;
  const isSoftWarning = !isHardBlock && (w < SOFT_WARNING_W || h < SOFT_WARNING_H);

  const dismiss = useCallback(() => setDismissed(true), []);

  // ── Hard block: full-screen overlay ──────────────────────────────────────
  if (isHardBlock) {
    return (
      <div className="pointer-events-auto fixed inset-0 z-[200] flex flex-col items-center justify-center bg-background/95 backdrop-blur-md">
        <MonitorSmartphone className="mb-4 size-16 text-muted-foreground" />
        <h2 className="mb-2 text-2xl font-bold tracking-wide text-foreground">Window too small</h2>
        <p className="max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
          CryptoMaple needs a viewport of at least{" "}
          <span className="font-semibold text-foreground">1024 × 600</span> to render the HUD and
          panels.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Please resize your browser window or use a larger screen.
        </p>
      </div>
    );
  }

  // ── Soft warning: top banner ─────────────────────────────────────────────
  if (isSoftWarning && !dismissed) {
    return (
      <div className="pointer-events-auto fixed top-0 right-0 left-0 z-[200] flex items-center justify-center gap-3 bg-amber-900/90 px-4 py-2 text-xs text-amber-100 shadow-lg backdrop-blur-sm">
        <MonitorSmartphone className="size-4 shrink-0" />
        <span>
          Small viewport detected ({w}×{h}). The recommended minimum is{" "}
          <span className="font-semibold">1280 × 768</span> for the best experience. Some panels may
          be cramped.
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="ml-2 shrink-0 rounded bg-amber-700/60 px-2 py-0.5 text-[10px] font-semibold text-amber-50 transition-colors hover:bg-amber-700"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
