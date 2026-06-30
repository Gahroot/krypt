/**
 * GuildManager — persistent guild system shared across ALL map rooms.
 *
 * Guilds are durable (persisted to disk) and live in a global singleton so any MapRoom can
 * create/invite/accept/kick/rank members. Guild chat is relayed to online members across
 * all rooms.
 */
import type { GuildRank, GuildMember, GuildUpdatePayload } from "@maple/shared";

// ─── Tunables ──────────────────────────────────────────────────────────────
/** Max members per guild. */
export const GUILD_MAX_MEMBERS = 30;

/** Mesos cost to create a guild (a currency sink). */
export const GUILD_CREATE_COST = 50_000;

// ─── Internal types ────────────────────────────────────────────────────────

export interface GuildRecord {
  guildId: string;
  name: string;
  emblem: { color: number; label: string };
  createdDate: number;
  /** charId → rank. */
  roster: Map<string, GuildRank>;
}

/** A pending guild invite. */
export interface PendingGuildInvite {
  fromCharId: string;
  toSessionId: string;
  guildId: string;
  expiresAt: number;
}

/** Online member info for relaying guild chat across rooms. */
export interface OnlineMember {
  sessionId: string;
  charId: string;
  name: string;
  level: number;
  roomId: string;
  /** Per-session send callback — closes over the owning room's Client.send. */
  send: (type: string | number, payload: unknown) => void;
}

// ─── GuildManager singleton ────────────────────────────────────────────────

class GuildManagerImpl {
  /** All guilds keyed by guildId. */
  private guilds = new Map<string, GuildRecord>();

  /** charId → guildId (fast lookup). */
  private memberIndex = new Map<string, string>();

  /** sessionId → OnlineMember (for cross-room chat relay). */
  private onlineMembers = new Map<string, OnlineMember>();

  /** Pending invites keyed by the invitee's sessionId. */
  private pendingInvites = new Map<string, PendingGuildInvite>();

  private nextGuildId = 1;

  // ─── Persistence ──────────────────────────────────────────────────────────

  /** Load from a pre-populated map (called from store.ts on boot). */
  loadGuilds(raw: Map<string, GuildRecord>): void {
    this.guilds = raw;
    // Rebuild memberIndex.
    for (const [guildId, guild] of this.guilds) {
      for (const charId of guild.roster.keys()) {
        this.memberIndex.set(charId, guildId);
      }
    }
    // Restore nextGuildId from existing guilds.
    for (const gid of this.guilds.keys()) {
      const n = Number(gid.split("_")[1]);
      if (Number.isFinite(n) && n >= this.nextGuildId) this.nextGuildId = n + 1;
    }
  }

  /** Return a serialisable snapshot for persistence. */
  snapshotForPersist(): Map<string, GuildRecord> {
    return this.guilds;
  }

  // ─── Online tracking ──────────────────────────────────────────────────────

  /** Register a player as online in a given room with a send callback for cross-room relay. */
  registerOnline(
    sessionId: string,
    charId: string,
    name: string,
    level: number,
    roomId: string,
    send: (type: string | number, payload: unknown) => void,
  ): void {
    this.onlineMembers.set(sessionId, { sessionId, charId, name, level, roomId, send });
  }

  /** Unregister a player on disconnect/leave. */
  unregisterOnline(sessionId: string): void {
    this.onlineMembers.delete(sessionId);
  }

  /** Update level for an online member (after level-up). */
  updateOnlineLevel(sessionId: string, level: number): void {
    const m = this.onlineMembers.get(sessionId);
    if (m) m.level = level;
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /** Get a guild by id. */
  getGuild(guildId: string): GuildRecord | undefined {
    return this.guilds.get(guildId);
  }

  /** Get the guild a character belongs to (or undefined). */
  getGuildForChar(charId: string): GuildRecord | undefined {
    const gid = this.memberIndex.get(charId);
    return gid ? this.guilds.get(gid) : undefined;
  }

  /** Get the rank of a character in their guild (or undefined). */
  getRank(charId: string): GuildRank | undefined {
    const guild = this.getGuildForChar(charId);
    return guild?.roster.get(charId);
  }

  /** Check if a character is in a guild. */
  inGuild(charId: string): boolean {
    return this.memberIndex.has(charId);
  }

  /** Check if a character can invite (master or officer). */
  canInvite(charId: string): boolean {
    const rank = this.getRank(charId);
    return rank === "master" || rank === "officer";
  }

  /** Check if a character can kick (master or officer). */
  canKick(charId: string): boolean {
    return this.canInvite(charId);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  /**
   * Create a new guild. The caller must already have deducted mesos.
   * Returns the new guild record, or an error string.
   */
  createGuild(
    charId: string,
    charName: string,
    charLevel: number,
    guildName: string,
    color: number,
  ): GuildRecord | string {
    if (this.inGuild(charId)) return "You are already in a guild. Leave first.";

    const trimmed = guildName.trim();
    if (trimmed.length < 2 || trimmed.length > 16) return "Guild name must be 2–16 characters.";

    // Check uniqueness.
    for (const g of this.guilds.values()) {
      if (g.name.toLowerCase() === trimmed.toLowerCase()) return "Guild name is already taken.";
    }

    const guildId = `guild_${this.nextGuildId++}`;
    const guild: GuildRecord = {
      guildId,
      name: trimmed,
      emblem: { color, label: trimmed.charAt(0).toUpperCase() },
      createdDate: Date.now(),
      roster: new Map([[charId, "master" as GuildRank]]),
    };

    this.guilds.set(guildId, guild);
    this.memberIndex.set(charId, guildId);

    return guild;
  }

  /**
   * Send a guild invite. Returns an error string on failure, or undefined on success.
   */
  invite(fromCharId: string, toSessionId: string): string | undefined {
    if (!this.canInvite(fromCharId)) return "Only master or officer can invite.";

    const fromGuildId = this.memberIndex.get(fromCharId);
    if (!fromGuildId) return "You are not in a guild.";

    const fromGuild = this.guilds.get(fromGuildId);
    if (!fromGuild) return "Guild not found.";

    if (fromGuild.roster.size >= GUILD_MAX_MEMBERS) return "Guild is full.";

    // Check if target is already in the same guild.
    const toGuildId = this.memberIndex.get(toSessionId);
    if (toGuildId === fromGuildId) return "That player is already in your guild.";

    // Check if target is in another guild.
    if (toGuildId) return "That player is already in another guild.";

    // Expire old invites.
    this.expireInvites();

    // Check if already pending.
    if (this.pendingInvites.has(toSessionId)) return "That player already has a pending invite.";

    this.pendingInvites.set(toSessionId, {
      fromCharId,
      toSessionId,
      guildId: fromGuildId,
      expiresAt: Date.now() + 30_000,
    });

    return undefined;
  }

  /**
   * Accept a guild invite. Returns { guild } or an error string.
   */
  acceptInvite(
    acceptSessionId: string,
    acceptCharId: string,
    _acceptName: string,
    _acceptLevel: number,
    _fromSessionId: string,
  ): { guild: GuildRecord } | string {
    this.expireInvites();

    const invite = this.pendingInvites.get(acceptSessionId);
    if (!invite) return "No pending invite.";

    // Target must not already be in a guild.
    if (this.inGuild(acceptCharId)) {
      this.pendingInvites.delete(acceptSessionId);
      return "You are already in a guild.";
    }

    this.pendingInvites.delete(acceptSessionId);

    const guild = this.guilds.get(invite.guildId);
    if (!guild) return "Guild no longer exists.";

    if (guild.roster.size >= GUILD_MAX_MEMBERS) return "Guild is full.";

    guild.roster.set(acceptCharId, "member");
    this.memberIndex.set(acceptCharId, guild.guildId);

    return { guild };
  }

  /**
   * Leave a guild. Returns the guild if found, or undefined.
   */
  leave(charId: string): { guild: GuildRecord; wasMaster: boolean } | undefined {
    const guildId = this.memberIndex.get(charId);
    if (!guildId) return undefined;

    const guild = this.guilds.get(guildId);
    if (!guild) return undefined;

    const wasMaster = guild.roster.get(charId) === "master";
    guild.roster.delete(charId);
    this.memberIndex.delete(charId);

    // If the guild is now empty, disband it.
    if (guild.roster.size === 0) {
      this.guilds.delete(guildId);
    }

    return { guild, wasMaster };
  }

  /**
   * Kick a member from the guild (master or officer only).
   * Officers cannot kick other officers or the master.
   */
  kick(
    kickerCharId: string,
    targetCharId: string,
  ): { guild: GuildRecord; kickedName: string } | string {
    if (!this.canKick(kickerCharId)) return "Only master or officer can kick.";

    const guildId = this.memberIndex.get(kickerCharId);
    if (!guildId) return "You are not in a guild.";

    const guild = this.guilds.get(guildId);
    if (!guild) return "Guild not found.";

    const kickerRank = guild.roster.get(kickerCharId);
    const targetRank = guild.roster.get(targetCharId);
    if (!targetRank) return "That player is not in your guild.";

    // Officers cannot kick other officers or the master.
    if (kickerRank === "officer" && (targetRank === "officer" || targetRank === "master")) {
      return "Officers cannot kick other officers or the master.";
    }

    // Cannot kick yourself.
    if (kickerCharId === targetCharId) return "You cannot kick yourself.";

    guild.roster.delete(targetCharId);
    this.memberIndex.delete(targetCharId);

    return { guild, kickedName: targetCharId };
  }

  /**
   * Change a member's rank (master only). Returns error string on failure.
   */
  changeRank(masterCharId: string, targetCharId: string, newRank: GuildRank): string | undefined {
    if (this.getRank(masterCharId) !== "master") return "Only the master can change ranks.";

    const guild = this.getGuildForChar(masterCharId);
    if (!guild) return "You are not in a guild.";

    if (!guild.roster.has(targetCharId)) return "That player is not in your guild.";

    // Cannot change your own rank (you're always master).
    if (masterCharId === targetCharId) return "You cannot change your own rank.";

    guild.roster.set(targetCharId, newRank);
    return undefined;
  }

  // ─── Guild Chat ───────────────────────────────────────────────────────────

  /**
   * Build the list of online sessions to relay a guild chat message to.
   * The sender is excluded.
   */
  getGuildChatRecipients(senderCharId: string): OnlineMember[] {
    const guildId = this.memberIndex.get(senderCharId);
    if (!guildId) return [];

    const recipients: OnlineMember[] = [];
    for (const member of this.onlineMembers.values()) {
      if (member.charId === senderCharId) continue;
      const memberGuildId = this.memberIndex.get(member.charId);
      if (memberGuildId === guildId) recipients.push(member);
    }
    return recipients;
  }

  /**
   * Get all online guild members for a given charId's guild (including the char themselves).
   */
  getAllGuildOnline(charId: string): OnlineMember[] {
    const guildId = this.memberIndex.get(charId);
    if (!guildId) return [];

    const result: OnlineMember[] = [];
    for (const member of this.onlineMembers.values()) {
      const memberGuildId = this.memberIndex.get(member.charId);
      if (memberGuildId === guildId) result.push(member);
    }
    return result;
  }

  // ─── Build update payload ─────────────────────────────────────────────────

  /** Build a GuildUpdatePayload for a given character. */
  buildUpdate(charId: string): GuildUpdatePayload {
    const guildId = this.memberIndex.get(charId) ?? "";
    const guild = guildId ? this.guilds.get(guildId) : undefined;

    if (!guild) {
      return {
        guildId: "",
        guildName: "",
        emblem: { color: 0, label: "" },
        members: [],
        createdDate: 0,
      };
    }

    const members: GuildMember[] = [];
    for (const [cid, rank] of guild.roster) {
      // Find the member's info from online or use placeholder.
      let memberInfo: OnlineMember | undefined;
      for (const om of this.onlineMembers.values()) {
        if (om.charId === cid) {
          memberInfo = om;
          break;
        }
      }
      members.push({
        charId: cid,
        name: memberInfo?.name ?? cid,
        level: memberInfo?.level ?? 0,
        rank,
        online: !!memberInfo,
      });
    }

    return {
      guildId: guild.guildId,
      guildName: guild.name,
      emblem: guild.emblem,
      members,
      createdDate: guild.createdDate,
    };
  }

  /** Push a GuildUpdate to every online member of a guild. */
  pushUpdateToGuild(
    guild: GuildRecord,
    sendFn: (sessionId: string, payload: GuildUpdatePayload) => void,
  ): void {
    for (const charId of guild.roster.keys()) {
      for (const member of this.onlineMembers.values()) {
        if (member.charId === charId) {
          sendFn(member.sessionId, this.buildUpdate(charId));
        }
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private expireInvites(): void {
    const now = Date.now();
    for (const [key, invite] of this.pendingInvites) {
      if (invite.expiresAt <= now) this.pendingInvites.delete(key);
    }
  }
}

export const guildManager = new GuildManagerImpl();
