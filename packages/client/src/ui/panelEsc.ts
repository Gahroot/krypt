/**
 * panelEsc — single-source Esc-to-close manager for every overlay panel.
 *
 * ── Problem ──────────────────────────────────────────────────────────────────
 * Multiple panels can be open simultaneously (Inventory + Skill Tree + Party).
 * Pressing Esc should close only the *most-recently interacted* panel, not all
 * of them. Phaser already owns Esc → Settings toggle, so when a panel closes
 * via Esc the DOM event is intercepted in the capture phase (stopImmediate-
 * Propagation) so Phaser never sees it — meaning Esc opens Settings *only*
 * when no panel is open.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 * 1. Any panel calls `focusPanelForEsc(closeFn)` on pointer-down (header drag,
 *    body click, scrim click — wherever the user last interacted).
 * 2. `installPanelEscHandler()` (called once from OverlayRoot) adds a single
 *    capture-phase keydown listener on `window`.
 * 3. On Esc, the listener fires the stored `closeFn`, clears it, and stops
 *    propagation so Phaser never toggles Settings.
 */

type CloseFn = () => void;

let lastFocusedClose: CloseFn | null = null;
let installed = false;

/**
 * Register a panel as the "active" target for the next Esc press.
 * Call this from pointer-down handlers (header drag, body click, scrim click).
 */
export function focusPanelForEsc(close: CloseFn): void {
  lastFocusedClose = close;
}

/**
 * Install the global capture-phase Esc handler. Idempotent.
 * Returns a teardown function. Call once from OverlayRoot on mount.
 */
export function installPanelEscHandler(): () => void {
  const noop = (): void => undefined;
  if (installed) return noop;
  installed = true;

  const handler = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !lastFocusedClose) return;
    lastFocusedClose();
    lastFocusedClose = null;
    // Stop Phaser from toggling Settings on the same Esc press.
    e.stopImmediatePropagation();
  };

  window.addEventListener("keydown", handler, true);
  return () => {
    window.removeEventListener("keydown", handler, true);
    installed = false;
  };
}
