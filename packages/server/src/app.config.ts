/**
 * Server configuration — registers rooms and HTTP routes.
 * Uses the Colyseus 0.17 declarative API (defineServer / defineRoom).
 */
import { defineServer, defineRoom, monitor, playground } from "colyseus";

import { TownRoom } from "./rooms/TownRoom";
import { MarketRoom } from "./rooms/MarketRoom";

const server = defineServer({
  rooms: {
    // Meadowfield — the pastoral starter zone (movement, mobs, combat, loot, mesos).
    town_room: defineRoom(TownRoom),
    // The Free Market — off-chain Mesos order book.
    market_room: defineRoom(MarketRoom),
  },

  express: (app) => {
    // Dev-only interactive room playground.
    if (process.env.NODE_ENV !== "production") {
      app.use("/playground", playground());
    }
    // State inspector. Protect this behind auth before any public deploy.
    app.use("/monitor", monitor());

    app.get("/health", (_req, res) => {
      res.json({ ok: true, service: "cryptomaple-server" });
    });
  },
});

export default server;
