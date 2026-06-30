/**
 * SettingsScene — thin Phaser controller for the React settings overlay.
 *
 * The settings UI is rendered entirely by `src/ui/SettingsPanel.tsx`. This scene
 * no longer draws anything; it is the bridge between Phaser/game systems and the
 * React panel:
 *   • on `create()` it loads auto-pot/macro state from the UI scene, publishes a
 *     plain snapshot into the overlay store, and registers the imperative
 *     `settingsActions` the panel calls.
 *   • keybindings are read/rebound through `../keybindings.ts` (the single source
 *     of truth) — never duplicated here or in React.
 *   • on close it persists everything through the existing mechanism (localStorage
 *     via the keybinding service + server sync via the UI scene).
 *
 * It is still launched/stopped by `UIScene.setupSettingsToggle` (Esc), which owns
 * the `settingsOpen` registry flag.
 */

import Phaser from "phaser";
import { keybindings } from "../keybindings";
import { type ActionId, ALL_ACTION_IDS, type AutoPotConfig, type SkillMacro } from "@maple/shared";
import { getAudioManager } from "../audio/AudioManager";
import { logout } from "../backend";
import { uiStore } from "../ui/store";
import type {
  SettingsSnapshot,
  SettingsActions,
  SettingsToggleKey,
  KeyDisplayMap,
} from "../ui/store/settings";

export class SettingsScene extends Phaser.Scene {
  /** Auto-pot config — loaded from the UI scene on open, synced back on close. */
  private autoPotConfig: AutoPotConfig = {
    hpEnabled: false,
    hpThreshold: 50,
    mpEnabled: false,
    mpThreshold: 50,
    hpPotionId: "pot.large_hp",
    mpPotionId: "pot.large_mp",
  };
  private macros: SkillMacro[] = [];
  private playerArchetype = "WARRIOR";

  constructor() {
    super("settings");
  }

  init(): void {
    this.loadCombatQoLState();
  }

  create(): void {
    this.registerActions();
    this.publish();
    uiStore.getState().setSettingsOpen(true);
  }

  shutdown(): void {
    uiStore.getState().setSettingsOpen(false);
  }

  // ─── Bridge: state in ──────────────────────────────────────────────────────

  /** Load auto-pot + macro state from the UI scene before publishing. */
  private loadCombatQoLState(): void {
    const uiScene = this.scene.get("ui") as unknown as {
      getAutoPotConfig?: () => AutoPotConfig;
      getMacros?: () => SkillMacro[];
    } | null;
    if (uiScene?.getAutoPotConfig) this.autoPotConfig = uiScene.getAutoPotConfig();
    if (uiScene?.getMacros) this.macros = uiScene.getMacros();
    try {
      this.playerArchetype = JSON.parse(localStorage.getItem("charClass") ?? '"WARRIOR"');
    } catch {
      this.playerArchetype = "WARRIOR";
    }
  }

  /** Build + push a plain snapshot of every setting to the overlay store. */
  private publish(): void {
    const s = keybindings.getSettings();
    const keyDisplays = {} as KeyDisplayMap;
    for (const action of ALL_ACTION_IDS) {
      keyDisplays[action] = keybindings.getDisplayKey(action);
    }
    const snapshot: SettingsSnapshot = {
      video: { ...s.video },
      audio: { ...s.audio },
      gameplay: { ...s.gameplay },
      keyDisplays,
      autoPot: { ...this.autoPotConfig },
      macros: this.macros.map((m) => ({ ...m, steps: m.steps.map((st) => ({ ...st })) })),
      archetype: this.playerArchetype,
    };
    uiStore.getState().setSettings(snapshot);
  }

  // ─── Bridge: actions out ───────────────────────────────────────────────────

  private registerActions(): void {
    const actions: SettingsActions = {
      setVolume: (channel, value) => this.onSetVolume(channel, value),
      toggle: (key, value) => this.onToggle(key, value),
      setVideoOption: (key, value) => this.onSetVideoOption(key, value),
      rebind: (action, key) => this.onRebind(action, key),
      resetKey: (action) => {
        keybindings.resetKey(action);
        this.notifyMap(action);
        this.publish();
      },
      resetDefaults: () => {
        const before = ALL_ACTION_IDS.slice();
        keybindings.resetAllKeys();
        for (const action of before) this.notifyMap(action);
        this.publish();
      },
      setAutoPot: (config) => {
        this.autoPotConfig = { ...config };
        this.publish();
      },
      setMacros: (macros) => {
        this.macros = macros.map((m) => ({ ...m, steps: m.steps.map((st) => ({ ...st })) }));
        this.publish();
      },
      logout: () => this.onLogout(),
      close: () => this.close(),
    };
    uiStore.getState().setSettingsActions(actions);
  }

  private onSetVolume(channel: "master" | "bgm" | "sfx", value: number): void {
    const audio = keybindings.getSettings().audio;
    const am = getAudioManager();
    if (channel === "master") {
      keybindings.updateSettings({ audio: { ...audio, masterVolume: value } });
      am.masterVolume = value;
    } else if (channel === "bgm") {
      keybindings.updateSettings({ audio: { ...audio, bgmVolume: value } });
      am.bgmVolume = value;
    } else {
      keybindings.updateSettings({ audio: { ...audio, sfxVolume: value } });
      am.sfxVolume = value;
    }
    this.publish();
  }

  private onToggle(key: SettingsToggleKey, value: boolean): void {
    const s = keybindings.getSettings();
    switch (key) {
      case "video.fullscreen":
        keybindings.updateSettings({ video: { ...s.video, fullscreen: value } });
        if (value) this.scale.startFullscreen();
        else if (this.scale.isFullscreen) this.scale.stopFullscreen();
        break;
      case "video.showDamageNumbers":
        keybindings.updateSettings({ video: { ...s.video, showDamageNumbers: value } });
        break;
      case "video.screenShake":
        keybindings.updateSettings({ video: { ...s.video, screenShake: value } });
        break;
      case "audio.muted":
        keybindings.updateSettings({ audio: { ...s.audio, muted: value } });
        getAudioManager().muted = value;
        break;
      case "gameplay.showNpcPrompts":
        keybindings.updateSettings({ gameplay: { ...s.gameplay, showNpcPrompts: value } });
        break;
      case "gameplay.showMinimapNames":
        keybindings.updateSettings({ gameplay: { ...s.gameplay, showMinimapNames: value } });
        break;
    }
    this.publish();
  }

  private onSetVideoOption(key: "uiScale" | "fpsCap", value: number): void {
    const video = keybindings.getSettings().video;
    if (key === "uiScale") {
      keybindings.updateSettings({ video: { ...video, uiScale: value } });
    } else {
      keybindings.updateSettings({ video: { ...video, fpsCap: value } });
      this.game.loop.targetFps = value > 0 ? value : 9999;
    }
    this.publish();
  }

  private onRebind(action: ActionId, key: string): void {
    // Compute the conflicting action first so its live key is rebound too after
    // the swap that setActionKey performs.
    const conflict = keybindings.getConflict(action, key);
    keybindings.setActionKey(action, key);
    this.notifyMap(action);
    if (conflict) this.notifyMap(conflict);
    this.publish();
  }

  /** Tell MapScene to rebind its live Phaser key reference for an action. */
  private notifyMap(action: ActionId): void {
    const mapScene = this.scene.get("map") as
      | (Phaser.Scene & { rebindAction?: (a: ActionId) => void })
      | undefined;
    if (mapScene && typeof mapScene.rebindAction === "function") {
      mapScene.rebindAction(action);
    }
  }

  // ─── Close ──────────────────────────────────────────────────────────────────

  // ─── Logout ──────────────────────────────────────────────────────────────────

  /**
   * Drop the session token + bound character, leave the live room, and return to
   * the login screen. A full reload is the simplest reliable teardown of every
   * running scene (map + ui + overlays) and guarantees a clean re-auth, after
   * which Boot → Preload → Login shows the login form (no token).
   */
  private onLogout(): void {
    logout();
    const room = this.registry.get("room") as { leave?: () => void } | undefined;
    room?.leave?.();
    window.location.reload();
  }

  private close(): void {
    this.scene.stop();
    this.registry.set("settingsOpen", false);
    const uiScene = this.scene.get("ui") as unknown as {
      sendSettingsToServer?: () => void;
      updateAutoPotConfig?: (c: AutoPotConfig) => void;
      updateMacros?: (m: SkillMacro[]) => void;
    } | null;
    if (uiScene?.sendSettingsToServer) uiScene.sendSettingsToServer();
    if (uiScene?.updateAutoPotConfig) uiScene.updateAutoPotConfig(this.autoPotConfig);
    if (uiScene?.updateMacros) uiScene.updateMacros(this.macros);
  }
}
