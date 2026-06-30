/**
 * Server entrypoint. Boots the Colyseus game server on PORT (default 2567).
 *
 * Authoritative by design: clients send *inputs*; this process owns all game state, combat results,
 * mesos, and loot rolls. The client can never mint gear — that rule is enforced here.
 */
import { listen } from "@colyseus/tools";
import appConfig from "./app.config";
import { log } from "./logger";
import { captureException, initErrorTracker, errorTrackingEnabled } from "./errorTracker";
import { SERVER_BUILD_VERSION, PROTOCOL_VERSION } from "./version";

const PORT = Number(process.env.PORT || 2567);
const HOST = process.env.HOST || "0.0.0.0";

// ─── Process-level safety net ─────────────────────────────────────────────────
// During the alpha we want to SEE what breaks, not have the process vanish silently.
// A stray throw in async code or an unhandled rejection would otherwise tear the whole
// server down with little trace. Catch both, log them as structured errors with full
// stacks, and ship them to the error tracker (if enabled). We keep the process alive so
// one bad code path can't take every connected player offline; a crash-loop supervisor
// (pm2/systemd/k8s) still owns the decision to restart on truly fatal states.
process.on("uncaughtException", (err, origin) => {
  log.error("uncaughtException", { origin, err });
  captureException(err, { kind: "uncaughtException", origin });
});

process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", { err: reason });
  captureException(reason, { kind: "unhandledRejection" });
});

async function main(): Promise<void> {
  await initErrorTracker();

  await listen(appConfig, PORT);
  log.info("server started", {
    port: PORT,
    host: HOST,
    nodeEnv: process.env.NODE_ENV ?? "development",
    build: SERVER_BUILD_VERSION,
    protocol: PROTOCOL_VERSION,
    errorTracking: errorTrackingEnabled(),
  });
}

main().catch((err) => {
  log.error("server failed to start", { err });
  captureException(err, { kind: "boot" });
  process.exit(1);
});
