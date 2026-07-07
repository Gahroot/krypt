import { Plus } from "lucide-react";
import { deriveSecondary, DAMAGE_FLOOR, DAMAGE_CEIL } from "@maple/shared";

import { DraggableWindow } from "@/ui/components/DraggableWindow";
import { StatRow } from "@/ui/components/StatRow";
import { Button } from "@/ui/components/ui/button";
import { Progress } from "@/ui/components/ui/progress";
import { Separator } from "@/ui/components/ui/separator";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { useUIStore, type StatKey } from "@/ui/store";

/**
 * StatsPanel — the complete character sheet (toggled with S).
 *
 * Shows base + derived stats with gear/buff/set/passive contribution breakdowns
 * that match the server's combat math. Derived stats use the same
 * `deriveSecondary` function the authoritative server calls, fed with the
 * same totalStats / equipBonus / effectBonus decomposition.
 */

const PRIMARY: { key: StatKey; label: string }[] = [
  { key: "STR", label: "STR" },
  { key: "DEX", label: "DEX" },
  { key: "INT", label: "INT" },
  { key: "LUK", label: "LUK" },
];

/** Format bonus as " +N" only if non-zero, for inline annotation */
function gearBonus(n: number): string {
  return n !== 0 ? ` +${n}` : "";
}

export function StatsPanel() {
  const open = useUIStore((s) => s.statPanelOpen);
  const character = useUIStore((s) => s.character);
  const actions = useUIStore((s) => s.characterActions);

  if (!open || !character) return null;

  const c = character;
  const hasAp = c.ap > 0;

  // ── Primary stat totals (base AP-allocated + gear + set) ────────
  const totalStr = c.str + c.equipBonus.str + c.setBonus.STR;
  const totalDex = c.dex + c.equipBonus.dex + c.setBonus.DEX;
  const totalInt = c.intel + c.equipBonus.int + c.setBonus.INT;
  const totalLuk = c.luk + c.equipBonus.luk + c.setBonus.LUK;
  const totalHp = c.maxHp;
  const totalMp = c.maxMp;

  // ── Base secondary stats (from total primary stats alone) ────────
  const totalStats = {
    STR: totalStr,
    DEX: totalDex,
    INT: totalInt,
    LUK: totalLuk,
    HP: c.hp,
    MP: c.mp,
  };
  const baseDerived = deriveSecondary(totalStats, c.primaryStat);

  // ── Derived stats are precomputed in the snapshot (matches server) ──
  const d = c.derived;

  // ── Breakdown annotations for secondary stats ───────────────────
  // Gear contribution includes equipment ATK + set secondary ATK (merged in UIScene)
  // so we show: base (from stats) + [gear+set combined] + passive + buff
  const gearSetAtk = d.atk - baseDerived.atk - c.passiveBonus.atk - c.buffBonus.atk;
  const gearSetMAtk = d.mAtk - baseDerived.mAtk - c.passiveBonus.mAtk - c.buffBonus.mAtk;

  // ── EXP ─────────────────────────────────────────────────────────
  const expRatio = c.expNeed > 0 ? c.exp / c.expNeed : 0;
  const expToNext = c.expNeed - c.exp;

  // ── Damage range (basic attack: 100% skill, 1 hit, before defense) ──
  const levelScale = 1 + c.level * 0.005;
  const basePower = d.atk + d.mAtk;
  const minDmg = Math.max(1, Math.floor(basePower * DAMAGE_FLOOR * levelScale));
  const maxDmg = Math.max(minDmg, Math.floor(basePower * DAMAGE_CEIL * levelScale));

  // ── AP button helper ────────────────────────────────────────────
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

  // ── Primary stat row with gear/set breakdown ────────────────────
  const primaryRow = (label: string, base: number, gear: number, set: number, key: StatKey) => {
    const total = base + gear + set;
    const parts: string[] = [];
    parts.push(`${base}`);
    if (gear !== 0) parts.push(`gear${gear > 0 ? "+" : ""}${gear}`);
    if (set !== 0) parts.push(`set+${set}`);
    const annotation = parts.length > 1 ? ` (${parts.join(" ")})` : "";
    return (
      <StatRow key={key} label={label} value={`${total}${annotation}`} action={apButton(key)} />
    );
  };

  return (
    <DraggableWindow
      title={c.name || "Adventurer"}
      hotkey="S"
      onClose={() => actions?.closeStatPanel()}
      defaultPosition={{ x: 24, y: 72 }}
      headerExtra={<span className="text-[10px] font-medium text-primary">{c.jobTitle}</span>}
    >
      <ScrollArea className="max-h-[70vh] pr-2">
        {/* ── Level + AP ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-primary">Level {c.level}</span>
          <span className="text-[11px] font-bold text-primary tabular-nums">AP: {c.ap}</span>
        </div>

        {/* ── EXP bar ────────────────────────────────────────────── */}
        <div className="mt-2">
          <Progress
            value={Math.min(100, expRatio * 100)}
            className="h-2 [&_[data-slot=progress-indicator]]:bg-[#9ad06b]"
          />
          <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
            EXP {c.exp.toLocaleString()} / {c.expNeed.toLocaleString()} (
            {(expRatio * 100).toFixed(1)}%)
            {expToNext > 0 && (
              <span className="ml-1 opacity-60">({expToNext.toLocaleString()} to next)</span>
            )}
          </p>
        </div>

        <Separator className="my-3" />

        {/* ── Primary Stats (with gear/set breakdown + AP buttons) ── */}
        <p className="text-[11px] font-bold text-foreground mb-1">Stats</p>
        <div className="flex flex-col gap-1.5">
          {primaryRow("STR", c.str, c.equipBonus.str, c.setBonus.STR, "STR")}
          {primaryRow("DEX", c.dex, c.equipBonus.dex, c.setBonus.DEX, "DEX")}
          {primaryRow("INT", c.intel, c.equipBonus.int, c.setBonus.INT, "INT")}
          {primaryRow("LUK", c.luk, c.equipBonus.luk, c.setBonus.LUK, "LUK")}
          <StatRow label="HP" value={`${c.hp} / ${totalHp}`} action={apButton("HP")} />
          <StatRow label="MP" value={`${c.mp} / ${totalMp}`} action={apButton("MP")} />
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

        {/* ── Combat Stats (derived, with base/gear/passive/buff breakdown) ── */}
        <p className="text-[11px] font-bold text-foreground mb-1">Combat</p>
        <div className="flex flex-col gap-1">
          <StatRow
            label="ATK"
            value={
              <span>
                {d.atk}
                {gearSetAtk !== 0 && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    (base {baseDerived.atk}
                    {gearBonus(gearSetAtk)})
                  </span>
                )}
                {c.passiveBonus.atk !== 0 && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    +{c.passiveBonus.atk} pass
                  </span>
                )}
                {c.buffBonus.atk !== 0 && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    +{c.buffBonus.atk} buff
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="MATK"
            value={
              <span>
                {d.mAtk}
                {gearSetMAtk !== 0 && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    (base {baseDerived.mAtk}
                    {gearBonus(gearSetMAtk)})
                  </span>
                )}
                {c.passiveBonus.mAtk !== 0 && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    +{c.passiveBonus.mAtk} pass
                  </span>
                )}
                {c.buffBonus.mAtk !== 0 && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    +{c.buffBonus.mAtk} buff
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="Damage"
            value={
              <span className="text-foreground font-medium">
                {minDmg} – {maxDmg}
              </span>
            }
          />
          <StatRow
            label="WDEF"
            value={
              <span>
                {d.wDef}
                {baseDerived.wDef > 0 && d.wDef !== baseDerived.wDef && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    (base {baseDerived.wDef})
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="MDEF"
            value={
              <span>
                {d.mDef}
                {baseDerived.mDef > 0 && d.mDef !== baseDerived.mDef && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    (base {baseDerived.mDef})
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="Accuracy"
            value={
              <span>
                {d.accuracy}
                {baseDerived.accuracy > 0 && d.accuracy !== baseDerived.accuracy && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    (base {baseDerived.accuracy})
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="Avoid"
            value={
              <span>
                {d.avoid}
                {baseDerived.avoid > 0 && d.avoid !== baseDerived.avoid && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    (base {baseDerived.avoid})
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="Crit"
            value={
              <span>
                {(d.critRate * 100).toFixed(1)}%
                {baseDerived.critRate !== 0.05 && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    (base {(baseDerived.critRate * 100).toFixed(1)}%)
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="Speed"
            value={
              <span>
                {d.speed}
                {d.speed !== baseDerived.speed && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    (base {baseDerived.speed})
                  </span>
                )}
              </span>
            }
          />
          <StatRow
            label="Jump"
            value={
              <span>
                {d.jump}
                {d.jump !== baseDerived.jump && (
                  <span className="text-muted-foreground text-[10px]">
                    {" "}
                    (base {baseDerived.jump})
                  </span>
                )}
              </span>
            }
          />
        </div>

        <Separator className="my-3" />

        {/* ── Fame ────────────────────────────────────────────────── */}
        <StatRow label="Fame" value={c.fame} />

        <Separator className="my-3" />

        {/* ── Titles ──────────────────────────────────────────────── */}
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
    </DraggableWindow>
  );
}
