import Phaser from "phaser";
import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import {
  MessageType,
  type InputData,
  type ChatMessage,
  type FerryBlockedPayload,
  type CombatHitPayload,
  type ChannelListPayload,
  type ChannelSwitchResultPayload,
  type WhisperRelayPayload,
  getMap,
  groundYAt,
  ladderAt,
  type Foothold,
  type Ladder,
  type GameMap,
  getNpcsForMap,
  type NpcDef,
  type DialogLinePayload,
  type TravelPayload,
  type JobAdvancePayload,
  type BranchListPayload,
  type RuneSpawnPayload,
  type RuneDespawnPayload,
  type RuneActivatePayload,
  type TreasureSpawnPayload,
  type TreasureHitPayload,
  type TreasureDestroyPayload,
  getMobDef,
} from "@maple/shared";

import {
  BACKEND_URL,
  getAccountId,
  getCharId,
  getCurrentChannel,
  setCurrentChannel,
  getPlayerName,
} from "../backend";
import { keybindings } from "../keybindings";
import type { ActionId } from "@maple/shared";
import {
  TextureKeys,
  TILE_SIZE,
  WarriorAnimDefs,
  MobAnimDefs,
  mobAnimKey,
  mobTextureKey,
  ensureAppearanceTextures,
  appearancePrefix,
} from "../art/textures";
import type { AppearanceParams } from "../art/textures";
import type { TownStateView, PlayerView, MobView, LootView } from "../state-views";
import { getAudioManager } from "../audio/AudioManager";

/**
 * MapScene — the core gameplay scene wired to the authoritative Colyseus map room.
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

// ─── Tunables (mirror of packages/server/src/rooms/MapRoom.ts — keep in sync) ──────────────────
/** Server moves a player this many px per fixed tick. We reuse it for client prediction. */
const PLAYER_SPEED = 2.4;
/** Server's fixed timestep; prediction scales physics by `delta / FIXED_TIMESTEP`. */
const FIXED_TIMESTEP = 1000 / 60;
// ── Platformer physics (mirror of TownRoom.ts — keep in sync) ──────────────────
const GRAVITY = 0.45;
const JUMP_VELOCITY = -8.5;
const MAX_FALL_SPEED = 12;
const FOOTHOLD_SNAP_PX = 4;
/** Pixels per tick when climbing a ladder/rope (mirror of TownRoom.ts). */
const CLIMB_SPEED = 2.2;
/** Horizontal tolerance (px) when snapping onto a ladder (mirror of TownRoom.ts). */
const LADDER_GRAB_TOLERANCE = 28;
// ── Swimming physics (mirror of server — keep in sync) ──────────────────────
const SWIM_GRAVITY = 0.12;
const SWIM_VELOCITY = -3.5;
const SWIM_MAX_FALL = 5;
const SWIM_VERTICAL_SPEED = 2.0;
/** When the server position diverges this far from prediction, hard-snap instead of lerping. */
const RECONCILE_SNAP_THRESHOLD = 8;
/** Lerp factor for soft reconciliation toward the server's authoritative position. */
const RECONCILE_LERP = 0.18;

/** Interpolation factor for remote entities (0 = frozen, 1 = snap). 0.2 ≈ smooth but responsive. */
const REMOTE_LERP = 0.2;
/** Ground render texture sits far below every dynamic sprite (which use y as their depth). */
const GROUND_DEPTH = -1000;
/** Registry key other scenes (UI/Market) read to reuse this room connection. */
const ROOM_REGISTRY_KEY = "room";
/**
 * Registry flag set to `true` while ANY text field in the React overlay is
 * focused (chat, market search, report, character name, …). Set centrally by
 * the input-routing policy (see ui/inputFocus.ts + UIScene.applyTextInputFocus);
 * read here to suppress movement/attack/jump/interact and gate scene hotkeys.
 * Named "chatFocused" for historical reasons — it now covers every text input.
 */
const CHAT_FOCUSED_KEY = "chatFocused";
/** How long (ms) a speech bubble stays visible above a player. */
const SPEECH_BUBBLE_MS = 4000;

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

// ─── Game-feel / juice tunables ──────────────────────────────────────────────────────────────────
/** Max camera-shake intensity (fraction of the viewport). Kept low so shake stays subtle. */
const MAX_SHAKE_INTENSITY = 0.012;
/** Hard cap on simultaneous lightweight hit-spark objects so dense mob packs stay smooth. */
const MAX_HIT_SPARKS = 24;
/** Soft cap on recycled floating damage-number text objects held in the pool. */
const DAMAGE_TEXT_POOL_MAX = 32;
/** Knockback recoil (px) nudged onto a mob on hit; the per-frame server lerp eases it back. */
const MOB_KNOCKBACK_PX = 6;

// ─── NPC rendering ─────────────────────────────────────────────────────
/** Interaction range (px) — matches NPC_INTERACT_RANGE in server MapRoom.ts. */
const NPC_INTERACT_RANGE = 100;
/** Registry key for dialog state (shared with UIScene). */
const DIALOG_STATE_KEY = "dialogState";
/** Registry flag: true while a dialog is open (suppresses chat toggle + game input). */
const DIALOG_OPEN_KEY = "dialogOpen";
/** Registry key for quest notification overlay text (set by Meadowfield, consumed by UIScene). */
const QUEST_NOTIFY_KEY = "questNotify";

/** Map an NPC's spriteKey to the procedural TextureKey for rendering. */
function npcTextureKey(spriteKey: string): string {
  const map: Record<string, string> = {
    "npc.guide_iris": TextureKeys.NpcGuideIris,
    "npc.ferrymaster_cole": TextureKeys.NpcFerryCole,
    "npc.storage_keep": TextureKeys.NpcStorageKeep,
    "npc.elder_willow": TextureKeys.NpcElderWillow,
    "npc.merchant_bram": TextureKeys.NpcMerchantBram,
    "npc.sensei_tanren": TextureKeys.NpcSenseiTanren,
    "npc.crystal_keeper_luna": TextureKeys.NpcCrystalKeeperLuna,
  };
  return map[spriteKey] ?? TextureKeys.NpcGuideIris; // fallback
}

/** WASD movement keys, mapped to the same axes as the arrow keys. */
interface WasdKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
}

export class MapScene extends Phaser.Scene {
  /** The authoritative town room. Undefined until `connect()` resolves. */
  private room?: Room<unknown, TownStateView>;
  /** Our own session id, used to tell the local player apart from remotes. */
  private localSessionId = "";
  /** The local player's sprite — predicted locally and followed by the camera. */
  private localPlayer?: Phaser.GameObjects.Sprite;
  /** Monotonic client input tick, echoed back by the server for (future) reconciliation. */
  private currentTick = 0;

  // ── Local prediction state (platformer physics) ────────────────────────────
  private localVy = 0;
  private localGrounded = true;
  private localClimbing = false;
  private localLadderId = -1;
  private lastJumpHeld = false;

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: WasdKeys;

  private readonly playerSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly playerTags = new Map<string, Phaser.GameObjects.Container>();
  private readonly mobSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly mobHpBars = new Map<string, Phaser.GameObjects.Container>();
  private readonly mobNameplates = new Map<string, Phaser.GameObjects.Container>();
  private readonly lootSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly runeSprites = new Map<string, Phaser.GameObjects.Container>();
  private readonly boxSprites = new Map<string, Phaser.GameObjects.Container>();

  /** Dynamic key refs keyed by action ID — rebuilt on rebind. */
  private readonly actionKeys = new Map<ActionId, Phaser.Input.Keyboard.Key>();
  /** Legacy alias refs kept for backward compat in update() read path. */
  private attackKey?: Phaser.Input.Keyboard.Key;
  private jumpKey?: Phaser.Input.Keyboard.Key;
  private jumpKeyAlt?: Phaser.Input.Keyboard.Key;
  private interactKey?: Phaser.Input.Keyboard.Key;
  /** Local cooldown (ms) gating the swing *visual* so it roughly lines up with server swings. */
  private swingCooldown = 0;
  /** Last time (scene-clock ms) we asked the server to pick up each loot uid — throttles requests. */
  private readonly pickupRequestedAt = new Map<string, number>();
  // ── NPC interaction state ─────────────────────────────────────────
  private readonly npcSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly npcLabels = new Map<string, Phaser.GameObjects.Text>();
  private readonly npcPrompts = new Map<string, Phaser.GameObjects.Text>();
  private readonly npcsForMap: NpcDef[] = [];
  // ── Map data (set from create() data parameter) ─────────────────────────────
  private mapId = "dawn_isle";
  private map!: GameMap;
  private transitioning = false;
  private pendingSpawnId?: string;
  private readonly portalLabels = new Map<string, Phaser.GameObjects.Text>();
  private readonly portalPrompts = new Map<string, Phaser.GameObjects.Text>();
  /** Local player's last-seen mesos / level / exp, used to float gain feedback. */
  private localMesos = 0;
  private localLevel = 1;
  private localExp = 0;
  /** Low-HP vignette overlay (red pulsing rectangle, screen-fixed). */
  private lowHpVignette?: Phaser.GameObjects.Graphics;
  private lowHpPulseActive = false;

  // ── Loot All ─────────────────────────────────────────────────────────
  private lootAllCooldown = 0;
  private readonly LOOT_ALL_COOLDOWN_MS = 300;
  /** Edge-detection for the interact key (rune activation). */
  private lastInteractHeld = false;

  // ── Game-feel pools / caps (object recycling keeps FX cheap with many mobs) ──
  /** Recycled floating damage-number text objects (avoid per-hit alloc/destroy churn). */
  private readonly damageTextPool: Phaser.GameObjects.Text[] = [];
  /** Live lightweight hit-spark count, capped at MAX_HIT_SPARKS for steady framerate. */
  private activeHitSparks = 0;

  // ── Onboarding coach-mark first-action tracking ──────────────────────
  private coachMoveFired = false;
  private coachAttackFired = false;
  private coachJumpFired = false;
  private coachTalkFired = false;

  constructor() {
    super("map");
  }

  async create(data: {
    mapId?: string;
    spawnId?: string;
    channel?: number;
    _welcomeBanner?: string;
    _fromTransition?: boolean;
  }): Promise<void> {
    this.mapId = data?.mapId ?? "dawn_isle";
    this.pendingSpawnId = data?.spawnId;
    this.registry.set("mapId", this.mapId);
    const resolvedMap = getMap(this.mapId);
    if (!resolvedMap) {
      console.error(`[map] unknown map id: ${this.mapId}`);
      return;
    }
    this.map = resolvedMap;
    this.transitioning = false;

    // Kill the loading scene if we arrived via a portal transition.
    if (this.scene.isActive("loading")) {
      this.scene.stop("loading");
    }

    // Camera fade-in for smooth appearance after travel.
    this.cameras.main.fadeIn(400, 0, 0, 0);

    // Start region BGM (crossfades automatically if already playing).
    if (this.map.bgmKey) {
      getAudioManager().playBgm(this.map.bgmKey as import("../audio/AudioManager").BgmKey);
    }

    // World + camera bounds from the map definition.
    this.cameras.main.setBounds(0, 0, this.map.width, this.map.height);
    this.buildBackground();
    this.setupInput();
    this.setupAnimations();

    // HUD overlay runs in parallel; it can read the room off the registry once we connect.
    this.scene.launch("ui");
    // Onboarding coach-marks overlay (runs in parallel, polls registry flags).
    if (!this.scene.isActive("coachmarks")) {
      this.scene.launch("coachmarks");
    }

    // Show "Welcome to <MapName>" banner if supplied (travel or returning character).
    if (data._welcomeBanner) {
      this.showWelcomeBanner(data._welcomeBanner);
    }

    // Low-HP vignette — red screen overlay that pulses when HP is critical.
    this.buildLowHpVignette();

    // Render portals placed on this map.
    this.spawnPortals();

    // Render NPCs placed on this map.
    this.spawnNpcs();

    try {
      await this.connect();
    } catch (err) {
      console.error(`[map] failed to join ${this.mapId}`, err);
      this.showConnectionError();
    }

    // ── Loot All hotkey ──
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      const room = this.room;
      if (!room) return;
      // Suppressed while typing in a React text field (same policy as movement).
      if (this.registry.get(CHAT_FOCUSED_KEY) === true) return;
      const action = keybindings.getActionKey("lootAll");
      if (this.matchLootAllKey(event, action)) {
        this.doLootAll();
      }
    });
  }

  override update(_time: number, delta: number): void {
    const room = this.room;
    if (!room || !this.cursors || !this.wasd || !this.localPlayer) return;

    // 0) Suppress game input while a text field is focused, or settings/dialog open.
    //    `chatFocused` is the central "player is typing in the overlay" flag
    //    (set by UIScene.applyTextInputFocus from ui/inputFocus.ts).
    const chatFocused = this.registry.get(CHAT_FOCUSED_KEY) === true;
    const dialogOpen = this.registry.get(DIALOG_OPEN_KEY) === true;
    const settingsOpen = this.registry.get("settingsOpen") === true;

    // 0.5) Handle channel select target from the ChannelSelect overlay.
    const channelTarget = this.registry.get("channelSelectTarget") as number | undefined;
    if (channelTarget !== undefined && channelTarget !== null) {
      this.registry.set("channelSelectTarget", undefined);
      room.send(MessageType.CHANNEL_SWITCH, { channel: channelTarget });
    }

    // 1) Gather input from arrow keys OR WASD and push it to the authoritative server.
    const suppressed = chatFocused || dialogOpen || settingsOpen;
    const left = !suppressed && (this.cursors.left.isDown || this.wasd.left.isDown);
    const right = !suppressed && (this.cursors.right.isDown || this.wasd.right.isDown);
    const up = !suppressed && (this.cursors.up.isDown || this.wasd.up.isDown);
    const down = !suppressed && (this.cursors.down.isDown || this.wasd.down.isDown);

    // Attack intent: SPACE held OR left mouse button held. The server gates the real swing by its
    // 450ms cooldown and resolves damage — we only forward intent and never apply damage locally.
    const attack =
      !suppressed &&
      ((this.attackKey?.isDown ?? false) || this.input.activePointer.leftButtonDown());

    const jump =
      !suppressed && ((this.jumpKey?.isDown ?? false) || (this.jumpKeyAlt?.isDown ?? false));

    const interact = !suppressed && (this.interactKey?.isDown ?? false);

    const input: InputData = {
      left,
      right,
      up,
      down,
      attack,
      jump,
      interact,
      tick: this.currentTick++,
    };
    room.send(MessageType.INPUT, input);

    // ── Rune activation (edge-triggered interact near a rune) ──
    if (interact && !this.lastInteractHeld && this.localPlayer) {
      for (const [, container] of this.runeSprites) {
        const dist = Phaser.Math.Distance.Between(
          this.localPlayer.x,
          this.localPlayer.y,
          container.x,
          container.y,
        );
        if (dist < 60) {
          room.send(MessageType.RUNE_ACTIVATE);
          break;
        }
      }
    }
    this.lastInteractHeld = interact;

    // ── Onboarding: fire coach-mark flags on first input ──
    if (!this.coachMoveFired && (left || right)) {
      this.coachMoveFired = true;
      this.registry.set("coachmark:move", true);
    }
    if (!this.coachAttackFired && attack) {
      this.coachAttackFired = true;
      this.registry.set("coachmark:attack", true);
    }
    if (!this.coachJumpFired && jump) {
      this.coachJumpFired = true;
      this.registry.set("coachmark:jump", true);
    }

    // 2) Client-side prediction — platformer physics mirroring TownRoom.ts.
    const player = this.localPlayer;
    const serverClimbing = player.getData("serverClimbing") as boolean | undefined;
    const serverDead = player.getData("serverDead") as boolean | undefined;

    if (!serverDead) {
      // ── Reconcile climbing state from server authority ──
      if (serverClimbing && !this.localClimbing) {
        const serverLadderId = player.getData("serverLadderId") as number | undefined;
        this.localClimbing = true;
        this.localLadderId = serverLadderId ?? -1;
        this.localVy = 0;
        this.localGrounded = false;
        this.lastJumpHeld = false;
        this.enterClimbVisual(player);
      } else if (!serverClimbing && this.localClimbing) {
        this.localClimbing = false;
        this.localLadderId = -1;
        this.exitClimbVisual(player);
      }

      if (this.localClimbing) {
        // ── Climbing prediction (mirrors tickClimbing in TownRoom.ts) ──
        this.tickLocalClimbing(player, input, delta);
      } else {
        const dt = delta / FIXED_TIMESTEP;

        // ── Try ladder grab before horizontal movement (mirrors server order) ──
        if (!this.localGrounded) {
          if (up || down) {
            const lad = ladderAt(this.map, player.x, player.y, LADDER_GRAB_TOLERANCE);
            if (lad) this.attachToLadderLocal(player, lad);
          }
        }
        if (this.localGrounded && (up || down) && !this.localClimbing) {
          for (const lad of this.map.ladders) {
            if (Math.abs(lad.x - player.x) > LADDER_GRAB_TOLERANCE) continue;
            if (Math.abs(lad.yTop - player.y) <= FOOTHOLD_SNAP_PX) {
              this.attachToLadderLocal(player, lad);
              player.y = lad.yTop + 1;
              break;
            }
          }
        }

        if (!this.localClimbing) {
          // ── Horizontal velocity (set from latest input, not accumulated) ──
          if (left) {
            player.x -= PLAYER_SPEED * dt;
            player.setFlipX(true);
          } else if (right) {
            player.x += PLAYER_SPEED * dt;
            player.setFlipX(false);
          }
          player.x = Phaser.Math.Clamp(player.x, 0, this.map.width);

          // ── Grounded re-check after horizontal movement (slope follow + walk-off-edge) ──
          if (this.localGrounded) {
            const fh = this.nearestFootholdAt(player.x, player.y);
            if (fh) {
              player.y = groundYAt(fh, player.x);
            } else {
              this.localGrounded = false;
            }
          }

          // ── Jump (edge-triggered: fire only on the rising edge) ──
          if (this.map.swimming) {
            // Swimming: free vertical movement via jump + up/down keys
            if (jump && !this.lastJumpHeld) {
              this.localVy = SWIM_VELOCITY;
              this.localGrounded = false;
            }
            // Hold up to swim upward, hold down to dive
            if (up) {
              this.localVy -= SWIM_VERTICAL_SPEED * 0.3 * dt;
            } else if (down) {
              this.localVy += SWIM_VERTICAL_SPEED * 0.3 * dt;
            }
          } else {
            if (jump && !this.lastJumpHeld && this.localGrounded) {
              this.localVy = JUMP_VELOCITY;
              this.localGrounded = false;
            }
          }
          this.lastJumpHeld = jump;

          if (this.map.swimming) {
            // ── Swimming: buoyant physics with reduced gravity ──
            this.localVy = Phaser.Math.Clamp(
              this.localVy + SWIM_GRAVITY * dt,
              -SWIM_MAX_FALL,
              SWIM_MAX_FALL,
            );
            const prevY = player.y;
            player.y += this.localVy * dt;

            // Still check foothold landing (for seabed collision)
            if (this.localVy >= 0) {
              const fh = this.landingFoothold(player.x, prevY, player.y);
              if (fh) {
                player.y = groundYAt(fh, player.x);
                this.localVy = 0;
                this.localGrounded = true;
              } else {
                this.localGrounded = false;
              }
            }
          } else {
            // ── Gravity + Y integration (airborne only) ──
            if (!this.localGrounded) {
              this.localVy = Math.min(this.localVy + GRAVITY * dt, MAX_FALL_SPEED);
              const prevY = player.y;
              player.y += this.localVy * dt;

              // Landing: check if we crossed a foothold surface while falling.
              if (this.localVy >= 0) {
                const fh = this.landingFoothold(player.x, prevY, player.y);
                if (fh) {
                  player.y = groundYAt(fh, player.x);
                  this.localVy = 0;
                  this.localGrounded = true;
                }
              }
            }
          }

          // ── Clamp Y to map bounds (floor safety net) ──
          if (player.y > this.map.height) {
            player.y = this.map.height;
            this.localVy = 0;
            this.localGrounded = true;
          }
        }
      }
    }

    // ── Soft reconciliation toward the server's authoritative transform ──
    // Skip while waiting for the server to confirm a locally-predicted climb.
    const canReconcile = !this.localClimbing || serverClimbing === true;
    const serverX = player.getData("serverX") as number | undefined;
    const serverY = player.getData("serverY") as number | undefined;
    const serverVy = player.getData("serverVy") as number | undefined;
    const serverGrounded = player.getData("serverGrounded") as boolean | undefined;
    if (canReconcile && serverX !== undefined && serverY !== undefined) {
      const dx = serverX - player.x;
      const dy = serverY - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > RECONCILE_SNAP_THRESHOLD) {
        // Hard snap — we diverged too far (e.g. missed a landing server caught).
        player.x = serverX;
        player.y = serverY;
        if (serverVy !== undefined) this.localVy = serverVy;
        if (serverGrounded !== undefined) this.localGrounded = serverGrounded;
      } else if (dist > 0.5) {
        // Soft lerp — gently pull toward the server without visible hitching.
        player.x += dx * RECONCILE_LERP;
        player.y += dy * RECONCILE_LERP;
        if (serverVy !== undefined) this.localVy += (serverVy - this.localVy) * RECONCILE_LERP;
        if (serverGrounded !== undefined) this.localGrounded = serverGrounded;
      } else {
        // Close enough — adopt server state directly (prevents micro-drift).
        if (serverVy !== undefined) this.localVy = serverVy;
        if (serverGrounded !== undefined) this.localGrounded = serverGrounded;
      }
    }

    // ── Animation update (local player) ──
    const prefix = player.getData("apPrefix") as string | undefined;
    const attackKey = prefix ? `${prefix}_attack` : "warrior_attack";
    const isAttackAnimPlaying =
      player.anims.currentAnim?.key === attackKey && player.anims.isPlaying;
    if (!isAttackAnimPlaying) {
      const moving = left || right;
      const desired = this.getDesiredAnim(
        this.localGrounded,
        this.localVy,
        moving,
        this.localClimbing,
        prefix,
      );
      if (player.anims.currentAnim?.key !== desired) {
        player.play(desired);
      }
    }

    this.applyDepthAndShadow(player);

    // Local swing flourish — throttled to the server cooldown so the cosmetic roughly tracks real
    // swings. Disabled while climbing (attacks are blocked server-side).
    if (this.swingCooldown > 0) this.swingCooldown -= delta;
    if (attack && this.swingCooldown <= 0 && !this.localClimbing) {
      this.playSwing();
      this.swingCooldown = ATTACK_COOLDOWN_MS;
    }

    // 3) Interpolate every remote player toward its last-known server position.
    for (const [sessionId, sprite] of this.playerSprites) {
      if (sessionId === this.localSessionId) continue;
      this.lerpToServer(sprite);
    }

    // 4) Sync floating name tags to final sprite positions (covers both local + remote).
    for (const [sessionId, sprite] of this.playerSprites) {
      const tag = this.playerTags.get(sessionId);
      if (tag) this.syncPlayerTag(sprite, tag);
    }

    // 5) Mobs are server-driven too — interpolate them the same way.
    for (const sprite of this.mobSprites.values()) this.lerpToServer(sprite);
    this.syncMobHpBars();

    // 6) Auto-vacuum the nearest loot drop in range (server re-checks the 60px gate authoritatively).
    this.autoPickupLoot();

    // 7) NPC proximity prompt — show/hide "Press ENTER" above nearby NPCs.
    this.updateNpcPrompts();

    // 8) Portal proximity prompts.
    this.updatePortalPrompts();
  }

  // ─── Connection + state binding ───────────────────────────────────────────────────────────────
  private async connect(): Promise<void> {
    const client = new Client(BACKEND_URL);
    // Use channel-named rooms: `{mapId}__ch{N}` for N>0, bare `{mapId}` for channel 0 (compat).
    const channel = (this.registry.get("channel") as number | undefined) ?? getCurrentChannel();
    const roomName = channel > 0 ? `${this.mapId}__ch${channel}` : this.mapId;
    const room = await client.joinOrCreate<TownStateView>(roomName, {
      name: getPlayerName(),
      accountId: getAccountId(),
      charId: getCharId() ?? undefined,
      spawnId: this.pendingSpawnId,
    });

    this.room = room;
    this.localSessionId = room.sessionId;
    // Publish the live connection so UIScene / MarketScene reuse this socket instead of a new one.
    this.registry.set(ROOM_REGISTRY_KEY, room);
    this.registry.set(CHAT_FOCUSED_KEY, false);

    room.onError((code, message) => console.error(`[map] room error ${code}: ${message ?? ""}`));
    room.onLeave((code) => console.warn(`[map] left ${this.mapId} (code ${code})`));

    this.bindState(room);
    this.bindChat(room);
  }

  /** Attach all add/change/remove listeners. `getStateCallbacks` is the verified 0.17 SDK API. */
  private bindState(room: Room<unknown, TownStateView>): void {
    const $ = getStateCallbacks(room);

    // ── Players ──
    $(room.state).players.onAdd((player: PlayerView, sessionId: string) => {
      // Resolve appearance and generate textures if needed.
      const ap: AppearanceParams = {
        skinId: player.skinId || "skin_light",
        hairId: player.hairId || "hair_short",
        hairColorId: player.hairColorId || "color_brown",
        faceId: player.faceId || "face_default",
        outfitId: player.outfitId || "outfit_tunic",
      };
      ensureAppearanceTextures(this, ap);
      const prefix = appearancePrefix(ap);
      const startKey = `${prefix}_idle_0`;

      const sprite = this.add.sprite(
        player.x,
        player.y,
        this.textures.exists(startKey) ? startKey : TextureKeys.WarriorIdle0,
      );
      sprite.setData("apPrefix", prefix);
      sprite.setFlipX(player.facing === -1);
      this.attachShadow(sprite);
      this.playerSprites.set(sessionId, sprite);

      // Right-click context menu for non-local players.
      if (sessionId !== this.localSessionId) {
        sprite.setInteractive({ useHandCursor: true });
        sprite.on("pointerdown", (_pointer: Phaser.Input.Pointer) => {
          if (_pointer.rightButtonDown()) {
            this.game.events.emit("player-rightclick", {
              sessionId,
              name: player.name,
              worldX: _pointer.worldX,
              worldY: _pointer.worldY,
            });
          }
        });
      }

      // Floating name + level tag (shared by local and remote).
      const tag = this.createPlayerTag(player.name, player.level, player.equippedTitle);
      this.playerTags.set(sessionId, tag);

      if (sessionId === this.localSessionId) {
        // LOCAL player → prediction drives it and the camera follows it.
        this.localPlayer = sprite;
        // Tight horizontal follow (0.15), smooth vertical (0.08) so jumping
        // doesn't jerk the camera. A deadzone was considered but Phaser's
        // deadzone overrides lerp with instant snaps — asymmetric lerp is smoother.
        this.cameras.main.startFollow(sprite, true, 0.15, 0.08);

        // Seed prediction state from the authoritative server snapshot.
        this.localVy = player.vy;
        this.localGrounded = player.grounded;
        this.localClimbing = player.climbing;
        this.localLadderId = player.ladderId;
        this.storeServerTransform(
          sprite,
          player.x,
          player.y,
          player.facing,
          player.vy,
          player.grounded,
          player.climbing,
          player.dead,
          player.ladderId,
        );
        if (player.climbing) this.enterClimbVisual(sprite);

        // Float "+N mesos" / "+N EXP" / "LEVEL UP!" whenever an authoritative reward lands on us.
        this.localMesos = player.mesos;
        this.localLevel = player.level;
        this.localExp = player.exp;
        $(player).onChange(() => {
          // Keep server transform fresh for reconciliation in update().
          this.storeServerTransform(
            sprite,
            player.x,
            player.y,
            player.facing,
            player.vy,
            player.grounded,
            player.climbing,
            player.dead,
            player.ladderId,
          );

          if (player.mesos > this.localMesos) {
            const gain = player.mesos - this.localMesos;
            this.floatText(sprite.x, sprite.y - 26, `+${gain} mesos`, "#ffe9a8");
          }

          // EXP gain — only when level hasn't changed (avoids stale spike on level-up reset).
          if (player.exp > this.localExp && player.level === this.localLevel) {
            const gain = player.exp - this.localExp;
            this.floatText(sprite.x + 22, sprite.y - 26, `+${gain} EXP`, "#9ad06b");
          }

          if (player.level > this.localLevel) {
            this.playLevelUpBurst(sprite.x, sprite.y);
          }
          this.localMesos = player.mesos;
          this.localLevel = player.level;
          this.localExp = player.exp;

          // Low-HP vignette — update whenever HP changes.
          this.updateLowHpVignette(player.hp, player.maxHp);

          const t = this.playerTags.get(sessionId);
          if (t) this.updatePlayerTagText(t, player.name, player.level, player.equippedTitle);

          // Re-render if appearance changed (e.g. cash-shop equip).
          this.syncPlayerAppearance(sprite, player);
        });
      } else {
        // REMOTE player → stash server transform for interpolation in update().
        this.storeServerTransform(
          sprite,
          player.x,
          player.y,
          player.facing,
          player.vy,
          player.grounded,
          player.climbing,
          undefined,
          player.ladderId,
        );
        $(player).onChange(() => {
          this.storeServerTransform(
            sprite,
            player.x,
            player.y,
            player.facing,
            player.vy,
            player.grounded,
            player.climbing,
            undefined,
            player.ladderId,
          );
          const t = this.playerTags.get(sessionId);
          if (t) this.updatePlayerTagText(t, player.name, player.level, player.equippedTitle);
          this.syncPlayerAppearance(sprite, player);
        });
      }
      this.applyDepthAndShadow(sprite);
    });

    $(room.state).players.onRemove((_player: PlayerView, sessionId: string) => {
      this.destroyTracked(this.playerSprites, sessionId);
      const tag = this.playerTags.get(sessionId);
      if (tag) {
        tag.destroy();
        this.playerTags.delete(sessionId);
      }
      if (sessionId === this.localSessionId) this.localPlayer = undefined;
    });

    // ── Mobs ──
    $(room.state).mobs.onAdd((mob: MobView, key: string) => {
      const sprite = this.add.sprite(mob.x, mob.y, mobTextureKey(mob.mobId));
      sprite.setFlipX(mob.facing === -1);
      this.storeServerTransform(sprite, mob.x, mob.y, mob.facing);
      this.attachShadow(sprite);
      sprite.play(mobAnimKey(mob.mobId));
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
      sprite.setData("mobId", mob.mobId);
      sprite.setData("isElite", mob.isElite);

      // Elite visual treatment: golden tint + slight scale-up + nameplate.
      if (mob.isElite) {
        sprite.setTint(0xffd700);
        sprite.setScale(1.2);
        // Nameplate: "Elite <baseName>" in gold above the mob.
        const baseDefName = getMobDef(mob.mobId)?.name ?? mob.mobId;
        const nameText = this.add
          .text(0, 0, `★ Elite ${baseDefName} ★`, {
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: "10px",
            color: "#ffd700",
            stroke: "#1a1a2e",
            strokeThickness: 2,
            align: "center",
          })
          .setOrigin(0.5);
        const nameContainer = this.add.container(
          sprite.x,
          sprite.y - sprite.displayHeight / 2 - 16,
          [nameText],
        );
        nameContainer.setDepth(mob.y + 3);
        this.mobNameplates.set(key, nameContainer);
      }

      // Mob HP bar (only shown when damaged).
      const hpBarW = 36;
      const hpBarH = 4;
      const hpTrack = this.add.graphics();
      hpTrack.fillStyle(0x0c1019, 0.85).fillRoundedRect(-hpBarW / 2, 0, hpBarW, hpBarH, 2);
      const hpFill = this.add.graphics();
      const hpContainer = this.add.container(mob.x, mob.y - sprite.displayHeight / 2 - 8, [
        hpTrack,
        hpFill,
      ]);
      hpContainer.setDepth(mob.y + 2).setVisible(false);
      hpContainer.setData("fill", hpFill);
      hpContainer.setData("w", hpBarW);
      hpContainer.setData("h", hpBarH);
      this.mobHpBars.set(key, hpContainer);

      $(mob).onChange(() => {
        this.storeServerTransform(sprite, mob.x, mob.y, mob.facing);

        const wasDead = sprite.getData("dead") === true;
        const wasHit = sprite.getData("hit") === true;

        // React to transitions only — onChange also fires on every wander step, so diff vs. last
        // state. The same map entry is revived server-side, so dead→alive restores the sprite.
        if (mob.dead && !wasDead) this.playMobDeath(sprite);
        else if (!mob.dead && wasDead) this.restoreMob(sprite);
        else if (mob.hit && !wasHit) this.flashMob(sprite);

        // Show HP bar when damaged.
        if (!mob.dead && mob.hp < mob.maxHp) {
          hpContainer.setVisible(true);
          const ratio = mob.maxHp > 0 ? Phaser.Math.Clamp(mob.hp / mob.maxHp, 0, 1) : 0;
          this.drawMobHpFill(hpFill, hpBarW, ratio);
        }

        // Hide HP bar when dead or full.
        if (mob.dead || mob.hp >= mob.maxHp) {
          hpContainer.setVisible(false);
        }

        sprite.setData("dead", mob.dead);
        sprite.setData("hit", mob.hit);
      });
    });

    $(room.state).mobs.onRemove((_mob: MobView, key: string) => {
      this.destroyTracked(this.mobSprites, key);
      const hpBar = this.mobHpBars.get(key);
      if (hpBar) {
        hpBar.destroy();
        this.mobHpBars.delete(key);
      }
      const nameplate = this.mobNameplates.get(key);
      if (nameplate) {
        nameplate.destroy();
        this.mobNameplates.delete(key);
      }
    });

    // ── Loot drops (no shadow — they sit flat on the grass) ──
    $(room.state).loot.onAdd((loot: LootView, uid: string) => {
      const key = loot.legendary ? TextureKeys.LootGemLegendary : TextureKeys.LootGem;
      const sprite = this.add.sprite(loot.x, loot.y, key);
      sprite.setDepth(loot.y);
      this.lootSprites.set(uid, sprite);

      // Play loot drop SFX.
      getAudioManager().playSfx(loot.legendary ? "legendary_drop" : "loot_drop");

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

    // ── Dialog system ──
    room.onMessage(MessageType.DIALOG, (payload: DialogLinePayload) => {
      this.registry.set(DIALOG_STATE_KEY, {
        open: true,
        npcId: payload.npcId,
        npcName: payload.npcName,
        text: payload.text,
        choices: payload.choices ?? null,
        hasNext: payload.hasNext ?? false,
      });
      this.registry.set(DIALOG_OPEN_KEY, true);
    });

    room.onMessage(MessageType.DIALOG_END, () => {
      this.registry.set(DIALOG_STATE_KEY, null);
      this.registry.set(DIALOG_OPEN_KEY, false);
    });

    // ── Server-triggered actions ──
    room.onMessage("shop_open", (payload: { shopId: string }) => {
      if (payload.shopId === "shop.cash") {
        this.openCashShop();
      } else {
        this.openGeneralStore(payload.shopId);
      }
    });

    room.onMessage(MessageType.BRANCH_LIST, (payload: BranchListPayload) => {
      // Forward the branch list to the UI scene via the registry.
      this.registry.set("branchList", payload);
    });

    room.onMessage(MessageType.JOB_ADVANCE, (payload: JobAdvancePayload) => {
      console.log(`[map] job_advance: ${payload.message}`);
      if (payload.success) {
        // Play a celebratory advancement effect on the local player.
        this.playAdvancementEffect(payload.branchId);
        // Clear the branch list if it was open.
        this.registry.set("branchList", null);
      }
    });

    room.onMessage(MessageType.TRAVEL, (payload: TravelPayload) => {
      if (this.transitioning) return;
      this.transitioning = true;

      const destMap = getMap(payload.mapId);
      const destName = destMap?.name ?? payload.mapId;

      // Play portal SFX.
      getAudioManager().playSfx("portal");

      // Disconnect from current room (fire-and-forget — server cleans up).
      this.room?.leave();
      this.room = undefined;

      // Show the loading screen with the destination map name.
      this.scene.launch("loading", { mapName: destName });

      // Fade out then hand off to a fresh MapScene instance for the destination.
      this.cameras.main.fade(400, 0, 0, 0);
      this.time.delayedCall(500, () => {
        this.scene.start("map", {
          mapId: payload.mapId,
          spawnId: payload.spawnId,
          _welcomeBanner: destName,
        });
      });
    });

    room.onMessage(MessageType.USE_PORTAL, (payload: FerryBlockedPayload) => {
      const player = this.localPlayer;
      if (player) {
        this.floatText(player.x, player.y - 40, payload.message, "#f6c177");
      }
    });

    // ── Channel system ──
    room.onMessage(MessageType.CHANNEL_LIST, (payload: ChannelListPayload) => {
      this.registry.set("channelList", payload);
      this.registry.set("mapId", this.mapId);
    });

    room.onMessage(MessageType.CHANNEL_SWITCH_RESULT, (payload: ChannelSwitchResultPayload) => {
      if (this.transitioning) return;
      this.transitioning = true;

      setCurrentChannel(payload.channel);

      // Leave current room and rejoin the target channel.
      this.room?.leave();
      this.room = undefined;

      const destMap = getMap(payload.mapId);
      const destName = destMap?.name ?? payload.mapId;
      this.scene.launch("loading", { mapName: destName });

      this.cameras.main.fade(300, 0, 0, 0);
      this.time.delayedCall(350, () => {
        this.scene.start("map", {
          mapId: payload.mapId,
          spawnId: payload.spawnId,
          channel: payload.channel,
          _welcomeBanner: destName,
        });
      });
    });

    room.onMessage(MessageType.WHISPER_RELAY, (payload: WhisperRelayPayload) => {
      // Show whisper in the registry so UI can display it.
      this.registry.set("whisperReceived", {
        senderName: payload.senderName,
        text: payload.text,
      });
    });

    room.onMessage(
      MessageType.WHISPER_FAILED,
      (payload: { targetName: string; reason: string }) => {
        this.registry.set("whisperFailed", payload);
      },
    );

    room.onMessage(
      MessageType.QUEST_UPDATE,
      (payload: { quests: { questId: string; name: string; status: string }[] }) => {
        // Show a floating notification when a new quest is accepted.
        for (const q of payload.quests) {
          if (q.status === "active") {
            this.registry.set(QUEST_NOTIFY_KEY, `📋 Quest accepted: ${q.name}`);
            getAudioManager().playSfx("quest_complete");
          }
        }
      },
    );

    // ── Achievement unlock: show title reward float text ──
    room.onMessage(
      MessageType.ACHIEVEMENT_UNLOCK,
      (payload: {
        achievementId: string;
        name: string;
        description: string;
        rewards: { mesos?: number; exp?: number; title?: string };
      }) => {
        if (payload.rewards.title && this.localPlayer) {
          this.floatText(
            this.localPlayer.x,
            this.localPlayer.y - 40,
            `\ud83c\udfc5 Title: ${payload.rewards.title}`,
            "#facc15",
          );
          getAudioManager().playSfx("levelup");
        }
      },
    );

    // ── Combat feedback: floating damage / miss numbers ──
    room.onMessage(MessageType.COMBAT_HIT, (payload: CombatHitPayload) => {
      if (payload.hit) {
        getAudioManager().playSfx(payload.crit ? "crit" : "hit");
      }
      if (payload.targetKey) {
        const mobSprite = this.mobSprites.get(payload.targetKey);
        if (mobSprite) {
          this.showCombatNumber(
            mobSprite.x,
            mobSprite.y - mobSprite.displayHeight / 2 - 10,
            payload,
          );
          // Impact frame: knockback recoil away from the attacker on a connecting hit.
          // We nudge the sprite directly; lerpToServer() eases it back to the
          // authoritative position over the next few frames (no tween/lerp fight).
          if (payload.hit) {
            const attacker = this.playerSprites.get(payload.attackerSession);
            const dir = attacker
              ? Math.sign(mobSprite.x - attacker.x) || 1
              : mobSprite.flipX
                ? -1
                : 1;
            mobSprite.x += dir * MOB_KNOCKBACK_PX * (payload.crit ? 1.6 : 1);
          }
        }
        // A landed crit from the LOCAL player gives a subtle camera kick.
        if (payload.hit && payload.crit && payload.attackerSession === this.localSessionId) {
          this.shakeCamera(0.28, 120);
        }
        // Update mob HP bar if present.
        const hpBar = this.mobHpBars.get(payload.targetKey);
        if (hpBar) {
          const fill = hpBar.getData("fill") as Phaser.GameObjects.Graphics | undefined;
          if (fill && payload.mobMaxHp > 0) {
            const ratio = Phaser.Math.Clamp(payload.mobHp / payload.mobMaxHp, 0, 1);
            this.drawMobHpFill(fill, hpBar.getData("w") as number, ratio);
          }
        }
      }
    });

    // ── Mob → player hit feedback (server broadcasts "mob_hit_player") ──
    room.onMessage(
      "mob_hit_player",
      (payload: {
        mobId: string;
        sessionId: string;
        damage: number;
        crit: boolean;
        hp: number;
        dead: boolean;
      }) => {
        getAudioManager().playSfx("mob_hit_player");
        const sprite = this.playerSprites.get(payload.sessionId);
        if (!sprite) return;
        this.showCombatNumber(sprite.x, sprite.y - sprite.displayHeight / 2 - 10, {
          targetKey: "",
          attackerSession: "",
          damage: payload.damage,
          crit: payload.crit,
          hit: true,
          mobHp: 0,
          mobMaxHp: 0,
        });
        // Brief white flash on the struck player for a readable impact frame.
        sprite.setTintFill(0xffffff);
        this.time.delayedCall(90, () => {
          if (sprite.active) sprite.clearTint();
        });
        // Camera shake only when the LOCAL player is struck — scaled by damage,
        // amplified on crits and boss slams (kept subtle by MAX_SHAKE_INTENSITY).
        if (payload.sessionId === this.localSessionId) {
          const isBoss = getMobDef(payload.mobId)?.isBoss === true;
          const base = Phaser.Math.Clamp(payload.damage / 80, 0.15, 1);
          const intensity = base * (payload.crit ? 1.3 : 1) * (isBoss ? 1.7 : 1);
          const duration = isBoss ? 340 : payload.crit ? 220 : 150;
          this.shakeCamera(intensity, duration);
        }
      },
    );

    // ── Runes ──
    room.onMessage(MessageType.RUNE_SPAWN, (payload: RuneSpawnPayload) => {
      const colors: Record<string, number> = { exp: 0xffd700, speed: 0x00ccff, atk: 0xff4444 };
      const labels: Record<string, string> = { exp: "✦", speed: "»", atk: "⚔" };
      const color = colors[payload.runeType] ?? 0xffffff;
      const glyph = labels[payload.runeType] ?? "?";

      const glow = this.add.circle(payload.x, payload.y, 16, color, 0.35);
      const inner = this.add.circle(payload.x, payload.y, 7, color, 0.9);
      const symbol = this.add
        .text(payload.x, payload.y, glyph, {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: "14px",
          color: "#ffffff",
        })
        .setOrigin(0.5);

      const container = this.add.container(payload.x, payload.y, [glow, inner, symbol]);
      container.setDepth(payload.y);
      this.tweens.add({
        targets: glow,
        scale: { from: 0.8, to: 1.4 },
        alpha: { from: 0.25, to: 0.65 },
        duration: 800,
        yoyo: true,
        repeat: -1,
      });
      this.runeSprites.set(payload.runeId, container);
    });

    room.onMessage(MessageType.RUNE_DESPAWN, (payload: RuneDespawnPayload) => {
      const c = this.runeSprites.get(payload.runeId);
      if (c) {
        this.tweens.killTweensOf(c);
        c.destroy();
        this.runeSprites.delete(payload.runeId);
      }
    });

    room.onMessage(MessageType.RUNE_ACTIVATE, (payload: RuneActivatePayload) => {
      const c = this.runeSprites.get(payload.runeId);
      if (c) {
        this.tweens.killTweensOf(c);
        c.destroy();
        this.runeSprites.delete(payload.runeId);
      }
      const player = this.localPlayer;
      if (player) {
        this.floatText(
          player.x,
          player.y - 40,
          `✦ ${payload.buffName}! (${payload.durationSec}s)`,
          "#ffd700",
        );
      }
      getAudioManager().playSfx("levelup");
    });

    // ── Treasure Boxes ──
    room.onMessage(MessageType.TREASURE_SPAWN, (payload: TreasureSpawnPayload) => {
      const body = this.add.rectangle(0, 0, 24, 18, 0x8b4513);
      const lid = this.add.rectangle(0, -10, 26, 8, 0xa0522d);
      const latch = this.add.rectangle(0, -6, 4, 4, 0xffd700);
      const container = this.add.container(payload.x, payload.y, [body, lid, latch]);
      container.setDepth(payload.y);
      this.tweens.add({
        targets: container,
        y: payload.y - 3,
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      this.boxSprites.set(payload.boxId, container);
    });

    room.onMessage(MessageType.TREASURE_HIT, (payload: TreasureHitPayload) => {
      const c = this.boxSprites.get(payload.boxId);
      if (c) {
        // Flash white then restore
        c.list.forEach((child) => {
          if (child instanceof Phaser.GameObjects.Rectangle) {
            child.setFillStyle(0xffffff);
          }
        });
        this.time.delayedCall(80, () => {
          const cols = [0x8b4513, 0xa0522d, 0xffd700];
          c.list.forEach((child, i) => {
            if (child instanceof Phaser.GameObjects.Rectangle) {
              child.setFillStyle(cols[i] ?? 0x8b4513);
            }
          });
        });
        this.floatText(c.x, c.y - 20, "50", "#ffffff");
      }
    });

    room.onMessage(MessageType.TREASURE_DESTROY, (payload: TreasureDestroyPayload) => {
      const c = this.boxSprites.get(payload.boxId);
      if (c) {
        this.tweens.killTweensOf(c);
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const dot = this.add.circle(c.x, c.y, 3, 0xffd700, 0.9).setDepth(9999);
          this.tweens.add({
            targets: dot,
            x: c.x + Math.cos(angle) * 40,
            y: c.y + Math.sin(angle) * 40,
            alpha: 0,
            duration: 400,
            onComplete: () => dot.destroy(),
          });
        }
        c.destroy();
        this.boxSprites.delete(payload.boxId);
        this.floatText(c.x + 10, c.y - 10, `+${payload.exp} EXP`, "#9ad06b");
        this.floatText(c.x - 10, c.y - 26, `+${payload.mesos} mesos`, "#ffe9a8");
      }
      getAudioManager().playSfx("loot_drop");
    });
  }

  // ─── Chat: speech bubbles ───────────────────────────────────────────────────────────────────────
  /** Listen for CHAT broadcasts and show a short-lived speech bubble above the speaker. */
  private bindChat(room: Room<unknown, TownStateView>): void {
    room.onMessage(MessageType.CHAT, (msg: ChatMessage) => {
      const sprite = this.playerSprites.get(msg.sessionId);
      if (!sprite) return;
      this.showSpeechBubble(sprite, msg.text);
    });
  }

  /** Pop a rounded speech bubble above a player sprite that fades after SPEECH_BUBBLE_MS. */
  private showSpeechBubble(sprite: Phaser.GameObjects.Sprite, text: string): void {
    const bubbleText = this.add
      .text(0, 0, text, {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "11px",
        color: "#1a1a2e",
        wordWrap: { width: 160 },
        align: "center",
      })
      .setOrigin(0.5);

    const pad = 6;
    const bw = bubbleText.width + pad * 2;
    const bh = bubbleText.height + pad * 2;
    const bg = this.add.graphics();
    bg.fillStyle(0xffffff, 0.92);
    bg.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 8);
    bg.lineStyle(1, 0xcccccc, 0.8);
    bg.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 8);
    // Small triangle pointer.
    bg.fillTriangle(-4, bh / 2, 4, bh / 2, 0, bh / 2 + 6);

    const container = this.add.container(sprite.x, sprite.y - sprite.displayHeight / 2 - 22, [
      bg,
      bubbleText,
    ]);
    container.setDepth(9500);

    this.tweens.add({
      targets: container,
      y: container.y - 6,
      duration: SPEECH_BUBBLE_MS,
      ease: "Linear",
      onComplete: () => container.destroy(),
    });
  }

  // ─── Mob HP bars ──────────────────────────────────────────────────────────────────────────────
  /** Draw the mob HP bar fill for a given [0,1] ratio. */
  private drawMobHpFill(g: Phaser.GameObjects.Graphics, w: number, ratio: number): void {
    const r = Phaser.Math.Clamp(ratio, 0, 1);
    g.clear();
    if (r <= 0) return;
    const fw = Math.max(w * r, 1);
    const color = ratio > 0.5 ? 0xef4444 : ratio > 0.25 ? 0xf97316 : 0xdc2626;
    g.fillStyle(color, 0.9);
    g.fillRoundedRect(-w / 2, 0, fw, 4, 2);
  }

  /** Reposition mob HP bars and elite nameplates to follow their parent sprites each frame. */
  private syncMobHpBars(): void {
    for (const [key, sprite] of this.mobSprites) {
      const hpBar = this.mobHpBars.get(key);
      if (hpBar && hpBar.visible) {
        hpBar.setPosition(sprite.x, sprite.y - sprite.displayHeight / 2 - 8);
        hpBar.setDepth(sprite.y + 2);
      }
      const nameplate = this.mobNameplates.get(key);
      if (nameplate && nameplate.visible) {
        nameplate.setPosition(sprite.x, sprite.y - sprite.displayHeight / 2 - 16);
        nameplate.setDepth(sprite.y + 3);
      }
    }
  }

  // ─── Rendering helpers ────────────────────────────────────────────────────────────────────────
  /** Bake the scenic terrain (parallax layers + platforms from MeadowfieldMap footholds) into a render texture. */
  private buildBackground(): void {
    this.buildParallaxLayers();

    const gfx = this.make.graphics();

    // ── Terrain from footholds (sky is handled by the parallax sky layer) ──
    for (const fh of this.map.footholds) {
      this.drawTerrainPlatform(gfx, fh);
    }

    // ── Bake into render texture ──
    const TERRAIN_KEY = `__terrain_${this.mapId}`;
    if (this.textures.exists(TERRAIN_KEY)) {
      this.textures.remove(TERRAIN_KEY);
    }
    gfx.generateTexture(TERRAIN_KEY, this.map.width, this.map.height);
    gfx.destroy();

    const ground = this.add.renderTexture(0, 0, this.map.width, this.map.height).setOrigin(0, 0);
    ground.setDepth(GROUND_DEPTH);
    ground.draw(TERRAIN_KEY, 0, 0);
    this.textures.remove(TERRAIN_KEY);

    // ── Overlay the real CC0 grass/dirt tileset on top of the coloured base ──
    for (const fh of this.map.footholds) {
      this.stampTerrainTiles(ground, fh);
    }

    // ── Ladder / rope visuals ──
    for (const lad of this.map.ladders) {
      const texKey = lad.kind === "rope" ? TextureKeys.LadderRope : TextureKeys.LadderWood;
      const frame = this.textures.get(texKey).get();
      const tw = frame.width;
      const span = lad.yBottom - lad.yTop;
      const tile = this.add.tileSprite(lad.x, lad.yTop + span / 2, tw, span, texKey);
      // In front of terrain (-1000) but behind every sprite (depth = y ≥ 180)
      tile.setDepth(GROUND_DEPTH + 1);
    }
  }

  /**
   * Stamp the real grass-cap + dirt tiles across a foothold, on top of the coloured base fill.
   * Tiles are placed only where they fit fully inside the platform; the matching-coloured base
   * fills the sub-tile edge strips and any slope stair-steps, so there are no gaps or overhang.
   */
  private stampTerrainTiles(ground: Phaser.GameObjects.RenderTexture, fh: Foothold): void {
    const T = TILE_SIZE;
    const minX = Math.min(fh.x1, fh.x2);
    const maxX = Math.max(fh.x1, fh.x2);
    const isGround = fh.solid === true;
    for (let x = minX; x + T <= maxX; x += T) {
      const surfY = groundYAt(fh, x + T / 2);
      const bottom = isGround ? this.map.height : surfY + 55;
      // Grass cap sits just above the surface line.
      ground.draw(TextureKeys.TerrainGrassTop, x, surfY - 6);
      // Dirt body fills downward; only whole tiles, base covers the remainder.
      for (let y = surfY + 26; y + T <= bottom; y += T) {
        ground.draw(TextureKeys.TerrainDirt, x, y);
      }
    }
  }

  /**
   * Create 3 scrolling parallax layers behind the terrain render texture.
   * Each layer uses setScrollFactor < 1 so it drifts slower than the camera,
   * giving depth as the player moves across the 1600×900 map.
   */
  private buildParallaxLayers(): void {
    // Far sky — barely moves, anchors the top of the screen.
    this.add
      .tileSprite(0, 0, this.map.width + 400, this.map.height, TextureKeys.ParallaxSky)
      .setOrigin(0, 0)
      .setScrollFactor(0.1, 0)
      .setDepth(GROUND_DEPTH - 3);

    // Mid hills — gentle drift.
    const hillH = 350;
    this.add
      .tileSprite(
        0,
        this.map.height - hillH,
        this.map.width + 800,
        hillH,
        TextureKeys.ParallaxHills,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0.3, 0)
      .setDepth(GROUND_DEPTH - 2);

    // Near trees — noticeable but still slower than the terrain.
    const treeH = 280;
    this.add
      .tileSprite(
        0,
        this.map.height - treeH,
        this.map.width + 1200,
        treeH,
        TextureKeys.ParallaxTrees,
      )
      .setOrigin(0, 0)
      .setScrollFactor(0.6, 0)
      .setDepth(GROUND_DEPTH - 1);
  }

  /**
   * Draw a single terrain platform (grass cap + dirt body + outline) for a foothold.
   * Slopes follow the segment angle via groundYAt sampling.
   */
  private drawTerrainPlatform(gfx: Phaser.GameObjects.Graphics, fh: Foothold): void {
    const minX = Math.min(fh.x1, fh.x2);
    const maxX = Math.max(fh.x1, fh.x2);
    const isGround = fh.solid === true;
    const GRASS_HALF = 4;
    const DIRT_DEPTH = 55;

    // Sample surface y along the foothold
    const surfPts: { x: number; y: number }[] = [];
    const step = 4;
    for (let x = minX; x <= maxX; x += step) {
      surfPts.push({ x, y: groundYAt(fh, x) });
    }
    // Ensure exact endpoint
    const lastY = groundYAt(fh, maxX);
    const last = surfPts[surfPts.length - 1];
    if (!last || Math.abs(last.x - maxX) > 0.01) {
      surfPts.push({ x: maxX, y: lastY });
    }

    const count = surfPts.length;

    // ── Grass cap polygon (surface ± GRASS_HALF) ──
    const grassTop: { x: number; y: number }[] = [];
    const grassBot: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const p = surfPts[i];
      if (p) {
        grassTop.push({ x: p.x, y: p.y - GRASS_HALF });
        grassBot.push({ x: p.x, y: p.y + GRASS_HALF });
      }
    }
    gfx.fillStyle(0x72b540, 1);
    gfx.fillPoints([...grassTop, ...grassBot.reverse()], true, true);

    // ── Dirt body polygon ──
    const dirtTop: { x: number; y: number }[] = [];
    const dirtBot: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const p = surfPts[i];
      if (p) {
        dirtTop.push({ x: p.x, y: p.y + GRASS_HALF });
        dirtBot.push({ x: p.x, y: isGround ? this.map.height : p.y + DIRT_DEPTH });
      }
    }
    gfx.fillStyle(0x9b7642, 1);
    gfx.fillPoints([...dirtTop, ...dirtBot.reverse()], true, true);

    // ── Darker bottom band for depth (floating platforms only) ──
    if (!isGround) {
      const bandDepth = 10;
      const darkTop: { x: number; y: number }[] = [];
      const darkBot: { x: number; y: number }[] = [];
      for (let i = 0; i < count; i++) {
        const p = surfPts[i];
        if (p) {
          darkTop.push({ x: p.x, y: p.y + DIRT_DEPTH - bandDepth });
          darkBot.push({ x: p.x, y: p.y + DIRT_DEPTH });
        }
      }
      gfx.fillStyle(0x7a5c30, 0.35);
      gfx.fillPoints([...darkTop, ...darkBot.reverse()], true, true);
    }

    // ── Dirt grain speckles ──
    gfx.fillStyle(0x6b5230, 0.3);
    const speckStep = 16;
    for (let sx = minX + 8; sx < maxX; sx += speckStep) {
      const sy = groundYAt(fh, sx);
      const bottom = isGround ? this.map.height : sy + DIRT_DEPTH;
      const speckY = sy + GRASS_HALF + 8 + ((sx * 7) % 12);
      if (speckY < bottom - 4) {
        gfx.fillRect(sx, speckY, 2, 2);
      }
    }

    // ── Grass blade silhouettes along top edge ──
    gfx.fillStyle(0x5ea035, 0.7);
    for (let x = minX + 2; x < maxX; x += 5) {
      const y = groundYAt(fh, x);
      const bladeH = 2 + ((x * 7) % 3);
      gfx.fillTriangle(x - 1, y - GRASS_HALF, x + 1, y - GRASS_HALF, x, y - GRASS_HALF - bladeH);
    }

    // ── Outline around combined shape ──
    const outlineTop: { x: number; y: number }[] = [];
    const outlineBot: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const p = surfPts[i];
      if (p) {
        outlineTop.push({ x: p.x, y: p.y - GRASS_HALF });
        outlineBot.push({ x: p.x, y: isGround ? this.map.height : p.y + DIRT_DEPTH });
      }
    }
    gfx.lineStyle(1.5, 0x5a3d1e, 0.45);
    gfx.strokePoints([...outlineTop, ...outlineBot.reverse()], true, true);
  }

  /** Resolve a Phaser.KeyCodes string to the numeric enum value, with fallback. */
  private static resolveKeyCode(name: string): number {
    const code =
      Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes];
    return code ?? Phaser.Input.Keyboard.KeyCodes.SPACE;
  }

  /** Bind a single action to a Phaser key from the keybinding service. */
  private bindActionKey(action: ActionId): Phaser.Input.Keyboard.Key {
    const code = MapScene.resolveKeyCode(keybindings.getActionKey(action));
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("[map] cannot bind action key: keyboard input unavailable");
    }
    const key = keyboard.addKey(code, true);
    this.actionKeys.set(action, key);
    return key;
  }

  /** Rebind a live action (destroys old key, creates new one). */
  rebindAction(action: ActionId): void {
    const old = this.actionKeys.get(action);
    if (old) old.destroy();
    const key = this.bindActionKey(action);
    // Update legacy aliases used in update().
    if (action === "attack") this.attackKey = key;
    else if (action === "jump") this.jumpKey = key;
    else if (action === "jumpAlt") this.jumpKeyAlt = key;
    else if (action === "interact") this.interactKey = key;
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

    // Bind action keys from the keybinding service.
    this.attackKey = this.bindActionKey("attack");
    this.jumpKey = this.bindActionKey("jump");
    this.jumpKeyAlt = this.bindActionKey("jumpAlt");
    this.interactKey = this.bindActionKey("interact");

    // Bind arrow-movement actions from the keybinding service.
    this.bindActionKey("moveLeft");
    this.bindActionKey("moveRight");
    this.bindActionKey("moveUp");
    this.bindActionKey("moveDown");

    // Market / Cash Shop open via keybinding service.
    keyboard.on("keydown-M", () => {
      if (this.registry.get("settingsOpen") === true) return;
      this.openMarket();
    });
    keyboard.on("keydown-P", () => {
      if (this.registry.get("settingsOpen") === true) return;
      this.openCashShop();
    });

    // ENTER initiates NPC conversation when near one and not in dialog/chat.
    keyboard.on("keydown-ENTER", () => {
      if (this.registry.get("settingsOpen") === true) return;
      this.tryTalkToNpc();
    });
  }

  /** Register all warrior + mob animations once (idempotent — safe across HMR reloads). */
  private setupAnimations(): void {
    for (const def of [...WarriorAnimDefs, ...MobAnimDefs]) {
      if (this.anims.exists(def.key)) continue;
      this.anims.create({
        key: def.key,
        frames: def.frames.map((f) => ({ key: f })),
        frameRate: def.frameRate,
        repeat: def.repeat,
      });
    }
  }

  // ─── NPC rendering + interaction ──────────────────────────────────────────────
  /** Spawn procedural NPC sprites at their defined positions for the current map. */
  private spawnNpcs(): void {
    const npcs = getNpcsForMap(this.mapId);
    this.npcsForMap.push(...npcs);
    for (const npc of npcs) {
      const texKey = npcTextureKey(npc.spriteKey);
      const sprite = this.add.sprite(npc.x, npc.y, texKey);
      sprite.setFlipX(true); // NPCs face the player by default
      this.attachShadow(sprite);
      this.applyDepthAndShadow(sprite);

      // Name label above the NPC's head.
      const label = this.add
        .text(npc.x, npc.y - 30, npc.name, {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: "11px",
          color: "#ffe08a",
          stroke: "#1a1a2e",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(npc.y + 1000);

      // Floating interaction prompt (hidden until player is in range).
      const prompt = this.add
        .text(npc.x, npc.y - 44, "[ENTER]", {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: "10px",
          color: "#aeb9c7",
          stroke: "#1a1a2e",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(npc.y + 1001)
        .setAlpha(0);

      this.npcSprites.set(npc.id, sprite);
      this.npcLabels.set(npc.id, label);
      this.npcPrompts.set(npc.id, prompt);
    }
  }

  /** Show/hide the "press ENTER" prompt above each NPC based on player distance. */
  private updateNpcPrompts(): void {
    const player = this.localPlayer;
    if (!player) return;
    for (const npc of this.npcsForMap) {
      const prompt = this.npcPrompts.get(npc.id);
      if (!prompt) continue;
      const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
      const inRange = dist < NPC_INTERACT_RANGE && !this.registry.get(DIALOG_OPEN_KEY);
      // Fade in/out for a smooth appearance.
      const targetAlpha = inRange ? 1 : 0;
      if (prompt.alpha !== targetAlpha) {
        this.tweens.killTweensOf(prompt);
        this.tweens.add({
          targets: prompt,
          alpha: targetAlpha,
          duration: 150,
          ease: "Quad.easeOut",
        });
      }
    }
  }

  /** Attempt to talk to the nearest NPC within range. Called on ENTER keypress. */
  private tryTalkToNpc(): void {
    const room = this.room;
    const player = this.localPlayer;
    if (!room || !player) return;
    if (this.registry.get(DIALOG_OPEN_KEY) === true) return;

    let nearest: NpcDef | undefined;
    let nearestDist = NPC_INTERACT_RANGE;
    for (const npc of this.npcsForMap) {
      const dist = Math.hypot(npc.x - player.x, npc.y - player.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = npc;
      }
    }
    if (!nearest) return;
    if (!this.coachTalkFired) {
      this.coachTalkFired = true;
      this.registry.set("coachmark:talk", true);
    }
    room.send(MessageType.TALK_NPC, { npcId: nearest.id });
  }

  /** Launch the Free Market overlay on top and pause Meadowfield until it closes. */
  private openMarket(): void {
    if (this.scene.isActive("market")) return;
    this.scene.launch("market");
    this.scene.pause();
  }

  /** Launch the Cash Shop overlay and pause Meadowfield until it closes. */
  private openCashShop(): void {
    if (this.scene.isActive("cashshop")) return;
    this.scene.launch("cashshop");
    this.scene.pause();
  }

  private openGeneralStore(shopId: string): void {
    if (this.scene.isActive("generalstore")) return;
    this.scene.launch("generalstore", { shopId });
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

  // ── Floating name / level tags (MapleStory style) ──────────────────────────

  /** Create a floating name+level tag that sits above a player sprite. */
  private createPlayerTag(name: string, level: number, title = ""): Phaser.GameObjects.Container {
    const label = this.add
      .text(0, 0, `Lv.${level} ${name}`, {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "11px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    const titleText = this.add
      .text(0, 0, title, {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "10px",
        color: "#facc15",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setVisible(!!title);

    const P = 4;
    const totalH = label.height + (title ? titleText.height + 2 : 0);
    const totalW = Math.max(label.width, titleText.width);
    const bg = this.add.graphics();
    this.drawTagBg(bg, totalW + P * 2, totalH + P * 2);

    // Stack: label on top, title below.
    label.setY(-totalH / 2 + label.height / 2);
    if (title) titleText.setY(-totalH / 2 + label.height + 2 + titleText.height / 2);

    const container = this.add.container(0, 0, [bg, label, titleText]);
    container.setData("label", label);
    container.setData("titleText", titleText);
    container.setData("bg", bg);
    container.setDepth(9000);
    return container;
  }

  /** Redraw the rounded dark backing behind a name tag. */
  private drawTagBg(g: Phaser.GameObjects.Graphics, w: number, h: number): void {
    g.clear();
    g.fillStyle(0x1a1a2e, 0.72);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
  }

  /** Refresh the text (and background width) when name / level / title change. */
  private updatePlayerTagText(
    tag: Phaser.GameObjects.Container,
    name: string,
    level: number,
    title?: string,
  ): void {
    const label = tag.getData("label") as Phaser.GameObjects.Text;
    const titleText = tag.getData("titleText") as Phaser.GameObjects.Text | undefined;
    const bg = tag.getData("bg") as Phaser.GameObjects.Graphics;

    label.setText(`Lv.${level} ${name}`);
    if (titleText) {
      const t = title ?? "";
      titleText.setText(t);
      titleText.setVisible(!!t);
    }

    const hasTitle = titleText?.visible ?? false;
    const totalH = label.height + (hasTitle && titleText ? titleText.height + 2 : 0);
    const totalW = Math.max(label.width, titleText?.width ?? 0);

    // Re-center label + title vertically.
    label.setY(-totalH / 2 + label.height / 2);
    if (hasTitle && titleText) {
      titleText.setY(-totalH / 2 + label.height + 2 + titleText.height / 2);
    }

    this.drawTagBg(bg, totalW + 8, totalH + 8);
  }

  /** Pin a floating tag just above its parent sprite's head and keep depth in sync. */
  private syncPlayerTag(
    sprite: Phaser.GameObjects.Sprite,
    tag: Phaser.GameObjects.Container,
  ): void {
    const titleText = tag.getData("titleText") as Phaser.GameObjects.Text | undefined;
    const extra = titleText?.visible ? titleText.height + 2 : 0;
    tag.setPosition(sprite.x, sprite.y - sprite.displayHeight / 2 - 14 - extra);
    tag.setDepth(sprite.y + 1);
  }

  /** Record the server's latest transform on a sprite for per-frame interpolation. */
  private storeServerTransform(
    sprite: Phaser.GameObjects.Sprite,
    x: number,
    y: number,
    facing: number,
    vy?: number,
    grounded?: boolean,
    climbing?: boolean,
    dead?: boolean,
    ladderId?: number,
  ): void {
    sprite.setData("serverX", x);
    sprite.setData("serverY", y);
    sprite.setData("facing", facing);
    if (vy !== undefined) sprite.setData("serverVy", vy);
    if (grounded !== undefined) sprite.setData("serverGrounded", grounded);
    if (climbing !== undefined) sprite.setData("serverClimbing", climbing);
    if (dead !== undefined) sprite.setData("serverDead", dead);
    if (ladderId !== undefined) sprite.setData("serverLadderId", ladderId);
  }

  /** Lerp a remote sprite toward its stashed server transform and sync its facing/depth/shadow. */
  private lerpToServer(sprite: Phaser.GameObjects.Sprite): void {
    const serverX = sprite.getData("serverX") as number | undefined;
    const serverY = sprite.getData("serverY") as number | undefined;
    const facing = sprite.getData("facing") as number | undefined;
    const climbing = sprite.getData("serverClimbing") as boolean | undefined;

    if (serverX !== undefined) sprite.x = Phaser.Math.Linear(sprite.x, serverX, REMOTE_LERP);
    if (serverY !== undefined) sprite.y = Phaser.Math.Linear(sprite.y, serverY, REMOTE_LERP);
    if (facing !== undefined) sprite.setFlipX(facing === -1);

    // Climbing visual for remote players — tint + hide shadow.
    if (climbing) {
      sprite.setTint(0xbbbbdd);
      const shadow = this.shadowOf(sprite);
      if (shadow) shadow.setVisible(false);
    } else {
      sprite.clearTint();
      const shadow = this.shadowOf(sprite);
      if (shadow) shadow.setVisible(true);
    }

    this.updateRemoteAnim(sprite);
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

  /** Derive the correct animation key from a player's movement state. */
  private getDesiredAnim(
    grounded: boolean,
    vy: number,
    moving: boolean,
    climbing: boolean,
    prefix?: string,
  ): string {
    let base: string;
    if (climbing) base = "climb";
    else if (!grounded) base = vy < 0 ? "jump" : "fall";
    else if (moving) base = "walk";
    else base = "idle";
    return prefix ? `${prefix}_${base}` : `warrior_${base}`;
  }

  /** Drive a remote player's animation from its interpolated state. */
  private updateRemoteAnim(sprite: Phaser.GameObjects.Sprite): void {
    const climbing = sprite.getData("serverClimbing") as boolean | undefined;
    const grounded = sprite.getData("serverGrounded") as boolean | undefined;
    const vy = sprite.getData("serverVy") as number | undefined;

    const prevX = sprite.getData("prevAnimX") as number | undefined;
    const moving = prevX !== undefined && Math.abs(sprite.x - prevX) > 0.3;
    sprite.setData("prevAnimX", sprite.x);

    const prefix = sprite.getData("apPrefix") as string | undefined;
    const desired = this.getDesiredAnim(
      grounded ?? true,
      vy ?? 0,
      moving,
      climbing ?? false,
      prefix,
    );
    if (sprite.anims.currentAnim?.key !== desired) {
      sprite.play(desired);
    }
  }

  // ─── Platformer helpers (mirror TownRoom.ts logic for client prediction) ──────────

  /**
   * Find the nearest foothold at `x` whose surface is within FOOTHOLD_SNAP_PX of `y`
   * (above or below). Used by the grounded re-check to handle slopes and float jitter.
   */
  private nearestFootholdAt(x: number, y: number, skipFootholdId = -1): Foothold | undefined {
    let best: Foothold | undefined;
    let bestDist = Infinity;
    for (const fh of this.map.footholds) {
      if (fh.id === skipFootholdId) continue;
      const minX = Math.min(fh.x1, fh.x2);
      const maxX = Math.max(fh.x1, fh.x2);
      if (x < minX || x > maxX) continue;
      const sy = groundYAt(fh, x);
      const dist = Math.abs(sy - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = fh;
      }
    }
    return bestDist <= FOOTHOLD_SNAP_PX ? best : undefined;
  }

  /**
   * Find the foothold the player is landing on after falling from `prevY` to `currentY`.
   * Returns the closest surface whose y is between prevY and currentY (inclusive with tolerance),
   * preferring the highest one (nearest platform the player crossed).
   */
  private landingFoothold(
    x: number,
    prevY: number,
    currentY: number,
    skipFootholdId = -1,
  ): Foothold | undefined {
    let best: Foothold | undefined;
    let bestY = Infinity;
    for (const fh of this.map.footholds) {
      if (fh.id === skipFootholdId) continue;
      const minX = Math.min(fh.x1, fh.x2);
      const maxX = Math.max(fh.x1, fh.x2);
      if (x < minX || x > maxX) continue;
      const sy = groundYAt(fh, x);
      // Player crossed the surface: was above (or within tolerance) and is now at or below.
      if (prevY <= sy + FOOTHOLD_SNAP_PX && currentY >= sy - FOOTHOLD_SNAP_PX) {
        if (sy < bestY) {
          bestY = sy;
          best = fh;
        }
      }
    }
    return best;
  }

  // ─── Ladder climbing prediction (mirrors TownRoom.ts tickClimbing / attachToLadder) ──────

  /** Snap the player onto a ladder and enter client-side climbing mode. */
  private attachToLadderLocal(player: Phaser.GameObjects.Sprite, lad: Ladder): void {
    this.localClimbing = true;
    this.localLadderId = lad.id;
    player.x = lad.x; // snap x to ladder centre
    this.localVy = 0;
    this.localGrounded = false;
    this.lastJumpHeld = false;
    this.enterClimbVisual(player);
  }

  /** Detach from a ladder and re-enable normal physics. */
  private detachFromLadderLocal(player: Phaser.GameObjects.Sprite): void {
    this.localClimbing = false;
    this.localLadderId = -1;
    this.localVy = 0;
    this.lastJumpHeld = false;
    this.exitClimbVisual(player);
  }

  /** One tick of climbing movement — mirrors TownRoom.ts tickClimbing exactly. */
  private tickLocalClimbing(
    player: Phaser.GameObjects.Sprite,
    input: InputData,
    delta: number,
  ): void {
    const lad = this.map.ladders.find((l) => l.id === this.localLadderId);
    if (!lad) {
      // Ladder disappeared — emergency detach.
      this.detachFromLadderLocal(player);
      return;
    }

    const dt = delta / FIXED_TIMESTEP;

    // ── Jump → detach (small hop at top) ──
    if (input.jump) {
      this.detachFromLadderLocal(player);
      if (Math.abs(player.y - lad.yTop) < FOOTHOLD_SNAP_PX + 4) {
        this.localVy = JUMP_VELOCITY * 0.6; // smaller hop off ladder
        this.localGrounded = false;
      }
      return;
    }

    // ── Left / right → detach (walk off) ──
    if (input.left || input.right) {
      this.detachFromLadderLocal(player);
      return;
    }

    // ── Vertical movement along the ladder ──
    if (input.up) {
      player.y -= CLIMB_SPEED * dt;
    } else if (input.down) {
      player.y += CLIMB_SPEED * dt;
    }

    // Keep x locked to ladder while climbing.
    player.x = lad.x;
    this.localVy = 0;

    // ── Clamp to ladder vertical bounds ──
    if (player.y <= lad.yTop) {
      player.y = lad.yTop;
      // Reaching the top: if there is a foothold here, land on it.
      const topFh = this.nearestFootholdAt(player.x, player.y);
      if (topFh) {
        player.y = groundYAt(topFh, player.x);
        this.detachFromLadderLocal(player);
        return;
      }
    }

    if (player.y >= lad.yBottom) {
      // At the bottom — drop off and find the ground foothold.
      player.y = lad.yBottom;
      this.detachFromLadderLocal(player);
      const botFh = this.nearestFootholdAt(player.x, player.y);
      if (botFh) {
        player.y = groundYAt(botFh, player.x);
        this.localGrounded = true;
      }
    }
  }

  /** Re-render a player sprite if their appearance fields have changed. */
  private syncPlayerAppearance(sprite: Phaser.GameObjects.Sprite, player: PlayerView): void {
    const ap: AppearanceParams = {
      skinId: player.skinId || "skin_light",
      hairId: player.hairId || "hair_short",
      hairColorId: player.hairColorId || "color_brown",
      faceId: player.faceId || "face_default",
      outfitId: player.outfitId || "outfit_tunic",
    };
    const newPrefix = appearancePrefix(ap);
    const oldPrefix = sprite.getData("apPrefix") as string | undefined;
    if (newPrefix === oldPrefix) return;
    ensureAppearanceTextures(this, ap);
    sprite.setData("apPrefix", newPrefix);
    // Switch to idle frame of the new appearance.
    const idleKey = `${newPrefix}_idle_0`;
    if (this.textures.exists(idleKey)) sprite.setTexture(idleKey);
  }

  /** Apply climbing visuals — tint for back-facing, hide shadow. */
  private enterClimbVisual(player: Phaser.GameObjects.Sprite): void {
    player.setTint(0xbbbbdd);
    player.setScale(1);
    const shadow = this.shadowOf(player);
    if (shadow) shadow.setVisible(false);
  }

  /** Clear climbing visuals and restore normal appearance. */
  private exitClimbVisual(player: Phaser.GameObjects.Sprite): void {
    player.clearTint();
    player.setScale(1);
    const shadow = this.shadowOf(player);
    if (shadow) shadow.setVisible(true);
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
  /** Cosmetic melee flourish on the local warrior: attack animation + a slash that sweeps in `facing`. */
  private playSwing(): void {
    const player = this.localPlayer;
    if (!player) return;
    const facing = player.flipX ? -1 : 1;

    // Play swing SFX.
    getAudioManager().playSfx("swing");

    // Play the attack animation (non-repeating — returns to idle/walk when done).
    const atkPrefix = player.getData("apPrefix") as string | undefined;
    player.play(atkPrefix ? `${atkPrefix}_attack` : "warrior_attack");

    // Subtle squash on the warrior for extra weight (yoyos back to resting scale).
    this.tweens.add({
      targets: player,
      scaleX: 1.08,
      scaleY: 0.93,
      duration: 60,
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
    getAudioManager().playSfx("pickup");
    room.send(MessageType.PICKUP, { uid: nearestUid });
  }

  private matchLootAllKey(event: KeyboardEvent, phaserKey: string): boolean {
    if (!phaserKey) return false;
    const code = event.code;
    if (code.startsWith("Key") && code.length === 4) return code.charAt(3) === phaserKey;
    const digitMap: Record<string, string> = {
      Digit0: "ZERO",
      Digit1: "ONE",
      Digit2: "TWO",
      Digit3: "THREE",
      Digit4: "FOUR",
      Digit5: "FIVE",
      Digit6: "SIX",
      Digit7: "SEVEN",
      Digit8: "EIGHT",
      Digit9: "NINE",
    };
    if (digitMap[code] !== undefined) return digitMap[code] === phaserKey;
    const specialMap: Record<string, string> = {
      Space: "SPACE",
      ArrowLeft: "LEFT",
      ArrowRight: "RIGHT",
      ArrowUp: "UP",
      ArrowDown: "DOWN",
      Enter: "ENTER",
      Escape: "ESCAPE",
      AltLeft: "ALT",
      AltRight: "ALT",
      ControlLeft: "CTRL",
      ControlRight: "CTRL",
      ShiftLeft: "SHIFT",
      ShiftRight: "SHIFT",
      Tab: "TAB",
      Backspace: "BACKSPACE",
      Delete: "DELETE",
      KeyZ: "Z",
    };
    return specialMap[code] === phaserKey;
  }

  private doLootAll(): void {
    const room = this.room;
    if (!room || !this.localPlayer) return;
    const now = this.time.now;
    if (now - this.lootAllCooldown < this.LOOT_ALL_COOLDOWN_MS) return;
    this.lootAllCooldown = now;
    room.send(MessageType.PICKUP_ALL);
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

  /**
   * A small white burst at a hit location — lightweight and self-destroying.
   * Skipped once MAX_HIT_SPARKS are already live so dense mob packs stay smooth.
   */
  private spawnHitSpark(x: number, y: number): void {
    if (this.activeHitSparks >= MAX_HIT_SPARKS) return;
    this.activeHitSparks++;
    const spark = this.add.circle(x, y, 5, 0xffffff, 0.9).setDepth(y + 2);
    this.tweens.add({
      targets: spark,
      scale: 2.2,
      alpha: 0,
      duration: 160,
      ease: "Cubic.easeOut",
      onComplete: () => {
        this.activeHitSparks--;
        spark.destroy();
      },
    });
  }

  /** True unless the player disabled camera shake (reduced-motion) in settings. */
  private screenShakeEnabled(): boolean {
    return keybindings.getSettings().video.screenShake !== false;
  }

  /** True unless the player disabled floating damage numbers in settings. */
  private damageNumbersEnabled(): boolean {
    return keybindings.getSettings().video.showDamageNumbers !== false;
  }

  /**
   * Subtle camera shake via Phaser's built-in camera FX. `intensity01` is a 0–1
   * scale mapped onto MAX_SHAKE_INTENSITY so even max stays gentle. No-op when the
   * reduced-motion / screen-shake setting is off.
   */
  private shakeCamera(intensity01: number, durationMs: number): void {
    if (!this.screenShakeEnabled()) return;
    const amt = Phaser.Math.Clamp(intensity01, 0, 1) * MAX_SHAKE_INTENSITY;
    if (amt <= 0) return;
    this.cameras.main.shake(durationMs, amt);
  }

  /** Fade + shrink a mob (and its shadow) out on death. The server revives the same entry later. */
  private playMobDeath(sprite: Phaser.GameObjects.Sprite): void {
    getAudioManager().playSfx("death");
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
    sprite.setAlpha(1);
    sprite.setVisible(true);
    // Re-apply elite tint/scale if this mob is an elite.
    const isElite = sprite.getData("isElite") === true;
    if (isElite) {
      sprite.setTint(0xffd700);
      sprite.setScale(1.2);
    } else {
      sprite.setScale(1);
    }
    // Restart the mob's idle animation so it doesn't sit frozen on a dead frame.
    const mobId = sprite.getData("mobId") as string | undefined;
    if (mobId) sprite.play(mobAnimKey(mobId));
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

  /**
   * Acquire a floating-text object from the pool (or create one on a cold pool).
   * Reset to a clean baseline so a previous style never leaks into the new use.
   */
  private acquireDamageText(): Phaser.GameObjects.Text {
    const pooled = this.damageTextPool.pop();
    if (pooled) {
      pooled.setActive(true).setVisible(true).setAlpha(1).setScale(1).setAngle(0);
      return pooled;
    }
    return this.add.text(0, 0, "", { fontFamily: "ui-monospace, Menlo, monospace" }).setOrigin(0.5);
  }

  /** Return a floating-text object to the pool (or destroy it past the soft cap). */
  private releaseDamageText(label: Phaser.GameObjects.Text): void {
    this.tweens.killTweensOf(label);
    if (this.damageTextPool.length >= DAMAGE_TEXT_POOL_MAX) {
      label.destroy();
      return;
    }
    label.setActive(false).setVisible(false);
    this.damageTextPool.push(label);
  }

  /** Show a floating combat number (damage, crit, or miss) at a position. */
  private showCombatNumber(x: number, y: number, payload: CombatHitPayload): void {
    // Honor the reduced-clutter setting — still play SFX/shake, just no numbers.
    if (!this.damageNumbersEnabled()) return;
    let text: string;
    let color: string;
    let fontSize: string;
    let isCrit = false;
    const elemMul = payload.elementMultiplier ?? 1;

    if (!payload.hit) {
      text = "MISS";
      color = "#94a3b8";
      fontSize = "14px";
    } else if (elemMul === 0) {
      text = "IMMUNE";
      color = "#6b7280";
      fontSize = "14px";
    } else if (elemMul > 1) {
      // Weak (extra effective) — golden highlight
      text = String(payload.damage);
      color = payload.crit ? "#fbbf24" : "#f59e0b";
      fontSize = payload.crit ? "20px" : "16px";
      isCrit = payload.crit;
    } else if (elemMul < 1) {
      // Resist — dim blue tint
      text = String(payload.damage);
      color = "#60a5fa";
      fontSize = "13px";
    } else if (payload.crit) {
      text = String(payload.damage);
      color = "#ff6b6b";
      fontSize = "20px";
      isCrit = true;
    } else {
      text = String(payload.damage);
      color = "#ffffff";
      fontSize = "14px";
    }

    const label = this.acquireDamageText();
    label
      .setText(text)
      .setPosition(x, y)
      .setStyle({
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize,
        color,
        fontStyle: isCrit ? "bold" : "normal",
        stroke: isCrit ? "#3a0000" : "#1f2937",
        strokeThickness: isCrit ? 4 : 3,
      })
      .setDepth(9200);

    // Crit gets a dramatic pop-in; normal hits drift up smoothly. Recycle on done.
    if (isCrit) {
      label.setScale(1.6);
      this.tweens.add({
        targets: label,
        scaleX: 1,
        scaleY: 1,
        y: y - 34,
        alpha: 0,
        duration: 900,
        ease: "Cubic.easeOut",
        onComplete: () => this.releaseDamageText(label),
      });
    } else {
      const drift = payload.hit ? -24 : -18;
      this.tweens.add({
        targets: label,
        y: y + drift,
        alpha: 0,
        duration: 760,
        ease: "Quad.easeOut",
        onComplete: () => this.releaseDamageText(label),
      });
    }
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

  /** Play a celebratory burst effect above the local player on job advancement. */
  private playAdvancementEffect(branchId?: string): void {
    const player = this.localPlayer;
    if (!player) return;

    const cx = player.x;
    const cy = player.y - player.displayHeight / 2;

    // Central flash.
    const flash = this.add.circle(cx, cy, 4, 0xffd700, 1).setDepth(9999);
    this.tweens.add({
      targets: flash,
      scaleX: 12,
      scaleY: 12,
      alpha: 0,
      duration: 500,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    // Rising particles.
    const PARTICLE_COUNT = 12;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
      const speed = 60 + Math.random() * 40;
      const dot = this.add.circle(cx, cy, 2 + Math.random() * 2, 0xffd700, 0.9).setDepth(9999);
      this.tweens.add({
        targets: dot,
        x: cx + Math.cos(angle) * speed,
        y: cy + Math.sin(angle) * speed - 30,
        alpha: 0,
        duration: 400 + Math.random() * 200,
        ease: "Quad.easeOut",
        onComplete: () => dot.destroy(),
      });
    }

    // Full-screen golden flash.
    const { width, height } = this.scale;
    const screenFlash = this.add
      .rectangle(width / 2, height / 2, width, height, 0xffd700, 0.2)
      .setDepth(9998)
      .setScrollFactor(0);
    this.tweens.add({
      targets: screenFlash,
      alpha: 0,
      duration: 450,
      ease: "Quad.easeOut",
      onComplete: () => screenFlash.destroy(),
    });

    // Floating label.
    const branchText = branchId
      ? ` \u2192 ${branchId.charAt(0).toUpperCase() + branchId.slice(1)}`
      : "";
    this.floatText(cx, cy - 40, `🎉 JOB ADVANCED!${branchText}`, "#ffd700");

    // Advancement sound.
    MapScene.playAdvancementSound();
  }

  // ─── Portal rendering + interaction ──────────────────────────────────────────────
  /** Interaction range (px) for portal prompts — matches PORTAL_RANGE in server MapRoom.ts. */
  private static readonly PORTAL_RANGE = 80;

  /** Spawn glowing portal markers at every portal position on the current map. */
  private spawnPortals(): void {
    for (const portal of this.map.portals) {
      // Glowing orb marker.
      const glow = this.add.circle(portal.x, portal.y, 12, 0x6ec6ff, 0.5);
      glow.setDepth(portal.y);
      this.tweens.add({
        targets: glow,
        alpha: { from: 0.3, to: 0.7 },
        scale: { from: 0.85, to: 1.15 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });

      // Bright inner core.
      const core = this.add.circle(portal.x, portal.y, 4, 0xffffff, 0.9);
      core.setDepth(portal.y + 0.1);

      // Label above the portal.
      const label = this.add
        .text(portal.x, portal.y - 26, portal.label, {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: "11px",
          color: "#6ec6ff",
          stroke: "#1a1a2e",
          strokeThickness: 3,
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(portal.y + 1000);

      // Interaction prompt — hidden until player is in range.
      const prompt = this.add
        .text(portal.x, portal.y - 42, "[\u2191 ENTER]", {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: "10px",
          color: "#aeb9c7",
          stroke: "#1a1a2e",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(portal.y + 1001)
        .setAlpha(0);

      // Level requirement indicator (if gated).
      if (portal.requiresLevel) {
        this.add
          .text(portal.x, portal.y - 56, `Lv.${portal.requiresLevel}+`, {
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: "9px",
            color: "#f6c177",
            stroke: "#1a1a2e",
            strokeThickness: 2,
          })
          .setOrigin(0.5)
          .setDepth(portal.y + 1002);
      }

      this.portalLabels.set(portal.id, label);
      this.portalPrompts.set(portal.id, prompt);
    }
  }

  /** Show/hide the interaction prompt above each portal based on player distance. */
  private updatePortalPrompts(): void {
    const player = this.localPlayer;
    if (!player) return;
    for (const portal of this.map.portals) {
      const prompt = this.portalPrompts.get(portal.id);
      if (!prompt) continue;
      const dist = Math.hypot(portal.x - player.x, portal.y - player.y);
      const inRange = dist < MapScene.PORTAL_RANGE && !this.registry.get(DIALOG_OPEN_KEY);
      const targetAlpha = inRange ? 1 : 0;
      if (prompt.alpha !== targetAlpha) {
        this.tweens.killTweensOf(prompt);
        this.tweens.add({
          targets: prompt,
          alpha: targetAlpha,
          duration: 150,
          ease: "Quad.easeOut",
        });
      }
    }
  }

  /** "Welcome to <MapName>" banner shown briefly after arriving on a new map. */
  private showWelcomeBanner(mapName: string): void {
    const { width, height } = this.scale;
    const FONT = "ui-monospace, Menlo, monospace";

    // Semi-transparent dark backdrop.
    const bg = this.add
      .rectangle(width / 2, height / 2, width, 80, 0x0c1019, 0.85)
      .setDepth(10_002)
      .setScrollFactor(0)
      .setAlpha(0);

    // Decorative line above.
    const lineTop = this.add
      .rectangle(width / 2, height / 2 - 24, 260, 1, 0x9ad06b, 0.6)
      .setDepth(10_003)
      .setScrollFactor(0)
      .setAlpha(0);

    // Map name text — "Welcome to <MapName>".
    const label = this.add
      .text(width / 2, height / 2, `Welcome to ${mapName}`, {
        fontFamily: FONT,
        fontSize: "24px",
        color: "#f8fafc",
      })
      .setOrigin(0.5)
      .setDepth(10_003)
      .setScrollFactor(0)
      .setAlpha(0);

    // Decorative line below.
    const lineBot = this.add
      .rectangle(width / 2, height / 2 + 24, 260, 1, 0x9ad06b, 0.6)
      .setDepth(10_003)
      .setScrollFactor(0)
      .setAlpha(0);

    const targets = [bg, lineTop, label, lineBot];

    // Fade in, hold, fade out.
    this.tweens.add({
      targets,
      alpha: 1,
      duration: 400,
      ease: "Quad.easeOut",
      onComplete: () => {
        this.time.delayedCall(1500, () => {
          this.tweens.add({
            targets,
            alpha: 0,
            duration: 500,
            ease: "Quad.easeIn",
            onComplete: () => {
              for (const t of targets) t.destroy();
            },
          });
        });
      },
    });
  }

  private showConnectionError(): void {
    this.add
      .text(
        this.scale.width / 2,
        this.scale.height / 2,
        `Couldn't reach ${this.map?.name ?? "the server"}.\nIs the server running?`,
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

  // ─── Level-up in-world burst effect ─────────────────────────────────────────────
  /** Play a burst of particles + expanding ring at the player's position on level-up. */
  private playLevelUpBurst(x: number, y: number): void {
    getAudioManager().playSfx("levelup");
    const cy = y - 20;

    // Expanding golden ring.
    const ring = this.add.circle(x, cy, 6, 0x9ad06b, 0).setDepth(9999);
    ring.setStrokeStyle(3, 0x9ad06b, 0.9);
    this.tweens.add({
      targets: ring,
      scaleX: 8,
      scaleY: 8,
      alpha: 0,
      duration: 500,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    // Particle burst.
    const COUNT = 14;
    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 40 + Math.random() * 50;
      const dot = this.add.circle(x, cy, 1.5 + Math.random() * 2, 0x9ad06b, 0.9).setDepth(9999);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist - 15,
        alpha: 0,
        duration: 350 + Math.random() * 200,
        ease: "Quad.easeOut",
        onComplete: () => dot.destroy(),
      });
    }

    // Flash at the player.
    const flash = this.add.circle(x, cy, 12, 0xffffff, 0.35).setDepth(9998);
    this.tweens.add({
      targets: flash,
      scaleX: 5,
      scaleY: 5,
      alpha: 0,
      duration: 300,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    // Floating "LEVEL UP!" label at the player.
    this.floatText(x, cy - 30, "⬆ LEVEL UP!", "#9ad06b");
  }

  // ─── Low-HP vignette ──────────────────────────────────────────────────────────────
  /** Create the full-screen vignette overlay for low-HP warning. */
  private buildLowHpVignette(): void {
    this.lowHpVignette = this.add.graphics().setDepth(9500).setScrollFactor(0);
    this.lowHpVignette.setAlpha(0);
  }

  /** Update vignette intensity based on current HP ratio. Pulses when critically low. */
  private updateLowHpVignette(hp: number, maxHp: number): void {
    if (!this.lowHpVignette) return;
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    const { width, height } = this.scale;

    this.lowHpVignette.clear();

    if (ratio > 0.5) {
      // Healthy — no vignette.
      this.lowHpVignette.setAlpha(0);
      this.lowHpPulseActive = false;
      return;
    }

    // Red vignette — gradient from transparent centre to red edges.
    // Draw concentric rings from outside in, each progressively more transparent.
    const maxAlpha = ratio <= 0.25 ? 0.45 : 0.2;
    const RINGS = 8;
    for (let i = 0; i < RINGS; i++) {
      const t = i / RINGS; // 0 = outermost, 1 = innermost
      const ringAlpha = maxAlpha * (1 - t);
      const inset = t * Math.min(width, height) * 0.35;
      this.lowHpVignette.fillStyle(0xef4444, ringAlpha);
      this.lowHpVignette.fillRect(0, 0, width, inset); // top
      this.lowHpVignette.fillRect(0, height - inset, width, inset); // bottom
      this.lowHpVignette.fillRect(0, inset, inset, height - inset * 2); // left
      this.lowHpVignette.fillRect(width - inset, inset, inset, height - inset * 2); // right
    }

    // When critically low (≤25%), start a pulse tween if not already active.
    if (ratio <= 0.25 && !this.lowHpPulseActive) {
      this.lowHpPulseActive = true;
      this.tweens.add({
        targets: this.lowHpVignette,
        alpha: { from: 1, to: 0.5 },
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else if (ratio > 0.25 && this.lowHpPulseActive) {
      this.lowHpPulseActive = false;
      this.tweens.killTweensOf(this.lowHpVignette);
      this.lowHpVignette.setAlpha(1);
    }
  }

  // ─── Web Audio API sound synthesis (delegated to AudioManager) ──────────────────

  /** Play the advancement chord stab via the audio manager. */
  static playAdvancementSound(): void {
    getAudioManager().playSfx("advancement");
  }
}
