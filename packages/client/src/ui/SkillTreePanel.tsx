import { Plus } from "lucide-react";
import {
  getClass,
  totalSpByLevel,
  spSpent,
  skillsAvailableAt,
  ClassArchetype,
  type SkillDef,
  type JobTier,
} from "@maple/shared";

import { DraggableWindow } from "@/ui/components/DraggableWindow";
import { Button } from "@/ui/components/ui/button";
import { Separator } from "@/ui/components/ui/separator";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/components/ui/tooltip";
import { useUIStore } from "@/ui/store";

/**
 * SkillTreePanel — the job skill tree window (toggled with K).
 *
 * React port of the hand-drawn Phaser `buildSkillTreePanel` / `renderSkillTree`.
 * Driven entirely from the job/skill data in @maple/shared (classes.ts +
 * skillbook.ts): tiers, eligibility, SP budget, and prerequisites are computed
 * locally so the server stays the single source of truth, while SP allocation
 * flows through `characterActions.learnSkill`, wired to the authoritative
 * LEARN_SKILL message.
 */

const KIND_COLOR: Record<string, string> = {
  active: "#60a5fa",
  buff: "#fbbf24",
  passive: "#94a3b8",
};

function SkillRow({
  skill,
  learned,
  canLearn,
  tierUnlocked,
  onLearn,
}: {
  skill: SkillDef;
  learned: number;
  canLearn: boolean;
  tierUnlocked: boolean;
  onLearn: () => void;
}) {
  const isMaxed = learned >= skill.maxLevel;
  const nameColor = !tierUnlocked ? "var(--muted-foreground)" : isMaxed ? "#facc15" : undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent">
          <span className="flex-1 truncate text-[12px] font-semibold" style={{ color: nameColor }}>
            {skill.name}
          </span>
          <span
            className="text-[9px] font-bold uppercase"
            style={{ color: KIND_COLOR[skill.kind] ?? "#94a3b8" }}
          >
            {skill.kind}
          </span>
          <span
            className="w-12 text-right text-[11px] tabular-nums"
            style={{
              color: isMaxed ? "#9ad06b" : learned > 0 ? undefined : "var(--muted-foreground)",
            }}
          >
            {learned > 0 ? learned : "-"} / {skill.maxLevel}
          </span>
          <Button
            variant="secondary"
            size="icon"
            className="size-5"
            disabled={!canLearn}
            onClick={onLearn}
            aria-label={`Level up ${skill.name}`}
          >
            <Plus className="size-3" />
          </Button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[240px]">
        <p className="text-[12px] font-bold">{skill.name}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{skill.description}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Lv. {skill.levelReq} required · max {skill.maxLevel}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function TierSection({
  title,
  tier,
  level,
  skillBook,
  learnableIds,
  hasSp,
  onLearn,
}: {
  title: string;
  tier: JobTier;
  level: number;
  skillBook: Record<string, number>;
  learnableIds: Set<string>;
  hasSp: boolean;
  onLearn: (skillId: string) => void;
}) {
  if (tier.skills.length === 0) return null;
  const tierUnlocked = level >= tier.levelReq;

  return (
    <div className="mt-2">
      <p
        className="text-[11px] font-bold"
        style={{ color: tierUnlocked ? "#9ad06b" : "var(--muted-foreground)" }}
      >
        {title}
        {!tierUnlocked ? `  (Lv.${tier.levelReq})` : ""}
      </p>
      <div className="mt-0.5 flex flex-col">
        {tier.skills.map((skill) => {
          const learned = skillBook[skill.id] ?? 0;
          const canLearn = learnableIds.has(skill.id) && hasSp && tierUnlocked;
          return (
            <SkillRow
              key={skill.id}
              skill={skill}
              learned={learned}
              canLearn={canLearn}
              tierUnlocked={tierUnlocked}
              onLearn={() => onLearn(skill.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SkillTreePanel() {
  const open = useUIStore((s) => s.skillTreeOpen);
  const character = useUIStore((s) => s.character);
  const skillBook = useUIStore((s) => s.skillBook);
  const actions = useUIStore((s) => s.characterActions);

  if (!open || !character) return null;

  const archetype = character.archetype as ClassArchetype;
  const onClose = () => actions?.closeSkillTree();

  const cls = getClass(archetype);
  const maxSp = totalSpByLevel(character.level);
  const spent = spSpent(skillBook);
  const remaining = Math.max(0, maxSp - spent);
  const learnableIds = new Set(
    skillsAvailableAt(archetype, character.level, skillBook, character.branchId || undefined).map(
      (s) => s.id,
    ),
  );
  const hasSp = remaining > 0;

  const tier1 = cls.jobTiers[0];

  return (
    <TooltipProvider delayDuration={120}>
      <DraggableWindow
        title={`${cls.name} Skills`}
        hotkey="K"
        onClose={onClose}
        defaultPosition={{ x: 410, y: 72 }}
        headerExtra={
          <span className="text-[10px] font-medium text-primary tabular-nums">
            SP {remaining} / {maxSp}
          </span>
        }
      >
        <ScrollArea className="max-h-[70vh] pr-2">
          {tier1 && (
            <TierSection
              title={`Tier ${tier1.tier} — ${tier1.title}`}
              tier={tier1}
              level={character.level}
              skillBook={skillBook}
              learnableIds={learnableIds}
              hasSp={hasSp}
              onLearn={(id) => actions?.learnSkill(id)}
            />
          )}

          {(cls.branches ?? []).map((branch) => (
            <div key={branch.id}>
              {branch.jobTiers.map((tier) => (
                <TierSection
                  key={`${branch.id}-${tier.tier}`}
                  title={`Tier ${tier.tier} — ${branch.name} / ${tier.title}`}
                  tier={tier}
                  level={character.level}
                  skillBook={skillBook}
                  learnableIds={learnableIds}
                  hasSp={hasSp}
                  onLearn={(id) => actions?.learnSkill(id)}
                />
              ))}
            </div>
          ))}

          <Separator className="my-2" />
          <p className="text-[10px] text-muted-foreground">
            {spent} SP spent · level up to earn more.
          </p>
        </ScrollArea>
      </DraggableWindow>
    </TooltipProvider>
  );
}
