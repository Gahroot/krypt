# Action Combat: Knockback, I-Frames, Combo System

## Overview
Add three action-combat feel systems to the existing authoritative server loop:
1. **Knockback** — horizontal push on mob hit, proportional to damage
2. **I-Frames** — 600ms invulnerability window after contact/boss damage
3. **Combo Counter** — consecutive hits within a window, synced to client

## Files to modify

| File | What changes |
|------|-------------|
| `packages/server/src/rooms/schema/Player.ts` | Add server-only fields (iframesUntil, comboCount synced, comboLastHitAt, knockbackVx) |
| `packages/server/src/rooms/schema/Mob.ts` | Add knockbackVx synced field, server-only knockbackTimer |
| `packages/server/src/rooms/MapRoom.ts` | All three systems: knockback on hit, i-frame gating in damagePlayer, combo tracking in tryAttack, knockback tick in fixedTick, combo reset in tickPlayerTimers |
| `packages/server/src/bossManager.ts` | Add i-frame check in executeBossAttack before dealing damage |
| `packages/client/src/state-views.ts` | Add comboCount, knockbackVx to PlayerView |
| `packages/client/src/scenes/UI.ts` | Add combo counter HUD element |

## Detailed changes

### 1. Player schema (`Player.ts`)
- Add `@type("uint16") comboCount = 0;` (synced to client)
- Add server-only (no `@type`):
  - `iframesUntil = 0;` — epoch ms when i-frames expire
  - `comboLastHitAt = 0;` — epoch ms of last successful hit
  - `knockbackVx = 0;` — horizontal knockback velocity (server physics, position is synced)

### 2. Mob schema (`Mob.ts`)
- Add `@type("number") knockbackVx = 0;` (synced so client can animate)
- Add server-only: `knockbackTimer = 0;`

### 3. MapRoom.ts — Constants
```
KNOCKBACK_DECAY = 0.85;       // per-tick multiplier for knockback velocity
KNOCKBACK_MAX = 12;           // cap px/tick
KNOCKBACK_MIN_DMG = 5;       // minimum damage to trigger knockback
IFRAME_MS = 600;              // invulnerability window after contact/boss damage
COMBO_WINDOW_MS = 1500;       // ms to keep combo alive between hits
```

### 4. MapRoom.ts — tryAttack (lines ~1442–1513)
After the `this.state.mobs.forEach` loop, check if any hits landed:
- If no hits → reset combo: `attacker.comboCount = 0`
- If hits landed → increment combo: `attacker.comboCount++`, `attacker.comboLastHitAt = Date.now()`
- On each hit, after `mob.hp -= result.total`:
  - Compute knockback: `const kb = Math.min(KNOCKBACK_MAX, Math.max(1, result.total * 0.15))`
  - Direction = attacker.facing
  - `mob.knockbackVx += kb * attacker.facing`
  - `mob.knockbackTimer = 300` (ms)

### 5. MapRoom.ts — damagePlayer (line ~1874)
At top, after `if (player.dead) return;`:
```ts
if (Date.now() < player.iframesUntil) return;
```
After dealing damage (before death check):
```ts
player.iframesUntil = Date.now() + IFRAME_MS;
```

### 6. MapRoom.ts — tickPlayerTimers (line ~1403)
Add combo expiry check:
```ts
if (player.comboCount > 0 && Date.now() - player.comboLastHitAt > COMBO_WINDOW_MS) {
  player.comboCount = 0;
}
```

### 7. MapRoom.ts — tickMob (line ~1989)
After `if (mob.hitTimer > 0)` block, add knockback tick:
```ts
if (mob.knockbackTimer > 0) {
  mob.knockbackTimer -= dt;
  mob.x += mob.knockbackVx;
  mob.x = clamp(mob.x, 0, this.map.width);
  mob.knockbackVx *= KNOCKBACK_DECAY;
  if (mob.knockbackTimer <= 0) mob.knockbackVx = 0;
}
```

### 8. bossManager.ts — executeBossAttack (line ~330)
Before dealing damage, add i-frame check:
```ts
if (target && !target.dead) {
  const now = Date.now();
  if (now < (target as any).iframesUntil) continue;
  target.hp = Math.max(0, target.hp - dmg);
  (target as any).iframesUntil = now + 600;
  ...
}
```
Note: bossManager operates on `Player` objects from `state.players`, so we can cast and access server-only fields directly.

### 9. state-views.ts — PlayerView
Add:
- `comboCount: number;`
- `knockbackVx: number;`

### 10. UI.ts — Combo Counter HUD
- Add private fields: `comboContainer`, `comboBg`, `comboText`
- In `create()`, build the combo display (positioned above bottom status bar, left of HP bar)
- In `updateHud()`, show/hide and update text based on `localPlayer.comboCount`
- When combo ≥ 2, show with scale pulse animation

## Verification
1. `pnpm --filter @maple/server test` — existing tests must pass
2. `pnpm typecheck` — strict TS must pass (no `any` violations in final code)
