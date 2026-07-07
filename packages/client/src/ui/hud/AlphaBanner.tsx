import { Info } from "lucide-react";

/**
 * AlphaBanner — persistent in-game banner reminding players this is a closed alpha.
 *
 * Sits at the top-center of the screen, below the minimap but above everything
 * else. Dismissible per session (via localStorage) so it doesn't annoy returning
 * players, but reappears on each fresh session.
 */

const DISMISS_KEY = "cryptomaple.alphaBanner.dismissed";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function dismiss(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // localStorage unavailable — banner just stays visible.
  }
}

export function AlphaBanner() {
  if (isDismissed()) return null;

  return (
    <div className="pointer-events-auto fixed top-2 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-md border border-amber-500/30 bg-amber-950/80 px-3 py-1.5 shadow-lg backdrop-blur-sm">
      <Info className="h-3.5 w-3.5 shrink-0 text-amber-400" />
      <span className="text-xs font-medium text-amber-200">
        Closed Alpha — Wipes possible · Test currency only · No real-money value
      </span>
      <button
        type="button"
        className="ml-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-300"
        onClick={dismiss}
      >
        ✕
      </button>
    </div>
  );
}
