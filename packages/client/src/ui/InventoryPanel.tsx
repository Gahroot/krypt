import { useState } from "react";
import {
  getItemDef,
  getBaseRankInfo,
  getPotentialTierInfo,
  type InventoryTab,
  type BaseRank,
  type PotentialTier,
} from "@maple/shared";

import { Tabs, TabsList, TabsTrigger } from "@/ui/components/ui/tabs";
import { TooltipProvider } from "@/ui/components/ui/tooltip";
import { Panel } from "@/ui/components/Panel";
import { ItemGrid } from "@/ui/components/ItemGrid";
import { ItemCell } from "@/ui/components/ItemCell";
import { CurrencyDisplay } from "@/ui/components/CurrencyDisplay";
import { ItemTooltip } from "@/ui/ItemTooltip";
import { useUIStore, type InvItemSnapshot } from "@/ui/store";

/**
 * InventoryPanel — the REFERENCE overlay panel.
 *
 * This is the canonical example every new panel is copied from. Note the shape:
 *   1. read a snapshot + the action registry from the bridge store (`useUIStore`)
 *   2. bail when closed (`if (!open) return null`)
 *   3. render with the shared kit only (Panel / ItemGrid / ItemCell / …)
 *   4. drive the game exclusively through `actions.*` (never touch Phaser)
 *
 * It is also the reference for RESPONSIVE ANCHORING: the panel is pinned to a
 * viewport corner with the clamp()-based HUD tokens
 * (`fixed top-[var(--hud-top)] right-[var(--hud-edge)]`) rather than magic pixel
 * offsets, so it keeps a comfortable gutter from ~1280px up to large displays
 * and survives window resize. Width comes from the `--panel-w` token and the
 * body scrolls internally past `--panel-max-h` — both handled by `Panel`. See
 * src/ui/README.md → "Adding a new panel" and "Responsive anchoring".
 */

const TABS: InventoryTab[] = ["EQUIP", "USE", "ETC", "CASH"];
const GRID_SLOTS = 24; // 6 cols × 4 rows, matching the legacy panel.

export function InventoryPanel() {
  const open = useUIStore((s) => s.inventoryOpen);
  const inventory = useUIStore((s) => s.inventory);
  const actions = useUIStore((s) => s.actions);
  const [tab, setTab] = useState<InventoryTab>("EQUIP");

  if (!open) return null;

  const items = inventory.buckets[tab] ?? [];

  const activate = (item: InvItemSnapshot) => {
    if (tab === "EQUIP") actions?.equip(item.uid);
    else if (tab === "USE") actions?.use(item.defId);
  };

  return (
    <TooltipProvider delayDuration={120}>
      <Panel
        title="Inventory"
        hotkey="I"
        onClose={() => actions?.close()}
        className="fixed top-[var(--hud-top)] right-[var(--hud-edge)]"
        headerExtra={
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {items.length} / {GRID_SLOTS}
          </span>
        }
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as InventoryTab)}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <ItemGrid
          items={items}
          slots={GRID_SLOTS}
          cols={6}
          className="mt-3"
          renderCell={(item) => {
            if (!item) return <ItemCell />;
            const def = getItemDef(item.defId);
            return (
              <ItemCell
                key={item.uid}
                label={def?.name ?? item.defId}
                borderColor={getPotentialTierInfo(item.potentialTier as PotentialTier).color}
                labelColor={getBaseRankInfo(item.baseRank as BaseRank).color}
                count={tab !== "EQUIP" ? item.count : undefined}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/uid", item.uid)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = e.dataTransfer.getData("text/uid");
                  if (from && from !== item.uid) actions?.reorder(tab, from, item.uid);
                }}
                onDoubleClick={() => activate(item)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  activate(item);
                }}
                tooltip={
                  <ItemTooltip
                    item={item}
                    player={inventory.player}
                    equippedDefIds={inventory.equippedDefIds}
                  />
                }
              />
            );
          }}
        />

        <div className="mt-3 flex items-center justify-end border-t border-border pt-2.5">
          <CurrencyDisplay amount={inventory.mesos} label="mesos" />
        </div>
      </Panel>
    </TooltipProvider>
  );
}
