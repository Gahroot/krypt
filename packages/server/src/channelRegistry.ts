/**
 * ChannelRegistry — global singleton that tracks all online players across ALL rooms/channels.
 *
 * Enables:
 *   - Cross-channel whisper (direct message a player on any channel)
 *   - Channel player counts for the channel-select UI
 *   - Guild chat already works via guildManager's send callbacks; this adds redundant
 *     tracking that could be used for party system expansion later.
 *
 * Registration happens in MapRoom.onJoin / onLeave — the room passes a `send` callback
 * that closes over the owning Colyseus Client.
 */
import { randomUUID } from "node:crypto";

/** Info tracked for each online player in the registry. */
export interface OnlinePlayer {
  sessionId: string;
  charId: string;
  playerName: string;
  level: number;
  mapId: string;
  channel: number;
  /** Per-session send callback — delivers messages to the player's current room client. */
  send: (type: string | number, payload: unknown) => void;
}

/** Channel player count for the channel list UI. */
export interface ChannelPlayerCount {
  channel: number;
  playerCount: number;
}

/**
 * A request to claim the single live session for a character.
 *
 * `generation` is the token a *transferring* client echoes back. It is minted by the
 * server on a fresh login and re-presented when the same client relocates between maps
 * or channels — so a relocation is recognised as the SAME session moving, not a second
 * login. Fresh logins omit it (or present a stale/unknown value).
 */
export interface SessionClaim {
  charId: string;
  sessionId: string;
  /** Generation token carried across map/channel transfers; absent on a fresh login. */
  generation?: string;
  /** Forcefully disconnect this session (used to kick an older duplicate login). */
  kick: (reason: string) => void;
}

/** Outcome of {@link ChannelRegistryImpl.claimSession}. */
export interface SessionClaimResult {
  /** Authoritative generation token for this session — newly minted or carried over. */
  generation: string;
  /** True when an older live session for the same character was kicked. */
  kickedOlderSession: boolean;
  /** True when this join was recognised as a continuation (map/channel transfer). */
  continuation: boolean;
}

/** Internal owner record for the single-live-session guard. */
interface SessionOwner {
  sessionId: string;
  generation: string;
  kick: (reason: string) => void;
}

class ChannelRegistryImpl {
  /** sessionId → online player info. */
  private readonly players = new Map<string, OnlinePlayer>();

  /** charId → set of sessionIds (a char could theoretically have multiple sessions in tests). */
  private readonly charIndex = new Map<string, Set<string>>();

  /** charId → the ONE authoritative live session (single-login guard). */
  private readonly sessionOwners = new Map<string, SessionOwner>();

  // ─── Single-live-session guard ─────────────────────────────────────────────

  /**
   * Claim the single live session for a character. Policy: **kick the older session**.
   *
   * Returns the authoritative generation token to hand back to the joining client. The
   * client must echo it on every subsequent map/channel transfer so that the brief
   * overlap (new room's onJoin can fire before the old room's onLeave) is recognised as
   * the same session relocating rather than a second login.
   */
  claimSession(claim: SessionClaim): SessionClaimResult {
    const existing = this.sessionOwners.get(claim.charId);

    // Continuation: the same logical login relocating between maps/channels. The
    // transferring client echoed the generation token it was issued, so a match means
    // this is NOT a second login — take over ownership silently, kick nobody.
    if (existing && claim.generation && claim.generation === existing.generation) {
      this.sessionOwners.set(claim.charId, {
        sessionId: claim.sessionId,
        generation: existing.generation,
        kick: claim.kick,
      });
      return { generation: existing.generation, kickedOlderSession: false, continuation: true };
    }

    // Genuine second login from a different session → kick the older one.
    let kickedOlderSession = false;
    if (existing && existing.sessionId !== claim.sessionId) {
      try {
        existing.kick("You have been logged in elsewhere.");
      } catch {
        /* old transport already gone — safe to ignore */
      }
      kickedOlderSession = true;
    }

    const generation = randomUUID();
    this.sessionOwners.set(claim.charId, {
      sessionId: claim.sessionId,
      generation,
      kick: claim.kick,
    });
    return { generation, kickedOlderSession, continuation: false };
  }

  /**
   * Release ownership on disconnect — but ONLY if the leaving session still owns it.
   * During a transfer the new session has already taken ownership, so the old session's
   * late onLeave must not clobber it (sessionId mismatch → no-op).
   */
  releaseSession(charId: string, sessionId: string): void {
    const existing = this.sessionOwners.get(charId);
    if (existing && existing.sessionId === sessionId) {
      this.sessionOwners.delete(charId);
    }
  }

  /** The session id that currently owns this character's single live session, if any. */
  ownerSessionId(charId: string): string | undefined {
    return this.sessionOwners.get(charId)?.sessionId;
  }

  /** The active generation token for a character's live session (diagnostics/tests). */
  ownerGeneration(charId: string): string | undefined {
    return this.sessionOwners.get(charId)?.generation;
  }

  // ─── Registration ─────────────────────────────────────────────────────────

  /** Register a player as online in a given channel. */
  register(info: OnlinePlayer): void {
    this.players.set(info.sessionId, info);
    let sessions = this.charIndex.get(info.charId);
    if (!sessions) {
      sessions = new Set();
      this.charIndex.set(info.charId, sessions);
    }
    sessions.add(info.sessionId);
  }

  /** Unregister a player on disconnect or channel switch. */
  unregister(sessionId: string): void {
    const info = this.players.get(sessionId);
    if (!info) return;
    this.players.delete(sessionId);
    const sessions = this.charIndex.get(info.charId);
    if (sessions) {
      sessions.delete(sessionId);
      if (sessions.size === 0) this.charIndex.delete(info.charId);
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /** Look up an online player by their session id. */
  getBySessionId(sessionId: string): OnlinePlayer | undefined {
    return this.players.get(sessionId);
  }

  /** Whether the given character is currently online in any room/channel. */
  isCharOnline(charId: string): boolean {
    const sessions = this.charIndex.get(charId);
    return !!sessions && sessions.size > 0;
  }

  /** Number of registered (live) sessions for a character. Should be ≤ 1 under the guard. */
  sessionCountForChar(charId: string): number {
    return this.charIndex.get(charId)?.size ?? 0;
  }

  /** Iterate over all online players (across every map and channel). */
  allPlayers(): IterableIterator<OnlinePlayer> {
    return this.players.values();
  }

  /** Find a player by name (case-insensitive) for whisper. Returns the first match. */
  findByName(name: string): OnlinePlayer | undefined {
    const lower = name.toLowerCase();
    for (const player of this.players.values()) {
      if (player.playerName.toLowerCase() === lower) return player;
    }
    return undefined;
  }

  /** Get all online players on a given map and channel. */
  getPlayersInChannel(mapId: string, channel: number): OnlinePlayer[] {
    const result: OnlinePlayer[] = [];
    for (const player of this.players.values()) {
      if (player.mapId === mapId && player.channel === channel) result.push(player);
    }
    return result;
  }

  /** Get player counts per channel for a given map. */
  getChannelCounts(mapId: string, totalChannels: number): ChannelPlayerCount[] {
    const counts: ChannelPlayerCount[] = Array.from({ length: totalChannels }, (_, i) => ({
      channel: i,
      playerCount: 0,
    }));
    for (const player of this.players.values()) {
      if (player.mapId === mapId && player.channel >= 0 && player.channel < totalChannels) {
        counts[player.channel].playerCount++;
      }
    }
    return counts;
  }

  /** Get total online player count across all channels (for diagnostics). */
  get totalOnline(): number {
    return this.players.size;
  }
}

/** Global singleton — imported by every MapRoom instance. */
export const channelRegistry = new ChannelRegistryImpl();
