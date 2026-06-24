/**
 * TownRoom — placeholder skeleton (fleshed out in steps 5–7 with schemas, movement, combat, loot).
 */
import { Room, Client } from "colyseus";
import { Schema } from "@colyseus/schema";

class TownStatePlaceholder extends Schema {}

export class TownRoom extends Room {
  state = new TownStatePlaceholder();

  onJoin(client: Client): void {
    console.log("[town] join", client.sessionId);
  }

  onLeave(client: Client): void {
    console.log("[town] leave", client.sessionId);
  }
}
