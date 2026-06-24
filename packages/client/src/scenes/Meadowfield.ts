import Phaser from "phaser";
import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import { MessageType, type InputData } from "@maple/shared";

import { BACKEND_URL, getAccountId, getPlayerName } from "../backend";
import { TextureKeys, TILE_SIZE } from "../art/textures";
import type { TownStateView, PlayerView, MobView, LootView } from "../state-views";

/**
 * MeadowfieldScene — the core gameplay scene wired to the authoritative Colyseus `town_room`.
 *
 * Authoritative pattern (verified Colyseus tutorial "Part4Room/Part4Scene"):
 *   - the SERVER owns all movement, combat, and loot; the client only sends *inputs* and renders.
 *   - the LOCAL player is client-side *predicted* (we apply the same movement locally so it feels
 *     instant) while the camera follows it.
 *   - every REMOTE entity (other players, mobs) is *interpolated* toward its last-known server
 *     position via a per-frame lerp, so the world stays smooth between state patches.
 *
 * The joined room is published on the scene registry under "room" so the parallel UIScene and the
 * MarketScene can reuse the same connection instead of opening a second socket.
 *
 * Combat + loot are CLIENT-INTENT only: pressing the attack key (SPACE / left-click) sets
 * `attack: true` on the InputData for that frame and plays a local swing flourish for game feel — the
 * SERVER resolves the swing, damage, kills and drops (we never apply damage locally). We then react
 * to authoritative state: mobs flash red on `hit`, fade out on `dead` (and restore when the same map
 * entry respawns), and nearby loot is auto-picked-up by sending `MessageType.PICKUP { uid }` (the
 * server re-checks the 60px range before accepting it).
 */

// ─── Tunables (mirror of packages/server/src/rooms/TownRoom.ts — keep in sync) ──────────────────
const MAP_WIDTH = 1600;
const MAP_HEIGHT = 600;
/** Server moves a player this many px per fixed tick. We reuse it for client prediction. */
const PLAYER_SPEED = 2.4;
/** Server's fixed timestep; prediction scales PLAYER_SPEED by `delta / FIXED_TIMESTEP`. */
const FIXED_TIMESTEP = 1000 / 60;

/** Interpolation factor for remote entities (0 = frozen, 1 = snap). 0.2 ≈ smooth but responsive. */
const REMOTE_LERP = 0.2;
/** Ground render texture sits far below every dynamic sprite (which use y as their depth). */
const GROUND_DEPTH = -1000;
/** Registry key other scenes (UI/Market) read to reuse this room connection. */
const ROOM_REGISTRY_KEY = "room";

// ─── Combat + loot tunables (mirror packages/server/src/rooms/TownRoom.ts — keep in sync) ────────
/** Server melee cooldown. Reused to throttle the *visual* swing so the cosmetic tracks real hits. */
const ATTACK_COOLDOWN_MS = 450;
/** Lifetime of the local slash flourish in ms (purely cosmetic — the server owns the real swing). */
const SWING_VISUAL_MS = 220;
/** How long a mob stays tinted red after a server `hit` (mirrors the server's 120ms hitTimer). */
const MOB_HIT_FLASH_MS = 120;
/** Local fade/scale-out played when a mob's `dead` flips true. */
const MOB_DEATH_MS = 220;
/** Server only accepts a PICKUP within this radius — we mirror it so we never ask in vain. */
const PICKUP_RANGE = 60;
/** Re-ask cadence for a still-present in-range drop (covers latency without spamming the socket). */
const PICKUP_RETRY_MS = 400;

/** WASD movement keys, mapped to the same axes as the arrow keys. */
interface WasdKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
}

export class MeadowfieldScene extends Phaser.Scene {
  /** The authoritative town room. Undefined until `connect()` resolves. */
  private room?: Room<unknown, TownStateView>;
  /** Our own session id, used to tell the local player apart from remotes. */
  private localSessionId = "";
  /** The local player's sprite — predicted locally and followed by the camera. */
  private localPlayer?: Phaser.GameObjects.Sprite;
  /** Monotonic client input tick, echoed back by the server for (future) reconciliation. */
  private currentTick = 0;

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: WasdKeys;

  private readonly playerSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly mobSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly lootSprites = new Map<string, Phaser.GameObjects.Sprite>();

  /** SPACE attack key. Left-click is polled separately off the active pointer. */
  private attackKey?: Phaser.Input.Keyboard.Key;
  /** Local cooldown (ms) gating the swing *visual* so it roughly lines up with server swings. */
  private swingCooldown = 0;
  /** Last time (scene-clock ms) we asked the server to pick up each loot uid — throttles requests. */
  private readonly pickupRequestedAt = new Map<string, number>();
  /** Local player's last-seen mesos / level, used to float "+N mesos" and "LEVEL UP!" feedback. */
  private localMesos = 0;
  private localLevel = 1;

  constructor() {
    super("meadowfield");
  }

  async create(): Promise<void> {
    // World + camera bounds are known up front (server map is a fixed 1600x600).
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.buildBackground();
    this.setupInput();

    // HUD overlay runs in parallel; it can read the room off the registry once we connect.
    this.scene.launch("ui");

    try {
      await this.connect();
    } catch (err) {
      console.error("[meadowfield] failed to join town_room", err);
      this.showConnectionError();
    }
  }

  override update(_time: number, delta: number): void {
    const room = this.room;
    if (!room || !this.cursors || !this.wasd || !this.localPlayer) return;

    // 1) Gather input from arrow keys OR WASD and push it to the authoritative server.
    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;

    // Attack intent: SPACE held OR left mouse button held. The server gates the real swing by its
    // 450ms cooldown and resolves damage — we only forward intent and never apply damage locally.
    const attack = (this.attackKey?.isDown ?? false) || this.input.activePointer.leftButtonDown();

    const input: InputData = {
      left,
      right,
      up,
      down,
      attack,
      tick: this.currentTick++,
    };
    room.send(MessageType.INPUT, input);

    // 2) Client-side prediction: apply the *same* movement the server will, so the local player
    //    responds instantly. The server stays authoritative and will correct us if we diverge.
    const step = PLAYER_SPEED * (delta / FIXED_TIMESTEP);
    if (left) {
      this.localPlayer.x -= step;
      this.localPlayer.setFlipX(true);
    } else if (right) {
      this.localPlayer.x += step;
      this.localPlayer.setFlipX(false);
    }
    if (up) this.localPlayer.y -= step;
    else if (down) this.localPlayer.y += step;
    this.localPlayer.x = Phaser.Math.Clamp(this.localPlayer.x, 0, MAP_WIDTH);
    this.localPlayer.y = Phaser.Math.Clamp(this.localPlayer.y, 0, MAP_HEIGHT);
    this.applyDepthAndShadow(this.localPlayer);

    // Local swing flourish — throttled to the server cooldown so the cosmetic roughly tracks real
    // swings. Facing is read off the predicted sprite's flip (set just above).
    if (this.swingCooldown > 0) this.swingCooldown -= delta;
    if (attack && this.swingCooldown <= 0) {
      this.playSwing();
      this.swingCooldown = ATTACK_COOLDOWN_MS;
    }

    // 3) Interpolate every remote player toward its last-known server position.
    for (const [sessionId, sprite] of this.playerSprites) {
      if (sessionId === this.localSessionId) continue;
      this.lerpToServer(sprite);
    }

    // 4) Mobs are server-driven too — interpolate them the same way.
    for (const sprite of this.mobSprites.values()) this.lerpToServer(sprite);

    // 5) Auto-vacuum the nearest loot drop in range (server re-checks the 60px gate authoritatively).
    this.autoPickupLoot();
  }

  // ─── Connection + state binding ───────────────────────────────────────────────────────────────
  private async connect(): Promise<void> {
    const client = new Client(BACKEND_URL);
    const room = await client.joinOrCreate<TownStateView>("town_room", {
      name: getPlayerName(),
      accountId: getAccountId(),
    });

    this.room = room;
    this.localSessionId = room.sessionId;
    // Publish the live connection so UIScene / MarketScene reuse this socket instead of a new one.
    this.registry.set(ROOM_REGISTRY_KEY, room);

    room.onError((code, message) =>
      console.error(`[meadowfield] room error ${code}: ${message ?? ""}`),
    );
    room.onLeave((code) => console.warn(`[meadowfield] left town_room (code ${code})`));

    this.bindState(room);
  }

  /** Attach all add/change/remove listeners. `getStateCallbacks` is the verified 0.17 SDK API. */
  private bindState(room: Room<unknown, TownStateView>): void {
    const $ = getStateCallbacks(room);

    // ── Players ──
    $(room.state).players.onAdd((player: PlayerView, sessionId: string) => {
      const sprite = this.add.sprite(player.x, player.y, TextureKeys.PlayerWarrior);
      sprite.setFlipX(player.facing === -1);
      this.attachShadow(sprite);
      this.playerSprites.set(sessionId, sprite);

      if (sessionId === this.localSessionId) {
        // LOCAL player → prediction drives it and the camera follows it.
        this.localPlayer = sprite;
        this.cameras.main.startFollow(sprite, true, 0.12, 0.12);

        // Float "+N mesos" / "LEVEL UP!" whenever an authoritative reward lands on us.
        this.localMesos = player.mesos;
        this.localLevel = player.level;
        $(player).onChange(() => {
          if (player.mesos > this.localMesos) {
            const gain = player.mesos - this.localMesos;
            this.floatText(sprite.x, sprite.y - 26, `+${gain} mesos`, "#ffe9a8");
          }
          if (player.level > this.localLevel) {
            this.floatText(sprite.x, sprite.y - 42, "LEVEL UP!", "#9ad06b");
          }
          this.localMesos = player.mesos;
          this.localLevel = player.level;
        });
      } else {
        // REMOTE player → stash server transform for interpolation in update().
        this.storeServerTransform(sprite, player.x, player.y, player.facing);
        $(player).onChange(() => {
          this.storeServerTransform(sprite, player.x, player.y, player.facing);
        });
      }
      this.applyDepthAndShadow(sprite);
    });

    $(room.state).players.onRemove((_player: PlayerView, sessionId: string) => {
      this.destroyTracked(this.playerSprites, sessionId);
      if (sessionId === this.localSessionId) this.localPlayer = undefined;
    });

    // ── Mobs (Meadow Slime) ──
    $(room.state).mobs.onAdd((mob: MobView, key: string) => {
      const sprite = this.add.sprite(mob.x, mob.y, TextureKeys.MobSlime);
      sprite.setFlipX(mob.facing === -1);
      this.storeServerTransform(sprite, mob.x, mob.y, mob.facing);
      this.attachShadow(sprite);
      this.mobSprites.set(key, sprite);
      this.applyDepthAndShadow(sprite);
      // A mob can already be dead when we join (mid-respawn) — start hidden so it doesn't render as
      // a live slime the player swings at in vain (the server ignores dead mobs).
      if (mob.dead) {
        sprite.setVisible(false);
        this.shadowOf(sprite)?.setVisible(false);
      }
      // Seed the death/hit edge-detection state we diff against in onChange.
      sprite.setData("dead", mob.dead);
      sprite.setData("hit", mob.hit);

      $(mob).onChange(() => {
        this.storeServerTransform(sprite, mob.x, mob.y, mob.facing);

        const wasDead = sprite.getData("dead") === true;
        const wasHit = sprite.getData("hit") === true;

        // React to transitions only — onChange also fires on every wander step, so diff vs. last
        // state. The same map entry is revived server-side, so dead→alive restores the sprite.
        if (mob.dead && !wasDead) this.playMobDeath(sprite);
        else if (!mob.dead && wasDead) this.restoreMob(sprite);
        else if (mob.hit && !wasHit) this.flashMob(sprite);

        sprite.setData("dead", mob.dead);
        sprite.setData("hit", mob.hit);
      });
    });

    $(room.state).mobs.onRemove((_mob: MobView, key: string) => {
      this.destroyTracked(this.mobSprites, key);
    });

    // ── Loot drops (no shadow — they sit flat on the grass) ──
    $(room.state).loot.onAdd((loot: LootView, uid: string) => {
      const key = loot.legendary ? TextureKeys.LootGemLegendary : TextureKeys.LootGem;
      const sprite = this.add.sprite(loot.x, loot.y, key);
      sprite.setDepth(loot.y);
      this.lootSprites.set(uid, sprite);

      // Quick drop-in pop; legendaries then keep a continuous pulse so they read instantly.
      sprite.setScale(0);
      this.tweens.add({
        targets: sprite,
        scale: 1,
        duration: 220,
        ease: "Back.easeOut",
        onComplete: () => {
          if (loot.legendary && sprite.active) this.startLegendaryPulse(sprite);
        },
      });

      // Loot is static; its position only changes if the server nudges it.
      $(loot).onChange(() => {
        sprite.setPosition(loot.x, loot.y);
        sprite.setDepth(loot.y);
      });
    });

    $(room.state).loot.onRemove((_loot: LootView, uid: string) => {
      this.pickupRequestedAt.delete(uid);
      this.destroyTracked(this.lootSprites, uid);
    });
  }

  // ─── Rendering helpers ────────────────────────────────────────────────────────────────────────
  /** Bake the pastoral grass field into a single render texture (checkerboard of the two tiles). */
  private buildBackground(): void {
    const cols = Math.ceil(MAP_WIDTH / TILE_SIZE);
    const rows = Math.ceil(MAP_HEIGHT / TILE_SIZE);
    const ground = this.add.renderTexture(0, 0, MAP_WIDTH, MAP_HEIGHT).setOrigin(0, 0);
    ground.setDepth(GROUND_DEPTH);

    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const key = (tx + ty) % 2 === 0 ? TextureKeys.TileGrass : TextureKeys.TileGrassAlt;
        ground.draw(key, tx * TILE_SIZE, ty * TILE_SIZE);
      }
    }
  }

  private setupInput(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as WasdKeys;

    // SPACE = melee attack. The `true` enables key capture so the page doesn't scroll on press.
    this.attackKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, true);

    // M opens the Free Market overlay (its own room) and pauses us, so the world freezes and we stop
    // sending input behind the panel. MarketScene resumes us when it closes (on M / Esc).
    keyboard.on("keydown-M", () => this.openMarket());
  }

  /** Launch the Free Market overlay on top and pause Meadowfield until it closes. */
  private openMarket(): void {
    if (this.scene.isActive("market")) return;
    this.scene.launch("market");
    this.scene.pause();
  }

  /** Add a soft shadow under a sprite and remember it on the sprite for later updates/cleanup. */
  private attachShadow(sprite: Phaser.GameObjects.Sprite): void {
    const shadow = this.add.image(sprite.x, sprite.y, TextureKeys.Shadow);
    shadow.setDepth(sprite.y - 0.1);
    sprite.setData("shadow", shadow);
  }

  private shadowOf(sprite: Phaser.GameObjects.Sprite): Phaser.GameObjects.Image | undefined {
    return sprite.getData("shadow") as Phaser.GameObjects.Image | undefined;
  }

  /** Record the server's latest transform on a sprite for per-frame interpolation. */
  private storeServerTransform(
    sprite: Phaser.GameObjects.Sprite,
    x: number,
    y: number,
    facing: number,
  ): void {
    sprite.setData("serverX", x);
    sprite.setData("serverY", y);
    sprite.setData("facing", facing);
  }

  /** Lerp a remote sprite toward its stashed server transform and sync its facing/depth/shadow. */
  private lerpToServer(sprite: Phaser.GameObjects.Sprite): void {
    const serverX = sprite.getData("serverX") as number | undefined;
    const serverY = sprite.getData("serverY") as number | undefined;
    const facing = sprite.getData("facing") as number | undefined;

    if (serverX !== undefined) sprite.x = Phaser.Math.Linear(sprite.x, serverX, REMOTE_LERP);
    if (serverY !== undefined) sprite.y = Phaser.Math.Linear(sprite.y, serverY, REMOTE_LERP);
    if (facing !== undefined) sprite.setFlipX(facing === -1);

    this.applyDepthAndShadow(sprite);
  }

  /** Depth-sort by y (lower = in front) and keep the sprite's shadow pinned under its feet. */
  private applyDepthAndShadow(sprite: Phaser.GameObjects.Sprite): void {
    sprite.setDepth(sprite.y);
    const shadow = this.shadowOf(sprite);
    if (shadow) {
      shadow.setPosition(sprite.x, sprite.y + sprite.displayHeight / 2 - 3);
      shadow.setDepth(sprite.y - 0.1);
    }
  }

  /** Destroy a tracked sprite (and its shadow), killing any in-flight tweens, and drop it from `map`. */
  private destroyTracked(map: Map<string, Phaser.GameObjects.Sprite>, key: string): void {
    const sprite = map.get(key);
    if (!sprite) return;
    this.tweens.killTweensOf(sprite);
    const shadow = this.shadowOf(sprite);
    if (shadow) {
      this.tweens.killTweensOf(shadow);
      shadow.destroy();
    }
    sprite.destroy();
    map.delete(key);
  }

  // ─── Combat + loot feedback (cosmetic only — the server stays authoritative over outcomes) ───────
  /** Cosmetic melee flourish on the local warrior: a squash-punch + a slash that sweeps in `facing`. */
  private playSwing(): void {
    const player = this.localPlayer;
    if (!player) return;
    const facing = player.flipX ? -1 : 1;

    // Weighty squash on the warrior itself (yoyos back to its resting scale).
    this.tweens.add({
      targets: player,
      scaleX: 1.12,
      scaleY: 0.9,
      duration: 70,
      yoyo: true,
      ease: "Quad.easeOut",
    });

    // A bright slash drawn just in front of the player that sweeps forward and fades out.
    const slash = this.add.rectangle(player.x + facing * 20, player.y - 2, 9, 38, 0xeaf2ff, 0.85);
    slash.setDepth(player.y + 1);
    slash.setAngle(facing === 1 ? -34 : 34);
    slash.setScale(0.55, 1);
    this.tweens.add({
      targets: slash,
      x: player.x + facing * 34,
      scaleX: 1.7,
      angle: facing === 1 ? 30 : -30,
      alpha: 0,
      duration: SWING_VISUAL_MS,
      ease: "Cubic.easeOut",
      onComplete: () => slash.destroy(),
    });
  }

  /** Ask the server to pick up the nearest in-range drop. It re-checks the 60px gate authoritatively. */
  private autoPickupLoot(): void {
    const room = this.room;
    const player = this.localPlayer;
    if (!room || !player || this.lootSprites.size === 0) return;

    let nearestUid: string | undefined;
    let nearestDist = PICKUP_RANGE;
    for (const [uid, sprite] of this.lootSprites) {
      const dist = Phaser.Math.Distance.Between(player.x, player.y, sprite.x, sprite.y);
      if (dist <= nearestDist) {
        nearestDist = dist;
        nearestUid = uid;
      }
    }
    if (!nearestUid) return;

    // Throttle per-uid so a dropped/late request retries instead of flooding the socket every frame.
    const now = this.time.now;
    if (now - (this.pickupRequestedAt.get(nearestUid) ?? -Infinity) < PICKUP_RETRY_MS) return;
    this.pickupRequestedAt.set(nearestUid, now);
    room.send(MessageType.PICKUP, { uid: nearestUid });
  }

  /** Red flash + spark + a tiny squash when the server flags a non-fatal `hit` on a mob. */
  private flashMob(sprite: Phaser.GameObjects.Sprite): void {
    sprite.setTint(0xff6b6b);
    this.time.delayedCall(MOB_HIT_FLASH_MS, () => {
      if (sprite.active && sprite.getData("dead") !== true) sprite.clearTint();
    });
    this.tweens.add({
      targets: sprite,
      scaleX: 1.15,
      scaleY: 0.88,
      duration: 60,
      yoyo: true,
      ease: "Quad.easeOut",
    });
    this.spawnHitSpark(sprite.x, sprite.y - 4);
  }

  /** A small white burst at a hit location — lightweight and self-destroying. */
  private spawnHitSpark(x: number, y: number): void {
    const spark = this.add.circle(x, y, 5, 0xffffff, 0.9).setDepth(y + 2);
    this.tweens.add({
      targets: spark,
      scale: 2.2,
      alpha: 0,
      duration: 160,
      ease: "Cubic.easeOut",
      onComplete: () => spark.destroy(),
    });
  }

  /** Fade + shrink a mob (and its shadow) out on death. The server revives the same entry later. */
  private playMobDeath(sprite: Phaser.GameObjects.Sprite): void {
    this.tweens.killTweensOf(sprite);
    sprite.clearTint();
    this.tweens.add({
      targets: sprite,
      alpha: 0,
      scaleX: 0.4,
      scaleY: 0.4,
      duration: MOB_DEATH_MS,
      ease: "Quad.easeIn",
      onComplete: () => sprite.setVisible(false),
    });
    const shadow = this.shadowOf(sprite);
    if (shadow) {
      this.tweens.killTweensOf(shadow);
      this.tweens.add({
        targets: shadow,
        alpha: 0,
        duration: MOB_DEATH_MS,
        onComplete: () => shadow.setVisible(false),
      });
    }
  }

  /** Reset a reused mob entry to a fresh, fully-visible state when the server respawns it. */
  private restoreMob(sprite: Phaser.GameObjects.Sprite): void {
    this.tweens.killTweensOf(sprite);
    sprite.clearTint();
    sprite.setScale(1);
    sprite.setAlpha(1);
    sprite.setVisible(true);
    // Snap onto the server's respawn position so it doesn't slide in from the death spot.
    const sx = sprite.getData("serverX") as number | undefined;
    const sy = sprite.getData("serverY") as number | undefined;
    if (typeof sx === "number") sprite.x = sx;
    if (typeof sy === "number") sprite.y = sy;
    const shadow = this.shadowOf(sprite);
    if (shadow) {
      this.tweens.killTweensOf(shadow);
      shadow.setAlpha(1);
      shadow.setVisible(true);
    }
  }

  /** Continuous scale pulse + gentle wobble so legendary drops pop on the grass. */
  private startLegendaryPulse(sprite: Phaser.GameObjects.Sprite): void {
    this.tweens.add({
      targets: sprite,
      scale: 1.28,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    this.tweens.add({
      targets: sprite,
      angle: { from: -8, to: 8 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  /** Spawn a short-lived label that drifts up and fades — used for mesos / level-up feedback. */
  private floatText(x: number, y: number, message: string, color: string): void {
    const label = this.add
      .text(x, y, message, {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "13px",
        color,
        stroke: "#1f2937",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(9000);
    this.tweens.add({
      targets: label,
      y: y - 26,
      alpha: 0,
      duration: 760,
      ease: "Quad.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  private showConnectionError(): void {
    this.add
      .text(
        this.scale.width / 2,
        this.scale.height / 2,
        "Couldn't reach Meadowfield.\nIs the server running?",
        {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: "16px",
          color: "#f6c177",
          align: "center",
        },
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(10_000);
  }
}
