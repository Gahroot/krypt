/**
 * PartyManager — global singleton party system with cross-map support.
 *
 * Parties persist across map changes (like GuildManager). Membership is keyed by
 * charId (stable), not sessionId (room-scoped). Online tracking is separate with
 * send callbacks for cross-room relay.
 *
 * Follows the GuildManager singleton pattern at guildManager.ts.
 */
import type {
  LootRule,
  PartyUpdatePayload,
  PartyMemberSnapshot,
  LfgListingSnapshot,
} from "@maple/shared";

// ─── Tunables ──────────────────────────────────────────────────────────────
/** Maximum members per party. */
export const PARTY_MAX_MEMBERS = 6;

/** EXP bonus applied when a party kill shares EXP (1.1 = 10% bonus). */
const PARTY_EXP_BONUS = 1.1;

/** Proximity radius (px) for a party member to qualify for shared EXP. */
const PARTY_EXP_RANGE = 400;

/** How long (ms) an invite stays valid before auto-expiring. */
const INVITE_EXPIRY_MS = 30_000;

/** How long (ms) a member can be offline before being swept from the party. */
const OFFLINE_SWEEP_MS = 5 * 60 * 1000;

/** How often (ms) to run the offline sweep. */
const SWEEP_INTERVAL_MS = 60_000;

/** How long (ms) an LFG listing stays active. */
const LFG_EXPIRY_MS = 5 * 60 * 1000;

// ─── Internal types ────────────────────────────────────────────────────────

export interface PartyMember {
  charId: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  dead: boolean;
  mapId: string;
  x: number;
  y: number;
}

export interface PendingInvite {
  fromCharId: string;
  toCharId: string;
  expiresAt: number;
}

export interface Party {
  id: string;
  leaderCharId: string;
  members: Map<string, PartyMember>; // charId → member
  lootRule: LootRule;
  roundRobinIndex: number;
}

export interface OnlineMember {
  sessionId: string;
  charId: string;
  name: string;
  level: number;
  mapId: string;
  send: (type: string | number, payload: unknown) => void;
}

export interface LfgListing {
  listingId: string;
  hostCharId: string;
  hostName: string;
  hostLevel: number;
  contentType: string;
  levelMin: number;
  levelMax: number;
  message: string;
  createdAt: number;
}

// ─── PartyManager singleton ────────────────────────────────────────────────

class PartyManagerImpl {
  /** All active parties by id. */
  private readonly parties = new Map<string, Party>();

  /** charId → party (fast lookup for membership). */
  private readonly charPartyIndex = new Map<string, Party>();

  /** Pending invites keyed by the invitee's charId. */
  private readonly pendingInvites = new Map<string, PendingInvite>();

  /** Online members keyed by sessionId (room-scoped). */
  private readonly onlineMembers = new Map<string, OnlineMember>();

  /** charId → sessionId (reverse index for finding online members). */
  private readonly charOnlineIndex = new Map<string, string>();

  /** charId → epoch-ms when the player was last seen online. */
  private readonly lastSeen = new Map<string, number>();

  /** LFG listings keyed by listingId. */
  private readonly lfgListings = new Map<string, LfgListing>();

  private nextPartyId = 1;
  private nextLfgId = 1;
  private lastSweep = Date.now();

  // ─── Online tracking ────────────────────────────────────────────────────

  /** Register a player as online in a room. */
  registerOnline(
    sessionId: string,
    charId: string,
    name: string,
    level: number,
    mapId: string,
    send: (type: string | number, payload: unknown) => void,
  ): void {
    this.onlineMembers.set(sessionId, { sessionId, charId, name, level, mapId, send });
    this.charOnlineIndex.set(charId, sessionId);
    this.lastSeen.set(charId, Date.now());

    // Update member stats if they're in a party.
    const member = this.getMemberByChar(charId);
    if (member) {
      member.name = name;
      member.level = level;
      member.mapId = mapId;
    }
  }

  /** Unregister a player from online tracking (called on room leave). */
  unregisterOnline(sessionId: string): void {
    const om = this.onlineMembers.get(sessionId);
    if (om) {
      this.lastSeen.set(om.charId, Date.now());
      // Only clear the charOnlineIndex if this session is still the active one.
      if (this.charOnlineIndex.get(om.charId) === sessionId) {
        this.charOnlineIndex.delete(om.charId);
      }
      this.onlineMembers.delete(sessionId);
    }
  }

  /** Update stats for an online party member (called periodically from MapRoom tick). */
  updateOnlineStats(
    charId: string,
    hp: number,
    maxHp: number,
    mp: number,
    maxMp: number,
    level: number,
    dead: boolean,
    x: number,
    y: number,
  ): void {
    const member = this.getMemberByChar(charId);
    if (member) {
      member.hp = hp;
      member.maxHp = maxHp;
      member.mp = mp;
      member.maxMp = maxMp;
      member.level = level;
      member.dead = dead;
      member.x = x;
      member.y = y;
    }
    // Also update the online member's level.
    const sid = this.charOnlineIndex.get(charId);
    if (sid) {
      const om = this.onlineMembers.get(sid);
      if (om) om.level = level;
    }
    this.lastSeen.set(charId, Date.now());
  }

  /** Get the online member info for a charId (or undefined). */
  getOnlineByChar(charId: string): OnlineMember | undefined {
    const sid = this.charOnlineIndex.get(charId);
    return sid ? this.onlineMembers.get(sid) : undefined;
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /** Get the party a charId belongs to (or undefined). */
  getPartyByChar(charId: string): Party | undefined {
    return this.charPartyIndex.get(charId);
  }

  /** Check if a charId is in a party. */
  inParty(charId: string): boolean {
    return this.charPartyIndex.has(charId);
  }

  /** Check if two characters are in the same party. */
  areInSameParty(a: string, b: string): boolean {
    const pa = this.charPartyIndex.get(a);
    if (!pa) return false;
    return pa === this.charPartyIndex.get(b);
  }

  /** Check if a charId is the leader of their party. */
  isLeader(charId: string): boolean {
    const party = this.charPartyIndex.get(charId);
    return party !== undefined && party.leaderCharId === charId;
  }

  /** Get all online party members for cross-room chat relay. */
  getPartyChatRecipients(senderCharId: string): OnlineMember[] {
    const party = this.charPartyIndex.get(senderCharId);
    if (!party) return [];

    const recipients: OnlineMember[] = [];
    for (const charId of party.members.keys()) {
      if (charId === senderCharId) continue;
      const om = this.getOnlineByChar(charId);
      if (om) recipients.push(om);
    }
    return recipients;
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  /**
   * Send a party invite. Cross-map: resolves target by name.
   * Returns an error string on failure, or undefined on success.
   */
  invite(fromCharId: string, fromName: string, targetName: string): string | undefined {
    // Resolve target by name in the global online registry.
    let targetCharId = "";
    for (const om of this.onlineMembers.values()) {
      if (om.name.toLowerCase() === targetName.toLowerCase()) {
        targetCharId = om.charId;
        break;
      }
    }
    if (!targetCharId) return `Player "${targetName}" not found online.`;

    // Can't invite yourself.
    if (fromCharId === targetCharId) return "Cannot invite yourself.";

    // Inviter must not already be in a party.
    if (this.inParty(fromCharId)) return "You are already in a party. Leave first.";

    // Target must not already be in a party.
    if (this.inParty(targetCharId)) return "That player is already in a party.";

    // Expire old invites.
    this.expireInvites();

    // Target must not have a pending invite.
    if (this.pendingInvites.has(targetCharId)) {
      return "That player already has a pending invite.";
    }

    this.pendingInvites.set(targetCharId, {
      fromCharId,
      toCharId: targetCharId,
      expiresAt: Date.now() + INVITE_EXPIRY_MS,
    });

    // Notify the target via their send callback.
    const targetOm = this.getOnlineByChar(targetCharId);
    if (targetOm) {
      targetOm.send(
        53, // MessageType.PARTY_INVITE_RECEIVED
        { fromCharId, fromName },
      );
    }

    return undefined;
  }

  /**
   * Accept a party invite. Returns { party, isNew } or an error string.
   */
  accept(
    acceptCharId: string,
    acceptName: string,
    acceptLevel: number,
    acceptMapId: string,
    fromCharId: string,
  ): { party: Party; isNew: boolean } | string {
    this.expireInvites();

    const invite = this.pendingInvites.get(acceptCharId);
    if (!invite || invite.fromCharId !== fromCharId) {
      return "No pending invite from that player.";
    }

    // Both must still be party-free.
    if (this.inParty(fromCharId)) {
      this.pendingInvites.delete(acceptCharId);
      return "That player joined another party.";
    }
    if (this.inParty(acceptCharId)) {
      this.pendingInvites.delete(acceptCharId);
      return "You are already in a party.";
    }

    this.pendingInvites.delete(acceptCharId);

    // Check if the inviter already has a party (edge case).
    let party = this.charPartyIndex.get(fromCharId);
    let isNew = false;

    if (!party) {
      // Create a new party with the inviter as leader.
      party = this.createParty(fromCharId);
      party.members.set(fromCharId, {
        charId: fromCharId,
        name: "",
        level: 0,
        hp: 0,
        maxHp: 0,
        mp: 0,
        maxMp: 0,
        dead: false,
        mapId: "",
        x: 0,
        y: 0,
      });
      // Fill in inviter stats from online registry.
      const fromOm = this.getOnlineByChar(fromCharId);
      const fromMember = party.members.get(fromCharId);
      if (fromOm && fromMember) {
        fromMember.name = fromOm.name;
        fromMember.level = fromOm.level;
        fromMember.mapId = fromOm.mapId;
      }
      this.charPartyIndex.set(fromCharId, party);
      isNew = true;
    }

    // Check capacity.
    if (party.members.size >= PARTY_MAX_MEMBERS) {
      return "Party is full.";
    }

    // Add the accepter.
    party.members.set(acceptCharId, {
      charId: acceptCharId,
      name: acceptName,
      level: acceptLevel,
      hp: 0,
      maxHp: 0,
      mp: 0,
      maxMp: 0,
      dead: false,
      mapId: acceptMapId,
      x: 0,
      y: 0,
    });
    this.charPartyIndex.set(acceptCharId, party);

    // Fill in accepter stats from online registry.
    const acceptOm = this.getOnlineByChar(acceptCharId);
    const acceptMember = party.members.get(acceptCharId);
    if (acceptOm && acceptMember) {
      acceptMember.name = acceptOm.name;
      acceptMember.level = acceptOm.level;
      acceptMember.mapId = acceptOm.mapId;
    }

    return { party, isNew };
  }

  /**
   * Leave the current party. Returns info about the departure.
   */
  leave(
    charId: string,
  ): { party: Party; wasLeader: boolean; newLeaderCharId?: string } | undefined {
    const party = this.charPartyIndex.get(charId);
    if (!party) return undefined;

    party.members.delete(charId);
    this.charPartyIndex.delete(charId);

    const wasLeader = party.leaderCharId === charId;
    let newLeaderCharId: string | undefined;

    if (party.members.size === 0) {
      // Party dissolved.
      this.parties.delete(party.id);
      return { party, wasLeader };
    }

    if (wasLeader) {
      // Reassign to the first remaining member.
      const firstCharId = party.members.keys().next().value;
      if (firstCharId !== undefined) {
        party.leaderCharId = firstCharId;
        newLeaderCharId = firstCharId;
      }
    }

    return { party, wasLeader, newLeaderCharId };
  }

  /**
   * Kick a member (leader only). Returns info about the kick.
   */
  kick(kickerCharId: string, targetCharId: string): { party: Party; kickedName: string } | string {
    const party = this.charPartyIndex.get(kickerCharId);
    if (!party) return "You are not in a party.";
    if (party.leaderCharId !== kickerCharId) return "Only the leader can kick members.";

    const target = party.members.get(targetCharId);
    if (!target) return "That player is not in your party.";

    const kickedName = target.name;
    party.members.delete(targetCharId);
    this.charPartyIndex.delete(targetCharId);

    return { party, kickedName };
  }

  /**
   * Handle a disconnect (called from periodic sweep, NOT from onLeave).
   * Removes the player from any party and reassigns leader if needed.
   */
  handleDisconnect(charId: string):
    | {
        party: Party;
        wasLeader: boolean;
        newLeaderCharId?: string;
      }
    | undefined {
    return this.leave(charId);
  }

  // ─── Loot rules ──────────────────────────────────────────────────────────

  /** Leader changes the party loot rule. */
  setLootRule(charId: string, rule: LootRule): string | undefined {
    const party = this.charPartyIndex.get(charId);
    if (!party) return "You are not in a party.";
    if (party.leaderCharId !== charId) return "Only the leader can change the loot rule.";
    party.lootRule = rule;
    party.roundRobinIndex = 0;
    return undefined;
  }

  /** Check if a player can pick up loot based on the party's loot rule. */
  canPickup(charId: string): boolean {
    const party = this.charPartyIndex.get(charId);
    if (!party) return true; // Solo: always allow.

    switch (party.lootRule) {
      case "ffa":
        return true;
      case "leader":
        return party.leaderCharId === charId;
      case "roundRobin": {
        const memberKeys = Array.from(party.members.keys());
        const nextIndex = party.roundRobinIndex % memberKeys.length;
        return memberKeys[nextIndex] === charId;
      }
    }
  }

  /** Advance the round-robin counter after a successful pickup. */
  onPickup(charId: string): void {
    const party = this.charPartyIndex.get(charId);
    if (!party || party.lootRule !== "roundRobin") return;
    party.roundRobinIndex = (party.roundRobinIndex + 1) % party.members.size;
  }

  // ─── EXP sharing ──────────────────────────────────────────────────────────

  /**
   * Compute shared EXP distribution for a party kill.
   * Only same-map members within range qualify.
   */
  computePartyExp(
    killer: { level: number; dead: boolean; x: number; y: number },
    killerCharId: string,
    killerMapId: string,
    mobExp: number,
    mobX: number,
    mobY: number,
  ): { charId: string; exp: number }[] {
    const party = this.charPartyIndex.get(killerCharId);

    // Solo kill — no party bonus.
    if (!party) {
      return [{ charId: killerCharId, exp: mobExp }];
    }

    // Find qualifying party members: alive, same map, within proximity range.
    const qualifying: string[] = [];
    for (const [charId, member] of party.members) {
      if (member.dead) continue;
      if (member.mapId !== killerMapId) continue;
      const dx = Math.abs(member.x - mobX);
      const dy = Math.abs(member.y - mobY);
      if (dx <= PARTY_EXP_RANGE && dy <= PARTY_EXP_RANGE) {
        qualifying.push(charId);
      }
    }

    // Ensure the killer is always included.
    if (!qualifying.includes(killerCharId) && !killer.dead) {
      qualifying.push(killerCharId);
    }

    if (qualifying.length === 0) {
      return [{ charId: killerCharId, exp: mobExp }];
    }

    // Split equally with party bonus.
    const share = Math.max(1, Math.floor((mobExp * PARTY_EXP_BONUS) / qualifying.length));

    return qualifying.map((charId) => ({ charId, exp: share }));
  }

  // ─── Online sweep ────────────────────────────────────────────────────────

  /** Sweep offline party members (handles true disconnects). */
  sweepOfflineMembers(): void {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;

    for (const party of this.parties.values()) {
      const toRemove: string[] = [];
      for (const [charId] of party.members) {
        const lastSeenMs = this.lastSeen.get(charId) ?? 0;
        if (now - lastSeenMs > OFFLINE_SWEEP_MS) {
          toRemove.push(charId);
        }
      }
      for (const charId of toRemove) {
        this.leave(charId);
      }
    }
  }

  // ─── Build update payload ────────────────────────────────────────────────

  /** Build a PartyUpdatePayload for a given charId. */
  buildUpdate(charId: string): PartyUpdatePayload {
    const party = this.charPartyIndex.get(charId);
    if (!party) {
      return { partyId: "", members: [], lootRule: "ffa" };
    }

    const members: PartyMemberSnapshot[] = Array.from(party.members.values()).map((m) => ({
      charId: m.charId,
      sessionId: this.charOnlineIndex.get(m.charId) ?? "",
      name: m.name,
      level: m.level,
      hp: m.hp,
      maxHp: m.maxHp,
      mp: m.mp,
      maxMp: m.maxMp,
      dead: m.dead,
      mapId: m.mapId,
      leader: m.charId === party.leaderCharId,
    }));

    return { partyId: party.id, members, lootRule: party.lootRule };
  }

  /**
   * Build PartyUpdatePayload for every member in a party, with cross-room relay.
   */
  buildUpdateForParty(party: Party): { charId: string; payload: PartyUpdatePayload }[] {
    const members: PartyMemberSnapshot[] = Array.from(party.members.values()).map((m) => ({
      charId: m.charId,
      sessionId: this.charOnlineIndex.get(m.charId) ?? "",
      name: m.name,
      level: m.level,
      hp: m.hp,
      maxHp: m.maxHp,
      mp: m.mp,
      maxMp: m.maxMp,
      dead: m.dead,
      mapId: m.mapId,
      leader: m.charId === party.leaderCharId,
    }));

    const payload = { partyId: party.id, members, lootRule: party.lootRule };

    return Array.from(party.members.keys()).map((cid) => ({
      charId: cid,
      payload,
    }));
  }

  /**
   * Send a party update to all online members (cross-room relay).
   */
  syncPartyToAllMembers(party: Party): void {
    for (const { charId, payload } of this.buildUpdateForParty(party)) {
      const om = this.getOnlineByChar(charId);
      if (om) {
        om.send(52, payload); // MessageType.PARTY_UPDATE
      }
    }
  }

  // ─── LFG (Party Finder) ─────────────────────────────────────────────────

  /** Post an LFG listing. Returns the listing or an error string. */
  postLfg(
    charId: string,
    name: string,
    level: number,
    contentType: string,
    levelMin: number,
    levelMax: number,
    message: string,
  ): LfgListing | string {
    // Can't post if already in a party.
    if (this.inParty(charId)) return "Leave your party before posting a listing.";

    // Expire old listings.
    this.expireLfgListings();

    // Check if already has a listing.
    for (const listing of this.lfgListings.values()) {
      if (listing.hostCharId === charId) {
        return "You already have an active listing. Remove it first.";
      }
    }

    const listingId = `lfg_${this.nextLfgId++}`;
    const listing: LfgListing = {
      listingId,
      hostCharId: charId,
      hostName: name,
      hostLevel: level,
      contentType: contentType || "grind",
      levelMin: Math.max(1, levelMin),
      levelMax: Math.min(200, Math.max(levelMin, levelMax)),
      message: message.slice(0, 200),
      createdAt: Date.now(),
    };

    this.lfgListings.set(listingId, listing);
    return listing;
  }

  /** Get all active LFG listings (expires stale ones first). */
  getLfgListings(): LfgListingSnapshot[] {
    this.expireLfgListings();

    return Array.from(this.lfgListings.values()).map((l) => ({
      listingId: l.listingId,
      hostCharId: l.hostCharId,
      hostName: l.hostName,
      hostLevel: l.hostLevel,
      contentType: l.contentType,
      levelMin: l.levelMin,
      levelMax: l.levelMax,
      message: l.message,
      memberCount: 1,
      maxMembers: PARTY_MAX_MEMBERS,
      createdAt: l.createdAt,
    }));
  }

  /** Join an LFG listing — forms a party with the host. */
  joinLfg(
    joinerCharId: string,
    joinerName: string,
    joinerLevel: number,
    joinerMapId: string,
    listingId: string,
  ): { party: Party; isNew: boolean } | string {
    this.expireLfgListings();

    if (this.inParty(joinerCharId)) return "You are already in a party.";

    const listing = this.lfgListings.get(listingId);
    if (!listing) return "Listing not found or expired.";

    // Can't join your own listing.
    if (listing.hostCharId === joinerCharId) return "Cannot join your own listing.";

    // Level check.
    if (joinerLevel < listing.levelMin || joinerLevel > listing.levelMax) {
      return `Level must be ${listing.levelMin}–${listing.levelMax}.`;
    }

    // Check if host is still online.
    const hostOm = this.getOnlineByChar(listing.hostCharId);
    if (!hostOm) {
      this.lfgListings.delete(listingId);
      return "Host is no longer online.";
    }

    // Remove the listing.
    this.lfgListings.delete(listingId);

    // Form a party with the host as leader.
    const hostCharId = listing.hostCharId;
    let party = this.charPartyIndex.get(hostCharId);
    let isNew = false;

    if (!party) {
      party = this.createParty(hostCharId);
      // Add host as first member.
      const hostMember: PartyMember = {
        charId: hostCharId,
        name: listing.hostName,
        level: listing.hostLevel,
        hp: 0,
        maxHp: 0,
        mp: 0,
        maxMp: 0,
        dead: false,
        mapId: hostOm.mapId,
        x: 0,
        y: 0,
      };
      // Fill host stats from online.
      const hOm = this.getOnlineByChar(hostCharId);
      if (hOm) {
        hostMember.name = hOm.name;
        hostMember.level = hOm.level;
        hostMember.mapId = hOm.mapId;
      }
      party.members.set(hostCharId, hostMember);
      this.charPartyIndex.set(hostCharId, party);
      isNew = true;
    }

    if (party.members.size >= PARTY_MAX_MEMBERS) {
      return "Party is full.";
    }

    // Add the joiner.
    party.members.set(joinerCharId, {
      charId: joinerCharId,
      name: joinerName,
      level: joinerLevel,
      hp: 0,
      maxHp: 0,
      mp: 0,
      maxMp: 0,
      dead: false,
      mapId: joinerMapId,
      x: 0,
      y: 0,
    });
    this.charPartyIndex.set(joinerCharId, party);

    return { party, isNew };
  }

  /** Remove your own LFG listing. */
  removeLfg(charId: string): boolean {
    for (const [id, listing] of this.lfgListings) {
      if (listing.hostCharId === charId) {
        this.lfgListings.delete(id);
        return true;
      }
    }
    return false;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private getMemberByChar(charId: string): PartyMember | undefined {
    const party = this.charPartyIndex.get(charId);
    return party?.members.get(charId);
  }

  private createParty(leaderCharId: string): Party {
    const id = `party_${this.nextPartyId++}`;
    const party: Party = {
      id,
      leaderCharId,
      members: new Map(),
      lootRule: "ffa",
      roundRobinIndex: 0,
    };
    this.parties.set(id, party);
    return party;
  }

  private expireInvites(): void {
    const now = Date.now();
    for (const [key, invite] of this.pendingInvites) {
      if (invite.expiresAt <= now) this.pendingInvites.delete(key);
    }
  }

  private expireLfgListings(): void {
    const now = Date.now();
    for (const [id, listing] of this.lfgListings) {
      if (now - listing.createdAt > LFG_EXPIRY_MS) {
        this.lfgListings.delete(id);
      }
    }
  }
}

export const partyManager = new PartyManagerImpl();
