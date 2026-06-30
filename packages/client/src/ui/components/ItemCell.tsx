import * as React from "react";

import { Badge } from "@/ui/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/components/ui/tooltip";
import { cn } from "@/ui/lib/utils";

/**
 * ItemCell — a single rarity-bordered slot, generalized from the inventory grid.
 *
 * Fully props-driven so it works for inventory, equipment paper-dolls, shop
 * grids, the market, etc. An empty cell (no `label`) renders a dashed slot.
 * Provide `tooltip` to attach a Radix tooltip; provide drag handlers for
 * reordering. Colors are passed in (rarity/tier) rather than computed here.
 */
export interface ItemCellProps extends Omit<React.ComponentProps<"button">, "content"> {
  /** Slot contents label (e.g. item name). Omit for an empty slot. */
  label?: React.ReactNode;
  /** Border color (typically the potential-tier color). */
  borderColor?: string;
  /** Label text color (typically the base-rank color). */
  labelColor?: string;
  /** Stack count badge; shown when > 1. */
  count?: number;
  /** Tooltip body; when present the cell is wrapped in a Radix Tooltip. */
  tooltip?: React.ReactNode;
  /** Side the tooltip opens to. Default `left`. */
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export function ItemCell({
  label,
  borderColor,
  labelColor,
  count,
  tooltip,
  tooltipSide = "left",
  className,
  style,
  ...props
}: ItemCellProps) {
  if (label == null) {
    return (
      <div
        data-slot="item-cell-empty"
        className={cn("aspect-square rounded-md border border-border/40", className)}
      />
    );
  }

  const cell = (
    <button
      type="button"
      data-slot="item-cell"
      className={cn(
        "relative flex aspect-square items-center justify-center rounded-md border bg-card/80 p-1",
        "focus-ring cursor-grab text-center transition-colors hover:bg-accent active:cursor-grabbing",
        className,
      )}
      style={{ borderColor, ...style }}
      {...props}
    >
      <span
        className="line-clamp-2 text-[9px] leading-tight font-medium"
        style={{ color: labelColor }}
      >
        {label}
      </span>
      {count != null && count > 1 && (
        <Badge
          variant="secondary"
          className="absolute right-0.5 bottom-0.5 h-auto px-1 py-0 font-mono text-[8px] tabular-nums"
        >
          {count}
        </Badge>
      )}
    </button>
  );

  if (!tooltip) return cell;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
