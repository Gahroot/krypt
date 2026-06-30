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
import type { Request, Response } from "express";
import { MAPS as GAME_MAPS } from "@maple/shared";
import cors from "cors";
import { log } from "./logger";

import { MapRoom } from "./rooms/MapRoom";
import { MarketRoom } from "./rooms/MarketRoom";
import { PartyQuestRoom } from "./rooms/PartyQuestRoom";
import { channelRegistry } from "./channelRegistry";
import { feedbackStore, moderationStore, accountStore } from "./persistence/store";

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
  },
});

export default server;
