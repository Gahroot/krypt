/**
 * Shared UI fixtures — realistic, serializable panel snapshots.
 *
 * Authored once and reused by BOTH harnesses so what the unit tests render is
 * exactly what the screenshot harness captures:
 *   - Vitest + React Testing Library  (src/ui/__tests__/*.test.tsx)
 *   - the Playwright screenshot harness (scripts/ui-screenshots.ts)
 *
 * Everything here is a plain, serializable snapshot — the same "snapshot-in"
 * shape Phaser pushes through the bridge store (see ../store/inventory.ts). That
 * is what lets the screenshot harness ship these objects straight into the
 * dev-only `window.__uiStore` via `page.evaluate`.
 *
 * defIds, BaseRank and PotentialTier values are real `@maple/shared` data so the
 * panels resolve genuine item names, rarity border colors and rank label colors.
 */
import { BaseRank, PotentialTier } from "@maple/shared";

import type { InvItemSnapshot, InventorySnapshot, PlayerSnapshot } from "@/ui/store";

/** A mid-game sample player used to drive equip-requirement checks in tooltips. */
export const samplePlayer: PlayerSnapshot = {
  level: 60,
  str: 180,
  dex: 45,
  intel: 30,
  luk: 40,
  hp: 4200,
  mp: 1500,
  archetype: "WARRIOR",
};

/** Helper: build an EQUIP-tab snapshot with one rolled potential + flame line. */
function equip(
  uid: string,
  defId: string,
  baseRank: BaseRank,
  potentialTier: PotentialTier,
  stars: number,
): InvItemSnapshot {
  return {
    uid,
    defId,
    baseRank,
    potentialTier,
    lines: 2,
    potentialLines: JSON.stringify([
      { stat: "STR", percent: 9 },
      { stat: "ATK", percent: 6 },
    ]),
    bonusStats: JSON.stringify([{ stat: "STR", value: 12, tier: "EPIC" }]),
    stars,
    count: 1,
  };
}

/** Helper: build a stackable USE/ETC/CASH snapshot (no rarity rolls). */
function stack(uid: string, defId: string, count: number): InvItemSnapshot {
  return {
    uid,
    defId,
    baseRank: BaseRank.NORMAL,
    potentialTier: PotentialTier.RARE,
    lines: 0,
    potentialLines: "[]",
    bonusStats: "[]",
    stars: 0,
    count,
  };
}

/**
 * The reference inventory snapshot. Spans every tab and exercises all four
 * BaseRank name-colors and all four PotentialTier border-colors so the rendered
 * panel shows the full rarity palette.
 */
export const inventorySnapshot: InventorySnapshot = {
  buckets: {
    EQUIP: [
      // NORMAL / RARE → grey name, blue border
      equip("eq-1", "wpn.ember_wand", BaseRank.NORMAL, PotentialTier.RARE, 0),
      // ENHANCED / EPIC → blue name, purple border
      equip("eq-2", "hat.leather_cap", BaseRank.ENHANCED, PotentialTier.EPIC, 5),
      // STARFORGED / UNIQUE → purple name, amber border
      equip("eq-3", "wpn.iron_broadsword", BaseRank.STARFORGED, PotentialTier.UNIQUE, 10),
      // MYTHIC / LEGENDARY → red name, green border (the god roll)
      equip("eq-4", "wpn.bronze_shortsword", BaseRank.MYTHIC, PotentialTier.LEGENDARY, 15),
    ],
    USE: [stack("use-1", "con.hp_potion_s", 50), stack("use-2", "con.mp_potion_s", 30)],
    ETC: [stack("etc-1", "etc.snail_shell", 99), stack("etc-2", "etc.slime_jelly", 12)],
    CASH: [stack("cash-1", "cash_outfit_phoenix_robe", 1)],
  },
  mesos: 1_250_000,
  player: samplePlayer,
  equippedDefIds: ["wpn.bronze_shortsword"],
};

/**
 * A single store mutation expressed as a serializable instruction.
 * `method` is a bridge-store setter name; `args` are passed straight to it.
 * Serializable so the screenshot harness can ship it into `window.__uiStore`
 * via `page.evaluate`.
 */
export interface StoreSeed {
  method: string;
  args: unknown[];
}

/** A panel the screenshot harness can seed, render and capture. */
export interface PanelFixture {
  /** Stable id — also the PNG filename stem. */
  id: string;
  /** Human-readable label for logs. */
  label: string;
  /** Store setter calls applied (in order) before capture. */
  seed: StoreSeed[];
  /** CSS selector that must be present once the panel has rendered. */
  ready: string;
}

/**
 * The registry the screenshot harness iterates. Add a panel here (with its
 * fixture snapshot + open setter + a ready selector) and it is captured
 * automatically. Inventory is the reference entry.
 */
export const panelFixtures: PanelFixture[] = [
  {
    id: "inventory",
    label: "Inventory",
    seed: [
      { method: "setInventory", args: [inventorySnapshot] },
      { method: "setInventoryOpen", args: [true] },
    ],
    ready: '[data-slot="item-grid"]',
  },
];
