import * as React from "react";
import { type LucideIcon } from "lucide-react";

import { CurrencyDisplay } from "@/ui/components/CurrencyDisplay";
import { cn } from "@/ui/lib/utils";

/**
 * WalletBar — the player's currency balance(s) shown in a shop header.
 *
 * Thin, props-driven wrapper over the shared {@link CurrencyDisplay}; render one
 * entry per currency a panel deals in (mesos for the General Store, Maple
 * Crystals for the Cash Shop). Never hand-roll a balance readout.
 */
export interface WalletBalance {
  amount: number;
  label?: string;
  icon?: LucideIcon;
  colorClassName?: string;
}

export interface WalletBarProps extends React.ComponentProps<"div"> {
  balances: WalletBalance[];
}

export function WalletBar({ balances, className, ...props }: WalletBarProps) {
  return (
    <div data-slot="wallet-bar" className={cn("flex items-center gap-4", className)} {...props}>
      {balances.map((b, i) => (
        <CurrencyDisplay
          key={b.label ?? i}
          amount={b.amount}
          label={b.label}
          icon={b.icon}
          colorClassName={b.colorClassName}
        />
      ))}
    </div>
  );
}
