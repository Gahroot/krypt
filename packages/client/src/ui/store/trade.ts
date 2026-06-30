import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Trade slice — bridge state for the player-to-player direct trade window.
 *
 * Follows the reference inventory slice: a plain, serializable snapshot pushed
 * in from Phaser (`TradeScene`), an `open` flag, and a per-feature action
 * registry the scene wires to authoritative `room.send(...)` messages. React
 * reads the snapshot and calls the actions — it never touches Phaser/Colyseus.
 *
 * The two-phase safety flow is server-authoritative: both sides must LOCK
 * ("ready"), then both must CONFIRM, before the trade executes. The snapshot
 * mirrors every flag the server reports so the panel can render it faithfully.
 */

/** A plain snapshot of one tradeable item (resolved from a player's inventory). */
export interface TradeItemSnapshot {
  uid: string;
  defId: string;
  baseRank: string;
  potentialTier: string;
  count: number;
}

/** Transient result of a trade attempt — drives a toast in the panel. */
export interface TradeFeedback {
  /** Monotonic id so identical messages re-fire the toast. */
  id: number;
  message: string;
  ok: boolean;
}

/** Everything the trade UI needs in one immutable push from Phaser. */
export interface TradeSnapshot {
  partnerName: string;
  /** Items the local player has put on the table. */
  myOffer: TradeItemSnapshot[];
  myMesos: number;
  /** Items the partner has put on the table (read-only). */
  partnerOffer: TradeItemSnapshot[];
  partnerMesos: number;
  /** Bagged, unequipped, not-yet-offered items the player can add. */
  available: TradeItemSnapshot[];
  myLocked: boolean;
  partnerLocked: boolean;
  myConfirmed: boolean;
  partnerConfirmed: boolean;
  feedback: TradeFeedback | null;
}

/** Imperative actions the scene wires so React can drive the trade. */
export interface TradeActions {
  /** Add a bagged item to the local offer. */
  add(uid: string): void;
  /** Remove an item from the local offer. */
  remove(uid: string): void;
  /** Set the mesos amount offered by the local player. */
  setMesos(mesos: number): void;
  /** Lock the local offer ("ready") — phase 1 of the safety flow. */
  ready(): void;
  /** Confirm the locked trade — phase 2; both sides must confirm to execute. */
  confirm(): void;
  /** Cancel the trade (notifies the partner) and close. */
  cancel(): void;
  /** Close the window. */
  close(): void;
}

const EMPTY_TRADE: TradeSnapshot = {
  partnerName: "",
  myOffer: [],
  myMesos: 0,
  partnerOffer: [],
  partnerMesos: 0,
  available: [],
  myLocked: false,
  partnerLocked: false,
  myConfirmed: false,
  partnerConfirmed: false,
  feedback: null,
};

export interface TradeSlice {
  tradeOpen: boolean;
  trade: TradeSnapshot;
  tradeActions: TradeActions | null;

  setTradeOpen: (open: boolean) => void;
  setTrade: (snapshot: TradeSnapshot) => void;
  setTradeActions: (actions: TradeActions | null) => void;
}

export const createTradeSlice: StateCreator<UIState, [], [], TradeSlice> = (set) => ({
  tradeOpen: false,
  trade: EMPTY_TRADE,
  tradeActions: null,

  setTradeOpen: (open) => set({ tradeOpen: open }),
  setTrade: (snapshot) => set({ trade: snapshot }),
  setTradeActions: (actions) => set({ tradeActions: actions }),
});
