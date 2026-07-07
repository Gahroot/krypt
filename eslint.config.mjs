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
    rules: {
      // Allow intentionally-unused bindings via an explicit leading underscore
      // (e.g. Colyseus message handlers that ignore the payload: `(client, _msg) => {}`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // ─── Chain-import guard (Phase 2 deferred — contracts must not leak into runtime) ─────
  // The client (browser bundle) must have ZERO chain dependencies.
  {
    files: ["packages/client/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "viem",
              message:
                "Chain imports are forbidden in the client (Phase 2 deferred). See eslint guard.",
            },
            {
              name: "wagmi",
              message:
                "Chain imports are forbidden in the client (Phase 2 deferred). See eslint guard.",
            },
            {
              name: "ethers",
              message:
                "Chain imports are forbidden in the client (Phase 2 deferred). See eslint guard.",
            },
          ],
          patterns: [
            {
              group: ["@ethereum/*"],
              message:
                "Chain imports are forbidden in the client (Phase 2 deferred). See eslint guard.",
            },
            {
              group: ["@maple/contracts"],
              message:
                "Chain imports are forbidden in the client (Phase 2 deferred). See eslint guard.",
            },
          ],
        },
      ],
    },
  },
  // The server may use viem for off-chain signature verification (auth.ts verifyMessage),
  // but must not import the contracts package or other chain-specific RPC libraries.
  {
    files: ["packages/server/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ethers",
              message:
                "Chain imports are forbidden in the game server (Phase 2 deferred). See eslint guard.",
            },
            {
              name: "wagmi",
              message:
                "Chain imports are forbidden in the game server (Phase 2 deferred). See eslint guard.",
            },
          ],
          patterns: [
            {
              group: ["@ethereum/*"],
              message:
                "Chain imports are forbidden in the game server (Phase 2 deferred). See eslint guard.",
            },
            {
              group: ["@maple/contracts", "@maple/contracts/**"],
              message:
                "Contracts package imports are forbidden in the game server (Phase 2 deferred). See eslint guard.",
            },
          ],
        },
      ],
    },
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
