# Channel System Plan

## Overview

Add a **multi-channel system** so each map hosts N parallel Colyseus room instances. A global `ChannelRegistry` singleton tracks all online players across all rooms/channels, enabling cross-channel whispers. Players can switch channels on the same map without losing character state. The client gets a channel-select UI.

## Architecture

### Room Naming Scheme

Each map gets channels named `{mapId}__ch{N}` — e.g. `dawn_isle__ch0`, `dawn_isle__ch1`, `dawn_isle__ch2`.

Default channels per map: **3** (configurable constant `CHANNELS_PER_MAP`).

Backward compat: the old names (`dawn_isle`, `meadowfield`, `heartland_harbor`) are still registered and map to channel 0 of their respective maps, so existing tests and clients continue to work unchanged.

**Example registration in `app.config.ts`:**
```ts
const CHANNELS_PER_MAP = 3;
const MAPS = ["dawn_isle", "heartland_harbor", "meadowfield"];
const rooms: Record<string, any> = {};
for (const mapId of MAPS) {
  // Backward-compat alias → channel 0
  rooms[mapId] = defineRoom(MapRoom, { mapId, channel: 0 });
  for (let ch = 0; ch < CHANNELS_PER_MAP; ch++) {
    rooms[`${mapId}__ch${ch}`] = defineRoom(MapRoom, { mapId, channel: ch });
  }
}
rooms["market_room"] = defineRoom(MarketRoom);
```

### New Files

| File | Purpose |
|------|---------|
| `packages/server/src/channelRegistry.ts` | Global singleton: tracks `charId → { sessionId, roomId, playerName, level, mapId, channel, send }`. Cross-channel whisper lookup + channel player counts. |
| `packages/server/test/channels.ts` | Test: join specific channel, switch channel preserving state, whisper across channels. |

### Modified Files

| File | Changes |
|------|---------|
| `packages/shared/src/net.ts` | Add message types: `CHANNEL_LIST`, `CHANNEL_SWITCH`, `CHANNEL_SWITCH_RESULT`, `WHISPER`, `WHISPER_RELAY`, `WHISPER_FAILED`. Add payload interfaces. |
| `packages/server/src/app.config.ts` | Register N channel rooms per map. Add `/channels` HTTP endpoint returning channel list + player counts. |
| `packages/server/src/rooms/MapRoom.ts` | Store `channel` from options. Register/unregister with `ChannelRegistry` in `onJoin`/`onLeave`. Handle `CHANNEL_SWITCH`, `WHISPER` messages. Send `CHANNEL_LIST` on join. |
| `packages/server/package.json` | Add `channels.ts` to the test script. |
| `packages/client/src/backend.ts` | Add `getCurrentChannel()` / `setCurrentChannel()` localStorage helpers. |
| `packages/client/src/scenes/MapScene.ts` | Send `CHANNEL_SWITCH` to switch. Handle `CHANNEL_SWITCH_RESULT` to leave+rejoin. Handle `WHISPER_RELAY`. Publish channel info to registry. |
| `packages/client/src/scenes/UI.ts` | Add channel indicator in bottom bar. Show `WHISPER_RELAY` messages in chat. Handle `/w` or `/whisper` chat commands. |
| `packages/client/src/scenes/ChannelSelect.ts` | New Phaser scene: overlay panel listing channels with player counts. Fetches from `/channels` endpoint. |
| `packages/client/src/main.ts` | Register `ChannelSelectScene`. |

### Channel Switch Flow

1. Player opens channel select UI → sees N channels with player counts.
2. Player selects channel N → client sends `CHANNEL_SWITCH { channel: N }` to current room.
3. Server: `persistPlayer()`, unregister from `ChannelRegistry`, close any active trade.
4. Server sends `CHANNEL_SWITCH_RESULT { mapId: "...", channel: N, spawnId: "playerSpawn" }`.
5. Client leaves current room, sets `setCurrentChannel(N)`, joins `{mapId}__ch{N}`.
6. New room's `onJoin` loads character from persistent store (same flow as portal travel).
7. New room registers player in `ChannelRegistry`.

### Cross-Channel Whisper

1. Client types `/w PlayerName message` in chat → sends `WHISPER { targetName: "PlayerName", text: "message" }`.
2. Room looks up `targetName` in `ChannelRegistry`.
3. **If found**: sends `WHISPER_RELAY { senderName, text }` via target's `send` callback. Sends confirmation to sender via chat.
4. **If not found**: sends `WHISPER_FAILED { targetName }` → client shows "Player not found" in chat.

### Guild Chat (no change needed)

Already works cross-room via `guildManager`'s send callbacks. The `ChannelRegistry` adds redundant tracking but guildManager's existing pattern is sufficient. Guild chat continues to work across channels automatically.

### Party System (unchanged, room-scoped)

Parties remain scoped to a single room (channel). A party invite only works within the same channel. This is documented but not changed — cross-channel parties would require a much larger refactor of PartyManager.

### Channel List HTTP Endpoint

`GET /channels?mapId=dawn_isle` returns:
```json
{
  "channels": [
    { "channel": 0, "playerCount": 5 },
    { "channel": 1, "playerCount": 2 },
    { "channel": 2, "playerCount": 0 }
  ]
}
```

Built from `ChannelRegistry` + known channel count per map.

## Verification Criteria

- All existing tests pass (`pnpm --filter @maple/server test`).
- New `channels.ts` test passes:
  - Join channel 0, verify player in room state.
  - Switch to channel 1, verify character state preserved (mesos, level, items).
  - Whisper from channel 0 player reaches channel 1 player.
- `pnpm typecheck` passes across all packages.
- `pnpm --filter @maple/client build` passes.

## Steps

1. Add new message types and payload interfaces to `packages/shared/src/net.ts` (CHANNEL_LIST, CHANNEL_SWITCH, CHANNEL_SWITCH_RESULT, WHISPER, WHISPER_RELAY, WHISPER_FAILED + payload types).
2. Create `packages/server/src/channelRegistry.ts` with the ChannelRegistry singleton.
3. Update `packages/server/src/app.config.ts` to register N channels per map + add `/channels` HTTP endpoint.
4. Update `packages/server/src/rooms/MapRoom.ts`: store channel number from options, register/unregister with ChannelRegistry in onJoin/onLeave, add CHANNEL_SWITCH + WHISPER message handlers, send CHANNEL_LIST on join.
5. Create `packages/server/test/channels.ts` with join-channel / switch-channel / cross-channel-whisper tests.
6. Update `packages/server/package.json` test script to include channels.ts.
7. Update `packages/client/src/backend.ts` with getCurrentChannel/setCurrentChannel helpers.
8. Create `packages/client/src/scenes/ChannelSelect.ts` — Phaser overlay scene for channel picker.
9. Register ChannelSelectScene in `packages/client/src/main.ts`.
10. Update `packages/client/src/scenes/MapScene.ts` to handle channel switch + whisper messages, integrate with ChannelSelectScene.
11. Update `packages/client/src/scenes/UI.ts` to display whisper messages in chat and support `/w` chat command.
12. Run all checks: `pnpm typecheck`, `pnpm --filter @maple/server test`, `pnpm --filter @maple/client build`.
