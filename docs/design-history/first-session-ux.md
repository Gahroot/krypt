# Plan: First-Session UX & Transition Polish

## Overview
Three features: (1) onboarding coach-marks for first-time controls, (2) loading screen + fade/map-name transitions, (3) skippable intro for new characters on Dawn Isle.

---

## Feature 1: Onboarding Coach-Marks

### Persistence
- New helper functions in `packages/client/src/backend.ts`:
  - `getSeenCoachMarks(charId: string): Set<string>` — reads `cryptomaple.coachmarks.{charId}` from localStorage
  - `markCoachMarkSeen(charId: string, id: string)` — adds to set, writes back
- Coach-mark IDs: `"move"`, `"attack"`, `"jump"`, `"inventory"`, `"talk"`

### New Scene: `packages/client/src/scenes/CoachMarks.ts`
- Scene key: `"coachmarks"` — launched in parallel with MapScene (like UI)
- Renders screen-fixed overlays (no scroll factor) at depth 11000 (above UI's panels)
- Each coach-mark is a small pill-shaped tooltip with icon + key hint + short instruction text
- Dismissed on any keypress or click → calls `markCoachMarkSeen`, fades out, destroys element
- Triggers from MapScene via registry keys set when first conditions are detected:
  - `"coachmark:move"` — set when MapScene detects first left/right input from a fresh character
  - `"coachmark:attack"` — set on first spacebar/left-click attack
  - `"coachmark:jump"` — set on first jump input
  - `"coachmark:inventory"` — set when player first opens inventory (from UI.ts)
  - `"coachmark:talk"` — set when player first interacts with an NPC

### MapScene changes (`packages/client/src/scenes/MapScene.ts`)
- In `create()`: launch `"coachmarks"` scene alongside `"ui"`
- After local player joins (in bindState `onAdd` for local player), set `"coachmarks:charId"` in registry
- In `update()`, on first movement input detection → set `coachmark:move` registry flag
- On first attack → set `coachmark:attack`
- On first jump → set `coachmark:jump`
- These flags are one-shot: MapScene sets them, CoachMarks reads and clears them

### UI.ts changes
- When inventory panel opens for the first time → set `coachmark:inventory` registry flag

### CoachMarks scene logic
- Polls registry for each flag; when found, checks `getSeenCoachMarks` — if not seen, shows the coach-mark
- Renders positioned relative to screen (movement hint near bottom-center, inventory near inventory panel area, etc.)
- Auto-dismiss after 5s or on any input

---

## Feature 2: Loading Screen & Map Transition

### New Scene: `packages/client/src/scenes/Loading.ts`
- Scene key: `"loading"`
- Shows: dark background, spinning indicator, map name text ("Welcome to <MapName>")
- Launched before MapScene transition, killed once map is ready
- Uses `getMap(mapId)` from `@maple/shared` for the display name (already imported in MapScene)

### MapScene transition changes
- Replace current `showTransition()` + hard cut with:
  1. Camera fade-out (400ms)
  2. Leave room
  3. Start `"loading"` scene with `{ mapId, mapName }`
  4. `this.time.delayedCall()` → start `"map"` scene
  5. New MapScene `create()` fades in camera (fade from black, 400ms)
  6. MapScene kills `"loading"` scene once connected

### MapScene `create()` enhancement
- Accept optional `_fromTransition: boolean` in data (or detect it from the scene restart pattern)
- On re-entry: `this.cameras.main.fadeIn(400, 0, 0, 0)` for smooth appearance
- Show "Welcome to {mapName}" banner that fades in/out over 2.5s after camera fade-in completes

---

## Feature 3: Skippable Intro for New Characters

### Persistence
- New helper in `backend.ts`:
  - `hasSeenIntro(charId: string): boolean` — reads `cryptomaple.intro.{charId}`
  - `markIntroSeen(charId: string)` — writes flag

### New Scene: `packages/client/src/scenes/Intro.ts`
- Scene key: `"intro"`
- Short 4-5 second cinematic text sequence:
  - "You awaken on a mysterious shore..." (fade in, 1.5s)
  - "Dawn Isle — where every adventure begins." (crossfade, 1.5s)  
  - "Use ← → to move. Talk to Guide Iris to start your journey." (crossfade, 1.5s)
- Skippable on any keypress or click (cancels tweens, goes straight to end)
- On complete: marks intro as seen, starts `"map"` with `{ mapId: "dawn_isle" }`

### CharacterCreate.ts change
- After successful character creation, instead of `this.scene.start("map", { mapId: "dawn_isle" })`:
  - `this.scene.start("intro")`
  - The Intro scene handles the intro → map transition

### MapScene change
- Only show "Welcome to <Map>" banner if NOT a first-time Dawn Isle character (skip intro already handled it)

---

## File Changes Summary

| File | Action | What |
|------|--------|------|
| `packages/client/src/backend.ts` | Edit | Add coach-mark, intro persistence helpers |
| `packages/client/src/scenes/CoachMarks.ts` | **New** | Onboarding coach-mark overlay scene |
| `packages/client/src/scenes/Loading.ts` | **New** | Loading screen with map-name banner |
| `packages/client/src/scenes/Intro.ts` | **New** | Skippable intro cinematic for new chars |
| `packages/client/src/main.ts` | Edit | Register 3 new scenes in config |
| `packages/client/src/scenes/MapScene.ts` | Edit | Launch coach-marks, improve transitions, fade-in on enter, welcome banner, first-action detection |
| `packages/client/src/scenes/UI.ts` | Edit | Set coachmark:inventory flag on first open |
| `packages/client/src/scenes/CharacterCreate.ts` | Edit | Route new chars through Intro scene |

---

## Verification Criteria
1. `pnpm --filter @maple/client build` passes (tsc --noEmit + vite build)
2. Coach-marks appear only once per character, are dismissible, persist across reloads
3. Map transitions show loading screen with correct map name from `world.ts`
4. New characters see intro; returning to Dawn Isle shows "Welcome" banner instead
5. All fade transitions are smooth (no hard cuts)

---

## Steps
1. Add persistence helpers to `backend.ts` (coach-mark seen flags, intro seen flag)
2. Create `CoachMarks.ts` scene with overlay rendering, registry polling, dismiss-on-input
3. Create `Loading.ts` scene with map-name display and spinner
4. Create `Intro.ts` scene with skippable text cinematic
5. Register all 3 scenes in `main.ts`
6. Modify `MapScene.ts`: launch coach-marks, detect first actions, improve transition flow with loading scene, add fade-in and welcome banner
7. Modify `UI.ts`: set coachmark:inventory flag on first inventory open
8. Modify `CharacterCreate.ts`: route new characters through Intro scene
9. Run `pnpm --filter @maple/client build` to verify TypeScript compilation
10. Run `pnpm typecheck` and `pnpm lint` for full validation
