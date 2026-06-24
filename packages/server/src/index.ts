/**
 * Server entrypoint. Boots the Colyseus game server on PORT (default 2567).
 *
 * Authoritative by design: clients send *inputs*; this process owns all game state, combat results,
 * mesos, and loot rolls. The client can never mint gear — that rule is enforced here.
 */
import { listen } from "@colyseus/tools";
import appConfig from "./app.config";

// listen() respects the PORT env var, defaulting to 2567.
listen(appConfig);
