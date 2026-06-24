/**
 * TownRoom — Meadowfield, the pastoral starter zone.
 *
 * Authoritative simulation built on the verified Colyseus pattern (tutorial-phaser Part4Room):
 *   - fixed timestep (1000/60) via setSimulationInterval
 *   - clients push *inputs* to a per-player queue; the server owns all movement, combat, and loot
 *   - the client can never move or mint authoritatively — it only predicts and reconciles
 *
 * Movement is 4-directional (top-down field), matching the verified Part4 pattern. Combat, mob AI,
 * loot rolls, mesos, exp/leveling and death/respawn are all resolved here, server-side.
 *
 * Loot odds come from @maple/shared (public + unit-tested) — the off-chain rehearsal of the on-chain
 * "provably fair" claim. A Legendary pickup records a `legendaryMintPending` entry for the future
 * chain step; no chain call is made yet (Phase 2).
 */
import { Room, Client } from "colyseus";
import {
  ClassArchetype,
  type PrimaryStat,
  getClass,
  maxHpForLevel,
  maxMpForLevel,
  autoAssign,
  attackPower,
  AP_PER_LEVEL,
  SP_PER_LEVEL,
  getMobDef,
  rollMesos,
  rollItemDrops,
  rollPotential,
  isMintWorthy,
  lineCountForTier,
  STARTER_MOB_ID,
} from "@maple/shared";

import { TownState } from "./schema/TownState";
import { Player } from "./schema/Player";
import { Mob } from "./schema/Mob";
import { LootDrop } from "./schema/LootDrop";
import { InventoryItem } from "./schema/InventoryItem";
import { type InputData, MessageType } from "../types";

// ─── Tunables ────────────────────────────────────────────────────────────────
const MAP_WIDTH = 1600;
const MAP_HEIGHT = 600;
const GROUND_Y = MAP_HEIGHT - 70;
const PLAYER_SPEED = 2.4; // px per fixed tick

const MOB_CAP = 6;
const WANDER_RADIUS = 140; // px a mob strays from its spawn
const MOB_RESPAWN_MS = 3000;

const ATTACK_RANGE = 70; // px in front of the player
const ATTACK_VERT = 52; // px vertical tolerance
const ATTACK_COOLDOWN_MS = 450;
const ATTACK_DURATION_MS = 250;

const MOB_CONTACT_DAMAGE = 4;
const MOB_CONTACT_COOLDOWN_MS = 900;
const MOB_CONTACT_RANGE = 40;
const PLAYER_RESPAWN_MS = 4000;

const PICKUP_RANGE = 60;
const LOOT_DESPAWN_MS = 30_000;

interface PendingMint {
  session: string;
  itemUid: string;
  defId: string;
  tier: string;
}

export class TownRoom extends Room {
  state = new TownState();
  fixedTimeStep = 1000 / 60;
  maxClients = 50;

  /** Monotonic id source for mobs / loot / items in this room. */
  private idCounter = 0;

  /**
   * Legendary pickups queued for on-chain minting (Phase 2). The authoritative server is the only
   * thing that can append here — proof that the client never mints gear. No chain call yet.
   */
  private pendingMints: PendingMint[] = [];

  messages = {
    [MessageType.INPUT]: (client: Client, input: InputData) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.inputQueue.push(input);
    },

    [MessageType.PICKUP]: (client: Client, msg: { uid: string }) => {
      this.handlePickup(client, msg);
    },
  };

  onCreate(): void {
    this.state.mapWidth = MAP_WIDTH;
    this.state.mapHeight = MAP_HEIGHT;
    this.spawnInitialMobs();

    let elapsed = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsed += deltaTime;
      while (elapsed >= this.fixedTimeStep) {
        elapsed -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });

    console.log("[town] Meadowfield room created");
  }

  // ─── Main loop ──────────────────────────────────────────────────────────────
  fixedTick(timeStep: number): void {
    this.state.players.forEach((player) => {
      this.processPlayerInput(player);
      this.tickPlayerTimers(player, timeStep);
    });

    this.state.mobs.forEach((mob) => this.tickMob(mob, timeStep));

    // Snapshot loot values so despawn deletions don't mutate the map mid-iteration.
    for (const drop of Array.from(this.state.loot.values())) {
      drop.despawnTimer -= timeStep;
      if (drop.despawnTimer <= 0) this.state.loot.delete(drop.uid);
    }
  }

  private processPlayerInput(player: Player): void {
    let input: InputData | undefined;
    while ((input = player.inputQueue.shift())) {
      player.tick = input.tick;
      if (player.dead) continue;

      if (input.left) {
        player.x -= PLAYER_SPEED;
        player.facing = -1;
      } else if (input.right) {
        player.x += PLAYER_SPEED;
        player.facing = 1;
      }
      if (input.up) player.y -= PLAYER_SPEED;
      else if (input.down) player.y += PLAYER_SPEED;

      player.x = clamp(player.x, 0, this.state.mapWidth);
      player.y = clamp(player.y, 0, this.state.mapHeight);

      if (input.attack && player.attackCooldown <= 0) {
        this.tryAttack(player);
      }
    }
  }

  private tickPlayerTimers(player: Player, dt: number): void {
    if (player.attackCooldown > 0) player.attackCooldown -= dt;
    if (player.attackTimer > 0) {
      player.attackTimer -= dt;
      if (player.attackTimer <= 0) player.attacking = false;
    }
    if (player.dead) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0) this.respawnPlayer(player);
    }
  }

  // ─── Combat ───────────────────────────────────────────────────────────────
  private tryAttack(attacker: Player): void {
    attacker.attacking = true;
    attacker.attackTimer = ATTACK_DURATION_MS;
    attacker.attackCooldown = ATTACK_COOLDOWN_MS;

    const dmg = this.playerDamage(attacker);
    this.state.mobs.forEach((mob) => {
      if (mob.dead || !this.inMeleeArc(attacker, mob)) return;
      mob.hp -= dmg;
      mob.hit = true;
      mob.hitTimer = 120;
      if (mob.hp <= 0) this.killMob(mob, attacker);
    });
  }

  private inMeleeArc(player: Player, mob: Mob): boolean {
    const dx = mob.x - player.x;
    const dy = Math.abs(mob.y - player.y);
    if (dy > ATTACK_VERT || Math.abs(dx) > ATTACK_RANGE) return false;
    // mob must be in front of the player (small overlap tolerance)
    return player.facing === 1 ? dx >= -10 : dx <= 10;
  }

  private playerDamage(player: Player): number {
    const primary = this.playerPrimary(player);
    const power = attackPower(
      { STR: player.str, DEX: player.dex, INT: player.intel, LUK: player.luk, HP: player.hp, MP: player.mp },
      primary,
    );
    // ±20% spread so numbers feel alive.
    return Math.max(1, Math.round(power * (0.9 + Math.random() * 0.4)));
  }

  private playerPrimary(player: Player): PrimaryStat {
    return getClass(player.archetype as ClassArchetype).primaryStat;
  }

  private killMob(mob: Mob, killer: Player): void {
    mob.dead = true;
    mob.hp = 0;
    mob.hit = false;
    mob.respawnTimer = MOB_RESPAWN_MS;

    const def = getMobDef(mob.mobId);
    if (!def) return;

    // Reward the killer: mesos + exp (both server-authoritative).
    killer.mesos += rollMesos(def);
    killer.exp += def.exp;
    this.applyLeveling(killer);

    // Roll item drops → each rolls a Potential tier from the public, tested table.
    for (const itemId of rollItemDrops(def)) {
      this.spawnLoot(itemId, rollPotential(), mob.x, mob.y);
    }
  }

  private applyLeveling(player: Player): void {
    const archetype = player.archetype as ClassArchetype;
    let need = expToNext(player.level);
    while (player.exp >= need && player.level < 250) {
      player.exp -= need;
      player.level += 1;
      player.maxHp = maxHpForLevel(archetype, player.level);
      player.hp = player.maxHp;
      player.maxMp = maxMpForLevel(archetype, player.level);
      player.mp = player.maxMp;
      player.ap += AP_PER_LEVEL;
      player.sp += SP_PER_LEVEL;
      need = expToNext(player.level);
    }
  }

  private damagePlayer(player: Player, dmg: number): void {
    if (player.dead) return;
    player.hp -= dmg;
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      player.attacking = false;
      player.respawnTimer = PLAYER_RESPAWN_MS;
    }
  }

  private respawnPlayer(player: Player): void {
    player.dead = false;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    player.x = 120 + Math.random() * 200;
    player.y = GROUND_Y;
  }

  // ─── Loot ─────────────────────────────────────────────────────────────────
  private spawnLoot(defId: string, tier: ReturnType<typeof rollPotential>, x: number, y: number): void {
    const uid = `loot_${++this.idCounter}`;
    const drop = new LootDrop();
    drop.uid = uid;
    drop.defId = defId;
    drop.potentialTier = tier;
    drop.lines = lineCountForTier(tier);
    drop.x = x + (Math.random() - 0.5) * 24;
    drop.y = y;
    drop.legendary = isMintWorthy(tier);
    drop.despawnTimer = LOOT_DESPAWN_MS;
    this.state.loot.set(uid, drop);

    if (drop.legendary) {
      console.log(`[town] ✨ LEGENDARY drop: ${defId} (${tier})`);
    }
  }

  private handlePickup(client: Client, msg: { uid: string }): void {
    const player = this.state.players.get(client.sessionId);
    const drop = msg && this.state.loot.get(msg.uid);
    if (!player || !drop || player.dead) return;

    const dist = Math.hypot(drop.x - player.x, drop.y - player.y);
    if (dist > PICKUP_RANGE) return;

    const item = new InventoryItem();
    item.uid = `item_${++this.idCounter}`;
    item.defId = drop.defId;
    item.potentialTier = drop.potentialTier;
    item.lines = drop.lines;
    item.baseRank = "NORMAL";
    player.inventory.set(item.uid, item);

    if (drop.legendary) {
      // Record for Phase 2: only the authoritative server can append a mint authorization.
      this.pendingMints.push({
        session: client.sessionId,
        itemUid: item.uid,
        defId: item.defId,
        tier: drop.potentialTier,
      });
      console.log(
        `[town] legendaryMintPending: ${item.uid} (${item.defId}) for ${client.sessionId} → Phase 2 chain mint`,
      );
    }

    this.state.loot.delete(drop.uid);
  }

  // ─── Mobs ─────────────────────────────────────────────────────────────────
  private spawnInitialMobs(): void {
    for (let i = 0; i < MOB_CAP; i++) {
      this.spawnMob(STARTER_MOB_ID, 300 + i * 200);
    }
  }

  private spawnMob(mobId: string, x: number): void {
    const def = getMobDef(mobId);
    if (!def) return;
    const mob = new Mob();
    mob.mobId = mobId;
    mob.maxHp = def.maxHp;
    mob.hp = def.maxHp;
    mob.x = x;
    mob.y = GROUND_Y;
    mob.spawnX = x;
    mob.wanderTimer = Math.random() * 1500;
    this.state.mobs.set(`mob_${++this.idCounter}`, mob);
  }

  private tickMob(mob: Mob, dt: number): void {
    if (mob.hitTimer > 0) {
      mob.hitTimer -= dt;
      if (mob.hitTimer <= 0) mob.hit = false;
    }
    if (mob.contactCooldown > 0) mob.contactCooldown -= dt;

    if (mob.dead) {
      mob.respawnTimer -= dt;
      if (mob.respawnTimer <= 0) this.reviveMob(mob);
      return;
    }

    const def = getMobDef(mob.mobId);
    if (!def) return;

    // Wander AI: occasionally pick a direction, pace around spawn.
    mob.wanderTimer -= dt;
    if (mob.wanderTimer <= 0) {
      mob.wanderDir = [-1, 0, 0, 1][Math.floor(Math.random() * 4)];
      mob.wanderTimer = 800 + Math.random() * 1600;
      if (mob.wanderDir !== 0) mob.facing = mob.wanderDir;
    }
    if (mob.wanderDir !== 0) {
      mob.x += mob.wanderDir * def.speed;
      if (mob.x < mob.spawnX - WANDER_RADIUS || mob.x > mob.spawnX + WANDER_RADIUS) {
        mob.wanderDir *= -1;
        mob.facing = mob.wanderDir;
      }
      mob.x = clamp(mob.x, 0, this.state.mapWidth);
    }

    // Contact damage to overlapping players (on a cooldown).
    if (mob.contactCooldown <= 0) {
      this.state.players.forEach((player) => {
        if (player.dead) return;
        if (Math.hypot(mob.x - player.x, mob.y - player.y) <= MOB_CONTACT_RANGE) {
          this.damagePlayer(player, MOB_CONTACT_DAMAGE);
          mob.contactCooldown = MOB_CONTACT_COOLDOWN_MS;
        }
      });
    }
  }

  private reviveMob(mob: Mob): void {
    const def = getMobDef(mob.mobId);
    mob.dead = false;
    mob.hp = def ? def.maxHp : mob.maxHp;
    mob.x = mob.spawnX;
    mob.hit = false;
    mob.wanderDir = 0;
    mob.wanderTimer = Math.random() * 1500;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────
  onJoin(client: Client, options: { name?: string } = {}): void {
    const archetype = ClassArchetype.WARRIOR;
    const def = getClass(archetype);
    const level = 1;
    const stats = autoAssign(level, def.primaryStat);

    const player = new Player();
    player.name = (options.name || "Adventurer").slice(0, 16);
    player.archetype = archetype;
    player.level = level;
    player.maxHp = maxHpForLevel(archetype, level);
    player.hp = player.maxHp;
    player.maxMp = maxMpForLevel(archetype, level);
    player.mp = player.maxMp;
    player.str = stats.STR;
    player.dex = stats.DEX;
    player.intel = stats.INT;
    player.luk = stats.LUK;
    player.x = 120 + Math.random() * 200;
    player.y = GROUND_Y;

    this.state.players.set(client.sessionId, player);
    console.log("[town] join", client.sessionId, player.name);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    console.log("[town] leave", client.sessionId);
  }

  onDispose(): void {
    console.log("[town] Meadowfield room disposed");
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Simple, transparent exp curve for the slice. */
function expToNext(level: number): number {
  return Math.floor(15 * Math.pow(level, 1.5)) + 10;
}
