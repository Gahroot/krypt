import Phaser from "phaser";

import { BootScene } from "./scenes/Boot";
import { PreloadScene } from "./scenes/Preload";
import { LoginScene } from "./scenes/Login";
import { CharacterSelectScene } from "./scenes/CharacterSelect";
import { CharacterCreateScene } from "./scenes/CharacterCreate";
import { MapScene } from "./scenes/MapScene";
import { UIScene } from "./scenes/UI";
import { IntroScene } from "./scenes/Intro";
import { mountOverlay } from "./ui/mount";
import { installInputFocusTracking } from "./ui/inputFocus";

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
  dom: {
    createContainer: true,
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
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
  scene: [
    BootScene,
    PreloadScene,
    LoginScene,
    CharacterSelectScene,
    CharacterCreateScene,
    IntroScene,
    MapScene,
    UIScene,
    // On-demand scenes (Market, CashShop, GeneralStore, Trade, Storage,
    // ChannelSelect, Settings, CoachMarks, Loading) are lazy-loaded via
    // loadScene() so they stay out of the initial bundle.
  ],
};

export const game = new Phaser.Game(config);

// Mount the React UI overlay (DOM) on top of the Phaser canvas.
mountOverlay();

// Start the single input-routing policy: while any text field in the overlay is
// focused, Phaser is told to ignore the keyboard (see ui/inputFocus.ts). Phaser
// scenes subscribe to this; installing it here keeps it alive across scene
// restarts and independent of which scene is active.
installInputFocusTracking();
