import * as React from "react";
import { Coins, type LucideIcon } from "lucide-react";

import { cn } from "@/ui/lib/utils";

/**
 * CurrencyDisplay — a coin icon + formatted amount + label.
 *
 * Generalized from the inventory mesos footer. Defaults to mesos (gold coin);
 * pass `icon`, `label`, and `colorClassName` for other currencies (e.g. the
 * Phase-2 token). Amounts are locale-formatted with tabular numerals.
 */
export interface CurrencyDisplayProps extends React.ComponentProps<"div"> {
  amount: number;
  /** Trailing label, e.g. "mesos". Omit to hide. */
  label?: string;
  /** Icon component (lucide). Default `Coins`. */
  icon?: LucideIcon;
  /** Tailwind text color for icon + amount. Default gold (`text-yellow-400`). */
  colorClassName?: string;
}

export function CurrencyDisplay({
  amount,
  label = "mesos",
  icon: Icon = Coins,
  colorClassName = "text-yellow-400",
  className,
  ...props
}: CurrencyDisplayProps) {
  return (
    <div
      data-slot="currency-display"
      className={cn("flex items-center gap-1.5", className)}
      {...props}
    >
      <Icon className={cn("size-4", colorClassName)} />
      <span className={cn("font-mono text-sm font-bold tabular-nums", colorClassName)}>
        {amount.toLocaleString()}
      </span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}
