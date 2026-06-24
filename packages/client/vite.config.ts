import { defineConfig } from "vite";

export default defineConfig({
  // Read env files from the monorepo ROOT (where .env / .env.example live) instead of this package
  // dir, so VITE_BACKEND_URL set in the root .env reaches the browser. Only VITE_-prefixed vars are
  // ever exposed to client code, so the root .env's Phase-2 chain secrets stay server-side.
  envDir: "../..",
  server: {
    port: 5173,
    host: true,
  },
  // Phaser is large; raise the warning ceiling so the build stays quiet.
  build: {
    chunkSizeWarningLimit: 1500,
    target: "esnext",
  },
});
