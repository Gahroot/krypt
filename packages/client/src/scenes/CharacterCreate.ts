import Phaser from "phaser";
import {
  STARTER_OUTFITS,
  randomizeAppearance,
  type CharacterAppearance,
  type Gender,
} from "@maple/shared";
import { createCharacterRequest } from "../backend";
import { uiStore } from "../ui/store";

// Background fill behind the React overlay (matches the UI palette).
const BG = 0x0c1019;

// ═══════════════════════════════════════════════════════════════════════════════
// CharacterCreateScene — thin controller for the React character-create overlay.
//
// All UI now lives in the React overlay (`ui/CharacterCreatePanel.tsx`). This
// scene owns the authoritative appearance + connection state, pushes plain
// snapshots into the bridge store, and registers the imperative actions React
// calls. On Confirm it creates the character via `POST /characters` and returns
// to the Character Select screen so the player can pick who to play. Back also
// returns to Character Select.
// ═══════════════════════════════════════════════════════════════════════════════

export class CharacterCreateScene extends Phaser.Scene {
  private appearance!: CharacterAppearance;
  private sending = false;

  constructor() {
    super("character_create");
  }

  create(): void {
    this.appearance = randomizeAppearance();
    this.sending = false;
    this.cameras.main.setBackgroundColor(BG);

    this.registerActions();
    this.publish("");
    uiStore.getState().setCharacterCreateOpen(true);

    // Hide the overlay panel when this scene shuts down (Back / Confirm hand-off).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      uiStore.getState().setCharacterCreateOpen(false);
    });
  }

  /** Outfits valid for the given gender (gender-specific + universal). */
  private genderOutfits(gender: Gender): typeof STARTER_OUTFITS {
    return STARTER_OUTFITS.filter((o) => o.gender === gender || o.gender === "U");
  }

  /** Push the current appearance + status into the bridge store. */
  private publish(error: string): void {
    uiStore.getState().setCharacterCreate({
      appearance: this.appearance,
      error,
      sending: this.sending,
    });
  }

  /** Wire the imperative actions the React panel drives the flow through. */
  private registerActions(): void {
    uiStore.getState().setCharacterCreateActions({
      randomize: () => {
        this.appearance = randomizeAppearance();
        this.publish("");
      },
      setField: (field, value) => {
        const next: Record<string, string> = { ...this.appearance, [field]: value };
        // Switching gender may invalidate the current outfit — fall back to the
        // first valid one, mirroring the legacy scene's rule.
        if (field === "gender") {
          const valid = this.genderOutfits(value as Gender);
          const first = valid[0];
          if (first && !valid.some((o) => o.id === next.outfitId)) {
            next.outfitId = first.id;
          }
        }
        this.appearance = next as unknown as CharacterAppearance;
        this.publish("");
      },
      confirm: (name, appearance) => void this.onConfirm(name, appearance),
      back: () => this.onBack(),
    });
  }

  // ─── Confirm → server ──────────────────────────────────────────────────────
  private async onConfirm(name: string, appearance: CharacterAppearance): Promise<void> {
    if (this.sending) return;

    const trimmed = name.trim();
    if (!trimmed) {
      this.publish("Name is required.");
      return;
    }
    if (!/^[a-zA-Z0-9 _-]{2,16}$/.test(trimmed)) {
      this.publish("2\u201316 chars: letters, numbers, space, _ or -");
      return;
    }

    this.sending = true;
    this.publish("Creating\u2026");

    try {
      // Server validates name/uniqueness/slot-cap and binds the new character to
      // the authenticated account (identity from the signed token, not the body).
      await createCharacterRequest(trimmed, appearance);
      uiStore.getState().setCharacterCreateOpen(false);
      // Return to the roster so the player can pick the new character to play.
      this.scene.start("character_select");
    } catch (err) {
      this.sending = false;
      this.publish(err instanceof Error ? err.message : "Could not create character.");
    }
  }

  // ─── Back → Character Select ───────────────────────────────────────────────
  private onBack(): void {
    uiStore.getState().setCharacterCreateOpen(false);
    this.scene.start("character_select");
  }
}
