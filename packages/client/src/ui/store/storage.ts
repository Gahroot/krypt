import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Storage slice — bridge state for the account-wide stash (bank) window.
 *
 * Follows the reference inventory slice: a plain, serializable snapshot pushed
 * in from Phaser (`StorageScene`), an `open` flag, and a per-feature action
 * registry the scene wires to authoritative `room.send(...)` messages. React
 * reads the snapshot and calls the actions — it never touches Phaser/Colyseus.
 *
 * Capacity rules (server-authoritative, mirrored here for affordance):
 *   - Deposit is blocked when `stash.length >= stashCapacity` (stash full).
 *   - Withdraw is blocked when `bagged.length >= inventoryCapacity` (bag full).
 */

/** A plain snapshot of one item in the bag or the stash. */
export interface StorageItemSnapshot {
  uid: string;
  defId: string;
  baseRank: string;
  potentialTier: string;
  count: number;
}

/** Transient result of a deposit/withdraw attempt — drives a toast. */
export interface StorageFeedback {
  /** Monotonic id so identical messages re-fire the toast. */
  id: number;
  message: string;
  ok: boolean;
}

/** Everything the storage UI needs in one immutable push from Phaser. */
export interface StorageSnapshot {
  /** Bagged (unequipped) inventory items — deposit candidates. */
  bagged: StorageItemSnapshot[];
  /** Items currently in the account stash — withdraw candidates. */
  stash: StorageItemSnapshot[];
  /** Max stash slots. */
  stashCapacity: number;
  /** Max bag slots (used to gate withdrawals when the bag is full). */
  inventoryCapacity: number;
  feedback: StorageFeedback | null;
}

/** Imperative actions the scene wires so React can drive storage. */
export interface StorageActions {
  /** Deposit a bagged item into the stash. */
  deposit(uid: string): void;
  /** Withdraw a stashed item into the bag. */
  withdraw(uid: string): void;
  /** Close the window. */
  close(): void;
}

const EMPTY_STORAGE: StorageSnapshot = {
  bagged: [],
  stash: [],
  stashCapacity: 24,
  inventoryCapacity: 24,
  feedback: null,
};

export interface StorageSlice {
  storageOpen: boolean;
  storage: StorageSnapshot;
  storageActions: StorageActions | null;

  setStorageOpen: (open: boolean) => void;
  setStorage: (snapshot: StorageSnapshot) => void;
  setStorageActions: (actions: StorageActions | null) => void;
}

export const createStorageSlice: StateCreator<UIState, [], [], StorageSlice> = (set) => ({
  storageOpen: false,
  storage: EMPTY_STORAGE,
  storageActions: null,

  setStorageOpen: (open) => set({ storageOpen: open }),
  setStorage: (snapshot) => set({ storage: snapshot }),
  setStorageActions: (actions) => set({ storageActions: actions }),
});
