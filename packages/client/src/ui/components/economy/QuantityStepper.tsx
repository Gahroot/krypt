import { Minus, Plus } from "lucide-react";

import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { cn } from "@/ui/lib/utils";

/**
 * QuantityStepper — a minus / value / plus quantity control.
 *
 * Built entirely from the shared kit (shadcn `Button` + `Input`). Controlled via
 * `value` + `onChange`; clamps to `[min, max]`. Used by buy rows that allow
 * purchasing stacks (e.g. consumables). Never hand-roll a +/- widget.
 */
export interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  disabled = false,
  className,
}: QuantityStepperProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const set = (n: number) => {
    if (Number.isFinite(n)) onChange(clamp(Math.round(n)));
  };

  return (
    <div data-slot="quantity-stepper" className={cn("inline-flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-7"
        disabled={disabled || value <= min}
        onClick={() => set(value - 1)}
        aria-label="Decrease quantity"
      >
        <Minus className="size-3" />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
        className="h-7 w-12 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        aria-label="Quantity"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-7"
        disabled={disabled || value >= max}
        onClick={() => set(value + 1)}
        aria-label="Increase quantity"
      >
        <Plus className="size-3" />
      </Button>
    </div>
  );
}
