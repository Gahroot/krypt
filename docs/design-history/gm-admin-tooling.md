# GM/Admin Tooling Plan

## Overview
Add server-validated admin role + GM command system with audit logging and a client-side admin console.

## Architecture Decisions
- **Admin role on Account**: Add a `role TEXT` column to the accounts table (`'player'` | `'admin'`). The server checks this from the DB/in-memory store — never trusts client claims.
- **New message type**: `GM_COMMAND` (103) and `GM_RESULT` (104) in shared/net.ts.
- **Command routing via CHAT**: Client intercepts `/`-prefixed messages and sends them as `GM_COMMAND`. Server validates admin, executes, returns result via `GM_RESULT`.
- **Audit log**: Ring buffer in a dedicated module (`gmAudit.ts`), also logged to console. Each entry: `{ timestamp, accountId, charName, command, args, result }`.
- **Mute/kick/ban**: Session-scoped enforcement (muted = chat blocked, kicked = disconnect, banned = stored on account + check on join).

## Files to Create/Modify

### 1. DB Migration: `packages/server/src/persistence/migrations/007_gm_admin.sql`
```sql
ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'player';
ALTER TABLE accounts ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
```

### 2. Shared Types: `packages/shared/src/net.ts`
Add two message types at the end of `MessageType`:
- `GM_COMMAND: 103`
- `GM_RESULT: 104`

Add payload interfaces:
```ts
export interface GmCommandPayload {
  command: string; // e.g. "teleport 500 300", "give wpn.iron_broadsword"
}
export interface GmResultPayload {
  ok: boolean;
  message: string;
}
```

### 3. Server: `packages/server/src/gmCommands.ts` (NEW)
The GM command handler. Exports:
- `isGmCommand(text: string): boolean` — checks if text starts with `/` and is a known GM command
- `handleGmCommand(client, room, text): void` — parses and executes

Commands implemented:
| Command | Syntax | Action |
|---------|--------|--------|
| teleport / tp | `/tp [player] <x> <y>` | Teleport self or named player |
| spawn | `/spawn <mobId> [count]` | Spawn mob(s) at player position |
| give | `/give <itemId> [count]` | Add item to inventory |
| mesos | `/mesos <amount>` | Add mesos to current player |
| exp | `/exp <amount>` | Grant EXP |
| level / lvl | `/level <n>` | Set level directly |
| killall | `/killall` | Kill all mobs on the map |
| mute | `/mute <player>` | Toggle mute on a player |
| kick | `/kick <player>` | Disconnect a player |
| ban | `/ban <player>` | Ban account |
| god / invincible | `/god` | Toggle invincibility |
| announce | `/announce <message>` | Broadcast server announcement |
| help | `/help` | List available commands |

### 4. Server: `packages/server/src/gmAudit.ts` (NEW)
- Ring buffer (last 500 entries)
- `logGmAction(entry)` function
- `getGmAuditLog()` for retrieval
- Each entry: `{ ts, accountId, charName, command, args, result }`

### 5. Server: `packages/server/src/types.ts`
Add exports for the new message types: `GmCommandPayload`, `GmResultPayload`.

### 6. Server: Account model + store updates
**`packages/server/src/persistence/store.ts`**:
- Add `role: string` to `Account` interface (default `'player'`)
- Add `banned: number` to `Account` interface (default `0`)
- Hydrate `role` and `banned` from DB in constructor
- Expose `isAdmin(accountId): boolean` 
- Expose `setRole(accountId, role): void`
- Expose `isBanned(accountId): boolean`
- Expose `setBanned(accountId, banned: number): void`
- Update `persistAccount` to include `role` and `banned`
- Update `getOrCreate` to include `role` and `banned` in INSERT/defaults

**Migration loading**: The new migration `007_gm_admin.sql` is automatically picked up by the existing `ensureMigrations()` system.

### 7. Server: `packages/server/src/rooms/MapRoom.ts`
- Add `GM_COMMAND` message handler in the `messages` block:
  - Look up player → get accountId → check `accountStore.isAdmin(accountId)`
  - If not admin → send `GM_RESULT { ok: false, message: "Not authorized." }` and log attempt
  - If admin → delegate to `handleGmCommand(client, this, text)`
- Add muted session tracking: `private mutedSessions = new Set<string>()`
- Gate the existing `CHAT` handler: if `this.mutedSessions.has(client.sessionId)`, suppress
- In `onJoin`: check `accountStore.isBanned(accountId)` → disconnect if banned

### 8. Client: `packages/client/src/scenes/UI.ts`
- In `setupChatInput()`, intercept text starting with `/`:
  - If text matches known GM commands (starts with `/` and is not `/w`/`/whisper`), send as `GM_COMMAND` instead of `CHAT`
- In `bindChat()`, add listener for `GM_RESULT` messages → display result in chat panel with "[GM]" prefix
- Admin visibility: The client sends commands via `/` prefix; non-admins simply get rejected by the server. No client-side admin check needed (zero trust).

### 9. Server Test: `packages/server/test/gmCommands.ts` (NEW)
Test file using `@colyseus/testing`:
1. **Non-admin rejection**: Join as a normal player, send `GM_COMMAND`, assert `GM_RESULT` returns `{ ok: false, message: "Not authorized." }`
2. **Admin command works**: Set an account as admin via `accountStore.setRole()`, join, send `/mesos 1000`, assert player mesos increased by 1000
3. **Audit log**: Assert that both attempts appear in the audit log

## Verification Criteria
1. `pnpm --filter @maple/shared typecheck` passes
2. `pnpm --filter @maple/server typecheck` passes
3. `pnpm --filter @maple/server test` passes (including new `gmCommands.ts`)
4. `pnpm --filter @maple/client typecheck` passes
5. `pnpm typecheck` (full monorepo) passes

## Steps
1. Add `GM_COMMAND` and `GM_RESULT` message types + payload interfaces to `packages/shared/src/net.ts`
2. Create `packages/server/src/persistence/migrations/007_gm_admin.sql` adding `role` and `banned` columns
3. Update `packages/server/src/persistence/store.ts` — add `role`/`banned` to Account, hydrate from DB, add `isAdmin`/`setRole`/`isBanned`/`setBanned` methods
4. Create `packages/server/src/gmAudit.ts` — ring buffer + logging
5. Create `packages/server/src/gmCommands.ts` — command parser + executor with all 13 commands
6. Update `packages/server/src/types.ts` — add GM payload exports
7. Update `packages/server/src/rooms/MapRoom.ts` — add GM_COMMAND handler, muted sessions, ban check on join
8. Update `packages/client/src/scenes/UI.ts` — intercept `/` commands, send GM_COMMAND, listen for GM_RESULT
9. Create `packages/server/test/gmCommands.ts` — test non-admin rejection + admin command + audit log
10. Run full typecheck + test suite, fix any issues
