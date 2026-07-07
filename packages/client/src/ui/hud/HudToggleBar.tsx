import { Map, ScrollText, MessageSquare, Swords, BarChart3 } from "lucide-react";

import { cn } from "@/ui/lib/utils";
import { useUIStore, type HudToggles } from "@/ui/store";

/**
 * HudToggleBar — a compact bottom-center bar that lets the player toggle
 * individual HUD elements on/off.
 *
 * Shown/hidden via the "H" key (or a click). Each button toggles one HUD
 * panel; active panels are highlighted. The bar itself is interactive
 * (pointer-events-auto) while the rest of the HUD remains click-through.
 *
 * Position: above the StatusBars, centered horizontally. Scales with the
 * viewport using clamp()-based offsets inherited from the CSS :root tokens.
 */

const TOGGLE_ITEMS: { key: keyof HudToggles; icon: typeof Map; label: string }[] = [
  { key: "statusBars", icon: BarChart3, label: "Vitals" },
  { key: "minimap", icon: Map, label: "Minimap" },
  { key: "skillBar", icon: Swords, label: "Skills" },
  { key: "questTracker", icon: ScrollText, label: "Quests" },
  { key: "chatBox", icon: MessageSquare, label: "Chat" },
];

export function HudToggleBar() {
  const toggles = useUIStore((s) => s.hud.hudToggles);
  const toggle = useUIStore((s) => s.toggleHudElement);

  return (
    <div className="pointer-events-auto absolute bottom-[100px] left-1/2 z-20 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-0.5 rounded-md border border-border bg-background/85 px-1 py-0.5 shadow-lg backdrop-blur-sm">
      {TOGGLE_ITEMS.map(({ key, icon: Icon, label }) => {
        const on = toggles[key];
        return (
          <button
            type="button"
            key={key}
            onClick={() => toggle(key)}
            title={`${on ? "Hide" : "Show"} ${label}`}
            className={cn(
              "flex size-6 items-center justify-center rounded transition-colors",
              on
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground/50 hover:bg-muted hover:text-muted-foreground",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
