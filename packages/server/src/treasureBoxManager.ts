/**
 * TreasureBoxManager — periodic treasure box spawning for combat maps.
 *
 * Every TREASURE_SPAWN_INTERVAL_MS, a destructible treasure box appears at a random
 * foothold position. Players attack it like a mob (melee/ranged/magic). When its
 * HP reaches 0, the attacker receives bonus EXP + mesos (and possibly an item drop).
 * The box despawns after TREASURE_LIFETIME_MS if not destroyed.
 */

import type { GameMap, Foothold } from "@maple/shared";
import {
  MessageType,
  TREASURE_SPAWN_INTERVAL_MS,
  TREASURE_LIFETIME_MS,
  TREASURE_BOX_HP,
  groundYAt,
} from "@maple/shared";

import type { Player } from "./rooms/schema/Player";
import type { TownState } from "./rooms/schema/TownState";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum EXP awarded when a box is destroyed. */
const BOX_MIN_EXP = 100;
/** Maximum EXP awarded when a box is destroyed. */
const BOX_MAX_EXP = 300;
/** Minimum mesos awarded when a box is destroyed. */
const BOX_MIN_MESOS = 500;
/** Maximum mesos awarded when a box is destroyed. */
const BOX_MAX_MESOS = 2000;
/** Horizontal attack range to hit the box. */
const BOX_ATTACK_RANGE = 80;
/** Vertical attack range to hit the box. */
const BOX_ATTACK_VERT = 60;

// ─── Active Box State ───────────────────────────────────────────────────────

interface ActiveBox {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  spawnTimeMs: number;
}

// ─── TreasureBoxManager ─────────────────────────────────────────────────────

export class TreasureBoxManager {
  private activeBox: ActiveBox | undefined;
  private nextSpawnMs: number;
  private idCounter = 0;

  constructor(
    private readonly state: TownState,
    private readonly map: GameMap,
    private readonly broadcast: (type: number, payload: unknown) => void,
    /** Monotonic id source (shared with the room). */
    private readonly nextId: () => number,
    /** Callback to spawn loot drops when a box is destroyed. */
    private readonly onLootSpawn: (itemId: string, x: number, y: number) => void,
    /** Callback to grant EXP to a player (wraps grantExp). */
    private readonly onExpGrant: (player: Player, exp: number) => void,
  ) {
    this.nextSpawnMs = TREASURE_SPAWN_INTERVAL_MS;
  }

  /** Each fixed tick: decrement spawn timer, despawn expired boxes. */
  tick(dt: number): void {
    // Despawn expired box.
    if (this.activeBox) {
      const age = Date.now() - this.activeBox.spawnTimeMs;
      if (age >= TREASURE_LIFETIME_MS) {
        this.despawn();
      }
    }

    // Spawn timer.
    this.nextSpawnMs -= dt;
    if (this.nextSpawnMs <= 0 && !this.activeBox) {
      this.spawn();
      this.nextSpawnMs = TREASURE_SPAWN_INTERVAL_MS;
    }
  }

  /**
   * Attempt to damage the treasure box with a player's attack.
   * Returns true if the box was hit (caller should skip normal mob targeting).
   */
  onAttack(player: Player): boolean {
    if (!this.activeBox) return false;

    const dx = Math.abs(player.x - this.activeBox.x);
    const dy = Math.abs(player.y - this.activeBox.y);
    if (dx > BOX_ATTACK_RANGE || dy > BOX_ATTACK_VERT) return false;

    const dmg = 50 + Math.floor(Math.random() * 50); // 50–99 per hit
    this.activeBox.hp -= dmg;

    // Broadcast hit (so client shows damage).
    this.broadcast(MessageType.TREASURE_HIT, {
      boxId: this.activeBox.id,
      damage: dmg,
      hp: Math.max(0, this.activeBox.hp),
      maxHp: this.activeBox.maxHp,
    });

    if (this.activeBox.hp <= 0) {
      this.destroyBox(player);
    }

    return true;
  }

  /** Get the active box (for external queries). */
  getActiveBox(): ActiveBox | undefined {
    return this.activeBox;
  }

  // ── Private ──────────────────────────────────────────────────

  private spawn(): void {
    const fh = this.pickRandomFoothold();
    if (!fh) return;

    const minX = Math.min(fh.x1, fh.x2);
    const maxX = Math.max(fh.x1, fh.x2);
    const x = minX + Math.random() * (maxX - minX);
    const y = groundYAt(fh, x);

    const boxId = `box_${++this.idCounter}`;
    this.activeBox = {
      id: boxId,
      x,
      y,
      hp: TREASURE_BOX_HP,
      maxHp: TREASURE_BOX_HP,
      spawnTimeMs: Date.now(),
    };

    this.broadcast(MessageType.TREASURE_SPAWN, {
      boxId,
      x,
      y,
      hp: TREASURE_BOX_HP,
      maxHp: TREASURE_BOX_HP,
      lifetimeSec: Math.floor(TREASURE_LIFETIME_MS / 1000),
    });
  }

  private despawn(): void {
    if (!this.activeBox) return;
    const boxId = this.activeBox.id;
    this.activeBox = undefined;
    this.nextSpawnMs = TREASURE_SPAWN_INTERVAL_MS;
    this.broadcast(MessageType.TREASURE_DESPAWN, { boxId });
  }

  private destroyBox(killer: Player): void {
    if (!this.activeBox) return;

    const boxId = this.activeBox.id;
    const { x, y } = this.activeBox;

    // Grant rewards.
    const exp = BOX_MIN_EXP + Math.floor(Math.random() * (BOX_MAX_EXP - BOX_MIN_EXP + 1));
    const mesos = BOX_MIN_MESOS + Math.floor(Math.random() * (BOX_MAX_MESOS - BOX_MIN_MESOS + 1));

    killer.mesos += mesos;
    this.onExpGrant(killer, exp);

    // Random item drop (25% chance).
    if (Math.random() < 0.25) {
      // Drop a random low-tier consumable or equipment piece.
      const possibleItems = [
        "pot.small_hp",
        "pot.small_mp",
        "pot.medium_hp",
        "scroll.weapon_60",
        "scroll armor_60",
      ];
      const itemId = possibleItems[Math.floor(Math.random() * possibleItems.length)];
      if (itemId !== undefined) this.onLootSpawn(itemId, x, y);
    }

    this.broadcast(MessageType.TREASURE_DESTROY, { boxId, exp, mesos });

    this.activeBox = undefined;
    this.nextSpawnMs = TREASURE_SPAWN_INTERVAL_MS;
  }

  /** Pick a random foothold that's wide enough for a box (at least 80px wide). */
  private pickRandomFoothold(): Foothold | undefined {
    const candidates = this.map.footholds.filter((fh) => {
      const width = Math.abs(fh.x2 - fh.x1);
      return width >= 80;
    });
    if (candidates.length === 0) return undefined;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}
