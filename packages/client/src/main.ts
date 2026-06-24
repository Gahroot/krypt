import Phaser from "phaser";

import { BootScene } from "./scenes/Boot";
import { PreloadScene } from "./scenes/Preload";
import { MeadowfieldScene } from "./scenes/Meadowfield";
import { UIScene } from "./scenes/UI";
import { MarketScene } from "./scenes/Market";

/**
 * Phaser game entrypoint. Mounts into <div id="game"> and resizes with the window.
 *
 * Movement is 4-directional top-down — the server authoritatively moves players on x/y — so arcade
 * gravity is pinned to zero. Scenes boot in order: Boot → Preload → Meadowfield, with UI launched in
 * parallel as a HUD overlay and Market reached on demand.
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#1a2233",
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, PreloadScene, MeadowfieldScene, UIScene, MarketScene],
};

export const game = new Phaser.Game(config);
