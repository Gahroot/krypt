import type Phaser from "phaser";

/**
 * Lazy-load a Phaser scene on first use.
 *
 * Dynamically imports the scene module, registers it with the game via
 * `game.scene.add()`, and returns. Subsequent calls for the same key are
 * no-ops. The caller must still call `scene.launch()` or `scene.start()`
 * after awaiting this function.
 *
 * Used to code-split on-demand scenes (Market, CashShop, Settings, …) so
 * they stay out of the initial bundle and are only fetched when the player
 * actually opens them.
 */

type SceneCtor = new (...args: never[]) => Phaser.Scene;
/**
 * A dynamically-imported scene module. The scene class may be the `default`
 * export OR a named export (our scenes use named exports like `MarketScene`),
 * so callers can pass `() => import("./Market")` without a re-export shim.
 */
type SceneModule = Record<string, unknown> & { default?: SceneCtor };

const inflight = new Map<string, Promise<void>>();

/** Resolve the Phaser.Scene constructor from a module: default export, else the first exported class. */
function resolveSceneCtor(mod: SceneModule): SceneCtor | undefined {
  if (typeof mod.default === "function") return mod.default;
  for (const value of Object.values(mod)) {
    // Scene classes are functions (constructors); pick the first one.
    if (typeof value === "function") return value as SceneCtor;
  }
  return undefined;
}

export async function loadScene(
  game: Phaser.Game,
  key: string,
  factory: () => Promise<SceneModule>,
): Promise<void> {
  // Already registered — nothing to do.
  if (game.scene.getScene(key)) return;

  // Deduplicate concurrent requests for the same scene.
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = factory().then((mod) => {
    // Guard: another call may have registered it while we were importing.
    if (!game.scene.getScene(key)) {
      const ctor = resolveSceneCtor(mod);
      if (!ctor) {
        inflight.delete(key);
        throw new Error(`loadScene: module for "${key}" has no scene class export`);
      }
      game.scene.add(key, ctor, false);
    }
    inflight.delete(key);
  });

  inflight.set(key, p);
  return p;
}
