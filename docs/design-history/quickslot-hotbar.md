# Quickslot Hotbar — Implementation Plan

## Overview

Add a functional bottom quickslot hotbar to the Phaser HUD. Replace the existing cosmetic `drawQuickSlots` with an interactive system supporting skill casts, consumable use, cooldown sweeps, MP cost greying, stack counts, drag-drop assignment, and server-authoritative validation.

## Architecture

**Client-only hotbar state** — the quickslot layout is persisted in `localStorage` per character (keyed by `charId`). The server never receives the layout; it only receives `SKILL_CAST` and `USE_CONSUMABLE` messages when the player presses a hotkey.

**Server-authoritative execution** — the server validates skill/consumable use (MP cost, cooldown, learned status, inventory count) and applies effects. Cooldowns live on the server Player schema (server-only fields, not synced).

## Data Model

```ts
// QuickSlotEntry — persisted client-side
interface QuickSlotEntry {
  type: "skill" | "consumable";
  id: string; // skillId or consumable defId
}
```

## File Changes

### 1. `packages/shared/src/net.ts` — Add message types + payloads

Add two new message types to `MessageType`:
- `SKILL_CAST = 84` — client → server: cast a skill from a quickslot
- `USE_CONSUMABLE = 85` — client → server: use a consumable from a quickslot

Add payload types:
```ts
interface SkillCastPayload { skillId: string }
interface SkillCastResultPayload { success: boolean; skillId: string; cooldownMs: number; message: string }
interface UseConsumablePayload { defId: string }
interface UseConsumableResultPayload { success: boolean; defId: string; cooldownMs: number; message: string }
```

### 2. `packages/client/src/backend.ts` — Quickslot persistence

Add functions:
- `getQuickslots(charId: string): QuickSlotEntry[]` — read from localStorage
- `setQuickslots(charId: string, slots: QuickSlotEntry[]): void` — write to localStorage

### 3. `packages/server/src/rooms/schema/Player.ts` — Add cooldown fields

Add server-only (no `@type`):
- `skillCooldowns: Map<string, number>` — skillId → remaining ms
- `consumableCooldowns: Map<string, number>` — defId → remaining ms

### 4. `packages/server/src/rooms/MapRoom.ts` — Handle SKILL_CAST + USE_CONSUMABLE

**SKILL_CAST handler:**
1. Look up SkillDef from `allSkillsForClass(archetype)`
2. Check skill is learned (`player.skillBook[skillId] > 0`)
3. Check not on cooldown (`player.skillCooldowns.get(skillId) <= 0`)
4. Resolve MP cost via `skillStatAt(skill, level)`
5. Check player has enough MP (`player.mp >= mpCost`)
6. Deduct MP, set cooldown, broadcast `STATUS_EFFECTS` if buff
7. For active attack skills: compute damage using `buildAttackerStats` with skill's `damagePercent` and `hitCount` (enhancing the current 100%/1 hardcoded values)
8. Send `SkillCastResultPayload` back to client

**USE_CONSUMABLE handler:**
1. Look up `ConsumableDef` from `getConsumableDef(defId)`
2. Check player has the item in inventory with count > 0
3. Check not on cooldown
4. Apply effect (heal hp/mp, apply buff, recall)
5. Decrement item count (remove if 0)
6. Set cooldown
7. Send `UseConsumableResultPayload` back

**Cooldown ticking:** Add to the existing simulation interval loop to decrement `skillCooldowns` and `consumableCooldowns` values.

### 5. `packages/client/src/scenes/UI.ts` — Major UI overhaul

#### Constants
- `QS_COUNT = 10` (keys 1–0)
- `QS_SIZE = 36` (slightly larger for usability)
- `QS_GAP = 2`
- `QS_BINDINGS = ["1","2","3","4","5","6","7","8","9","0"]`

#### New fields
- `quickslots: (QuickSlotEntry | null)[]` — the 10 slot assignments
- `qsSlotGraphics: Phaser.GameObjects.Container[]` — per-slot containers
- `qsCooldownGraphics: Phaser.GameObjects.Graphics[]` — per-slot cooldown overlay
- `qsKeyLabels: Phaser.GameObjects.Text[]` — per-slot key binding label
- `qsItemLabels: Phaser.GameObjects.Text[]` — per-slot item/skill name
- `qsStackLabels: Phaser.GameObjects.Text[]` — consumable stack count
- `qsCooldownTimers: Map<string, number>` — client-side cooldown tracking for sweep animation
- `dragData: { type: "skill" | "consumable"; id: string } | null` — current drag state
- `dragGhost: Phaser.GameObjects.Container | null` — floating drag indicator

#### `buildQuickslots()`
- Create per-slot containers with: background square, key label (bottom), item name (center), stack count (bottom-right)
- Make each slot interactive (drop target, right-click to clear)

#### `drawQuickslots(x, y)` (replaces old `drawQuickSlots`)
- Reposition all slot containers
- Redraw each slot: background, key label, item icon/name, stack count, cooldown sweep arc

#### `renderQuickslot(slotIndex)`
- Clear and redraw a single slot's visuals
- If slot has a skill: show skill initial/name, grey out if MP < cost
- If slot has a consumable: show item name, stack count, grey if count = 0
- Draw cooldown sweep arc (pie slice from 12-o'clock clockwise)

#### Keyboard input setup
- Listen for keydown events on keys 1–0
- When pressed and not chat-focused: execute the slot's action
  - Skill: send `SKILL_CAST` message
  - Consumable: send `USE_CONSUMABLE` message

#### Drag-and-drop system
- **From skill tree**: Make skill name/row in `addSkillTreeEntry` have a pointerdown handler that sets `dragData = { type: "skill", id: skillId }` and creates a drag ghost
- **From inventory**: Make consumable bagged rows have a pointerdown handler that sets `dragData = { type: "consumable", id: defId }` and creates a drag ghost
- **Drag ghost**: Small floating label following the pointer
- **Drop on slot**: On pointerup, check if over a quickslot; if so, assign the dragged item
- **Right-click on slot**: Clear the slot assignment

#### Cooldown sweep rendering
- Use `Graphics.fillSlice` or `Graphics.beginPath/arc/fillPath` to draw a sweeping dark overlay
- Client-side cooldown tracking decrements per frame; when server sends result with cooldownMs, sync it

#### MP cost greying
- On `updateHud()` or when MP changes, re-render slots with skills
- If player.mp < skill.mpCost: draw a dark semi-transparent overlay on the slot

#### Consumable stack counts
- When inventory changes, re-render affected consumable slots
- Show count number in bottom-right corner of slot

#### Persistence
- On `bindLocal`: load quickslots from `getQuickslots(charId)`
- On any quickslot change: save via `setQuickslots(charId, quickslots)`
- Request skill book on connect (already done via `setupSkillLearnListener`)

### 6. Wiring — `setupCombatListeners` extension

Add listeners in `bindRoom` for:
- `MessageType.SKILL_CAST` result → update cooldown timers, re-render slots
- `MessageType.USE_CONSUMABLE` result → update cooldown timers, re-render slots

## Cooldown Sweep Animation

Each slot has a `cooldownEndAt: number` (scene-time when cooldown expires). During `update()`:
1. For each slot with active cooldown, calculate remaining ratio
2. Draw a dark semi-transparent pie slice (fillStyle 0x000000 at 0.6 alpha) sweeping from 12-o'clock clockwise proportionally to elapsed/total
3. When cooldown expires, clear the sweep and re-render to enable/disable state

## Verification Criteria

1. `pnpm --filter @maple/client build` passes (strict TS, no errors)
2. `pnpm --filter @maple/server` type-checks (message types consistent)
3. Quickslots render in the bottom bar with key labels 1–0
4. Drag from skill tree → slot assigns skill; drag from inventory → slot assigns consumable
5. Right-click slot clears it
6. Press number key → sends correct server message
7. Server validates MP, cooldown, skill learned status, item count
8. Cooldown sweep renders and drains over time
9. Skills grey out when MP < cost
10. Consumable slots show stack count
11. Layout persists across page reload (localStorage)

## Steps

1. Add `SKILL_CAST` and `USE_CONSUMABLE` message types + payloads to `packages/shared/src/net.ts`
2. Add `getQuickslots`/`setQuickslots` persistence functions to `packages/client/src/backend.ts`
3. Add `skillCooldowns` and `consumableCooldowns` server-only fields to `packages/server/src/rooms/schema/Player.ts`
4. Implement `handleSkillCast` and `handleUseConsumable` handlers + cooldown ticking in `packages/server/src/rooms/MapRoom.ts`
5. Replace cosmetic `drawQuickSlots` in UI.ts with functional hotbar: slot rendering, keyboard input, drag-drop, cooldown sweeps, MP greying, stack counts, persistence wiring
6. Run `pnpm --filter @maple/client build` and fix any TS errors
7. Run `pnpm typecheck` across all packages and verify clean
