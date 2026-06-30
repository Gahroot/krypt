import * as React from "react";
import { Coins, type LucideIcon } from "lucide-react";

import { cn } from "@/ui/lib/utils";

/**
 * PriceTag — an inline currency amount used inside shop rows.
 *
 * Generic and props-driven: a small currency icon, a locale-formatted amount,
 * and an optional trailing ticker/label. Defaults to mesos (gold `Coins`); pass
 * `icon`, `ticker`, and `colorClassName` for other currencies (e.g. the Cash
 * Shop's Maple Crystals). Set `affordable={false}` to dim an unaffordable price.
 *
 * Shared by every economy panel — never hand-roll a price label.
 */
export interface PriceTagProps extends React.ComponentProps<"span"> {
  amount: number;
  /** Trailing ticker/label, e.g. "MC". Omit to hide. */
  ticker?: string;
  /** Icon component (lucide). Default `Coins`. */
  icon?: LucideIcon;
  /** Tailwind text color for icon + amount. Default gold (`text-yellow-400`). */
  colorClassName?: string;
  /** When false, render dimmed to signal the player can't afford it. */
  affordable?: boolean;
}

export function PriceTag({
  amount,
  ticker,
  icon: Icon = Coins,
  colorClassName = "text-yellow-400",
  affordable = true,
  className,
  ...props
}: PriceTagProps) {
  return (
    <span
      data-slot="price-tag"
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        !affordable && "opacity-50",
        className,
      )}
      {...props}
    >
      <Icon className={cn("size-3.5", colorClassName)} />
      <span className={cn("text-sm font-bold", colorClassName)}>{amount.toLocaleString()}</span>
      {ticker && <span className="text-[10px] font-medium text-muted-foreground">{ticker}</span>}
    </span>
  );
}
