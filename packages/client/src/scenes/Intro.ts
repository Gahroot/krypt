import Phaser from "phaser";
import { markIntroSeen, getCharId } from "../backend";
import { getMap } from "@maple/shared";
import { uiStore } from "../ui/store";
import type { IntroLineSnapshot } from "../ui/store";

/**
 * IntroScene — thin Phaser controller for the Dawn Isle intro cinematic.
 *
 * The cinematic itself is rendered by the React overlay (`ui/IntroPanel.tsx`):
 * three sequential text lines fade in and crossfade, with any keypress or click
 * skipping to the end. This scene is now a thin bridge — it publishes the line
 * sequence, opens the panel, and registers a `complete` action React calls when
 * the sequence ends or is skipped.
 *
 * On completion it marks the intro as seen and starts MapScene for Dawn Isle.
 */

const INTRO_LINES: readonly IntroLineSnapshot[] = [
  {
    text: "You awaken on a mysterious shore…",
    holdMs: 2000,
  },
  {
    text: "Dawn Isle — where every adventure begins.",
    holdMs: 2000,
  },
  {
    text: "Use ← → to move. Talk to Guide Iris to start your journey.",
    holdMs: 2200,
  },
];

export class IntroScene extends Phaser.Scene {
  private finished = false;

  constructor() {
    super("intro");
  }

  create(): void {
    this.finished = false;

    uiStore.getState().setIntroActions({
      complete: () => this.finish(),
    });
    uiStore.getState().setIntro({ lines: [...INTRO_LINES] });
    uiStore.getState().setIntroOpen(true);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;

    // Mark intro as seen.
    const charId = getCharId();
    if (charId) markIntroSeen(charId);

    // Resolve the map display name from shared data.
    const map = getMap("dawn_isle");
    const mapName = map?.name ?? "Dawn Isle";

    this.scene.start("map", {
      mapId: "dawn_isle",
      _welcomeBanner: mapName,
    });
  }

  private teardown(): void {
    uiStore.getState().setIntroOpen(false);
    uiStore.getState().setIntroActions(null);
  }
}
