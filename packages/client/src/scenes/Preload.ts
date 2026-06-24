import Phaser from "phaser";

import { generatePlaceholderTextures } from "../art/textures";

/**
 * Builds the shared art the rest of the game reuses. Right now there are no external files to load —
 * every texture is generated procedurally (see src/art/textures.ts) — so this scene just stamps the
 * placeholder textures into the Texture Manager, then advances to Meadowfield.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("preload");
  }

  create(): void {
    const { width, height } = this.scale;

    // One-line status while textures bake. Generation is synchronous and fast, but showing it keeps
    // the first frame from being an empty void and gives us a spot for a real loading bar later.
    this.add
      .text(width / 2, height / 2, "Loading…", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "18px",
        color: "#cfe8b4",
      })
      .setOrigin(0.5);

    generatePlaceholderTextures(this);

    this.scene.start("meadowfield");
  }
}
