import { Bug } from "lucide-react";
import { cn } from "@/ui/lib/utils";

/**
 * FeedbackButton — a persistent, always-visible button in the HUD that opens
 * the in-game feedback / bug-report panel.
 *
 * Positioned bottom-right, above the skill bar. Dispatches a CustomEvent that
 * the Phaser UIScene listens for — no store bridge needed.
 *
 * Works from any panel/state because it lives in the React overlay (CSS z-index
 * above Phaser) and the event opens the Phaser feedback panel directly.
 */
export function FeedbackButton() {
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent("open-feedback"));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Report a bug / feedback"
      className={cn(
        "pointer-events-auto absolute bottom-[100px] right-3 z-20",
        "flex items-center gap-1.5 rounded-md border border-border",
        "bg-background/85 px-2.5 py-1.5 shadow-lg backdrop-blur-sm",
        "text-xs text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
      )}
    >
      <Bug className="size-3.5" />
      <span className="hidden sm:inline">Report</span>
    </button>
  );
}
