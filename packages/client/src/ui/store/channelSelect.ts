import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Channel-select slice — bridge state for the channel picker overlay
 * (ChannelSelectPanel.tsx).
 *
 * Follows the reference inventory slice: the Phaser `ChannelSelectScene` fetches
 * the channel list from the server's `/channels` endpoint, pushes a plain,
 * serializable {@link ChannelSelectSnapshot} in, and registers a per-feature
 * action registry. React reads the snapshot and calls the actions — picking a
 * channel routes back through the existing registry → `CHANNEL_SWITCH` flow that
 * MapScene already drives.
 */

/** One channel row: index + live population. */
export interface ChannelEntry {
  channel: number;
  playerCount: number;
}

/** Everything the channel picker needs in one immutable push from Phaser. */
export interface ChannelSelectSnapshot {
  channels: ChannelEntry[];
  /** The channel the player is currently on (highlighted, not selectable). */
  currentChannel: number;
  /** False until the `/channels` fetch resolves (drives a loading state). */
  loaded: boolean;
}

/** Imperative actions the scene wires so React can drive channel switching. */
export interface ChannelSelectActions {
  /** Join the given channel (sets the registry target MapScene consumes). */
  join(channel: number): void;
  /** Close the picker without switching. */
  close(): void;
}

const EMPTY_CHANNEL_SELECT: ChannelSelectSnapshot = {
  channels: [],
  currentChannel: 0,
  loaded: false,
};

export interface ChannelSelectSlice {
  channelSelectOpen: boolean;
  channelSelect: ChannelSelectSnapshot;
  channelSelectActions: ChannelSelectActions | null;

  setChannelSelectOpen: (open: boolean) => void;
  setChannelSelect: (snapshot: ChannelSelectSnapshot) => void;
  setChannelSelectActions: (actions: ChannelSelectActions | null) => void;
}

export const createChannelSelectSlice: StateCreator<UIState, [], [], ChannelSelectSlice> = (
  set,
) => ({
  channelSelectOpen: false,
  channelSelect: EMPTY_CHANNEL_SELECT,
  channelSelectActions: null,

  setChannelSelectOpen: (open) => set({ channelSelectOpen: open }),
  setChannelSelect: (snapshot) => set({ channelSelect: snapshot }),
  setChannelSelectActions: (actions) => set({ channelSelectActions: actions }),
});
