import { describe, it, expect } from "vitest";
import {
  type Inventory,
  type Slot,
  InventoryTab,
  TAB_CAPACITY,
  MAX_STACK,
  tabForItem,
  createInventory,
  addItem,
  removeItem,
  moveSlot,
  splitStack,
  findItem,
} from "../src/inventory.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

let nextUid = 1;
function uid(): string {
  return `uid-${String(nextUid++).padStart(3, "0")}`;
}

/** Count non-null slots in a tab. */
function countSlots(inv: Inventory, tab: InventoryTab): number {
  return inv[tab].filter((s) => s !== null).length;
}

/** Total qty across all slots matching a defId in a tab. */
function totalQty(inv: Inventory, tab: InventoryTab, defId: string): number {
  return inv[tab]
    .filter((s): s is Slot => s !== null && s.defId === defId)
    .reduce((sum, s) => sum + s.qty, 0);
}

// ─── Tab routing ────────────────────────────────────────────────────────────

describe("tabForItem", () => {
  it("routes equipment to EQUIP", () => {
    expect(tabForItem("wpn.bronze_shortsword")).toBe("EQUIP");
    expect(tabForItem("hat.leather_cap")).toBe("EQUIP");
    expect(tabForItem("ring.ember_band")).toBe("EQUIP");
  });

  it("routes consumables to USE", () => {
    expect(tabForItem("pot.small_hp")).toBe("USE");
    expect(tabForItem("con.hp_potion_s")).toBe("USE");
    expect(tabForItem("scroll.return")).toBe("USE");
    expect(tabForItem("buff.power_elixir")).toBe("USE");
  });

  it("routes cash items to CASH", () => {
    expect(tabForItem("cash_hair_rainbow")).toBe("CASH");
    expect(tabForItem("cash_pet_mini_dragon")).toBe("CASH");
  });

  it("routes unknown items to ETC", () => {
    expect(tabForItem("mat.slime_jelly")).toBe("ETC");
    expect(tabForItem("quest.old_letter")).toBe("ETC");
    expect(tabForItem("misc.anything")).toBe("ETC");
  });
});

// ─── Tab capacity & max stack ───────────────────────────────────────────────

describe("TAB_CAPACITY", () => {
  it("every tab has at least 24 slots", () => {
    for (const tab of ["EQUIP", "USE", "ETC", "CASH"] as InventoryTab[]) {
      expect(TAB_CAPACITY[tab]).toBeGreaterThanOrEqual(24);
    }
  });
});

describe("MAX_STACK", () => {
  it("EQUIP and CASH are non-stackable (max 1)", () => {
    expect(MAX_STACK.EQUIP).toBe(1);
    expect(MAX_STACK.CASH).toBe(1);
  });

  it("USE stacks to 100", () => {
    expect(MAX_STACK.USE).toBe(100);
  });

  it("ETC stacks to 200", () => {
    expect(MAX_STACK.ETC).toBe(200);
  });
});

// ─── createInventory ────────────────────────────────────────────────────────

describe("createInventory", () => {
  it("creates empty inventory with correct tab capacities", () => {
    const inv = createInventory();
    for (const tab of ["EQUIP", "USE", "ETC", "CASH"] as InventoryTab[]) {
      expect(inv[tab]).toHaveLength(TAB_CAPACITY[tab]);
      expect(inv[tab].every((s) => s === null)).toBe(true);
    }
  });
});

// ─── addItem — stacking up to max ───────────────────────────────────────────

describe("addItem — stacking", () => {
  it("stacks USE items up to max (100) in a single slot", () => {
    let inv = createInventory();
    const { inv: updated, result } = addItem(inv, "pot.small_hp", 50);
    inv = updated;
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(0);
    expect(totalQty(inv, "USE", "pot.small_hp")).toBe(50);
  });

  it("fills to 100 then overflows to a new slot", () => {
    let inv = createInventory();
    // Fill first slot to 80
    const r1 = addItem(inv, "pot.small_hp", 80);
    inv = r1.inv;
    expect(r1.result.ok).toBe(true);

    // Add 30 more → fills to 100 (absorbs 20), then 10 in second slot
    const r2 = addItem(inv, "pot.small_hp", 30);
    inv = r2.inv;
    expect(r2.result.ok).toBe(true);
    expect(totalQty(inv, "USE", "pot.small_hp")).toBe(110);

    // Verify two slots exist
    const matchingSlots = inv.USE.filter(
      (s): s is Slot => s !== null && s.defId === "pot.small_hp",
    );
    expect(matchingSlots.length).toBe(2);
    expect(matchingSlots[0]!.qty).toBe(100);
    expect(matchingSlots[1]!.qty).toBe(10);
  });

  it("stacks ETC items up to max (200)", () => {
    let inv = createInventory();
    const { inv: updated, result } = addItem(inv, "mat.slime_jelly", 150);
    inv = updated;
    expect(result.ok).toBe(true);
    expect(totalQty(inv, "ETC", "mat.slime_jelly")).toBe(150);
  });

  it("spills ETC overflow across multiple slots", () => {
    let inv = createInventory();
    const r1 = addItem(inv, "mat.slime_jelly", 200);
    inv = r1.inv;
    const r2 = addItem(inv, "mat.slime_jelly", 50);
    inv = r2.inv;
    expect(r2.result.ok).toBe(true);
    expect(totalQty(inv, "ETC", "mat.slime_jelly")).toBe(250);
    const matchingSlots = inv.ETC.filter(
      (s): s is Slot => s !== null && s.defId === "mat.slime_jelly",
    );
    expect(matchingSlots.length).toBe(2);
    expect(matchingSlots[0]!.qty).toBe(200);
    expect(matchingSlots[1]!.qty).toBe(50);
  });
});

// ─── addItem — overflow to new slot ─────────────────────────────────────────

describe("addItem — overflow", () => {
  it("returns remaining when tab is completely full", () => {
    let inv = createInventory();
    // Fill EQUIP tab (non-stackable) to capacity
    for (let i = 0; i < TAB_CAPACITY.EQUIP; i++) {
      const r = addItem(inv, "wpn.bronze_shortsword", 1, uid());
      inv = r.inv;
      expect(r.result.ok).toBe(true);
    }
    expect(countSlots(inv, "EQUIP")).toBe(TAB_CAPACITY.EQUIP);

    // Now try to add a new equip — should fail
    const { result } = addItem(inv, "hat.leather_cap", 1, uid());
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(1);
    expect(result.reason).toContain("EQUIP");
  });

  it("overflows only the excess, not the full qty", () => {
    let inv = createInventory();
    // Fill 23 of 24 EQUIP slots
    for (let i = 0; i < 23; i++) {
      const r = addItem(inv, "wpn.bronze_shortsword", 1, uid());
      inv = r.inv;
    }
    // Try adding 3 equips — only 1 slot left
    const { result } = addItem(inv, "wpn.bronze_shortsword", 3, uid());
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(2);
  });
});

// ─── addItem — capacity-full rejection ──────────────────────────────────────

describe("addItem — capacity-full rejection", () => {
  it("rejects adding to a full EQUIP tab", () => {
    let inv = createInventory();
    for (let i = 0; i < TAB_CAPACITY.EQUIP; i++) {
      const r = addItem(inv, "wpn.bronze_shortsword", 1, uid());
      inv = r.inv;
    }
    const { inv: final, result } = addItem(inv, "hat.leather_cap", 1, uid());
    expect(result.ok).toBe(false);
    expect(final.EQUIP.every((s) => s !== null)).toBe(true);
  });

  it("rejects adding to a full CASH tab", () => {
    let inv = createInventory();
    for (let i = 0; i < TAB_CAPACITY.CASH; i++) {
      const r = addItem(inv, "cash_hair_rainbow", 1, uid());
      inv = r.inv;
    }
    const { result } = addItem(inv, "cash_pet_mini_dragon", 1, uid());
    expect(result.ok).toBe(false);
  });

  it("rejects qty < 1", () => {
    const inv = createInventory();
    const { result } = addItem(inv, "pot.small_hp", 0);
    expect(result.ok).toBe(false);
  });
});

// ─── addItem — equip non-stacking ───────────────────────────────────────────

describe("addItem — equip non-stacking", () => {
  it("each equip occupies its own slot even with same defId", () => {
    let inv = createInventory();
    const u1 = uid();
    const u2 = uid();
    const r1 = addItem(inv, "wpn.bronze_shortsword", 1, u1);
    inv = r1.inv;
    const r2 = addItem(inv, "wpn.bronze_shortsword", 1, u2);
    inv = r2.inv;

    expect(r1.result.ok).toBe(true);
    expect(r2.result.ok).toBe(true);
    expect(countSlots(inv, "EQUIP")).toBe(2);

    // Each slot has qty 1 and a distinct uid
    const equips = inv.EQUIP.filter(
      (s): s is Slot => s !== null && s.defId === "wpn.bronze_shortsword",
    );
    expect(equips.length).toBe(2);
    expect(equips[0]!.qty).toBe(1);
    expect(equips[1]!.qty).toBe(1);
    expect(equips[0]!.uid).not.toBe(equips[1]!.uid);
  });

  it("adding 5 equips of the same type fills 5 slots", () => {
    let inv = createInventory();
    for (let i = 0; i < 5; i++) {
      const r = addItem(inv, "hat.leather_cap", 1, uid());
      inv = r.inv;
      expect(r.result.ok).toBe(true);
    }
    expect(countSlots(inv, "EQUIP")).toBe(5);
  });
});

// ─── removeItem ─────────────────────────────────────────────────────────────

describe("removeItem", () => {
  it("removes from a full stack", () => {
    let inv = createInventory();
    const r1 = addItem(inv, "pot.small_hp", 100);
    inv = r1.inv;
    const { inv: updated, ok } = removeItem(inv, "pot.small_hp", 100);
    inv = updated;
    expect(ok).toBe(true);
    expect(totalQty(inv, "USE", "pot.small_hp")).toBe(0);
  });

  it("partial removal reduces qty", () => {
    let inv = createInventory();
    const r1 = addItem(inv, "pot.small_hp", 50);
    inv = r1.inv;
    const { inv: updated } = removeItem(inv, "pot.small_hp", 30);
    inv = updated;
    expect(totalQty(inv, "USE", "pot.small_hp")).toBe(20);
  });

  it("fails when removing more than available", () => {
    let inv = createInventory();
    const r1 = addItem(inv, "pot.small_hp", 10);
    inv = r1.inv;
    const { ok } = removeItem(inv, "pot.small_hp", 20);
    expect(ok).toBe(false);
  });

  it("removes an equip by uid", () => {
    let inv = createInventory();
    const u = uid();
    const r1 = addItem(inv, "wpn.bronze_shortsword", 1, u);
    inv = r1.inv;
    const { inv: updated, ok } = removeItem(inv, "wpn.bronze_shortsword", 1, u);
    inv = updated;
    expect(ok).toBe(true);
    expect(countSlots(inv, "EQUIP")).toBe(0);
  });
});

// ─── moveSlot ───────────────────────────────────────────────────────────────

describe("moveSlot", () => {
  it("swaps two slots within the same tab", () => {
    let inv = createInventory();
    const r1 = addItem(inv, "pot.small_hp", 10);
    inv = r1.inv;
    const r2 = addItem(inv, "pot.large_hp", 5);
    inv = r2.inv;

    inv = moveSlot(inv, "USE", 0, "USE", 1);
    expect(inv.USE[0]?.defId).toBe("pot.large_hp");
    expect(inv.USE[1]?.defId).toBe("pot.small_hp");
  });

  it("moves a slot across tabs", () => {
    let inv = createInventory();
    const u = uid();
    const r1 = addItem(inv, "wpn.bronze_shortsword", 1, u);
    inv = r1.inv;

    inv = moveSlot(inv, "EQUIP", 0, "ETC", 0);
    expect(inv.EQUIP[0]).toBeNull();
    expect(inv.ETC[0]?.defId).toBe("wpn.bronze_shortsword");
  });
});

// ─── splitStack ─────────────────────────────────────────────────────────────

describe("splitStack", () => {
  it("splits a stack into two slots", () => {
    let inv = createInventory();
    const r1 = addItem(inv, "pot.small_hp", 50);
    inv = r1.inv;

    inv = splitStack(inv, "USE", 0, 20);
    expect(inv.USE[0]?.qty).toBe(30);
    expect(inv.USE[1]?.qty).toBe(20);
    expect(inv.USE[0]?.defId).toBe("pot.small_hp");
    expect(inv.USE[1]?.defId).toBe("pot.small_hp");
  });

  it("does not split if qty <= splitQty", () => {
    let inv = createInventory();
    const r1 = addItem(inv, "pot.small_hp", 10);
    inv = r1.inv;

    const before = inv;
    inv = splitStack(inv, "USE", 0, 10);
    // qty === splitQty, so no split (source qty must be > splitQty)
    expect(inv).toBe(before);
  });

  it("does not split if tab is full", () => {
    let inv = createInventory();
    // Fill USE tab
    for (let i = 0; i < TAB_CAPACITY.USE; i++) {
      const r = addItem(inv, `pot.stack_${i}`, 1);
      inv = r.inv;
    }
    const before = inv;
    inv = splitStack(inv, "USE", 0, 1);
    expect(inv).toBe(before);
  });
});

// ─── findItem ───────────────────────────────────────────────────────────────

describe("findItem", () => {
  it("finds an item by defId", () => {
    let inv = createInventory();
    const r1 = addItem(inv, "pot.small_hp", 50);
    inv = r1.inv;

    const found = findItem(inv, "pot.small_hp");
    expect(found).not.toBeNull();
    expect(found!.tab).toBe("USE");
    expect(found!.slot.qty).toBe(50);
  });

  it("finds an equip by uid", () => {
    let inv = createInventory();
    const u = uid();
    const r1 = addItem(inv, "wpn.bronze_shortsword", 1, u);
    inv = r1.inv;

    const found = findItem(inv, "wpn.bronze_shortsword", u);
    expect(found).not.toBeNull();
    expect(found!.tab).toBe("EQUIP");
    expect(found!.slot.uid).toBe(u);
  });

  it("returns null when item not found", () => {
    const inv = createInventory();
    expect(findItem(inv, "pot.small_hp")).toBeNull();
  });
});

// ─── Integration: full add/remove cycle ─────────────────────────────────────

describe("full add/remove cycle", () => {
  it("add consumables, remove some, add more, verify counts", () => {
    let inv = createInventory();

    // Add 150 small HP potions (should fill 2 slots: 100 + 50)
    const r1 = addItem(inv, "pot.small_hp", 150);
    inv = r1.inv;
    expect(r1.result.ok).toBe(true);
    expect(totalQty(inv, "USE", "pot.small_hp")).toBe(150);

    // Remove 70 (takes from first slot: 100→30, remaining 70-70=0... wait)
    // Actually removes from first slot: 100-70=30
    const r2 = removeItem(inv, "pot.small_hp", 70);
    inv = r2.inv;
    expect(r2.ok).toBe(true);
    expect(totalQty(inv, "USE", "pot.small_hp")).toBe(80);

    // Add 120 more → first slot (30) fills to 100 (+70), second slot (50) fills to 100 (+50)
    const r3 = addItem(inv, "pot.small_hp", 120);
    inv = r3.inv;
    expect(r3.result.ok).toBe(true);
    expect(totalQty(inv, "USE", "pot.small_hp")).toBe(200);
  });
});
