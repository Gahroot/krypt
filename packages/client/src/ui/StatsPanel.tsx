import { Plus } from "lucide-react";
import { deriveSecondary, getClass, type CharacterStats, type ClassArchetype } from "@maple/shared";

import { Panel } from "@/ui/components/Panel";
import { StatRow } from "@/ui/components/StatRow";
import { Button } from "@/ui/components/ui/button";
import { Progress } from "@/ui/components/ui/progress";
import { Separator } from "@/ui/components/ui/separator";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { useUIStore, type StatKey } from "@/ui/store";

/**
 * StatsPanel — the character stat window (toggled with S).
 *
 * React port of the hand-drawn Phaser `buildStatPanel` / `renderStatPanel`.
 * Reads the character snapshot + action registry from the bridge store and
 * renders with the shared kit only (Panel / StatRow / Button / Progress).
 * AP allocation, auto-assign, and title equip flow through `characterActions.*`,
 * which the scene wires to the authoritative SPEND_AP / TITLE_EQUIP messages.
 * Derived (secondary) stats are computed locally from @maple/shared so the
 * server stays the single source of truth for the math.
 */

const PRIMARY: { key: StatKey; label: string }[] = [
  { key: "STR", label: "STR" },
  { key: "DEX", label: "DEX" },
  { key: "INT", label: "INT" },
  { key: "LUK", label: "LUK" },
];

export function StatsPanel() {
  const open = useUIStore((s) => s.statPanelOpen);
  const character = useUIStore((s) => s.character);
  const actions = useUIStore((s) => s.characterActions);

  if (!open || !character) return null;

  const c = character;
  const hasAp = c.ap > 0;

  const charStats: CharacterStats = {
    STR: c.str,
    DEX: c.dex,
    INT: c.intel,
    LUK: c.luk,
    HP: c.hp,
    MP: c.mp,
  };
  const cls = getClass(c.archetype as ClassArchetype);
  const derived = deriveSecondary(charStats, cls.primaryStat, {
    atk: c.equipBonus.atk,
    wDef: c.equipBonus.wDef,
    mDef: c.equipBonus.mDef,
    speed: c.equipBonus.speed,
    jump: c.equipBonus.jump,
  });

  const expRatio = c.expNeed > 0 ? c.exp / c.expNeed : 0;

  const primaryValue: Record<StatKey, string> = {
    STR: `${c.str}`,
    DEX: `${c.dex}`,
    INT: `${c.intel}`,
    LUK: `${c.luk}`,
    HP: `${c.hp} / ${c.maxHp}`,
    MP: `${c.mp} / ${c.maxMp}`,
  };

  const apButton = (stat: StatKey) => (
    <Button
      variant="secondary"
      size="icon"
      className="size-5"
      disabled={!hasAp}
      onClick={() => actions?.spendAp(stat)}
      aria-label={`Allocate AP to ${stat}`}
    >
      <Plus className="size-3" />
    </Button>
  );

  const derivedRows: [string, string][] = [
    ["ATK", `${derived.atk}`],
    ["MATK", `${derived.mAtk}`],
    ["WDEF", `${derived.wDef}`],
    ["MDEF", `${derived.mDef}`],
    ["Accuracy", `${derived.accuracy}`],
    ["Avoid", `${derived.avoid}`],
    ["Crit", `${(derived.critRate * 100).toFixed(1)}%`],
    ["Speed", `${derived.speed}`],
    ["Jump", `${derived.jump}`],
  ];

  return (
    <Panel
      title={c.name || "Adventurer"}
      hotkey="S"
      onClose={() => actions?.closeStatPanel()}
      className="absolute top-[52px] left-4 w-[260px]"
      headerExtra={<span className="text-[10px] font-medium text-primary">{c.jobTitle}</span>}
    >
      <ScrollArea className="max-h-[70vh] pr-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-primary">Level {c.level}</span>
          <span className="text-[11px] font-bold text-primary tabular-nums">AP: {c.ap}</span>
        </div>

        {/* EXP bar */}
        <div className="mt-2">
          <Progress
            value={Math.min(100, expRatio * 100)}
            className="h-2 [&_[data-slot=progress-indicator]]:bg-[#9ad06b]"
          />
          <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
            EXP {c.exp.toLocaleString()} / {c.expNeed.toLocaleString()} (
            {(expRatio * 100).toFixed(1)}%)
          </p>
        </div>

        <Separator className="my-3" />

        {/* Primary stats with AP allocation */}
        <div className="flex flex-col gap-1.5">
          {PRIMARY.map((s) => (
            <StatRow
              key={s.key}
              label={s.label}
              value={primaryValue[s.key]}
              action={apButton(s.key)}
            />
          ))}
          <StatRow label="HP" value={primaryValue.HP} action={apButton("HP")} />
          <StatRow label="MP" value={primaryValue.MP} action={apButton("MP")} />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-2 h-7 w-full text-xs"
          disabled={!hasAp}
          onClick={() => actions?.autoAssignAp()}
        >
          Auto-assign AP
        </Button>

        <Separator className="my-3" />

        {/* Derived stats */}
        <div className="flex flex-col gap-1">
          {derivedRows.map(([label, value]) => (
            <StatRow key={label} label={label} value={value} />
          ))}
        </div>

        <Separator className="my-3" />

        <StatRow label="Fame" value={c.fame} />

        <Separator className="my-3" />

        {/* Titles */}
        <p className="text-[11px] font-bold text-foreground">Title</p>
        <p className="mt-1 text-[11px]" style={{ color: c.equippedTitle ? "#facc15" : undefined }}>
          {c.equippedTitle || "(none)"}
        </p>
        {c.equippedTitle && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-6 px-2 text-[10px]"
            onClick={() => actions?.equipTitle("")}
          >
            Unequip
          </Button>
        )}
        <div className="mt-1.5 flex flex-col gap-1">
          {c.ownedTitles.map((t) => {
            const isEquipped = t === c.equippedTitle;
            return (
              <div key={t} className="flex items-center justify-between gap-2 text-[10px]">
                <span style={{ color: isEquipped ? "#facc15" : undefined }}>
                  {isEquipped ? "✦ " : ""}
                  {t}
                </span>
                {!isEquipped && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-5 px-2 text-[10px]"
                    onClick={() => actions?.equipTitle(t)}
                  >
                    Equip
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Panel>
  );
}
