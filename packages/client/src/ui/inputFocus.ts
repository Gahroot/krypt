/**
 * inputFocus — the single, deliberate policy for routing keyboard/mouse input
 * between the React DOM overlay and the Phaser canvas.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 * The HUD is a React DOM overlay (`#react-overlay`) layered on top of the Phaser
 * canvas. Both can see browser key events. Without a policy, typing "i" into the
 * chat box (or the market search, the report dialog, the character-name field…)
 * would ALSO trigger Phaser's "open inventory" hotkey, and pressing the movement
 * keys inside a text field would walk the character. The previous code only
 * special-cased the chat input, leaving every other field to double-fire.
 *
 * ── The policy (one rule, applied everywhere) ────────────────────────────────
 * "While a real text field in the DOM overlay is focused, Phaser receives no
 *  keyboard input." We detect that condition centrally — by watching the
 * document's focus, NOT by wiring onFocus/onBlur onto each individual `<input>`
 * — so EVERY current and future text field is covered automatically with zero
 * per-widget code. This module is the single source of truth for "is the player
 * typing?"; Phaser scenes subscribe and suppress accordingly.
 *
 * ── Hotkey / input ownership ──────────────────────────────────────────────────
 * • Movement (arrows/WASD), attack, jump, interact, loot-all, quickslots, and
 *   panel-toggle hotkeys (I, K, S, E, Q, J, W, U, C, V, B, …) are owned by
 *   PHASER (MapScene + UIScene). Panel open/close state lives in the bridge
 *   store, so React panels are pure renderers — they never register their own
 *   global toggle handlers, which means a toggle key has exactly one owner and
 *   cannot double-fire.
 * • A few keys are owned by REACT while a specific panel is open, and those
 *   panels swallow the event in the capture phase so it never reaches Phaser:
 *     - Settings keybind-capture row (any key → rebind) — see SettingsPanel.tsx
 *       (`stopImmediatePropagation` in the capture phase).
 *     - Per-field editing keys (Enter to submit, Escape to blur) handled by the
 *       focused `<input>` itself; because the field is focused, this module has
 *       already told Phaser to ignore the keyboard.
 * • Pointer input: `#react-overlay` is click-through (`pointer-events: none`);
 *   only genuinely interactive widgets opt back in via `pointer-events-auto`.
 *   So clicks on empty HUD space fall through to the canvas (move/attack/NPC),
 *   while clicks on a panel are consumed by the panel. This module governs the
 *   keyboard half of the same "one owner per input" contract.
 */

type FocusListener = (focused: boolean) => void;

const listeners = new Set<FocusListener>();
let focused = false;
let installed = false;
let teardown: (() => void) | null = null;

/** Input `type`s that don't capture typed text — focusing them must NOT suppress Phaser. */
const NON_TYPING_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
]);

/**
 * Does `el` capture typed text? True for `<textarea>`, `<select>`, any
 * content-editable element, and `<input>`s of a text-bearing type. This is the
 * one place that decides what "typing" means.
 */
function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const html = el as HTMLElement;
  const tag = el.tagName;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type.toLowerCase();
    return !NON_TYPING_INPUT_TYPES.has(type);
  }
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return html.isContentEditable === true;
}

/** Recompute focus state from the live `document.activeElement` and notify on change. */
function recompute(): void {
  const next = isEditableElement(document.activeElement);
  if (next === focused) return;
  focused = next;
  for (const listener of listeners) listener(focused);
}

/**
 * Begin watching DOM focus. Idempotent — safe to call from `main.ts` once after
 * the overlay mounts (and harmless under Vite HMR). Returns a teardown fn.
 *
 * We listen in the capture phase to `focusin`/`focusout` (which, unlike
 * `focus`/`blur`, bubble) and recompute on a microtask. The microtask matters
 * when focus moves directly from one field to another: `focusout` fires before
 * the next `focusin`, so reading `document.activeElement` synchronously would
 * momentarily report "nothing focused" and flicker Phaser back on. Deferring to
 * a microtask lets `activeElement` settle on the new field first.
 */
export function installInputFocusTracking(): () => void {
  const noop = (): void => undefined;
  if (installed) return teardown ?? noop;
  if (typeof document === "undefined") return noop;
  installed = true;

  const onFocusChange = (): void => {
    queueMicrotask(recompute);
  };
  document.addEventListener("focusin", onFocusChange, true);
  document.addEventListener("focusout", onFocusChange, true);
  // If the window loses focus entirely, re-sync on return (activeElement can go stale).
  window.addEventListener("blur", onFocusChange);
  recompute();

  teardown = (): void => {
    document.removeEventListener("focusin", onFocusChange, true);
    document.removeEventListener("focusout", onFocusChange, true);
    window.removeEventListener("blur", onFocusChange);
    installed = false;
    teardown = null;
  };
  return teardown;
}

/** Is a text field in the DOM overlay currently focused (i.e. the player is typing)? */
export function isTextInputFocused(): boolean {
  return focused;
}

/**
 * Subscribe to focus transitions. The listener fires only on change with the new
 * boolean; call it once with the current value yourself if you need an initial
 * sync. Returns an unsubscribe fn.
 */
export function subscribeInputFocus(listener: FocusListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
