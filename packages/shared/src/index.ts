/**
 * @maple/shared — the single source of truth for game systems.
 *
 * Pure data + pure functions used by BOTH the authoritative server (logic) and the Phaser client
 * (display). No runtime dependencies. Colyseus Schemas live server-side; the client imports types.
 */

export * from "./net.js";
export * from "./rarity.js";
export * from "./stats.js";
export * from "./classes.js";
export * from "./items.js";
export * from "./mobs.js";
