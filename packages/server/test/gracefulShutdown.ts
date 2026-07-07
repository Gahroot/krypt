/**
 * Graceful shutdown acceptance test — proves a SIGTERM-driven deploy doesn't yank
 * players mid-fight or lose progress.
 *
 * Boots the real server in-process (real WebSocket client, real Colyseus teardown),
 * mutates a player's LIVE state (values that only live in the room schema until
 * `onLeave`/`onDispose` persist them), then runs the announce → drain → teardown
 * sequence and asserts the four acceptance criteria:
 *
 *   1. Every connected player is WARNED (receives `SERVER_ANNOUNCEMENT`).
 *   2. NEW joins during the drain are BLOCKED (onAuth rejects with a 503).
 *   3. The process EXITS CLEANLY (code 0).
 *   4. Live state was PERSISTED — the DB record matches the in-memory values, so a
 *      player who reconnects after the redeploy loses nothing.
 *
 * `process.exit` is stubbed for the duration of the sequence so the test runner can
 * observe the exit code instead of being killed by it.
 *
 * Run: npx tsx test/gracefulShutdown.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import { MessageType, SERVER_SHUTTING_DOWN_CODE, randomizeAppearance } from "@maple/shared";
import type { Server } from "colyseus";
import appConfig from "../src/app.config";
import { accountStore } from "../src/persistence/store";
import { signToken, newGuestAccountId } from "../src/auth";
import { runGracefulShutdown, isShuttingDown } from "../src/shutdown";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so a hung teardown can never wedge the suite.
const watchdog = setTimeout(() => {
  console.error("[shutdown] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

async function main() {
  // Short drain so the test is fast; we assert behavior DURING the drain window.
  // Read lazily by shutdown.ts, so setting them here (before the call) takes effect.
  process.env.SHUTDOWN_DRAIN_SECONDS = "2";
  process.env.SHUTDOWN_HARD_TIMEOUT_MS = "15000";

  const colyseus = await boot(appConfig);

  // ── Set up a player with a real character (mirrors the protocol/auth tests) ──
  const acctId = `sd_${Date.now()}`;
  accountStore.getOrCreate(acctId);
  const char = accountStore.createCharacter(acctId, {
    name: `SD_${Date.now()}`,
    archetype: "WARRIOR",
    appearance: randomizeAppearance(),
  });
  const token = signToken(acctId);

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    token,
    charId: char.charId,
  });
  // Swallow the per-tick boss-HP broadcast (Meadowfield's Tidemaw) to keep output clean.
  room.onMessage("boss_hp", () => {
    /* suppress */
  });
  await sleep(200); // let the first state patch land

  const sessionId = room.sessionId;
  // NOTE: `room.state` is the CLIENT-side deserialized mirror — mutating it does NOT
  // touch the authoritative server state. Reach the real server Room instance so the
  // values we set are exactly what onLeave/onDispose persist. (This mirrors what the
  // authoritative gameplay code does: mutate `player.mesos`/`player.x` on the server.)
  const serverRoom = colyseus.getRoomById(room.roomId) as unknown as {
    state: { players: Map<string, Record<string, unknown>> };
  };
  const serverMe = serverRoom.state.players.get(sessionId);
  assert.ok(serverMe, "authoritative player should exist in the server room");

  // ── Mutate LIVE-only state ──────────────────────────────────────────────────
  // These values are written to the DB ONLY by onLeave/onDispose — not on every
  // tick — so asserting they survive the shutdown proves the persist path works.
  const charId = serverMe!.charId as string;
  const LIVE_MESOS = 4242;
  const LIVE_EXP = 1337;
  const LIVE_X = 314;
  serverMe!.mesos = LIVE_MESOS;
  serverMe!.exp = LIVE_EXP;
  serverMe!.x = LIVE_X;

  // Capture the shutdown banner when it arrives.
  let announcement: string | null = null;
  room.onMessage(MessageType.SERVER_ANNOUNCEMENT, (payload: { text: string }) => {
    announcement = payload.text;
  });

  // ── Stub process.exit so the runner survives the sequence ───────────────────
  const exitCalls: number[] = [];
  const realExit = process.exit;
  (process as { exit: (code?: number) => void }).exit = (code?: number) => {
    exitCalls.push(code ?? 0);
  };

  // ── Kick off the graceful shutdown (NOT awaited yet) ────────────────────────
  const shutdownPromise = runGracefulShutdown(colyseus.server as Server, "SIGTERM", 0);
  await sleep(50); // let it flip the flag + broadcast the banner

  // ── 1) The shutdown flag is set immediately → new joins blocked ─────────────
  assert.ok(isShuttingDown(), "isShuttingDown() is true once shutdown begins");

  // ── 2) The connected player was warned ─────────────────────────────────────
  assert.ok(announcement, "connected player received a SERVER_ANNOUNCEMENT");
  assert.match(announcement!, /restart/i, "banner mentions a restart");

  // ── 3) A NEW join during the drain is rejected with the 503 shutting-down code
  let joinErr: { code?: number; message?: string } | null = null;
  try {
    await colyseus.sdk.joinOrCreate("meadowfield", {
      token: signToken(newGuestAccountId()),
      name: `Late_${Date.now()}`,
    });
  } catch (err) {
    joinErr = err as { code?: number; message?: string };
  }
  assert.ok(joinErr, "a new join attempted during the drain must be rejected");
  assert.strictEqual(
    joinErr!.code,
    SERVER_SHUTTING_DOWN_CODE,
    "rejection carries the 503 shutting-down code",
  );

  // ── Let the sequence finish: drain → real Colyseus teardown (onLeave/onDispose)
  await shutdownPromise;

  // Restore process.exit before we use the real one to end the test.
  (process as { exit: (code?: number) => void }).exit = realExit;

  // ── 4) Clean exit code ─────────────────────────────────────────────────────
  assert.deepStrictEqual(exitCalls, [0], "shutdown exited cleanly with code 0");

  // ── 5) Live state was persisted → reconnect loses nothing ───────────────────
  const rec = accountStore.getCharacter(charId);
  assert.ok(rec, "character record exists after shutdown");
  assert.strictEqual(rec!.mesos, LIVE_MESOS, "mesos persisted from live state");
  assert.strictEqual(rec!.exp, LIVE_EXP, "exp persisted from live state");
  assert.strictEqual(rec!.x, LIVE_X, "x position persisted from live state");
  assert.strictEqual(rec!.mapId, "meadowfield", "mapId persisted from live state");

  clearTimeout(watchdog);
  console.log("[shutdown] PASS ✔  SIGTERM warns players, blocks joins, saves state, exits 0");
  process.exit(0);
}

main().catch((err) => {
  console.error("[shutdown] FAIL ✘", err);
  process.exit(1);
});
