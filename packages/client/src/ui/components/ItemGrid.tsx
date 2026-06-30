import * as React from "react";

import { cn } from "@/ui/lib/utils";

/**
 * ItemGrid — a fixed-slot grid layout for {@link ItemCell}s (or any cell node).
 *
 * Generalized from the inventory panel: pad a list of items out to a fixed
 * `slots` count and lay them out in `cols` columns. `renderCell` receives the
 * item (or `null` for a padded-empty slot) and its index. Reused for inventory,
 * shops, the market, storage, etc.
 */
export interface ItemGridProps<T> extends React.ComponentProps<"div"> {
  /** Backing items; padded with `null` up to `slots`. */
  items: (T | null)[];
  /** Total number of slots to render. Default = `items.length`. */
  slots?: number;
  /** Column count (Tailwind grid). Default `6`. */
  cols?: number;
  /** Render one cell. Return an `ItemCell` (or empty cell for `null`). */
  renderCell: (item: T | null, index: number) => React.ReactNode;
}

const COL_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
};

export function ItemGrid<T>({
  items,
  slots,
  cols = 6,
  renderCell,
  className,
  ...props
}: ItemGridProps<T>) {
  const total = slots ?? items.length;
  const cells: (T | null)[] = Array.from({ length: total }, (_, i) => items[i] ?? null);

  return (
    <div
      data-slot="item-grid"
      className={cn("grid gap-1", COL_CLASS[cols] ?? "grid-cols-6", className)}
      {...props}
    >
      {cells.map((item, i) => (
        <React.Fragment key={i}>{renderCell(item, i)}</React.Fragment>
      ))}
    </div>
  );
}
