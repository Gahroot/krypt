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
    // Phaser is a monolithic ~1.5 MB engine that cannot be sub-split — the
    // 1500 KB limit accommodates it while still flagging any accidentally fat
    // app or vendor chunk (all of which land well under 700 KB).
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendor code into dedicated chunks so the
        // browser can cache them independently and the initial app bundle stays
        // small. Two splits: Phaser (huge, never changes) and shared game-data
        // tables (large, change rarely). Everything else from node_modules
        // (React, Radix, Colyseus, zustand, utils) goes into a single `vendor`
        // chunk to avoid circular dependency warnings between React and vendor
        // sub-packages.
        manualChunks(id) {
          if (id.includes("/packages/shared/")) return "shared";
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/phaser/")) return "phaser";
          return "vendor";
        },
      },
    },
  },
});
