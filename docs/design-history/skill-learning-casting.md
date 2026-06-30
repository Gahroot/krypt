# Plan: Skill Learning + Casting System

## Context
The codebase already has per-class `SkillDef` entries in `shared/classes.ts` (every class has tier-1 active/passive/buff skills), `learnedSkills: string[]` on the Player schema (populated during job advancement), and `SP_PER_LEVEL = 3`. However, skill levels are **never tracked**, skills are **never used for combat**, and there's no way to spend SP or cast active skills. This plan adds the full loop: learn a skill (spend SP), cast it (spend MP), deal boosted damage.

**Key architecture note:** `MapRoom` is the active room for meadowfield (not `TownRoom`). All combat lives in `MapRoom.tryAttack()`/`playerDamage()`. We add skill support there.

---

## Step 1 — Shared: Extend SkillDef + add helpers + message types

**File: `packages/shared/src/classes.ts`**
- Add `mpCost: number` and `damageMultiplier: number` to the `SkillDef` interface.
- Populate these fields on every existing skill:
  - Active skills: `mpCost` ranges 5–20 (tier-1), `damageMultiplier` ranges 1.5–2.0.
  - Passive/buff: `mpCost: 0`, `damageMultiplier: 1.0`.
- Add a `findSkillDef(skillId: string): SkillDef | undefined` helper that iterates all classes' tiers to find a skill by id.

**File: `packages/shared/src/net.ts`**
- Add `LEARN_SKILL: 20` and `CAST_SKILL: 21` to `MessageType`.
- Add payload interfaces:
  ```ts
  export interface LearnSkillPayload { skillId: string; }
  export interface CastSkillPayload { skillId: string; }
  ```

**File: `packages/shared/src/index.ts`** — already re-exports net + classes, no change needed.

---

## Step 2 — Server: Skill levels on Player schema + CharacterRecord

**File: `packages/server/src/rooms/schema/Player.ts`**
- Add synced field: `@type({ map: "uint8" }) skillLevels = new MapSchema<number>();`
  - `uint8` caps skill level at 255 (max is 20, so plenty).
  - This is synced so the client can read skill levels for the skill UI.
- Remove the old `learnedSkills: string[]` server-only field (replaced by `skillLevels` map; presence of a key = learned).

**File: `packages/server/src/persistence/store.ts`**
- Add `skillLevels?: Record<string, number>` to `CharacterRecord`.
- Keep backward compat: if `skillLevels` is absent, it's treated as empty `{}`.

**File: `packages/server/src/types.ts`**
- Re-export `LearnSkillPayload` and `CastSkillPayload` from `@maple/shared`.

---

## Step 3 — Server: LEARN_SKILL handler in MapRoom

**File: `packages/server/src/rooms/MapRoom.ts`**
- Register `[MessageType.LEARN_SKILL]` in `messages`.
- Handler logic:
  1. Look up the player; reject if dead.
  2. Validate `skillId` exists via `findSkillDef()`.
  3. Validate skill belongs to the player's class (skill id prefix matches class archetype or we check all tiers of the class).
  4. Validate `player.level >= skillDef.levelReq`.
  5. Validate `player.sp >= 1` (must have unspent SP).
  6. Validate current level `< skillDef.maxLevel`.
  7. Decrement `player.sp` by 1.
  8. Increment skill level in `player.skillLevels`: `player.skillLevels.set(skillId, (player.skillLevels.get(skillId) ?? 0) + 1)`.
  9. Persist via `this.persistPlayer(player)`.
  10. Send back a result message (`"learn_skill_result"` with `{ success, skillId, level, sp }`).

---

## Step 4 — Server: CAST_SKILL handler in MapRoom

**File: `packages/server/src/rooms/MapRoom.ts`**
- Register `[MessageType.CAST_SKILL]` in `messages`.
- Handler logic:
  1. Look up the player; reject if dead.
  2. Validate `skillId` exists via `findSkillDef()`.
  3. Validate skill is `"active"` kind.
  4. Validate `player.skillLevels.get(skillId) >= 1` (must be learned).
  5. Get skill level from `player.skillLevels.get(skillId)`.
  6. Compute MP cost: `skillDef.mpCost` (flat; scales with level: `mpCost + (level - 1)` for future-proofing).
  7. Validate `player.mp >= mpCost`; reject with error if not.
  8. Deduct `player.mp -= mpCost`.
  9. Set `player.attackType` based on skill (or keep the weapon-resolved type).
  10. Compute damage: `this.playerDamage(attacker) * skillDef.damageMultiplier`.
  11. Apply damage to mobs using the same hit-check pipeline as `tryAttack` (reuse `inMeleeArc`/`inRangedArc`/`inRange` — or for simplicity, hit the nearest mob within melee range initially; multi-target for AoE skills later).
  12. Set `player.attacking = true`, `attackTimer`, `attackCooldown` (same visual timing).
  13. Send back `"cast_skill_result"` with `{ success, skillId, mp, mpCost }`.

---

## Step 5 — Server: Update join persistence + restore

**File: `packages/server/src/rooms/MapRoom.ts` (onJoin)**
- When restoring a player from `CharacterRecord`, populate `player.skillLevels` from `character.skillLevels ?? {}`.
- Also handle the legacy `learnedSkills` array: for any skill id in `learnedSkills` that's not in `skillLevels`, add it with level 1.

**File: `packages/server/src/rooms/MapRoom.ts` (persistPlayer)**
- Write `player.skillLevels` to the character record as a plain object.

---

## Step 6 — Client: Add skillLevels to PlayerView

**File: `packages/client/src/state-views.ts`**
- Add `skillLevels: MapSchema<number>` to `PlayerView`.

---

## Step 7 — Client: Skill panel UI (toggle with K)

**File: `packages/client/src/scenes/UI.ts`**
- Add a skill panel container (similar to inventory panel pattern).
- Toggle with `K` key (add to hint text).
- Panel shows:
  - Header: "Skills · SP: X"
  - For each skill in the character's class (looked up from `CLASSES` using the player's `archetype`):
    - Skill name, level/maxLevel, kind icon
    - If `kind === "active"`: show MP cost
    - `[-]` / `[+]` buttons to spend/return SP (sends `LEARN_SKILL` message)
    - Dim/locked styling if levelReq not met or SP = 0
- Reactive: re-render when `skillLevels` or `sp` changes via schema callbacks.
- Add to the hint line: "K skills"

---

## Step 8 — Client: Hotbar skill cast + distinct visual

**File: `packages/client/src/scenes/MapScene.ts`**
- Read `localPlayer.skillLevels` and find the first learned active skill.
- Bind number key `1` (or the next available quick-slot) to send `MessageType.CAST_SKILL` with that skill id.
- On cast, play a **distinct visual** — bigger slash, different color (e.g. gold/orange for the skill vs. white for basic attack), and show a brief MP-cost floating text.

**File: `packages/client/src/scenes/MapScene.ts` (playSwing variant)**
- Add `playSkillSwing(skillId: string)` method with a larger, more colorful slash animation.
- The existing `playSwing()` stays for basic attacks.

---

## Step 9 — Server: Test file

**File: `packages/server/test/skills.ts`**
- Boot meadowfield room, create a level-10 Beginner character.
- Join room, verify `skillLevels` is empty.
- Send `LEARN_SKILL` for `beginner.nimble_strike` → verify skill level = 1, SP decremented.
- Try to cast without MP → rejected.
- Set `player.mp` low (e.g. 1) → send `CAST_SKILL` → verify rejection.
- Set `player.mp` high → send `CAST_SKILL` → verify MP decreased by mpCost, mob took more damage than a basic swing (verify by checking mob HP delta).
- Try `LEARN_SKILL` for a skill that doesn't belong to the class → rejected.
- Try `LEARN_SKILL` for a skill with levelReq above player level → rejected.
- Verify results are persisted to CharacterRecord.

**File: `packages/server/package.json`**
- Add `tsx test/skills.ts` to the test script chain.

---

## Risks
- **Schema backward compat:** Adding `skillLevels` to the Colyseus Player schema may break existing client connections mid-session. Since this is pre-production, a full reconnect is acceptable.
- **No auto-learn on advancement yet:** The current MapRoom advancement code pushes skill ids to `learnedSkills[]`. We need to update that to populate `skillLevels` with level 0 (or level 1) instead.
- **TownRoom** is dead code (not wired in `app.config.ts`), but it also has `tryAttack`. We'll add skill support there too for consistency, or skip it since it's unused.

## Verification
1. `pnpm --filter @maple/shared typecheck` — SkillDef changes + helpers compile
2. `pnpm --filter @maple/server test` — existing tests pass + new skills test passes
3. `pnpm --filter @maple/client build` — UI changes + state-views compile + vite build succeeds
4. `pnpm -r typecheck` — full monorepo clean
