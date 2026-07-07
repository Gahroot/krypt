import { CheckSquare, ScrollText, Square, XCircle } from "lucide-react";
import { QUESTS, getItemDef } from "@maple/shared";

import { DraggableWindow } from "@/ui/components/DraggableWindow";
import { Badge } from "@/ui/components/ui/badge";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { EmptyState } from "@/ui/components/EmptyState";
import { useUIStore, type QuestEntrySnapshot } from "@/ui/store";

/**
 * QuestLogPanel — the quest journal (toggled with Q).
 *
 * React migration of the legacy hand-drawn Phaser quest log (UI.ts
 * buildQuestLog / renderQuestLog). Reads the quest-log snapshot + action
 * registry from the bridge store and renders from the shared kit (Panel /
 * ScrollArea / Badge). Quests are grouped into Active / Available / Complete
 * sections with objective progress and a reward preview. Close flows through
 * `questActions.closeLog`, wired by `UIScene` to flip the store open flag (so
 * the Phaser Q/ESC toggle and the React close button stay in sync).
 */

/** Resolve a quest's reward preview line from the shared QUESTS table. */
function rewardLine(questId: string): string | null {
  const def = QUESTS[questId];
  if (!def) return null;
  const parts: string[] = [];
  if (def.rewards.mesos) parts.push(`${def.rewards.mesos} mesos`);
  if (def.rewards.exp) parts.push(`${def.rewards.exp} EXP`);
  for (const itemId of def.rewards.items ?? []) {
    parts.push(getItemDef(itemId)?.name ?? itemId);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

function QuestEntry({ quest }: { quest: QuestEntrySnapshot }) {
  const actions = useUIStore((s) => s.questActions);
  const turnedIn = quest.status === "turnedIn";
  const isComplete = quest.status === "complete";
  const reward = turnedIn ? null : rewardLine(quest.questId);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          className={`text-[13px] font-bold ${turnedIn ? "text-muted-foreground" : "text-foreground"}`}
        >
          {turnedIn ? "↳ " : ""}
          {quest.name}
        </span>
        {quest.isRepeatable && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            📅 Daily
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-0.5 pl-3">
        {quest.objectiveProgress.map((obj, i) => {
          const done = obj.current >= obj.target;
          return (
            <div
              key={`${obj.kind}-${i}`}
              className={`flex items-start gap-1.5 text-[12px] ${done ? "text-emerald-400" : "text-muted-foreground"}`}
            >
              {done ? (
                <CheckSquare className="mt-0.5 size-3 shrink-0" />
              ) : (
                <Square className="mt-0.5 size-3 shrink-0" />
              )}
              <span>{obj.description}</span>
            </div>
          );
        })}
      </div>

      {reward && <p className="pl-3 text-[11px] text-amber-200">Rewards: {reward}</p>}
      {isComplete && (
        <p className="pl-3 text-[11px] italic text-amber-200">
          💬 Talk to the quest giver to turn in
        </p>
      )}
      {quest.status === "active" && (
        <button
          onClick={() => actions?.abandonQuest(quest.questId)}
          className="mt-1 flex items-center gap-1 pl-3 text-[11px] text-red-400/70 transition-colors hover:text-red-300"
        >
          <XCircle className="size-3" />
          Abandon
        </button>
      )}
    </div>
  );
}

const SECTIONS: Array<{
  title: string;
  className: string;
  match: (q: QuestEntrySnapshot) => boolean;
}> = [
  { title: "ACTIVE", className: "text-emerald-300", match: (q) => q.status === "active" },
  { title: "AVAILABLE", className: "text-sky-300", match: (q) => q.status === "available" },
  {
    title: "COMPLETE",
    className: "text-amber-200",
    match: (q) => q.status === "complete" || q.status === "turnedIn",
  },
];

export function QuestLogPanel() {
  const open = useUIStore((s) => s.questLogOpen);
  const log = useUIStore((s) => s.questLog);
  const actions = useUIStore((s) => s.questActions);

  if (!open) return null;

  const quests = log.quests;
  const isEmpty = quests.length === 0;

  return (
    <DraggableWindow
      title="Quest Log"
      hotkey="Q"
      onClose={() => actions?.closeLog()}
      defaultPosition={{ x: 430, y: 200 }}
    >
      {isEmpty ? (
        <EmptyState
          icon={ScrollText}
          title="No quests yet."
          description="Talk to NPCs to find quests!"
        />
      ) : (
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="flex flex-col gap-4">
            {SECTIONS.map((section) => {
              const sectionQuests = quests.filter(section.match);
              if (sectionQuests.length === 0) return null;
              return (
                <div key={section.title} className="flex flex-col gap-2.5">
                  <p className={`text-[12px] font-bold tracking-wide ${section.className}`}>
                    {section.title}
                  </p>
                  {sectionQuests.map((q) => (
                    <QuestEntry key={q.questId} quest={q} />
                  ))}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </DraggableWindow>
  );
}
