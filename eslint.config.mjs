// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    "**/build/",
    "**/out/",
    "**/coverage/",
    "packages/contracts/lib/",
    "packages/contracts/out/",
  ]),
  {
    files: ["packages/**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.strict,
      tseslint.configs.stylistic,
    ],
  },
  // Test harnesses pragmatically cast the synced Colyseus state (`room.state as any`) to read it by
  // hand, so `any` is allowed in test files only — not in shipped source.
  {
    files: ["packages/**/test/**/*.ts", "packages/**/tests/**/*.ts", "packages/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Non-null assertions on known-key fixture lookups (e.g. MOBS[STARTER_MOB_ID]!) are fine in tests.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  // Disable formatting-related rules that conflict with Prettier. Keep last.
  eslintConfigPrettier,
]);
