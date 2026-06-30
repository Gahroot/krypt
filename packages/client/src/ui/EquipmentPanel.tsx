import {
  getItemDef,
  getBaseRankInfo,
  getPotentialTierInfo,
  type BaseRank,
  type PotentialTier,
} from "@maple/shared";

import { Panel } from "@/ui/components/Panel";
import { ItemCell } from "@/ui/components/ItemCell";
import { PaperDoll } from "@/ui/components/PaperDoll";
import { TooltipProvider } from "@/ui/components/ui/tooltip";
import { ItemTooltip } from "@/ui/ItemTooltip";
import {
  useUIStore,
  type EquipSlotSnapshot,
  type InvItemSnapshot,
  type PlayerSnapshot,
} from "@/ui/store";

/**
 * EquipmentPanel — the equipped-gear paper-doll window (toggled with E).
 *
 * React port of the hand-drawn Phaser `buildEquipPanel` / `renderEquipPanel`.
 * Reuses the shared `ItemCell` + `ItemTooltip` from the inventory work for each
 * worn slot and the `PaperDoll` for a live character preview. Unequipping flows
 * through `characterActions.unequip`, wired to the authoritative UNEQUIP_ITEM
 * message. Empty slots render a dashed cell with the slot name.
 */

/** Slot label shown beneath each cell (classic MapleStory wording). */
function slotLabel(slot: string): string {
  return slot.replace(/_/g, " ");
}

function EquipCell({
  slot,
  item,
  player,
  equippedDefIds,
  onUnequip,
}: {
  slot: string;
  item: InvItemSnapshot | null;
  player: PlayerSnapshot | null;
  equippedDefIds: string[];
  onUnequip: () => void;
}) {
  const def = item ? getItemDef(item.defId) : undefined;
  const label = item ? (def?.name ?? item.defId) : undefined;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <ItemCell
        className="w-full"
        label={label}
        borderColor={
          item ? getPotentialTierInfo(item.potentialTier as PotentialTier).color : undefined
        }
        labelColor={item ? getBaseRankInfo(item.baseRank as BaseRank).color : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          if (item) onUnequip();
        }}
        onDoubleClick={() => {
          if (item) onUnequip();
        }}
        tooltip={
          item ? (
            <ItemTooltip item={item} player={player} equippedDefIds={equippedDefIds} />
          ) : undefined
        }
      />
      <span className="text-[8px] text-muted-foreground">{slotLabel(slot)}</span>
    </div>
  );
}

export function EquipmentPanel() {
  const open = useUIStore((s) => s.equipmentOpen);
  const character = useUIStore((s) => s.character);
  const equipment = useUIStore((s) => s.equipment);
  const actions = useUIStore((s) => s.characterActions);

  if (!open || !character) return null;

  const player: PlayerSnapshot = {
    level: character.level,
    str: character.str,
    dex: character.dex,
    intel: character.intel,
    luk: character.luk,
    hp: character.hp,
    mp: character.mp,
    archetype: character.archetype,
  };
  const equippedDefIds = equipment
    .filter((s): s is EquipSlotSnapshot & { item: InvItemSnapshot } => !!s.item)
    .map((s) => s.item.defId);

  return (
    <TooltipProvider delayDuration={120}>
      <Panel
        title="Equipment"
        hotkey="E"
        onClose={() => actions?.closeEquipment()}
        className="absolute top-[52px] right-4 w-[300px]"
      >
        <div className="flex gap-3">
          {/* Left column of slots */}
          <div className="grid w-[88px] shrink-0 grid-cols-2 gap-1">
            {equipment.slice(0, 11).map((s) => (
              <EquipCell
                key={s.slot}
                slot={s.slot}
                item={s.item}
                player={player}
                equippedDefIds={equippedDefIds}
                onUnequip={() => actions?.unequip(s.slot)}
              />
            ))}
          </div>

          {/* Character preview */}
          <div className="flex flex-1 items-center justify-center rounded-lg border border-border bg-card/40">
            <PaperDoll appearance={character.appearance} className="scale-90" />
          </div>

          {/* Right column of slots */}
          <div className="grid w-[88px] shrink-0 grid-cols-2 gap-1">
            {equipment.slice(11).map((s) => (
              <EquipCell
                key={s.slot}
                slot={s.slot}
                item={s.item}
                player={player}
                equippedDefIds={equippedDefIds}
                onUnequip={() => actions?.unequip(s.slot)}
              />
            ))}
          </div>
        </div>

        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Double-click or right-click a slot to unequip.
        </p>
      </Panel>
    </TooltipProvider>
  );
}
