import Phaser from "phaser";

/**
 * Loading — a minimal transition screen shown between map-to-map travel.
 *
 * Shows a dark background with the destination map name and a subtle animated
 * dots indicator. Launched by MapScene before starting the new map instance,
 * killed once the new MapScene is ready.
 *
 * Map names are supplied as data (driven by getMap(id).name in MapScene).
 */

const FONT = "ui-monospace, Menlo, monospace";

export class LoadingScene extends Phaser.Scene {
  constructor() {
    super("loading");
  }

  create(data: { mapName: string }): void {
    const { width, height } = this.scale;

    // Dark background.
    this.add.rectangle(width / 2, height / 2, width, height, 0x0c1019, 1);

    // Map name.
    const mapName = data?.mapName ?? "Unknown";
    this.add
      .text(width / 2, height / 2 - 20, mapName, {
        fontFamily: FONT,
        fontSize: "24px",
        color: "#cfe8b4",
      })
      .setOrigin(0.5);

    // Animated dots.
    const dots = this.add
      .text(width / 2, height / 2 + 24, "", {
        fontFamily: FONT,
        fontSize: "16px",
        color: "#94a3b8",
      })
      .setOrigin(0.5);

    let dotCount = 0;
    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        dotCount = (dotCount % 3) + 1;
        dots.setText(".".repeat(dotCount));
      },
    });
  }
}
