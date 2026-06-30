/// <reference types="vite/client" />

/**
 * Compile-time build stamps injected by Vite `define` (see ../vite.config.ts).
 *
 * These are replaced with string literals at build time. Under non-Vite runners (e.g. vitest)
 * they are undefined, so `version.ts` reads them through a `typeof` guard.
 */
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
