import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Character-select slice — bridge state for {@link CharacterSelectScene}.
 *
 * Mirrors the channel-select slice (./channelSelect.ts): the Phaser scene loads
 * the account roster from the server's `/characters` endpoint, pushes a plain,
 * serializable {@link CharacterSelectSnapshot} in, and registers a per-feature
 * action registry. React reads the snapshot and drives Enter / Create / Delete
 * purely through {@link CharacterSelectActions}.
 *
 * Like character-create, this runs in its own scene before any game room exists,
 * so it carries its OWN action registry rather than the in-game `UIActions`.
 */

/** One roster row shown on the select screen. */
export interface CharacterSelectEntry {
  charId: string;
  name: string;
  /** Human-readable class name, e.g. "Beginner". */
  className: string;
  level: number;
  /** Human-readable map name, e.g. "Dawn Isle". */
  mapName: string;
}

/** Everything the select screen needs in one immutable push from Phaser. */
export interface CharacterSelectSnapshot {
  characters: CharacterSelectEntry[];
  /** Server-enforced maximum number of characters (slot cap). */
  max: number;
  /** False until the roster fetch resolves (drives a loading state). */
  loaded: boolean;
  /** Fetch / action error message ("" when none). */
  error: string;
  /** True while an Enter / Delete request is in flight (disables actions). */
  busy: boolean;
}

/** Imperative actions the scene wires so React can drive the select flow. */
export interface CharacterSelectActions {
  /** Choose a character and join the world with it. */
  enter(charId: string): void;
  /** Open the (reused) character-create panel. */
  create(): void;
  /** Permanently delete a character (the panel confirms first). */
  remove(charId: string): void;
}

const EMPTY_CHARACTER_SELECT: CharacterSelectSnapshot = {
  characters: [],
  max: 0,
  loaded: false,
  error: "",
  busy: false,
};

export interface CharacterSelectSlice {
  characterSelectOpen: boolean;
  characterSelect: CharacterSelectSnapshot;
  characterSelectActions: CharacterSelectActions | null;

  setCharacterSelectOpen: (open: boolean) => void;
  setCharacterSelect: (snapshot: CharacterSelectSnapshot) => void;
  setCharacterSelectActions: (actions: CharacterSelectActions | null) => void;
}

export const createCharacterSelectSlice: StateCreator<UIState, [], [], CharacterSelectSlice> = (
  set,
) => ({
  characterSelectOpen: false,
  characterSelect: EMPTY_CHARACTER_SELECT,
  characterSelectActions: null,

  setCharacterSelectOpen: (open) => set({ characterSelectOpen: open }),
  setCharacterSelect: (snapshot) => set({ characterSelect: snapshot }),
  setCharacterSelectActions: (actions) => set({ characterSelectActions: actions }),
});
