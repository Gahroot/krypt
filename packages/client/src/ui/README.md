# CryptoMaple React UI Overlay

This directory is the **React overlay** that renders DOM-based HUD panels on top
of the Phaser canvas. It is the home of the CryptoMaple UI overhaul: every new
panel (market, shop, settings, party, …) lives here and is built from one shared
component kit. **No panel reinvents widgets.**

> **Layouts are fair game.** MapleStory's window layouts, keybinds, and UI
> structure aren't copyrightable — only Nexon's art, names, and lore are. Clone
> proven layouts and open-source components freely; never copy Nexon assets.

---

## Overlay / bridge architecture

```
 Phaser (game truth)                React (overlay)
 ┌────────────────────┐             ┌──────────────────────┐
 │ UIScene (UI.ts)     │  snapshots │ OverlayRoot           │
 │  publishInventory() │ ─────────▶ │  └ panels read store  │
 │  registerUIActions()│            │     via useUIStore()  │
 │                     │ ◀───────── │  panels call actions  │
 │  room.send(...)     │   actions  │     (room.send)       │
 └────────────────────┘             └──────────────────────┘
            zustand vanilla store  =  packages/client/src/ui/store/
```

- **Host:** `index.html` has `<div id="react-overlay">`. `mount.tsx`
  (`mountOverlay()`, called once from `main.ts`) mounts `OverlayRoot` into it.
- **Click-through:** the host element is click-through (`pointer-events: none`
  in `index.html`); each panel re-enables pointer events on itself via
  `pointer-events-auto` (the `Panel` shell does this for you). This is what lets
  canvas clicks (move / attack / talk-to-NPC) fall through empty HUD space while
  clicks on a panel are consumed by the panel.

## Keyboard input routing (one policy)

The DOM overlay and the Phaser canvas both see browser key events, so every
input needs exactly one owner. The single policy lives in `inputFocus.ts`:

- **While any text field is focused, Phaser ignores the keyboard.** A document-
  level focus watcher (`installInputFocusTracking()`, started in `main.ts`)
  decides "is the player typing?" for *every* `<input>` / `<textarea>` /
  content-editable at once — no per-widget `onFocus`/`onBlur` wiring. `UIScene`
  subscribes (`applyTextInputFocus`) and on each transition sets the
  `chatFocused` registry flag (read by `MapScene`'s `suppressed` movement gate),
  toggles its keyboard plugin (`enabled = false` hard-stops scene hotkeys +
  `isDown` polling), and releases global capture so the field gets the keys.
- **Toggle hotkeys are Phaser-owned.** Panel open/close keys (I, K, S, E, Q, J,
  W, U, C, V, B, …) live only in `UIScene`, which drives the bridge-store open
  flags. React panels are pure renderers + `close` actions — they never bind
  their own global toggle handlers, so a toggle key cannot double-fire.
- **A few keys are React-owned while a panel is open** (e.g. the Settings
  keybind-capture row), and those panels swallow the event in the capture phase
  (`stopImmediatePropagation`) so it never reaches Phaser.
- **Escape:** in a focused field, Esc blurs it (restoring movement); for panels,
  Esc closes via the owner's handler (Phaser `keydown-ESC` or Radix `Dialog`).
  Either way closing the field/panel re-runs the policy and restores input.
- **Bridge:** the only seam between Phaser and React is the **zustand vanilla
  store** in `store/`. `UIScene` imports the store directly (no React in the
  Phaser bundle) and:
  - pushes plain, serializable **snapshots** in (e.g. `publishInventory()` →
    `uiStore.getState().setInventory(...)`), and
  - registers imperative **actions** (`registerUIActions()` →
    `setActions({ equip, use, reorder, close })`) that call `room.send(...)`.

## The snapshot-in / actions-out rule

This is the load-bearing rule. Do not break it.

- **Snapshots flow IN.** Phaser pushes **plain, serializable** objects only —
  never a live Colyseus schema object, never a Phaser `GameObject`. React reads
  these via `useUIStore(selector)` and re-renders reactively.
- **Actions flow OUT.** React never touches Phaser, Colyseus, or the room. To
  change game state it calls `actions.*`, which the scene wired to
  authoritative `room.send(...)` messages. The **server is authoritative**.
- React is a pure renderer of snapshots. If a panel needs new data, add a field
  to that feature's snapshot in its slice and populate it from `UIScene`.

## Visual identity (theme, typography, anchoring)

The overlay has a cohesive, game-appropriate look built **entirely on Tailwind v4
theme tokens + shadcn conventions** — no bespoke CSS framework. All tokens live in
`styles.css`; consume them through utilities (`bg-card`, `border-rarity-epic`,
`font-display`, `shadow-panel`, …), never hard-coded hexes.

### Typography

Two self-hosted, **open-licensed** faces, bundled via Fontsource (woff2 shipped in
the build — no runtime network fetch). Scoped to `#react-overlay`; the old global
`* { font-family: monospace }` rule is **gone**.

| Token | Family | Use | License |
| --- | --- | --- | --- |
| `font-display` | **Fredoka** (Variable) | Panel titles / headings — the game's voice | SIL OFL 1.1 |
| `font-sans` (default) | **Inter** (Variable) | UI body text, labels, tabs | SIL OFL 1.1 |
| `font-mono` | system mono stack | **Numbers & code only** (counts, mesos, hashes, keybind hints) | system |

Licenses ship at `node_modules/@fontsource-variable/{fredoka,inter}/LICENSE`.
Reserve `font-mono` for tabular figures and code; never use it for prose.

### Rarity colors are sourced from `@maple/shared`

Rarity is the **single source of truth** rule applied to color. The authoritative
hexes live in `@maple/shared` (`rarity.ts` → `POTENTIAL_TIERS` border colors,
`BASE_RANKS` name colors). `styles.css` seeds `--rarity-*` / `--rank-*` with
build-time fallbacks so the utilities exist before JS, and `theme.ts`
(`applyRarityTheme()`, called from `mount.tsx`) **overwrites them at runtime from
shared** so the UI can never drift from in-game item colors.

- Generated utilities: `border-rarity-{rare,epic,unique,legendary}`,
  `text-rank-{normal,enhanced,starforged,mythic}`.
- `ItemCell` passes the shared hex inline (`borderColor` / `labelColor`) — the
  most direct binding to `getPotentialTierInfo()` / `getBaseRankInfo()`.
- If you add a rarity/rank in `@maple/shared`, add a matching `--rarity-*` /
  `--rank-*` fallback in `styles.css`; the runtime sync handles the rest.

### Responsive anchoring (resize-safe panels)

Panels must stay usable from ~1280px up to large displays and survive
`Phaser.Scale.RESIZE`. **Anchor to viewport edges/centers with the clamp()-based
HUD tokens — never magic pixel offsets.** `Panel` is the workhorse: it is a flex
column capped at `--panel-max-h` (85vh) whose body scrolls internally, sized via
`--panel-w`. You only supply the anchor.

| Token | Value | Purpose |
| --- | --- | --- |
| `--hud-edge` | `clamp(0.75rem, 1.5vw, 1.5rem)` | gutter from a viewport edge |
| `--hud-top` | `clamp(3rem, 6vh, 4.5rem)` | offset below the top HUD bar |
| `--panel-w` | `20rem` | default floating-window width |
| `--panel-max-h` | `85vh` | cap; body scrolls past this |

Conventions (see `InventoryPanel.tsx`, the reference):

- **Corner HUD panel:** `className="fixed top-[var(--hud-top)] right-[var(--hud-edge)]"`.
- **Centered modal:** `className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"`.
  (The open transition is opacity-only so it never fights the centering translate.)
- **Wider panel:** override the width with `w-[…]` (or `clamp()`) +
  `max-w-[92vw]`; tailwind-merge lets `className` win over `--panel-w`.
- **Tall content:** do nothing — `Panel`'s body already scrolls past 85vh. For a
  fixed inner scroll region use the shadcn `ScrollArea`.

### Polish primitives

Tasteful, reusable, not heavy:

- **Open transition:** every `Panel` fades in via `motion-safe:animate-panel-in`
  (`--animate-panel-in`, 160ms). Respects `prefers-reduced-motion`.
- **Focus ring:** the `focus-ring` utility (`@utility` in `styles.css`) gives
  bespoke interactive elements (e.g. `ItemCell`) a consistent
  background-haloed keyboard ring. shadcn `Button`s already ship their own
  `focus-visible` ring — don't double it.
- **Panel shadow:** `shadow-panel` lifts floating windows off the busy canvas.

## The reuse mandate

Use the **pre-made libraries** for every widget: **shadcn/ui + Radix +
Tailwind v4 + lucide-react** (all installed). **Never hand-roll a widget and
never make a one-off bespoke button.** If something is missing, add it to the
shared kit so the next panel reuses it. Match the existing shadcn style
(Radix primitive + `class-variance-authority` + `cn()` + `data-slot`).

---

## Migration status: React vs. remaining canvas

The React overlay is the **single UI surface**. Every interactive panel — login,
inventory, character create/select, HUD (status bars, skill bar, minimap, quest
tracker, chat), market, cash shop, general store, trade, storage, settings,
party, guild, friends, skill tree, stats, equipment, quests, dialogs — is a DOM
panel built from the shared kit. `UIScene` and the feature scenes (Market,
Storage, CashShop, …) are **thin controllers**: they publish snapshots into the
bridge store and wire `room.send` actions — they draw nothing.

A handful of in-game overlays are still rendered on the Phaser canvas inside
`UIScene` (not yet migrated to React). These are **live features**, not orphaned
code from the completed migrations:

| Feature | Toggle | Status |
| --- | --- | --- |
| Mesos counter (top-right pill) | always-on | Canvas — data already in `inventory.mesos` |
| Control hint line (top-left) | always-on | Canvas — static text |
| Mute toggle (top-right) | click | Canvas — state in settings slice |
| Combo counter (combat FX) | transient | Canvas (FX overlay) |
| Level-up flash | transient | Canvas (FX overlay) |
| Party HUD (compact member bars) | in-party | Canvas — data already in party slice |
| Cube (potential reroll) panel | C | Canvas |
| Upgrade (base-rank forge) panel | U | Canvas |
| Maple Guide panel | J | Canvas |
| Familiar panel | — | Canvas |
| Codex (monster book) panel | — | Canvas |
| World-map travel overlay | W | Canvas |
| Blocked-list panel | — | Canvas |
| Player right-click context menu | — | Canvas |
| Announcement banner | transient | Canvas |
| Feedback / bug-report panel | — | Canvas |

All **game-world** rendering (map tiles, sprites, mobs, particles, parallax) lives
in `MapScene` and is correctly canvas-only.

---

## Adding a new panel (copy the inventory reference)

`InventoryPanel.tsx` is the **reference panel**. To add, say, a shop panel:

1. **Add a slice.** Copy `store/inventory.ts` → `store/shop.ts`. Define the
   `ShopSnapshot` (plain/serializable), a `shopOpen` flag, and
   `createShopSlice`. Wire it into `store/index.ts` (spread it into the store
   and re-export its types). Add any new action signatures to `UIActions`.
2. **Publish from Phaser.** In `UI.ts`, add a `publishShop()` that calls
   `setShop(...)` with a plain snapshot, and register the shop's actions inside
   `registerUIActions()`.
3. **Build the panel.** Copy `InventoryPanel.tsx` → `ShopPanel.tsx`. Follow the
   same shape: read snapshot + actions via `useUIStore`, `if (!open) return
   null`, render with the shared kit only, drive the game through `actions.*`.
4. **Mount it.** Add `<ShopPanel />` to `OverlayRoot.tsx`.

The reference panel's shape (keep it):

```tsx
export function ShopPanel() {
  const open = useUIStore((s) => s.shopOpen);
  const shop = useUIStore((s) => s.shop);
  const actions = useUIStore((s) => s.actions);
  if (!open) return null;
  return (
    <Panel title="Shop" hotkey="…" onClose={() => actions?.close()}>
      {/* shared kit only */}
    </Panel>
  );
}
```

---

## Index of the shared kit

### Game UI primitives — `src/ui/components/`

Higher-order, game-aware, generic/props-driven. Reused everywhere.

| Component | Purpose |
| --- | --- |
| `Panel` | Standard floating-window shell: title bar, `[hotkey]` hint, close button, `pointer-events-auto`. Extracted from the inventory chrome. |
| `DraggableWindow` | `Panel` + pointer drag (mouse/touch) by the title bar. |
| `ItemGrid` | Fixed-slot grid layout; pads items to `slots` across `cols` columns. |
| `ItemCell` | A single rarity-bordered slot (label, border/label colors, count badge, optional tooltip, drag handlers). Empty when no `label`. |
| `CurrencyDisplay` | Coin icon + formatted amount + label (mesos by default). |
| `StatRow` | Label-left / value-right row for stat panels, tooltips, lists. |
| `ConfirmDialog` | Controlled yes/no confirmation on `AlertDialog` for destructive actions. |
| `EmptyState` | Centered icon + title + description for empty panels. |

### shadcn/ui primitives — `src/ui/components/ui/`

Radix + CVA + `cn()`, in shadcn style. The full set game panels need:

`button`, `badge`, `tabs`, `tooltip`, `scroll-area`, `separator`, `dialog`,
`alert-dialog`, `select`, `slider`, `switch`, `input`, `label`, `popover`,
`dropdown-menu`, `table`, `card`, `progress`, `avatar`, `sonner` (toasts).

### Store — `src/ui/store/`

- `index.ts` — root store (`uiStore`), `useUIStore` hook, the cross-cutting
  `UIActions` / actions registry, and `UIState` (composed from slices).
- `inventory.ts` — the **reference feature slice** (snapshot types + flag +
  `createInventorySlice`). Copy this for new features.
- `party.ts` / `guild.ts` / `friends.ts` — the social slices (members/roster/buddy
  snapshots + per-feature action registries). Rendered by `PartyPanel.tsx`,
  `GuildPanel.tsx`, `FriendsPanel.tsx`; published from `UIScene.publishParty/
  publishGuild/publishFriends` and driven via `registerSocialActions`.

### Other

- `mount.tsx` — mounts the overlay; dev-only exposes `window.__uiStore` for
  headless UI verification.
- `OverlayRoot.tsx` — renders all panels + the `Toaster`.
- `lib/utils.ts` — `cn()` (clsx + tailwind-merge).
- `styles.css` — Tailwind v4 import, self-hosted fonts, dark-only shadcn design
  tokens, rarity/rank + HUD-anchoring tokens, and the `focus-ring` /
  `panel-in` polish primitives.
- `theme.ts` — `applyRarityTheme()`: syncs `--rarity-*` / `--rank-*` from
  `@maple/shared` at runtime so theme colors match in-game item colors.
- `__fixtures__/snapshots.ts` — shared, realistic panel snapshots (real
  `@maple/shared` defIds / `BaseRank` / `PotentialTier`). Reused by BOTH the
  Vitest suite and the screenshot harness so what tests render is exactly what
  gets captured.
- `__tests__/` — Vitest + React Testing Library render/smoke tests.

---

## Testing & UI verification

The overlay has two automated, off-the-shelf verification layers — no bespoke
renderer. Both feed off the same `__fixtures__/snapshots.ts`.

### 1. Unit / render tests — Vitest + React Testing Library (jsdom)

```bash
pnpm --filter @maple/client test         # run once (CI)
pnpm --filter @maple/client test:watch   # watch mode
```

Tests live in `src/ui/__tests__/*.test.tsx`. They drive the **real bridge
store** (`uiStore`): push a fixture snapshot in via `setInventory`, register a
mocked `actions` registry, then assert the panel renders the snapshot and routes
user intent back out through `actions.*`. `InventoryPanel.test.tsx` is the
reference — copy it for new panels.

Config: `vitest.config.ts` (jsdom + `@vitejs/plugin-react`) and
`vitest.setup.ts` (jest-dom matchers + the browser-API polyfills Radix needs).

### 2. Screenshot harness — Playwright

```bash
pnpm --filter @maple/client ui:screenshots
```

`scripts/ui-screenshots.ts` boots the Vite dev server in-process, opens a
headless Chromium, and for each panel in `panelFixtures` (currently **14
panels**: login, inventory, character select/create, HUD, general store, cash
shop, free market, trade, storage, settings, party, guild, friends):

1. waits for the dev-only `window.__uiStore` to be exposed (see `mount.tsx`),
2. force-closes every `*Open` flag (so Phaser's own panels don't bleed in),
3. seeds the panel through the store exactly like Phaser would
   (`setInventory` + `setInventoryOpen`, …),
4. waits for the panel's `ready` selector and captures a PNG.

PNGs land in `packages/client/artifacts/ui-screenshots/` (git-ignored). The run
exits non-zero if any panel logs a console error or never renders, so it doubles
as a CI verify-step. Requires Chromium: `npx playwright install chromium`.

**Add a panel to both layers:** add a `PanelFixture` entry (snapshot + open
setters + a `ready` selector) to `__fixtures__/snapshots.ts`, and it is captured
automatically; write a matching `*.test.tsx` for the interaction assertions.
