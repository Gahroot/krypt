import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/ui/components/ui/button";
import { cn } from "@/ui/lib/utils";

/**
 * Panel — the standard floating-window shell for every overlay HUD panel.
 *
 * Extracted from the inventory panel chrome so no panel re-implements a title
 * bar, `[hotkey]` hint, or close button. It is generic and props-driven: pass a
 * `title`, an optional `hotkey` badge, an optional `onClose`, and the body as
 * children.
 *
 * RESIZE-SAFE BY DEFAULT. The shell is a flex column capped at `--panel-max-h`
 * (85vh) whose body scrolls internally, and sized via the `--panel-w` token, so
 * a panel always fits the viewport and survives `Phaser.Scale.RESIZE`. Anchor it
 * to a viewport edge/center with `className` using the clamp()-based HUD tokens
 * (e.g. `fixed right-[var(--hud-edge)] top-[var(--hud-top)]`) instead of magic
 * pixel offsets. Override width/height per panel with `w-[…]` / `max-h-[…]` in
 * `className` (tailwind-merge wins over the defaults). See ../README.md →
 * "Responsive anchoring".
 *
 * The host overlay element is click-through, so Panel re-enables pointer events
 * on itself (`pointer-events-auto`). It fades in on open via the shared
 * `--animate-panel-in` transition (motion-safe).
 *
 * For a drag-to-move window, use {@link DraggableWindow} which wires the title
 * bar's pointer handlers via `headerRef` + `onHeaderPointerDown`.
 */
export interface PanelProps extends Omit<React.ComponentProps<"div">, "title"> {
  /** Title-bar label. */
  title: React.ReactNode;
  /** Keyboard shortcut shown as a `<kbd>` badge in the title bar. */
  hotkey?: string;
  /** Close handler — when present, renders an X button in the title bar. */
  onClose?: () => void;
  /** Extra nodes rendered in the title bar, left of the hotkey/close (e.g. counts). */
  headerExtra?: React.ReactNode;
  /** Padding around the body. Default `true` (px-4 pb-3). */
  bodyPadding?: boolean;
  /** Forwarded to the title-bar element — used by DraggableWindow for drag. */
  headerRef?: React.Ref<HTMLDivElement>;
  /** Pointer-down on the title bar — used by DraggableWindow for drag. */
  onHeaderPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  /** Extra classes for the title-bar element. */
  headerClassName?: string;
}

export function Panel({
  title,
  hotkey,
  onClose,
  headerExtra,
  bodyPadding = true,
  headerRef,
  onHeaderPointerDown,
  headerClassName,
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <div
      data-slot="panel"
      data-state="open"
      className={cn(
        "pointer-events-auto flex max-h-[var(--panel-max-h)] w-[var(--panel-w)] select-none flex-col overflow-hidden rounded-xl border border-border bg-background/95 text-foreground shadow-panel backdrop-blur-sm",
        "motion-safe:animate-panel-in",
        className,
      )}
      {...props}
    >
      <div
        ref={headerRef}
        onPointerDown={onHeaderPointerDown}
        data-slot="panel-header"
        className={cn("flex shrink-0 items-center justify-between px-4 pt-3 pb-2", headerClassName)}
      >
        <h2 className="font-display text-sm font-semibold tracking-wide">{title}</h2>
        <div className="flex items-center gap-2">
          {headerExtra}
          {hotkey && (
            <kbd className="rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
              {hotkey}
            </kbd>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={onClose}
              aria-label="Close panel"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div
        data-slot="panel-body"
        className={cn(
          "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
          bodyPadding && "px-4 pb-3",
        )}
      >
        {children}
      </div>
    </div>
  );
}
