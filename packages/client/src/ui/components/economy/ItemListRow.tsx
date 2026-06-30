import * as React from "react";

import { cn } from "@/ui/lib/utils";

/**
 * ItemListRow — one generic row in a shop list (buy stock, sell-back, catalog).
 *
 * Slot-driven and currency-agnostic: a `leading` visual (color swatch / icon),
 * a `title`, optional `meta` + `badges`, and a `trailing` area for the price and
 * action buttons. Used by every economy panel so rows look identical across the
 * General Store and Cash Shop. Never hand-roll a shop row.
 */
export interface ItemListRowProps extends Omit<React.ComponentProps<"div">, "title"> {
  leading?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  badges?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Emphasize the row (e.g. an equipped cosmetic). */
  highlighted?: boolean;
}

export function ItemListRow({
  leading,
  title,
  meta,
  badges,
  trailing,
  highlighted = false,
  className,
  ...props
}: ItemListRowProps) {
  return (
    <div
      data-slot="item-list-row"
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2 transition-colors",
        highlighted
          ? "border-primary/60 bg-primary/10"
          : "border-border bg-card/60 hover:bg-accent/40",
        className,
      )}
      {...props}
    >
      {leading && <div className="flex shrink-0 items-center">{leading}</div>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{title}</span>
          {badges}
        </div>
        {meta && <span className="truncate text-xs text-muted-foreground">{meta}</span>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-3">{trailing}</div>}
    </div>
  );
}
