/**
 * ReactorManager — handles placed breakable/interactive objects on a map.
 *
 * On room init, spawns Reactor schema objects from the map's reactor definitions.
 * Processes attack hits (breakables) and interact actions (switches/mechanisms),
 * drops loot on break, and respawns after the configured cooldown.
 */

import type { GameMap, ReactorObject } from "@maple/shared";
import {
  MessageType,
  REACTOR_DEFAULT_HP,
  REACTOR_DEFAULT_RANGE,
  type ReactorSpawnPayload,
  type ReactorHitPayload,
  type ReactorDestroyPayload,
  type ReactorInteractPayload,
  type ReactorDespawnPayload,
} from "@maple/shared";

import type { Player } from "./rooms/schema/Player";
import type { TownState } from "./rooms/schema/TownState";
import { Reactor } from "./rooms/schema/Reactor";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Damage dealt per hit to a breakable reactor. */
const REACTOR_HIT_DAMAGE_MIN = 40;
const REACTOR_HIT_DAMAGE_MAX = 80;
/** Horizontal attack range to hit a reactor. */
const REACTOR_ATTACK_RANGE = 80;
/** Vertical attack range to hit a reactor. */
const REACTOR_ATTACK_VERT = 60;

// ─── Internal runtime state ─────────────────────────────────────────────────

interface ReactorRuntime {
  def: ReactorObject;
  schema: Reactor;
  currentHp: number;
  maxHp: number;
  /** Epoch-ms when this reactor should respawn. 0 = not on cooldown. */
  respawnAt: number;
}

// ─── ReactorManager ─────────────────────────────────────────────────────────

export class ReactorManager {
  private readonly reactors = new Map<string, ReactorRuntime>();

  constructor(
    private readonly state: TownState,
    private readonly map: GameMap,
    private readonly broadcast: (type: number, payload: unknown) => void,
    /** Callback to spawn loot drops. */
    private readonly onLootSpawn: (itemId: string, x: number, y: number) => void,
    /** Callback to grant EXP to a player. */
    private readonly onExpGrant: (player: Player, exp: number) => void,
    /** Callback to progress quest objectives. */
    private readonly onQuestProgress: (
      player: Player,
      kind: string,
      matchKey: string,
      amount: number,
    ) => boolean,
  ) {
    this.spawnAll();
  }

  /** Each fixed tick: check respawn timers. */
  tick(_dt: number): void {
    const now = Date.now();
    for (const [id, rt] of this.reactors) {
      if (rt.respawnAt > 0 && now >= rt.respawnAt) {
        this.respawnReactor(id, rt);
      }
    }
  }

  /**
   * Attempt to damage a breakable reactor with a player's attack.
   * Returns true if a reactor was hit (caller should skip normal mob targeting).
   */
  onAttack(player: Player): boolean {
    for (const [, rt] of this.reactors) {
      if (!rt.schema.active) continue;
      if (rt.def.kind !== "breakable-box" && rt.def.kind !== "ore-vein") continue;

      const dx = Math.abs(player.x - rt.schema.x);
      const dy = Math.abs(player.y - rt.schema.y);
      if (dx > REACTOR_ATTACK_RANGE || dy > REACTOR_ATTACK_VERT) continue;

      const dmg =
        REACTOR_HIT_DAMAGE_MIN +
        Math.floor(Math.random() * (REACTOR_HIT_DAMAGE_MAX - REACTOR_HIT_DAMAGE_MIN));
      rt.currentHp = Math.max(0, rt.currentHp - dmg);
      rt.schema.hp = rt.currentHp;

      this.broadcast(MessageType.REACTOR_HIT, {
        reactorId: rt.def.id,
        damage: dmg,
        hp: rt.currentHp,
        maxHp: rt.maxHp,
      } satisfies ReactorHitPayload);

      // Progress quest objectives for break.
      this.onQuestProgress(player, "break", rt.def.rewards?.reactorId ?? rt.def.kind, 1);

      if (rt.currentHp <= 0) {
        this.breakReactor(rt, player);
      }

      return true;
    }
    return false;
  }

  /**
   * Attempt to interact with an interactive reactor (switch/mechanism).
   * Returns true if interaction succeeded.
   */
  onInteract(player: Player): boolean {
    const range = REACTOR_DEFAULT_RANGE;

    for (const [, rt] of this.reactors) {
      if (!rt.schema.active) continue;
      if (rt.def.kind !== "quest-switch" && rt.def.kind !== "mechanism") continue;

      const dx = Math.abs(player.x - rt.schema.x);
      const dy = Math.abs(player.y - rt.schema.y);
      if (dx > range || dy > range) continue;

      // Trigger the interaction.
      this.broadcast(MessageType.REACTOR_INTERACT, {
        reactorId: rt.def.id,
        triggerType: rt.def.rewards?.triggerType,
        triggerData: rt.def.rewards?.triggerData,
      } satisfies ReactorInteractPayload);

      // Progress quest objectives for interact.
      this.onQuestProgress(player, "interact", rt.def.rewards?.reactorId ?? rt.def.kind, 1);

      // Deactivate and start respawn timer if configured.
      rt.schema.active = false;
      if (rt.def.respawnMs && rt.def.respawnMs > 0) {
        rt.respawnAt = Date.now() + rt.def.respawnMs;
      }

      this.broadcast(MessageType.REACTOR_DESPAWN, {
        reactorId: rt.def.id,
      } satisfies ReactorDespawnPayload);

      return true;
    }
    return false;
  }

  // ── Private ──────────────────────────────────────────────────

  private spawnAll(): void {
    const defs = this.map.reactors;
    if (!defs) return;

    for (const def of defs) {
      const hp = def.hp ?? REACTOR_DEFAULT_HP;
      const schema = new Reactor();
      schema.reactorId = def.id;
      schema.kind = def.kind;
      schema.x = def.x;
      schema.y = def.y;
      schema.hp = hp;
      schema.maxHp = hp;
      schema.active = true;

      this.state.reactors.set(def.id, schema);

      this.reactors.set(def.id, {
        def,
        schema,
        currentHp: hp,
        maxHp: hp,
        respawnAt: 0,
      });
    }
  }

  private breakReactor(rt: ReactorRuntime, killer: Player): void {
    // Grant rewards.
    const rewards = rt.def.rewards;
    if (rewards) {
      if (rewards.exp) this.onExpGrant(killer, rewards.exp);
      if (rewards.mesos) killer.mesos += rewards.mesos;
      if (rewards.items) {
        for (const itemId of rewards.items) {
          this.onLootSpawn(itemId, rt.schema.x, rt.schema.y);
        }
      }
    }

    this.broadcast(MessageType.REACTOR_DESTROY, {
      reactorId: rt.def.id,
      exp: rewards?.exp ?? 0,
      mesos: rewards?.mesos ?? 0,
    } satisfies ReactorDestroyPayload);

    // Deactivate.
    rt.schema.active = false;
    rt.schema.hp = 0;

    // Start respawn timer.
    if (rt.def.respawnMs && rt.def.respawnMs > 0) {
      rt.respawnAt = Date.now() + rt.def.respawnMs;
    }

    this.broadcast(MessageType.REACTOR_DESPAWN, {
      reactorId: rt.def.id,
    } satisfies ReactorDespawnPayload);
  }

  private respawnReactor(_id: string, rt: ReactorRuntime): void {
    const hp = rt.def.hp ?? REACTOR_DEFAULT_HP;
    rt.currentHp = hp;
    rt.maxHp = hp;
    rt.respawnAt = 0;
    rt.schema.hp = hp;
    rt.schema.maxHp = hp;
    rt.schema.active = true;

    this.broadcast(MessageType.REACTOR_SPAWN, {
      reactorId: rt.def.id,
      kind: rt.def.kind,
      x: rt.def.x,
      y: rt.def.y,
      hp,
      maxHp: hp,
    } satisfies ReactorSpawnPayload);
  }
}
