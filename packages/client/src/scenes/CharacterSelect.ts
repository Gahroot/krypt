import Phaser from "phaser";
import { getMap } from "@maple/shared";

import {
  fetchCharacters,
  deleteCharacterRequest,
  setCharId,
  setPlayerName,
  hasSeenIntro,
  type CharacterSummary,
} from "../backend";
import { uiStore } from "../ui/store";
import type { CharacterSelectSnapshot } from "../ui/store";

// Background fill behind the React overlay (matches the UI palette).
const BG = 0x0c1019;

// ═══════════════════════════════════════════════════════════════════════════════
// CharacterSelectScene — thin controller for the React character-select overlay.
//
// Shown after login and before entering the world. It loads the account roster
// from the server's `/characters` endpoint (identity derived from the signed
// session token, so only the player's OWN characters are ever returned), pushes
// a plain snapshot into the bridge store, and registers Enter / Create / Delete
// actions React drives the flow through.
//
//   • Enter  → persist the chosen charId locally, then hand off to the intro
//              cinematic (first play) or straight into the saved map.
//   • Create → hand off to CharacterCreateScene (reuses CharacterCreatePanel),
//              which returns here on success.
//   • Delete → confirmed in the panel, then DELETE /characters/:id + refresh.
// ═══════════════════════════════════════════════════════════════════════════════

export class CharacterSelectScene extends Phaser.Scene {
  private roster: CharacterSummary[] = [];
  private maxSlots = 0;
  private loaded = false;
  private error = "";
  private busy = false;
  private destroyed = false;

  constructor() {
    super("character_select");
  }

  create(): void {
    this.destroyed = false;
    this.loaded = false;
    this.error = "";
    this.busy = false;
    this.roster = [];
    this.cameras.main.setBackgroundColor(BG);

    uiStore.getState().setCharacterSelectActions({
      enter: (charId) => this.onEnter(charId),
      create: () => this.onCreate(),
      remove: (charId) => void this.onRemove(charId),
    });
    this.publish();
    uiStore.getState().setCharacterSelectOpen(true);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    void this.loadRoster();
  }

  /** Fetch the account roster and publish it. */
  private async loadRoster(): Promise<void> {
    try {
      const { characters, max } = await fetchCharacters();
      if (this.destroyed) return;
      this.roster = characters;
      this.maxSlots = max;
      this.error = "";
    } catch (err) {
      if (this.destroyed) return;
      this.roster = [];
      this.error = err instanceof Error ? err.message : "Could not load characters.";
    }
    this.loaded = true;
    this.busy = false;
    this.publish();
  }

  /** Push the current roster + status into the bridge store. */
  private publish(): void {
    const snapshot: CharacterSelectSnapshot = {
      characters: this.roster.map((c) => ({
        charId: c.charId,
        name: c.name,
        className: c.className,
        level: c.level,
        mapName: c.mapName,
      })),
      max: this.maxSlots,
      loaded: this.loaded,
      error: this.error,
      busy: this.busy,
    };
    uiStore.getState().setCharacterSelect(snapshot);
  }

  // ─── Enter → world ──────────────────────────────────────────────────────────
  private onEnter(charId: string): void {
    if (this.busy) return;
    const summary = this.roster.find((c) => c.charId === charId);
    if (!summary) return;

    // Persist the chosen identity; MapScene's connect() reads it on join, and the
    // server re-validates that the charId belongs to the authed account.
    setCharId(charId);
    setPlayerName(summary.name);
    uiStore.getState().setCharacterSelectOpen(false);

    // First play (intro not yet seen) → cinematic, which lands on Dawn Isle.
    // Otherwise resume at the character's last saved map.
    if (!hasSeenIntro(charId)) {
      this.scene.start("intro");
      return;
    }
    const mapId = getMap(summary.mapId) ? summary.mapId : "dawn_isle";
    const mapName = getMap(mapId)?.name ?? "Dawn Isle";
    this.scene.start("map", { mapId, _welcomeBanner: mapName });
  }

  // ─── Create → reuse CharacterCreateScene ────────────────────────────────────
  private onCreate(): void {
    if (this.busy) return;
    uiStore.getState().setCharacterSelectOpen(false);
    this.scene.start("character_create");
  }

  // ─── Delete → REST + refresh ────────────────────────────────────────────────
  private async onRemove(charId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.publish();
    try {
      await deleteCharacterRequest(charId);
      if (this.destroyed) return;
    } catch (err) {
      if (this.destroyed) return;
      this.error = err instanceof Error ? err.message : "Could not delete character.";
      this.busy = false;
      this.publish();
      return;
    }
    // Reload the roster from the server (authoritative source of truth).
    await this.loadRoster();
  }

  private teardown(): void {
    this.destroyed = true;
    uiStore.getState().setCharacterSelectOpen(false);
    uiStore.getState().setCharacterSelectActions(null);
  }
}
