import * as React from "react";

import { isImageIcon } from "@/ui/item-icon";
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
  /** Short rarity initial (R/E/U/L) shown as a corner badge for colorblind accessibility. */
  rarityLabel?: string;
  /** Color for the rarity corner badge (typically the tier color). */
  rarityColor?: string;
  /** Icon displayed above the label — a bundled PNG URL (rendered as `<img>`) or an emoji glyph. */
  icon?: string;
}

export function ItemCell({
  label,
  borderColor,
  labelColor,
  count,
  tooltip,
  tooltipSide = "left",
  rarityLabel,
  rarityColor,
  icon,
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
      {isImageIcon(icon) ? (
        // Real icon art — fill and center the cell; the name is kept for a11y/tooltip but hidden.
        <>
          <img
            src={icon}
            alt=""
            aria-hidden
            draggable={false}
            className="pointer-events-none absolute inset-0 m-auto max-h-[82%] max-w-[82%] object-contain"
          />
          <span className="sr-only" style={{ color: labelColor }}>
            {label}
          </span>
        </>
      ) : (
        // No art — fall back to emoji glyph (if any) stacked above the text label.
        <>
          {icon && (
            <span className="block text-[14px] leading-none" aria-hidden>
              {icon}
            </span>
          )}
          <span
            className="line-clamp-2 text-[10px] leading-tight font-medium"
            style={{ color: labelColor }}
          >
            {label}
          </span>
        </>
      )}
      {/* Rarity corner badge — colorblind accessibility: shows R/E/U/L initial */}
      {rarityLabel && (
        <span
          className="absolute left-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-sm bg-black/70 text-[7px] font-bold leading-none"
          style={{ color: rarityColor }}
          title={`Rarity: ${rarityLabel}`}
        >
          {rarityLabel}
        </span>
      )}
      {count != null && count > 1 && (
        <Badge
          variant="secondary"
          className="absolute right-0.5 bottom-0.5 h-auto px-1 py-0 font-mono text-[9px] tabular-nums"
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
