import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import pkg from "./package.json" with { type: "json" };

/**
 * Build stamp injected at compile time so a running tab can report exactly which build it is
 * (surfaced in the HUD/settings footer and attached to bug reports). The git short SHA prefers an
 * explicit `GIT_SHA` env var (set in CI / Docker where `.git` may be absent), falling back to a
 * local `git rev-parse` and finally to "dev" so a checkout without git still builds.
 */
const gitSha: string =
  process.env.GIT_SHA ??
  (() => {
    try {
      return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return "dev";
    }
  })();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Compile-time constants — only build metadata, never secrets (these ship in the bundle).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Read env files from the monorepo ROOT (where .env / .env.example live) instead of this package
  // dir, so VITE_BACKEND_URL set in the root .env reaches the browser. Only VITE_-prefixed vars are
  // ever exposed to client code, so the root .env's Phase-2 chain secrets stay server-side.
  envDir: "../..",
  // Use relative paths so assets work behind any reverse proxy / subdirectory.
  base: "./",
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: "esnext",
    // With vendor code split out (below) and heavy panels lazy-loaded, every
    // app + vendor chunk is now well under this. Dropped from 1500 toward the
    // 500 default so an accidental fat app chunk surfaces again. The sole chunk
    // that still exceeds it is `phaser` (~1.5 MB) — a single-namespace engine
    // that can't be sub-split with standard tooling, so one expected warning
    // about that vendor chunk remains by design.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendor code into dedicated chunks so the
        // browser can cache them independently and the initial app bundle stays
        // small. Order matters: the first matching branch wins.
        manualChunks(id) {
          // Shared game-data tables (mobs / items / codex / classes) are large,
          // statically imported everywhere, and change rarely — give them their
          // own cacheable chunk so they stay out of the app entry bundle.
          if (id.includes("/packages/shared/")) return "shared";
          if (!id.includes("node_modules")) return undefined;
          // Phaser is by far the heaviest dependency — isolate it.
          if (id.includes("/phaser/")) return "phaser";
          // React core + Radix UI primitives used by the overlay kit.
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/") ||
            id.includes("/@radix-ui/")
          ) {
            return "react-vendor";
          }
          // Everything else from node_modules (colyseus sdk, zustand, utils …).
          return "vendor";
        },
      },
    },
  },
});
