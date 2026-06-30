/**
 * Client build identity — what build this tab is running, surfaced in-game and on bug reports.
 *
 * Two distinct notions of "version":
 *   - PROTOCOL_VERSION (from @maple/shared) gates wire compatibility. The client reports it on
 *     join; the server's AuthedRoom.onAuth rejects a mismatch, which MapScene.classifyConnectError
 *     turns into a "Please refresh" screen with a reload button.
 *   - BUILD_VERSION (package version + git short SHA) is human-facing only — shown in the
 *     settings footer + feedback panel and attached to feedback reports so a bug can be tied to
 *     an exact deploy.
 *
 * The build stamps are injected by Vite `define`. Under vitest they're undefined, so we guard
 * with `typeof` and fall back to "dev".
 */
import { PROTOCOL_VERSION } from "@maple/shared";

export { PROTOCOL_VERSION };

/** Semantic package version of this build (e.g. "0.0.0"). */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

/** Git short SHA this build was compiled from (e.g. "ab12cd3"), or "dev" when unknown. */
export const GIT_SHA: string = typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "dev";

/** Full build string for display + bug reports, e.g. "0.0.0+ab12cd3". */
export const BUILD_VERSION = `${APP_VERSION}+${GIT_SHA}`;

/** Compact label for the HUD/settings footer, e.g. "v0.0.0+ab12cd3 · p1". */
export const VERSION_LABEL = `v${BUILD_VERSION} · p${PROTOCOL_VERSION}`;
