/**
 * FriendManager — persistent per-account buddy list shared across ALL map rooms.
 *
 * Friends are bidirectional: when A adds B, both accounts gain each other.
 * Online status is broadcast to all online friends on join/leave.
 *
 * Follows the guildManager singleton pattern:
 *   - Load from DB on boot (via store.ts)
 *   - Persist snapshot on shutdown
 *   - Register/unregister online sessions for cross-room delivery
 */
import type { FriendEntry, OnlineStatusPayload } from "@maple/shared";
import { MessageType } from "./types";

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Maximum friends per account. */
export const FRIEND_MAX = 50;

// ─── Internal types ──────────────────────────────────────────────────────────

/** Online member info for cross-room friend notifications. */
export interface OnlineFriend {
  sessionId: string;
  accountId: string;
  charId: string;
  name: string;
  level: number;
  mapId: string;
  /** Per-session send callback — closes over the owning room's Client.send. */
  send: (type: string | number, payload: unknown) => void;
}

// ─── FriendManager singleton ─────────────────────────────────────────────────

class FriendManagerImpl {
  /**
   * accountId → Set<accountId> of friends. Bidirectional: if A friends B,
   * both `friends[A]` and `friends[B]` contain the other.
   */
  private friends = new Map<string, Set<string>>();

  /** sessionId → online member info (for cross-room notifications). */
  private online = new Map<string, OnlineFriend>();

  // ─── Persistence hooks ─────────────────────────────────────────────────────

  /** Load from a pre-populated map (called from store.ts on boot). */
  loadFriends(raw: Map<string, string[]>): void {
    this.friends.clear();
    for (const [accountId, friendIds] of raw) {
      this.friends.set(accountId, new Set(friendIds));
    }
  }

  /** Return a serialisable snapshot for persistence. */
  snapshotForPersist(): Map<string, string[]> {
    const snap = new Map<string, string[]>();
    for (const [accountId, friendSet] of this.friends) {
      snap.set(accountId, [...friendSet]);
    }
    return snap;
  }

  // ─── Friend list mutations ──────────────────────────────────────────────────

  /**
   * Add two accounts as friends (bidirectional).
   * Returns an error string on failure, or null on success.
   */
  addFriend(aAccountId: string, bAccountId: string): string | null {
    if (aAccountId === bAccountId) return "You cannot add yourself.";

    const setA = this.getOrCreate(aAccountId);
    const setB = this.getOrCreate(bAccountId);

    if (setA.has(bAccountId)) return "Already friends.";
    if (setA.size >= FRIEND_MAX) return "Your friends list is full.";
    if (setB.size >= FRIEND_MAX) return "Their friends list is full.";

    setA.add(bAccountId);
    setB.add(aAccountId);
    return null;
  }

  /** Remove the friend relationship between two accounts (bidirectional). */
  removeFriend(aAccountId: string, bAccountId: string): void {
    this.friends.get(aAccountId)?.delete(bAccountId);
    this.friends.get(bAccountId)?.delete(aAccountId);
  }

  /** Check if two accounts are mutual friends. */
  areFriends(aAccountId: string, bAccountId: string): boolean {
    return this.friends.get(aAccountId)?.has(bAccountId) ?? false;
  }

  /** Get the set of friend accountIds for a given account (may be empty). */
  getFriendIds(accountId: string): string[] {
    const set = this.friends.get(accountId);
    return set ? [...set] : [];
  }

  // ─── Online tracking ────────────────────────────────────────────────────────

  /** Register a player as online with a send callback for cross-room delivery. */
  registerOnline(info: OnlineFriend): void {
    this.online.set(info.sessionId, info);
  }

  /** Unregister a player on disconnect or channel switch. */
  unregisterOnline(sessionId: string): void {
    this.online.delete(sessionId);
  }

  /** Find an online friend by name (case-insensitive) for whisper routing. */
  findByName(name: string): OnlineFriend | undefined {
    const lower = name.toLowerCase();
    for (const info of this.online.values()) {
      if (info.name.toLowerCase() === lower) return info;
    }
    return undefined;
  }

  /** Find an online friend by accountId. Returns the first match. */
  findByAccountId(accountId: string): OnlineFriend | undefined {
    for (const info of this.online.values()) {
      if (info.accountId === accountId) return info;
    }
    return undefined;
  }

  /**
   * Build a FriendEntry list for a given account, resolving friend accountIds
   * to character info via the provided lookup function.
   *
   * @param accountId - The account whose friends list to build.
   * @param lookupCharByAccountId - Resolves accountId → { charId, name, level } or undefined.
   * @param isOnline - Checks if an accountId is currently online and returns mapId if so.
   */
  buildFriendList(
    accountId: string,
    lookupCharByAccountId: (
      acctId: string,
    ) => { charId: string; name: string; level: number } | undefined,
    getOnlineInfo: (acctId: string) => { online: boolean; mapId?: string } | undefined,
  ): FriendEntry[] {
    const friendIds = this.getFriendIds(accountId);
    const entries: FriendEntry[] = [];
    for (const fid of friendIds) {
      const charInfo = lookupCharByAccountId(fid);
      if (!charInfo) continue; // friend's character was deleted
      const onlineInfo = getOnlineInfo(fid);
      entries.push({
        charId: charInfo.charId,
        name: charInfo.name,
        level: charInfo.level,
        online: onlineInfo?.online ?? false,
        mapId: onlineInfo?.mapId,
      });
    }
    return entries;
  }

  // ─── Status broadcast ───────────────────────────────────────────────────────

  /**
   * Broadcast an online/offline status change for a given accountId to all
   * of that account's online friends.
   */
  broadcastStatus(
    accountId: string,
    charId: string,
    name: string,
    level: number,
    online: boolean,
    mapId?: string,
  ): void {
    const friendIds = this.getFriendIds(accountId);
    const updates: OnlineStatusPayload["updates"] = [{ charId, name, online, mapId }];

    for (const fid of friendIds) {
      // Find any online session for this friend account and push the update.
      for (const info of this.online.values()) {
        if (info.accountId === fid) {
          info.send(MessageType.ONLINE_STATUS, { updates } satisfies OnlineStatusPayload);
          break; // one send per accountId is enough
        }
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private getOrCreate(accountId: string): Set<string> {
    let set = this.friends.get(accountId);
    if (!set) {
      set = new Set();
      this.friends.set(accountId, set);
    }
    return set;
  }
}

/** Global singleton — imported by every MapRoom instance. */
export const friendManager = new FriendManagerImpl();
