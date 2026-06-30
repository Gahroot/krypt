import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OverlayRoot } from "@/ui/OverlayRoot";
import { uiStore } from "@/ui/store";
import { applyRarityTheme } from "@/ui/theme";
import "@/ui/styles.css";

/**
 * Mount the React UI overlay into #react-overlay. Called once from main.ts after
 * the Phaser game is created. Idempotent — guards against duplicate roots under
 * Vite HMR.
 */
export function mountOverlay(): void {
  const el = document.getElementById("react-overlay");
  if (!el || (el as HTMLElement & { _mounted?: boolean })._mounted) return;
  (el as HTMLElement & { _mounted?: boolean })._mounted = true;
  // Sync rarity/rank color tokens from @maple/shared so the overlay's theme
  // matches in-game item colors (single source of truth). Runs before render.
  applyRarityTheme();
  // Dev-only: expose the bridge store for headless UI verification. Stripped
  // from production builds via the import.meta.env.DEV guard.
  if (import.meta.env.DEV) {
    (window as unknown as { __uiStore?: typeof uiStore }).__uiStore = uiStore;
  }
  createRoot(el).render(
    <StrictMode>
      <OverlayRoot />
    </StrictMode>,
  );
}
