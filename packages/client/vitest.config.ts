import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest config for the React UI overlay.
 *
 * jsdom environment + React Testing Library drive the panels headlessly. We
 * deliberately do NOT load the Tailwind/Phaser Vite plugins here — the panels
 * render fine from their DOM structure alone, and skipping them keeps the test
 * boot fast and free of canvas/WebGL noise.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
});
