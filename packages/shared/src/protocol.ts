/**
 * Wire-protocol versioning — the compatibility gate between client and server.
 *
 * `PROTOCOL_VERSION` is an integer that is bumped MANUALLY whenever a change ships that is
 * incompatible across the wire: a new/renamed/removed network message, a changed Colyseus
 * schema field, or a different join handshake. Because both the client bundle and the server
 * import this same constant from `@maple/shared`, the two only disagree when their deployed
 * builds differ — exactly when a stale browser tab talks to a freshly deployed server.
 *
 * On join the client reports its `PROTOCOL_VERSION` in the room options; the server compares it
 * (see `AuthedRoom.onAuth`) and rejects an incompatible client with `PROTOCOL_MISMATCH_CODE` +
 * `PROTOCOL_MISMATCH_MESSAGE`, which the client surfaces as a "Please refresh" screen with a
 * reload button instead of letting the stale client silently misbehave.
 *
 * The human-readable BUILD version (package version + git short SHA) is injected per app at build
 * time and is for display / bug reports only — it does NOT gate compatibility.
 */

/** Current wire-protocol revision. BUMP THIS on any wire-incompatible change. */
export const PROTOCOL_VERSION = 1;

/**
 * `ServerError` code used when a join is rejected for a protocol mismatch. Colyseus's matchmake
 * HTTP layer reuses this number as the response's HTTP status, so it MUST be a valid status
 * (200–599). We use 426 “Upgrade Required” — semantically exact and distinct from Colyseus's own
 * matchmaking codes (520–526) — so the client can classify the failure unambiguously.
 */
export const PROTOCOL_MISMATCH_CODE = 426;

/** Player-facing message shown when the client must reload to get the latest build. */
export const PROTOCOL_MISMATCH_MESSAGE = "Please refresh — the game updated.";

/**
 * True when a client's reported protocol version is compatible with this build's
 * `PROTOCOL_VERSION`. A `null`/`undefined` (legacy/unversioned caller, e.g. an in-process test
 * harness) is treated as compatible; a present-but-different number is incompatible.
 */
export function isProtocolCompatible(clientVersion: unknown): boolean {
  if (clientVersion === undefined || clientVersion === null) return true;
  return clientVersion === PROTOCOL_VERSION;
}
