/**
 * AudioManager — real open-licensed audio playback for CryptoMaple.
 *
 * SFX and BGM are pre-rendered audio files (CC0 Kenney packs + CC0/CC-BY
 * OpenGameArt tracks — see `../assets/audio/CREDITS.md`) loaded and mixed by
 * howler.js. BGM loops per-region and crossfades on map change; SFX fire-and-
 * forget for combat / loot / UI feedback.
 *
 * A tiny synthesised blip is kept ONLY as a fallback for when a sound file
 * fails to load — it is never the primary sound source.
 *
 * Volume + mute persist to localStorage and map onto howler's global master
 * (`Howler.volume` / `Howler.mute`) plus per-channel gains.
 */

import { Howl, Howler } from "howler";

// ─── Persisted settings keys ────────────────────────────────────────────────────────────────────

const STORAGE = {
  master: "cryptomaple.audio.master",
  bgm: "cryptomaple.audio.bgm",
  sfx: "cryptomaple.audio.sfx",
  muted: "cryptomaple.audio.muted",
} as const;

function loadNum(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function loadBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
}

// ─── BGM / SFX key types ───────────────────────────────────────────────────────────────────────

/** Distinct music themes per region family. Each maps to a file in `assets/audio/bgm`. */
export const BGM_KEYS = [
  "town",
  "field",
  "forest",
  "dungeon",
  "cave",
  "sky",
  "market",
  "boss",
] as const;

/** Short fire-and-forget cues. Each maps to a file in `assets/audio/sfx`. */
export const SFX_KEYS = [
  "swing",
  "hit",
  "crit",
  "death",
  "skill",
  "levelup",
  "pickup",
  "loot_drop",
  "legendary_drop",
  "quest_complete",
  "button_click",
  "portal",
  "advancement",
  "mob_hit_player",
  // ── Per-skill / per-category SFX ────────────────────────────────────
  "skill_slash",
  "skill_arrow",
  "skill_bolt",
  "skill_fireball",
  "skill_beam",
  "skill_buff",
] as const;

export type BgmKey = (typeof BGM_KEYS)[number];
export type SfxKey = (typeof SFX_KEYS)[number];

// ─── Asset URL resolution (Vite) ─────────────────────────────────────────────────────────────────
// Eagerly import every audio file as a hashed, bundled URL, keyed by the path relative to this
// module (mirrors the pattern in `../art/textures.ts`). BGM is loaded lazily per key; the small SFX
// set is preloaded up front.

const SFX_ASSET_URLS = import.meta.glob("../assets/audio/sfx/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const BGM_ASSET_URLS = import.meta.glob("../assets/audio/bgm/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function sfxUrl(key: SfxKey): string | undefined {
  return SFX_ASSET_URLS[`../assets/audio/sfx/${key}.mp3`];
}

function bgmUrl(key: BgmKey): string | undefined {
  return BGM_ASSET_URLS[`../assets/audio/bgm/${key}.mp3`];
}

// ─── AudioManager singleton ─────────────────────────────────────────────────────────────────────

/** Crossfade duration in milliseconds for BGM swaps. */
const XFADE_MS = 1500;

class AudioManagerImpl {
  // Loaded Howl instances.
  private readonly sfx = new Map<SfxKey, Howl>();
  private readonly bgm = new Map<BgmKey, Howl>();
  /** Keys whose file failed to load — playSfx routes these to the synth fallback. */
  private readonly sfxFailed = new Set<SfxKey>();

  // BGM state.
  private currentBgmKey: BgmKey | null = null;
  private currentBgm: Howl | null = null;

  // Lazily-created context for the synth fallback blip (only used on load failure).
  private fallbackCtx: AudioContext | null = null;

  // Settings.
  private _masterVolume: number;
  private _bgmVolume: number;
  private _sfxVolume: number;
  private _muted: boolean;

  constructor() {
    this._masterVolume = loadNum(STORAGE.master, 0.7);
    this._bgmVolume = loadNum(STORAGE.bgm, 0.5);
    this._sfxVolume = loadNum(STORAGE.sfx, 0.6);
    this._muted = loadBool(STORAGE.muted, false);

    this.applyVolumes();
    this.preloadSfx();

    // Resume the audio context on first user interaction (browser autoplay policy).
    // howler auto-unlocks on gesture too, but this guarantees a resume for any
    // sound queued before the first click/keypress.
    const resume = (): void => {
      this.ensureResumed();
      document.removeEventListener("click", resume);
      document.removeEventListener("keydown", resume);
    };
    document.addEventListener("click", resume);
    document.addEventListener("keydown", resume);
  }

  /** Resume howler's AudioContext (needed after a user gesture on modern browsers). */
  ensureResumed(): void {
    const ctx = Howler.ctx;
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  // ─── Volume getters / setters (persisted) ──────────────────────────────────────

  get masterVolume(): number {
    return this._masterVolume;
  }
  set masterVolume(v: number) {
    this._masterVolume = clamp01(v);
    localStorage.setItem(STORAGE.master, String(this._masterVolume));
    this.applyVolumes();
  }

  get bgmVolume(): number {
    return this._bgmVolume;
  }
  set bgmVolume(v: number) {
    this._bgmVolume = clamp01(v);
    localStorage.setItem(STORAGE.bgm, String(this._bgmVolume));
    this.applyVolumes();
  }

  get sfxVolume(): number {
    return this._sfxVolume;
  }
  set sfxVolume(v: number) {
    this._sfxVolume = clamp01(v);
    localStorage.setItem(STORAGE.sfx, String(this._sfxVolume));
    this.applyVolumes();
  }

  get muted(): boolean {
    return this._muted;
  }
  set muted(v: boolean) {
    this._muted = v;
    localStorage.setItem(STORAGE.muted, v ? "1" : "0");
    this.applyVolumes();
  }

  /** Toggle mute and return the new muted state. */
  toggleMute(): boolean {
    this.muted = !this._muted;
    return this._muted;
  }

  // ─── BGM ───────────────────────────────────────────────────────────────────────

  /** Switch to a new BGM track with crossfade. Ignored if the same key is already playing. */
  playBgm(key: BgmKey): void {
    this.ensureResumed();
    if (key === this.currentBgmKey) return;

    const next = this.getBgm(key);
    const prev = this.currentBgm;

    this.currentBgmKey = key;
    this.currentBgm = next;

    // Fade out and stop the previous track.
    if (prev && prev !== next) {
      const fading = prev;
      fading.fade(currentVolume(fading), 0, XFADE_MS);
      // Guard against rapid A→B→A swaps: only stop if this track isn't current
      // again by the time the fade completes (otherwise we'd kill the re-faded-in track).
      fading.once("fade", () => {
        if (this.currentBgm !== fading) fading.stop();
      });
    }

    // Missing / failed file → silence (BGM has no synth fallback by design).
    if (!next) return;

    // Clear any pending fade-out stop handler if we're re-entering a track mid-fade.
    next.off("fade");
    next.volume(0);
    if (!next.playing()) next.play();
    next.fade(0, this._bgmVolume, XFADE_MS);
  }

  /** Fade out and stop the current BGM. */
  stopBgm(): void {
    const cur = this.currentBgm;
    this.currentBgmKey = null;
    this.currentBgm = null;
    if (!cur) return;
    cur.fade(currentVolume(cur), 0, XFADE_MS);
    cur.once("fade", () => {
      if (this.currentBgm !== cur) cur.stop();
    });
  }

  // ─── SFX ───────────────────────────────────────────────────────────────────────

  /** Fire a one-shot sound effect. */
  playSfx(key: SfxKey): void {
    this.ensureResumed();
    const howl = this.sfx.get(key);
    if (howl && !this.sfxFailed.has(key)) {
      const id = howl.play();
      howl.volume(this._sfxVolume, id);
      return;
    }
    this.fallbackBlip();
  }

  // ─── Internal ──────────────────────────────────────────────────────────────────

  /** Build every SFX Howl up front (the whole set is tiny). */
  private preloadSfx(): void {
    for (const key of SFX_KEYS) {
      const url = sfxUrl(key);
      if (!url) {
        this.sfxFailed.add(key);
        continue;
      }
      const howl = new Howl({ src: [url], preload: true, volume: this._sfxVolume });
      howl.on("loaderror", () => this.sfxFailed.add(key));
      this.sfx.set(key, howl);
    }
  }

  /** Get (lazily creating) the BGM Howl for a key, or null if the file is unavailable. */
  private getBgm(key: BgmKey): Howl | null {
    const existing = this.bgm.get(key);
    if (existing) return existing;

    const url = bgmUrl(key);
    if (!url) return null;

    // html5 streaming keeps long music tracks out of fully-decoded memory.
    const howl = new Howl({ src: [url], loop: true, html5: true, preload: true, volume: 0 });
    howl.on("loaderror", () => {
      this.bgm.delete(key);
      if (this.currentBgm === howl) this.currentBgm = null;
    });
    this.bgm.set(key, howl);
    return howl;
  }

  private applyVolumes(): void {
    Howler.volume(this._masterVolume);
    Howler.mute(this._muted);
    // Keep the live BGM track at the current channel volume.
    if (this.currentBgm) this.currentBgm.volume(this._bgmVolume);
  }

  /**
   * Last-resort synthesised blip — only reached when a SFX file failed to load.
   * Deliberately generic (not a per-cue synth); the real audio files are primary.
   */
  private fallbackBlip(): void {
    try {
      if (!this.fallbackCtx) this.fallbackCtx = new AudioContext();
      const ctx = this.fallbackCtx;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(523, now);
      const level = (this._muted ? 0 : this._masterVolume) * this._sfxVolume * 0.15;
      gain.gain.setValueAtTime(level, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {
      /* audio unavailable — fail silently */
    }
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Read a Howl's current group volume (typed helper around howler's overloaded `volume()`). */
function currentVolume(howl: Howl): number {
  const v = howl.volume();
  return typeof v === "number" ? v : 0;
}

// Singleton.
let _instance: AudioManagerImpl | null = null;

/** Get (or create) the global AudioManager singleton. */
export function getAudioManager(): AudioManagerImpl {
  if (!_instance) _instance = new AudioManagerImpl();
  return _instance;
}
