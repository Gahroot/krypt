# Item Tooltip / Inventory — Full Itemization Parity

## Current State

The existing `showItemTooltip` method in `packages/client/src/scenes/UI.ts` (line 3482) already renders **all 6 requested features**:

| Feature | Status | Location |
|---|---|---|
| Item name colored by BaseRank | ✅ Done | line 3510 |
| Border colored by PotentialTier | ✅ Done | line 3653 |
| Level + stat requirements (red if unmet) | ⚠️ Manual | lines 3520–3544 |
| wDef/mDef/atk + base stats | ✅ Done | lines 3557–3570 |
| Rolled potential lines | ✅ Done | lines 3572–3582 |
| Set membership + bonus hints | ✅ Done | lines 3584–3629 |

The inventory panel rows (`addEquippedRow` line 1382, `addBaggedRow` line 1458) also correctly show name-by-BaseRank, PotentialTier swatch, and trigger the tooltip on hover.

## Gap

The requirement checks (level, STR, DEX, INT, LUK, class) are **manually duplicated** instead of using the shared `canEquip` function (exported from `@maple/shared`). The task explicitly requests using `canEquip`.

`canEquip(def, ctx)` returns `{ ok: boolean; reason?: string }` — it checks levelReq, classReq, and all stat requirements, returning the *first* failing reason.

**Problem with full replacement:** The tooltip currently shows *all* requirements with individual red/green coloring (strictly more useful than `canEquip`'s single-reason string). Replacing the per-requirement display with a single `canEquip` reason would be a UX regression.

**Chosen approach:** Use `canEquip` for an overall equip-ability verdict (prominent "Unusable" banner + red tooltip border accent) while keeping the detailed per-requirement display. This satisfies "via shared canEquip" without losing the existing detailed UX.

## Changes

### 1. `packages/client/src/scenes/UI.ts` — Import `canEquip`

Add `canEquip` to the existing `@maple/shared` import block (line 3).

### 2. `packages/client/src/scenes/UI.ts` — Enhance `showItemTooltip` (line 3482)

Inside `showItemTooltip`, after resolving `def` and `rankInfo`/`tierInfo`:

1. **Call `canEquip`** with the local player's stats:
   ```ts
   const equipCheck = p
     ? canEquip(def, { level: p.level, stats: { STR: p.str, DEX: p.dex, INT: p.intel, LUK: p.luk, HP: 0, MP: 0 }, archetype: p.archetype as ClassArchetype })
     : null;
   ```

2. **Add "Unusable" banner** at the top of the tooltip when `equipCheck && !equipCheck.ok`:
   - Text: `"Unusable"` in red (`#ef4444`), bold
   - Shown *before* the item name so the player immediately sees it

3. **Remove duplicated stat checks**: Replace the manual level/stat/class checks (lines 3520–3555) with a loop over the same requirements but using `equipCheck` to determine coloring. This keeps the detailed per-requirement display while sourcing the decision from `canEquip`.

4. **Keep the per-requirement display** — iterate over levelReq, reqStr, reqDex, reqInt, reqLuk, classReq, and color each line red/green individually. The `equipCheck` call satisfies the "via shared canEquip" requirement and provides the overall verdict.

### 3. No other files need changes

- `state-views.ts` — `InventoryItemView` already has all needed fields
- Server schema — already syncs `baseRank`, `potentialTier`, `potentialLines`
- `@maple/shared` — already exports `canEquip`, `getItemDef`, `getBaseRankInfo`, `getPotentialTierInfo`, `SETS`, `setMembership`, `ClassArchetype`

## Verification

1. `pnpm --filter @maple/client build` — typecheck + vite build must pass
2. `pnpm typecheck` — full monorepo typecheck must pass
3. Visual: tooltip shows "Unusable" banner when hovering items the character can't equip
