/**
 * MarketRoom — placeholder skeleton (fleshed out in step 8 with the off-chain Mesos order book).
 */
import { Room, Client } from "colyseus";
import { Schema } from "@colyseus/schema";

class MarketStatePlaceholder extends Schema {}

export class MarketRoom extends Room {
  state = new MarketStatePlaceholder();

  onJoin(client: Client): void {
    console.log("[market] join", client.sessionId);
  }

  onLeave(client: Client): void {
    console.log("[market] leave", client.sessionId);
  }
}
