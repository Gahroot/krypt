# Plan: Add Job Branches to the Class System

## Summary

Add MapleStory-parity job branches — at 2nd job each archetype splits into sub-paths. Fully specced for WARRIOR (3 branches with skills), stubs for others.

## Design Decisions

- **`branchId?: string`** on `SkillDef` — marks which branch a skill belongs to; absent = shared tier skill
- **`branches?: readonly JobBranch[]`** on `JobTier` — optional; only populated from tier 2 onward
- Existing tier-level `skills` array = shared skills (available to all branches); `branches[].skills` = branch-specific
- `learnSkill()` gains optional `chosenBranch?: string` param; rejects if skill has a `branchId` that doesn't match
- All existing tests continue to pass — no breaking changes

## Files to Change

### 1. `packages/shared/src/classes.ts`

**New interface:**
```typescript
export interface JobBranch {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly skills: readonly SkillDef[];
}
```

**Modify `SkillDef`** — add:
```typescript
readonly branchId?: string;
```

**Modify `JobTier`** — add:
```typescript
readonly branches?: readonly JobBranch[];
```

**WARRIOR tier 2** — keep existing `cleave` + `bulwark` as shared skills; add 3 fully-specced branches:

| Branch | id | Skills |
|--------|----|--------|
| Blade Warden (sword) | `blade_warden` | `warrior.sword_aura` (passive), `warrior.blade_storm` (active) |
| Warpike (polearm) | `warpike` | `warrior.piercing_lance` (active), `warrior.whirlwind_sweep` (active) |
| Sentinel (shield) | `sentinel` | `warrior.aegis_taunt` (buff), `warrior.shield_bash` (active) |

**Other archetypes** — update `stubClass` to accept `tier2Branches`, add branch stubs (id + name + description, empty skills) for each:
- MAGE: `frost_scholar`, `flame_weaver`, `storm_caller`
- ARCHER: `sharpshooter`, `beast_tamer`, `windwalker`
- THIEF: `daggerspell`, `shadow_step`, `venomist`
- PIRATE: `gunner`, `brawler`, `demolitionist`

**New exported helper:**
```typescript
export function branchSkillsFor(
  archetype: ClassArchetype,
  branchId: string,
  charLevel: number,
): readonly SkillDef[]
```
Returns all skills in a given branch across all unlocked tiers that the character's level qualifies for.

### 2. `packages/shared/src/skillbook.ts`

- Update `allSkillsForClass` to also collect from `tier.branches[].skills`
- Update `learnSkill()` signature: add optional `chosenBranch?: string` parameter
- Add validation: if `skill.branchId` is set and `chosenBranch` doesn't match, reject with clear reason
- Update `skillsAvailableAt` to accept optional `chosenBranch` — filters out branch skills the character can't access

### 3. `packages/shared/tests/job-branches.test.ts` (new file)

Tests:
- `branchSkillsFor` returns correct skills for WARRIOR branches
- `branchSkillsFor` returns empty for non-existent branch
- `branchSkillsFor` respects level gating
- `branchSkillsFor` returns empty for archetypes with stub branches (no skills yet)
- `learnSkill` rejects branch skill when no branch chosen
- `learnSkill` rejects branch skill when wrong branch chosen
- `learnSkill` accepts branch skill when correct branch chosen
- `learnSkill` still works for shared tier skills regardless of branch
- All branch data has valid structure (non-empty id/name/description, maxLevel > 0)

## Steps

1. Add `JobBranch` interface and `branchId` field to `SkillDef` in `classes.ts`
2. Add `branches` field to `JobTier` in `classes.ts`
3. Wire 3 fully-specced WARRIOR branches with 2 skills each on tier 2
4. Update `stubClass` to accept optional `tier2Branches` parameter
5. Add branch stubs (id + name + description) to MAGE, ARCHER, THIEF, PIRATE tier 2
6. Add exported `branchSkillsFor()` helper function
7. Update `allSkillsForClass` in `skillbook.ts` to include branch skills
8. Add `chosenBranch` param + validation to `learnSkill` and `skillsAvailableAt` in `skillbook.ts`
9. Write `packages/shared/tests/job-branches.test.ts` with full coverage
10. Run `pnpm --filter @maple/shared test` to verify all tests pass
11. Run `pnpm typecheck` to verify strict TypeScript compliance
