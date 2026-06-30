/**
 * pnpm install hook — dedupe @colyseus/core to a single physical copy.
 *
 * `@colyseus/core` and `@colyseus/ws-transport` declare each other as peer
 * dependencies (core ⇄ ws-transport). pnpm breaks that cycle by installing two
 * physically-distinct copies of `@colyseus/core`: a "bare" copy used by
 * ws-transport and a "full" copy used by the app (via the `colyseus` meta-package
 * and `@colyseus/tools`).
 *
 * Because each copy is a separate ES module instance, each has its OWN private
 * matchmaker `rooms` registry. The HTTP matchmaker registers a freshly-created
 * room in one copy's registry, but the WebSocket transport's
 * `getLocalRoomById()` reads the OTHER copy's (empty) registry when consuming the
 * seat reservation — so every join fails with `MatchMakeError: seat reservation
 * expired` (code 524), even though the room exists.
 *
 * The `@colyseus/ws-transport` peer on core is OPTIONAL and core never imports
 * ws-transport itself (the transport is injected at runtime), so dropping it from
 * core's peer set is safe and collapses the two installs into one — restoring a
 * single shared room registry.
 */
function readPackage(pkg) {
  if (pkg.name === "@colyseus/core") {
    if (pkg.peerDependencies) {
      delete pkg.peerDependencies["@colyseus/ws-transport"];
    }
    if (pkg.peerDependenciesMeta) {
      delete pkg.peerDependenciesMeta["@colyseus/ws-transport"];
    }
  }
  return pkg;
}

module.exports = {
  hooks: { readPackage },
};
