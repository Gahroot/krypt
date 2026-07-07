import * as React from "react";

import { Panel, type PanelProps } from "@/ui/components/Panel";
import { focusPanelForEsc } from "@/ui/panelEsc";

/**
 * DraggableWindow — a {@link Panel} you can drag by its title bar.
 *
 * Self-contained, props-driven, and designed for the overlay's floating windows.
 * Every panel that should be movable uses DraggableWindow; modals (shops, trade)
 * use Panel directly inside a scrim.
 *
 * Features:
 *   - **Drag** — pointer-capture based (mouse + touch), restricted to the header.
 *   - **Z-order** — each window gets a unique, auto-incrementing z-index.
 *     Clicking/dragging a window brings it to front.
 *   - **Bounds clamping** — on mount and during drag, the title bar is kept
 *     within the viewport so the window never escapes off-screen.
 *   - **Esc registration** — on pointer-down the panel is registered as the
 *     "active" panel for the global Esc-to-close handler (see panelEsc.ts).
 *   - **Sane default** — `defaultPosition` places the window in a comfortable
 *     spot; on mount it is clamped to the viewport.
 *
 * For a non-draggable window, use {@link Panel} directly (e.g. inside a modal
 * scrim).
 */
export interface DraggableWindowProps extends Omit<
  PanelProps,
  "headerRef" | "onHeaderPointerDown" | "className"
> {
  /** Initial top-left position in px. Default `{ x: 24, y: 52 }`. Clamped on mount. */
  defaultPosition?: { x: number; y: number };
  /** Extra classes forwarded to Panel (width, etc.). Positioning is handled internally. */
  className?: string;
}

/** Module-level z-index counter — every DraggableWindow gets a unique, increasing value. */
let nextZIndex = 10;

/**
 * Minimum number of title-bar pixels that must remain visible after clamping,
 * so the user can always grab the window to drag it back on-screen.
 */
const MIN_VISIBLE_PX = 60;

export function DraggableWindow({
  defaultPosition = { x: 24, y: 52 },
  className,
  style,
  children,
  onClose,
  ...panelProps
}: DraggableWindowProps) {
  const [pos, setPos] = React.useState(defaultPosition);
  const [zIndex, setZIndex] = React.useState(() => nextZIndex++);
  const drag = React.useRef<{ dx: number; dy: number } | null>(null);

  // ── Bounds clamping ────────────────────────────────────────────────────────
  const clamp = React.useCallback((p: { x: number; y: number }) => {
    const maxX = Math.max(0, window.innerWidth - MIN_VISIBLE_PX);
    const maxY = Math.max(0, window.innerHeight - MIN_VISIBLE_PX);
    return {
      x: Math.min(Math.max(0, p.x), maxX),
      y: Math.min(Math.max(0, p.y), maxY),
    };
  }, []);

  // Clamp default position on mount (handles small viewports).
  React.useEffect(() => {
    setPos((p) => clamp(p));
  }, [clamp]);

  // ── Z-order ────────────────────────────────────────────────────────────────
  const bringToFront = React.useCallback(() => {
    setZIndex(++nextZIndex);
  }, []);

  // ── Drag handlers (pointer-capture based) ──────────────────────────────────
  const onHeaderPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore drags that start on interactive controls (e.g. the close button).
      if ((e.target as HTMLElement).closest("button")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      bringToFront();
      if (onClose) focusPanelForEsc(onClose);
    },
    [pos.x, pos.y, bringToFront, onClose],
  );

  const onHeaderPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
    },
    [clamp],
  );

  const onHeaderPointerUp = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // ── Register as active panel on any pointer-down (not just header drag) ────
  const onPanelPointerDown = React.useCallback(() => {
    if (onClose) focusPanelForEsc(onClose);
  }, [onClose]);

  return (
    <Panel
      {...panelProps}
      onClose={onClose}
      className={className}
      style={{ position: "absolute", left: pos.x, top: pos.y, zIndex, ...style }}
      headerClassName="cursor-grab active:cursor-grabbing touch-none"
      onHeaderPointerDown={onHeaderPointerDown}
      onPointerDown={onPanelPointerDown}
      onPointerMove={onHeaderPointerMove}
      onPointerUp={onHeaderPointerUp}
    >
      {children}
    </Panel>
  );
}
