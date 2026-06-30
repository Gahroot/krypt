import { ShoppingCart, Banknote } from "lucide-react";

import { Button } from "@/ui/components/ui/button";
import { cn } from "@/ui/lib/utils";

/**
 * BuySellButtons — the canonical buy / sell action button group for shop rows.
 *
 * Built on the shared shadcn `Button`; renders whichever actions are wired
 * (`onBuy` and/or `onSell`). Buy is the primary (green) action; Sell is an
 * amber secondary. Every economy panel uses this — never make a bespoke
 * buy/sell button.
 */
export interface BuySellButtonsProps {
  onBuy?: () => void;
  onSell?: () => void;
  buyLabel?: string;
  sellLabel?: string;
  buyDisabled?: boolean;
  sellDisabled?: boolean;
  size?: "sm" | "default";
  className?: string;
}

export function BuySellButtons({
  onBuy,
  onSell,
  buyLabel = "Buy",
  sellLabel = "Sell",
  buyDisabled = false,
  sellDisabled = false,
  size = "sm",
  className,
}: BuySellButtonsProps) {
  return (
    <div data-slot="buy-sell-buttons" className={cn("inline-flex items-center gap-1.5", className)}>
      {onBuy && (
        <Button
          type="button"
          size={size}
          disabled={buyDisabled}
          onClick={onBuy}
          className="bg-emerald-600 text-white hover:bg-emerald-500"
        >
          <ShoppingCart />
          {buyLabel}
        </Button>
      )}
      {onSell && (
        <Button
          type="button"
          size={size}
          disabled={sellDisabled}
          onClick={onSell}
          className="bg-amber-600 text-white hover:bg-amber-500"
        >
          <Banknote />
          {sellLabel}
        </Button>
      )}
    </div>
  );
}
