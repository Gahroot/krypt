/**
 * Server configuration — registers rooms and HTTP routes.
 * Uses the Colyseus 0.17 declarative API (defineServer / defineRoom).
 *
 * ## Channel System
 *
 * Each map hosts `CHANNELS_PER_MAP` parallel room instances (channels).
 * Room names follow the pattern `{mapId}__ch{N}` — e.g. `dawn_isle__ch0`, `dawn_isle__ch1`.
 * The legacy bare names (`dawn_isle`, `meadowfield`, etc.) still work and map to channel 0
 * for backward compatibility with existing clients and tests.
 *
 * Clients can request a channel list via `GET /channels?mapId=dawn_isle` and switch channels
 * by sending `CHANNEL_SWITCH` to their current room.
 */
import { defineServer, defineRoom, monitor, playground, matchMaker } from "colyseus";
import type { RegisteredHandler } from "colyseus";
import express, { type Request, type Response } from "express";
import { MAPS as GAME_MAPS, ClassArchetype } from "@maple/shared";
import cors from "cors";
import { log } from "./logger";
import {
  validateCharacterNameFormat,
  sanitizeAppearance,
  characterSummary,
  MAX_CHARACTERS_PER_ACCOUNT,
  NAME_TAKEN_CODE,
  NAME_TAKEN_MESSAGE,
} from "./characters";

import { MapRoom } from "./rooms/MapRoom";
import { MarketRoom } from "./rooms/MarketRoom";
import { PartyQuestRoom } from "./rooms/PartyQuestRoom";
import { channelRegistry } from "./channelRegistry";
import { feedbackStore, moderationStore, accountStore } from "./persistence/store";
import {
  signToken,
  verifyToken,
  newGuestAccountId,
  issueWalletNonce,
  verifyWalletSignature,
  isValidWalletAddress,
  isValidEmail,
  loginRateLimited,
  resetLoginRate,
} from "./auth";

// ─── Uptime tracking ────────────────────────────────────────────────────────
const STARTED_AT = Date.now();

// ─── Channel configuration ───────────────────────────────────────────────────
/** Number of parallel channels per map. */
export const CHANNELS_PER_MAP = 3;

/**
 * Maps intentionally kept OUT of the room registry. Add an id here (with a
 * reason) only if a map must never be joinable as a standalone channelled room.
 * Empty by default — every authored zone in `@maple/shared` is joinable.
 */
const EXCLUDED_MAPS = new Set<string>([]);

/**
 * All maps that support channels — derived from the shared GAME_MAPS registry
 * (the single source of truth) so every authored, portal-reachable zone is
 * joinable without hand-maintaining a parallel list.
 *
 * `defineRoom` only registers a room *handler*; Colyseus instantiates a room
 * (and runs `MapRoom.onCreate` → mob spawns) lazily on first join. Registering
 * every map × channel is therefore cheap at boot — no simulation runs until a
 * client actually joins a given room.
 */
const MAPS = Object.keys(GAME_MAPS).filter((id) => !EXCLUDED_MAPS.has(id));

// ─── Room registration ───────────────────────────────────────────────────────
const rooms: Record<string, RegisteredHandler> = {};

for (const mapId of MAPS) {
  // Legacy bare name → channel 0 (backward compat for existing tests / clients).
  rooms[mapId] = defineRoom(MapRoom, { mapId, channel: 0 });

  // Explicit channel rooms: `{mapId}__ch0`, `{mapId}__ch1`, …
  for (let ch = 0; ch < CHANNELS_PER_MAP; ch++) {
    rooms[`${mapId}__ch${ch}`] = defineRoom(MapRoom, { mapId, channel: ch });
  }
}

// The Free Market — off-chain Mesos order book.
rooms["market_room"] = defineRoom(MarketRoom);

// Party Quest instances (created dynamically per run).
rooms["pq"] = defineRoom(PartyQuestRoom);

const server = defineServer({
  rooms,

  express: (app) => {
    // ─── CORS ────────────────────────────────────────────────────────────────
    const origin = process.env.CORS_ORIGIN || "*";
    app.use(cors({ origin }));

    // ─── JSON body parsing ───────────────────────────────────────────────────
    // Required by the /auth/* and /admin/* POST handlers that read req.body.
    app.use(express.json());

    // ─── Request logging ─────────────────────────────────────────────────────
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        log.info("request", {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - start,
        });
      });
      next();
    });

    // Dev-only interactive room playground.
    if (process.env.NODE_ENV !== "production") {
      app.use("/playground", playground());
    }

    // State inspector — protected behind MONITOR_SECRET in production.
    const monitorSecret = process.env.MONITOR_SECRET;
    if (process.env.NODE_ENV === "production" && monitorSecret) {
      app.use("/monitor", (req, res, next) => {
        const token = req.query.token ?? req.headers["x-monitor-token"];
        if (token !== monitorSecret) {
          res.status(401).json({ error: "unauthorized" });
          return;
        }
        monitor()(req, res, next);
      });
    } else {
      app.use("/monitor", monitor());
    }

    // ─── Health / liveness probe ─────────────────────────────────────────────
    app.get("/healthz", (_req, res) => {
      res.json({ status: "ok" });
    });

    // ─── Auth: issue server-signed session tokens ────────────────────────────
    // Identity (accountId) is ALWAYS server-issued. Clients authenticate here,
    // store the returned token, and present it on every room join (onAuth verifies
    // it). A client can never pick its own accountId.

    // Guest sign-in — mint a brand-new server-issued account so new testers get in
    // fast. The accountId is random (64-bit) and bound into the signed token.
    app.post("/auth/guest", (_req, res) => {
      const accountId = newGuestAccountId();
      accountStore.getOrCreate(accountId);
      res.json({ token: signToken(accountId), accountId });
    });

    // Helper: reject a banned account before issuing a token.
    const denyIfBanned = (accountId: string, res: Response): boolean => {
      const acc = accountStore.getAccount(accountId);
      if (acc?.banned) {
        res.status(403).json({ error: acc.banReason || "account banned" });
        return true;
      }
      return false;
    };

    // Register — create a NEW credentialed account from an email + password. The
    // accountId is server-generated; the client stores the returned token. Passwords
    // are salted + bcrypt-hashed in the store; we never log them.
    app.post("/auth/register", (req, res) => {
      void (async () => {
        const body = (req.body ?? {}) as { email?: string; password?: string };
        if (!body.email || !isValidEmail(body.email)) {
          res.status(400).json({ error: "a valid email is required" });
          return;
        }
        if (!body.password) {
          res.status(400).json({ error: "a password is required" });
          return;
        }
        const result = await accountStore.createAuthAccount({
          email: body.email,
          password: body.password,
        });
        if (!result.ok || !result.accountId) {
          res.status(409).json({ error: result.reason ?? "could not register" });
          return;
        }
        res.json({ token: signToken(result.accountId), accountId: result.accountId });
      })();
    });

    // Login — two modes:
    //   (a) { email, password } → credential login; recovers the SAME account after a
    //       localStorage wipe / on another browser. Rate-limited per ip+email.
    //   (b) { token }           → silent refresh of a still-valid session token.
    // A missing/invalid credential or token is rejected, so accounts cannot be guessed.
    app.post("/auth/login", (req, res) => {
      void (async () => {
        const body = (req.body ?? {}) as { email?: string; password?: string; token?: string };

        // ── Mode (a): email + password ──────────────────────────────────────
        if (body.email || body.password) {
          const rateKey = `${req.ip ?? "?"}:${(body.email ?? "").toLowerCase()}`;
          if (loginRateLimited(rateKey)) {
            res.status(429).json({ error: "too many attempts, try again later" });
            return;
          }
          if (!body.email || !body.password) {
            res.status(400).json({ error: "email and password are required" });
            return;
          }
          const accountId = await accountStore.verifyEmailPassword(body.email, body.password);
          if (!accountId) {
            // Generic message — never reveal whether the email exists.
            res.status(401).json({ error: "invalid email or password" });
            return;
          }
          if (denyIfBanned(accountId, res)) return;
          resetLoginRate(rateKey);
          accountStore.getOrCreate(accountId);
          res.json({ token: signToken(accountId), accountId });
          return;
        }

        // ── Mode (b): token refresh ─────────────────────────────────────────
        const verified = verifyToken(body.token);
        if (!verified) {
          res.status(401).json({ error: "invalid or expired token" });
          return;
        }
        if (denyIfBanned(verified.accountId, res)) return;
        accountStore.getOrCreate(verified.accountId);
        res.json({ token: signToken(verified.accountId), accountId: verified.accountId });
      })();
    });

    // Refresh — exchange a still-valid session token for a fresh one with a new
    // expiry, keeping the SAME accountId. Long play sessions call this proactively
    // (before the token lapses) so a player is never kicked mid-game. The token may
    // arrive in the body (`{ token }`) or as an `Authorization: Bearer` header. An
    // expired/invalid/revoked token returns 401 so the client cleanly forces a
    // re-login; a banned account returns 403.
    app.post("/auth/refresh", (req, res) => {
      const body = (req.body ?? {}) as { token?: string };
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const verified = verifyToken(body.token || bearer);
      if (!verified) {
        res.status(401).json({ error: "invalid or expired token" });
        return;
      }
      if (denyIfBanned(verified.accountId, res)) return;
      accountStore.getOrCreate(verified.accountId);
      res.json({ token: signToken(verified.accountId), accountId: verified.accountId });
    });

    // Wallet sign-in — step 1: issue a single-use nonce for an address. The client
    // signs the returned `message` with their wallet (EIP-191 personal_sign).
    app.post("/auth/wallet/nonce", (req, res) => {
      const body = (req.body ?? {}) as { address?: string };
      if (!body.address || !isValidWalletAddress(body.address)) {
        res.status(400).json({ error: "a valid wallet address is required" });
        return;
      }
      const { message } = issueWalletNonce(body.address);
      res.json({ message });
    });

    // Wallet sign-in — step 2: verify the signature, then find-or-create the account
    // bound to that wallet and issue a token. Same wallet ⇒ same account ⇒ same
    // characters. Rate-limited per ip+address.
    app.post("/auth/wallet/verify", (req, res) => {
      void (async () => {
        const body = (req.body ?? {}) as { address?: string; signature?: string };
        const rateKey = `${req.ip ?? "?"}:${(body.address ?? "").toLowerCase()}`;
        if (loginRateLimited(rateKey)) {
          res.status(429).json({ error: "too many attempts, try again later" });
          return;
        }
        if (!body.address || !body.signature) {
          res.status(400).json({ error: "address and signature are required" });
          return;
        }
        const valid = await verifyWalletSignature(body.address, body.signature);
        if (!valid) {
          res.status(401).json({ error: "signature verification failed" });
          return;
        }
        let accountId = accountStore.findByWallet(body.address)?.accountId;
        if (!accountId) {
          const created = await accountStore.createAuthAccount({ wallet: body.address });
          if (!created.ok || !created.accountId) {
            res.status(409).json({ error: created.reason ?? "could not link wallet" });
            return;
          }
          accountId = created.accountId;
        }
        if (denyIfBanned(accountId, res)) return;
        resetLoginRate(rateKey);
        res.json({ token: signToken(accountId), accountId });
      })();
    });

    // Claim / upgrade — a guest attaches a recoverable credential to their CURRENT
    // account (proven by their existing token), keeping the same accountId and all
    // progress. Supports email+password and/or wallet (wallet requires a prior
    // /auth/wallet/nonce + signature).
    app.post("/auth/claim", (req, res) => {
      void (async () => {
        const body = (req.body ?? {}) as {
          token?: string;
          email?: string;
          password?: string;
          address?: string;
          signature?: string;
        };
        const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        const verified = verifyToken(body.token || bearer);
        if (!verified) {
          res.status(401).json({ error: "invalid or expired token" });
          return;
        }
        if (denyIfBanned(verified.accountId, res)) return;
        // Ensure the account shell exists (mirrors the login paths) so a valid token
        // for a not-yet-hydrated account can still upgrade cleanly.
        accountStore.getOrCreate(verified.accountId);

        // A wallet claim must prove ownership of the address via a signed nonce.
        let wallet: string | undefined;
        if (body.address || body.signature) {
          if (!body.address || !body.signature) {
            res
              .status(400)
              .json({ error: "address and signature are required for a wallet claim" });
            return;
          }
          const valid = await verifyWalletSignature(body.address, body.signature);
          if (!valid) {
            res.status(401).json({ error: "signature verification failed" });
            return;
          }
          wallet = body.address;
        }

        const result = await accountStore.claimAccount(verified.accountId, {
          email: body.email,
          password: body.password,
          wallet,
        });
        if (!result.ok) {
          res.status(409).json({ error: result.reason ?? "could not claim account" });
          return;
        }
        // Re-issue a token bound to the (unchanged) accountId for convenience.
        res.json({ token: signToken(verified.accountId), accountId: verified.accountId });
      })();
    });

    // ─── Metrics ─────────────────────────────────────────────────────────────
    app.get("/metrics", (_req, res) => {
      const stats = matchMaker.stats.local;
      res.json({
        ccu: stats.ccu,
        roomCount: stats.roomCount,
        uptimeMs: Date.now() - STARTED_AT,
      });
    });

    // ─── Admin: bug reports / feedback ──────────────────────────────────────
    const adminSecret = process.env.ADMIN_SECRET;
    const requireAdmin = (req: Request, res: Response): boolean => {
      const token = req.query.token ?? req.headers["x-admin-token"];
      if (adminSecret && token !== adminSecret) {
        res.status(401).json({ error: "unauthorized" });
        return false;
      }
      return true;
    };

    app.get("/admin/feedback", (req, res) => {
      if (!requireAdmin(req, res)) return;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const reports = feedbackStore.list(limit);
      res.json({ total: feedbackStore.totalCount(), reports });
    });

    // ─── Admin: player reports ─────────────────────────────────────────────
    app.get("/admin/reports", (req, res) => {
      if (!requireAdmin(req, res)) return;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const reports = moderationStore.listReports(limit);
      res.json({ total: moderationStore.totalCount(), reports });
    });

    // ─── Admin: mute / unmute ──────────────────────────────────────────────
    app.post("/admin/mute", (req, res) => {
      if (!requireAdmin(req, res)) return;
      const { accountId, durationMs } = req.body as { accountId?: string; durationMs?: number };
      if (!accountId) {
        res.status(400).json({ error: "accountId required" });
        return;
      }
      const duration = durationMs ?? 30 * 60_000; // default 30 minutes
      accountStore.setMuted(accountId, Date.now() + duration);
      res.json({ ok: true, message: `Muted ${accountId} for ${duration}ms.` });
    });
    app.post("/admin/unmute", (req, res) => {
      if (!requireAdmin(req, res)) return;
      const { accountId } = req.body as { accountId?: string };
      if (!accountId) {
        res.status(400).json({ error: "accountId required" });
        return;
      }
      accountStore.setMuted(accountId, null);
      res.json({ ok: true, message: `Unmuted ${accountId}.` });
    });

    // ─── Admin: ban / unban ────────────────────────────────────────────────
    app.post("/admin/ban", (req, res) => {
      if (!requireAdmin(req, res)) return;
      const { accountId, reason } = req.body as { accountId?: string; reason?: string };
      if (!accountId) {
        res.status(400).json({ error: "accountId required" });
        return;
      }
      accountStore.setBanned(accountId, true, reason || "");
      res.json({ ok: true, message: `Banned ${accountId}.` });
    });
    app.post("/admin/unban", (req, res) => {
      if (!requireAdmin(req, res)) return;
      const { accountId } = req.body as { accountId?: string };
      if (!accountId) {
        res.status(400).json({ error: "accountId required" });
        return;
      }
      accountStore.setBanned(accountId, false);
      res.json({ ok: true, message: `Unbanned ${accountId}.` });
    });

    // ─── Admin: set role (bootstrapping admin accounts) ─────────────────────
    app.post("/admin/set-role", (req, res) => {
      if (!requireAdmin(req, res)) return;
      const { accountId, role } = req.body as { accountId?: string; role?: string };
      if (!accountId) {
        res.status(400).json({ error: "accountId required" });
        return;
      }
      if (!role || !["player", "gm", "admin"].includes(role)) {
        res.status(400).json({ error: "role must be player, gm, or admin" });
        return;
      }
      accountStore.setRole(accountId, role);
      res.json({ ok: true, message: `Set ${accountId} role to ${role}.` });
    });

    // ─── Admin: kick (disconnect a player) ─────────────────────────────────
    app.post("/admin/kick", (req, res) => {
      if (!requireAdmin(req, res)) return;
      const { sessionId } = req.body as { sessionId?: string };
      if (!sessionId) {
        res.status(400).json({ error: "sessionId required" });
        return;
      }
      // channelRegistry tracks online players; use the send callback to send kick notice,
      // then the client will disconnect. The session will clean up on leave.
      const online = channelRegistry.getBySessionId(sessionId);
      if (online) {
        online.send(109 /* SERVER_ANNOUNCEMENT */, { text: "You have been kicked by an admin." });
        online.send("kick", {});
        res.json({ ok: true, message: `Kicked ${sessionId} (${online.playerName}).` });
      } else {
        res.json({ ok: false, message: "Player not found online." });
      }
    });

    // ─── Admin: broadcast announcement ─────────────────────────────────────
    app.post("/admin/announce", (req, res) => {
      if (!requireAdmin(req, res)) return;
      const { text } = req.body as { text?: string };
      if (!text?.trim()) {
        res.status(400).json({ error: "text required" });
        return;
      }
      // Send to all online players via the channel registry send callbacks.
      const payload = { text: text.trim() };
      const seen = new Set<string>();
      let count = 0;
      for (const info of channelRegistry.allPlayers()) {
        if (!seen.has(info.sessionId)) {
          seen.add(info.sessionId);
          info.send(109 /* SERVER_ANNOUNCEMENT */, payload);
          count++;
        }
      }
      res.json({ ok: true, message: `Announcement sent to ${count} players.` });
    });

    // ─── Channel list endpoint ──────────────────────────────────────────────
    app.get("/channels", (req, res) => {
      const mapId = (req.query.mapId as string) || "meadowfield";
      const counts = channelRegistry.getChannelCounts(mapId, CHANNELS_PER_MAP);
      res.json({ channels: counts });
    });

    // ─── Characters: the account roster behind the Character Select screen ────
    // Identity is taken from the server-signed token (Authorization: Bearer …),
    // NEVER from the request body — so a client can only ever see / mutate its
    // OWN characters. Auth + ban handling mirrors the /auth/* routes above.
    const requireAuth = (req: Request, res: Response): { accountId: string } | null => {
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
      const bodyToken = (req.body as { token?: string } | undefined)?.token;
      const verified = verifyToken(bearer || queryToken || bodyToken);
      if (!verified) {
        res.status(401).json({ error: "invalid or expired token" });
        return null;
      }
      if (denyIfBanned(verified.accountId, res)) return null;
      return verified;
    };

    // List the authenticated account's characters (name, class, level, map).
    app.get("/characters", (req, res) => {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const characters = accountStore.listCharacters(auth.accountId).map(characterSummary);
      res.json({ characters, max: MAX_CHARACTERS_PER_ACCOUNT });
    });

    // Create a new BEGINNER character on the authenticated account. Name format,
    // uniqueness, the slot cap, and appearance are all validated server-side.
    app.post("/characters", (req, res) => {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const body = (req.body ?? {}) as { name?: string; appearance?: unknown };
      const formatError = validateCharacterNameFormat(body.name ?? "");
      if (formatError) {
        res.status(400).json({ error: formatError });
        return;
      }
      const name = (body.name ?? "").trim();
      if (accountStore.characterNameExists(name)) {
        res.status(409).json({ error: NAME_TAKEN_MESSAGE, code: NAME_TAKEN_CODE });
        return;
      }
      if (accountStore.listCharacters(auth.accountId).length >= MAX_CHARACTERS_PER_ACCOUNT) {
        res
          .status(409)
          .json({ error: `You can only have ${MAX_CHARACTERS_PER_ACCOUNT} characters.` });
        return;
      }
      const rec = accountStore.createCharacter(auth.accountId, {
        name,
        archetype: ClassArchetype.BEGINNER,
        appearance: sanitizeAppearance(body.appearance),
      });
      res.status(201).json({ character: characterSummary(rec) });
    });

    // Delete one of the authenticated account's characters. Ownership is enforced
    // and a character that is currently online cannot be deleted.
    app.delete("/characters/:charId", (req, res) => {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const charId = req.params.charId;
      const rec = accountStore.getCharacter(charId);
      // Return 404 for both "missing" and "not yours" so ownership can't be probed.
      if (!rec || rec.accountId !== auth.accountId) {
        res.status(404).json({ error: "Character not found." });
        return;
      }
      if (channelRegistry.isCharOnline(charId)) {
        res.status(409).json({ error: "Character is currently online." });
        return;
      }
      accountStore.deleteCharacter(charId);
      res.json({ ok: true });
    });
  },
});

export default server;
