import type { StateCreator } from "zustand";
import type { CharacterAppearance } from "@maple/shared";

import type { UIState } from "./index";

/**
 * Character-create slice — bridge state for {@link CharacterCreateScene}.
 *
 * Follows the reference shape (see ./inventory.ts): the Phaser scene owns the
 * authoritative appearance + connection state and pushes a plain, serializable
 * {@link CharacterCreateSnapshot} in; React reads it and drives the flow purely
 * through {@link CharacterCreateActions}.
 *
 * Unlike the in-game HUD, this flow runs in its own scene before the game room
 * exists, so it carries its OWN action registry (`characterCreateActions`)
 * rather than the cross-cutting `UIActions` that `UIScene` populates.
 */

/** Plain snapshot of the character-create screen state pushed from Phaser. */
export interface CharacterCreateSnapshot {
  /** The full cosmetic identity being edited (source of truth lives in the scene). */
  appearance: CharacterAppearance;
  /** Validation / connection error message ("" when none). */
  error: string;
  /** True while a create request is in flight (disables Confirm). */
  sending: boolean;
}

/** Imperative actions the scene wires up so React can drive the flow. */
export interface CharacterCreateActions {
  /** Roll a fresh randomised appearance. */
  randomize(): void;
  /** Set one appearance field (gender swaps fix up an invalid outfit). */
  setField(field: keyof CharacterAppearance, value: string): void;
  /** Validate the name, then connect + send CREATE_CHARACTER. */
  confirm(name: string, appearance: CharacterAppearance): void;
  /** Abandon creation and return to the preload/login flow. */
  back(): void;
}

const DEFAULT_APPEARANCE: CharacterAppearance = {
  gender: "M",
  skinId: "skin_light",
  hairId: "hair_short",
  hairColorId: "color_black",
  faceId: "face_default",
  outfitId: "outfit_tunic",
};

const DEFAULT_SNAPSHOT: CharacterCreateSnapshot = {
  appearance: DEFAULT_APPEARANCE,
  error: "",
  sending: false,
};

export interface CharacterCreateSlice {
  characterCreateOpen: boolean;
  characterCreate: CharacterCreateSnapshot;
  characterCreateActions: CharacterCreateActions | null;

  setCharacterCreateOpen: (open: boolean) => void;
  setCharacterCreate: (snapshot: CharacterCreateSnapshot) => void;
  setCharacterCreateActions: (actions: CharacterCreateActions) => void;
}

export const createCharacterCreateSlice: StateCreator<UIState, [], [], CharacterCreateSlice> = (
  set,
) => ({
  characterCreateOpen: false,
  characterCreate: DEFAULT_SNAPSHOT,
  characterCreateActions: null,

  setCharacterCreateOpen: (open) => set({ characterCreateOpen: open }),
  setCharacterCreate: (snapshot) => set({ characterCreate: snapshot }),
  setCharacterCreateActions: (actions) => set({ characterCreateActions: actions }),
});
