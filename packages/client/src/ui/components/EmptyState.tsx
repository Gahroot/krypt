import * as React from "react";
import { Inbox, type LucideIcon } from "lucide-react";

import { cn } from "@/ui/lib/utils";

/**
 * EmptyState — centered icon + title + description for empty panels (no items,
 * no party, no friends, …). Optional `action` slot for a call-to-action button.
 */
export interface EmptyStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  /** Icon component (lucide). Default `Inbox`. */
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional action node (e.g. a Button). */
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        className,
      )}
      {...props}
    >
      <Icon className="size-8 text-muted-foreground/60" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
