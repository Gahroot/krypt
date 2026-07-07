/**
 * Inventory — MapleStory-parity tabbed inventory system.
 *
 * Replaces the flat defId list with four tabs: EQUIP, USE, ETC, CASH.
 * Equips are non-stackable (each gets a unique uid + rolled ItemInstance).
 * Consumables and materials stack up to a per-tab max.
 *
 * Pure data + pure functions — same as everything in @maple/shared.
 */

import { ITEMS } from "./items.js";
import { CONSUMABLES } from "./consumables.js";
import { CASH_ITEMS } from "./cashshop.js";
import { AMMO } from "./items.js";

// ─── Tab & Slot types ──────────────────────────────────────────────────────

export type InventoryTab = "EQUIP" | "USE" | "ETC" | "CASH";

export interface Slot {
  /** Item definition id (e.g. "wpn.bronze_shortsword", "pot.small_hp"). */
  readonly defId: string;
  /** Unique instance id — only set for equips (non-stackable). */
  readonly uid?: string;
  /** Quantity. For equips this is always 1; for stackable items it may be > 1. */
  readonly qty: number;
}

export type Inventory = Record<InventoryTab, readonly (Slot | null)[]>;

// ─── Per-tab capacity & max stack ──────────────────────────────────────────

/** Default number of slots per tab. */
export const TAB_CAPACITY: Record<InventoryTab, number> = {
  EQUIP: 24,
  USE: 24,
  ETC: 24,
  CASH: 24,
};

/** Max stack size per tab. Equips are always qty 1 (non-stackable). */
export const MAX_STACK: Record<InventoryTab, number> = {
  EQUIP: 1,
  USE: 200,
  ETC: 200,
  CASH: 1,
};

// ─── Tab routing ───────────────────────────────────────────────────────────

/**
 * Determine which inventory tab an item belongs to based on its defId.
 * Equips → EQUIP, consumables → USE, cash items → CASH, everything else → ETC.
 */
export function tabForItem(defId: string): InventoryTab {
  if (defId in ITEMS) return "EQUIP";
  if (defId in CONSUMABLES) return "USE";
  if (defId in AMMO) return "USE";
  if (defId in CASH_ITEMS) return "CASH";
  return "ETC";
}

// ─── Inventory factory ─────────────────────────────────────────────────────

/** Create an empty inventory with all tabs set to their default capacity. */
export function createInventory(): Inventory {
  return {
    EQUIP: Array.from({ length: TAB_CAPACITY.EQUIP }, (): Slot | null => null),
    USE: Array.from({ length: TAB_CAPACITY.USE }, (): Slot | null => null),
    ETC: Array.from({ length: TAB_CAPACITY.ETC }, (): Slot | null => null),
    CASH: Array.from({ length: TAB_CAPACITY.CASH }, (): Slot | null => null),
  };
}

// ─── Result type ───────────────────────────────────────────────────────────

export interface InventoryResult {
  readonly ok: boolean;
  /** Remaining qty that couldn't fit (0 when fully absorbed). */
  readonly remaining: number;
  /** Human-readable reason when ok is false. */
  readonly reason?: string;
}

const OK: InventoryResult = { ok: true, remaining: 0 };

// ─── Pure helpers ──────────────────────────────────────────────────────────

/**
 * Add an item to the inventory.
 *
 * For stackable tabs (USE, ETC), existing partial stacks are filled first, then
 * empty slots are used. Any quantity that exceeds all available slots is returned
 * as `remaining`.
 *
 * For non-stackable tabs (EQUIP, CASH), a uid MUST be provided. Each unit
 * occupies one slot. Returns `remaining` if there aren't enough empty slots.
 *
 * @param inv  The inventory to add to (not mutated — returns a new Inventory).
 * @param defId  The item definition id.
 * @param qty  How many to add (must be ≥ 1).
 * @param uid  Optional uid for non-stackable items (equips / cash).
 */
export function addItem(
  inv: Inventory,
  defId: string,
  qty: number,
  uid?: string,
): { inv: Inventory; result: InventoryResult } {
  if (qty < 1) return { inv, result: { ok: false, remaining: 0, reason: "qty must be ≥ 1" } };

  const tab = tabForItem(defId);
  const maxStack = MAX_STACK[tab];
  const slots = [...(inv[tab] as readonly (Slot | null)[])];
  let remaining = qty;

  // ── Equips / Cash: non-stackable, each unit = one slot ──────────────
  if (maxStack === 1) {
    for (let i = 0; i < slots.length && remaining > 0; i++) {
      if (slots[i] === null) {
        const newSlot: Slot = { defId, uid: uid ?? defId, qty: 1 };
        slots[i] = newSlot;
        remaining--;
      }
    }
    if (remaining > 0) {
      return {
        inv: { ...inv, [tab]: [...slots] },
        result: { ok: false, remaining, reason: `${tab} tab is full` },
      };
    }
    return {
      inv: { ...inv, [tab]: [...slots] },
      result: OK,
    };
  }

  // ── Stackable (USE, ETC): fill existing partial stacks first ────────
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const s: Slot | null = slots[i] ?? null;
    if (s !== null && s.defId === defId && s.qty < maxStack) {
      const space = maxStack - s.qty;
      const toAdd = Math.min(space, remaining);
      const updated: Slot = { defId: s.defId, qty: s.qty + toAdd };
      slots[i] = updated;
      remaining -= toAdd;
    }
  }

  // ── Then fill empty slots ──────────────────────────────────────────
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    if (slots[i] === null) {
      const toAdd = Math.min(maxStack, remaining);
      const newSlot: Slot = { defId, qty: toAdd };
      slots[i] = newSlot;
      remaining -= toAdd;
    }
  }

  if (remaining > 0) {
    return {
      inv: { ...inv, [tab]: [...slots] },
      result: {
        ok: false,
        remaining,
        reason: `${tab} tab has no space for ${remaining} × ${defId}`,
      },
    };
  }

  return {
    inv: { ...inv, [tab]: [...slots] },
    result: OK,
  };
}

/**
 * Remove quantity of an item from the inventory.
 * Scans from the first matching slot backward; partial removal works across stacks.
 * For non-stackable items (equips/cash), removes by uid if provided, otherwise by defId.
 *
 * @returns The updated inventory and whether the removal succeeded.
 */
export function removeItem(
  inv: Inventory,
  defId: string,
  qty: number,
  uid?: string,
): { inv: Inventory; ok: boolean } {
  if (qty < 1) return { inv, ok: false };

  const tab = tabForItem(defId);
  const slots = [...(inv[tab] as readonly (Slot | null)[])];
  let remaining = qty;

  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const s: Slot | null = slots[i] ?? null;
    if (s === null || s.defId !== defId) continue;
    // For non-stackable items, match uid if provided
    if (MAX_STACK[tab] === 1 && uid !== undefined && s.uid !== uid) continue;
    const toRemove = Math.min(s.qty, remaining);
    if (toRemove === s.qty) {
      slots[i] = null;
    } else {
      const updated: Slot = { defId: s.defId, uid: s.uid, qty: s.qty - toRemove };
      slots[i] = updated;
    }
    remaining -= toRemove;
  }

  if (remaining > 0) return { inv, ok: false };

  return { inv: { ...inv, [tab]: [...slots] }, ok: true };
}

/**
 * Swap two slots within the same inventory (can be across tabs).
 * Both source and target must be valid indices.
 */
export function moveSlot(
  inv: Inventory,
  fromTab: InventoryTab,
  fromIdx: number,
  toTab: InventoryTab,
  toIdx: number,
): Inventory {
  const fromSlots = [...(inv[fromTab] as readonly (Slot | null)[])];
  const toSlots = fromTab === toTab ? fromSlots : [...(inv[toTab] as readonly (Slot | null)[])];

  const fromSlot: Slot | null = fromSlots[fromIdx] ?? null;
  const toSlot: Slot | null = toSlots[toIdx] ?? null;

  fromSlots[fromIdx] = toSlot;
  toSlots[toIdx] = fromSlot;

  if (fromTab === toTab) {
    return { ...inv, [fromTab]: [...fromSlots] };
  }
  return { ...inv, [fromTab]: [...fromSlots], [toTab]: [...toSlots] };
}

/**
 * Split a stack into two slots within the same tab.
 * Moves `splitQty` from the source slot to the first empty slot in that tab.
 * If the tab is full, returns the inventory unchanged.
 */
export function splitStack(
  inv: Inventory,
  tab: InventoryTab,
  sourceIdx: number,
  splitQty: number,
): Inventory {
  const slots = [...(inv[tab] as readonly (Slot | null)[])];
  const source: Slot | null = slots[sourceIdx] ?? null;

  if (source === null || source.qty <= splitQty || splitQty < 1) return inv;

  // Find first empty slot
  const emptyIdx = slots.indexOf(null);
  if (emptyIdx === -1) return inv; // tab full

  const reduced: Slot = { defId: source.defId, uid: source.uid, qty: source.qty - splitQty };
  const split: Slot = { defId: source.defId, qty: splitQty };
  slots[sourceIdx] = reduced;
  slots[emptyIdx] = split;

  return { ...inv, [tab]: [...slots] };
}

/**
 * Sort items within a slot array: non-null slots by defId ascending,
 * then qty descending (bigger stacks first), with nulls pushed to the end.
 * Returns a NEW array — does not mutate the input.
 */
export function sortSlotArray(slots: readonly (Slot | null)[]): (Slot | null)[] {
  const nonNull: Slot[] = [];
  for (const s of slots) {
    if (s !== null) nonNull.push(s);
  }
  nonNull.sort((a, b) => {
    const defCmp = a.defId.localeCompare(b.defId);
    if (defCmp !== 0) return defCmp;
    return b.qty - a.qty;
  });
  const result: (Slot | null)[] = [...nonNull];
  while (result.length < slots.length) result.push(null);
  return result;
}

/**
 * Find the first slot matching a defId (and optional uid).
 * Returns { tab, idx, slot } or null.
 */
export function findItem(
  inv: Inventory,
  defId: string,
  uid?: string,
): { tab: InventoryTab; idx: number; slot: Slot } | null {
  const tabs: InventoryTab[] = ["EQUIP", "USE", "ETC", "CASH"];
  for (const tab of tabs) {
    const slots = inv[tab];
    for (let i = 0; i < slots.length; i++) {
      const s: Slot | null = slots[i] ?? null;
      if (s === null || s.defId !== defId) continue;
      if (uid !== undefined && s.uid !== uid) continue;
      return { tab, idx: i, slot: s };
    }
  }
  return null;
}
