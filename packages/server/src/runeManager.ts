/**
 * RuneManager — periodic rune spawning + activation for combat maps.
 *
 * Every RUNE_SPAWN_INTERVAL_MS, a rune appears at a random foothold position.
 * Players can activate it by pressing interact nearby (RUNE_INTERACT_RANGE).
 * Activation grants a party-wide buff (EXP / Speed / ATK) for RUNE_BUFF_DURATION_MS.
 * The rune despawns after RUNE_LIFETIME_MS if not activated.
 *
 * Speed and ATK buffs are applied via StatusEffect.secondary (integrated with
 * the existing buff/debuff system). EXP is tracked separately per-player since
 * SecondaryStats has no expBonus field — the MapRoom queries getExpMultiplier()
 * when awarding mob EXP.
 */

import type { GameMap, Foothold, RuneType, SecondaryStats } from "@maple/shared";
import {
  MessageType,
  RUNE_SPAWN_INTERVAL_MS,
  RUNE_LIFETIME_MS,
  RUNE_BUFF_DURATION_MS,
  RUNE_INTERACT_RANGE,
  groundYAt,
} from "@maple/shared";

import type { Player } from "./rooms/schema/Player";
import type { TownState } from "./rooms/schema/TownState";
import { applyEffect } from "@maple/shared";
import type { StatusEffect } from "@maple/shared";

// ─── Constants ──────────────────────────────────────────────────────────────

const RUNE_TYPES: readonly RuneType[] = ["exp", "speed", "atk"];

const RUNE_BUFF_LABELS: Record<RuneType, string> = {
  exp: "EXP Boost",
  speed: "Speed Boost",
  atk: "ATK Boost",
};

/** Speed and ATK runes use the existing StatusEffect.secondary system. */
const RUNE_BUFF_SECONDARY: Record<RuneType, Partial<SecondaryStats> | undefined> = {
  exp: undefined, // EXP is tracked separately — no secondary stat for it
  speed: { speed: 30 },
  atk: { atk: 10 },
};

/** EXP rune multiplier applied to mob kill EXP. */
const RUNE_EXP_MULTIPLIER = 1.5;

// ─── Active Rune State ──────────────────────────────────────────────────────

interface ActiveRune {
  id: string;
  x: number;
  y: number;
  runeType: RuneType;
  spawnTimeMs: number;
}

// ─── RuneManager ────────────────────────────────────────────────────────────

export class RuneManager {
  private activeRune: ActiveRune | undefined;
  private nextSpawnMs: number;
  private idCounter = 0;

  /** Per-player EXP rune buff expiry (epoch-ms). Entries are cleaned up when they expire. */
  private readonly expBuffExpiry = new Map<string, number>();

  constructor(
    private readonly state: TownState,
    private readonly map: GameMap,
    private readonly broadcast: (type: number, payload: unknown) => void,
  ) {
    this.nextSpawnMs = RUNE_SPAWN_INTERVAL_MS;
  }

  /** Each fixed tick: decrement spawn timer, despawn expired runes, clean up expired EXP buffs. */
  tick(dt: number): void {
    // Despawn expired rune.
    if (this.activeRune) {
      const age = Date.now() - this.activeRune.spawnTimeMs;
      if (age >= RUNE_LIFETIME_MS) {
        this.despawn();
      }
    }

    // Spawn timer.
    this.nextSpawnMs -= dt;
    if (this.nextSpawnMs <= 0 && !this.activeRune) {
      this.spawn();
      this.nextSpawnMs = RUNE_SPAWN_INTERVAL_MS;
    }

    // Clean up expired EXP buffs.
    const now = Date.now();
    for (const [sid, expiry] of this.expBuffExpiry) {
      if (now >= expiry) this.expBuffExpiry.delete(sid);
    }
  }

  /**
   * Attempt to activate the rune for a player.
   * Returns true if the activation succeeded (player was in range).
   */
  activate(sessionId: string, player: Player): boolean {
    if (!this.activeRune) return false;

    const dx = Math.abs(player.x - this.activeRune.x);
    const dy = Math.abs(player.y - this.activeRune.y);
    if (dx > RUNE_INTERACT_RANGE || dy > RUNE_INTERACT_RANGE) return false;

    const runeType = this.activeRune.runeType;
    const runeId = this.activeRune.id;

    // Apply buff to ALL players in the room.
    this.applyRuneBuff(runeType);

    // Broadcast activation effect.
    this.broadcast(MessageType.RUNE_ACTIVATE, {
      runeId,
      buffName: RUNE_BUFF_LABELS[runeType],
      durationSec: Math.floor(RUNE_BUFF_DURATION_MS / 1000),
    });

    this.activeRune = undefined;
    this.nextSpawnMs = RUNE_SPAWN_INTERVAL_MS;
    return true;
  }

  /** Get the active rune (for external queries). */
  getActiveRune(): ActiveRune | undefined {
    return this.activeRune;
  }

  /**
   * Returns the EXP multiplier for a player (1.5 if they have an active EXP rune buff, else 1).
   * Called by MapRoom.killMob before awarding EXP.
   */
  getExpMultiplier(sessionId: string): number {
    const expiry = this.expBuffExpiry.get(sessionId);
    if (expiry !== undefined && Date.now() < expiry) return RUNE_EXP_MULTIPLIER;
    return 1;
  }

  // ── Private ──────────────────────────────────────────────────

  private spawn(): void {
    const fh = this.pickRandomFoothold();
    if (!fh) return;

    const minX = Math.min(fh.x1, fh.x2);
    const maxX = Math.max(fh.x1, fh.x2);
    const x = minX + Math.random() * (maxX - minX);
    const y = groundYAt(fh, x);
    const runeType = RUNE_TYPES[Math.floor(Math.random() * RUNE_TYPES.length)];
    if (runeType === undefined) return;

    const runeId = `rune_${++this.idCounter}`;
    this.activeRune = { id: runeId, x, y, runeType, spawnTimeMs: Date.now() };

    this.broadcast(MessageType.RUNE_SPAWN, {
      runeId,
      x,
      y,
      runeType,
      lifetimeSec: Math.floor(RUNE_LIFETIME_MS / 1000),
    });
  }

  private despawn(): void {
    if (!this.activeRune) return;
    const runeId = this.activeRune.id;
    this.activeRune = undefined;
    this.nextSpawnMs = RUNE_SPAWN_INTERVAL_MS;

    this.broadcast(MessageType.RUNE_DESPAWN, { runeId });
  }

  /** Apply the rune buff to every player in the room. */
  private applyRuneBuff(runeType: RuneType): void {
    const buffId = `rune_${runeType}`;
    const secondary = RUNE_BUFF_SECONDARY[runeType];

    for (const [sid, player] of this.state.players.entries()) {
      // Apply StatusEffect-based buff for speed/atk.
      if (secondary) {
        const effect: StatusEffect = {
          id: buffId,
          kind: "buff",
          secondary,
          durationMs: RUNE_BUFF_DURATION_MS,
          stacks: 1,
          source: `rune:${runeType}`,
        };
        player.activeEffects = applyEffect(player.activeEffects, effect);
      }

      // Track EXP buff per-player.
      if (runeType === "exp") {
        this.expBuffExpiry.set(sid, Date.now() + RUNE_BUFF_DURATION_MS);
      }
    }
  }

  /** Pick a random foothold that's wide enough for a rune (at least 100px wide). */
  private pickRandomFoothold(): Foothold | undefined {
    const candidates = this.map.footholds.filter((fh) => {
      const width = Math.abs(fh.x2 - fh.x1);
      return width >= 100;
    });
    if (candidates.length === 0) return undefined;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
