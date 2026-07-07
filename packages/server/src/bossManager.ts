/**
 * BossManager — manages boss encounters per room.
 *
 * Handles: timed field-boss spawns, multi-phase attack loops, summon-adds,
 * HP bar broadcast, and loot ownership for the killing party.
 */

import type { TownState } from "./rooms/schema/TownState";
import type { Mob } from "./rooms/schema/Mob";
import type { Player } from "./rooms/schema/Player";
import type { GameMap, MobDef, BossSpawnZone } from "@maple/shared";
import {
  getMobDef,
  applyEffect,
  skillDebuffToStatusEffects,
  getBossAttackPattern,
} from "@maple/shared";
import type { BossAttackPatternDef } from "@maple/shared";
import { groundYAt } from "@maple/shared";
import { Mob as MobSchema } from "./rooms/schema/Mob";

// ─── Timing constants ──────────────────────────────────────────────────────

/** Minimum ms between boss attack ticks. */
const BOSS_ATTACK_INTERVAL_MS = 1800;
/** Ms without nearby players before the boss resets to full HP (wipe protection). */
const BOSS_WIPE_RESET_MS = 10_000;
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
  /** Ms since the last nearby player was detected; triggers reset at threshold. */
  wipeTimer: number;
}

// ─── BossManager ───────────────────────────────────────────────────────────

export class BossManager {
  private encounters = new Map<string, BossEncounter>();
  /** bossDefId → time accumulated since last spawn attempt (ms). */
  private bossTimers = new Map<string, number>();

  /** Called each tick by MapRoom.fixedTick. */
  tick(
    dt: number,
    state: TownState,
    map: GameMap,
    nextId: () => number,
    onTimedSpawn?: (instanceId: string, bossDefId: string) => void,
  ): void {
    // Check timed boss spawns.
    this.checkTimedSpawns(state, map, nextId, onTimedSpawn);

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
          mob.bossTelegraphX = 0;
          mob.bossTelegraphY = 0;
          mob.bossTelegraphRadius = 0;
          enc.telegraphTimer = 0;
        }
      }

      // Only run boss combat when a player is within encounter range.
      const hasNearbyPlayer = this.hasPlayerNearby(mob, state, 500);

      // Wipe detection: if no players are nearby, accumulate wipe timer.
      // When threshold is reached, reset boss to full HP and phase 0.
      if (!hasNearbyPlayer) {
        enc.wipeTimer += dt;
        if (enc.wipeTimer >= BOSS_WIPE_RESET_MS) {
          // Full reset.
          mob.hp = mob.maxHp;
          mob.dead = false;
          enc.phase = 0;
          mob.bossPhase = 0;
          mob.bossPhaseTransitioned = false;
          enc.attackPatternIndex = 0;
          enc.lastAttackTick = BOSS_ATTACK_INTERVAL_MS;
          enc.telegraphTimer = 0;
          mob.bossTelegraph = "";
          mob.bossTelegraphX = 0;
          mob.bossTelegraphY = 0;
          mob.bossTelegraphRadius = 0;
          // Despawn all adds.
          for (const addId of enc.addInstanceIds) {
            state.mobs.delete(addId);
          }
          enc.addInstanceIds.length = 0;
          enc.damageOwners.clear();
          // Keep wipeTimer at threshold so we don't re-trigger every tick.
          enc.wipeTimer = BOSS_WIPE_RESET_MS;
        }
      } else {
        enc.wipeTimer = 0;
      }

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
    state?: TownState,
  ): void {
    const enc = this.encounters.get(bossInstanceId);
    if (!enc) return;
    enc.damageOwners.add(attackerSessionId);

    // Phase transition on hit (belt-and-suspenders with tick check).
    const hpFraction = hp / maxHp;
    const phaseThreshold = phases[enc.phase];
    if (phaseThreshold !== undefined && hpFraction <= phaseThreshold) {
      enc.phase++;
      const mob = state ? state.mobs.get(bossInstanceId) : undefined;
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
    // Use 1 (not 0) so checkTimedSpawns doesn't re-spawn immediately.
    // 0 = "never spawned, spawn now"; 1 = "start counting toward respawn".
    this.bossTimers.set(enc.bossDefId, 1);
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
      wipeTimer: 0,
    });
  }

  /** True when at least one boss encounter is alive on this map. */
  hasActiveEncounters(): boolean {
    return this.encounters.size > 0;
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
  private checkTimedSpawns(
    state: TownState,
    map: GameMap,
    nextId: () => number,
    onTimedSpawn?: (instanceId: string, bossDefId: string) => void,
  ): void {
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
        this.spawnTimedBoss(zone, state, map, nextId, onTimedSpawn);
        continue;
      }
      if (prev === -1) continue; // already spawned, waiting for respawn

      const elapsed = prev + 16; // ~1 tick
      this.bossTimers.set(zone.mobId, elapsed);

      if (elapsed >= zone.respawnIntervalMs) {
        this.bossTimers.set(zone.mobId, -1); // mark as spawned
        this.spawnTimedBoss(zone, state, map, nextId, onTimedSpawn);
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
    onTimedSpawn?: (instanceId: string, bossDefId: string) => void,
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
    onTimedSpawn?.(instanceId, zone.mobId);
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
    const patternId = allPatterns[enc.attackPatternIndex % unlockedCount] ?? "attack";
    enc.attackPatternIndex++;

    const patternDef = getBossAttackPattern(patternId);
    const patternType = patternDef?.type ?? "simple_melee";

    // Phase-scaled base damage.
    let baseDmg: number;
    if (enc.phase >= 2) {
      baseDmg = Math.floor((def.aoeDamage ?? def.attackDamage ?? 10) * 1.25);
    } else if (enc.phase >= 1) {
      baseDmg = def.aoeDamage ?? def.attackDamage ?? 10;
    } else {
      baseDmg = def.attackDamage ?? 10;
    }
    const dmg = Math.floor(baseDmg * (patternDef?.damageScale ?? 1));
    const telegraphMs = patternDef?.telegraphMs ?? def.telegraphMs ?? TELEGRAPH_MS;

    switch (patternType) {
      case "targeted_slam": {
        // AoE at the nearest living player's position.
        const target = this.findNearestPlayer(state, boss);
        if (!target) return;
        const radius = patternDef?.telegraphRadius ?? 80;

        boss.bossTelegraph = patternId;
        boss.bossTelegraphX = target.player.x;
        boss.bossTelegraphY = target.player.y;
        boss.bossTelegraphRadius = radius;
        enc.telegraphTimer = telegraphMs;

        // Damage all players within the AoE radius centered on the target.
        for (const [, player] of state.players) {
          if (player.dead) continue;
          const dist = Math.hypot(target.player.x - player.x, target.player.y - player.y);
          if (dist < radius) {
            this.applyBossDamage(player, dmg, def, patternDef);
          }
        }
        break;
      }

      case "ground_slam": {
        // Large AoE centered on the boss itself.
        const radius = patternDef?.telegraphRadius ?? 120;

        boss.bossTelegraph = patternId;
        boss.bossTelegraphX = boss.x;
        boss.bossTelegraphY = boss.y;
        boss.bossTelegraphRadius = radius;
        enc.telegraphTimer = telegraphMs;

        for (const [, player] of state.players) {
          if (player.dead) continue;
          const dist = Math.hypot(boss.x - player.x, boss.y - player.y);
          if (dist < radius) {
            this.applyBossDamage(player, dmg, def, patternDef);
          }
        }
        break;
      }

      case "line_attack": {
        // Horizontal rectangle in the direction the boss is facing.
        const length = patternDef?.telegraphLength ?? 250;
        const width = patternDef?.telegraphWidth ?? 60;
        const dir = boss.facing;

        boss.bossTelegraph = patternId;
        boss.bossTelegraphX = boss.x + dir * (length / 2);
        boss.bossTelegraphY = boss.y;
        boss.bossTelegraphRadius = length;
        enc.telegraphTimer = telegraphMs;

        for (const [, player] of state.players) {
          if (player.dead) continue;
          const dx = player.x - boss.x;
          const dy = player.y - boss.y;
          const along = dx * dir;
          const across = Math.abs(dy);
          if (along >= -20 && along <= length && across <= width / 2) {
            this.applyBossDamage(player, dmg, def, patternDef);
          }
        }
        break;
      }

      case "debuff_cloud": {
        // AoE at nearest player + applies debuff.
        const target = this.findNearestPlayer(state, boss);
        if (!target) return;
        const radius = patternDef?.telegraphRadius ?? 80;

        boss.bossTelegraph = patternId;
        boss.bossTelegraphX = target.player.x;
        boss.bossTelegraphY = target.player.y;
        boss.bossTelegraphRadius = radius;
        enc.telegraphTimer = telegraphMs;

        for (const [, player] of state.players) {
          if (player.dead) continue;
          const dist = Math.hypot(target.player.x - player.x, target.player.y - player.y);
          if (dist < radius) {
            this.applyBossDamage(player, dmg, def, patternDef);
          }
        }
        break;
      }

      case "projectile_volley": {
        // Hit up to 3 nearest living players.
        const targets = this.findNearestPlayers(state, boss, 3);
        if (targets.length === 0) return;
        const radius = patternDef?.telegraphRadius ?? 40;

        boss.bossTelegraph = patternId;
        boss.bossTelegraphX = boss.x;
        boss.bossTelegraphY = boss.y;
        boss.bossTelegraphRadius = radius;
        enc.telegraphTimer = telegraphMs;

        for (const entry of targets) {
          const dist = Math.hypot(boss.x - entry.player.x, boss.y - entry.player.y);
          if (dist < 350) {
            this.applyBossDamage(entry.player, dmg, def, patternDef);
          }
        }
        break;
      }

      case "summon_retreat": {
        // Visual indicator only — actual adds spawned by the summon timer.
        boss.bossTelegraph = patternId;
        boss.bossTelegraphX = boss.x;
        boss.bossTelegraphY = boss.y;
        boss.bossTelegraphRadius = patternDef?.telegraphRadius ?? 50;
        enc.telegraphTimer = telegraphMs;
        break;
      }

      case "simple_melee":
      default: {
        // Hit the nearest player in melee range (original behavior).
        const target = this.findNearestPlayer(state, boss);
        if (!target) return;
        const dist = Math.hypot(boss.x - target.player.x, boss.y - target.player.y);
        const radius = patternDef?.telegraphRadius ?? 40;

        boss.bossTelegraph = patternId;
        boss.bossTelegraphX = boss.x;
        boss.bossTelegraphY = boss.y;
        boss.bossTelegraphRadius = radius;
        enc.telegraphTimer = telegraphMs;

        if (dist < 200) {
          this.applyBossDamage(target.player, dmg, def, patternDef);
        }
        break;
      }
    }
  }

  /** Apply boss damage to a player with i-frames, knockback, death check, and debuff. */
  private applyBossDamage(
    player: Player,
    dmg: number,
    bossDef: MobDef,
    patternDef?: BossAttackPatternDef,
  ): void {
    const now = Date.now();
    if (now < player.iframesUntil) return;

    player.hp = Math.max(0, player.hp - dmg);
    player.knockbackVx += dmg * 0.12 * -player.facing;
    player.iframesUntil = now + 600;

    if (player.hp <= 0) {
      player.dead = true;
      player.attacking = false;
      player.respawnTimer = 4000;
    }

    // Apply debuff: pattern-specific first, then boss global.
    const debuff = patternDef?.debuff ?? bossDef.debuffEffect;
    if (debuff) {
      const debuffs = skillDebuffToStatusEffects(bossDef.id, debuff, bossDef.name);
      for (const d of debuffs) {
        player.activeEffects = applyEffect(player.activeEffects, d);
        player.effectElapsed.set(d.id, 0);
      }
    }
  }

  /** Find the nearest living player to the boss. */
  private findNearestPlayer(
    state: TownState,
    boss: Mob,
  ): { sessionId: string; player: Player } | undefined {
    let best: { sessionId: string; player: Player } | undefined;
    let bestDist = Infinity;
    state.players.forEach((player, sessionId) => {
      if (player.dead) return;
      const dist = Math.hypot(boss.x - player.x, boss.y - player.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { sessionId, player };
      }
    });
    return best;
  }

  /** Find the N nearest living players to the boss, sorted by distance. */
  private findNearestPlayers(
    state: TownState,
    boss: Mob,
    count: number,
  ): { sessionId: string; player: Player }[] {
    const entries: { sessionId: string; player: Player; dist: number }[] = [];
    state.players.forEach((player, sessionId) => {
      if (player.dead) return;
      const dist = Math.hypot(boss.x - player.x, boss.y - player.y);
      entries.push({ sessionId, player, dist });
    });
    entries.sort((a, b) => a.dist - b.dist);
    return entries.slice(0, count).map(({ sessionId, player }) => ({ sessionId, player }));
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
