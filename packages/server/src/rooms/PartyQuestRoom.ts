/**
 * PartyQuestRoom — instanced party quest room.
 *
 * Runs a multi-stage group challenge with a shared countdown timer. The room
 * is created dynamically per PQ run (via `colyseus.createRoom("pq", { pqId })`).
 *
 * Lifecycle:
 *   1. Leader creates the room → `onCreate` loads the PQ def.
 *   2. Party members join → `onJoin` populates `PQState.players`.
 *   3. Leader sends `PQ_JOIN` → server starts the countdown → `status = "active"`.
 *   4. Each tick: countdown decrements; objectives are evaluated.
 *   5. When all stages clear → `status = "success"`, rewards granted.
 *   6. On timeout or all players leave → `status = "failed"`, players returned.
 */
import { Client } from "colyseus";
import { AuthedRoom } from "./AuthedRoom";
import {
  ClassArchetype,
  type PartyQuestDef,
  getPartyQuest,
  createPQStageProgress,
  randomizeAppearance,
  getClass,
  autoAssign,
  maxHpForLevel,
  maxMpForLevel,
  resolveAttackType,
} from "@maple/shared";
import { PQState, PQStageProgressSchema } from "./schema/PQState";
import { Player } from "./schema/Player";
import { InventoryItem } from "./schema/InventoryItem";
import {
  MessageType,
  type PQContributePayload,
  type PQProgressPayload,
  type PQResultPayload,
} from "../types";
import { accountStore, type CharacterRecord } from "../persistence/store";
import { grantExp } from "../applyExp";
import { track } from "../analytics";
import { AnalyticsEventType } from "../analyticsEvents";
import { RateLimiter, logAnomaly } from "../validate";

// ─── Tunables ──────────────────────────────────────────────────────────────

/** Fixed timestep for the simulation loop (60 fps). */
const FIXED_TIME_STEP = 1000 / 60;

/** How often (in ticks) to broadcast progress to clients (~2 × per second). */
const PROGRESS_BROADCAST_INTERVAL = 30;

/** Delay (ms) after success/fail before the room disposes itself. */
const POST_RESULT_DELAY_MS = 8_000;

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

  /** Rate limiter for contribute messages: 20/sec per client. */
  private contributeLimiter = new RateLimiter(20, 0.02);

  // ─── Messages ────────────────────────────────────────────────────────────

  messages = {
    /** Player sends a contribution to the current stage objective. */
    [MessageType.PQ_CONTRIBUTE]: (client: Client, msg: PQContributePayload) => {
      this.handleContribute(client, msg);
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
    player.y = 300;
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

    // Auto-start countdown once the first player joins.
    if (!this.started && this.state.players.size >= 1) {
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
    }

    // Broadcast progress periodically.
    if (++this.ticksSinceBroadcast >= PROGRESS_BROADCAST_INTERVAL) {
      this.ticksSinceBroadcast = 0;
      this.broadcastProgress();
    }
  }

  // ─── Stage machine ───────────────────────────────────────────────────────

  private startCountdown(): void {
    this.started = true;
    this.state.status = "countdown";
    this.broadcastProgress();

    // Transition to active after a brief delay.
    setTimeout(() => {
      if (this.state.status !== "countdown") return; // room disposed or disconnected
      this.state.status = "active";
      this.elapsedMs = 0;
      this.broadcastProgress();
      console.log(`[PartyQuestRoom] ${this.def.name} — GO!`);
    }, 3000);
  }

  private handleContribute(client: Client, msg: PQContributePayload): void {
    if (this.state.status !== "active") return;

    if (!this.contributeLimiter.consume(client.sessionId)) {
      logAnomaly(client.sessionId, "rate_limit", "pq_contribute");
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || player.dead) return;

    const stageIdx = this.state.activeStage;
    const schema = this.state.stages[stageIdx];
    const progress = this.stageProgress[stageIdx];
    if (!schema || !progress || progress.completed) return;

    // Validate + clamp amount: must be finite positive, can't overshoot target.
    const rawAmount = Number(msg.amount);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      logAnomaly(client.sessionId, "malformed", "pq_contribute_amount");
      return;
    }
    const remaining = progress.target - progress.current;
    if (remaining <= 0) return;

    // Apply contribution (clamped to remaining target).
    const amount = Math.min(Math.floor(rawAmount), remaining);
    progress.current += amount;
    schema.current = progress.current;

    // Check stage completion.
    if (progress.current >= progress.target) {
      progress.completed = true;
      schema.completed = true;
      this.state.stagesCleared++;
      this.advanceStage();
    }
  }

  private advanceStage(): void {
    const nextStage = this.state.activeStage + 1;

    if (nextStage >= this.def.stages.length) {
      // All stages cleared → success!
      this.endRun(true);
      return;
    }

    this.state.activeStage = nextStage;
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
