# Tabbed Inventory Window (EQUIP/USE/ETC/CASH)

## Overview
Replace the client's flat inventory list with a MapleStory-style tabbed inventory window backed by the shared `Inventory` model. Uses **existing** server messages (`EQUIP_ITEM`, `UNEQUIP_ITEM`, `USE_CONSUMABLE`). No server changes needed.

## Architecture Decisions
- **Server stays flat**: The server's `MapSchema<InventoryItem>` doesn't change. Tabs are a client-side presentation concern built by classifying items via `tabForItem()`.
- **No new server messages**: The existing `EQUIP_ITEM` (16), `UNEQUIP_ITEM` (17), and `USE_CONSUMABLE` (85) handle all interactions. The server already has full handlers for these.
- **Drag-and-drop**: Client-side only reorder persisted to localStorage. The server flat map has no slot positions, so drag-to-reorder is purely visual. Just swap on drop.
- **Right-click/double-click = equip/use**: EQUIP tab → `EQUIP_ITEM { uid }`. USE tab → `USE_CONSUMABLE { defId }`. Other tabs → no-op.
- **Mesos displayed inside the inventory panel** at the bottom, below the grid.

---

## File Changes

### 1. `packages/client/src/scenes/UI.ts` — Full inventory panel rewrite (~350 lines net new)

This is the **only** file that changes. No server or shared modifications needed.

#### 1a. New imports (add to existing `@maple/shared` import block, lines 3–34)
- `tabForItem` — route items to tabs
- `TAB_CAPACITY` — 24 slots per tab
- `type InventoryTab` — "EQUIP" | "USE" | "ETC" | "CASH"
- `isConsumable` — move from dynamic `require()` (line 1506) to static import

#### 1b. New constants (replace lines 179–185)
```
INV_TAB_LABELS: InventoryTab[] = ["EQUIP", "USE", "ETC", "CASH"]
INV_TAB_H = 26           — tab button height
INV_GRID_COLS = 6        — columns in the slot grid
INV_GRID_ROWS = 4        — rows (6×4 = 24 = TAB_CAPACITY)
INV_CELL_W = 42          — slot cell width
INV_CELL_H = 36          — slot cell height  
INV_CELL_GAP = 2         — gap between cells
INV_GRID_PAD_X = 10      — horizontal grid padding
INV_GRID_PAD_TOP = 6     — gap between tab bar and grid
INV_MESOS_H = 24         — mesos row height
```
Remove obsolete: `INV_HEADER_H`, `INV_ROW_H`, `INV_MAX_ROWS`.

#### 1c. New member variables (add near lines 350–355)
- `private invActiveTab: InventoryTab = "EQUIP"`
- `private invTabBtns: Phaser.GameObjects.Container[] = []` — 4 tab button containers
- `private invTabCountLabel!: Phaser.GameObjects.Text` — "X / 24" in tab bar
- `private invGridContainer!: Phaser.GameObjects.Container` — holds the 24 cell containers
- `private invCells: Phaser.GameObjects.Container[] = []` — the 24 cell containers
- `private invCellBgs: Phaser.GameObjects.Graphics[] = []` — cell background graphics
- `private invCellNames: Phaser.GameObjects.Text[] = []` — cell name texts
- `private invCellQtys: Phaser.GameObjects.Text[] = []` — cell quantity texts
- `private invMesosLabel!: Phaser.GameObjects.Text` — mesos display inside panel
- `private invDragState: { fromIdx: number; fromTab: InventoryTab } | null = null`
- `private invDragGhost: Phaser.GameObjects.Container | null = null`
- `private invClientOrder: Record<string, string[]> = { EQUIP: [], USE: [], ETC: [], CASH: [] }` — uid ordering per tab

Remove: `invRows` array (replaced by cell arrays).

#### 1d. Replaced methods

**`buildInventoryPanel()`** (replace lines 2034–2054):
Create:
1. `invBg` — panel background Graphics
2. 4 tab button containers (rounded-rect bg + label text), each clickable via `switchInvTab()`
3. `invTabCountLabel` — item count in tab bar
4. `invGridContainer` — 24 cell containers, each containing:
   - `Graphics` for cell background (dark fill + tier-colored border)
   - `Text` for item name (10px, truncated, BaseRank color)
   - `Text` for stack quantity (9px, bottom-right, only shown when qty > 1)
5. `invMesosLabel` — mesos display with gold color
6. All packed into `invPanel` container at depth 1000

**`renderInventory()`** (replace lines 1279–1349):
1. Get `localPlayer` and bucket all non-equipped items into per-tab arrays using `tabForItem()`
2. Apply `invClientOrder[tab]` uid ordering (items not in order array appear at end)
3. For the active tab, fill up to 24 cells:
   - Cell has item → show rarity border, item name, stack qty if > 1
   - Cell is empty → show dim empty cell
4. Update tab button active states + count label + mesos label

**`drawInventoryBackground()`** (replace lines 4661–4672):
Compute total height from grid dimensions. Draw panel bg + tab bar separator.

#### 1e. New methods
- `switchInvTab(tab)` — set active tab, re-render, hide tooltip, cancel any drag
- `renderInvTabBtns()` — highlight active tab button
- `invBucketItems()` — return `Map<InventoryTab, InventoryItemView[]>` from flat server map
- `renderInvGridCell(idx, item)` — draw/update one cell
- `onInvCellPointerDown(idx, pointer)` — start drag-to-reorder (left button) or action (right button)
- `onInvCellDragMove(pointer)` — move drag ghost
- `onInvCellDragEnd(pointer)` — complete reorder swap, save to localStorage, re-render
- `loadInvClientOrder()` / `saveInvClientOrder()` — localStorage persistence
- `invSlotAction(item)` — send EQUIP_ITEM or USE_CONSUMABLE based on item's tab

#### 1f. Interaction per cell
| Input | Action | Server Message |
|-------|--------|---------------|
| Left-click + drag + drop on another cell | Reorder within tab | None (client-side, localStorage) |
| Right-click on EQUIP item | Equip the item | `EQUIP_ITEM { uid }` |
| Right-click on USE item | Use the consumable | `USE_CONSUMABLE { defId }` |
| Double-click EQUIP item | Equip the item | `EQUIP_ITEM { uid }` |
| Double-click USE item | Use the consumable | `USE_CONSUMABLE { defId }` |
| Hover any item | Show tooltip | None |
| Click tab button | Switch active tab | None |

#### 1g. Other updates in UI.ts
- `layout()` (~line 3745): Reposition inventory panel for new height
- `updateHud()` (~line 1267): Also update `invMesosLabel` when mesos change
- `setupInventoryToggle()` (~line 1546): Add ESC key close; cancel drag on close
- `teardown()` (~line 7355): Clean up new cell arrays + drag state
- Remove obsolete: `addInventoryStatRow()`, `addInventorySectionHeader()`, `addEquippedRow()`, `addBaggedRow()`, `addInventoryNote()`

---

## Verification Criteria
1. `pnpm --filter @maple/client build` passes (typecheck + vite build)
2. Panel renders 4 clickable tabs that switch content
3. Each tab shows correct items bucketed from the flat server inventory
4. Empty slots render as dim cells (up to 24 per tab)
5. Hover shows existing tooltip with stats/reqs/rarity colors
6. Right-click on EQUIP item sends EQUIP_ITEM, right-click on USE item sends USE_CONSUMABLE
7. Double-click works identically to right-click
8. Drag-to-reorder swaps two cells visually within the same tab
9. Reorder persists across panel close/open (localStorage)
10. Mesos balance displays at the bottom of the inventory panel
11. Stack quantity shown for items with qty > 1 (USE/ETC tabs)
12. Panel styling matches existing PALETTE/TEXT tokens
13. No TypeScript errors, no `any`, no unused vars

## Steps
1. Add `tabForItem`, `TAB_CAPACITY`, `type InventoryTab`, `isConsumable` to the `@maple/shared` import block in UI.ts
2. Replace inventory geometry constants with tabbed grid constants; remove `INV_HEADER_H`, `INV_ROW_H`, `INV_MAX_ROWS`
3. Add new member variables: `invActiveTab`, `invTabBtns`, `invTabCountLabel`, `invGridContainer`, cell arrays, `invMesosLabel`, drag state, `invClientOrder`
4. Remove old member variables: `invRows`
5. Rewrite `buildInventoryPanel()` to create tab bar + grid cells + mesos row
6. Rewrite `renderInventory()` to bucket items by tab and fill grid cells
7. Add `invBucketItems()` helper to classify flat server items into tabs
8. Add `switchInvTab()`, `renderInvTabBtns()` for tab switching
9. Add `renderInvGridCell()` for drawing one cell (rarity border, name, qty)
10. Add drag-to-reorder handlers with localStorage persistence
11. Add right-click/double-click handlers using existing EQUIP_ITEM and USE_CONSUMABLE messages
12. Rewrite `drawInventoryBackground()` for new tab+grid+mesos dimensions
13. Remove obsolete methods: `addInventoryStatRow`, `addInventorySectionHeader`, `addEquippedRow`, `addBaggedRow`, `addInventoryNote`
14. Update `layout()` to position panel correctly with new height
15. Update `updateHud()` to sync mesos label inside inventory panel
16. Update `setupInventoryToggle()` to add ESC close and cancel drag on close
17. Update `teardown()` to clean up new member variables
18. Run `pnpm --filter @maple/client build` to verify typecheck + build passes
