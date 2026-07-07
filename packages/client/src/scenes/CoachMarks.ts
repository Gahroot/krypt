import Phaser from "phaser";
import { getCharId, getSeenCoachMarks, markCoachMarkSeen, type CoachMarkId } from "../backend";
import { uiStore } from "../ui/store";
import type { CoachMarkPosition } from "../ui/store";

// ─── Coach-mark definitions (client-only) ──────────────────────────────────────

interface CoachMarkDef {
  readonly id: CoachMarkId;
  readonly icon: string;
  readonly title: string;
  readonly detail: string;
  /** Screen position: "center-bottom" by default. */
  readonly position: CoachMarkPosition;
}

const COACH_MARKS: readonly CoachMarkDef[] = [
  {
    id: "move",
    icon: "🏃",
    title: "Movement",
    detail: "Use  ←  →  arrow keys or  W A S D  to move.",
    position: "center-bottom",
  },
  {
    id: "attack",
    icon: "⚔️",
    title: "Attack",
    detail: "Press  Space  or left-click to swing your weapon.",
    position: "center-bottom",
  },
  {
    id: "jump",
    icon: "🦘",
    title: "Jump & Climb",
    detail: "Alt  to jump ·  ↑  to climb ladders.",
    position: "center-bottom",
  },
  {
    id: "inventory",
    icon: "🎒",
    title: "Inventory",
    detail: "Press  I  to open your inventory.",
    position: "center-bottom",
  },
  {
    id: "talk",
    icon: "💬",
    title: "Talk to NPCs",
    detail: "Press  Enter  near an NPC to start a conversation.",
    position: "center-bottom",
  },
  {
    id: "firstObjective",
    icon: "🎯",
    title: "Your First Quest",
    detail: "Talk to Guide Iris — she's nearby with a ⚡ over her head!",
    position: "center-bottom",
  },
  {
    id: "equip",
    icon: "🗡️",
    title: "Equip Your Weapon!",
    detail: "Press  I  to open inventory, then right-click a weapon to equip it.",
    position: "center-bottom",
  },
];

// ─── Scene ─────────────────────────────────────────────────────────────────────

/**
 * CoachMarks — the driver for the contextual onboarding hints shown the first
 * time a new character encounters each basic action. Runs in parallel with
 * MapScene. The hint pill itself is rendered by the React overlay
 * (`ui/CoachMarks.tsx`); this scene owns all the *logic*.
 *
 * Triggered via scene-registry flags set by MapScene/UIScene:
 *   `coachmark:firstObjective` | `coachmark:move` | `coachmark:attack` | `coachmark:jump` | `coachmark:inventory` | `coachmark:talk`
 *
 * Each flag is a one-shot: CoachMarks reads it, clears it, publishes the hint
 * (if not already seen), and auto-dismisses after 5 s or on any keypress/click.
 * The React pill is `pointer-events-none`, so any key/canvas click still reaches
 * these Phaser input listeners — preserving the original dismissal behavior.
 */
export class CoachMarksScene extends Phaser.Scene {
  private charId = "";
  private seen!: Set<string>;
  /** Currently displayed mark id — null when idle. */
  private activeMarkId: CoachMarkId | null = null;
  private dismissTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super("coachmarks");
  }

  create(): void {
    const cid = getCharId();
    if (cid) {
      this.charId = cid;
      this.seen = getSeenCoachMarks(cid);
    } else {
      this.seen = new Set();
    }

    // Listen for dismiss input (any key or click).
    this.input.keyboard?.on("keydown", this.dismiss, this);
    this.input.on("pointerdown", this.dismiss, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
  }

  override update(): void {
    if (this.activeMarkId) return; // already showing one
    const triggers: CoachMarkId[] = [
      "firstObjective",
      "move",
      "attack",
      "jump",
      "inventory",
      "talk",
      "equip",
    ];
    for (const id of triggers) {
      const flag = this.registry.get(`coachmark:${id}`);
      if (flag === true) {
        this.registry.set(`coachmark:${id}`, false);
        if (!this.seen.has(id)) {
          this.showCoachMark(id);
        }
        return; // one at a time
      }
    }
  }

  // ── Show / dismiss ─────────────────────────────────────────────────────────

  private showCoachMark(id: CoachMarkId): void {
    const def = COACH_MARKS.find((c) => c.id === id);
    if (!def) return;

    this.activeMarkId = id;
    uiStore.getState().setCoachMark({
      id: def.id,
      icon: def.icon,
      title: def.title,
      detail: def.detail,
      position: def.position,
    });

    // Auto-dismiss after 5 seconds.
    this.dismissTimer = this.time.delayedCall(5000, () => this.dismiss());
  }

  private dismiss(): void {
    if (!this.activeMarkId) return;

    const markId = this.activeMarkId;
    this.activeMarkId = null;
    if (this.dismissTimer) {
      this.dismissTimer.destroy();
      this.dismissTimer = undefined;
    }

    uiStore.getState().setCoachMark(null);

    if (markId && this.charId) {
      this.seen.add(markId);
      markCoachMarkSeen(this.charId, markId);
    }
  }

  private teardown(): void {
    if (this.dismissTimer) {
      this.dismissTimer.destroy();
      this.dismissTimer = undefined;
    }
    this.input.keyboard?.off("keydown", this.dismiss, this);
    this.input.off("pointerdown", this.dismiss, this);
    this.activeMarkId = null;
    uiStore.getState().setCoachMark(null);
  }
}
