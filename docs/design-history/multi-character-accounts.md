# Multi-Character Accounts

## Goal
Introduce real multi-character accounts. Mesos and inventory move from Account to CharacterRecord. TownRoom loads characters instead of hardcoding WARRIOR. MarketRoom tracks characters per session. Existing MarketRoom listing flow preserved.

## Data Model Changes (`packages/server/src/persistence/store.ts`)

### New: `CharacterRecord` interface
```ts
interface CharacterRecord {
  charId: string;
  accountId: string;
  name: string;
  archetype: string;            // ClassArchetype value
  appearance: CharacterAppearance; // from @maple/shared
  level: number;
  exp: number;
  ap: number;
  sp: number;
  stats: { STR: number; DEX: number; INT: number; LUK: number; HP: number; MP: number };
  mesos: number;                // moved from Account
  mapId: string;
  x: number;
  y: number;
  inventory: Record<string, ItemRecord>; // moved from Account
  equipped?: Record<string, string>;
  createdAt: number;
}
```

### Account changes
- Remove `mesos` and `inventory` from `Account` interface (account-wide fields like future cash balance remain).
- `getOrCreate(accountId)` keeps returning `Account` — just no mesos/inventory on it anymore.

### New AccountStore methods
| Method | Signature | Notes |
|---|---|---|
| `createCharacter` | `(accountId, { name, archetype, appearance }) → CharacterRecord` | Auto-generates `charId` via `chr_<seq>`, sets starter mesos (STARTER_MESOS) |
| `listCharacters` | `(accountId) → CharacterRecord[]` | Filter by accountId |
| `getCharacter` | `(charId) → CharacterRecord \| undefined` | Direct lookup |
| `updateCharacter` | `(charId, patch: Partial<CharacterRecord>) → void` | Shallow merge, flush |
| `deleteCharacter` | `(charId) → boolean` | Remove from map, flush |

### Character-level mesos/inventory methods (replace account-level signatures)
| Old signature | New signature | Notes |
|---|---|---|
| `setMesos(accountId, n)` | `setMesos(charId, n)` | Now routes by charId |
| `addMesos(accountId, d)` | `addMesos(charId, d)` | Now routes by charId |
| `spendMesos(accountId, a)` | `spendMesos(charId, a)` | Now routes by charId |
| `addItem(accountId, item)` | `addItem(charId, item)` | Now routes by charId |
| `removeItem(accountId, uid)` | `removeItem(charId, uid)` | Now routes by charId |

### Persistence
- New `CHARACTERS_FILE = "${DATA_DIR}/characters.json"` alongside `ACCOUNTS_FILE`.
- Characters stored as `Record<string, CharacterRecord>` (keyed by charId).
- `persistNow()` writes both accounts and characters.
- Internal counter `charSeq` for generating unique charIds, restored from persisted data.

---

## Player Schema (`packages/server/src/rooms/schema/Player.ts`)
- Add `charId = ""` as server-only plain property (no `@type`) next to `accountId` on line 53.
- Same pattern: never synced to clients, only used server-side for persistence writes.

---

## TownRoom Changes (`packages/server/src/rooms/TownRoom.ts`)

### `onJoin` (line 760)
- Accept `{ charId?: string; accountId?: string; name?: string }` in options.
- If `charId` provided → load character via `accountStore.getCharacter(charId)`.
- If only `accountId` → pick first character via `accountStore.listCharacters(accountId)[0]`, or create a default BEGINNER character with random appearance.
- Populate Player from the character record (archetype, level, stats, mesos, inventory, x, y).
- Remove hardcoded `ClassArchetype.WARRIOR`.
- Set `player.charId`.

### `killMob` (line 519)
- `accountStore.setMesos(killer.accountId, killer.mesos)` → `accountStore.setMesos(killer.charId, killer.mesos)`

### `handlePickup` (line 606)
- `accountStore.addItem(player.accountId, ...)` → `accountStore.addItem(player.charId, ...)`

---

## MarketRoom Changes (`packages/server/src/rooms/MarketRoom.ts`)

### Session tracking (line 36)
- Rename `accountBySession` → `charBySession: Map<string, string>` (sessionId → charId).
- Store `charId` (also used for `sellerId` in listings).

### `onJoin` (line 52)
- Resolve charId: if `options.charId` provided, use it. If `options.accountId`, take first character. Otherwise create default character.
- Store in `charBySession`.

### All handlers
- `accountStore.getOrCreate(accountId)` → `accountStore.getCharacter(charId)`.
- `accountStore.removeItem(accountId, uid)` → `accountStore.removeItem(charId, uid)`.
- `accountStore.addItem(accountId, item)` → `accountStore.addItem(charId, item)`.
- `accountStore.spendMesos(buyerCharId, price)` → direct call with charId.
- `accountStore.addMesos(sellerCharId, delta)` → direct call with charId.

### `pushWallet` (line 141)
- Reads mesos/inventory from character, not account.

---

## Test Changes

### `packages/server/test/smoke.ts`
- Create a character before joining (or rely on TownRoom auto-creating a default character when only `accountId` is provided).
- Minor: player mesos/exp assertions unchanged.

### `packages/server/test/market.ts`
- Replace account-level calls: `accountStore.createCharacter(...)` to create seller/buyer characters.
- Join market with `charId` option.
- Assert character-level mesos/inventory.
- `accountStore.getOrCreate(accountId)` to ensure account exists, then `createCharacter` for the character.

### New: `packages/server/test/characters.ts`
Test plan:
1. Create account "test_acct"
2. Create two characters (different names, archetypes)
3. List characters → assert both present
4. Mutate character 1: setMesos(500), addItem(some item)
5. Reload store from disk (re-instantiate AccountStore)
6. Assert character 1 has mesos=500 + item, character 2 unchanged
7. Delete character 2, reload, assert only character 1 remains

### `packages/server/package.json`
- Update test script: `tsx test/smoke.ts && tsx test/market.ts && tsx test/characters.ts`

---

## Risks & Mitigations
- **Smoke test**: TownRoom.onJoin creates a default character if none exists, so existing smoke test works without changes.
- **MarketRoom Listings**: `sellerId` stores charId (still a string) — ListingRecord shape unchanged.
- **TypeScript strict**: All new fields typed, no `any`. Import `CharacterAppearance` from `@maple/shared`.

## Steps
1. Rewrite `packages/server/src/persistence/store.ts`: add CharacterRecord interface, remove mesos/inventory from Account, add character CRUD + char-level mesos/inventory methods, add CHARACTERS_FILE persistence, internal charSeq counter.
2. Add `charId = ""` as server-only plain property to `packages/server/src/rooms/schema/Player.ts` (next to `accountId` on line 53).
3. Update `packages/server/src/rooms/TownRoom.ts`: onJoin loads/creates character from charId/accountId, killMob/handlePickup use player.charId, remove WARRIOR hardcode.
4. Update `packages/server/src/rooms/MarketRoom.ts`: charBySession, resolve charId on join, all store operations use charId, pushWallet reads from character.
5. Update `packages/server/test/smoke.ts`: create account + default character before joining, minor adjustments.
6. Update `packages/server/test/market.ts`: create characters via store, join market with charId, assert character-level mesos/inventory.
7. Write new `packages/server/test/characters.ts`: full create/mutate/reload/isolation/delete test.
8. Update `packages/server/package.json` test script to include characters test.
9. Run `pnpm --filter @maple/server test` and `pnpm -r typecheck`.
