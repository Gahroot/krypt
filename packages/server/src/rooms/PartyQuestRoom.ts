/**
 * PartyQuestRoom — instanced party quest room.
 *
 * Runs a multi-stage group challenge with a shared countdown timer. The room
 * is created dynamically per PQ run (via `colyseus.createRoom("pq", { pqId })`).
 *
 * **Server-authoritative design:**
 *   - Mobs are spawned server-side from the PQ stage definitions.
 *   - Combat damage is computed server-side (reuse MapRoom patterns).
 *   - Stage progress increments only from real server-validated kills/pickups.
 *   - Clients send inputs (movement + attack) but the server owns all state.
 *   - The old client-reported `PQ_CONTRIBUTE` amount path is removed.
 *
 * Lifecycle:
 *   1. Leader creates the room → `onCreate` loads the PQ def.
 *   2. Party members join → `onJoin` populates `PQState.players`.
 *   3. When enough players join (≥ minPlayers) → countdown → `status = "active"`.
 *   4. Each tick: countdown decrements, mob AI runs, objectives are evaluated.
 *   5. When all stages clear → `status = "success"`, rewards granted.
 *   6. On timeout or all players leave → `status = "failed"`, players returned.
 */
import { Client } from "colyseus";
import { AuthedRoom } from "./AuthedRoom";
import {
  ClassArchetype,
  type PartyQuestDef,
  type KillCountObjective,
  type CollectObjective,
  type ReachPortalObjective,
  type SolveObjective,
  type MobDef,
  type InputData,
  getPartyQuest,
  createPQStageProgress,
  randomizeAppearance,
  getClass,
  autoAssign,
  maxHpForLevel,
  maxMpForLevel,
  resolveAttackType,
  getMobDef,
  computeDamage,
  resolveEquippedBonus,
  computeSetBonuses,
  getItemDef,
  type AttackerCombatStats,
  type DefenderCombatStats,
  type PotentialLine,
  type BonusStatLine,
  type BaseRank,
} from "@maple/shared";
import { PQState, PQStageProgressSchema } from "./schema/PQState";
import { Mob } from "./schema/Mob";
import { Player } from "./schema/Player";
import { InventoryItem } from "./schema/InventoryItem";
import {
  MessageType,
  type PQContributePayload,
  type PQProgressPayload,
  type PQResultPayload,
  type CombatHitPayload,
} from "../types";
import { accountStore, type CharacterRecord } from "../persistence/store";
import { grantExp } from "../applyExp";
import { track } from "../analytics";
import { AnalyticsEventType } from "../analyticsEvents";
import { RateLimiter, logAnomaly, sanitizeInputData } from "../validate";

// ─── Tunables ──────────────────────────────────────────────────────────────

/** Fixed timestep for the simulation loop (60 fps). */
const FIXED_TIME_STEP = 1000 / 60;

/** How often (in ticks) to broadcast progress to clients (~2 × per second). */
const PROGRESS_BROADCAST_INTERVAL = 30;

/** Delay (ms) after success/fail before the room disposes itself. */
const POST_RESULT_DELAY_MS = 8_000;

// ── Combat constants (mirror MapRoom) ─────────────────────────────────────
const ATTACK_COOLDOWN_MS = 450;
const ATTACK_DURATION_MS = 250;
const ATTACK_RANGE_MELEE = 60;
const ATTACK_VERT_ALL = 80;
const KNOCKBACK_DECAY = 0.85;
const KNOCKBACK_MAX = 12;
const KNOCKBACK_MIN_DMG = 5;

// ── Mob AI constants (mirror MapRoom) ─────────────────────────────────────
const MOB_AI_CHASE_SPEED_MULT = 1.6;
const MOB_AI_VERT_TOLERANCE = 150;
const MOB_AI_DEFAULT_ATTACK_DAMAGE = 5;
const MOB_AI_DEFAULT_ATTACK_COOLDOWN_MS = 1200;
const MOB_MOB_GRAVITY = 0.45;
const MOB_MAX_FALL = 12;

// ── PQ instance geometry ──────────────────────────────────────────────────
/** Width of the PQ instance arena (px). */
const PQ_ARENA_WIDTH = 2400;
/** Height of the PQ instance arena (px). */
const PQ_ARENA_HEIGHT = 800;

/** Simple foothold for the PQ arena — a flat platform across the bottom. */
const PQ_FOOTHOLD = { id: 0, x1: 0, x2: PQ_ARENA_WIDTH, y: PQ_ARENA_HEIGHT - 60 };

/** Portal positions per PQ definition (x, y). */
const PORTAL_POSITIONS: Record<string, { x: number; y: number }> = {
  "portal.throne_room": { x: PQ_ARENA_WIDTH - 100, y: PQ_FOOTHOLD.y },
  pq_enter_stage3: { x: PQ_ARENA_WIDTH - 100, y: PQ_FOOTHOLD.y },
  pq_complete: { x: PQ_ARENA_WIDTH - 100, y: PQ_FOOTHOLD.y },
  "portal.slime_exit": { x: PQ_ARENA_WIDTH - 100, y: PQ_FOOTHOLD.y },
};

/** Proximity threshold (px) for reaching a portal. */
const PORTAL_REACH_RANGE = 80;

/** Proximity threshold (px) for puzzle interaction. */
const PUZZLE_INTERACT_RANGE = 120;

/** Puzzle interaction cooldown (ms) to prevent spam. */
const PUZZLE_COOLDOWN_MS = 2000;

/** Spawn area: mobs spawn between these x coordinates. */
const MOB_SPAWN_X_MIN = 400;
const MOB_SPAWN_X_MAX = PQ_ARENA_WIDTH - 400;

// ─── Room ──────────────────────────────────────────────────────────────────

export class PartyQuestRoom extends AuthedRoom<PQState> {
  state = new PQState();

  /** The PQ definition loaded from the shared catalog. */
  private def!: PartyQuestDef;

  /** Server-side stage progress (mirrors `state.stages` but with kind info). */
  private stageProgress: {
    current: number;
    target: number;
    kind: string;
    completed: boolean;
    /** Extra state per kind (e.g. puzzle solve count, portal reached flag). */
    extra: {
      puzzleSolvedCount?: number;
      portalReached?: boolean;
    };
  }[] = [];

  /** Whether the PQ run has been started (countdown or active). */
  private started = false;

  /** Elapsed ms since the run started (for the countdown). */
  private elapsedMs = 0;

  /** Session → persistent account id. */
  private sessionAccount = new Map<string, string>();

  /** Ticks since last progress broadcast. */
  private ticksSinceBroadcast = 0;

  /** Whether the result has already been sent (to avoid duplicate grants). */
  private resultSent = false;

  /** Rate limiter for input messages: 120/sec per client (burst-friendly for combat). */
  private inputLimiter = new RateLimiter(120, 0.12);

  /** Rate limiter for pickup messages: 20/sec per client. */
  private pickupLimiter = new RateLimiter(20, 0.02);

  /** Rate limiter for puzzle solve messages: 1/sec per client. */
  private puzzleLimiter = new RateLimiter(1, 1.0);

  /** Monotonic id source for mobs + collectibles. */
  private idCounter = 0;

  /** Puzzle interaction cooldowns per session. */
  private puzzleCooldowns = new Map<string, number>();

  // ─── Messages ────────────────────────────────────────────────────────────

  messages = {
    /** Player input (movement + attack) — same as MapRoom. */
    [MessageType.INPUT]: (client: Client, input: InputData) => {
      if (!this.inputLimiter.consume(client.sessionId)) {
        logAnomaly(client.sessionId, "rate_limit", "pq_input");
        return;
      }
      const clean = sanitizeInputData(input);
      if (!clean) {
        logAnomaly(client.sessionId, "malformed", "pq_input");
        return;
      }
      const player = this.state.players.get(client.sessionId);
      if (player) player.inputQueue.push(clean);
    },

    /** Player picks up a collectible item on the ground. */
    [MessageType.PICKUP]: (client: Client, msg: { uid?: string }) => {
      if (!this.pickupLimiter.consume(client.sessionId)) {
        logAnomaly(client.sessionId, "rate_limit", "pq_pickup");
        return;
      }
      const uid = typeof msg?.uid === "string" ? msg.uid.slice(0, 64) : "";
      if (!uid) return;
      this.handlePickup(client, uid);
    },

    /**
     * Puzzle solve signal (neutered PQ_CONTRIBUTE).
     *
     * The `amount` field is **ignored** — progress is server-authoritative.
     * Only used for "solve" objective stages where the client signals a puzzle
     * solution attempt. The server validates proximity + puzzle state.
     */
    [MessageType.PQ_CONTRIBUTE]: (client: Client, msg: PQContributePayload) => {
      this.handlePuzzleSolve(client, msg);
    },
  };

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  onCreate(options: { pqId?: string } = {}): void {
    const pqId = options.pqId ?? "pq.mushroomking";
    const def = getPartyQuest(pqId);
    if (!def) {
      this.roomLog.error("unknown party quest — closing room", { pqId });
      this.disconnect();
      return;
    }

    this.def = def;
    this.state.pqId = def.id;
    this.state.pqName = def.name;
    this.state.totalStages = def.stages.length;
    this.state.timeRemainingMs = def.timeLimitSec * 1000;

    // Initialise stage progress.
    const progressDefs = createPQStageProgress(def);
    for (let i = 0; i < progressDefs.length; i++) {
      const pd = progressDefs[i];
      const schema = new PQStageProgressSchema();
      schema.ordinal = i;
      schema.label = def.stages[i]?.label ?? "";
      schema.objectiveKind = pd.kind;
      schema.current = 0;
      schema.target = pd.target;
      schema.completed = false;
      this.state.stages.push(schema);

      this.stageProgress.push({
        current: pd.current,
        target: pd.target,
        kind: pd.kind,
        completed: false,
        extra: {},
      });
    }

    // Simulation loop.
    let accumulator = 0;
    this.setSimulationInterval((dt) => {
      accumulator += dt;
      while (accumulator >= FIXED_TIME_STEP) {
        accumulator -= FIXED_TIME_STEP;
        this.fixedTick(FIXED_TIME_STEP);
      }
    });

    this.logCreate({ pqId: def.id, pqName: def.name });
  }

  /** Resolve accountId from a session for error/lifecycle log context. */
  protected override accountIdForSession(sessionId: string): string | undefined {
    return this.sessionAccount.get(sessionId);
  }

  onJoin(client: Client, options: { charId?: string } = {}): void {
    // Trusted, server-verified identity from onAuth — never options.accountId.
    const accountId = (client.auth?.accountId ?? client.sessionId).slice(0, 64);
    let character: CharacterRecord | undefined;

    if (options.charId) {
      const requested = accountStore.getCharacter(options.charId);
      // Ownership gate: only load a character that belongs to the authenticated account.
      if (requested && requested.accountId === accountId) character = requested;
    }
    if (!character) {
      const chars = accountStore.listCharacters(accountId);
      character = chars[0];
    }
    if (!character) {
      character = accountStore.createCharacter(accountId, {
        name: "Adventurer",
        archetype: ClassArchetype.BEGINNER,
        appearance: randomizeAppearance(),
      });
    }

    // Validate level range.
    if (this.def.minLevel > 0 && character.level < this.def.minLevel) {
      client.send(MessageType.PQ_RESULT, {
        pqId: this.def.id,
        success: false,
        reason: `Level ${this.def.minLevel} required.`,
      } satisfies PQResultPayload);
      client.leave();
      return;
    }
    if (this.def.maxLevel > 0 && character.level > this.def.maxLevel) {
      client.send(MessageType.PQ_RESULT, {
        pqId: this.def.id,
        success: false,
        reason: `Max level for this PQ is ${this.def.maxLevel}.`,
      } satisfies PQResultPayload);
      client.leave();
      return;
    }

    // Validate player count.
    if (this.state.players.size >= this.def.maxPlayers) {
      client.send(MessageType.PQ_RESULT, {
        pqId: this.def.id,
        success: false,
        reason: "PQ instance is full.",
      } satisfies PQResultPayload);
      client.leave();
      return;
    }

    const archetype = character.archetype as ClassArchetype;
    const classDef = getClass(archetype);
    const stats = autoAssign(character.level, classDef.primaryStat);

    const player = new Player();
    player.accountId = accountId;
    player.charId = character.charId;
    player.name = character.name;
    player.archetype = character.archetype;
    player.level = character.level;
    player.maxHp = maxHpForLevel(archetype, character.level);
    player.hp = character.stats.HP || player.maxHp;
    player.maxMp = maxMpForLevel(archetype, character.level);
    player.mp = character.stats.MP || player.maxMp;
    player.str = character.stats.STR || stats.STR;
    player.dex = character.stats.DEX || stats.DEX;
    player.intel = character.stats.INT || stats.INT;
    player.luk = character.stats.LUK || stats.LUK;
    player.exp = character.exp;
    player.ap = character.ap;
    player.sp = character.sp;
    player.mesos = character.mesos;
    player.x = 400 + this.state.players.size * 60; // stagger spawn
    player.y = PQ_FOOTHOLD.y;
    player.vy = 0;
    player.vx = 0;
    player.grounded = true;

    // Sync appearance.
    const app = character.appearance;
    player.gender = app.gender;
    player.skinId = app.skinId;
    player.hairId = app.hairId;
    player.hairColorId = app.hairColorId;
    player.faceId = app.faceId;
    player.outfitId = app.outfitId;

    // Restore inventory.
    for (const rec of Object.values(character.inventory)) {
      const item = new InventoryItem();
      item.uid = rec.uid;
      item.defId = rec.defId;
      item.baseRank = rec.baseRank;
      item.potentialTier = rec.potentialTier;
      item.lines = rec.lines;
      item.minted = rec.minted;
      item.count = rec.count ?? 1;
      player.inventory.set(item.uid, item);
    }

    // Restore equipped gear.
    if (character.equipped) {
      for (const [slot, uid] of Object.entries(character.equipped)) {
        player.equipped.set(slot, uid);
      }
    }

    // Resolve attack type.
    const invLookup = (uid: string) => player.inventory.get(uid)?.defId;
    const equippedRec = Object.fromEntries(player.equipped.entries());
    player.attackType = resolveAttackType(equippedRec, invLookup, player.archetype);

    this.state.players.set(client.sessionId, player);
    this.sessionAccount.set(client.sessionId, accountId);

    this.logJoin(client, accountId, { charId: player.charId, pqId: this.def.id });

    // Auto-start countdown once enough players have joined.
    if (!this.started && this.state.players.size >= this.def.minPlayers) {
      this.startCountdown();
    }
  }

  onDrop(client: Client): void {
    this.allowReconnection(client, 30);
  }

  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.persistPlayer(player);
    }
    this.logLeave(client, { charId: player?.charId });
    this.state.players.delete(client.sessionId);
    this.sessionAccount.delete(client.sessionId);

    // If no players remain and the PQ is still running → fail.
    if (
      this.state.players.size === 0 &&
      (this.state.status === "active" || this.state.status === "countdown")
    ) {
      this.endRun(false, "All players left.");
    }
  }

  onDispose(): void {
    this.logDispose({ pqName: this.def?.name });
  }

  // ─── Simulation ──────────────────────────────────────────────────────────

  private fixedTick(_dt: number): void {
    if (this.state.status === "active") {
      this.elapsedMs += FIXED_TIME_STEP;
      const remaining = this.def.timeLimitSec * 1000 - this.elapsedMs;
      this.state.timeRemainingMs = Math.max(0, remaining);

      if (remaining <= 0) {
        this.endRun(false, "Time's up!");
        return;
      }

      // ── Attack / animation timer decay (runs every tick, not just on input) ──
      for (const p of this.state.players.values()) {
        if (p.attackCooldown > 0) p.attackCooldown -= FIXED_TIME_STEP;
        if (p.attackTimer > 0) {
          p.attackTimer -= FIXED_TIME_STEP;
          if (p.attackTimer <= 0) p.attacking = false;
        }
      }

      // Process player inputs (movement + attacks).
      for (const player of this.state.players.values()) {
        this.processPlayerInput(player);
      }

      // Tick mob AI.
      for (const mob of this.state.mobs.values()) {
        this.tickMob(mob, FIXED_TIME_STEP);
      }

      // Remove dead mobs after a brief delay (death flash).
      for (const [key, mob] of this.state.mobs.entries()) {
        if (mob.dead) {
          mob.hitTimer -= FIXED_TIME_STEP;
          if (mob.hitTimer <= 0) {
            this.state.mobs.delete(key);
          }
        }
      }

      // Check reach-portal objectives each tick.
      this.checkReachPortal();
    }

    // Broadcast progress periodically.
    if (++this.ticksSinceBroadcast >= PROGRESS_BROADCAST_INTERVAL) {
      this.ticksSinceBroadcast = 0;
      this.broadcastProgress();
    }
  }

  // ─── Player input processing (simplified from MapRoom) ───────────────────

  private processPlayerInput(player: Player): void {
    let input: InputData | undefined;
    let latest: InputData | undefined;
    while ((input = player.inputQueue.shift())) {
      player.tick = input.tick;
      latest = input;
      if (player.dead) continue;
      // Attacks are disabled while dead.
      if (input.attack && player.attackCooldown <= 0) {
        this.tryAttack(player);
      }
    }
    if (!latest || player.dead) return;

    // ── Horizontal velocity ──
    const maxSpeed = 2.4;
    const accel = 1.2;
    const friction = 0.5;

    if (latest.left) {
      player.vx = Math.max(-maxSpeed, player.vx - accel);
      player.facing = -1;
    } else if (latest.right) {
      player.vx = Math.min(maxSpeed, player.vx + accel);
      player.facing = 1;
    } else {
      if (player.vx > 0) player.vx = Math.max(0, player.vx - friction);
      else if (player.vx < 0) player.vx = Math.min(0, player.vx + friction);
    }

    // ── Jump ──
    if (latest.jump && player.grounded && !latest.down) {
      player.vy = -8.5;
      player.grounded = false;
    }

    // ── Integrate X ──
    player.x += player.vx;
    player.x = Math.max(0, Math.min(PQ_ARENA_WIDTH, player.x));

    // ── Gravity ──
    if (!player.grounded) {
      player.vy = Math.min(player.vy + 0.45, 12);
      player.y += player.vy;
    }

    // ── Ground snap ──
    const groundY = PQ_FOOTHOLD.y;
    if (player.y >= groundY) {
      player.y = groundY;
      player.vy = 0;
      player.grounded = true;
    }

    // ── Dead player respawn ──
    if (player.dead) {
      player.respawnTimer -= FIXED_TIME_STEP;
      if (player.respawnTimer <= 0) {
        player.dead = false;
        player.hp = player.maxHp;
        player.x = 400;
        player.y = PQ_FOOTHOLD.y;
        player.grounded = true;
      }
    }
  }

  // ─── Combat ───────────────────────────────────────────────────────────────

  private tryAttack(attacker: Player): void {
    attacker.attacking = true;
    attacker.attackTimer = ATTACK_DURATION_MS;
    attacker.attackCooldown = ATTACK_COOLDOWN_MS;

    const attackerStats = this.buildAttackerStats(attacker);
    const attackerSession = this.findSessionByPlayer(attacker);

    for (const mob of this.state.mobs.values()) {
      if (mob.dead) continue;
      if (!this.inMeleeArc(attacker, mob)) continue;

      const mobDef = getMobDef(mob.mobId);
      const defender: DefenderCombatStats = {
        wDef: mobDef?.wDef ?? 0,
        mDef: mobDef?.mDef ?? 0,
        avoid: mobDef?.avoid ?? 0,
        level: mobDef?.level ?? 1,
      };
      const result = computeDamage(attackerStats, defender);

      if (result.hit && result.total > 0) {
        mob.hp -= result.total;
        mob.hit = true;
        mob.hitTimer = 120;

        // Knockback.
        if (result.total >= KNOCKBACK_MIN_DMG) {
          const kb = Math.min(KNOCKBACK_MAX, Math.max(1, result.total * 0.15));
          mob.knockbackVx += kb * attacker.facing;
          mob.knockbackTimer = 300;
        }

        if (mob.hp <= 0) this.killMob(mob, attacker);
      }

      // Broadcast combat hit for floating numbers.
      this.broadcast(MessageType.COMBAT_HIT, {
        targetKey: mob.instanceId,
        attackerSession,
        damage: result.total,
        crit: result.crit,
        hit: result.hit,
        mobHp: Math.max(0, mob.hp),
        mobMaxHp: mob.maxHp,
      } satisfies CombatHitPayload);
    }
  }

  private buildAttackerStats(player: Player): AttackerCombatStats {
    const primary = getClass(player.archetype as ClassArchetype).primaryStat;
    const equippedRec = Object.fromEntries(player.equipped.entries());
    const bonus = resolveEquippedBonus(
      equippedRec,
      (uid) => {
        const item = player.inventory.get(uid);
        return item ? getItemDef(item.defId) : undefined;
      },
      (uid) => {
        const item = player.inventory.get(uid);
        return (item?.baseRank ?? "NORMAL") as BaseRank;
      },
      (uid) => {
        const item = player.inventory.get(uid);
        if (!item?.potentialLines) return [];
        try {
          return JSON.parse(item.potentialLines) as PotentialLine[];
        } catch {
          return [];
        }
      },
      (uid) => {
        const item = player.inventory.get(uid);
        if (!item?.bonusStats) return [];
        try {
          const parsed = JSON.parse(item.bonusStats) as BonusStatLine[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
    );

    const equippedDefIds = Object.values(equippedRec)
      .map((uid) => {
        const item = player.inventory.get(uid);
        return item ? getItemDef(item.defId)?.id : undefined;
      })
      .filter((id): id is string => id !== undefined);
    const setBonus = computeSetBonuses(equippedDefIds);

    // Compute effective stats (player base + equip + set bonuses).
    const str = player.str + bonus.str + setBonus.STR;
    const dex = player.dex + bonus.dex + setBonus.DEX;
    const intel = player.intel + bonus.int + setBonus.INT;
    const luk = player.luk + bonus.luk + setBonus.LUK;
    const atkBonus = bonus.atk + setBonus.atk;
    const mAtkBonus = setBonus.mAtk;

    // ATK formula: weight primary stat heavily, secondary stats less.
    // Mirrors deriveSecondary's PHYS_ATK_WEIGHTS / MGL_ATK_WEIGHTS inline.
    const physAtkWeights: Record<string, readonly [number, number, number]> = {
      STR: [0.9, 0.3, 0.1],
      DEX: [0.2, 0.9, 0.2],
      INT: [0.1, 0.1, 0.1],
      LUK: [0.1, 0.2, 0.9],
    };
    const mglAtkWeights: Record<string, readonly [number, number]> = {
      STR: [0.2, 0.05],
      DEX: [0.2, 0.05],
      INT: [1.0, 0.3],
      LUK: [0.3, 0.2],
    };
    const pw = physAtkWeights[primary] ?? [0.5, 0.3, 0.1];
    const mw = mglAtkWeights[primary] ?? [0.2, 0.1];
    const atk = Math.floor(str * pw[0] + dex * pw[1] + luk * pw[2]) + atkBonus;
    const mAtk = Math.floor(intel * mw[0] + luk * mw[1]) + mAtkBonus;
    const accuracy = Math.floor(str * 0.1 + dex * 0.5 + intel * 0.2 + luk * 0.3);

    return {
      atk: Math.max(1, atk),
      mAtk: Math.max(0, mAtk),
      primaryStat: Math.max(1, atk),
      skillDamagePercent: 100,
      hitCount: 1,
      accuracy: Math.max(1, accuracy),
      critRate: 0.05,
      level: player.level,
    };
  }

  private inMeleeArc(player: Player, mob: Mob): boolean {
    const dx = mob.x - player.x;
    const dy = Math.abs(mob.y - player.y);
    if (dy > ATTACK_VERT_ALL || Math.abs(dx) > ATTACK_RANGE_MELEE) return false;
    return player.facing === 1 ? dx >= -10 : dx <= 10;
  }

  private killMob(mob: Mob, _killer: Player): void {
    if (mob.dead) return;
    mob.dead = true;
    mob.hp = 0;
    mob.hitTimer = 300; // brief death flash before removal

    const stageIdx = this.state.activeStage;
    const progress = this.stageProgress[stageIdx];
    const schema = this.state.stages[stageIdx];
    if (!progress || progress.completed || !schema) return;

    const objective = this.def.stages[stageIdx]?.objective;
    if (!objective) return;

    // Progress based on the current stage objective.
    if (objective.kind === "kill-count") {
      const killObj = objective as KillCountObjective;
      if (mob.mobId === killObj.mobId) {
        this.incrementStageProgress(stageIdx, 1);
      }
    } else if (objective.kind === "collect") {
      const collectObj = objective as CollectObjective;
      // For collect stages, killing the mob counts as collecting.
      if (mob.mobId === this.resolveCollectMobId(collectObj)) {
        this.incrementStageProgress(stageIdx, 1);
      }
    }
  }

  /** For collect stages, resolve which mob drops the collectible. */
  private resolveCollectMobId(obj: CollectObjective): string {
    // Map collect item IDs to their source mobs.
    // In a full implementation, items would have a sourceMob field.
    // For now, use a heuristic: if the current stage's mobs include the item's source, use it.
    const mobDefs = ["mob.green_mushroom", "mob.subway_overseer", "mob.blue_slime"];
    // Find a mob that drops this item in its drop table.
    for (const mobId of mobDefs) {
      const def = getMobDef(mobId);
      if (def?.dropTable.some((d) => d.itemId === obj.itemId)) return mobId;
    }
    // Fallback: any mob in the current stage's kill-count mobs contribute.
    return "";
  }

  // ─── Mob AI (simplified from MapRoom) ─────────────────────────────────────

  private tickMob(mob: Mob, dt: number): void {
    if (mob.dead) return;

    if (mob.hitTimer > 0) {
      mob.hitTimer -= dt;
      if (mob.hitTimer <= 0) mob.hit = false;
    }
    if (mob.knockbackTimer > 0) {
      mob.knockbackTimer -= dt;
      if (mob.knockbackTimer <= 0) {
        mob.knockbackVx = 0;
        mob.knockbackTimer = 0;
      }
    }
    if (mob.attackCooldown > 0) mob.attackCooldown -= dt;

    const def = getMobDef(mob.mobId);
    if (!def) return;

    // ── AI state machine ──
    switch (mob.aiState) {
      case "idle":
      case "wander":
        this.tickMobWander(mob, def, dt);
        break;
      case "chase":
        this.tickMobChase(mob, def, dt);
        break;
      case "attack":
        this.tickMobAttack(mob, def, dt);
        break;
    }

    // Gravity.
    if (!mob.grounded) {
      mob.vy = Math.min(mob.vy + MOB_MOB_GRAVITY, MOB_MAX_FALL);
      mob.y += mob.vy;
    }
    const surfaceY = PQ_FOOTHOLD.y;
    if (mob.y >= surfaceY) {
      mob.y = surfaceY;
      mob.vy = 0;
      mob.grounded = true;
    }

    // Knockback slide.
    if (mob.knockbackVx !== 0) {
      mob.x += mob.knockbackVx;
      mob.x = Math.max(0, Math.min(PQ_ARENA_WIDTH, mob.x));
      mob.knockbackVx *= KNOCKBACK_DECAY;
      if (Math.abs(mob.knockbackVx) < 0.3) mob.knockbackVx = 0;
    }
  }

  private tickMobWander(mob: Mob, def: MobDef, dt: number): void {
    // Scan for aggro targets.
    const target = this.findNearestAlivePlayer(mob);
    if (target) {
      const dx = Math.abs(mob.x - target.player.x);
      const dy = Math.abs(mob.y - target.player.y);
      if (dx <= (mob.aggroRange || 200) && dy <= MOB_AI_VERT_TOLERANCE) {
        mob.aiState = "chase";
        mob.targetSessionId = target.sessionId;
        mob.facing = target.player.x >= mob.x ? 1 : -1;
        return;
      }
    }

    // Wander pacing.
    mob.wanderTimer -= dt;
    if (mob.wanderTimer <= 0) {
      mob.wanderDir = ([-1, 0, 0, 1] as const)[Math.floor(Math.random() * 4)];
      mob.wanderTimer = 800 + Math.random() * 1600;
      if (mob.wanderDir !== 0) mob.facing = mob.wanderDir;
    }
    if (mob.wanderDir !== 0) {
      mob.x += mob.wanderDir * def.speed;
      if (mob.x <= MOB_SPAWN_X_MIN || mob.x >= MOB_SPAWN_X_MAX) {
        mob.x = Math.max(MOB_SPAWN_X_MIN, Math.min(MOB_SPAWN_X_MAX, mob.x));
        mob.wanderDir *= -1;
        mob.facing = mob.wanderDir;
      }
    }
  }

  private tickMobChase(mob: Mob, def: MobDef, _dt: number): void {
    const target = mob.targetSessionId ? this.state.players.get(mob.targetSessionId) : undefined;

    if (!target || target.dead) {
      mob.aiState = "idle";
      mob.targetSessionId = "";
      return;
    }

    const dx = target.x - mob.x;
    const dy = target.y - mob.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx > (mob.deaggroRange || 280) || absDy > MOB_AI_VERT_TOLERANCE) {
      mob.aiState = "idle";
      mob.targetSessionId = "";
      return;
    }

    mob.facing = dx >= 0 ? 1 : -1;

    const attackRange = mob.attackRange || 50;
    if (absDx <= attackRange && absDy <= MOB_AI_VERT_TOLERANCE) {
      mob.aiState = "attack";
      mob.wanderDir = 0;
      return;
    }

    const chaseSpeed = def.speed * MOB_AI_CHASE_SPEED_MULT;
    mob.wanderDir = dx >= 0 ? 1 : -1;
    mob.x += mob.wanderDir * chaseSpeed;
    mob.x = Math.max(MOB_SPAWN_X_MIN, Math.min(MOB_SPAWN_X_MAX, mob.x));
  }

  private tickMobAttack(mob: Mob, def: MobDef, _dt: number): void {
    const target = mob.targetSessionId ? this.state.players.get(mob.targetSessionId) : undefined;

    if (!target || target.dead) {
      mob.aiState = "idle";
      mob.targetSessionId = "";
      return;
    }

    const dx = target.x - mob.x;
    const absDx = Math.abs(dx);
    const dy = Math.abs(target.y - mob.y);
    const attackRange = mob.attackRange || 50;

    if (absDx > attackRange * 1.8 || dy > MOB_AI_VERT_TOLERANCE) {
      mob.aiState = "chase";
      return;
    }

    if (mob.attackCooldown <= 0) {
      const mobAtk = def.attackDamage ?? MOB_AI_DEFAULT_ATTACK_DAMAGE;
      const mobLevel = def.level;

      const attacker: AttackerCombatStats = {
        atk: mobAtk,
        mAtk: 0,
        primaryStat: mobLevel * 2,
        skillDamagePercent: 100,
        hitCount: 1,
        accuracy: mobLevel * 5 + 10,
        critRate: 0.05,
        level: mobLevel,
      };

      const defender: DefenderCombatStats = {
        wDef: 0,
        mDef: 0,
        avoid: target.dex + target.luk,
        level: target.level,
      };

      const result = computeDamage(attacker, defender);
      if (result.hit && result.total > 0 && !target.dead) {
        target.hp = Math.max(0, target.hp - result.total);
        if (target.hp <= 0) {
          target.dead = true;
          target.attacking = false;
          target.respawnTimer = 4000;
        }
      }

      mob.attackCooldown = def.attackCooldownMs ?? MOB_AI_DEFAULT_ATTACK_COOLDOWN_MS;
    }
  }

  private findNearestAlivePlayer(mob: Mob): { sessionId: string; player: Player } | null {
    let best: { sessionId: string; player: Player } | null = null;
    let bestDist = Infinity;
    for (const [sid, p] of this.state.players.entries()) {
      if (p.dead) continue;
      const dist = Math.hypot(mob.x - p.x, mob.y - p.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { sessionId: sid, player: p };
      }
    }
    return best;
  }

  private findSessionByPlayer(player: Player): string | undefined {
    for (const [sid, p] of this.state.players.entries()) {
      if (p === player) return sid;
    }
    return undefined;
  }

  // ─── Collectible pickups ──────────────────────────────────────────────────

  private handlePickup(client: Client, uid: string): void {
    if (this.state.status !== "active") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const collectible = this.state.collectibles.get(uid);
    if (!collectible) return;

    // Proximity check.
    const dx = Math.abs(player.x - collectible.x);
    const dy = Math.abs(player.y - collectible.y);
    if (dx > 80 || dy > 80) return;

    // Remove from ground.
    this.state.collectibles.delete(uid);

    // Progress the collect objective.
    const stageIdx = this.state.activeStage;
    const progress = this.stageProgress[stageIdx];
    if (!progress || progress.completed) return;

    const objective = this.def.stages[stageIdx]?.objective;
    if (objective?.kind === "collect") {
      this.incrementStageProgress(stageIdx, 1);
    }
  }

  // ─── Puzzle solve signal ──────────────────────────────────────────────────

  private handlePuzzleSolve(client: Client, _msg: PQContributePayload): void {
    if (this.state.status !== "active") return;
    if (!this.puzzleLimiter.consume(client.sessionId)) {
      logAnomaly(client.sessionId, "rate_limit", "pq_puzzle");
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const stageIdx = this.state.activeStage;
    const progress = this.stageProgress[stageIdx];
    const schema = this.state.stages[stageIdx];
    if (!progress || progress.completed || !schema) return;

    const objective = this.def.stages[stageIdx]?.objective;
    if (!objective || objective.kind !== "solve") return;

    const _solveObj = objective as SolveObjective;

    // Cooldown check to prevent spam.
    const lastSolve = this.puzzleCooldowns.get(client.sessionId) ?? 0;
    const now = Date.now();
    if (now - lastSolve < PUZZLE_COOLDOWN_MS) return;
    this.puzzleCooldowns.set(client.sessionId, now);

    // Proximity check — player must be near the puzzle location (center of arena).
    const puzzleX = PQ_ARENA_WIDTH / 2;
    const puzzleY = PQ_FOOTHOLD.y;
    const dx = Math.abs(player.x - puzzleX);
    const dy = Math.abs(player.y - puzzleY);
    if (dx > PUZZLE_INTERACT_RANGE || dy > PUZZLE_INTERACT_RANGE) return;

    // Increment solve count.
    progress.extra.puzzleSolvedCount = (progress.extra.puzzleSolvedCount ?? 0) + 1;
    progress.current = progress.extra.puzzleSolvedCount;
    schema.current = progress.current;

    // Check stage completion.
    if (progress.current >= progress.target) {
      progress.completed = true;
      schema.completed = true;
      this.state.stagesCleared++;
      this.advanceStage();
    }
  }

  // ─── Reach-portal check ──────────────────────────────────────────────────

  private checkReachPortal(): void {
    const stageIdx = this.state.activeStage;
    const progress = this.stageProgress[stageIdx];
    const schema = this.state.stages[stageIdx];
    if (!progress || progress.completed || !schema) return;

    const objective = this.def.stages[stageIdx]?.objective;
    if (!objective || objective.kind !== "reach-portal") return;

    const portalObj = objective as ReachPortalObjective;
    const portalPos = PORTAL_POSITIONS[portalObj.portalId];
    if (!portalPos) return;

    // Check if any alive player is within range of the portal.
    for (const player of this.state.players.values()) {
      if (player.dead) continue;
      const dx = Math.abs(player.x - portalPos.x);
      const dy = Math.abs(player.y - portalPos.y);
      if (dx <= PORTAL_REACH_RANGE && dy <= PORTAL_REACH_RANGE) {
        progress.extra.portalReached = true;
        progress.current = 1;
        schema.current = 1;
        progress.completed = true;
        schema.completed = true;
        this.state.stagesCleared++;
        this.advanceStage();
        return;
      }
    }
  }

  // ─── Stage machine ───────────────────────────────────────────────────────

  private startCountdown(): void {
    this.started = true;
    this.state.status = "countdown";
    this.broadcastProgress();

    // Transition to active after a brief delay.
    setTimeout(() => {
      if (this.state.status !== "countdown") return;
      this.state.status = "active";
      this.elapsedMs = 0;
      this.spawnStageMobs();
      this.broadcastProgress();
      console.log(`[PartyQuestRoom] ${this.def.name} — GO!`);
    }, 3000);
  }

  /** Spawn mobs for the current stage based on its objective type. */
  private spawnStageMobs(): void {
    const stageIdx = this.state.activeStage;
    const stage = this.def.stages[stageIdx];
    if (!stage) return;

    const objective = stage.objective;

    if (objective.kind === "kill-count") {
      const obj = objective as KillCountObjective;
      this.spawnMobWave(obj.mobId, obj.count);
    } else if (objective.kind === "collect") {
      // For collect stages, spawn mobs that drop the collectible.
      const collectMobId = this.resolveCollectMobId(objective as CollectObjective);
      if (collectMobId) {
        const count = (objective as CollectObjective).count;
        this.spawnMobWave(collectMobId, count);
      }
    }
    // reach-portal and solve stages don't need mobs.
    // Boss stages would spawn a boss here (not yet defined in any PQ).
  }

  /** Spawn N mobs of the given type across the arena. */
  private spawnMobWave(mobId: string, count: number): void {
    const def = getMobDef(mobId);
    if (!def) return;

    for (let i = 0; i < count; i++) {
      const mob = new Mob();
      mob.mobId = mobId;
      mob.maxHp = def.maxHp;
      mob.hp = def.maxHp;
      mob.x = MOB_SPAWN_X_MIN + Math.random() * (MOB_SPAWN_X_MAX - MOB_SPAWN_X_MIN);
      mob.y = PQ_FOOTHOLD.y;
      mob.spawnX = mob.x;
      mob.footholdId = PQ_FOOTHOLD.id;
      mob.grounded = true;
      mob.wanderTimer = Math.random() * 1500;
      mob.aiState = "idle";
      mob.aggroRange = def.aggroRange ?? 200;
      mob.attackRange = def.attackRange ?? 50;
      mob.deaggroRange = def.deaggroRange ?? 280;

      const id = `pq_mob_${++this.idCounter}`;
      mob.instanceId = id;
      this.state.mobs.set(id, mob);
    }
  }

  private advanceStage(): void {
    const nextStage = this.state.activeStage + 1;

    if (nextStage >= this.def.stages.length) {
      this.endRun(true);
      return;
    }

    this.state.activeStage = nextStage;

    // Clear old mobs before spawning new ones for the next stage.
    this.state.mobs.clear();
    this.state.collectibles.clear();

    // Spawn mobs for the new stage.
    this.spawnStageMobs();

    this.broadcastProgress();
    console.log(
      `[PartyQuestRoom] Stage ${nextStage}/${this.def.stages.length}: ${this.def.stages[nextStage]?.label ?? ""}`,
    );
  }

  // ─── End conditions ──────────────────────────────────────────────────────

  private endRun(success: boolean, reason?: string): void {
    if (this.resultSent) return;
    this.resultSent = true;

    this.state.status = success ? "success" : "failed";

    if (success) {
      // Grant rewards to every player.
      for (const [sessId, player] of this.state.players.entries()) {
        grantExp(player, this.def.rewards.exp);
        player.mesos += this.def.rewards.mesos;
        // Analytics: PQ success per player.
        const pqAcct = this.sessionAccount.get(sessId);
        if (pqAcct) {
          track(AnalyticsEventType.PARTY_QUEST_RUN, pqAcct, player.charId, {
            pqId: this.def.id,
            success: true,
            playerCount: this.state.players.size,
          });
        }

        // Grant item rewards.
        for (const itemDefId of this.def.rewards.items) {
          const uid = `pq_${player.charId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const item = new InventoryItem();
          item.uid = uid;
          item.defId = itemDefId;
          player.inventory.set(uid, item);
        }

        // Grant PQ set equip.
        {
          const uid = `pq_set_${player.charId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const item = new InventoryItem();
          item.uid = uid;
          item.defId = this.def.rewards.setEquipDefId;
          player.inventory.set(uid, item);
        }

        // Persist the rewards.
        this.persistPlayer(player);
      }

      console.log(`[PartyQuestRoom] ${this.def.name} — SUCCESS!`);
    } else {
      // Analytics: PQ failure per player.
      for (const [sessId, player] of this.state.players.entries()) {
        const pqAcct = this.sessionAccount.get(sessId);
        if (pqAcct) {
          track(AnalyticsEventType.PARTY_QUEST_RUN, pqAcct, player.charId, {
            pqId: this.def.id,
            success: false,
            playerCount: this.state.players.size,
          });
        }
      }
      console.log(`[PartyQuestRoom] ${this.def.name} — FAILED: ${reason ?? "unknown"}`);
    }

    // Broadcast result to all clients.
    for (const client of Array.from(this.clients)) {
      client.send(MessageType.PQ_RESULT, {
        pqId: this.def.id,
        success,
        exp: success ? this.def.rewards.exp : undefined,
        mesos: success ? this.def.rewards.mesos : undefined,
        items: success ? this.def.rewards.items : undefined,
        setEquipDefId: success ? this.def.rewards.setEquipDefId : undefined,
        reason: success ? undefined : (reason ?? "PQ failed"),
      } satisfies PQResultPayload);
    }

    // Dispose the room after a delay.
    setTimeout(() => {
      this.disconnect();
    }, POST_RESULT_DELAY_MS);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Increment stage progress by `amount` and check for completion. */
  private incrementStageProgress(stageIdx: number, amount: number): void {
    const progress = this.stageProgress[stageIdx];
    const schema = this.state.stages[stageIdx];
    if (!progress || progress.completed || !schema) return;

    const remaining = progress.target - progress.current;
    if (remaining <= 0) return;

    progress.current += Math.min(amount, remaining);
    schema.current = progress.current;

    if (progress.current >= progress.target) {
      progress.completed = true;
      schema.completed = true;
      this.state.stagesCleared++;
      this.advanceStage();
    }
  }

  private broadcastProgress(): void {
    const payload: PQProgressPayload = {
      pqId: this.def.id,
      timeRemainingSec: Math.ceil(this.state.timeRemainingMs / 1000),
      activeStage: this.state.activeStage,
      stagesCleared: this.state.stagesCleared,
      totalStages: this.state.totalStages,
      playerCount: this.state.players.size,
      stages: this.state.stages.map((s) => ({
        ordinal: s.ordinal,
        label: s.label,
        objectiveKind: s.objectiveKind,
        current: s.current,
        target: s.target,
        completed: s.completed,
      })),
    };
    this.broadcast(MessageType.PQ_PROGRESS, payload);
  }

  private persistPlayer(player: Player): void {
    if (!player.charId) return;
    const equipped: Record<string, string> = {};
    player.equipped.forEach((uid, slot) => {
      equipped[slot] = uid;
    });

    const inventory: Record<string, import("../persistence/store").ItemRecord> = {};
    player.inventory.forEach((item, uid) => {
      inventory[uid] = {
        uid: item.uid,
        defId: item.defId,
        baseRank: item.baseRank,
        potentialTier: item.potentialTier,
        lines: item.lines,
        minted: item.minted,
        count: item.count,
      };
    });

    accountStore.updateCharacter(player.charId, {
      level: player.level,
      exp: player.exp,
      ap: player.ap,
      sp: player.sp,
      stats: {
        STR: player.str,
        DEX: player.dex,
        INT: player.intel,
        LUK: player.luk,
        HP: player.hp,
        MP: player.mp,
      },
      mesos: player.mesos,
      x: player.x,
      y: player.y,
      mapId: "meadowfield", // return to staging map
      equipped,
      inventory,
    });
  }
}
