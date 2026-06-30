import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Guild slice — bridge state for the React guild overlay (GuildPanel).
 *
 * Follows the reference inventory slice: a plain, serializable snapshot pushed
 * in from Phaser (`UIScene.publishGuild`), an `open` flag, and a per-feature
 * action registry the scene wires to authoritative `room.send(...)` messages
 * (GUILD_CREATE / GUILD_INVITE / GUILD_KICK / GUILD_RANK / GUILD_LEAVE /
 * GUILD_DISBAND). React reads the snapshot and calls the actions — it never
 * touches Phaser/Colyseus.
 */

/** Guild rank ladder (mirror of shared GuildRank). */
export type GuildRank = "master" | "officer" | "member";

/** A plain snapshot of one guild member (mirror of GuildMemberView). */
export interface GuildMemberSnapshot {
  charId: string;
  name: string;
  level: number;
  rank: GuildRank;
  online: boolean;
}

/** Everything the guild UI needs in one immutable push from Phaser. */
export interface GuildSnapshot {
  /** Empty string when the player is not in a guild (panel shows the create form). */
  guildId: string;
  guildName: string;
  /** Emblem color is delivered as a CSS hex string (e.g. "#facc15"). */
  emblem: { color: string; label: string };
  members: GuildMemberSnapshot[];
  createdDate: number;
  /** Local player's charId — used to resolve their rank + management rights. */
  selfCharId: string;
}

/** Imperative actions the scene wires so React can drive the guild. */
export interface GuildActions {
  /** Create a new guild (costs mesos). */
  create(name: string): void;
  /** Invite a player by name (resolved to a session server-side). */
  invite(name: string): void;
  /** Kick a member by charId (officer+). */
  kick(charId: string): void;
  /** Change a member's rank (master only) — promote/demote. */
  setRank(charId: string, rank: GuildRank): void;
  /** Leave the guild. */
  leave(): void;
  /** Disband the guild (master only). */
  disband(): void;
  /** Close the panel. */
  close(): void;
}

const EMPTY_GUILD: GuildSnapshot = {
  guildId: "",
  guildName: "",
  emblem: { color: "#facc15", label: "" },
  members: [],
  createdDate: 0,
  selfCharId: "",
};

export interface GuildSlice {
  guildOpen: boolean;
  guild: GuildSnapshot;
  guildActions: GuildActions | null;

  setGuildOpen: (open: boolean) => void;
  setGuild: (snapshot: GuildSnapshot) => void;
  setGuildActions: (actions: GuildActions | null) => void;
}

export const createGuildSlice: StateCreator<UIState, [], [], GuildSlice> = (set) => ({
  guildOpen: false,
  guild: EMPTY_GUILD,
  guildActions: null,

  setGuildOpen: (open) => set({ guildOpen: open }),
  setGuild: (snapshot) => set({ guild: snapshot }),
  setGuildActions: (actions) => set({ guildActions: actions }),
});
