import Phaser from "phaser";

import { generatePlaceholderTextures, queueTextureLoads } from "../art/textures";

/**
 * Loads the shared art the rest of the game reuses. Real CC0 platformer art (Kenney) lives under
 * src/assets and is loaded as images here in `preload()`; `create()` then bakes the single
 * remaining procedural primitive (the drop shadow) and advances to character creation.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("preload");
  }

  preload(): void {
    const { width, height } = this.scale;

    const label = this.add
      .text(width / 2, height / 2 - 20, "Loading…", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "18px",
        color: "#cfe8b4",
      })
      .setOrigin(0.5);

    // Simple progress bar so the first frame isn't an empty void while textures load.
    const barW = 240;
    const barH = 8;
    const barX = width / 2 - barW / 2;
    const barY = height / 2 + 8;
    const track = this.add
      .rectangle(width / 2, barY + barH / 2, barW, barH, 0x2a3a5a)
      .setOrigin(0.5);
    const fill = this.add.rectangle(barX, barY, 0, barH, 0x86c25a).setOrigin(0, 0);

    this.load.on("progress", (p: number) => {
      fill.width = barW * p;
    });
    this.load.once("complete", () => {
      track.destroy();
      fill.destroy();
      label.destroy();
    });

    queueTextureLoads(this);
  }

  create(): void {
    generatePlaceholderTextures(this);
    this.scene.start("character_create");
  }
}
