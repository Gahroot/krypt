/**
 * AuthedRoom — base room that authenticates every client before they join AND wires
 * the shared observability layer every room inherits:
 *
 *   - `onUncaughtException` (Colyseus 0.17): defining this method makes Colyseus wrap
 *     every message handler, lifecycle hook, simulation interval and timer in try/catch
 *     and route the error HERE instead of letting it tear the room down. So a thrown
 *     error in a handler is logged with context and the room keeps serving everyone else.
 *   - `roomLog`: a child logger pre-bound with room correlation context (roomName,
 *     roomId, channel) so every line a room emits is greppable by room.
 *   - lifecycle helpers (`logCreate` / `logJoin` / `logLeave` / `logDispose`) for
 *     consistent, structured create/dispose/join/leave logs that carry `accountId`.
 *
 * ## Auth
 *
 * Colyseus 0.17 calls the static `onAuth(token, options, context)` during matchmaking,
 * BEFORE `onJoin`. Whatever it returns becomes `client.auth` (and is forwarded to the
 * room process with the seat reservation). We verify a server-issued signed token and
 * return the trusted `{ accountId }`. Returning a falsy value makes Colyseus reject the
 * join with `AUTH_FAILED`.
 *
 * Every room MUST derive identity from `client.auth.accountId` — never from
 * `options.accountId`, which is attacker-controlled.
 */
import {
  Room,
  ServerError,
  OnMessageException,
  type AuthContext,
  type Client,
  type RoomException,
  type RoomMethodName,
} from "colyseus";
import {
  isProtocolCompatible,
  PROTOCOL_MISMATCH_CODE,
  PROTOCOL_MISMATCH_MESSAGE,
} from "@maple/shared";
import { verifyToken } from "../auth";
import { log, type Logger, type LogMeta } from "../logger";
import { captureException } from "../errorTracker";

/** The shape stored on `client.auth` after a successful authentication. */
export interface RoomAuth {
  accountId: string;
}

export abstract class AuthedRoom<State = unknown> extends Room<State> {
  private _roomLog?: Logger;

  /**
   * Logger bound with this room's correlation context. Lazily built because `roomId`
   * isn't assigned until after construction. Use for any room-scoped logging so lines
   * are greppable by `roomName` / `roomId`.
   */
  protected get roomLog(): Logger {
    if (!this._roomLog) {
      this._roomLog = log.child({
        room: this.roomName,
        roomId: this.roomId,
        channel: (this as { channel?: number }).channel,
      });
    }
    return this._roomLog;
  }

  /**
   * Resolve the persistent accountId for a session, for error/lifecycle context.
   * Default: none. Rooms that track sessions (e.g. MapRoom's `sessionAccount`) override
   * this so logs carry the real account behind a sessionId.
   */
  protected accountIdForSession(_sessionId: string): string | undefined {
    return undefined;
  }

  // ─── Lifecycle logging helpers ──────────────────────────────────────────────
  /** Log room creation. Call from `onCreate`. */
  protected logCreate(meta?: LogMeta): void {
    this.roomLog.info("room created", meta);
  }

  /** Log room disposal. Call from `onDispose`. */
  protected logDispose(meta?: LogMeta): void {
    this.roomLog.info("room disposed", meta);
  }

  /** Log a client join with its accountId. Call from `onJoin` once identity is known. */
  protected logJoin(client: Client, accountId: string, meta?: LogMeta): void {
    this.roomLog.info("client joined", { sessionId: client.sessionId, accountId, ...meta });
  }

  /** Log a client leave. Call from `onLeave`. */
  protected logLeave(client: Client, meta?: LogMeta): void {
    this.roomLog.info("client left", {
      sessionId: client.sessionId,
      accountId: this.accountIdForSession(client.sessionId),
      ...meta,
    });
  }

  /**
   * Catch-all for errors thrown anywhere in the room's handlers/lifecycle. Logging here
   * (instead of crashing) is what keeps a single bad message or buggy handler from taking
   * the whole room — and everyone in it — offline. The original throw is `error.cause`.
   */
  onUncaughtException(error: RoomException, methodName: RoomMethodName): void {
    const meta: LogMeta = { method: methodName, err: error.cause ?? error };

    // OnMessageException carries the client + the message type/payload that triggered it.
    if (error instanceof OnMessageException) {
      const sessionId = error.client?.sessionId;
      meta.sessionId = sessionId;
      meta.accountId = sessionId ? this.accountIdForSession(sessionId) : undefined;
      meta.messageType = error.type;
      // NOTE: payload is intentionally omitted — it is attacker-controlled and may carry
      // PII/secrets; redaction still applies if a future change opts to include it.
    } else {
      const withClient = error as { client?: Client };
      if (withClient.client?.sessionId) {
        meta.sessionId = withClient.client.sessionId;
        meta.accountId = this.accountIdForSession(withClient.client.sessionId);
      }
    }

    this.roomLog.error("room handler error", meta);
    captureException(error.cause ?? error, {
      room: this.roomName,
      roomId: this.roomId,
      method: methodName,
      sessionId: meta.sessionId,
      accountId: meta.accountId,
      messageType: meta.messageType,
    });
  }

  /**
   * Authenticate a joining client. The token is taken from the `Authorization: Bearer`
   * header (set via `client.auth.token` on the SDK) and, as a fallback, from
   * `options.token` — this keeps the in-process test harness simple.
   *
   * @returns `{ accountId }` on success, which Colyseus assigns to `client.auth`.
   * @throws  `ServerError(PROTOCOL_MISMATCH_CODE)` for a stale client (so it can be told to
   *          refresh); returns `false` on a bad/missing token to make Colyseus reject the join.
   */
  static async onAuth(
    token: string,
    options: { token?: string; protocolVersion?: number } = {},
    _context?: AuthContext,
  ): Promise<RoomAuth | false> {
    // Compatibility gate FIRST: a stale client (built against an older wire protocol) must be
    // told to refresh rather than allowed to join and silently misbehave. Throwing a ServerError
    // with a dedicated code propagates that code + message to the client SDK as a MatchMakeError,
    // which the client classifies as a "version" failure and surfaces with a reload button.
    // An absent protocolVersion (legacy/unversioned caller, e.g. the in-process test harness) is
    // treated as compatible — see `isProtocolCompatible`.
    if (!isProtocolCompatible(options?.protocolVersion)) {
      throw new ServerError(PROTOCOL_MISMATCH_CODE, PROTOCOL_MISMATCH_MESSAGE);
    }

    const presented = token || options?.token;
    const verified = verifyToken(presented);
    if (!verified) {
      // Falsy return → Colyseus rejects with ErrorCode.AUTH_FAILED.
      return false;
    }
    return { accountId: verified.accountId } satisfies RoomAuth;
  }
}
