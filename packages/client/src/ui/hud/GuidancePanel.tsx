import { Compass } from "lucide-react";

import { getRecommendedMilestone } from "@maple/shared";
import { useUIStore } from "@/ui/store";

/**
 * GuidancePanel — proactive "what to do next" panel for new/lost players.
 *
 * Appears below the minimap (top-left) when the player has no tracked quests
 * in the QuestTracker. Uses `getRecommendedMilestone` from
 * `@maple/shared/guidance` to compute the next progression step.
 *
 * Mirrors MapleStory's "lightbulb" guide: always tells the player where to go
 * next so they never have to wander aimlessly.
 */
export function GuidancePanel() {
  const level = useUIStore((s) => s.hud.level);
  const trackedQuests = useUIStore((s) => s.hud.quests);
  const questLog = useUIStore((s) => s.questLog.quests);
  // Only show when no quests are being tracked — this is the "lost player" state.
  if (trackedQuests.length > 0) return null;

  // Build the quest-states map the guidance function expects.
  const questStates = new Map<string, string>();
  for (const q of questLog) {
    questStates.set(q.questId, q.status);
  }

  const result = getRecommendedMilestone(level, questStates);
  if (!result || result.allComplete) return null;

  const { milestone, steps, activeStepIndex } = result;
  const activeStep = activeStepIndex >= 0 ? steps[activeStepIndex] : null;
  const completedCount = steps.filter((s) => s.completed).length;

  return (
    <div className="absolute left-3 top-[116px] max-w-[min(260px,calc(100vw-4rem))] w-[260px] select-none rounded-lg border border-amber-500/30 bg-background/92 px-3 py-2 shadow-2xl backdrop-blur-sm">
      {/* Header */}
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-amber-400">
        <Compass className="size-3.5" />
        {milestone.title}
      </div>

      {/* Progress bar */}
      {steps.length > 0 && (
        <div className="mb-1.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${(completedCount / steps.length) * 100}%` }}
            />
          </div>
          <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
            {completedCount}/{steps.length} steps
          </div>
        </div>
      )}

      {/* Active step — the big "do this next" call-to-action */}
      {activeStep && (
        <div className="flex items-start gap-1.5 text-[12px]">
          <span className="mt-px text-amber-400">🎯</span>
          <span className="font-semibold text-slate-100">{activeStep.label}</span>
        </div>
      )}

      {/* Milestone description (only when no steps or as extra context) */}
      {!activeStep && (
        <p className="text-[11px] leading-snug text-muted-foreground">{milestone.description}</p>
      )}
    </div>
  );
}
