/**
 * BossManager — manages boss encounters per room.
 *
 * Handles: timed field-boss spawns, multi-phase attack loops, summon-adds,
 * HP bar broadcast, and loot ownership for the killing party.
 */

import type { TownState } from "./rooms/schema/TownState";
import type { Mob } from "./rooms/schema/Mob";
import type { GameMap, MobDef, BossSpawnZone } from "@maple/shared";
import { getMobDef } from "@maple/shared";
import { groundYAt } from "@maple/shared";
import { Mob as MobSchema } from "./rooms/schema/Mob";

// ─── Timing constants ──────────────────────────────────────────────────────

/** Minimum ms between boss attack ticks. */
const BOSS_ATTACK_INTERVAL_MS = 1800;
/** Phase 2 attack speed multiplier (reduced cooldown = faster attacks). */
const PHASE2_SPEED_MULT = 0.6;
/** Phase 3 attack speed multiplier (<25% HP — enrage). */
const PHASE3_SPEED_MULT = 0.4;
/** Telegraph warning before AoE attack (ms). */
const TELEGRAPH_MS = 500;
/** Base ms between add summons, scaled by boss level. */
const SUMMON_BASE_INTERVAL_MS = 8000;
/** Max adds alive per boss encounter. */
const MAX_ADDS_PER_ENCOUNTER = 6;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BossEncounter {
  bossInstanceId: string;
  bossDefId: string;
  phase: number;
  lastAttackTick: number;
  attackPatternIndex: number;
  summonCooldown: number;
  addInstanceIds: string[];
  /** Session ids of players who have dealt damage (for loot ownership). */
  damageOwners: Set<string>;
  /** Ms remaining before the synced bossTelegraph field is cleared. */
  telegraphTimer: number;
}

// ─── BossManager ───────────────────────────────────────────────────────────

export class BossManager {
  private encounters = new Map<string, BossEncounter>();
  /** bossDefId → time accumulated since last spawn attempt (ms). */
  private bossTimers = new Map<string, number>();

  /** Called each tick by MapRoom.fixedTick. */
  tick(dt: number, state: TownState, map: GameMap, nextId: () => number): void {
    // Check timed boss spawns.
    this.checkTimedSpawns(state, map, nextId);

    // Tick active encounters.
    for (const [instanceId, enc] of this.encounters) {
      const mob = state.mobs.get(instanceId);
      if (!mob || mob.dead) {
        this.encounters.delete(instanceId);
        continue;
      }

      const def = getMobDef(enc.bossDefId);
      if (!def) continue;

      // Phase transition check.
      const hpFraction = mob.hp / mob.maxHp;
      const phases = def.phases ?? [0.5];
      const phaseThreshold = phases[enc.phase];
      if (phaseThreshold !== undefined && hpFraction <= phaseThreshold) {
        enc.phase++;
        mob.bossPhase = enc.phase;
        mob.bossPhaseTransitioned = false;
      }

      // Telegraph timer countdown — clear synced field when it expires.
      if (enc.telegraphTimer > 0) {
        enc.telegraphTimer -= dt;
        if (enc.telegraphTimer <= 0) {
          mob.bossTelegraph = "";
          enc.telegraphTimer = 0;
        }
      }

      // Only run boss combat when a player is within encounter range.
      const hasNearbyPlayer = this.hasPlayerNearby(mob, state, 500);

      // Attack timer.
      if (hasNearbyPlayer) {
        enc.lastAttackTick -= dt;
        if (enc.lastAttackTick <= 0) {
          const cooldown = def.attackCooldownMs ?? BOSS_ATTACK_INTERVAL_MS;
          const speedMult =
            enc.phase >= 2 ? PHASE3_SPEED_MULT : enc.phase >= 1 ? PHASE2_SPEED_MULT : 1;
          const effectiveCooldown = cooldown * speedMult;
          enc.lastAttackTick = effectiveCooldown;
          this.executeBossAttack(enc, def, state, mob);
        }

        // Summon timer.
        enc.summonCooldown -= dt;
        if (enc.summonCooldown <= 0 && (def.summonAddIds?.length ?? 0) > 0) {
          const summonInterval = SUMMON_BASE_INTERVAL_MS / (def.level / 5);
          enc.summonCooldown = enc.phase > 0 ? summonInterval * 0.5 : summonInterval;
          this.spawnAdds(enc, def, state, map, nextId);
        }
      }
    }

    // Despawn stale adds.
    for (const [instanceId, enc] of this.encounters) {
      const mob = state.mobs.get(instanceId);
      if (!mob || mob.dead) continue;
      for (let i = enc.addInstanceIds.length - 1; i >= 0; i--) {
        const addId = enc.addInstanceIds[i];
        if (addId === undefined) continue;
        const addMob = state.mobs.get(addId);
        if (!addMob || addMob.dead) {
          enc.addInstanceIds.splice(i, 1);
          state.mobs.delete(addId);
        }
      }
    }
  }

  /** Called when a boss mob is hit — track damage owners. */
  onBossHit(
    bossInstanceId: string,
    attackerSessionId: string,
    hp: number,
    maxHp: number,
    phases: readonly number[],
  ): void {
    const enc = this.encounters.get(bossInstanceId);
    if (!enc) return;
    enc.damageOwners.add(attackerSessionId);

    // Phase transition on hit (belt-and-suspenders with tick check).
    const hpFraction = hp / maxHp;
    const phaseThreshold = phases[enc.phase];
    if (phaseThreshold !== undefined && hpFraction <= phaseThreshold) {
      enc.phase++;
      const mob = this.getMobRef(bossInstanceId);
      if (mob) {
        mob.bossPhase = enc.phase;
        mob.bossPhaseTransitioned = false;
      }
    }
  }

  /** Called when a boss dies — returns the set of session ids that get loot. */
  onBossDeath(bossInstanceId: string): Set<string> {
    const enc = this.encounters.get(bossInstanceId);
    if (!enc) return new Set();
    const owners = new Set(enc.damageOwners);
    // Reset the spawn timer so the boss can respawn after the interval.
    this.bossTimers.set(enc.bossDefId, 0);
    // Despawn all living adds.
    this.encounters.delete(bossInstanceId);
    return owners;
  }

  /** Register an encounter when a boss mob spawns. */
  registerEncounter(instanceId: string, bossDefId: string): void {
    this.encounters.set(instanceId, {
      bossInstanceId: instanceId,
      bossDefId,
      phase: 0,
      lastAttackTick: BOSS_ATTACK_INTERVAL_MS,
      attackPatternIndex: 0,
      summonCooldown: SUMMON_BASE_INTERVAL_MS,
      addInstanceIds: [],
      damageOwners: new Set(),
      telegraphTimer: 0,
    });
  }

  /** Check if a boss instance is being tracked. */
  isBoss(instanceId: string): boolean {
    return this.encounters.has(instanceId);
  }

  /** Get encounter data for external use (e.g. HP broadcast). */
  getEncounter(instanceId: string): BossEncounter | undefined {
    return this.encounters.get(instanceId);
  }

  /** Check timed spawns and create new bosses if the timer has elapsed. */
  private checkTimedSpawns(state: TownState, map: GameMap, nextId: () => number): void {
    const bossSpawns = map.bossSpawns ?? [];
    for (const zone of bossSpawns) {
      if (!zone.respawnIntervalMs) continue; // skip item-summoned bosses
      const def = getMobDef(zone.mobId);
      if (!def) continue;

      // Check if boss is already alive in the room.
      const alreadyAlive = this.isBossAliveInRoom(state, zone.mobId);
      if (alreadyAlive) continue;

      // Accumulate timer. First spawn is immediate (timer starts at 0).
      const prev = this.bossTimers.get(zone.mobId) ?? 0;
      if (prev === 0) {
        // First check — spawn immediately.
        this.bossTimers.set(zone.mobId, -1); // mark as spawned
        this.spawnTimedBoss(zone, state, map, nextId);
        continue;
      }
      if (prev === -1) continue; // already spawned, waiting for respawn

      const elapsed = prev + 16; // ~1 tick
      this.bossTimers.set(zone.mobId, elapsed);

      if (elapsed >= zone.respawnIntervalMs) {
        this.bossTimers.set(zone.mobId, -1); // mark as spawned
        this.spawnTimedBoss(zone, state, map, nextId);
      }
    }
  }

  /** Summon a boss from an item use. Returns the instance id, or null on failure. */
  summonBoss(
    bossDefId: string,
    state: TownState,
    map: GameMap,
    x: number,
    y: number,
    footholdId: number,
    nextId: () => number,
  ): string | null {
    const def = getMobDef(bossDefId);
    if (!def || !def.isBoss) return null;

    // Check if already alive.
    if (this.isBossAliveInRoom(state, bossDefId)) return null;

    const fh = map.footholds.find((f) => f.id === footholdId);
    if (!fh) return null;

    const instanceId = `boss_${nextId()}`;
    const mob = this.createBossMob(def, instanceId, x, y, fh);
    state.mobs.set(instanceId, mob);
    this.registerEncounter(instanceId, bossDefId);
    return instanceId;
  }

  /** Get encounter loot owners. Used by MapRoom for loot distribution. */
  getLootOwners(bossInstanceId: string): Set<string> {
    return this.encounters.get(bossInstanceId)?.damageOwners ?? new Set();
  }

  // ─── Private helpers ─────────────────────────────────────────────

  private isBossAliveInRoom(state: TownState, bossDefId: string): boolean {
    for (const mob of state.mobs.values()) {
      if (mob.mobId === bossDefId && !mob.dead) return true;
    }
    return false;
  }

  private spawnTimedBoss(
    zone: BossSpawnZone,
    state: TownState,
    map: GameMap,
    nextId: () => number,
  ): void {
    const def = getMobDef(zone.mobId);
    if (!def) return;

    const fh = map.footholds.find((f) => f.id === zone.footholdId);
    if (!fh) return;

    const minX = Math.min(fh.x1, fh.x2);
    const maxX = Math.max(fh.x1, fh.x2);
    const x = minX + Math.random() * (maxX - minX);
    const y = groundYAt(fh, x);

    const instanceId = `boss_${nextId()}`;
    const mob = this.createBossMob(def, instanceId, x, y, fh);
    state.mobs.set(instanceId, mob);
    this.registerEncounter(instanceId, zone.mobId);
  }

  private createBossMob(
    def: MobDef,
    instanceId: string,
    x: number,
    y: number,
    fh: { id: number },
  ): Mob {
    const mob = new MobSchema();
    mob.mobId = def.id;
    mob.maxHp = def.maxHp;
    mob.hp = def.maxHp;
    mob.x = x;
    mob.y = y;
    mob.spawnX = x;
    mob.footholdId = fh.id;
    mob.grounded = true;
    mob.instanceId = instanceId;
    mob.aiState = "idle";
    mob.aggroRange = 250;
    mob.attackRange = 80;
    mob.deaggroRange = 350;
    mob.bossPhase = 0;
    mob.bossPhaseTransitioned = false;
    mob.bossPatternTimer = 0;
    mob.bossSummonTimer = SUMMON_BASE_INTERVAL_MS;
    return mob;
  }

  private executeBossAttack(enc: BossEncounter, def: MobDef, state: TownState, boss: Mob): void {
    const allPatterns = def.attackPatternIds ?? ["attack"];
    // Unlock new patterns progressively: phase 0 → first 2, phase 1 → first 3, phase 2 → all.
    const unlockedCount = Math.min(allPatterns.length, 2 + enc.phase);
    const pattern = allPatterns[enc.attackPatternIndex % unlockedCount] ?? "attack";
    enc.attackPatternIndex++;

    // Find nearest player for targeted attack.
    let nearestSessionId = "";
    let nearestDist = Infinity;

    state.players.forEach((player, sessionId) => {
      if (player.dead) return;
      const dist = Math.hypot(boss.x - player.x, boss.y - player.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestSessionId = sessionId;
      }
    });

    // Telegraph warning before AoE attacks.
    const isAoe = pattern.includes("slam") || pattern.includes("roar") || pattern.includes("cloud");
    if (isAoe && nearestSessionId) {
      // Sync the telegraph pattern name so the client can render a ground indicator.
      boss.bossTelegraph = pattern;
      enc.telegraphTimer = TELEGRAPH_MS;
    }

    // Damage the nearest player if in range.
    if (nearestSessionId && nearestDist < 200) {
      // Phase-scaled damage: base → aoeDamage → aoeDamage ×1.25 enrage.
      let dmg: number;
      if (enc.phase >= 2) {
        dmg = Math.floor((def.aoeDamage ?? def.attackDamage ?? 10) * 1.25);
      } else if (enc.phase >= 1) {
        dmg = def.aoeDamage ?? def.attackDamage ?? 10;
      } else {
        dmg = def.attackDamage ?? 10;
      }
      const target = state.players.get(nearestSessionId);
      if (target && !target.dead) {
        // I-frame check: ignore damage during the invulnerability window.
        const now = Date.now();
        if (now >= target.iframesUntil) {
          target.hp = Math.max(0, target.hp - dmg);
          // Knockback the player backward (opposite their facing).
          target.knockbackVx += dmg * 0.12 * -target.facing;
          // Grant i-frames after boss damage.
          target.iframesUntil = now + 600;
        }
        if (target.hp <= 0) {
          target.dead = true;
          target.attacking = false;
          target.respawnTimer = 4000;
        }
      }
    }
  }

  private spawnAdds(
    enc: BossEncounter,
    def: MobDef,
    state: TownState,
    map: GameMap,
    nextId: () => number,
  ): void {
    if (enc.addInstanceIds.length >= MAX_ADDS_PER_ENCOUNTER) return;
    if (!def.summonAddIds || def.summonAddIds.length === 0) return;

    const boss = state.mobs.get(enc.bossInstanceId);
    if (!boss || boss.dead) return;

    const addCount = enc.phase > 0 ? 2 : 1;
    for (let i = 0; i < addCount && enc.addInstanceIds.length < MAX_ADDS_PER_ENCOUNTER; i++) {
      const addDefId = def.summonAddIds[Math.floor(Math.random() * def.summonAddIds.length)];
      if (addDefId === undefined) continue;
      const addDef = getMobDef(addDefId);
      if (!addDef) continue;

      const addX = boss.x + (Math.random() - 0.5) * 80;
      const fh = map.footholds.find((f) => f.id === boss.footholdId);
      if (!fh) continue;

      const addId = `add_${nextId()}`;
      const addMob = new MobSchema();
      addMob.mobId = addDefId;
      addMob.maxHp = addDef.maxHp;
      addMob.hp = addDef.maxHp;
      addMob.x = addX;
      addMob.y = boss.y;
      addMob.spawnX = addX;
      addMob.footholdId = fh.id;
      addMob.grounded = true;
      addMob.instanceId = addId;
      addMob.aiState = "chase";
      addMob.targetSessionId = enc.damageOwners.values().next().value ?? "";
      addMob.aggroRange = 200;
      addMob.attackRange = 50;
      addMob.deaggroRange = 280;

      state.mobs.set(addId, addMob);
      enc.addInstanceIds.push(addId);
    }
  }

  private getMobRef(_instanceId: string): Mob | undefined {
    // We don't have direct state access here, but the mob ref is stable in Colyseus.
    // The MapRoom will sync bossPhase via its own tick.
    return undefined;
  }

  /** Check if any alive player is within range of the boss. */
  private hasPlayerNearby(boss: Mob, state: TownState, range: number): boolean {
    for (const player of state.players.values()) {
      if (player.dead) continue;
      const dist = Math.hypot(boss.x - player.x, boss.y - player.y);
      if (dist <= range) return true;
    }
    return false;
  }
}
