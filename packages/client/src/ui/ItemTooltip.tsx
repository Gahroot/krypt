import {
  getItemDef,
  getBaseRankInfo,
  getPotentialTierInfo,
  canEquip,
  starForceAtkBonus,
  starForceStatBonus,
  SETS,
  type BaseRank,
  type PotentialTier,
  type PotentialLine,
  type BonusStatLine,
  type CharacterStats,
  type ClassArchetype,
} from "@maple/shared";

import { Separator } from "@/ui/components/ui/separator";
import type { InvItemSnapshot, PlayerSnapshot } from "@/ui/store";

const RED = "#ef4444";
const FLAME = "#84cc16";
const GOLD = "#f59e0b";

function parseJson<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Rich item tooltip — a faithful React port of UIScene.showItemTooltip. Shows
 * star force, name (rank color), potential tier, requirements (red when unmet),
 * base stats, rolled potential / flame lines, and set membership + bonuses.
 */
export function ItemTooltip({
  item,
  player,
  equippedDefIds,
}: {
  item: InvItemSnapshot;
  player: PlayerSnapshot | null;
  equippedDefIds: string[];
}) {
  const def = getItemDef(item.defId);
  if (!def) return <div className="text-muted-foreground">{item.defId}</div>;

  const rankInfo = getBaseRankInfo(item.baseRank as BaseRank);
  const tierInfo = getPotentialTierInfo(item.potentialTier as PotentialTier);
  const potLines = parseJson<PotentialLine>(item.potentialLines);
  const bonusLines = parseJson<BonusStatLine>(item.bonusStats);

  const stars = item.stars ?? 0;
  const starStr =
    stars > 0 ? "\u2605".repeat(stars) + "\u2606".repeat(Math.max(0, 15 - stars)) : "";
  const starColor = stars >= 12 ? GOLD : stars >= 5 ? "#3b82f6" : "#a1a1aa";

  const equipCtx = player
    ? {
        level: player.level,
        stats: {
          STR: player.str,
          DEX: player.dex,
          INT: player.intel,
          LUK: player.luk,
          HP: player.hp,
          MP: player.mp,
        } as CharacterStats,
        archetype: player.archetype as ClassArchetype,
      }
    : null;
  const equipCheck = equipCtx ? canEquip(def, equipCtx) : null;

  const reqs: { label: string; have: number; need: number }[] = [];
  if (player) {
    if (def.reqStr !== undefined) reqs.push({ label: "STR", have: player.str, need: def.reqStr });
    if (def.reqDex !== undefined) reqs.push({ label: "DEX", have: player.dex, need: def.reqDex });
    if (def.reqInt !== undefined) reqs.push({ label: "INT", have: player.intel, need: def.reqInt });
    if (def.reqLuk !== undefined) reqs.push({ label: "LUK", have: player.luk, need: def.reqLuk });
  }

  const statParts: string[] = [];
  if (def.baseAttack > 0) statParts.push(`ATK ${def.baseAttack}`);
  if (def.baseStatBonus > 0) statParts.push(`${def.primaryStat} +${def.baseStatBonus}`);
  if (def.wDef) statParts.push(`WDef ${def.wDef}`);
  if (def.mDef) statParts.push(`MDef ${def.mDef}`);
  if (def.speed) statParts.push(`Spd ${def.speed > 0 ? "+" : ""}${def.speed}`);
  if (def.hpBonus) statParts.push(`HP +${def.hpBonus}`);
  if (def.mpBonus) statParts.push(`MP +${def.mpBonus}`);

  const sfParts: string[] = [];
  if (stars > 0) {
    const sfAtk = starForceAtkBonus(stars);
    const sfStat = starForceStatBonus(stars);
    if (sfAtk > 0) sfParts.push(`ATK +${sfAtk}`);
    if (sfStat > 0) sfParts.push(`${def.primaryStat} +${sfStat}`);
  }

  const set = def.setId ? SETS.find((s) => s.id === def.setId) : undefined;
  const wornInSet = set ? equippedDefIds.filter((d) => set.pieceDefIds.includes(d)).length : 0;

  return (
    <div className="flex min-w-[200px] flex-col gap-1 leading-tight">
      {starStr && (
        <div className="text-[10px] tracking-tight" style={{ color: starColor }}>
          {starStr}
        </div>
      )}

      <div className="text-sm font-bold" style={{ color: rankInfo.color }}>
        {rankInfo.label !== "Normal" && (
          <span
            className="mr-1 inline-flex size-4 items-center justify-center rounded-sm bg-black/50 text-[8px] font-bold"
            style={{ color: rankInfo.color }}
          >
            {rankInfo.label.charAt(0)}
          </span>
        )}
        {def.name}
      </div>

      <div className="text-[11px] font-semibold" style={{ color: tierInfo.color }}>
        {tierInfo.label} Potential · {item.lines} {item.lines === 1 ? "line" : "lines"}
      </div>

      {equipCheck && !equipCheck.ok && (
        <div className="text-[11px] font-bold" style={{ color: RED }}>
          ⛔ UNUSABLE
        </div>
      )}

      <Separator className="my-1" />

      {player && (
        <div
          className="text-[11px]"
          style={{ color: player.level >= def.levelReq ? undefined : RED }}
        >
          Lv. {def.levelReq} Required
        </div>
      )}

      {reqs.map((r) => (
        <div
          key={r.label}
          className="text-[11px] text-muted-foreground"
          style={{ color: r.have >= r.need ? undefined : RED }}
        >
          {r.label} {r.need} (have {r.have})
        </div>
      ))}

      {def.classReq && def.classReq.length > 0 && (
        <div
          className="text-[11px] text-muted-foreground"
          style={{
            color:
              !player || def.classReq.includes(player.archetype as ClassArchetype)
                ? undefined
                : RED,
          }}
        >
          Class: {def.classReq.join(", ")}
        </div>
      )}

      {statParts.length > 0 && (
        <>
          <Separator className="my-1" />
          <div className="text-[11px] font-medium">{statParts.join("  ")}</div>
        </>
      )}

      {sfParts.length > 0 && (
        <div className="text-[11px]" style={{ color: GOLD }}>
          {sfParts.join("  ")}
        </div>
      )}

      {potLines.length > 0 && (
        <>
          <Separator className="my-1" />
          {potLines.map((pl, i) => (
            <div key={i} className="text-[11px]" style={{ color: tierInfo.color }}>
              +{pl.percent}% {pl.stat}
            </div>
          ))}
        </>
      )}

      {bonusLines.length > 0 && (
        <>
          <Separator className="my-1" />
          {bonusLines.map((bl, i) => (
            <div key={i} className="text-[11px]" style={{ color: FLAME }}>
              +{bl.value} {bl.stat}
              {bl.tier !== "NORMAL" ? ` (${bl.tier})` : ""}
            </div>
          ))}
        </>
      )}

      {set && (
        <>
          <Separator className="my-1" />
          <div className="text-[11px] font-bold text-primary">
            ⚔ {set.name} Set ({wornInSet}/{set.pieceDefIds.length})
          </div>
        </>
      )}
    </div>
  );
}
