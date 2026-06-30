# Title System Implementation Plan

## Overview
Titles are defined in achievements (e.g. "Slayer", "Veteran") but never stored, equipped, or rendered. This adds an owned-titles list + equipped title to the Player, grants titles when achievements unlock, adds equip/unequip networking, renders titles above character sprites, and adds a title-selection UI in the stat panel.

## Files to Modify

### 1. `packages/shared/src/net.ts` — Add wire-protocol messages
- Add `TITLE_EQUIP: 133` to `MessageType`
- Add `TITLE_SYNC: 134` to `MessageType`
- Add `EquipTitlePayload` interface: `{ title: string }` (empty string = unequip)
- Add `TitleSyncPayload` interface: `{ ownedTitles: string[]; equippedTitle: string }`

### 2. `packages/server/src/rooms/schema/Player.ts` — Add synced title fields
- Import `ArraySchema` from `@colyseus/schema`
- Add `@type("string") equippedTitle = ""` (synced to all clients)
- Add `@type(["string"]) ownedTitles: string[] = []` (synced to all clients — client needs the list for UI selection)

### 3. `packages/client/src/state-views.ts` — Mirror title fields
- Add `equippedTitle: string` and `ownedTitles: string[]` to `PlayerView`

### 4. `packages/server/src/persistence/store.ts` — Persist titles
- Add `ownedTitles?: string[]` and `equippedTitle?: string` to `CharacterRecord`
- Add entries to `CHAR_COL` mapping: `ownedTitles → "owned_titles"`, `equippedTitle → "equipped_title"`
- Add `ownedTitles` to `JSON_CHAR_KEYS`
- Add deserialization: `ownedTitles: row.owned_titles != null ? JSON.parse(...) : []`, `equippedTitle: row.equipped_title as string || ""`
- Backfill defaults in `getOrCreate` (empty array / empty string)

### 5. `packages/server/src/persistence/migrations/014_titles.sql` — DB migration
```sql
ALTER TABLE characters ADD COLUMN owned_titles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE characters ADD COLUMN equipped_title TEXT NOT NULL DEFAULT '';
```

### 6. `packages/server/src/rooms/MapRoom.ts` — Server logic
**On join (`onJoin`):**
- Load `player.ownedTitles = character.ownedTitles ?? []`
- Load `player.equippedTitle = character.equippedTitle ?? ""`
- Send initial `TITLE_SYNC` to client

**On achievement unlock (existing loops):**
- In each place where `ACHIEVEMENT_UNLOCK` is sent, if `achDef.rewards.title` exists:
  - Add to `player.ownedTitles` (deduplicate)
  - Auto-equip the first title if player has none equipped
  - Persist via `accountStore.updateCharacter(player.charId, { ownedTitles, equippedTitle })`
  - Send `TITLE_SYNC` to the client

**New message handler `[MessageType.TITLE_EQUIP]`:**
- Validate: title must be in `player.ownedTitles` (or empty string to unequip)
- Set `player.equippedTitle = title`
- Persist and send `TITLE_SYNC`

**In `persistPlayer`:**
- Include `ownedTitles: player.ownedTitles` and `equippedTitle: player.equippedTitle`

**Imports:**
- Add `EquipTitlePayload`, `TitleSyncPayload` to type imports
- Add `MessageType.TITLE_EQUIP`, `MessageType.TITLE_SYNC` references

### 7. `packages/client/src/scenes/MapScene.ts` — Render title above sprite
**`createPlayerTag`:**
- Add a `titleText` element below the name label showing the equipped title (gold color, smaller font)
- Store it on the container as `container.setData("title", titleText)`

**`updatePlayerTagText`:**
- Accept optional `title` parameter, update the title text element
- Hide title text if empty

**Player `onAdd` / `onChange`:**
- Pass `player.equippedTitle` to `updatePlayerTagText`
- On change, call `updatePlayerTagText` with updated title

**Tag vertical offset:**
- `syncPlayerTag` shifts up slightly when a title is present (adds ~14px for the title line)

### 8. `packages/client/src/scenes/UI.ts` — Title selection in stat panel
**In `renderStatPanel` (after Fame section, before background):**
- Add a "Title" divider + label showing currently equipped title
- If player has owned titles, render each as a row with:
  - Title name in gold
  - "Equipped" badge if it matches `equippedTitle`, or an "Equip" button otherwise
- Equip button sends `MessageType.TITLE_EQUIP` to server

**`onAdd` / `onChange` for player:**
- Re-render stat panel if open when titles change

## Steps
1. Add `MessageType.TITLE_EQUIP` (133) and `MessageType.TITLE_SYNC` (134) + payload types to `packages/shared/src/net.ts`
2. Add `EquipTitlePayload` and `TitleSyncPayload` re-exports to `packages/server/src/types.ts`
3. Add `equippedTitle` + `ownedTitles` to Player schema in `packages/server/src/rooms/schema/Player.ts`
4. Add `equippedTitle` + `ownedTitles` to `PlayerView` in `packages/client/src/state-views.ts`
5. Add DB migration `014_titles.sql`
6. Add persistence fields + serialization to `packages/server/src/persistence/store.ts`
7. Add server logic in `MapRoom.ts`: join load, achievement grant, TITLE_EQUIP handler, persistPlayer, TITLE_SYNC send
8. Render title above character sprites in `MapScene.ts` (createPlayerTag + updatePlayerTagText)
9. Add title selection UI to stat panel in `UI.ts`
10. Run `pnpm --filter @maple/server test` and `pnpm typecheck`
