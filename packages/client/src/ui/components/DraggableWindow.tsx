import * as React from "react";

import { Panel, type PanelProps } from "@/ui/components/Panel";

/**
 * DraggableWindow — a {@link Panel} you can drag by its title bar.
 *
 * Pointer-based (works for mouse + touch), self-contained, and props-driven.
 * Pass `defaultPosition` for the initial top-left; the window then tracks its
 * own offset. Everything else forwards to Panel, so a draggable inventory is
 * just `<DraggableWindow title="Inventory" hotkey="I" onClose={…}>`.
 */
export interface DraggableWindowProps extends Omit<
  PanelProps,
  "headerRef" | "onHeaderPointerDown" | "className"
> {
  /** Initial top-left position in px. Default `{ x: 24, y: 52 }`. */
  defaultPosition?: { x: number; y: number };
  /** Extra classes for the window shell (positioning is handled internally). */
  className?: string;
}

export function DraggableWindow({
  defaultPosition = { x: 24, y: 52 },
  className,
  style,
  children,
  ...panelProps
}: DraggableWindowProps) {
  const [pos, setPos] = React.useState(defaultPosition);
  const drag = React.useRef<{ dx: number; dy: number } | null>(null);

  const onHeaderPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore drags that start on interactive controls (e.g. the close button).
      if ((e.target as HTMLElement).closest("button")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    },
    [pos.x, pos.y],
  );

  const onHeaderPointerMove = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  }, []);

  const onHeaderPointerUp = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  return (
    <Panel
      {...panelProps}
      className={className}
      style={{ position: "absolute", left: pos.x, top: pos.y, ...style }}
      headerClassName="cursor-grab active:cursor-grabbing touch-none"
      onHeaderPointerDown={onHeaderPointerDown}
      onPointerMove={onHeaderPointerMove}
      onPointerUp={onHeaderPointerUp}
    >
      {children}
    </Panel>
  );
}
