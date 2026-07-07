import Phaser from "phaser";
import { markIntroSeen, getCharId } from "../backend";
import { getMap } from "@maple/shared";
import { uiStore } from "../ui/store";
import type { IntroLineSnapshot } from "../ui/store";

/**
 * IntroScene — thin Phaser controller for the Dawn Isle intro cinematic.
 *
 * The cinematic itself is rendered by the React overlay (`ui/IntroPanel.tsx`):
 * four atmospheric beats fade in and crossfade — stillness, dawn, a tease of
 * scale, then the first objective. Any keypress or click skips to the end.
 * This scene is a thin bridge: it publishes the line sequence, opens the
 * panel, and registers a `complete` action React calls when done or skipped.
 *
 * On completion it marks the intro as seen and starts MapScene for Dawn Isle.
 * New characters see this once; returning characters skip it entirely.
 */

const INTRO_LINES: readonly IntroLineSnapshot[] = [
  {
    text: "The world is quiet. Dawn hasn't broken yet.",
    holdMs: 2600,
  },
  {
    text: "Then — warmth. Light spills across green hills, calm water, soft cliffs.\nThis is Dawn Isle.",
    holdMs: 3000,
  },
  {
    text: "You don't know how you got here.\nBut the island feels like it's been waiting.",
    holdMs: 2800,
  },
  {
    text: "Beyond these shores: snow mountains, open ocean, sky kingdoms,\njungles alive with dragons, cities of neon and clockwork.\n\nFind Guide Iris. She'll show you where to begin.",
    holdMs: 4000,
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
