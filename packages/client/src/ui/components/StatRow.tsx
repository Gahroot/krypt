import * as React from "react";

import { cn } from "@/ui/lib/utils";

/**
 * StatRow — a label-left / value-right row for stat panels, tooltips, and
 * detail lists. Props-driven; pass `valueColor` for conditional coloring
 * (e.g. red when a requirement is unmet).
 */
export interface StatRowProps extends React.ComponentProps<"div"> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** CSS color string for the value (e.g. requirement red). */
  valueColor?: string;
  /** Optional trailing control (e.g. an AP `+` button). */
  action?: React.ReactNode;
}

export function StatRow({ label, value, valueColor, action, className, ...props }: StatRowProps) {
  return (
    <div
      data-slot="stat-row"
      className={cn("flex items-center justify-between gap-2 text-[11px] leading-tight", className)}
      {...props}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-medium tabular-nums" style={{ color: valueColor }}>
          {value}
        </span>
        {action}
      </span>
    </div>
  );
}
