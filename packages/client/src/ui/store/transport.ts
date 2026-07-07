import type { StateCreator } from "zustand";
import type { UIState } from "./index";

/** Snapshot of the current scheduled transport countdown (pushed by server). */
export interface TransportSnapshot {
  /** Human-readable label (e.g. "✈️ Airship to Skyhaven"). */
  portalLabel: string;
  /** Milliseconds remaining until departure. */
  departInMs: number;
  /** Number of players currently boarded. */
  boardedCount: number;
  /** Portal id (stable key). */
  portalId: string;
  /** Client-side epoch when the snapshot was received (for local countdown interpolation). */
  receivedAt: number;
}

export interface TransportSlice {
  /** Active transport countdown, or null when not boarded. */
  transport: TransportSnapshot | null;
  /** Replace the transport snapshot (called on TRANSPORT_STATUS). */
  setTransport: (snapshot: TransportSnapshot | null) => void;
}

export const createTransportSlice: StateCreator<UIState, [], [], TransportSlice> = (set) => ({
  transport: null,
  setTransport: (snapshot) => set({ transport: snapshot }),
});
