import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CharacterSelectPanel } from "@/ui/CharacterSelectPanel";
import { uiStore, type CharacterSelectActions, type CharacterSelectSnapshot } from "@/ui/store";

/**
 * Smoke / render tests for the Character Select overlay panel.
 *
 * These drive the SAME bridge store the live CharacterSelectScene does: push a
 * snapshot in via `setCharacterSelect`, then assert React renders the roster and
 * routes Enter / Create / Delete back out through `characterSelectActions.*`.
 */

function mockActions(): CharacterSelectActions {
  return {
    enter: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  };
}

const ROSTER: CharacterSelectSnapshot = {
  characters: [
    { charId: "chr_1", name: "Aria", className: "Warrior", level: 12, mapName: "Meadowfield" },
    { charId: "chr_2", name: "Bevin", className: "Beginner", level: 1, mapName: "Dawn Isle" },
  ],
  max: 6,
  loaded: true,
  error: "",
  busy: false,
};

let actions: CharacterSelectActions;

beforeEach(() => {
  actions = mockActions();
  uiStore.getState().setCharacterSelect(ROSTER);
  uiStore.getState().setCharacterSelectActions(actions);
  uiStore.getState().setCharacterSelectOpen(true);
});

afterEach(() => {
  uiStore.getState().setCharacterSelectOpen(false);
});

describe("CharacterSelectPanel", () => {
  it("renders nothing when closed", () => {
    uiStore.getState().setCharacterSelectOpen(false);
    const { container } = render(<CharacterSelectPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every character with name, class, level and map", () => {
    render(<CharacterSelectPanel />);
    expect(screen.getByText("Aria")).toBeInTheDocument();
    expect(screen.getByText("Bevin")).toBeInTheDocument();
    expect(screen.getByText("Warrior · Meadowfield")).toBeInTheDocument();
    expect(screen.getByText("Beginner · Dawn Isle")).toBeInTheDocument();
    expect(screen.getByText("Lv 12")).toBeInTheDocument();
    expect(screen.getByText("2/6 slots")).toBeInTheDocument();
  });

  it("enters the highlighted character (first by default)", async () => {
    const user = userEvent.setup();
    render(<CharacterSelectPanel />);
    await user.click(screen.getByRole("button", { name: /enter world/i }));
    expect(actions.enter).toHaveBeenCalledWith("chr_1");
  });

  it("opens the create flow", async () => {
    const user = userEvent.setup();
    render(<CharacterSelectPanel />);
    await user.click(screen.getByRole("button", { name: /create/i }));
    expect(actions.create).toHaveBeenCalled();
  });

  it("requires confirmation before deleting", async () => {
    const user = userEvent.setup();
    render(<CharacterSelectPanel />);
    await user.click(screen.getByRole("button", { name: "Delete Aria" }));
    // Confirmation dialog appears; no delete fired yet.
    expect(actions.remove).not.toHaveBeenCalled();
    expect(screen.getByText("Delete Aria?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.remove).toHaveBeenCalledWith("chr_1");
  });

  it("disables Create when at the slot cap", () => {
    uiStore.getState().setCharacterSelect({
      ...ROSTER,
      max: 2,
    });
    render(<CharacterSelectPanel />);
    expect(screen.getByRole("button", { name: /create/i })).toBeDisabled();
  });
});
