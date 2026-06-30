# Cross-Map Parties, LFG Board & Loot Rules

## Architecture Summary

The current party system is **session-scoped** — each `MapRoom` creates its own `PartyManager` instance (line 542), and party state (members, leader, invites) lives entirely within that one Colyseus room. We will refactor to a **global singleton** (identical to the `GuildManager` pattern at `packages/server/src/guildManager.ts`), add a **party finder/LFG board**, and implement **loot distribution rules**.

## Files to Change

| File | Change |
|------|--------|
| `packages/server/src/partyManager.ts` | **Major rewrite**: convert to global singleton with cross-room member tracking, online registration, loot rule state, LFG listings, round-robin tracker |
| `packages/server/src/rooms/MapRoom.ts` | Replace `private partyManager = new PartyManager()` with import of global singleton; update all call sites; add LFG/loot-rule message handlers; update `onJoin`/`onLeave` for online registration |
| `packages/shared/src/net.ts` | Add new message types (LFG_POST, LFG_LIST, LFG_JOIN, LFG_REMOVE, PARTY_SET_LOOT_RULE) and their payload interfaces |
| `packages/server/src/types.ts` | Re-export new types from shared |
| `packages/client/src/state-views.ts` | Add `LfgListingView` interface |
| `packages/client/src/scenes/UI.ts` | Add LFG board panel + loot rule selector to party panel + mapId display per member |
| `packages/server/test/party.ts` | Update tests for cross-map party, add loot rule tests |

## Detailed Design

### 1. Global PartyManager Singleton (replaces room-scoped instance)

**Pattern**: Mirrors `GuildManagerImpl` — singleton with `registerOnline`/`unregisterOnline`, send callbacks, cross-room relay.

**Critical design**: Party membership is indexed by **charId** (stable across room transitions), NOT sessionId (which changes on every map change). Online tracking is separate by sessionId with a charId reverse index.

```
class PartyManagerImpl {
  // Party state (charId-keyed — survives map changes)
  private parties = new Map<string, Party>();
  private charPartyIndex = new Map<string, Party>(); // charId → party
  private pendingInvites = new Map<string, PendingInvite>(); // inviteeCharId → invite
  private nextPartyId = 1;

  // Online tracking (sessionId-keyed — changes per room)
  private onlineMembers = new Map<string, OnlineMember>(); // sessionId → info
  private charOnlineIndex = new Map<string, string>();     // charId → sessionId
  private lastSeen = new Map<string, number>();             // charId → epoch-ms

  // LFG listings (charId-keyed)
  private lfgListings = new Map<string, LfgListing>(); // listingId → listing
}
```

**Party interface**:
```typescript
export type LootRule = "ffa" | "roundRobin" | "leader";

export interface Party {
  id: string;
  leaderCharId: string;       // stable across rooms
  members: Map<string, PartyMember>; // charId → member
  lootRule: LootRule;
  roundRobinIndex: number;    // rotation position into members array
}
```

**PartyMember interface**:
```typescript
export interface PartyMember {
  charId: string;   // primary key (stable)
  name: string;
  level: number;
  hp: number; maxHp: number;
  mp: number; maxMp: number;
  dead: boolean;
  mapId: string;    // current map (updated on onJoin)
}
```

**OnlineMember interface** (for send callbacks only):
```typescript
export interface OnlineMember {
  sessionId: string; // room-scoped, changes per map
  charId: string;    // stable
  name: string;
  level: number;
  mapId: string;
  send: (type: string | number, payload: unknown) => void;
}
```

**Cross-room methods**:
- `registerOnline(sessionId, charId, name, level, mapId, send)` — `MapRoom.onJoin`
- `unregisterOnline(sessionId)` — `MapRoom.onLeave` (online only, NOT party)
- `updateOnlineStats(charId, hp, maxHp, mp, maxMp, level, dead)` — periodic tick
- `buildUpdate(charId)` — builds `PartyUpdatePayload` using online stats
- `buildUpdateForParty(party)` — builds updates for all members
- `getPartyChatRecipients(senderCharId)` — returns online members to relay to
- `sweepOfflineMembers()` — periodic cleanup of members offline > 5 min (handles true disconnects)

**Invite changes**:
- `invite(fromCharId, targetName)` — resolves target by name in global online registry (cross-room)
- `accept(acceptCharId, fromCharId)` — works via charId, not sessionId
- Both players can be in different rooms/maps

**EXP sharing change**:
- `computePartyExp()` checks `member.mapId === killerMapId` AND proximity (x/y distance)
- Members on different maps don't get EXP but remain in the party

**Loot rule methods**:
- `setLootRule(charId, rule)` — leader only
- `canPickup(charId)` — FFA=always, roundRobin=next in rotation, leader=leader only
- `onPickup(charId)` — advances round-robin counter

### 2. MapRoom Integration

**onJoin** (after loading player, after guildManager.registerOnline):
```typescript
partyManager.registerOnline(
  client.sessionId,
  character.charId,
  character.name,
  player.level,
  this.state.mapId,
  (type, payload) => client.send(type, payload),
);
// If player was already in a party (cross-map), send them the party update
const party = partyManager.getPartyByChar(character.charId);
if (party) {
  client.send(MessageType.PARTY_UPDATE, partyManager.buildUpdate(character.charId));
}
```

**onLeave** (replaces current partyManager.handleDisconnect):
```typescript
partyManager.unregisterOnline(client.sessionId);
// Do NOT remove from party — membership persists across map changes.
// sweepOfflineMembers() handles true disconnects (offline > 5 min).
```

**Map travel**: No explicit call needed — `onJoin` in the new room naturally updates mapId via registerOnline.

**handlePartyInvite** changes:
- Client sends `{ targetName: string }` instead of `{ targetSessionId }` (client already collects a name)
- Server calls `partyManager.invite(player.charId, target.name)` — singleton resolves name to online session
- Cross-room: invite works regardless of which map each player is on

**handlePartyAccept** changes:
- Uses charId-based accept: `partyManager.accept(acceptCharId, fromCharId)`
- Sends party update to both players via their send callbacks (may be in different rooms)

**handlePickup** changes:
- Call `partyManager.canPickup(player.charId)` before allowing pickup
- On successful pickup with roundRobin, call `partyManager.onPickup(player.charId)`

**syncPartyStats** changes:
- Uses `partyManager.updateOnlineStats()` for each local player's stats
- Singleton relays to cross-room members via send callbacks

**New message handlers**:
- `PARTY_SET_LOOT_RULE`: leader changes loot rule
- `LFG_POST`: player posts an LFG listing
- `LFG_LIST`: client requests current listings
- `LFG_JOIN`: player joins an LFG listing (forms party)
- `LFG_REMOVE`: player removes their listing

### 3. New Net Messages

Add to `packages/shared/src/net.ts` (IDs after MARKET_PRICE_HISTORY: 142):

```typescript
PARTY_SET_LOOT_RULE: 143,
LFG_POST: 144,
LFG_LIST: 145,
LFG_LIST_RESULT: 146,
LFG_JOIN: 147,
LFG_REMOVE: 148,
```

Updated payload for `PartyInvitePayload`:
```typescript
export interface PartyInvitePayload {
  /** Target player name (resolved server-side for cross-map). */
  targetName: string;
}
```

Updated `PartyUpdatePayload`:
```typescript
export interface PartyUpdatePayload {
  partyId: string;
  members: PartyMemberSnapshot[];
  lootRule: LootRule;  // NEW field
}
```

New payloads:
```typescript
export type LootRule = "ffa" | "roundRobin" | "leader";

export interface PartySetLootRulePayload {
  lootRule: LootRule;
}

export interface LfgPostPayload {
  contentType: string;  // e.g. "boss", "grind", "pq", "quest"
  levelMin: number;
  levelMax: number;
  message: string;
}

export interface LfgListingSnapshot {
  listingId: string;
  hostCharId: string;   // charId, not sessionId!
  hostName: string;
  hostLevel: number;
  contentType: string;
  levelMin: number;
  levelMax: number;
  message: string;
  memberCount: number;
  maxMembers: number;
  createdAt: number;
}

export interface LfgListResultPayload {
  listings: LfgListingSnapshot[];
}

export interface LfgJoinPayload {
  listingId: string;
}

export interface LfgRemovePayload {
  listingId: string;
}
```

### 4. LFG Listing (inside partyManager.ts)

```typescript
export interface LfgListing {
  listingId: string;
  hostCharId: string;   // stable across rooms
  hostName: string;
  hostLevel: number;
  contentType: string;
  levelMin: number;
  levelMax: number;
  message: string;
  createdAt: number;
}
```

**LFG methods on PartyManagerImpl**:
- `postLfg(charId, name, level, contentType, levelMin, levelMax, message)` — creates listing
- `getLfgListings()` — returns all active (non-expired) listings
- `joinLfg(joinerCharId, listingId)` — forms a party with host + joiner
- `removeLfg(charId)` — removes the caller's listing
- `expireLfgListings()` — removes listings older than 5 min (called internally)

### 5. Client UI Changes

**PartyPanel changes** (in `UI.ts`, extend `renderPartyPanel`):
- Show each member's mapId (e.g. "Meadowfield" / "Cross Road" etc.)
- Show loot rule selector below the EXP indicator (leader-only interactive buttons: FFA | RR | Leader)
- Add "Find Party" button that opens the LFG board

**LFG Board panel** (new panel, similar pattern to guild window):
- Scrollable list of active LFG listings
- Each listing shows: host name, level, content type, member count, message
- "Join" button per listing
- "Post Listing" form at top (content type dropdown, level range, message input)
- Toggle with "L" key (next available key)

**state-views.ts** additions:
```typescript
// Add LootRule import + extend PartyMemberView if needed
export type LootRule = "ffa" | "roundRobin" | "leader";

// LFG listing view for the client
export interface LfgListingView {
  listingId: string;
  hostCharId: string;
  hostName: string;
  hostLevel: number;
  contentType: string;
  levelMin: number;
  levelMax: number;
  message: string;
  memberCount: number;
  maxMembers: number;
  createdAt: number;
}
```

(The existing `PartyMemberView` already has `mapId` — no changes needed there.)

### 6. Test Updates

Update `packages/server/test/party.ts`:
- **Test 1** (form party): update to use global singleton
- **Test 2** (shared EXP): verify cross-map members don't get EXP, same-map members do
- **Test 3** (leader reassign): update for global singleton
- **Test 4** (NEW: loot rules): verify FFA/roundRobin/leader behavior
- **Test 5** (NEW: LFG): verify posting, listing, joining LFG

## Risks & Mitigations

1. **Ghost party members on true disconnect**: `onLeave` only removes online tracking, not party membership. Mitigation: `sweepOfflineMembers()` runs periodically (every 60s) and removes party members offline > 5 minutes. This handles browser-close / connection-loss.

2. **Map travel transition gap**: Player leaves room A → joins room B. During the ~100ms gap, they're unregistered from online tracking. Their send callback is stale. Mitigation: party membership persists by charId. When they join room B, `registerOnline` updates their send callback and mapId. Cross-room messages during the gap are lost (acceptable — same as current single-room behavior).

3. **Party state staleness**: Stats (HP/MP/level) need cross-room sync. Mitigation: each room's `syncPartyStats` tick calls `updateOnlineStats()` for local party members. The singleton relays to cross-room members via their send callbacks.

4. **LFG listing expiry**: Auto-expires after 5 min. `expireLfgListings()` called internally on `getLfgListings()`.

5. **charId vs sessionId consistency**: Party membership is always charId-keyed. Online tracking is sessionId-keyed with charId reverse index. This matches the GuildManager pattern exactly.

## Verification

1. `pnpm --filter @maple/server test` — all existing + new tests pass
2. `pnpm typecheck` — no TypeScript errors across all packages
3. Manual: form a party, travel to a different map, verify party panel shows members on different maps with correct map names
4. Manual: set loot rule to roundRobin, verify only the designated player can pick up
5. Manual: post an LFG listing, have another player join, verify party forms

## Steps

1. **`packages/shared/src/net.ts`** — Add LootRule type, PARTY_SET_LOOT_RULE (143), LFG_POST (144), LFG_LIST (145), LFG_LIST_RESULT (146), LFG_JOIN (147), LFG_REMOVE (148) message types. Add PartySetLootRulePayload, LfgPostPayload, LfgListingSnapshot, LfgListResultPayload, LfgJoinPayload, LfgRemovePayload interfaces. Update PartyInvitePayload to use targetName. Update PartyUpdatePayload to include lootRule.

2. **`packages/server/src/types.ts`** — Re-export new types from shared.

3. **`packages/server/src/partyManager.ts`** — Rewrite as global singleton (GuildManager pattern): charId-keyed party membership, sessionId-keyed online tracking with charId reverse index, send callbacks, loot rules on Party, round-robin tracker, LFG listings, sweepOfflineMembers, canPickup/onPickup/setLootRule, cross-room chat relay.

4. **`packages/server/src/rooms/MapRoom.ts`** — Import global partyManager singleton. Update onJoin: registerOnline + send party state if in party. Update onLeave: unregisterOnline only (no party removal). Update handlePartyInvite: use targetName, cross-room resolve. Update handlePartyAccept: charId-based. Update handlePartyChat: relay via partyManager. Update syncPartyStats: use updateOnlineStats. Update handlePickup: check canPickup. Add handlers for PARTY_SET_LOOT_RULE, LFG_POST, LFG_LIST, LFG_JOIN, LFG_REMOVE.

5. **`packages/client/src/state-views.ts`** — Add LfgListingView, LootRule type.

6. **`packages/client/src/scenes/UI.ts`** — Loot rule selector in party panel. MapId per member. "Find Party" button. LFG board panel with list + post + join.

7. **`packages/server/test/party.ts`** — Update for singleton. Add loot rule + LFG tests.

8. **Verify** — `pnpm --filter @maple/server test && pnpm typecheck`
