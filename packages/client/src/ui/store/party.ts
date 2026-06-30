import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Party slice — bridge state for the React party overlay (PartyPanel).
 *
 * Follows the reference inventory slice: a plain, serializable snapshot pushed
 * in from Phaser (`UIScene.publishParty`), an `open` flag, and a per-feature
 * action registry the scene wires to authoritative `room.send(...)` messages
 * (PARTY_INVITE / PARTY_KICK / PARTY_LEAVE / PARTY_ACCEPT / PARTY_SET_LOOT_RULE).
 * React reads the snapshot and calls the actions — it never touches
 * Phaser/Colyseus.
 */

/** Party loot distribution rule (mirror of shared LootRule). */
export type PartyLootRule = "ffa" | "roundRobin" | "leader";

/** A plain snapshot of one party member (mirror of PartyMemberView). */
export interface PartyMemberSnapshot {
  charId: string;
  sessionId: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  dead: boolean;
  mapId: string;
  leader: boolean;
}

/** A pending party invite the local player has received. */
export interface PartyInviteSnapshot {
  fromCharId: string;
  fromName: string;
}

/** Everything the party UI needs in one immutable push from Phaser. */
export interface PartySnapshot {
  members: PartyMemberSnapshot[];
  lootRule: PartyLootRule;
  /** Pending invite (drives an accept/decline dialog), or null. */
  invite: PartyInviteSnapshot | null;
  /** Local player's charId — used to gate leader-only controls. */
  selfCharId: string;
}

/** Imperative actions the scene wires so React can drive the party. */
export interface PartyActions {
  /** Invite another player by name (resolved to a session server-side). */
  invite(name: string): void;
  /** Kick a member by charId (leader only). */
  kick(charId: string): void;
  /** Leave the current party. */
  leave(): void;
  /** Change the loot distribution rule (leader only). */
  setLootRule(rule: PartyLootRule): void;
  /** Accept a pending invite. */
  acceptInvite(fromCharId: string): void;
  /** Decline / dismiss a pending invite. */
  declineInvite(): void;
  /** Close the panel. */
  close(): void;
}

const EMPTY_PARTY: PartySnapshot = {
  members: [],
  lootRule: "ffa",
  invite: null,
  selfCharId: "",
};

export interface PartySlice {
  partyOpen: boolean;
  party: PartySnapshot;
  partyActions: PartyActions | null;

  setPartyOpen: (open: boolean) => void;
  setParty: (snapshot: PartySnapshot) => void;
  setPartyActions: (actions: PartyActions | null) => void;
}

export const createPartySlice: StateCreator<UIState, [], [], PartySlice> = (set) => ({
  partyOpen: false,
  party: EMPTY_PARTY,
  partyActions: null,

  setPartyOpen: (open) => set({ partyOpen: open }),
  setParty: (snapshot) => set({ party: snapshot }),
  setPartyActions: (actions) => set({ partyActions: actions }),
});
