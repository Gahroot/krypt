# Plan: Authoritative Active-Skill Casting with Status Effects

## Current State

The `handleSkillCast` in `MapRoom.ts` already validates skill existence, learned state, cooldown, and MP cost. It applies active-skill damage via `computeDamage` and deducts MP / sets cooldown. However:

1. **Buff handling is superficial** — broadcasts a cosmetic `STATUS_EFFECTS` message but never stores `StatusEffect` objects on the player or uses the effects model (`applyEffect`, `skillBuffToStatusEffect`).
2. **No status-effect storage on Player** — the `Player` schema has no `statusEffects` array.
3. **No effect ticking** — `tickPlayerTimers` never calls `tickEffects`, so DoT/HoT ticks never fire and buffs never expire server-side.
4. **`aggregateSecondary` is never folded** into combat stats — buffs have no gameplay effect.
5. **`targetIds` missing** from `SkillCastPayload` — client can't suggest specific targets.
6. **No tests** for cooldown rejection, multi-target damage, or buff apply-then-expire.

## Changes

### 1. Extend `SkillCastPayload` (shared/src/net.ts)

Add optional `targetIds` field:

```ts
export interface SkillCastPayload {
  skillId: string;
  targetIds?: string[];
}
```

No new message type needed — reuses `SKILL_CAST: 84`.

### 2. Add status-effect storage to `Player` schema (server/src/rooms/schema/Player.ts)

Add two **server-only** (no `@type`) fields:

```ts
statusEffects: StatusEffect[] = [];
effectElapsedMap: Map<string, number> = new Map();
```

Import `StatusEffect` from `@maple/shared`.

### 3. Enhance `handleSkillCast` buff path (server/src/rooms/MapRoom.ts)

Replace the superficial buff broadcast with proper effects-model usage:

- Import `applyEffect`, `skillBuffToStatusEffect` from `@maple/shared`.
- On buff cast: create `StatusEffect` via `skillBuffToStatusEffect(skillId, stats.buffEffect, stats.buffDurationMs, sessionId)`.
- Apply via `applyEffect(player.statusEffects, effect)`.
- Broadcast `STATUS_EFFECTS` to the caster (and nearby allies in party) with full effect info including remaining duration.
- For active skills: if `targetIds` is provided and non-empty, use it to limit which mobs are hit (still capped by `targetCount`). If omitted, use existing auto-target (nearest in range).

### 4. Tick status effects in `tickPlayerTimers` (MapRoom.ts)

Inside `tickPlayerTimers`, after existing timer ticks:

```ts
if (player.statusEffects.length > 0) {
  const result = tickEffects(player.statusEffects, dt, player.effectElapsedMap);
  player.statusEffects = result.active;
  if (result.hpDelta !== 0) {
    player.hp = Math.max(0, Math.min(player.maxHp, player.hp + result.hpDelta));
  }
  if (result.mpDelta !== 0) {
    player.mp = Math.max(0, Math.min(player.maxMp, player.mp + result.mpDelta));
  }
}
```

Import `tickEffects` from `@maple/shared`.

### 5. Fold `aggregateSecondary` into `buildAttackerStats` (MapRoom.ts)

In `buildAttackerStats`, after computing `secondary` from `deriveSecondary`:

```ts
const effectDelta = aggregateSecondary(player.statusEffects);
const merged = {
  ...secondary,
  atk: secondary.atk + (effectDelta.atk ?? 0),
  mAtk: secondary.mAtk + (effectDelta.mAtk ?? 0),
  wDef: secondary.wDef + (effectDelta.wDef ?? 0),
  mDef: secondary.mDef + (effectDelta.mDef ?? 0),
  accuracy: secondary.accuracy + (effectDelta.accuracy ?? 0),
  critRate: secondary.critRate + (effectDelta.critRate ?? 0),
  speed: secondary.speed + (effectDelta.speed ?? 0),
  avoid: secondary.avoid + (effectDelta.avoid ?? 0),
};
```

Use `merged` instead of `secondary` for the returned `AttackerCombatStats`. Import `aggregateSecondary` from `@maple/shared`.

### 6. Add tests (packages/server/test/skillCastActive.ts)

New test file covering the 4 required scenarios:

1. **MP-gated cast**: Learn a skill, set MP below cost, cast → rejected, MP unchanged.
2. **Cooldown rejection**: Learn a skill with cooldown, cast once → succeed, immediately cast again → rejected with "cooldown" message.
3. **Multi-target damage**: Learn an AoE skill (e.g. `warrior.battle_cry` with `targetCount: 3`), position 3+ mobs in range, cast → all mobs take damage.
4. **Buff apply then expire**: Learn `warrior.rally`, cast → buff applies (check `player.statusEffects` has the rally effect, `aggregateSecondary` reflects `atk` increase). Fast-forward time past duration → effect expires, `statusEffects` empty.

Uses the same boot/helper patterns as the existing `skillCast.ts`.

### 7. Update imports in MapRoom.ts

Add to the `@maple/shared` import block:
- `applyEffect`
- `skillBuffToStatusEffect`
- `tickEffects`
- `aggregateSecondary`
- `type StatusEffect`

### 8. Re-export `StatusEffect` in server types (server/src/types.ts)

Not strictly needed since it's imported directly from `@maple/shared` in MapRoom and Player schema. No change needed here.

## Files Modified

| File | Change |
|------|--------|
| `packages/shared/src/net.ts` | Add `targetIds?: string[]` to `SkillCastPayload` |
| `packages/server/src/rooms/schema/Player.ts` | Add `statusEffects` + `effectElapsedMap` (server-only) |
| `packages/server/src/rooms/MapRoom.ts` | Enhance buff handling, tick effects, fold aggregateSecondary, import new symbols |
| `packages/server/test/skillCastActive.ts` | New test file with 4 scenarios |

## Risks

- **Performance**: `tickEffects` runs every 16ms per player. The effects list is small (typically 0-3 active buffs) so this is negligible.
- **No multiplayer ally targeting**: "allies" buff propagation is scoped to caster only for now (no party range detection). The effects model supports it; the room logic can extend later.
- **Client prediction**: Client will need matching `applyEffect`/`tickEffects` calls but that's out of scope (server is authoritative).

## Steps

1. Add `targetIds?: string[]` to `SkillCastPayload` in `packages/shared/src/net.ts` (line ~984)
2. Add `statusEffects: StatusEffect[]` and `effectElapsedMap: Map<string, number>` to `Player` in `packages/server/src/rooms/schema/Player.ts` (server-only section)
3. Import `applyEffect`, `skillBuffToStatusEffect`, `tickEffects`, `aggregateSecondary`, `type StatusEffect` from `@maple/shared` in `packages/server/src/rooms/MapRoom.ts`
4. Replace the buff branch in `handleSkillCast` (~line 5000) with proper effects-model logic using `skillBuffToStatusEffect` + `applyEffect` + targeted `STATUS_EFFECTS` broadcast
5. Add `targetIds` support to the active-skill damage branch in `handleSkillCast` — if provided, filter targetable mobs by those IDs before capping at `targetCount`
6. Add status-effect ticking in `tickPlayerTimers` (~line 1231) — call `tickEffects`, apply HP/MP deltas
7. Fold `aggregateSecondary(player.statusEffects)` into `buildAttackerStats` return value (~line 1378)
8. Create `packages/server/test/skillCastActive.ts` with 4 tests: MP-gated cast, cooldown rejection, multi-target damage, buff apply-then-expire
9. Run `pnpm --filter @maple/shared typecheck && pnpm --filter @maple/server typecheck` to verify no type errors
10. Run `npx tsx packages/server/test/skillCastActive.ts` to verify all 4 tests pass
11. Run existing `npx tsx packages/server/test/skillCast.ts` to verify no regressions
