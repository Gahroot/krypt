/**
 * Server build identity, surfaced on boot and used to gate client compatibility.
 *
 * `PROTOCOL_VERSION` (from @maple/shared) is the wire-compatibility gate compared against each
 * joining client in `AuthedRoom.onAuth`. `SERVER_BUILD_VERSION` (package version + git short SHA
 * from the `GIT_SHA` deploy env var) is human-facing only — logged on boot so a running process
 * can be matched to an exact deploy when triaging bug reports.
 */
import { PROTOCOL_VERSION } from "@maple/shared";
import pkg from "../package.json" with { type: "json" };

export { PROTOCOL_VERSION };

/** Git short SHA this server was deployed from, or "dev" when not injected. */
export const GIT_SHA: string = process.env.GIT_SHA ?? "dev";

/** Full server build string for logs, e.g. "0.0.0+ab12cd3". */
export const SERVER_BUILD_VERSION = `${pkg.version}+${GIT_SHA}`;
