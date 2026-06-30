import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Friends slice — bridge state for the React friends/buddy overlay (FriendsPanel).
 *
 * Follows the reference inventory slice: a plain, serializable snapshot pushed
 * in from Phaser (`UIScene.publishFriends`), an `open` flag, and a per-feature
 * action registry the scene wires to authoritative `room.send(...)` messages
 * (FRIEND_ADD / FRIEND_REMOVE) plus a whisper helper. React reads the snapshot
 * and calls the actions — it never touches Phaser/Colyseus.
 */

/** A plain snapshot of one friend (mirror of FriendEntryView). */
export interface FriendSnapshot {
  charId: string;
  name: string;
  level: number;
  online: boolean;
  /** Current map id, when online. */
  mapId?: string;
}

/** Everything the friends UI needs in one immutable push from Phaser. */
export interface FriendsSnapshot {
  friends: FriendSnapshot[];
}

/** Imperative actions the scene wires so React can drive the friends list. */
export interface FriendsActions {
  /** Add a player to the friends list by name. */
  add(name: string): void;
  /** Remove a friend by name. */
  remove(name: string): void;
  /** Open chat with `/w <name>` pre-filled. */
  whisper(name: string): void;
  /** Close the panel. */
  close(): void;
}

const EMPTY_FRIENDS: FriendsSnapshot = {
  friends: [],
};

export interface FriendsSlice {
  friendsOpen: boolean;
  friends: FriendsSnapshot;
  friendsActions: FriendsActions | null;

  setFriendsOpen: (open: boolean) => void;
  setFriends: (snapshot: FriendsSnapshot) => void;
  setFriendsActions: (actions: FriendsActions | null) => void;
}

export const createFriendsSlice: StateCreator<UIState, [], [], FriendsSlice> = (set) => ({
  friendsOpen: false,
  friends: EMPTY_FRIENDS,
  friendsActions: null,

  setFriendsOpen: (open) => set({ friendsOpen: open }),
  setFriends: (snapshot) => set({ friends: snapshot }),
  setFriendsActions: (actions) => set({ friendsActions: actions }),
});
