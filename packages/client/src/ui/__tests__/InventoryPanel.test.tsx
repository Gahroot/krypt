import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getBaseRankInfo, getPotentialTierInfo, BaseRank, PotentialTier } from "@maple/shared";

import { InventoryPanel } from "@/ui/InventoryPanel";
import { uiStore, type UIActions } from "@/ui/store";
import { inventorySnapshot } from "@/ui/__fixtures__/snapshots";

/**
 * Smoke / render tests for the reference overlay panel.
 *
 * These drive the SAME bridge store the live game does: we push the shared
 * fixture snapshot in via `setInventory` and assert React renders it and routes
 * user intent back out through the `actions.*` registry.
 */

/** Build a fully-mocked action registry so we can assert what the panel calls. */
function mockActions(): UIActions {
  return {
    equip: vi.fn(),
    use: vi.fn(),
    reorder: vi.fn(),
    close: vi.fn(),
  };
}

let actions: UIActions;

beforeEach(() => {
  actions = mockActions();
  uiStore.getState().setInventory(inventorySnapshot);
  uiStore.getState().setActions(actions);
  uiStore.getState().setInventoryOpen(true);
});

afterEach(() => {
  // Reset the shared singleton store so tests don't leak into each other.
  uiStore.getState().setInventoryOpen(false);
});

/**
 * jsdom normalizes an inline hex color to `rgb(...)`, so compare loosely: the
 * style string should contain either the hex (any case) or its rgb equivalent.
 */
function styleHasColor(el: HTMLElement, hex: string): boolean {
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  if (style.includes(hex.toLowerCase())) return true;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || !m[1] || !m[2] || !m[3]) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return style.includes(`rgb(${r}, ${g}, ${b})`);
}

describe("InventoryPanel", () => {
  it("renders nothing when closed", () => {
    uiStore.getState().setInventoryOpen(false);
    const { container } = render(<InventoryPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the EQUIP bucket with resolved item names and the mesos total", () => {
    render(<InventoryPanel />);

    // Panel chrome.
    expect(screen.getByRole("heading", { name: /inventory/i })).toBeInTheDocument();

    // EQUIP items resolve to real @maple/shared names.
    expect(screen.getByText("Bronze Shortsword")).toBeInTheDocument();
    expect(screen.getByText("Iron Broadsword")).toBeInTheDocument();
    expect(screen.getByText("Ember Wand")).toBeInTheDocument();
    expect(screen.getByText("Leather Cap")).toBeInTheDocument();

    // Fixed-slot grid is rendered.
    expect(document.querySelector('[data-slot="item-grid"]')).not.toBeNull();

    // Formatted mesos total from the snapshot.
    expect(screen.getByText(/1,250,000/)).toBeInTheDocument();
  });

  it("switches buckets when a tab is activated", async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);

    // EQUIP visible to start.
    expect(screen.getByText("Bronze Shortsword")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "USE" }));

    // EQUIP item gone, USE bucket now visible (and shows its stack count badge).
    expect(screen.queryByText("Bronze Shortsword")).not.toBeInTheDocument();
    expect(screen.getByText("con.hp_potion_s")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("paints rarity borders (tier) and rank label colors", () => {
    render(<InventoryPanel />);

    // The MYTHIC / LEGENDARY god roll.
    const legendaryCell = screen.getByText("Bronze Shortsword").closest("button") as HTMLElement;
    expect(styleHasColor(legendaryCell, getPotentialTierInfo(PotentialTier.LEGENDARY).color)).toBe(
      true,
    );

    const legendaryLabel = within(legendaryCell).getByText("Bronze Shortsword");
    expect(styleHasColor(legendaryLabel, getBaseRankInfo(BaseRank.MYTHIC).color)).toBe(true);

    // A different tier paints a different border — proves the color is data-driven.
    const rareCell = screen.getByText("Ember Wand").closest("button") as HTMLElement;
    expect(styleHasColor(rareCell, getPotentialTierInfo(PotentialTier.RARE).color)).toBe(true);
    expect(legendaryCell.getAttribute("style")).not.toEqual(rareCell.getAttribute("style"));
  });

  it("routes activation to actions.equip on the EQUIP tab", () => {
    render(<InventoryPanel />);

    // fireEvent (not userEvent) avoids opening the hover tooltip mid-assertion.
    fireEvent.dblClick(screen.getByText("Bronze Shortsword"));

    expect(actions.equip).toHaveBeenCalledWith("eq-4");
    expect(actions.use).not.toHaveBeenCalled();
  });

  it("routes activation to actions.use on the USE tab", async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);

    await user.click(screen.getByRole("tab", { name: "USE" }));
    fireEvent.dblClick(screen.getByText("con.hp_potion_s"));

    expect(actions.use).toHaveBeenCalledWith("con.hp_potion_s");
  });

  it("reorders within a tab on drop", () => {
    render(<InventoryPanel />);

    const target = screen.getByText("Iron Broadsword").closest("button") as HTMLElement;

    // The drop handler reads the dragged uid off dataTransfer; jsdom has no real
    // DnD so we supply a minimal stub.
    const dataTransfer = { getData: () => "eq-4" } as unknown as DataTransfer;
    target.dispatchEvent(
      Object.assign(new Event("drop", { bubbles: true, cancelable: true }), { dataTransfer }),
    );

    // EQUIP tab, dragged from eq-4 onto eq-3 (Iron Broadsword).
    expect(actions.reorder).toHaveBeenCalledWith("EQUIP", "eq-4", "eq-3");
  });

  it("closes via the panel close action", async () => {
    const user = userEvent.setup();
    render(<InventoryPanel />);

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(actions.close).toHaveBeenCalled();
  });
});
