/**
 * Graceful shutdown controller — keeps a deploy from yanking players mid-fight.
 *
 * Alpha deploys are frequent. Without this, a SIGTERM makes Colyseus disconnect
 * every player immediately with a bare `SERVER_SHUTDOWN` close code: no warning,
 * no chance to react. Players see a hard drop and (rightly) fear lost progress.
 *
 * This module owns the deploy-driven shutdown sequence and hands the final teardown
 * to Colyseus's own lifecycle (so persistence always goes through the established
 * `onLeave` / `onDispose` hooks — never a parallel path):
 *
 *   1. **Block new joins** — flip a flag that `AuthedRoom.onAuth` checks, so the
 *      drain window can't let a fresh login start a session we're about to tear down.
 *   2. **Warn** every connected player with a `SERVER_ANNOUNCEMENT` banner that says
 *      the server is restarting and their progress is already saved.
 *   3. **Drain** — hold the process open for a short, configurable window so players
 *      see the banner and can finish the swing / pickup / trade they're mid-animation on.
 *   4. **Persist + tear down** — delegate to `Server.gracefullyShutdown()`, which:
 *        - locks every room (no more matchmaking),
 *        - closes each client with `SERVER_SHUTDOWN` → `onLeave` force-persists that
 *          player's full state through `accountStore`,
 *        - disposes every room → `onDispose` calls `persistAllPlayers()` and
 *          `accountStore.checkpoint()` (flushes the WAL into the main `.db`).
 *   5. A final `accountStore.checkpoint()` belt-and-suspenders, then `process.exit`.
 *
 * The flag also gates `AuthedRoom.onAuth`, which rejects joins during the drain with a
 * 503 so a login attempt surfaces a friendly "try again" instead of a generic auth fail.
 *
 * Colyseus's OWN auto signal handlers are disabled (`gracefullyShutdown: false` in
 * `app.config.ts`) so they can't race this sequence with an immediate `process.exit`,
 * and so an `uncaughtException` no longer tears every connected player offline (the
 * process-level safety net in `index.ts` keeps the process alive and logs instead).
 */
import type { Server } from "colyseus";
import { MessageType, type ServerAnnouncementPayload } from "@maple/shared";
import { log } from "./logger";
import { accountStore } from "./persistence/store";
import { channelRegistry } from "./channelRegistry";

/**
 * Seconds the banner is shown before the server tears down. Long enough to read and
 * to finish a swing; short enough that a deploy isn't slow. Override per-environment.
 * Read lazily (at shutdown time, not import time) so a test or operator can set the env
 * var at any point before the sequence runs. Dev (`tsx watch` restarts on every change)
 * defaults to a 1s drain so hot-reload stays snappy; production defaults to 10s.
 */
function drainSeconds(): number {
  const fallback = process.env.NODE_ENV === "production" ? 10 : 1;
  return clampPositiveInt(process.env.SHUTDOWN_DRAIN_SECONDS, fallback);
}

/** Hard cap on the whole teardown so a stuck `onDispose` can never hang a deploy. */
function hardTimeoutMs(): number {
  return clampPositiveInt(process.env.SHUTDOWN_HARD_TIMEOUT_MS, 30_000);
}

let shuttingDown = false;

/** True once shutdown has begun. `AuthedRoom.onAuth` rejects new joins while this is set. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

// ─── Internals ────────────────────────────────────────────────────────────────

function clampPositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reject a promise if it hasn't settled within `ms`, so teardown can't hang forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Warn every connected in-world player that the server is about to restart. Uses the
 * global channel registry — the same live `send` callbacks the GM announce command uses —
 * so every player on every map/channel sees the banner. Market / party-quest clients hold
 * no combat state and additionally receive Colyseus's clean `SERVER_SHUTDOWN` close below.
 */
function broadcastShutdownAnnouncement(secondsLeft: number): number {
  const payload: ServerAnnouncementPayload = {
    text:
      `Server restarting in ${secondsLeft}s for an update — ` +
      "your progress is already saved. Please reconnect shortly!",
  };

  let warned = 0;
  for (const player of channelRegistry.allPlayers()) {
    try {
      player.send(MessageType.SERVER_ANNOUNCEMENT, payload);
      warned++;
    } catch {
      /* a client whose transport already died — nothing to warn, carry on */
    }
  }
  return warned;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the full announce → drain → persist → teardown sequence and exit.
 *
 * Idempotent against re-entry: a second signal (the supervisor's kill timeout, or an
 * impatient second Ctrl-C) while a shutdown is already in progress forces an immediate
 * exit so a stuck teardown can never wedge a deploy.
 *
 * @param server    The Colyseus `Server` returned by `listen()` — owns room teardown.
 * @param signal    What triggered us (`"SIGTERM"` / `"SIGINT"`) — logged for triage.
 * @param exitCode  Process exit code on a CLEAN shutdown (0 for a deploy-driven SIGTERM).
 */
export async function runGracefulShutdown(
  server: Server,
  signal: NodeJS.Signals,
  exitCode = 0,
): Promise<void> {
  const drain = drainSeconds();

  // Second signal while already draining → don't wait, force exit.
  if (shuttingDown) {
    log.warn("shutdown already in progress — forcing exit", { signal });
    process.exit(exitCode);
    return;
  }
  shuttingDown = true;

  log.warn("graceful shutdown requested", {
    signal,
    drainSeconds: drain,
    onlinePlayers: channelRegistry.totalOnline,
  });

  // 1 + 2. New joins are now blocked (onAuth checks isShuttingDown); warn everyone in-world.
  const warned = broadcastShutdownAnnouncement(drain);
  log.info("shutdown announcement broadcast", { players: warned });

  // 3. Drain — let the banner render and current actions complete before we pull sockets.
  await sleep(drain * 1000);

  // 4. Delegate to Colyseus: lock rooms, disconnect clients (→ onLeave persist),
  //    dispose every room (→ onDispose persistAllPlayers + checkpoint), shut transport.
  //    `exit=false` so WE own process.exit (and the hard-timeout safety net below).
  try {
    await withTimeout(
      server.gracefullyShutdown(false),
      hardTimeoutMs(),
      "server.gracefullyShutdown",
    );
  } catch (err) {
    // A stuck onDispose / hung transport. Persistence already ran in onLeave for anyone
    // who disconnected; force the WAL checkpoint below, then bail out so the deploy moves.
    log.error("colyseus shutdown did not complete cleanly — forcing exit", { err });
    try {
      accountStore.checkpoint();
    } catch (checkpointErr) {
      log.error("final WAL checkpoint failed", { err: checkpointErr });
    }
    process.exit(1);
  }

  // 5. Belt-and-suspenders: flush the WAL so the `.db` is self-contained even if a room's
  //    onDispose was somehow skipped. (onDispose already checkpoints; this is the guarantee.)
  try {
    accountStore.checkpoint();
  } catch (err) {
    log.error("final WAL checkpoint failed", { err });
  }

  log.info("graceful shutdown complete", { signal });
  process.exit(exitCode);
}

/**
 * Wire SIGTERM (deploy / orchestrator) and SIGINT (Ctrl-C in dev) to the graceful
 * sequence. Call once from `index.ts` after `listen()` resolves. Colyseus's own auto
 * signal handlers are disabled in `app.config.ts`, so this is the single owner.
 */
export function installShutdownHandlers(server: Server): void {
  process.once("SIGTERM", () => void runGracefulShutdown(server, "SIGTERM", 0));
  process.once("SIGINT", () => void runGracefulShutdown(server, "SIGINT", 0));
}
