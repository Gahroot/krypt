import { CheckCircle2, ScrollText, Swords } from "lucide-react";

import { cn } from "@/ui/lib/utils";
import { useUIStore } from "@/ui/store";

/**
 * QuestTracker — the always-on top-right active-quest tracker ported from Phaser.
 *
 * Pure renderer of the HUD snapshot's `quests` + `bonusHunt`. Non-interactive, so
 * it inherits the click-through host. Hidden when nothing is being tracked.
 */
export function QuestTracker() {
  const quests = useUIStore((s) => s.hud.quests);
  const bonusHunt = useUIStore((s) => s.hud.bonusHunt);
  const toggleOn = useUIStore((s) => s.hud.hudToggles.questTracker);

  if (!toggleOn || (quests.length === 0 && !bonusHunt)) return null;

  return (
    <div className="absolute right-3 top-3 max-w-[min(260px,calc(100vw-4rem))] w-[260px] select-none rounded-lg border border-border bg-background/92 px-3 py-2 shadow-2xl">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-primary">
        <ScrollText className="size-3.5" />
        Quests
      </div>

      {bonusHunt && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-amber-400">
          <Swords className="size-3.5" />
          Bonus Hunt — EXP ×{bonusHunt.expMultiplier} Drop ×{bonusHunt.dropMultiplier}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {quests.map((q) => (
          <div key={q.questId}>
            <div
              className={cn(
                "flex items-center gap-1 text-[12px] font-semibold",
                q.complete ? "text-yellow-300" : "text-slate-200",
              )}
            >
              {q.complete && <CheckCircle2 className="size-3" />}
              <span className="truncate">{q.name}</span>
            </div>
            {q.objectives.map((o, i) => (
              <div
                key={i}
                className={cn(
                  "pl-2 text-[11px] tabular-nums",
                  o.done ? "text-[#9ad06b]" : "text-muted-foreground",
                )}
              >
                {o.description}
              </div>
            ))}
            {q.complete && (
              <div className="pl-2 text-[11px] italic text-slate-400">
                🎯 Return to the giver to turn in
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
