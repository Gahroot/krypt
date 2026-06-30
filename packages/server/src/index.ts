/**
 * Server entrypoint. Boots the Colyseus game server on PORT (default 2567).
 *
 * Authoritative by design: clients send *inputs*; this process owns all game state, combat results,
 * mesos, and loot rolls. The client can never mint gear — that rule is enforced here.
 */
import { listen } from "@colyseus/tools";
import appConfig from "./app.config";
import { log } from "./logger";

const PORT = Number(process.env.PORT || 2567);
const HOST = process.env.HOST || "0.0.0.0";

listen(appConfig, PORT).then(() => {
  log.info("server started", {
    port: PORT,
    host: HOST,
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
});
