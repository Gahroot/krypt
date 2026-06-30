# Chat System Plan

## Summary

Add scoped chat (map/all, whisper, party, guild) with tabbed client UI, profanity filter, per-scope colors, and speech bubbles. Most infrastructure exists — whisper and guild chat are fully implemented. Gaps: (1) no party chat, (2) no scope on CHAT type, (3) no profanity filter, (4) client chat has no tabs/channels.

## Current State

- **MessageType.CHAT** (2): `ChatPayload { text }` → server broadcasts `ChatMessage { sessionId, name, text }` to all. No scope.
- **MessageType.WHISPER** (68–70): Full cross-channel whisper with block/mute checks.
- **MessageType.GUILD_CHAT** (62–63): Full relay via `guildManager.getGuildChatRecipients()`.
- **No party chat**: No `PARTY_CHAT` message type. `partyManager` has no chat concept.
- **Server**: Rate limit (300ms), length cap (120 chars), mute checks, chat history ring buffer.
- **Client UI.ts**: Simple scrollback panel — no tabs, no scope colors. Separate guild chat panel (G key).
- **Client MapScene.ts**: Speech bubbles on CHAT messages (already works).
- **No profanity filter** anywhere.
- **No TownRoom.ts** in source — only a stale build artifact. Only MapRoom.ts and MarketRoom.ts exist.

---

## Step 1 — Shared types (`packages/shared/src/net.ts`)

Add `PARTY_CHAT: 111` and `PARTY_CHAT_RELAY: 112` to `MessageType` (next available after `MOD_ACTION_RESULT: 110`).

Add payload interfaces:

```ts
/** Chat scope — determines routing + client tab. */
export type ChatScope = "map" | "whisper" | "party" | "guild";

/** Client → server: send a party chat message. */
export type PartyChatPayload = ChatPayload;

/** Server → client: party chat relay (same-room only). */
export interface PartyChatRelayPayload {
  senderName: string;
  text: string;
}
```

## Step 2 — Profanity filter (`packages/shared/src/profanity.ts`)

New file with a simple word blocklist + text normalization:

- `containsProfanity(text: string): boolean` — checks against a `Set` of blocked words (lowercase, ~30 common words)
- `filterProfanity(text: string): string` — replaces matches with `****`

Export from `packages/shared/src/index.ts`.

## Step 3 — Server types re-export (`packages/server/src/types.ts`)

Add re-exports: `PartyChatPayload`, `PartyChatRelayPayload`, `ChatScope`.

## Step 4 — MapRoom server handler (`packages/server/src/rooms/MapRoom.ts`)

### 4a. Import new types

Add `PartyChatPayload`, `PartyChatRelayPayload` to import from `../types`. Add `filterProfanity` to import from `@maple/shared`.

### 4b. Add PARTY_CHAT message handler

In the `messages` object (after `GUILD_CHAT` handler, ~line 643):

```ts
[MessageType.PARTY_CHAT]: (client: Client, msg: PartyChatPayload) => {
  this.handlePartyChat(client, msg);
},
```

### 4c. Add `handlePartyChat` private method

After `handleGuildChat` (~line 3102):

```ts
private handlePartyChat(client: Client, msg: PartyChatPayload): void {
  const player = this.state.players.get(client.sessionId);
  if (!player || !msg?.text) return;

  // Mute check.
  const accountId = this.sessionAccount.get(client.sessionId) ?? client.sessionId;
  if (accountStore.isMuted(accountId)) {
    client.send(MessageType.CHAT, { sessionId: "", name: "System", text: "You are currently muted." });
    return;
  }

  // Rate limit.
  const now = Date.now();
  const last = this.lastChatAt.get(client.sessionId) ?? 0;
  if (now - last < CHAT_RATE_LIMIT_MS) return;
  this.lastChatAt.set(client.sessionId, now);

  let text = msg.text.trim().slice(0, CHAT_MAX_LEN);
  text = filterProfanity(text);
  if (text.length === 0) return;

  const party = this.partyManager.getParty(client.sessionId);
  if (!party) {
    client.send(MessageType.CHAT, { sessionId: "", name: "Party", text: "You are not in a party." });
    return;
  }

  // Relay to all party members including sender.
  for (const member of party.members.values()) {
    const mc = this.clients.find((c) => c.sessionId === member.sessionId);
    if (mc) {
      mc.send(MessageType.PARTY_CHAT_RELAY, { senderName: player.name, text } satisfies PartyChatRelayPayload);
    }
  }
}
```

### 4d. Apply profanity filter to existing handlers

- **CHAT handler** (line ~457): Add `text = filterProfanity(text);` after `text = msg.text.trim().slice(0, CHAT_MAX_LEN);`
- **WHISPER handler** (line ~3161): Same
- **GUILD_CHAT handler** (line ~3091): Same

## Step 5 — Client chat panel refactor (`packages/client/src/scenes/UI.ts`)

### 5a. Add chat color/scope constants

```ts
const CHAT_SCOPE_COLORS: Record<ChatScope | "system", string> = {
  map: "#e5e7eb",       // white
  whisper: "#c084fc",   // purple
  party: "#4ade80",     // green
  guild: "#60a5fa",     // blue
  system: "#fbbf24",    // gold
};
const CHAT_SCOPE_LABELS: Record<ChatScope, string> = {
  map: "All",
  whisper: "Whisper",
  party: "Party",
  guild: "Guild",
};
```

### 5b. Replace chat state fields

Replace separate `chatLines`, `guildChatLines`, `guildChatFocused`, `guildChatInput`, `guildChatBg`, `guildChatContainer` with unified:

```ts
private chatTabs: Phaser.GameObjects.Text[] = [];
private chatActiveTab: ChatScope = "map";
private readonly chatMsgBuffer: Array<{ name: string; text: string; scope: ChatScope | "system" }> = [];
private readonly chatVisibleLines: Phaser.GameObjects.Text[] = [];
```

Keep existing `chatBg`, `chatInput`, `chatFocused`, `chatRoom`.

### 5c. Rebuild `buildChatPanel()`

Create tab bar (4 clickable labels) at top of chat panel. Keep bg + input. Remove guild chat panel building from `buildGuildChatPanel()`.

### 5d. Unified `addChatLine(name, text, scope)`

Push to `chatMsgBuffer` (cap at 80), create text object with scope color, call `renderChatMessages()`.

### 5e. `renderChatMessages()`

Filter `chatMsgBuffer` by active tab (or "all" tab shows everything). Create/position text objects bottom-up in panel. Cap visible at CHAT_MAX_MSGS (8).

### 5f. Tab switching

- Click on tab label → set `chatActiveTab`, re-render
- Tab key while chat focused → cycle through tabs
- Tab bar renders above messages, below the bg top

### 5g. Input routing on send

```
Enter → if focused, send based on activeTab:
  "map"    → room.send(MessageType.CHAT, { text })
  "whisper" → parse "targetName rest of text" → room.send(MessageType.WHISPER, { targetName, text })
  "party"  → room.send(MessageType.PARTY_CHAT, { text })
  "guild"  → room.send(MessageType.GUILD_CHAT, { text })
```

Also keep existing `/w name msg` slash command working from any tab.

### 5h. Update `bindChat()` listener

```ts
room.onMessage(MessageType.CHAT, (msg: ChatMessage) => {
  if (msg.sessionId !== "" && this.blockedNames.some(n => n.toLowerCase() === msg.name.toLowerCase())) return;
  this.addChatLine(msg.name, msg.text, "map");
});
room.onMessage(MessageType.WHISPER_RELAY, (payload) => {
  if (this.blockedNames.some(n => n.toLowerCase() === payload.senderName.toLowerCase())) return;
  this.addChatLine(payload.senderName, payload.text, "whisper");
});
room.onMessage(MessageType.WHISPER_FAILED, (payload) => {
  this.addChatLine("System", `${payload.targetName}: ${payload.reason}`, "system");
});
room.onMessage(MessageType.PARTY_CHAT_RELAY, (payload) => {
  this.addChatLine(payload.senderName, payload.text, "party");
});
```

### 5i. Remove old guild chat panel

Remove: `buildGuildChatPanel()`, `addGuildChatLine()`, `positionGuildChatPanel()`, `setupGuildChatInput()`, `setGuildChatFocus()`, and associated fields (`guildChatContainer`, `guildChatBg`, `guildChatInput`, `guildChatLines`, `guildChatFocused`). Remove their `create()` calls. Remove `GUILD_CHAT_RELAY` listener from `setupGuildListeners()` (unified into `bindChat()`).

### 5j. Speech bubbles in MapScene.ts

Update `bindChat()` in MapScene to only show bubbles for map-scoped CHAT messages. Current code already listens for `MessageType.CHAT` which is always map-scoped, so **no changes needed** — party/whisper/guild messages use different message types and won't trigger bubbles.

## Step 6 — Verify

1. `pnpm --filter @maple/shared typecheck`
2. `pnpm --filter @maple/server typecheck`  
3. `pnpm --filter @maple/client build`
4. `pnpm typecheck` (full monorepo)

## Files Modified

| File | Change |
|------|--------|
| `packages/shared/src/net.ts` | Add `PARTY_CHAT`/`PARTY_CHAT_RELAY` + `ChatScope`, `PartyChatPayload`, `PartyChatRelayPayload` |
| `packages/shared/src/profanity.ts` | **NEW** — profanity filter |
| `packages/shared/src/index.ts` | Export profanity module |
| `packages/server/src/types.ts` | Re-export new types |
| `packages/server/src/rooms/MapRoom.ts` | Add PARTY_CHAT handler, apply profanity filter to all chat handlers |
| `packages/client/src/scenes/UI.ts` | Unified tabbed chat panel, per-scope colors, remove old guild chat panel |

## Risks

- **UI.ts is 7600+ lines**: Chat refactor is contained to ~200 lines in the chat section. Removing guild chat panel saves ~100 lines. Net neutral.
- **Profanity filter is simple**: Word list approach; sufficient for alpha.
- **Party chat is session-scoped**: Same limitation as the party system — no cross-map relay.
- **Backward compat**: Existing CHAT/WHISPER/GUILD_CHAT message types untouched. Additive changes only.

## Steps

1. Create `packages/shared/src/profanity.ts` with `containsProfanity()` and `filterProfanity()`
2. Add profanity export to `packages/shared/src/index.ts`
3. Add `PARTY_CHAT: 111`, `PARTY_CHAT_RELAY: 112`, `ChatScope`, `PartyChatPayload`, `PartyChatRelayPayload` to `packages/shared/src/net.ts`
4. Add new type re-exports to `packages/server/src/types.ts`
5. Update MapRoom.ts: import new types + profanity, add PARTY_CHAT handler + `handlePartyChat` method, apply profanity filter to existing CHAT/WHISPER/GUILD_CHAT handlers
6. Refactor UI.ts: add scope color constants, replace dual chat panels with unified tabbed panel (tabs: All/Whisper/Party/Guild), unified `addChatLine(name, text, scope)`, tab filtering, scope-aware send routing, Tab key to cycle tabs, remove old guild chat panel code
7. Run `pnpm typecheck` and `pnpm --filter @maple/client build` to verify
