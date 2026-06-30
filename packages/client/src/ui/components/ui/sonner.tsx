import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toast surface for the overlay. The game is dark-only, so the theme is fixed
 * (no next-themes dependency). Tokens are mapped to the overlay's CSS variables
 * so toasts match every other shadcn panel.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
