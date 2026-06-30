# Friends/Buddy System — Assessment & Enhancement Plan

## Finding: Already Fully Implemented

After thorough code review, the Friends/Buddy system is **already complete** with working server handlers, persistence, online/offline status broadcasting, and a full client UI. The premise that "there is NO server handler and NO persistence" is incorrect.

### What already exists:

**Server handlers** (`packages/server/src/rooms/MapRoom.ts`):
- `handleFriendAdd` (line 4034): Validates target, checks block lists, calls `friendManager.addFriend()` (bidirectional), persists both directions via `accountStore.addFriend()`, sends `FRIEND_RESULT` + `FRIEND_LIST`, notifies online target
- `handleFriendRemove` (line 4112): Validates friendship exists, removes bidirectionally via `friendManager.removeFriend()`, persists, notifies target
- `sendFriendListToClient` / `sendFriendListToAccountId`: Build and push full friend lists
- Message handlers wired at lines 1109-1114 for `FRIEND_ADD` and `FRIEND_REMOVE`

**Persistence** (`packages/server/src/persistence/`):
- `friends` table via migration `010_friends.sql` (account_id, friend_account_id, unique constraint, indexes)
- `accountStore.addFriend()`, `removeFriend()`, `getFriendAccountIds()` at lines 481-502 of store.ts
- `FriendStore` class (line 1528) with `loadNow()` / `persistNow()` for boot-time load and shutdown flush
- Friends loaded into `friendManager` singleton on boot

**friendManager** (`packages/server/src/friendManager.ts`):
- Bidirectional friend tracking (`addFriend`, `removeFriend`, `areFriends`, `getFriendIds`)
- Online session registration/unregistration
- `buildFriendList()` with character lookup + online status resolution
- `broadcastStatus()` for cross-room friend notifications (uses its own `send` callbacks, not channelRegistry)

**Lifecycle integration**:
- `onJoin`: Registers with `friendManager`, sends friend list, broadcasts online status
- `onReconnect`: Re-registers with `friendManager`
- `onLeave`: Broadcasts offline status, unregisters from `friendManager`

**Client** (`packages/client/src/scenes/UI.ts`):
- Full friends panel: add input, sorted friend list (online first), online/offline dots, level display, remove buttons
- Context menu: whisper + remove
- Listeners: `FRIEND_LIST`, `FRIEND_RESULT`, `FRIEND_REMOVED`, `ONLINE_STATUS`
- Toggle with F key

**Tests** (`packages/server/test/friends.ts`):
- Full integration test: friend add, bidirectional sync, online status broadcast on join/leave, whisper delivery

### One gap: channel info not shown

The `FriendEntry` interface in `@maple/shared` has `mapId?` but no `channel` field. The user asked to "cross-reference `channelRegistry.ts`" to show channel/map status. Currently `friendManager` uses its own online registry (which has `mapId`) but doesn't consult `channelRegistry` (which has `channel`). Adding channel info would require:

1. Add `channel?: number` to `FriendEntry` in `packages/shared/src/net.ts`
2. Update `friendManager.buildFriendList()` to accept a channel lookup
3. Update `sendFriendListToClient` / `sendFriendListToAccountId` to pass channel info
4. Update client `renderFriendsList()` to show channel number next to map name

## Steps

1. Add `channel?: number` to `FriendEntry` in `packages/shared/src/net.ts`
2. Update `FriendEntry` display in `packages/client/src/scenes/UI.ts` renderFriendsList to show channel (if desired)
3. Run `pnpm --filter @maple/server test` to verify existing tests pass
4. Run `pnpm typecheck` to verify no type errors
