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

class ChannelRegistryImpl {
  /** sessionId → online player info. */
  private readonly players = new Map<string, OnlinePlayer>();

  /** charId → set of sessionIds (a char could theoretically have multiple sessions in tests). */
  private readonly charIndex = new Map<string, Set<string>>();

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
