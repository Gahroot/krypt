import { HelpCircle } from "lucide-react";
import { cn } from "@/ui/lib/utils";
import { useUIStore } from "@/ui/store";

/**
 * HelpButton — a persistent, always-visible button in the HUD that opens
 * the in-game Help panel (F1).
 *
 * Positioned bottom-right, above the Report button. Shows a keyboard shortcut
 * hint so testers discover F1 without being told.
 */
export function HelpButton() {
  const setHelpOpen = useUIStore((s) => s.setHelpOpen);
  const helpOpen = useUIStore((s) => s.helpOpen);

  return (
    <button
      type="button"
      onClick={() => setHelpOpen(!helpOpen)}
      title="Help (F1)"
      className={cn(
        "pointer-events-auto absolute bottom-[130px] right-3 z-20",
        "flex items-center gap-1.5 rounded-md border border-border",
        "bg-background/85 px-2.5 py-1.5 shadow-lg backdrop-blur-sm",
        "text-xs text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        helpOpen && "bg-primary/20 text-primary",
      )}
    >
      <HelpCircle className="size-3.5" />
      <span className="hidden sm:inline">Help</span>
      <kbd className="ml-0.5 rounded border border-border px-0.5 font-mono text-[9px] opacity-60">
        F1
      </kbd>
    </button>
  );
}
