/**
 * SpawnManager — zone-aware mob respawn controller.
 *
 * Tracks which mob instances belong to which MobSpawnZone, enforces per-zone
 * capacity caps, and schedules staggered respawns with per-mob-type timers:
 *   - Normal mobs:  DEFAULT_RESPAWN_MS  (10 s)
 *   - Field bosses: BOSS_RESPAWN_MS    (120 s)
 *   - Dungeon bosses: DUNGEON_BOSS_RESPAWN_MS (300 s)
 *
 * All spawns write directly to the authoritative Colyseus TownState, which
 * automatically broadcasts delta-synced updates to connected clients.
 */

import type { MobSpawnZone, Foothold, GameMap } from "@maple/shared";
import { getMobDef, groundYAt, rollEliteChance, createEliteMob } from "@maple/shared";
import { Mob } from "./rooms/schema/Mob";
import { TownState } from "./rooms/schema/TownState";

// ─── Timing constants ──────────────────────────────────────────────────────

/** Respawn delay for normal (non-boss) mobs. */
export const DEFAULT_RESPAWN_MS = 10_000;

/** Respawn delay for field bosses (open-world). */
export const BOSS_RESPAWN_MS = 120_000;

/** Respawn delay for dungeon bosses. */
export const DUNGEON_BOSS_RESPAWN_MS = 300_000;

/** Maximum random jitter applied on top of the base delay for staggering. */
export const RESPAWN_JITTER_MS = 3_000;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ZoneData {
  /** Index in the map.spawns array. */
  readonly index: number;
  /** Original zone definition from the map. */
  readonly zone: MobSpawnZone;
  /** Room-level mob instance IDs belonging to this zone. */
  readonly mobIds: string[];
  /** Number of currently alive mobs in this zone. */
  aliveCount: number;
}

interface PendingRespawn {
  /** Zone index to respawn into. */
  readonly zoneIndex: number;
  /** Remaining delay in ms. */
  delayMs: number;
}

// ─── SpawnManager ──────────────────────────────────────────────────────────

export class SpawnManager {
  private readonly zones: ZoneData[];
  private pending: PendingRespawn[] = [];
  private readonly mobToZone = new Map<string, number>();

  /** IDs of mobs removed from state during death cleanup (for test visibility). */
  readonly removedMobIds: string[] = [];

  constructor(
    private readonly state: TownState,
    private readonly map: GameMap,
    private readonly nextId: () => number,
    /** Optional hook called after a mob spawns (e.g. for boss encounter logic). */
    private readonly onSpawn?: (mobId: string, zone: ZoneData) => void,
    /** Optional hook called when a mob dies. */
    private readonly onDeath?: (mobId: string, zone: ZoneData) => void,
    /**
     * Source of randomness in the unit interval [0, 1), used for respawn
     * jitter. Injectable so tests can make respawn timing deterministic
     * (e.g. pass `() => 0` to remove jitter). Defaults to `Math.random`.
     */
    private readonly random: () => number = Math.random,
  ) {
    this.zones = map.spawns.map((zone, i) => ({
      index: i,
      zone,
      mobIds: [] as string[],
      aliveCount: 0,
    }));
  }

  // ── Public API ────────────────────────────────────────────

  /** Spawn all initial mobs across every zone. */
  spawnAll(): void {
    for (const zd of this.zones) {
      this.spawnZoneMobs(zd);
    }
  }

  /** Notify the manager that a mob has died. Schedules a respawn. */
  onMobDeath(mobId: string): void {
    const zoneIndex = this.mobToZone.get(mobId);
    if (zoneIndex === undefined) return;

    const zd = this.zones[zoneIndex];
    zd.aliveCount = Math.max(0, zd.aliveCount - 1);

    const mob = this.state.mobs.get(mobId);
    if (!mob) return;

    const baseDelay = this.getRespawnDelay(mob.mobId);
    const jitter = this.random() * RESPAWN_JITTER_MS;

    this.pending.push({
      zoneIndex,
      delayMs: baseDelay + jitter,
    });

    this.onDeath?.(mobId, zd);
  }

  /**
   * Remove a dead mob from the authoritative state and its zone tracking.
   * Called after death effects (drops, exp) are resolved.
   */
  removeDeadMob(mobId: string): void {
    this.state.mobs.delete(mobId);
    const zoneIndex = this.mobToZone.get(mobId);
    if (zoneIndex !== undefined) {
      const zd = this.zones[zoneIndex];
      const idx = zd.mobIds.indexOf(mobId);
      if (idx !== -1) zd.mobIds.splice(idx, 1);
      this.mobToZone.delete(mobId);
      this.removedMobIds.push(mobId);
    }
  }

  /** Each tick: decrement pending respawn timers and spawn when ready. */
  tick(dt: number): void {
    const ready: PendingRespawn[] = [];
    this.pending = this.pending.filter((p) => {
      p.delayMs -= dt;
      if (p.delayMs <= 0) {
        ready.push(p);
        return false;
      }
      return true;
    });

    for (const p of ready) {
      const zd = this.zones[p.zoneIndex];
      // Zone capacity check — skip if full.
      if (zd.aliveCount >= zd.zone.count) continue;

      const fh = this.map.footholds.find((f) => f.id === zd.zone.footholdId);
      if (!fh) continue;

      const minX = Math.min(fh.x1, fh.x2);
      const maxX = Math.max(fh.x1, fh.x2);
      const x = minX + Math.random() * (maxX - minX);
      this.spawnSingleMob(zd, clamp(x, minX, maxX), fh);
    }
  }

  /** Look up which zone a mob belongs to. */
  getZoneForMob(mobId: string): ZoneData | undefined {
    const idx = this.mobToZone.get(mobId);
    return idx !== undefined ? this.zones[idx] : undefined;
  }

  /** Get the number of pending respawns queued for a zone. */
  pendingCount(zoneIndex: number): number {
    return this.pending.filter((p) => p.zoneIndex === zoneIndex).length;
  }

  /** Read-only access to zone data. */
  getZones(): readonly ZoneData[] {
    return this.zones;
  }

  /** Check whether a zone is at capacity (alive === max). */
  zoneFull(zoneIndex: number): boolean {
    const zd = this.zones[zoneIndex];
    return zd.aliveCount >= zd.zone.count;
  }

  // ── Private ───────────────────────────────────────────────

  /** Determine respawn delay based on mob type. */
  getRespawnDelay(mobId: string): number {
    const def = getMobDef(mobId);
    if (def?.isBoss) {
      // Dungeon bosses: detected by map id patterns for known dungeon maps.
      const id = this.map.id;
      if (id.includes("ruins") || id.includes("icecave") || id.includes("dungeon")) {
        return DUNGEON_BOSS_RESPAWN_MS;
      }
      return BOSS_RESPAWN_MS;
    }
    return DEFAULT_RESPAWN_MS;
  }

  /** Spawn all mobs for a zone (used at room creation). */
  private spawnZoneMobs(zd: ZoneData): void {
    const fh = this.map.footholds.find((f) => f.id === zd.zone.footholdId);
    if (!fh) return;

    const minX = Math.min(fh.x1, fh.x2);
    const maxX = Math.max(fh.x1, fh.x2);

    for (let i = 0; i < zd.zone.count; i++) {
      const t = zd.zone.count === 1 ? 0.5 : i / (zd.zone.count - 1);
      const x = minX + t * (maxX - minX) + (Math.random() - 0.5) * 30;
      this.spawnSingleMob(zd, clamp(x, minX, maxX), fh);
    }
  }

  /** Create a single mob instance and register it in the zone + state. */
  private spawnSingleMob(zd: ZoneData, x: number, foothold: Foothold): void {
    const baseDef = getMobDef(zd.zone.mobId);
    if (!baseDef) return;

    const isElite = !baseDef.isBoss && rollEliteChance();
    const def = isElite ? createEliteMob(baseDef) : baseDef;

    const mob = new Mob();
    mob.mobId = zd.zone.mobId;
    mob.maxHp = def.maxHp;
    mob.hp = def.maxHp;
    mob.isElite = isElite;
    mob.x = x;
    mob.y = groundYAt(foothold, x);
    mob.spawnX = x;
    mob.footholdId = foothold.id;
    mob.grounded = true;
    mob.wanderTimer = Math.random() * 1500;
    mob.aiState = "idle";
    // Data-driven AI tuning from MobDef (replaces hardcoded uniform values).
    mob.aggroRange = def.aggroRange ?? 200;
    mob.attackRange =
      def.attackRange ??
      (def.behavior === "ranged"
        ? 200
        : def.behavior === "caster"
          ? 180
          : def.behavior === "exploder"
            ? 30
            : 50);
    mob.deaggroRange = def.deaggroRange ?? 280;

    const id = `mob_${this.nextId()}`;
    mob.instanceId = id;
    this.state.mobs.set(id, mob);
    zd.mobIds.push(id);
    this.mobToZone.set(id, zd.index);
    zd.aliveCount++;

    this.onSpawn?.(id, zd);
  }
}

// ── Utility ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
