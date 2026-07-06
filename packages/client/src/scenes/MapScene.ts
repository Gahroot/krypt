import Phaser from "phaser";
import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import {
  MessageType,
  type InputData,
  type ChatMessage,
  type FerryBlockedPayload,
  type TransportStatusPayload,
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
  type SessionGenerationPayload,
  type ForceLogoutPayload,
  type JobAdvancePayload,
  type BranchListPayload,
  type RuneSpawnPayload,
  type RuneDespawnPayload,
  type RuneActivatePayload,
  type TreasureSpawnPayload,
  type TreasureHitPayload,
  type TreasureDestroyPayload,
  type TreasureDespawnPayload,
  type ServerAnnouncementPayload,
  getMobDef,
  QUESTS,
  PROTOCOL_VERSION,
  PROTOCOL_MISMATCH_CODE,
  getItemDef,
} from "@maple/shared";

import {
  BACKEND_URL,
  CONNECT_TIMEOUT_MS,
  authenticateForPlay,
  BannedError,
  getCharId,
  getSeenCoachMarks,
  getCurrentChannel,
  setCurrentChannel,
  getPlayerName,
  setSessionExpiredHandler,
  clearSession,
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
  mobTint,
  mobScale,
  ensureAppearanceTextures,
  appearancePrefix,
  resolveBiomeSet,
  resolveBiomePalette,
} from "../art/textures";
import type { AppearanceParams, BiomePalette } from "../art/textures";
import type { TownStateView, PlayerView, MobView, LootView, ProjectileView } from "../state-views";
import { getAudioManager } from "../audio/AudioManager";
import { loadScene } from "./lazyScene";
import { uiStore } from "../ui/store";

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
/** Per-tick horizontal acceleration (px/tick²). Snappy 2-tick ramp to full speed. */
const PLAYER_ACCEL = 1.2;
/** Per-tick horizontal deceleration when no key is held (px/tick²). ~5-tick skid-to-stop. */
const PLAYER_FRICTION = 0.5;
/** Reduced traction on icy/slippery footholds (harder to start, longer skid). */
const PLAYER_SLIPPERY_ACCEL = 0.4;
const PLAYER_SLIPPERY_FRICTION = 0.1;
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
/** How long (ms) the player ignores a foothold after pressing Down+Jump to drop through it. */
const DROP_THROUGH_MS = 250;
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

// ─── Connection robustness ─────────────────────────────────────────────────────────────────────
/** Live connection state surfaced by the HUD indicator. */
type ConnStatus = "connecting" | "online" | "reconnecting" | "offline";

/** The distinct, user-actionable ways a connect attempt can fail. */
type ConnectErrorKind = "offline" | "timeout" | "version" | "banned" | "full" | "unknown";

/** A classified connect failure, ready to render on the friendly error screen. */
interface ConnectErrorInfo {
  kind: ConnectErrorKind;
  title: string;
  message: string;
}

/** Thrown when `joinOrCreate` doesn't settle within CONNECT_TIMEOUT_MS. */
class ConnectTimeoutError extends Error {
  constructor() {
    super("connect timed out");
    this.name = "ConnectTimeoutError";
  }
}

/** Shared monospace font stack used across the connection overlays. */
const CONN_FONT = "ui-monospace, Menlo, monospace";

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
  private localVx = 0;
  private localVy = 0;
  private localGrounded = true;
  private localClimbing = false;
  private localLadderId = -1;
  private lastJumpHeld = false;
  /** Foothold id the player is currently dropping through (-1 = none). */
  private localDropThroughFootholdId = -1;
  /** Remaining ms of drop-through grace (prevents re-landing on the same platform). */
  private localDropThroughTimer = 0;

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: WasdKeys;

  private readonly playerSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly playerTags = new Map<string, Phaser.GameObjects.Container>();
  private readonly mobSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly mobHpBars = new Map<string, Phaser.GameObjects.Container>();
  private readonly mobNameplates = new Map<string, Phaser.GameObjects.Container>();
  private readonly lootSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly lootLabels = new Map<string, Phaser.GameObjects.Text>();
  private readonly runeSprites = new Map<string, Phaser.GameObjects.Container>();
  private readonly boxSprites = new Map<string, Phaser.GameObjects.Container>();
  private readonly projectileGfx = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly telegraphGfx = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly explosionGfx: Phaser.GameObjects.Graphics[] = [];

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
  private readonly npcIndicators = new Map<string, Phaser.GameObjects.Text>();
  private readonly npcsForMap: NpcDef[] = [];
  /** Latest quest log snapshot from the server, used for NPC indicator computation. */
  private questLogData: { questId: string; status: string }[] = [];
  // ── Map data (set from create() data parameter) ─────────────────────────────
  private mapId = "dawn_isle";
  private map!: GameMap;
  private transitioning = false;
  /** True while the SDK is auto-reconnecting a dropped socket (the overlay is up). */
  private reconnecting = false;
  /** "Reconnecting…" overlay shown while we ride out a flaky connection. */
  private reconnectOverlay?: Phaser.GameObjects.Container;
  /** Tween animating the overlay's ellipsis; stopped when the overlay hides. */
  private reconnectDotsEvent?: Phaser.Time.TimerEvent;

  // ── Connect lifecycle / error UX ────────────────────────────────
  /** Monotonic id for the current connect attempt; lets a timed-out join abandon a late room. */
  private connectAttempt = 0;
  /** Screen-fixed friendly error panel (with Retry) shown when a connect attempt fails. */
  private connectErrorOverlay?: Phaser.GameObjects.Container;
  /** Last classified error, kept so a window resize can re-lay-out the panel. */
  private lastConnectError?: ConnectErrorInfo;
  /** Retry handler bound to the current error panel (used when re-laying-out on resize). */
  private lastConnectRetry?: () => void;
  /** Screen-fixed HUD connection-status pill (dot + label). */
  private connStatusContainer?: Phaser.GameObjects.Container;
  private connStatusDot?: Phaser.GameObjects.Arc;
  private connStatusText?: Phaser.GameObjects.Text;
  /** Auto-hide timer for the "Online" pill so a healthy HUD stays uncluttered. */
  private connStatusHideEvent?: Phaser.Time.TimerEvent;
  /** Most recent server announcement; used to surface a ban/kick reason on a join-time disconnect. */
  private lastAnnouncement?: { text: string; at: number };

  private pendingSpawnId?: string;
  /**
   * Per-login generation token for the single-live-session guard. Issued by the server on
   * the first join and echoed on every map/channel transfer so a relocation isn't treated
   * as a duplicate login. Held in-memory (NOT persisted) so a fresh tab/login starts
   * without one and is correctly recognised as a second session.
   */
  private sessionGeneration?: string;
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
    generation?: string;
    _welcomeBanner?: string;
    _fromTransition?: boolean;
  }): Promise<void> {
    this.mapId = data?.mapId ?? "dawn_isle";
    this.pendingSpawnId = data?.spawnId;
    // Carry the session generation across a transfer (a fresh login leaves it undefined).
    this.sessionGeneration = data?.generation;
    this.registry.set("mapId", this.mapId);
    const resolvedMap = getMap(this.mapId);
    if (!resolvedMap) {
      console.error(`[map] unknown map id: ${this.mapId}`);
      return;
    }
    this.map = resolvedMap;
    this.transitioning = false;
    // Phaser reuses the scene instance across restarts (travel / channel switch), so reset
    // reconnection state here — the prior overlay GameObjects were destroyed on shutdown,
    // leaving these refs dangling.
    this.reconnecting = false;
    this.reconnectOverlay = undefined;
    this.reconnectDotsEvent = undefined;
    // Connection-UX state is likewise per-instance — clear dangling refs from a prior run.
    this.connectErrorOverlay = undefined;
    this.lastConnectError = undefined;
    this.connStatusContainer = undefined;
    this.connStatusDot = undefined;
    this.connStatusText = undefined;
    this.connStatusHideEvent = undefined;
    this.lastAnnouncement = undefined;

    // Re-layout the connection overlays when the (RESIZE-mode) canvas changes size, and
    // detach the listener on scene shutdown so restarts don't stack handlers.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.reflowConnectionUi, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.reflowConnectionUi, this);
      this.connStatusHideEvent?.remove();
    });

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
      loadScene(this.game, "coachmarks", () => import("./CoachMarks")).then(() => {
        if (!this.scene.isActive("coachmarks")) this.scene.launch("coachmarks");
      });
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

    await this.attemptConnect();

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
    // While the socket is dropped, the SDK buffers sends (and would flush stale movement
    // on reconnect). Freeze input/interaction until we're back; the world holds in place.
    if (this.reconnecting) return;

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

    // ── Onboarding: move coach mark is now fired on spawn (see bindState local player).
    // Keep the flag check so the old input-based trigger no-ops if spawn already fired. ──
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
        this.localVx = 0;
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
          // ── Horizontal velocity (acceleration / friction for gliding Maple feel) ──
          const currentFh = this.localGrounded
            ? this.nearestFootholdAt(player.x, player.y)
            : undefined;
          const isSlippery = currentFh?.slippery === true;
          const a = isSlippery ? PLAYER_SLIPPERY_ACCEL : PLAYER_ACCEL;
          const f = isSlippery ? PLAYER_SLIPPERY_FRICTION : PLAYER_FRICTION;

          if (left) {
            const target = -PLAYER_SPEED;
            if (this.localVx > target) {
              this.localVx = Math.max(target, this.localVx - a * dt);
            }
            player.setFlipX(true);
          } else if (right) {
            const target = PLAYER_SPEED;
            if (this.localVx < target) {
              this.localVx = Math.min(target, this.localVx + a * dt);
            }
            player.setFlipX(false);
          } else {
            // No input: friction decelerates toward 0.
            if (this.localVx > 0) {
              this.localVx = Math.max(0, this.localVx - f * dt);
            } else if (this.localVx < 0) {
              this.localVx = Math.min(0, this.localVx + f * dt);
            }
          }
          player.x += this.localVx * dt;
          player.x = Phaser.Math.Clamp(player.x, 0, this.map.width);

          // ── Grounded re-check after horizontal movement (slope follow + walk-off-edge) ──
          if (this.localGrounded) {
            const skipId = this.localDropThroughTimer > 0 ? this.localDropThroughFootholdId : -1;
            const fh = this.nearestFootholdAt(player.x, player.y, skipId);
            if (fh) {
              player.y = groundYAt(fh, player.x); // snap to surface (handles slopes)
            } else {
              this.localGrounded = false; // no platform nearby
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
            // Normal land physics — Jump / Drop-through (edge-triggered, mirrors server)
            if (jump && !this.lastJumpHeld && this.localGrounded) {
              if (down) {
                // MapleStory drop-through: fall through a one-way (non-solid) platform.
                const currentFh = this.nearestFootholdAt(player.x, player.y);
                if (currentFh && !currentFh.solid) {
                  this.localDropThroughFootholdId = currentFh.id;
                  this.localDropThroughTimer = DROP_THROUGH_MS;
                  this.localGrounded = false;
                }
                // Solid foothold → do nothing (can't drop through the ground).
              } else {
                this.localVy = JUMP_VELOCITY;
                this.localGrounded = false;
              }
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
              const skipId = this.localDropThroughTimer > 0 ? this.localDropThroughFootholdId : -1;
              const fh = this.landingFoothold(player.x, prevY, player.y, skipId);
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
                const skipId =
                  this.localDropThroughTimer > 0 ? this.localDropThroughFootholdId : -1;
                const fh = this.landingFoothold(player.x, prevY, player.y, skipId);
                if (fh) {
                  player.y = groundYAt(fh, player.x);
                  this.localVy = 0;
                  this.localGrounded = true;
                  this.localDropThroughFootholdId = -1; // clear once landed
                }
              }
            }
          }

          // Decrement drop-through timer (mirrors server tickPlayerTimers).
          if (this.localDropThroughTimer > 0) this.localDropThroughTimer -= delta;

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
  /**
   * Drive a single connect attempt with full error UX:
   *   - clears any prior error panel and flags the HUD "connecting",
   *   - on an expired/invalid token (AUTH_FAILED) routes to a clean re-login,
   *   - on any other failure classifies it and shows a friendly, retryable error screen
   *     (instead of the old generic dead-end).
   *
   * Re-entrant by design: the Retry button calls straight back into this.
   */
  private async attemptConnect(): Promise<void> {
    this.clearConnectionError();
    this.setConnStatus("connecting");
    try {
      await this.connect();
    } catch (err) {
      // AUTH_FAILED means the token is expired/invalid — not "server down". Force a clean
      // re-login (preserving local UI state) rather than showing the offline panel.
      if (this.isAuthError(err)) {
        console.warn(`[map] join rejected (auth) — forcing re-login`);
        this.forceRelogin();
        return;
      }
      const info = this.classifyConnectError(err);
      console.error(`[map] connect failed (${info.kind}) for ${this.mapId}`, err);
      this.setConnStatus("offline");
      this.showConnectionError(info);
    }
  }

  private async connect(): Promise<void> {
    const attempt = ++this.connectAttempt;
    const client = new Client(BACKEND_URL);
    // Present the server-issued session token minted by the login flow. The server
    // derives identity from this token — never from options. We set it as the bearer
    // credential AND pass it in the join options (onAuth reads either).
    const { token } = await authenticateForPlay();
    client.auth.token = token;
    // If a proactive refresh ever fails (token expired/revoked while playing), route
    // cleanly back to login — preserving local UI state (clearSession keeps it).
    setSessionExpiredHandler(() => this.forceRelogin());
    // Use channel-named rooms: `{mapId}__ch{N}` for N>0, bare `{mapId}` for channel 0 (compat).
    const channel = (this.registry.get("channel") as number | undefined) ?? getCurrentChannel();
    const roomName = channel > 0 ? `${this.mapId}__ch${channel}` : this.mapId;
    const room = await this.joinWithTimeout(client, roomName, {
      token,
      // Report the wire-protocol version so the server can reject a stale client with a clear
      // "please refresh" instead of letting a mismatched build silently misbehave.
      protocolVersion: PROTOCOL_VERSION,
      name: getPlayerName(),
      charId: getCharId() ?? undefined,
      spawnId: this.pendingSpawnId,
      // Echo the generation token (if this is a transfer) so the server's single-live-
      // session guard recognises us as the same login relocating, not a second login.
      generation: this.sessionGeneration,
    });

    // A newer attempt superseded us (rapid retry) or the scene is tearing down —
    // abandon this room so we don't double-bind or leak a socket.
    if (attempt !== this.connectAttempt || this.transitioning) {
      void room.leave().catch(() => {
        /* already closing */
      });
      return;
    }

    this.room = room;
    this.localSessionId = room.sessionId;
    // Publish the live connection so UIScene / MarketScene reuse this socket instead of a new one.
    this.registry.set(ROOM_REGISTRY_KEY, room);
    this.registry.set(CHAT_FOCUSED_KEY, false);

    room.onError((code, message) => console.error(`[map] room error ${code}: ${message ?? ""}`));

    // A banned account (or a moderation kick) is delivered as a server announcement
    // immediately before the server closes the socket. Capture the latest one so a
    // join-time disconnect can surface the reason on the error screen.
    room.onMessage(MessageType.SERVER_ANNOUNCEMENT, (payload: ServerAnnouncementPayload) => {
      this.lastAnnouncement = { text: payload.text, at: Date.now() };
    });

    // Stun/slow visual on local player sprite — tint amber when stunned.
    room.onMessage(
      MessageType.STATUS_EFFECTS,
      (payload: { effects: { kind: string; id: string }[] }) => {
        const sprite = this.playerSprites.get(this.localSessionId);
        if (!sprite) return;
        const isStunned = payload.effects.some((e) => e.kind === "stun");
        const wasStunned = sprite.getData("stunned") === true;
        if (isStunned && !wasStunned) {
          sprite.setTintFill(0xffaa00);
        } else if (!isStunned && wasStunned) {
          sprite.clearTint();
        }
        sprite.setData("stunned", isStunned);
      },
    );

    this.configureReconnection(room);

    this.bindState(room);
    this.bindChat(room);

    // We're live — flip the HUD indicator green (it auto-hides shortly after).
    this.setConnStatus("online");
  }

  /**
   * Wrap `joinOrCreate` in a configurable timeout so a silent/half-open socket can't
   * leave the player on a frozen screen. If the join hasn't settled within
   * CONNECT_TIMEOUT_MS we reject with a ConnectTimeoutError; a late-arriving room is
   * abandoned by the attempt-id guard in connect().
   */
  private joinWithTimeout(
    client: Client,
    roomName: string,
    options: Record<string, unknown>,
  ): Promise<Room<unknown, TownStateView>> {
    return new Promise<Room<unknown, TownStateView>>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new ConnectTimeoutError());
      }, CONNECT_TIMEOUT_MS);
      client.joinOrCreate<TownStateView>(roomName, options).then(
        (room) => {
          clearTimeout(timer);
          if (settled) {
            // Timed out already — don't leak the socket that arrived late.
            void room.leave().catch(() => {
              /* already closing */
            });
            return;
          }
          settled = true;
          resolve(room);
        },
        (err: unknown) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          reject(err as Error);
        },
      );
    });
  }

  /**
   * Wire graceful reconnection on top of the Colyseus SDK's built-in auto-reconnect.
   *
   * The SDK transparently re-establishes the SAME room instance (state + all our
   * `bindState` callbacks survive), so a successful reconnect resumes the player in place
   * — the server held our Player entity for its grace window (MapRoom.onDrop). We only
   * layer on UX: a "Reconnecting…" overlay on drop, resume on success, and a clean
   * fall-back to the login / character-select flow when retries are exhausted.
   *
   * Retry budget is tuned to slightly outlast the server's RECONNECT_GRACE_SECONDS (20s)
   * so a within-window restore always succeeds, while a longer drop gives up promptly.
   */
  private configureReconnection(room: Room<unknown, TownStateView>): void {
    const r = room.reconnection;
    r.enabled = true;
    r.minUptime = 0; // reconnect even if the drop happens moments after joining
    r.maxDelay = 2000; // cap backoff so each retry stays responsive
    r.maxRetries = 14; // ~23s total budget (just past the 20s server grace window)

    // Unexpected socket drop — the SDK has begun auto-reconnecting with backoff.
    room.onDrop((code, reason) => {
      // A consented leave we initiated (travel / channel switch / force logout / kick)
      // routes through onLeave instead; if a transition is already underway, ignore.
      if (this.transitioning) return;
      console.warn(`[map] dropped (code ${code}${reason ? `: ${reason}` : ""}) — reconnecting…`);
      this.reconnecting = true;
      this.setConnStatus("reconnecting");
      this.showReconnectOverlay();
    });

    // Reconnection succeeded — same session, state stream resumes; just drop the overlay.
    room.onReconnect(() => {
      console.log("[map] reconnected");
      this.reconnecting = false;
      this.setConnStatus("online");
      this.hideReconnectOverlay();
    });

    // Terminal leave: either a consented leave we initiated, or reconnection ultimately
    // failed (retries exhausted / server grace window elapsed). If we didn't initiate it,
    // fall back cleanly to the login screen (which lands on character select).
    room.onLeave((code, reason) => {
      console.warn(`[map] left ${this.mapId} (code ${code}${reason ? `: ${reason}` : ""})`);
      this.reconnecting = false;
      this.hideReconnectOverlay();
      if (this.transitioning) return; // a normal scene transition is already handling this

      // A ban / moderation kick arrives as a SERVER_ANNOUNCEMENT immediately before the
      // server closes the socket. If we saw one in the last few seconds, surface the reason
      // on the error screen instead of silently bouncing to login.
      const ban = this.recentBanAnnouncement();
      if (ban) {
        this.setConnStatus("offline");
        this.room = undefined;
        this.registry.set(ROOM_REGISTRY_KEY, undefined);
        this.showConnectionError({
          kind: "banned",
          title: "Account banned",
          message: ban,
        });
        return;
      }
      this.handleTerminalDisconnect();
    });
  }

  /**
   * The text of a ban/kick announcement received within the last ~4s, or null.
   * Used to distinguish a moderation disconnect from an ordinary network drop.
   */
  private recentBanAnnouncement(): string | null {
    const a = this.lastAnnouncement;
    if (!a) return null;
    if (Date.now() - a.at > 4000) return null;
    return a.text;
  }

  /** Whether a join error was an auth rejection (expired/invalid token → AUTH_FAILED 4212). */
  private isAuthError(err: unknown): boolean {
    const code = (err as { code?: number } | null)?.code;
    return code === 4212; // Colyseus ErrorCode.AUTH_FAILED
  }

  /**
   * The session is no longer valid (token expired/revoked). Drop the credential but
   * KEEP local UI state (selected character, name, quickslots, channel) so the player
   * resumes where they were after signing back in, then route cleanly to login.
   */
  private forceRelogin(): void {
    if (this.transitioning) return;
    this.transitioning = true;
    setSessionExpiredHandler(null);
    clearSession();
    this.room = undefined;
    this.registry.set(ROOM_REGISTRY_KEY, undefined);
    this.scene.start("login");
  }

  /**
   * Could not reconnect in time (server down / network lost / grace window elapsed).
   * Instead of the old dead-end bounce to login, show the friendly retryable error
   * screen. Retry does a CLEAN scene restart (fresh room + state bind, no duplicate
   * sprites) so that when the server returns the player rejoins the same map.
   */
  private handleTerminalDisconnect(): void {
    this.room = undefined;
    this.registry.set(ROOM_REGISTRY_KEY, undefined);
    this.setConnStatus("offline");
    this.showConnectionError(
      {
        kind: "offline",
        title: "Connection lost",
        message: `You were disconnected from ${this.map?.name ?? "the server"} and couldn't reconnect. The server may be down or restarting. Retry when you're ready.`,
      },
      () => this.restartScene(),
    );
  }

  /** Clean restart of this map scene — re-runs create() → attemptConnect() from scratch. */
  private restartScene(): void {
    this.clearConnectionError();
    this.scene.restart({
      mapId: this.mapId,
      spawnId: this.pendingSpawnId,
      generation: this.sessionGeneration,
    });
  }

  /** Build (once) and show the screen-fixed "Reconnecting…" overlay with an animated ellipsis. */
  private showReconnectOverlay(): void {
    if (this.reconnectOverlay) {
      this.reconnectOverlay.setVisible(true);
      return;
    }
    const w = this.scale.width;
    const h = this.scale.height;
    const backdrop = this.add.rectangle(0, 0, w, h, 0x05070d, 0.62).setOrigin(0);
    const panel = this.add.rectangle(w / 2, h / 2, 320, 120, 0x131a2b, 0.95).setOrigin(0.5);
    panel.setStrokeStyle(1, 0x3b4a66, 1);
    const title = this.add
      .text(w / 2, h / 2 - 16, "Reconnecting", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "20px",
        color: "#f6c177",
        align: "center",
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(w / 2, h / 2 + 18, "Hold tight — restoring your session", {
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "12px",
        color: "#9aa7c2",
        align: "center",
      })
      .setOrigin(0.5);

    const overlay = this.add.container(0, 0, [backdrop, panel, title, sub]);
    overlay.setScrollFactor(0).setDepth(20_000);
    this.reconnectOverlay = overlay;

    // Animate the trailing ellipsis so it's visibly "working".
    let dots = 0;
    this.reconnectDotsEvent = this.time.addEvent({
      delay: 350,
      loop: true,
      callback: () => {
        dots = (dots + 1) % 4;
        title.setText(`Reconnecting${".".repeat(dots)}`);
      },
    });
  }

  /** Hide the reconnection overlay and stop its animation (kept for cheap re-show). */
  private hideReconnectOverlay(): void {
    this.reconnectDotsEvent?.remove();
    this.reconnectDotsEvent = undefined;
    this.reconnectOverlay?.setVisible(false);
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

      // Seed prevAnimX so updateRemoteAnim has a baseline for movement detection
      // from the very first frame (avoids a 1-frame idle flash on spawn).
      sprite.setData("prevAnimX", player.x);

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

        // ── Onboarding: fire coach marks on first spawn ──
        // Fire the move hint shortly after spawn so the player knows they can move
        // immediately, instead of waiting for first input.
        if (!this.coachMoveFired) {
          this.coachMoveFired = true;
          this.time.delayedCall(1200, () => {
            this.registry.set("coachmark:move", true);
          });
        }
        // Fire the first-objective hint for brand-new characters on Dawn Isle.
        if (this.mapId === "dawn_isle") {
          const charId = getCharId();
          if (charId) {
            const seen = getSeenCoachMarks(charId);
            if (!seen.has("firstObjective")) {
              this.time.delayedCall(800, () => {
                this.registry.set("coachmark:firstObjective", true);
              });
            }
          }
        }

        // Seed prediction state from the authoritative server snapshot.
        this.localVx = 0;
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
          // Dim remote players who are riding out a reconnection grace window so others
          // can tell they've briefly dropped (entity is held server-side until they
          // resume or the window elapses).
          sprite.setAlpha(player.connected ? 1 : 0.4);
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
      sprite.setData("stunned", mob.stunned);

      // Zone-based visual differentiation: tint mobs by biome + element, scale by mob type.
      // Elite override below will replace this with gold for elite mobs.
      const biome = resolveBiomeSet(this.mapId, this.map.bgSet);
      const element = getMobDef(mob.mobId)?.element as import("@maple/shared").Element | undefined;
      sprite.setTint(mobTint(mob.mobId, biome, element));
      sprite.setScale(mobScale(mob.mobId));

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

        // Stun visual: amber tint while stunned, clear on unstun.
        const wasStunned = sprite.getData("stunned") === true;
        if (mob.stunned && !wasStunned) {
          sprite.setTint(0xffaa00);
        } else if (!mob.stunned && wasStunned && !mob.isElite) {
          sprite.clearTint();
        } else if (!mob.stunned && wasStunned && mob.isElite) {
          sprite.setTint(0xffd700); // restore elite golden tint
        }
        sprite.setData("stunned", mob.stunned);

        // Caster telegraph visual: draw AoE circle while telegraph is active.
        const prevTelegraph = sprite.getData("telegraph") as string;
        if (mob.bossTelegraph !== prevTelegraph) {
          sprite.setData("telegraph", mob.bossTelegraph);
          const existingTg = this.telegraphGfx.get(key);
          if (existingTg) {
            existingTg.destroy();
            this.telegraphGfx.delete(key);
          }
          if (mob.bossTelegraph !== "" && !mob.dead) {
            const tgGfx = this.add.graphics();
            tgGfx.setDepth(mob.y - 1);
            this.drawTelegraphCircle(tgGfx, mob.x, mob.y, 80);
            this.telegraphGfx.set(key, tgGfx);
          }
        }
        // Animate telegraph pulsing.
        const tgGfx = this.telegraphGfx.get(key);
        if (tgGfx && mob.bossTelegraph !== "") {
          const pulse = 0.3 + Math.sin(this.time.now * 0.008) * 0.15;
          tgGfx.setAlpha(pulse);
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
      // Clean up telegraph visual.
      const tg = this.telegraphGfx.get(key);
      if (tg) {
        tg.destroy();
        this.telegraphGfx.delete(key);
      }
    });

    // ── Mob projectiles ──
    $(room.state).projectiles.onAdd((proj: ProjectileView, key: string) => {
      const gfx = this.add.graphics();
      gfx.setDepth(proj.y + 1);
      this.drawProjectile(gfx, proj);
      this.projectileGfx.set(key, gfx);
    });
    $(room.state).projectiles.onChange((proj: ProjectileView, key: string) => {
      const gfx = this.projectileGfx.get(key);
      if (gfx) {
        gfx.setPosition(proj.x, proj.y);
        gfx.setDepth(proj.y + 1);
        this.drawProjectile(gfx, proj);
      }
    });
    $(room.state).projectiles.onRemove((_proj: ProjectileView, key: string) => {
      const gfx = this.projectileGfx.get(key);
      if (gfx) {
        gfx.destroy();
        this.projectileGfx.delete(key);
      }
    });

    // ── Mob explosion events (exploder VFX) ──
    room.onMessage(
      "mob_explode",
      (data: { mobId: string; x: number; y: number; radius: number }) => {
        this.playExplosion(data.x, data.y, data.radius);
      },
    );

    // ── Loot drops (no shadow — they sit flat on the grass) ──
    const tierColor: Record<string, string> = {
      COMMON: "#aaaaaa",
      RARE: "#ffffff",
      EPIC: "#6eb5ff",
      UNIQUE: "#b57aff",
      LEGENDARY: "#ffc847",
    };
    $(room.state).loot.onAdd((loot: LootView, uid: string) => {
      const key = loot.legendary ? TextureKeys.LootGemLegendary : TextureKeys.LootGem;
      const sprite = this.add.sprite(loot.x, loot.y, key);
      sprite.setDepth(loot.y);
      this.lootSprites.set(uid, sprite);

      // Item name label above the gem.
      const itemName = getItemDef(loot.defId)?.name ?? loot.defId;
      const color = loot.legendary ? "#ffc847" : (tierColor[loot.potentialTier] ?? "#ffffff");
      const label = this.add
        .text(loot.x, loot.y - 18, itemName, {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: loot.legendary ? "11px" : "10px",
          color,
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(loot.y + 1);
      this.lootLabels.set(uid, label);

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

      // ── Legendary drop screen flourish: green flash + floating label ──
      if (loot.legendary) {
        this.playLegendaryDropFlourish(loot.x, loot.y);
      }

      // Loot is static; its position only changes if the server nudges it.
      $(loot).onChange(() => {
        sprite.setPosition(loot.x, loot.y);
        sprite.setDepth(loot.y);
        label.setPosition(loot.x, loot.y - 18);
        label.setDepth(loot.y + 1);
      });
    });

    $(room.state).loot.onRemove((_loot: LootView, uid: string) => {
      this.pickupRequestedAt.delete(uid);
      this.destroyTracked(this.lootSprites, uid);
      const label = this.lootLabels.get(uid);
      if (label) {
        this.tweens.killTweensOf(label);
        label.destroy();
        this.lootLabels.delete(uid);
      }
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

    room.onMessage("storage_open", async () => {
      if (this.scene.isActive("storage")) return;
      await loadScene(this.game, "storage", () => import("./Storage"));
      this.scene.launch("storage");
      this.scene.pause();
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

    // Store the per-login generation token so transfers carry it (single-session guard).
    room.onMessage(MessageType.SESSION_GENERATION, (payload: SessionGenerationPayload) => {
      this.sessionGeneration = payload.generation;
    });

    // The server kicked this session because the character logged in elsewhere.
    // Drop back to the login screen (which lands on character select) — it does NOT
    // auto-rejoin a map, so there's no kick ping-pong with the session that took over.
    room.onMessage(MessageType.FORCE_LOGOUT, (payload: ForceLogoutPayload) => {
      console.warn(`[map] force logout: ${payload.reason}`);
      this.transitioning = true;
      this.room?.leave();
      this.room = undefined;
      this.scene.start("login");
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
      loadScene(this.game, "loading", () => import("./Loading")).then(() => {
        this.scene.launch("loading", { mapName: destName });
      });

      // Fade out then hand off to a fresh MapScene instance for the destination.
      this.cameras.main.fade(400, 0, 0, 0);
      this.time.delayedCall(500, () => {
        this.scene.start("map", {
          mapId: payload.mapId,
          spawnId: payload.spawnId,
          generation: this.sessionGeneration,
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

    // ── Scheduled transport countdown ──
    room.onMessage(MessageType.TRANSPORT_STATUS, (payload: TransportStatusPayload) => {
      uiStore.getState().setTransport({
        portalLabel: payload.portalLabel,
        departInMs: payload.departInMs,
        boardedCount: payload.boardedCount,
        portalId: payload.portalId,
        receivedAt: Date.now(),
      });
    });

    room.onMessage(
      MessageType.TRANSPORT_DEPARTED,
      (payload: { portalLabel: string; mapId: string }) => {
        // Clear the countdown banner — the TRAVEL message follows immediately.
        uiStore.getState().setTransport(null);
        const player = this.localPlayer;
        if (player) {
          this.floatText(
            player.x,
            player.y - 40,
            `🚢 ${payload.portalLabel} departing!`,
            "#93c5fd",
          );
        }
      },
    );

    // Clear transport state when leaving the room (teleport, disconnect, etc.).
    room.onLeave(() => {
      uiStore.getState().setTransport(null);
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
      loadScene(this.game, "loading", () => import("./Loading")).then(() => {
        this.scene.launch("loading", { mapName: destName });
      });

      this.cameras.main.fade(300, 0, 0, 0);
      this.time.delayedCall(350, () => {
        this.scene.start("map", {
          mapId: payload.mapId,
          spawnId: payload.spawnId,
          channel: payload.channel,
          generation: this.sessionGeneration,
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
        // Store for NPC indicator computation.
        this.questLogData = payload.quests;
        this.updateNpcIndicators();
        // Show a floating notification when a new quest is accepted.
        for (const q of payload.quests) {
          if (q.status === "active") {
            this.registry.set(QUEST_NOTIFY_KEY, `📋 Quest accepted: ${q.name}`);
            getAudioManager().playSfx("quest_complete");
          }
        }
      },
    );

    // ── Quest turn-in flourish: golden burst + particles at the player ──
    room.onMessage(
      "quest_turnin",
      (_payload: {
        questId: string;
        questName: string;
        mesos: number;
        exp: number;
        items: string[];
      }) => {
        if (this.localPlayer) {
          this.playQuestCompleteFlourish(this.localPlayer.x, this.localPlayer.y);
        }
      },
    );

    // ── Achievement unlock: float text + bridge toast to React overlay ──
    room.onMessage(
      MessageType.ACHIEVEMENT_UNLOCK,
      (payload: {
        achievementId: string;
        name: string;
        description: string;
        rewards: { mesos?: number; exp?: number; title?: string };
      }) => {
        // Float text in the game world.
        if (this.localPlayer) {
          this.floatText(
            this.localPlayer.x,
            this.localPlayer.y - 50,
            `🏆 Achievement: ${payload.name}`,
            "#facc15",
          );
          getAudioManager().playSfx("levelup");
        }
        // Title float text if earned.
        if (payload.rewards.title && this.localPlayer) {
          this.floatText(
            this.localPlayer.x,
            this.localPlayer.y - 70,
            `🏅 Title: ${payload.rewards.title}`,
            "#facc15",
          );
        }
        // Emit to Phaser game event bus so the React overlay can toast.
        this.game.events.emit("achievement-unlock", {
          id: payload.achievementId,
          name: payload.name,
          description: payload.description,
          rewards: payload.rewards,
        });
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
        // Play attack animation on the attacker's sprite (remote players only —
        // the local player's attack is driven by playSwing() in the update loop).
        if (
          payload.hit &&
          payload.attackerSession &&
          payload.attackerSession !== this.localSessionId
        ) {
          const attackerSprite = this.playerSprites.get(payload.attackerSession);
          if (attackerSprite) {
            const atkPrefix = attackerSprite.getData("apPrefix") as string | undefined;
            const atkKey = atkPrefix ? `${atkPrefix}_attack` : "warrior_attack";
            attackerSprite.play(atkKey);
            // Guard the animation so updateRemoteAnim doesn't immediately override it.
            attackerSprite.setData("attackAnimUntil", this.time.now + 250);
          }
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

    // ── DoT/HoT effect ticks — floating damage/heal number on the affected player ──
    room.onMessage(
      "effect_tick",
      (payload: { sessionId: string; delta: number; hp: number; dead: boolean }) => {
        const sprite = this.playerSprites.get(payload.sessionId);
        if (!sprite) return;
        this.showCombatNumber(sprite.x, sprite.y - sprite.displayHeight / 2 - 10, {
          targetKey: "",
          attackerSession: "",
          damage: Math.abs(payload.delta),
          crit: false,
          hit: true,
          mobHp: 0,
          mobMaxHp: 0,
        });
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
        this.floatText(c.x, c.y - 20, String(payload.damage), "#ffffff");
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

    room.onMessage(MessageType.TREASURE_DESPAWN, (payload: TreasureDespawnPayload) => {
      const c = this.boxSprites.get(payload.boxId);
      if (c) {
        this.tweens.killTweensOf(c);
        c.destroy();
        this.boxSprites.delete(payload.boxId);
      }
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

  // ─── Behavior VFX helpers ───────────────────────────────────────────────

  /** Draw a projectile as a small colored circle. */
  private drawProjectile(gfx: Phaser.GameObjects.Graphics, proj: ProjectileView): void {
    gfx.clear();
    const color = proj.kind === "caster" ? 0xa855f7 : 0xef4444; // purple caster, red ranged
    const radius = proj.kind === "caster" ? 5 : 4;
    gfx.fillStyle(color, 0.9);
    gfx.fillCircle(0, 0, radius);
    gfx.lineStyle(1, 0xffffff, 0.6);
    gfx.strokeCircle(0, 0, radius + 1);
  }

  /** Draw a telegraph AoE circle on the ground. */
  private drawTelegraphCircle(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
  ): void {
    gfx.clear();
    gfx.fillStyle(0xff4444, 0.2);
    gfx.fillCircle(x, y, radius);
    gfx.lineStyle(2, 0xff4444, 0.7);
    gfx.strokeCircle(x, y, radius);
  }

  /** Play a brief explosion VFX at a position (exploder mob self-destruct). */
  private playExplosion(x: number, y: number, radius: number): void {
    const gfx = this.add.graphics();
    gfx.setDepth(y + 5);
    gfx.fillStyle(0xff6600, 0.7);
    gfx.fillCircle(x, y, radius);
    gfx.lineStyle(3, 0xffaa00, 0.9);
    gfx.strokeCircle(x, y, radius);
    this.explosionGfx.push(gfx);
    // Fade out over 400ms then remove.
    this.time.delayedCall(400, () => {
      gfx.destroy();
      const idx = this.explosionGfx.indexOf(gfx);
      if (idx !== -1) this.explosionGfx.splice(idx, 1);
    });
  }

  // ─── Rendering helpers ────────────────────────────────────────────────────────────────────────
  /** Resolve the biome palette for the current map. */
  private get biomePalette(): BiomePalette {
    return resolveBiomePalette(resolveBiomeSet(this.mapId, this.map.bgSet));
  }

  /** Bake the scenic terrain (parallax layers + platforms from footholds) into a render texture. */
  private buildBackground(): void {
    const palette = this.biomePalette;
    this.buildParallaxLayers(palette);

    const gfx = this.make.graphics();

    // ── Terrain from footholds (sky is handled by the parallax sky layer) ──
    for (const fh of this.map.footholds) {
      this.drawTerrainPlatform(gfx, fh, palette);
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
    if (palette.useTileOverlay) {
      for (const fh of this.map.footholds) {
        this.stampTerrainTiles(ground, fh);
      }
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
   * giving depth as the player moves across the map.
   * Procedurally generated per biome palette — no biome-specific PNGs required.
   */
  private buildParallaxLayers(palette: BiomePalette): void {
    const W = this.map.width;
    const H = this.map.height;

    // ── Far sky: vertical gradient (skyTop → skyBottom) ──
    const skyKey = `__sky_${this.mapId}`;
    if (!this.textures.exists(skyKey)) {
      const sg = this.make.graphics();
      sg.fillGradientStyle(palette.skyTop, palette.skyTop, palette.skyBottom, palette.skyBottom);
      sg.fillRect(0, 0, 1, H);
      sg.generateTexture(skyKey, 1, H);
      sg.destroy();
    }
    this.add
      .tileSprite(0, 0, W + 400, H, skyKey)
      .setOrigin(0, 0)
      .setScrollFactor(0.1, 0)
      .setDepth(GROUND_DEPTH - 3);

    // ── Mid hills: silhouetted rolling shapes ──
    const hillH = 350;
    const hillKey = `__hills_${this.mapId}`;
    if (!this.textures.exists(hillKey)) {
      const hg = this.make.graphics();
      hg.fillStyle(palette.hillColor, 1);
      // Draw a jagged hill silhouette across the width
      const hillPts: { x: number; y: number }[] = [{ x: 0, y: hillH }];
      const hillStep = 80;
      for (let hx = 0; hx <= W + 800; hx += hillStep) {
        const hy =
          hillH * 0.3 +
          Math.sin(hx * 0.008) * hillH * 0.2 +
          Math.sin(hx * 0.015 + 1.3) * hillH * 0.12;
        hillPts.push({ x: hx, y: hy });
      }
      hillPts.push({ x: W + 800, y: hillH });
      hg.fillPoints(hillPts, true, true);
      hg.generateTexture(hillKey, W + 800, hillH);
      hg.destroy();
    }
    this.add
      .tileSprite(0, H - hillH, W + 800, hillH, hillKey)
      .setOrigin(0, 0)
      .setScrollFactor(0.3, 0)
      .setDepth(GROUND_DEPTH - 2);

    // ── Near trees: silhouetted treeline ──
    const treeH = 280;
    const treeKey = `__trees_${this.mapId}`;
    if (!this.textures.exists(treeKey)) {
      const tg = this.make.graphics();
      tg.fillStyle(palette.treeColor, 1);
      // Draw a jagged treeline silhouette
      const treePts: { x: number; y: number }[] = [{ x: 0, y: treeH }];
      const treeStep = 40;
      for (let tx = 0; tx <= W + 1200; tx += treeStep) {
        const ty =
          treeH * 0.25 +
          Math.sin(tx * 0.012 + 0.7) * treeH * 0.18 +
          Math.sin(tx * 0.025 + 2.1) * treeH * 0.1;
        treePts.push({ x: tx, y: ty });
      }
      treePts.push({ x: W + 1200, y: treeH });
      tg.fillPoints(treePts, true, true);
      tg.generateTexture(treeKey, W + 1200, treeH);
      tg.destroy();
    }
    this.add
      .tileSprite(0, H - treeH, W + 1200, treeH, treeKey)
      .setOrigin(0, 0)
      .setScrollFactor(0.6, 0)
      .setDepth(GROUND_DEPTH - 1);
  }

  /**
   * Draw a single terrain platform (grass cap + dirt body + outline) for a foothold.
   * Slopes follow the segment angle via groundYAt sampling.
   */
  private drawTerrainPlatform(
    gfx: Phaser.GameObjects.Graphics,
    fh: Foothold,
    palette: BiomePalette,
  ): void {
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

    // ── Surface cap polygon (surface ± GRASS_HALF) ──
    const grassTop: { x: number; y: number }[] = [];
    const grassBot: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const p = surfPts[i];
      if (p) {
        grassTop.push({ x: p.x, y: p.y - GRASS_HALF });
        grassBot.push({ x: p.x, y: p.y + GRASS_HALF });
      }
    }
    gfx.fillStyle(palette.surfaceColor, 1);
    gfx.fillPoints([...grassTop, ...grassBot.reverse()], true, true);

    // ── Body polygon ──
    const dirtTop: { x: number; y: number }[] = [];
    const dirtBot: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      const p = surfPts[i];
      if (p) {
        dirtTop.push({ x: p.x, y: p.y + GRASS_HALF });
        dirtBot.push({ x: p.x, y: isGround ? this.map.height : p.y + DIRT_DEPTH });
      }
    }
    gfx.fillStyle(palette.bodyColor, 1);
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
      gfx.fillStyle(palette.bandColor, 0.35);
      gfx.fillPoints([...darkTop, ...darkBot.reverse()], true, true);
    }

    // ── Grain speckles ──
    gfx.fillStyle(palette.speckleColor, 0.3);
    const speckStep = 16;
    for (let sx = minX + 8; sx < maxX; sx += speckStep) {
      const sy = groundYAt(fh, sx);
      const bottom = isGround ? this.map.height : sy + DIRT_DEPTH;
      const speckY = sy + GRASS_HALF + 8 + ((sx * 7) % 12);
      if (speckY < bottom - 4) {
        gfx.fillRect(sx, speckY, 2, 2);
      }
    }

    // ── Surface edge silhouettes along top edge ──
    gfx.fillStyle(palette.bladeColor, 0.7);
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
    gfx.lineStyle(1.5, palette.outlineColor, 0.45);
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

      // Right-click context menu for NPCs.
      sprite.setInteractive({ useHandCursor: true });
      sprite.on("pointerdown", (_pointer: Phaser.Input.Pointer) => {
        if (_pointer.rightButtonDown()) {
          this.game.events.emit("npc-rightclick", {
            npcId: npc.id,
            npcName: npc.name,
            role: npc.role,
            worldX: _pointer.worldX,
            worldY: _pointer.worldY,
          });
        }
      });

      // Quest indicator (! / ?) above the NPC name — hidden until quest data arrives.
      const indicator = this.add
        .text(npc.x, npc.y - 46, "", {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: "18px",
          fontStyle: "bold",
          color: "#facc15",
          stroke: "#1a1a2e",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(npc.y + 1002)
        .setAlpha(0);

      this.npcIndicators.set(npc.id, indicator);
    }
    // Push existing quest data onto freshly spawned indicators.
    if (this.questLogData.length > 0) this.updateNpcIndicators();
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

  /**
   * Compute and render quest indicators (! / ?) above NPCs.
   * "!" (yellow)  = available quest whose prereqs are met.
   * "?" (grey)    = active (in-progress) quest whose giver is this NPC.
   * "?" (blue)    = completed quest ready for turn-in.
   * Priority: turn-in > active > available.
   */
  private updateNpcIndicators(): void {
    // Build a lookup: npcId → { hasAvailable, hasActive, hasTurnin }
    const npcFlags = new Map<
      string,
      { hasAvailable: boolean; hasActive: boolean; hasTurnin: boolean }
    >();
    for (const qs of this.questLogData) {
      const def = QUESTS[qs.questId];
      if (!def) continue;
      const npcId = def.giverNpcId;
      let flags = npcFlags.get(npcId);
      if (!flags) {
        flags = { hasAvailable: false, hasActive: false, hasTurnin: false };
        npcFlags.set(npcId, flags);
      }
      if (qs.status === "complete") {
        flags.hasTurnin = true;
      } else if (qs.status === "active") {
        flags.hasActive = true;
      } else if (qs.status === "available") {
        // Check prereqs client-side so we only show "!" for truly available quests.
        const prereqMet =
          !def.prereqQuestId ||
          this.questLogData.some((q) => q.questId === def.prereqQuestId && q.status === "turnedIn");
        const levelMet = def.requiredLevel === undefined || this.localLevel >= def.requiredLevel;
        if (prereqMet && levelMet) flags.hasAvailable = true;
      }
    }

    for (const npc of this.npcsForMap) {
      const indicator = this.npcIndicators.get(npc.id);
      if (!indicator) continue;
      const flags = npcFlags.get(npc.id);
      if (!flags || (!flags.hasAvailable && !flags.hasActive && !flags.hasTurnin)) {
        // No quest indicator — fade out.
        if (indicator.alpha > 0) {
          this.tweens.killTweensOf(indicator);
          indicator.setData("bobbing", false);
          this.tweens.add({ targets: indicator, alpha: 0, duration: 200 });
        }
        continue;
      }
      // Priority: turn-in (blue ?) > active (grey ?) > available (yellow !)
      const isTurnin = flags.hasTurnin;
      const isActive = !isTurnin && flags.hasActive;
      indicator.setText(isTurnin ? "?" : isActive ? "?" : "!");
      indicator.setColor(isTurnin ? "#60a5fa" : isActive ? "#9ca3af" : "#facc15");
      // Gentle bobbing tween.
      if (!indicator.getData("bobbing")) {
        indicator.setData("bobbing", true);
        this.tweens.add({
          targets: indicator,
          y: indicator.y - 4,
          duration: 600,
          ease: "Sine.easeInOut",
          yoyo: true,
          repeat: -1,
        });
      }
      if (indicator.alpha < 1) {
        this.tweens.killTweensOf(indicator, "alpha");
        this.tweens.add({ targets: indicator, alpha: 1, duration: 200 });
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
  private async openMarket(): Promise<void> {
    if (this.scene.isActive("market")) return;
    await loadScene(this.game, "market", () => import("./Market"));
    this.scene.launch("market");
    this.scene.pause();
  }

  /** Launch the Cash Shop overlay and pause Meadowfield until it closes. */
  private async openCashShop(): Promise<void> {
    if (this.scene.isActive("cashshop")) return;
    await loadScene(this.game, "cashshop", () => import("./CashShop"));
    this.scene.launch("cashshop");
    this.scene.pause();
  }

  private async openGeneralStore(shopId: string): Promise<void> {
    if (this.scene.isActive("generalstore")) return;
    await loadScene(this.game, "generalstore", () => import("./GeneralStore"));
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
    // Don't override attack animation while it's still playing.
    const attackUntil = sprite.getData("attackAnimUntil") as number | undefined;
    if (attackUntil !== undefined && this.time.now < attackUntil) return;

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
    // ── Boss-kill payoff: dramatic fanfare + screen-wide effects ──
    const mobId = sprite.getData("mobId") as string | undefined;
    if (mobId && getMobDef(mobId)?.isBoss) {
      this.playBossKillPayoff(sprite.x, sprite.y);
    }
  }

  /** Reset a reused mob entry to a fresh, fully-visible state when the server respawns it. */
  private restoreMob(sprite: Phaser.GameObjects.Sprite): void {
    this.tweens.killTweensOf(sprite);
    sprite.clearTint();
    sprite.setAlpha(1);
    sprite.setVisible(true);
    // Re-apply zone tint + scale (or elite override if applicable).
    const isElite = sprite.getData("isElite") === true;
    const mobId = sprite.getData("mobId") as string | undefined;
    if (isElite) {
      sprite.setTint(0xffd700);
      sprite.setScale(1.2);
    } else if (mobId) {
      const biome = resolveBiomeSet(this.mapId, this.map.bgSet);
      const element = getMobDef(mobId)?.element as import("@maple/shared").Element | undefined;
      sprite.setTint(mobTint(mobId, biome, element));
      sprite.setScale(mobScale(mobId));
    } else {
      sprite.setScale(1);
    }
    // Restart the mob's idle animation so it doesn't sit frozen on a dead frame.
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
      // Weak (extra effective) — golden highlight + text label
      text = `WEAK! ${payload.damage}`;
      color = payload.crit ? "#fbbf24" : "#f59e0b";
      fontSize = payload.crit ? "20px" : "16px";
      isCrit = payload.crit;
    } else if (elemMul < 1) {
      // Resist — dim blue tint + text label
      text = `RESIST ${payload.damage}`;
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

  // ─── Legendary drop screen flourish ──────────────────────────────────────────────
  /** Screen-wide green flash + floating label when a Legendary drops. */
  private playLegendaryDropFlourish(x: number, y: number): void {
    const { width, height } = this.scale;

    // Green screen flash.
    const flash = this.add
      .rectangle(width / 2, height / 2, width, height, 0x50e890, 0.3)
      .setDepth(9998)
      .setScrollFactor(0);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 400,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    // Radial burst of green sparkles around the drop.
    const SPARKLE_COUNT = 10;
    for (let i = 0; i < SPARKLE_COUNT; i++) {
      const angle = (i / SPARKLE_COUNT) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 30 + Math.random() * 40;
      const dot = this.add.circle(x, y, 1.5 + Math.random() * 1.5, 0x50e890, 0.9).setDepth(9999);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist - 10,
        alpha: 0,
        duration: 350 + Math.random() * 150,
        ease: "Quad.easeOut",
        onComplete: () => dot.destroy(),
      });
    }

    // "★ LEGENDARY!" floating label above the drop.
    this.floatText(x, y - 30, "★ LEGENDARY!", "#50e890");
  }

  // ─── Quest-complete flourish ──────────────────────────────────────────────────────
  /** Golden burst + sparkle ring at the player when a quest is turned in. */
  private playQuestCompleteFlourish(x: number, y: number): void {
    const cy = y - 20;

    // Expanding golden ring.
    const ring = this.add.circle(x, cy, 6, 0xfacc15, 0).setDepth(9999);
    ring.setStrokeStyle(2, 0xfacc15, 0.85);
    this.tweens.add({
      targets: ring,
      scaleX: 6,
      scaleY: 6,
      alpha: 0,
      duration: 450,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    // Particle burst.
    const COUNT = 10;
    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 30 + Math.random() * 35;
      const dot = this.add.circle(x, cy, 1.5 + Math.random() * 1.5, 0xfacc15, 0.9).setDepth(9999);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist - 12,
        alpha: 0,
        duration: 320 + Math.random() * 180,
        ease: "Quad.easeOut",
        onComplete: () => dot.destroy(),
      });
    }

    // Brief white flash at the player.
    const flash = this.add.circle(x, cy, 10, 0xffffff, 0.3).setDepth(9998);
    this.tweens.add({
      targets: flash,
      scaleX: 4,
      scaleY: 4,
      alpha: 0,
      duration: 280,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    // Floating label.
    this.floatText(x, cy - 30, "✨ Quest Complete!", "#facc15");
  }

  // ─── Boss-kill payoff ─────────────────────────────────────────────────────────────
  /** Dramatic screen-wide fanfare when a boss is defeated. */
  private playBossKillPayoff(x: number, y: number): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2 - 40;

    // Play the advancement fanfare as the boss-kill payoff.
    getAudioManager().playSfx("advancement");

    // Big golden screen flash.
    const screenFlash = this.add
      .rectangle(cx, cy, width, height, 0xffd700, 0.3)
      .setDepth(9998)
      .setScrollFactor(0);
    this.tweens.add({
      targets: screenFlash,
      alpha: 0,
      duration: 500,
      ease: "Quad.easeOut",
      onComplete: () => screenFlash.destroy(),
    });

    // Expanding golden ring at the boss position.
    const ring = this.add.circle(x, y - 20, 8, 0xffd700, 0).setDepth(9999);
    ring.setStrokeStyle(4, 0xffd700, 0.95);
    this.tweens.add({
      targets: ring,
      scaleX: 10,
      scaleY: 10,
      alpha: 0,
      duration: 600,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    // Radial particle burst — more particles, wider spread.
    const PARTICLE_COUNT = 18;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 50 + Math.random() * 60;
      const isGold = i % 3 !== 0;
      const color = isGold ? 0xffd700 : 0xffffff;
      const dot = this.add.circle(x, y - 20, 2 + Math.random() * 2.5, color, 0.9).setDepth(9999);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * dist,
        y: y - 20 + Math.sin(angle) * dist - 20,
        alpha: 0,
        duration: 450 + Math.random() * 250,
        ease: "Quad.easeOut",
        onComplete: () => dot.destroy(),
      });
    }

    // Camera shake for impact.
    this.shakeCamera(0.9, 350);

    // "BOSS DEFEATED!" floating label.
    this.floatText(cx, cy - 20, "💀 BOSS DEFEATED!", "#ffd700");
  }

  // ─── Portal rendering + interaction ──────────────────────────────────────────────
  /** Interaction range (px) for portal prompts — matches PORTAL_RANGE in server MapRoom.ts. */
  private static readonly PORTAL_RANGE = 80;

  /** Spawn glowing portal markers at every portal position on the current map. */
  private spawnPortals(): void {
    for (const portal of this.map.portals) {
      const isComingSoon = portal.comingSoon === true;
      const glowColor = isComingSoon ? 0xf59e0b : 0x6ec6ff;
      const labelColor = isComingSoon ? "#f59e0b" : "#6ec6ff";

      // Glowing orb marker.
      const glow = this.add.circle(portal.x, portal.y, 12, glowColor, 0.5);
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
          color: labelColor,
          stroke: "#1a1a2e",
          strokeThickness: 3,
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(portal.y + 1000);

      // Interaction prompt — hidden until player is in range.
      const prompt = this.add
        .text(portal.x, portal.y - 42, isComingSoon ? "🚧 Coming Soon" : "[\u2191 ENTER]", {
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: "10px",
          color: isComingSoon ? "#f59e0b" : "#aeb9c7",
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

  /**
   * Classify a failed connect attempt into a distinct, user-actionable kind so the error
   * screen can say something concrete (server down vs. version mismatch vs. full vs. banned)
   * rather than a generic "Could not connect".
   *
   * Colyseus surfaces matchmaking failures as a `MatchMakeError`/`ServerError` carrying a
   * numeric `code`: the HTTP-ish ErrorCode range (520–526) for matchmaking, or a raw network
   * error code (e.g. "ECONNREFUSED") when the server is unreachable. We also fold in our own
   * ConnectTimeoutError and any banned-account hint already received over the socket.
   */
  private classifyConnectError(err: unknown): ConnectErrorInfo {
    const serverName = this.map?.name ?? "the server";

    // An auth-layer ban (server-issued 403 with the reason) surfaces as a BannedError.
    if (err instanceof BannedError) {
      return { kind: "banned", title: "Account banned", message: err.reason };
    }

    if (err instanceof ConnectTimeoutError) {
      return {
        kind: "timeout",
        title: "Connection timed out",
        message: `${serverName} didn't respond in time. Your connection may be slow, or the server may be busy. Check your network and try again.`,
      };
    }

    // A ban can also be delivered as an announcement right before the socket closes
    // during the join handshake — prefer that explicit reason if it's fresh.
    const ban = this.recentBanAnnouncement();
    if (ban) {
      return { kind: "banned", title: "Account banned", message: ban };
    }

    const code = (err as { code?: number | string } | null)?.code;
    const rawMessage =
      typeof (err as { message?: unknown } | null)?.message === "string"
        ? ((err as { message: string }).message ?? "")
        : "";
    const lower = rawMessage.toLowerCase();

    // Network-level failure (server down / DNS / refused / offline). Colyseus forwards the
    // underlying Node/browser error code as a string like "ECONNREFUSED".
    const networkCodes = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"]);
    const looksOffline =
      (typeof code === "string" && networkCodes.has(code)) ||
      code === 1006 || // ABNORMAL_CLOSURE
      lower.includes("failed to fetch") ||
      lower.includes("networkerror") ||
      lower.includes("network error") ||
      lower.includes("econnrefused") ||
      lower.includes("all endpoints failed");
    if (looksOffline) {
      return {
        kind: "offline",
        title: "Can't reach the server",
        message: `${serverName} isn't responding. It may be down or restarting. Please wait a moment and retry.`,
      };
    }

    // Room full — server rejects matchmaking when the room is at capacity.
    if (lower.includes("locked") || lower.includes("full") || lower.includes("is full")) {
      return {
        kind: "full",
        title: "Server is full",
        message: `${serverName} is at capacity right now. Try a different channel, or retry in a moment.`,
      };
    }

    // Version / protocol mismatch — the client build is out of date for this server. The server's
    // onAuth rejects a stale client with PROTOCOL_MISMATCH_CODE; we also fold in the generic
    // "version"/"protocol"/no-handler hints as a belt-and-braces fallback.
    if (
      code === PROTOCOL_MISMATCH_CODE ||
      lower.includes("version") ||
      lower.includes("protocol") ||
      lower.includes("please refresh") ||
      lower.includes("no handler") ||
      code === 520 // MATCHMAKE_NO_HANDLER
    ) {
      return {
        kind: "version",
        title: "Update required",
        message:
          "This game client is out of date and can't connect. Refresh the page to load the latest version.",
      };
    }

    if (lower.includes("ban")) {
      return {
        kind: "banned",
        title: "Account banned",
        message: rawMessage || "Your account has been banned.",
      };
    }

    return {
      kind: "unknown",
      title: "Connection failed",
      message: `Couldn't connect to ${serverName}${rawMessage ? ` (${rawMessage})` : ""}. Please try again.`,
    };
  }

  /**
   * Render the friendly, retryable connect-error screen. Distinct from the old generic
   * dead-end: it shows a classified title + actionable message and a real Retry button
   * (version-mismatch retries by reloading the page; everything else re-runs the connect).
   */
  private showConnectionError(info: ConnectErrorInfo, onRetry?: () => void): void {
    this.lastConnectError = info;
    this.lastConnectRetry = onRetry;
    this.clearConnectionError();

    const w = this.scale.width;
    const h = this.scale.height;
    const panelW = Math.min(440, w - 48);
    const panelH = 240;

    const backdrop = this.add.rectangle(0, 0, w, h, 0x05070d, 0.78).setOrigin(0);
    backdrop.setInteractive(); // swallow clicks so the world behind isn't pokeable
    const panel = this.add.rectangle(w / 2, h / 2, panelW, panelH, 0x131a2b, 0.97).setOrigin(0.5);
    panel.setStrokeStyle(1, 0x3b4a66, 1);

    // Icon hint per kind (kept as a glyph so we don't need new texture assets).
    const glyph =
      info.kind === "banned"
        ? "⛔"
        : info.kind === "full"
          ? "⏳"
          : info.kind === "version"
            ? "⬆"
            : info.kind === "timeout"
              ? "⏱"
              : "⚠";
    const icon = this.add
      .text(w / 2, h / 2 - panelH / 2 + 34, glyph, { fontFamily: CONN_FONT, fontSize: "28px" })
      .setOrigin(0.5);

    const title = this.add
      .text(w / 2, h / 2 - panelH / 2 + 74, info.title, {
        fontFamily: CONN_FONT,
        fontSize: "19px",
        color: "#f6c177",
        align: "center",
      })
      .setOrigin(0.5);

    const body = this.add
      .text(w / 2, h / 2 - 4, info.message, {
        fontFamily: CONN_FONT,
        fontSize: "13px",
        color: "#cbd5e9",
        align: "center",
        wordWrap: { width: panelW - 48 },
        lineSpacing: 4,
      })
      .setOrigin(0.5);

    // ── Retry button ──
    const btnLabel = info.kind === "version" ? "Reload" : "Retry";
    const btnY = h / 2 + panelH / 2 - 36;
    const btnW = 150;
    const btnH = 38;
    const btnBg = this.add.rectangle(w / 2, btnY, btnW, btnH, 0x2f6f4f, 1).setOrigin(0.5);
    btnBg.setStrokeStyle(1, 0x4ade80, 1);
    btnBg.setInteractive({ useHandCursor: true });
    const btnText = this.add
      .text(w / 2, btnY, btnLabel, {
        fontFamily: CONN_FONT,
        fontSize: "15px",
        color: "#eafff2",
      })
      .setOrigin(0.5);

    btnBg.on("pointerover", () => btnBg.setFillStyle(0x3a8a62, 1));
    btnBg.on("pointerout", () => btnBg.setFillStyle(0x2f6f4f, 1));
    btnBg.on("pointerdown", () => btnBg.setFillStyle(0x255a40, 1));
    btnBg.on("pointerup", () => {
      if (info.kind === "version") {
        // A stale client can't recover by re-joining — reload to fetch the new build.
        window.location.reload();
        return;
      }
      if (onRetry) {
        onRetry();
        return;
      }
      void this.attemptConnect();
    });

    const overlay = this.add.container(0, 0, [backdrop, panel, icon, title, body, btnBg, btnText]);
    overlay.setScrollFactor(0).setDepth(21_000);
    this.connectErrorOverlay = overlay;
  }

  /** Tear down the connect-error overlay (if any) — called before a retry and on success. */
  private clearConnectionError(): void {
    this.connectErrorOverlay?.destroy(true);
    this.connectErrorOverlay = undefined;
  }

  // ─── HUD connection-status indicator ───────────────────────────────────────────────────
  /**
   * Update the connection-status indicator (a small dot+label pill, top-right). It stays
   * visible while anything is wrong (connecting / reconnecting / offline) and auto-hides a
   * couple of seconds after going green so a healthy HUD stays clean.
   */
  private setConnStatus(status: ConnStatus): void {
    this.registry.set("connStatus", status); // exposed for the React HUD / tests
    this.ensureConnStatusPill();

    const palette: Record<ConnStatus, { color: number; label: string }> = {
      connecting: { color: 0xf6c177, label: "Connecting…" },
      online: { color: 0x4ade80, label: "Online" },
      reconnecting: { color: 0xf6c177, label: "Reconnecting…" },
      offline: { color: 0xef4444, label: "Offline" },
    };
    const { color, label } = palette[status];
    this.connStatusDot?.setFillStyle(color, 1);
    this.connStatusText?.setText(label).setColor(`#${color.toString(16).padStart(6, "0")}`);
    this.connStatusContainer?.setVisible(true);

    this.connStatusHideEvent?.remove();
    this.connStatusHideEvent = undefined;
    if (status === "online") {
      // Fade the pill out shortly after a healthy connection settles.
      this.connStatusHideEvent = this.time.addEvent({
        delay: 2500,
        callback: () => this.connStatusContainer?.setVisible(false),
      });
    }
  }

  /** Build the status pill once (top-right, screen-fixed), reused across status changes. */
  private ensureConnStatusPill(): void {
    if (this.connStatusContainer) return;
    const pillW = 132;
    const pillH = 22;
    const x = this.scale.width - pillW / 2 - 12;
    const y = 16;
    const bg = this.add.rectangle(0, 0, pillW, pillH, 0x0c1019, 0.82).setOrigin(0.5);
    bg.setStrokeStyle(1, 0x3b4a66, 1);
    const dot = this.add.circle(-pillW / 2 + 14, 0, 5, 0xf6c177, 1);
    const text = this.add
      .text(-pillW / 2 + 26, 0, "Connecting…", {
        fontFamily: CONN_FONT,
        fontSize: "11px",
        color: "#f6c177",
      })
      .setOrigin(0, 0.5);
    const container = this.add.container(x, y, [bg, dot, text]);
    container.setScrollFactor(0).setDepth(20_500);
    this.connStatusContainer = container;
    this.connStatusDot = dot;
    this.connStatusText = text;
  }

  /** Re-position/re-flow the screen-fixed connection overlays after a canvas resize. */
  private reflowConnectionUi(): void {
    const w = this.scale.width;
    // Re-anchor the status pill to the top-right.
    if (this.connStatusContainer) {
      this.connStatusContainer.setPosition(w - 132 / 2 - 12, 16);
    }
    // Rebuild the error panel centered at the new size (cheap; only up during an error).
    if (this.connectErrorOverlay && this.lastConnectError) {
      this.showConnectionError(this.lastConnectError, this.lastConnectRetry);
    }
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
