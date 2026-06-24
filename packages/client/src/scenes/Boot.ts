import Phaser from "phaser";

/**
 * First scene to run. Does the bare minimum bootstrap — a couple of scale/input defaults — then
 * hands straight off to Preload, which owns asset generation. Kept intentionally thin so the game
 * window appears instantly.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    // Scale mode itself is RESIZE (see main.ts); keep the canvas centered if that ever changes.
    this.scale.autoCenter = Phaser.Scale.Center.CENTER_BOTH;

    // Input defaults: stop arrow keys / space from scrolling the page, and free right-click for gameplay.
    this.input.keyboard?.addCapture("UP,DOWN,LEFT,RIGHT,SPACE");
    this.input.mouse?.disableContextMenu();

    this.scene.start("preload");
  }
}
