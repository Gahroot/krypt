import type { StateCreator } from "zustand";
import type { UIState } from "./index";

/** One active event as pushed by the server. */
export interface EventSnapshot {
  id: string;
  name: string;
  description: string;
  effects: { expMultiplier?: number; dropMultiplier?: number; mesoMultiplier?: number };
  color?: string;
  icon?: string;
  endAt: number;
}

export interface EventsSlice {
  /** Currently active events. */
  events: EventSnapshot[];
  /** Replace the full events list (called on EVENTS_SYNC). */
  setEvents: (events: EventSnapshot[]) => void;
}

export const createEventsSlice: StateCreator<UIState, [], [], EventsSlice> = (set) => ({
  events: [],
  setEvents: (events) => set({ events }),
});
