# Quest Engine Implementation Plan

## Context

The server has a `giveQuest` dialog action placeholder in `MapRoom.ts:executeDialogAction` (line 1035-1042) that currently just sends a `quest_start` message without persisting anything. The shared quest defs (`packages/shared/src/quests.ts`) define 5 quests (4 Dawn Isle tutorial + 1 Meadowfield) with Kill/Collect/Talk/Level objectives. We need to make the full lifecycle work: accept → track progress → turn in → reward.

## Architecture Decisions

- **Messages over Schema**: Quest state changes push explicit `quest_update` messages (like chat/dialog), not Colyseus schema. Keeps combat ticks lightweight and matches existing patterns.
- **Server-only quest state on Player**: Quest state lives as a plain array on the Player object (not `@type`-decorated) so it never syncs. Messages handle client sync.
- **Auto-turn-in on NPC talk**: When talking to a quest giver with all objectives complete, auto-grant rewards. Prevents needing a separate turn-in message type.
- **MapRoom only**: All maps now use MapRoom (TownRoom is not registered in app.config). Quest hooks go in MapRoom only.

## Files to Modify/Create

### 1. `packages/shared/src/quests.ts` — Add QuestState types

Add exported interfaces after the existing QuestDef:

```ts
export type QuestStatus = "available" | "active" | "complete" | "turnedIn";

export interface ObjectiveProgress {
  kind: string;
  current: number;
  target: number;
}

export interface QuestState {
  questId: string;
  status: QuestStatus;
  objectiveProgress: ObjectiveProgress[];
}
```

### 2. `packages/shared/src/net.ts` — Add QUEST_UPDATE message type

Add `QUEST_UPDATE: 11` to the `MessageType` const.

### 3. `packages/server/src/persistence/store.ts` — Persist quest state

Add `quests?: QuestState[]` to `CharacterRecord` interface. Import `QuestState` from `@maple/shared`.

### 4. `packages/server/src/questEngine.ts` — New file: quest logic

Pure-ish functions operating on a `QuestState[]`:

| Function | Purpose |
|---|---|
| `initializeQuests(questIds)` | Create initial states for all known quest ids (status: "available") |
| `acceptQuest(quests, questId)` | Validate available + level req → set active, create ObjectiveProgress entries |
| `turnInQuest(quests, questId, store, player)` | Validate all objectives complete → grant mesos/exp/items, mark turnedIn |
| `progressObjectives(quests, kind, matchKey, matchValue)` | Scan active quests for matching objectives, increment, mark "complete" if target reached |
| `getActiveQuests(quests)` | Filter active quests |
| `sendQuestUpdate(client, quests)` | Send `QUEST_UPDATE` message to client |
| `ensureQuestStates(quests)` | Migrate/initialize quest states from persistence (handles characters created before quest system) |

### 5. `packages/server/src/rooms/MapRoom.ts` — Wire hooks

**Server-only field on Player (no schema)**:
- `questState: QuestState[]` — added to Player class as a plain property (not `@type`)

**onJoin** (line 1080): After restoring inventory, load `character.quests ?? []`, call `ensureQuestStates()` to merge any new quests, assign to `player.questState`, send initial `quest_update`.

**killMob** (line 596): After rewarding mesos/exp, call `progressObjectives(killer.questState, "kill", mob.mobId, 1)`. If any objectives changed, send `quest_update`.

**handlePickup** (line 686): After adding item to inventory, call `progressObjectives(player.questState, "collect", item.defId, 1)`. If changed, send `quest_update`.

**applyLeveling** (line 617): After level-up loop, call `progressObjectives(player.questState, "level", player.level, player.level)`. Level objectives check `current >= target`, so we pass the new level. If changed, send `quest_update`.

**handleTalkNpc** (line 903): After range check, before starting dialog:
1. Call `progressObjectives(player.questState, "talk", npcId, 1)` — complete any talk objectives
2. Check for auto-turn-in: find active quests where `giverNpcId === npcId` and all objectives complete → call `turnInQuest`

**executeDialogAction** (line 1022, giveQuest case): Replace the TODO with:
1. Check if already `turnedIn` → send error message
2. Check if already `active` → send "already in progress" message
3. Call `acceptQuest(player.questState, questId, player.level)` → send `quest_update`

**persistPlayer** (line 1185): Add `quests: player.questState ?? []` to the update patch.

### 6. `packages/server/src/types.ts` — Re-export QUEST_UPDATE (already covered by re-exporting from shared)

### 7. `packages/server/src/rooms/schema/Player.ts` — Add questState property

Add non-synced property: `questState: QuestState[] = [];` (plain property, no `@type`).

### 8. `packages/server/test/quests.ts` — New test file

Test: accept a kill quest, kill the required mobs, and turn it in for rewards.

```
1. Boot, create character on dawn_isle
2. Position near Guide Iris (225, 80)
3. TALK_NPC → walk dialog → pick "giveQuest" → verify quest_active message
4. Verify quest state is "active" with 0/5 progress
5. Kill 5 friendly_snail mobs (position near snails, swing)
6. Verify quest state shows 5/5 progress and status "complete"
7. TALK_NPC to Iris again → verify auto-turn-in, rewards granted
8. Verify mesos increased, exp increased, item in inventory
9. Try to accept the same quest again → verify rejection
10. Try to turn in again → verify rejection
```

### 9. `packages/server/package.json` — Add test to script

Add `tsx test/quests.ts` to the `test` script chain.

## Client-Facing Message Shapes

```ts
// quest_update — full quest log snapshot
{
  quests: Array<{
    questId: string;
    name: string;
    status: "available" | "active" | "complete" | "turnedIn";
    objectiveProgress: Array<{
      kind: string;
      description: string;
      current: number;
      target: number;
    }>;
  }>
}

// quest_turnin — reward notification
{
  questId: string;
  questName: string;
  mesos: number;
  exp: number;
  items: string[];
}
```

## Dawn Isle Tutorial Chain Flow

1. Player talks to Guide Iris → dialog shows choices → "I'm ready to go!" triggers `giveQuest` for `quest.dawn_trio` (kill quest)
   - `acceptQuest` marks it active with `{ kind: "kill", mobId: "mob.friendly_snail", current: 0, target: 5 }`
2. Player kills 5 snails → `killMob` calls `progressObjectives` → quest status becomes "complete"
3. Player talks to Iris again → auto-turn-in fires → grants 120 mesos, 30 exp, Bronze Shortsword
4. Player talks to Iris → can now accept `quest.dawn_level3` (level quest, requires level 1, already met)
5. Player grinds to level 3 → `applyLeveling` calls `progressObjectives` → quest completes
6. Player talks to Iris → turn-in → grants 200 mesos, 50 exp, Leather Cap
7. Player talks to Iris → can accept `quest.dawn_ferry` (level 8 requirement blocks until then)

Note: Q1 (`quest.dawn_tutorial`) is a talk-to-Iris quest that auto-completes on first talk. The NPC dialog currently starts at node 0 which is linear text, so the first dialog path with Iris goes through nodes 0→1→2(branch). The branch has the `giveQuest` action. We could add Q1 completion on the first talk, but since it's not wired into the dialog tree's `giveQuest` action, it would need a separate mechanism. For the MVP, Q2 (Pest Control) is the first quest the player gets via the dialog choice, which is the critical path.

## Risks / Mitigations

- **Race conditions on quest state**: All quest operations are synchronous on the server tick. No concurrent access issues.
- **Persistence migration**: Characters created before this feature have no `quests` field. `ensureQuestStates()` handles this by merging known quest IDs with existing state.
- **Talk objective double-counting**: Talk objectives are binary (target=1). Once `current=1`, re-triggering is a no-op.

## Steps

1. Add `QuestStatus`, `ObjectiveProgress`, `QuestState` types to `packages/shared/src/quests.ts`
2. Add `QUEST_UPDATE: 11` to `MessageType` in `packages/shared/src/net.ts`
3. Add `quests?: QuestState[]` to `CharacterRecord` in `packages/server/src/persistence/store.ts`
4. Add `questState: QuestState[] = []` (non-synced) to `Player` schema class in `packages/server/src/rooms/schema/Player.ts`
5. Create `packages/server/src/questEngine.ts` with all quest logic functions
6. Wire quest hooks into `MapRoom.ts`: onJoin load, killMob progress, handlePickup progress, applyLeveling progress, handleTalkNpc talk progress + auto-turn-in, executeDialogAction accept, persistPlayer save
7. Create `packages/server/test/quests.ts` with end-to-end kill quest test
8. Add `tsx test/quests.ts` to server `package.json` test script
9. Run `pnpm --filter @maple/server test` and `pnpm -r typecheck` to verify
