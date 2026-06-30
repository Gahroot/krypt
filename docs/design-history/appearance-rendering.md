# Plan: Render Player Cosmetic Appearance

## Goal
Each player visibly reflects its cosmetic identity (skin tone, hair style/color, face, outfit) for both local and remote players, using procedural placeholder art.

## Files to Modify

### 1. `packages/client/src/state-views.ts`
**Add appearance fields to `PlayerView`** (lines 17–45):
- Add: `gender`, `skinId`, `hairId`, `hairColorId`, `faceId`, `outfitId` (all `string`)
- These mirror the server's `@type("string")` fields on the Player schema

### 2. `packages/client/src/art/textures.ts`
**Add appearance-based player texture generation** (append after line 981):

- Import `SKIN_TONES`, `HAIR_COLORS` from `@maple/shared`
- Add `OUTFIT_BODY_COLORS` map (outfitId → hex int, matches CharacterCreate.ts)
- Add `darken(color, amount)` helper (same as CharacterCreate.ts)
- Add `PlayerColors` interface: `{ skin, hair, body, arm, belt, leg }` (all `number` hex ints)
- Add `resolvePlayerColors(appearance)`: looks up skin/hair hex, outfit body color, computes arm/belt/leg
- Add `appearanceKey(appearance)`: compact `p0`, `p1`, ... counter per unique combo
- Add `bakeDynamic(scene, key, w, h, draw)`: like `bake()` but takes explicit size (for dynamic texture keys)
- Add parameterized drawing helpers scaled for 28×40 sprites:
  - `drawPlayerHead(g, cx, cy, showEye, skin, hair, hairId, faceId)` — draws head circle + hair shape + eye, switching on hairId/faceId
  - `drawPlayerTorso(g, x, y, body, arm, belt)` — draws torso + belt + arm with outfit colors
  - `drawPlayerLeg(g, x, y, h, color)` / `drawPlayerArm(g, x, y, h, color)` — limb helpers with color
- Add `PLAYER_FRAMES` record: maps frame names (`idle_0`, `walk_0`, …, `attack_1`) to draw functions. Each draws the same body pose as the existing hardcoded warrior frames, but using parameterized colors
- Add `generatePlayerTextures(scene, ak, colors, hairId, faceId)`:
  - Bakes all 12 frames as textures keyed `{ak}_{frameName}`
  - Registers 6 animations keyed `{ak}_{state}` (idle, walk, jump, fall, climb, attack)
  - Idempotent: skips if textures/animation already exist
- Add `ensurePlayerTextures(scene, appearance)`:
  - Returns appearance key
  - Only generates once per unique combo (tracked by Set)
  - Called from Meadowfield when a player joins or changes appearance
- Export `appearanceKey`, `ensurePlayerTextures`, `resolvePlayerColors`, `PlayerColors`

**Keep all existing code unchanged** — the old hardcoded warrior textures remain as fallbacks.

### 3. `packages/client/src/scenes/Meadowfield.ts`

**Wire appearance into player rendering:**

- Import `appearanceKey`, `ensurePlayerTextures` from `../art/textures`
- Import appearance-related types from `@maple/shared` (for type annotation)
- Add `playerAppearanceKeys` Map<string, string> (sessionId → appearance key)
- **On player add** (line 406 `onAdd` callback):
  - Extract appearance fields from `player` (gender, skinId, hairId, hairColorId, faceId, outfitId)
  - Call `ensurePlayerTextures(this, appearance)` → get `ak`
  - Create sprite with first frame `{ak}_idle_0` instead of `TextureKeys.WarriorIdle0`
  - Store `ak` on sprite data and in `playerAppearanceKeys` map
- **On player change** (onChange callbacks):
  - Check if any appearance field changed vs stored data
  - If changed: call `ensurePlayerTextures` with new appearance, stop current anim, play new `{ak}_idle`
  - Update stored appearance key
- **Animation update** (update loop, lines 332–346):
  - Get appearance key from sprite data
  - `getDesiredAnim()` returns per-appearance animation keys: `{ak}_idle`, `{ak}_walk`, etc.
  - Modify `getDesiredAnim` to accept an `ak` prefix parameter
- **Remote player animation** (updateRemoteAnim, lines 972–991):
  - Same: use per-appearance animation keys from sprite data
- **Attack animation** (playSwing, line 1186):
  - Use `{ak}_attack` instead of hardcoded `"warrior_attack"`
- **Climb visual** (enterClimbVisual/exitClimbVisual):
  - No changes needed — tint/shadow still work on per-appearance sprites
- **Mob animations**: unchanged (they don't use player appearance)

## Key Design Decisions

1. **On-demand texture generation**: Only generate textures for appearance combos that actually appear in-game (typically < 20 players). Not all 4,800 combos.
2. **Compact appearance keys**: `p0`, `p1`, etc. — keeps texture/animation key names short.
3. **Per-player animations**: Each appearance combo gets its own animation set. More animations registered but each is independent and simple.
4. **Procedural art**: Hair shapes and face styles are drawn procedurally at 28×40 scale (much smaller than the CharacterCreate preview). Distinct but simple.
5. **Backward compatible**: Old hardcoded warrior textures remain. New system completely replaces them for all players.

## Risks
- **Texture memory**: Each combo generates 12 textures at 28×40 = ~1.3KB each. 20 players × 12 = ~312KB. Negligible.
- **Animation count**: 20 combos × 6 animations = 120 animations. Phaser handles this fine.
- **Type safety**: Dynamic texture keys won't fit `TextureKey` union. Solved via `bakeDynamic()` which takes explicit size.

## Steps
1. Add appearance fields to `PlayerView` in `state-views.ts`
2. Add appearance color resolution, procedural drawing, and texture generation system to `textures.ts`
3. Add `bakeDynamic` helper and `ensurePlayerTextures` entry point to `textures.ts`
4. Wire appearance data into Meadowfield player creation (onAdd callback)
5. Wire appearance data into Meadowfield animation system (getDesiredAnim, updateRemoteAnim, playSwing)
6. Handle appearance changes in onChange callbacks
7. Run `pnpm --filter @maple/client build` to verify type safety
