# Item Tooltips & Inventory Parity

## Summary
Add a hover tooltip to inventory items in the UIScene that renders full itemization data: item name colored by BaseRank, border colored by PotentialTier, level/stat requirements (greyed red if unmet), base item stats (ATK/WDef/MDef), potential line count + tier, and set-membership/set-bonus hints. Also fix the inventory row name coloring to use BaseRank instead of PotentialTier.

## Files to modify

### `packages/client/src/scenes/UI.ts` (only file changed)

## Changes

### 1. Add imports from `@maple/shared`
Add to the existing import block:
- `getBaseRankInfo` — for BaseRank name color
- `canEquip` — not used directly (we check each requirement individually for per-stat coloring)
- `SETS` — for set membership lookup
- `setMembership` — for resolving a defId's set
- `ClassArchetype` — already imported
- `type BaseRank` — for the type cast
- `type CharacterStats` — for canEquip context (if we use it)

Actually we'll check requirements manually per-stat for individual red coloring, so we just need `getBaseRankInfo`, `SETS`, and the `SetBonus` type.

### 2. Add tooltip geometry constants
```ts
const TOOLTIP_W = 260;
const TOOLTIP_PAD = 10;
const TOOLTIP_LINE_H = 18;
```

### 3. Add tooltip state fields to UIScene class
```ts
private tooltipContainer!: Phaser.GameObjects.Container;
private tooltipBg!: Phaser.GameObjects.Graphics;
private readonly tooltipTexts: Phaser.GameObjects.GameObject[] = [];
```

### 4. Build tooltip shell in `create()`
Add `this.buildTooltip()` call after other build calls.
```ts
private buildTooltip(): void {
  this.tooltipBg = this.add.graphics();
  this.tooltipContainer = this.add.container(0, 0, [this.tooltipBg]);
  this.tooltipContainer.setDepth(10000).setVisible(false);
}
```

### 5. Add tooltip methods

**`showItemTooltip(item: InventoryItemView, px: number, py: number): void`**
Builds tooltip content dynamically from:
- `getItemDef(item.defId)` → ItemDef for name, slot, stats, requirements, setId
- `getBaseRankInfo(item.baseRank as BaseRank)` → name color + label
- `getPotentialTierInfo(item.potentialTier as PotentialTier)` → border color + label + line count
- `this.localPlayer` → character stats for requirement checking
- `SETS` → set membership and bonus data

Content layout (top to bottom):
1. **Item name** (BaseRank color, 14px bold)
2. **Tier + line info** (PotentialTier color, 11px) — "Rare Potential · 1 line"
3. Separator
4. **Level req** (dim if met, #ef4444 if unmet)
5. **Stat reqs** — one line per reqStat (STR/DEX/INT/LUK), grey if met, red if unmet, showing "have X" value
6. **Class req** — if classReq exists, show and color by met/unmet
7. Separator
8. **Base stats** — ATK, primaryStat bonus, WDef, MDef, Speed, HP/MP bonuses from ItemDef
9. Separator (if set exists)
10. **Set membership** — "⚔ Set Name (equipped/total)" in green
11. **Set bonus hints** — each bonus tier, green if active, dim if not, showing stat bonuses

Position: 16px offset from pointer, clamped to screen edges.

**`moveTooltip(px: number, py: number): void`**
Reposition tooltip near pointer (clamped).

**`hideTooltip(): void`**
Set tooltipContainer visible false.

**`clearTooltip(): void`**
Destroy all tooltip text children, reset array.

### 6. Modify `addEquippedRow` and `addBaggedRow`

Current behavior: item name uses PotentialTier color (info.color).
New behavior:
- **Name**: color from `getBaseRankInfo(item.baseRank as BaseRank).color`
- **Border indicator**: keep the PotentialTier color swatch (it already serves as the "border color" indicator)
- **Add pointerover/pointermove/pointerout** events on hitZone to show/move/hide tooltip
- On pointerover: also brighten the meta text (existing behavior)
- On pointerout: also dim the meta text (existing behavior)

### 7. Update teardown
Add tooltip cleanup:
```ts
for (const el of this.tooltipTexts) el.destroy();
this.tooltipTexts.length = 0;
```

## Verification
1. `pnpm --filter @maple/client typecheck` — must pass with no errors
2. `pnpm --filter @maple/client build` — must build successfully
3. Visual check: hover over inventory items → tooltip appears with all sections
4. Name color matches BaseRank (white/grey for Normal, blue for Enhanced, purple for Starforged, red for Mythic)
5. Border/swatch color matches PotentialTier (blue Rare, purple Epic, gold Unique, green Legendary)
6. Unmet requirements show in red
7. Set items show set membership and bonus hints
