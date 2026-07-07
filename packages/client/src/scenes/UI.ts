import Phaser from "phaser";
import { getStateCallbacks, type Room } from "@colyseus/sdk";
import {
  getItemDef,
  getConsumableDef,
  getPotentialTierInfo,
  getBaseRankInfo,
  resolveEquippedBonus,
  computeSetBonuses,
  passiveEffectBonus,
  buffEffectToSecondary,
  deriveSecondary,
  MEADOWFIELD,
  EquipSlot,
  ClassArchetype,
  isAmmoItem,
  getAmmoDef,
  getClass,
  allSkillsForClass,
  skillStatAt,
  potentialOdds,
  POTENTIAL_TIERS,
  UPGRADE_BASE_RATE,
  upgradeCost,
  upgradeMaterialCost,
  CUBE_REROLL_COST,
  nextBaseRank,
  UPGRADE_SHARD_DEF_ID,
  UPGRADE_SHARD_NAME,
  MAPS,
  getMap,
  getNpcsForMap,
  tabForItem,
  travelFee,
  CODEX_ENTRIES,
  MOBS,
  QUESTS,
  type PotentialTier,
  type BaseRank,
  type PotentialLine,
  type GameMap,
  type InventoryTab,
  type SecondaryStats,
  type Portal,
} from "@maple/shared";

import type {
  TownStateView,
  PlayerView,
  InventoryItemView,
  PartyMemberView,
  GuildUpdateView,
  FriendEntryView,
} from "../state-views";
import { uiStore, type InvItemSnapshot, type HudSkillSlot, type ChatChannel } from "../ui/store";
import { getLastLogLines } from "../logBuffer";
import { VERSION_LABEL } from "../version";
import type { QuickSlotEntry } from "../backend";
import { getQuickslots, setQuickslots } from "../backend";
import { getCharId } from "../backend";
import { keybindings } from "../keybindings";
import { isTextInputFocused, subscribeInputFocus } from "../ui/inputFocus";
import type { ActionId } from "@maple/shared";
import { getAudioManager } from "../audio/AudioManager";
import { loadScene } from "./lazyScene";
import {
  MessageType,
  expForLevel,
  type ChatMessage,
  type QuestUpdatePayload,
  type StatusEffectsPayload,
  type StatusEffectInfo,
  type LevelUpPayload,
  type CubeRerollResultPayload,
  type UpgradeItemResultPayload,
  type PartyUpdatePayload,
  type PartyInviteReceivedPayload,
  type FriendListPayload,
  type FriendResultPayload,
  type FriendRemovedPayload,
  type OnlineStatusPayload,
  type FeedbackResultPayload,
  type FeedbackCategory,
  type ServerAnnouncementPayload,
  type PlayerReportResultPayload,
  type ModActionResultPayload,
  type BlockedListResultPayload,
  type ChatScope,
  type PartyChatRelayPayload,
  type FamiliarSyncPayload,
  type FamiliarCardDropPayload,
  FAMILIAR_MAX_SUMMONED,
  FAMILIAR_ENABLED,
} from "@maple/shared";

/**
 * UIScene — the parallel HUD overlay rendered on top of {@link MeadowfieldScene}.
 *
 * Launched via `this.scene.launch("ui")` so it runs *alongside* the gameplay scene rather than
 * replacing it. Because this is its own scene, its camera never scrolls — every GameObject here is
 * effectively screen-fixed without needing `setScrollFactor(0)`.
 *
 * It reuses the SAME Colyseus connection as Meadowfield: that scene publishes the joined room on the
 * shared scene registry under "room" (see `this.registry.set("room", room)`). We may boot a frame or
 * two before the socket connects, so we poll the registry until the handle appears, then bind.
 *
 * Everything on screen is REACTIVE: we attach schema callbacks (the verified 0.17 SDK API via
 * `getStateCallbacks`) to the LOCAL player and its inventory, and only ever redraw in response to an
 * authoritative state patch — never by polling field values per frame.
 */

// ─── Registry / curve constants (mirror MeadowfieldScene + TownRoom — keep in sync) ──────────────
/** Registry key MeadowfieldScene publishes the live room under. */
const ROOM_REGISTRY_KEY = "room";
/** How often (ms) we re-check the registry for the room handle before it's connected. */
const ROOM_POLL_MS = 80;
/** Registry flag MeadowfieldScene reads to suppress game keys while typing. */
const CHAT_FOCUSED_KEY = "chatFocused";

// ─── Visual design tokens ────────────────────────────────────────────────────────────────────────
const FONT = "ui-monospace, Menlo, monospace";

/** Fill/stroke colors as hex ints for Graphics. */
const PALETTE = {
  panelFill: 0x131a27,
  panelStroke: 0x2a3852,
  barTrack: 0x0c1019,
  hp: 0xef4444, // red
  mp: 0x3b82f6, // blue (also the RARE rarity blue — intentionally cohesive)
  exp: 0x9ad06b, // the game's signature level-up green
  coinBody: 0xfacc15,
  coinRim: 0xb7791f,
  coinShine: 0xfff3c4,
} as const;

/** Text colors as CSS strings for Text styles. */
const TEXT = {
  name: "#f8fafc",
  level: "#9ad06b",
  bright: "#e5e7eb",
  dim: "#94a3b8",
  mesos: "#ffe08a",
  hint: "#aeb9c7",
  stroke: "#0a0e16",
} as const;

// ─── Bottom-bar geometry (retained only for legacy party-HUD anchoring) ───────────────────────────
const BOTTOM_BAR_H = 54;
const BOTTOM_BAR_MARGIN = 10;

// ─── Quick-slot hotbar ────────────────────────────────────────────────────────────────────────────
// The hotbar is rendered by the React HUD (src/ui/hud/SkillBar.tsx). These geometry
// constants size the *invisible* Phaser hit-zones used as drop targets for the
// skill-tree drag-to-assign, kept in sync with the React bar's slot layout
// (size-10 = 40px, gap-1 = 4px, p-1.5 = 6px, bottom-3/right-3 = 12px margin).
const QS_SIZE = 40;
const QS_GAP = 4;
const QS_PAD = 6;
const QS_MARGIN = 12;
const QS_COUNT = 10;
const QS_BINDINGS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const QS_SECTION_W = QS_COUNT * QS_SIZE + (QS_COUNT - 1) * QS_GAP;

// ─── Mesos counter (top-right) ──────────────────────────────────────────────────────────────────
const MESOS_Y = 28;

// ─── Minimap geometry (top-left) ────────────────────────────────────────────────────────────────
const MINIMAP_Y = 12;
const MINIMAP_H = 100;

/** Display order for equipment slots (classic MapleStory paper-doll layout). */
const EQUIP_SLOT_ORDER: EquipSlot[] = [
  EquipSlot.WEAPON,
  EquipSlot.HAT,
  EquipSlot.FACE_ACCESSORY,
  EquipSlot.EYE_ACCESSORY,
  EquipSlot.EARRING,
  EquipSlot.PENDANT,
  EquipSlot.TOP,
  EquipSlot.OVERALL,
  EquipSlot.CAPE,
  EquipSlot.SHIELD,
  EquipSlot.BOTTOM,
  EquipSlot.GLOVES,
  EquipSlot.BELT,
  EquipSlot.RING,
  EquipSlot.RING_2,
  EquipSlot.RING_3,
  EquipSlot.RING_4,
  EquipSlot.SHOES,
  EquipSlot.SHOULDER,
  EquipSlot.MEDAL,
  EquipSlot.BADGE,
  EquipSlot.POCKET,
];

// ─── Inventory layout anchor ─────────────────────────────────────────────────────────────────
// The inventory itself is rendered by the React overlay (`ui/InventoryPanel.tsx`). The tab list
// is the source of truth for the per-tab buckets published to the overlay.
const INV_TAB_LABELS: InventoryTab[] = ["EQUIP", "USE", "ETC", "CASH"];

// ─── Chat geometry (retained only for legacy party-HUD anchoring) ─────────────────────────────────
const CHAT_MSG_H = 16;
const CHAT_MAX_MSGS = 8;
const CHAT_PANEL_PAD = 6;
const CHAT_INPUT_H = 24;
const CHAT_BOTTOM_MARGIN = 14;

// ─── Cube (potential reroll) panel geometry (centred overlay) ────────────────
const CUBE_PANEL_W = 380;
const CUBE_PANEL_PAD = 16;
const CUBE_PANEL_HEADER_H = 34;
const CUBE_ODDS_BAR_MAX = 140;

// ─── Upgrade (base-rank) panel geometry (centred overlay) ───────────────────
const UPGRADE_PANEL_W = 380;
const UPGRADE_PANEL_PAD = 16;
const UPGRADE_PANEL_HEADER_H = 34;

// ─── Feedback / Bug Report panel geometry (centred overlay) ────────────────
const FEEDBACK_PANEL_W = 420;
const FEEDBACK_PANEL_H = 340;
const FEEDBACK_PANEL_PAD = 16;
const FEEDBACK_PANEL_HEADER_H = 34;
const FEEDBACK_CATEGORY_BTN_W = 100;
const FEEDBACK_CATEGORY_BTN_H = 28;
const FEEDBACK_TEXTAREA_H = 120;
const FEEDBACK_SUBMIT_BTN_W = 140;
const FEEDBACK_SUBMIT_BTN_H = 32;

// ─── Guide (Maple Guide) panel geometry (toggled with J) ──────────────────────
const GUIDE_PANEL_W = 360;
const GUIDE_PANEL_PAD = 16;
const GUIDE_PANEL_HEADER_H = 34;
const GUIDE_STEP_H = 22;
const GUIDE_DESC_WRAP = GUIDE_PANEL_W - GUIDE_PANEL_PAD * 2 - 8;
const GUIDE_BTN_W = 140;
const GUIDE_BTN_H = 26;

/** Registry keys shared with MeadowfieldScene. */
const DIALOG_STATE_KEY = "dialogState";
const DIALOG_OPEN_KEY = "dialogOpen";
const QUEST_NOTIFY_KEY = "questNotify";

export class UIScene extends Phaser.Scene {
  /** The LOCAL player's synced view. Undefined until it appears in `room.state.players`. */
  private localPlayer?: PlayerView;
  /** Guards against binding the local player's callbacks more than once. */
  private localBound = false;
  /** Polls the registry for the room handle before the socket has connected. */
  private roomPoll?: Phaser.Time.TimerEvent;
  /** Schema-callback detach fns, invoked on shutdown so we never leak listeners onto the room. */
  private readonly unsubscribers: (() => void)[] = [];

  // Quickslot hotbar state. The bar is rendered by the React HUD
  // (src/ui/hud/SkillBar.tsx); Phaser keeps the layout data + cooldown clocks and
  // an invisible hit-zone container as the skill-tree drag-to-assign drop target.
  private quickslots: (QuickSlotEntry | null)[] = [];
  private readonly qsCooldownEndAt = new Map<number, number>(); // slotIndex → scene time when cooldown expires
  private qsContainer!: Phaser.GameObjects.Container;

  // Top-right mesos counter (still Phaser-drawn).
  private mesosBg!: Phaser.GameObjects.Graphics;
  private coin!: Phaser.GameObjects.Image;
  private mesosText!: Phaser.GameObjects.Text;

  // Minimap is rendered by the React HUD (src/ui/hud/Minimap.tsx); Phaser only
  // tracks the current map id for snapshot resolution.
  private currentMapId = "dawn_isle";
  private discoveredMaps = new Set<string>();

  // World map is now a React overlay — no Phaser objects needed.

  // Inventory panel (tabbed). Rendering now lives in the React overlay; this
  // flag is kept in sync with the bridge store.
  private inventoryOpen = false;
  private uiActionsRegistered = false;
  // Client-side per-tab ordering (uid lists), persisted to localStorage. The React overlay reads
  // the resulting order via the published snapshot; drag-reorder writes back through it.
  private invClientOrder: Record<string, string[]> = { EQUIP: [], USE: [], ETC: [], CASH: [] };

  // Bottom hint line.
  private hintText!: Phaser.GameObjects.Text;

  // Chat — rendered by the React overlay (src/ui/hud/ChatBox.tsx). Phaser keeps
  // the scrollback buffer (source of truth, published to the store), the live
  // room handle for sending, and the focus flag that gates game keybinds.
  private chatFocused = false;
  private chatRoom?: Room<unknown, TownStateView>;
  /** Monotonic id for each chat line (stable React keys across buffer shifts). */
  private chatMsgSeq = 0;
  private readonly chatMsgBuffer: {
    id: number;
    name: string;
    text: string;
    scope: ChatScope | "system";
  }[] = [];

  // ── Combo counter HUD ──
  private comboContainer!: Phaser.GameObjects.Container;
  private comboBg!: Phaser.GameObjects.Graphics;
  private comboText!: Phaser.GameObjects.Text;
  private comboLabel!: Phaser.GameObjects.Text;

  // ── Combat QoL: Auto-Pot ──
  private autoPotConfig = {
    hpEnabled: false,
    hpThreshold: 50,
    mpEnabled: false,
    mpThreshold: 50,
    hpPotionId: "pot.large_hp",
    mpPotionId: "pot.large_mp",
  };
  private lastAutoPotHpAt = 0;
  private lastAutoPotMpAt = 0;
  private readonly AUTO_POT_COOLDOWN_MS = 800;

  // ── Combat QoL: Skill Macros ──
  private macros: {
    id: string;
    name: string;
    steps: { type: "skill" | "consumable"; id: string }[];
  }[] = [];

  // Quest log panel, quest offer + turn-in panels, and the NPC dialog box are
  // now React overlays (src/ui/QuestLogPanel.tsx, QuestOfferPanel.tsx,
  // DialogPanel.tsx). UIScene only publishes plain snapshots into the bridge
  // store and registers the room.send action handlers. The always-on quest
  // tracker is a separate HUD widget (src/ui/hud/QuestTracker.tsx).

  // Quest data from server (source of truth for the tracker HUD + quest log snapshot).
  private questData: QuestUpdatePayload = { quests: [] };

  // Guide panel (toggled with J).
  private guidePanelOpen = false;
  private guidePanelContainer!: Phaser.GameObjects.Container;
  private guidePanelBg!: Phaser.GameObjects.Graphics;
  private readonly guidePanelElements: Phaser.GameObjects.GameObject[] = [];
  private guideData: import("@maple/shared").GuidanceSyncPayload | null = null;

  // Bonus hunting map data from server.
  private bonusHuntData: import("@maple/shared").BonusHuntSyncPayload | null = null;

  // Character-progression panels (Stat S / Equipment E / Skill tree K) now live in
  // the React overlay (src/ui/StatsPanel.tsx, EquipmentPanel.tsx, SkillTreePanel.tsx).
  // UIScene keeps the open-state mirrors + the local skill book and publishes plain
  // snapshots into the bridge store via publishCharacter()/publishEquipment().
  private statPanelOpen = false;
  private equipPanelOpen = false;
  private skillTreeOpen = false;
  private localSkillBook: Record<string, number> = {};

  // Status effect icons (rendered by src/ui/StatusEffects.tsx). UIScene owns the
  // authoritative list (synced + ticked) and republishes on change.
  private readonly statusEffects: StatusEffectInfo[] = [];
  private effectUpdateTimer = 0;

  // Level-up celebration overlay (burst ring + particles). The EXP-bar fill it
  // used to drive now lives in the React HUD (src/ui/hud/StatusBars.tsx).
  private levelUpOverlay!: Phaser.GameObjects.Container;
  private levelUpText!: Phaser.GameObjects.Text;

  // Cube (potential reroll) panel.
  private cubePanelOpen = false;
  private cubePanelContainer!: Phaser.GameObjects.Container;
  private cubePanelBg!: Phaser.GameObjects.Graphics;
  private cubeSelectedItemUid: string | null = null;
  private cubeLastResult: CubeRerollResultPayload | null = null;
  private readonly cubePanelElements: Phaser.GameObjects.GameObject[] = [];

  // Upgrade (base-rank) panel.
  private upgradePanelOpen = false;
  private upgradePanelContainer!: Phaser.GameObjects.Container;
  private upgradePanelBg!: Phaser.GameObjects.Graphics;
  private upgradeSelectedItemUid: string | null = null;
  private readonly upgradePanelElements: Phaser.GameObjects.GameObject[] = [];

  // Party HUD (always-on corner mini-bars, left side above chat). The party
  // *panel* (toggled with O) lives in React — see src/ui/PartyPanel.tsx.
  private partyHudContainer!: Phaser.GameObjects.Container;
  private partyHudBg!: Phaser.GameObjects.Graphics;
  private partyHudHeader!: Phaser.GameObjects.Text;
  private readonly partyHudElements: Phaser.GameObjects.GameObject[] = [];
  private partyMembers: PartyMemberView[] = [];
  private partyLootRule: "ffa" | "roundRobin" | "leader" = "ffa";
  /** Pending party invite, mirrored into the React store as `party.invite`. */
  private pendingPartyInvite: { fromCharId: string; fromName: string } | null = null;

  // Guild snapshot (panel lives in React — see src/ui/GuildPanel.tsx). We retain
  // the latest server data here so re-opening the panel republishes it.
  private guildData: GuildUpdateView = {
    guildId: "",
    guildName: "",
    emblem: { color: 0, label: "" },
    members: [],
    createdDate: 0,
  };

  // Friends list snapshot (panel lives in React — see src/ui/FriendsPanel.tsx).
  private friendsData: FriendEntryView[] = [];

  // Open-state mirrors for the React social overlays (party O / guild G / friends F).
  private partyPanelOpen = false;
  private guildPanelOpen = false;
  private friendsPanelOpen = false;

  // Quest offer + turn-in panels are React overlays (src/ui/QuestOfferPanel.tsx);
  // UIScene publishes their snapshots into the bridge store.

  // Feedback / Bug Report panel (toggled with B).
  private feedbackOpen = false;
  private feedbackContainer!: Phaser.GameObjects.Container;
  private feedbackBg!: Phaser.GameObjects.Graphics;
  private feedbackSelectedCategory: FeedbackCategory = "bug";
  private feedbackInputText = "";
  private feedbackInputFocused = false;
  private feedbackInput!: Phaser.GameObjects.Text;
  private feedbackCategoryBtns: Phaser.GameObjects.Container[] = [];
  private feedbackCategoryHighlights: Phaser.GameObjects.Graphics[] = [];
  private feedbackStatusText!: Phaser.GameObjects.Text;
  private feedbackPending = false;
  private _feedbackKeyHandler!: (event: KeyboardEvent) => void;
  private _feedbackEventHandler!: () => void;

  // Player context menu (right-click on player sprite).
  private contextMenuContainer!: Phaser.GameObjects.Container;
  private contextMenuBg!: Phaser.GameObjects.Graphics;
  private readonly contextMenuElements: Phaser.GameObjects.GameObject[] = [];

  // NPC context menu (right-click on NPC sprite).
  private npcContextMenuContainer!: Phaser.GameObjects.Container;
  private npcContextMenuBg!: Phaser.GameObjects.Graphics;
  private readonly npcContextMenuElements: Phaser.GameObjects.GameObject[] = [];

  // Player stats tooltip (shown from context menu "View Stats").
  private statsTooltipContainer!: Phaser.GameObjects.Container;
  private statsTooltipBg!: Phaser.GameObjects.Graphics;
  private readonly statsTooltipElements: Phaser.GameObjects.GameObject[] = [];

  // Blocked list panel (toggled with Shift+B).
  private blockedOpen = false;
  private blockedContainer!: Phaser.GameObjects.Container;
  private blockedBg!: Phaser.GameObjects.Graphics;
  private readonly blockedElements: Phaser.GameObjects.GameObject[] = [];
  private blockedNames: string[] = [];

  // Report dialog (shown from context menu). Rendered by src/ui/ReportDialog.tsx;
  // UIScene mirrors the open flag + target name into the bridge store.
  private reportOpen = false;
  private reportTargetName = "";

  // Familiar collection/summon panel (toggled with V).
  private familiarPanelOpen = false;
  private familiarPanelContainer!: Phaser.GameObjects.Container;
  private familiarPanelBg!: Phaser.GameObjects.Graphics;
  private readonly familiarPanelElements: Phaser.GameObjects.GameObject[] = [];
  private familiarRegistered: string[] = [];
  private familiarSummoned: string[] = [];

  // Server announcement banner (auto-scrolling).
  private announcementContainer!: Phaser.GameObjects.Container;
  private announcementBg!: Phaser.GameObjects.Graphics;
  private announcementText!: Phaser.GameObjects.Text;

  // Codex / Exploration panel (toggled with C).
  private codexPanelOpen = false;
  private codexPanelContainer!: Phaser.GameObjects.Container;
  private codexPanelBg!: Phaser.GameObjects.Graphics;
  private readonly codexPanelElements: Phaser.GameObjects.GameObject[] = [];
  private codexData: Record<string, number> = {};
  private codexStatBonus = { STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0, MP: 0 };
  private codexExpBonus = 0;
  private explorationSlots: {
    slotIndex: number;
    mobId: string;
    startAt: number;
    duration: string;
    durationMs: number;
    completeAt: number;
    claimed: boolean;
  }[] = [];
  private explorationMaxSlots = 2;
  private explorationRegisteredCount = 0;
  private codexTab: "collection" | "exploration" = "collection";

  // Achievement panel (toggled with J).
  private achievePanelOpen = false;
  private achievePanelContainer!: Phaser.GameObjects.Container;
  private achievePanelBg!: Phaser.GameObjects.Graphics;
  private readonly achievePanelElements: Phaser.GameObjects.GameObject[] = [];
  private achieveData: {
    id: string;
    name: string;
    description: string;
    category: string;
    completed: boolean;
    progress: { current: number; target: number }[];
    rewards: {
      mesos?: number;
      exp?: number;
      title?: string;
      statBonus?: Record<string, number>;
      expBonus?: number;
    };
  }[] = [];

  // Title system (owned titles + equipped title).
  private ownedTitles: string[] = [];
  private equippedTitle = "";

  // Mute toggle button (bottom bar, far right).
  private muteBtn!: Phaser.GameObjects.Container;
  private muteBtnLabel!: Phaser.GameObjects.Text;

  // GM role (set by server on join; gates the console UI).
  private playerRole = "player";

  // The NPC dialog box is a React overlay (src/ui/DialogPanel.tsx); UIScene
  // mirrors the registry dialog state into the bridge store via publishDialog().

  // Branch-choice panel (2nd-job advancement).
  private branchPanelContainer!: Phaser.GameObjects.Container;
  private branchPanelBg!: Phaser.GameObjects.Graphics;
  private branchPanelTitle!: Phaser.GameObjects.Text;
  private branchPanelDesc!: Phaser.GameObjects.Text;
  private readonly branchButtons: Phaser.GameObjects.Container[] = [];

  constructor() {
    super("ui");
  }

  create(): void {
    this.ensureCoinTexture();

    this.buildMesosCounter();
    this.buildHint();
    this.buildComboCounter();
    this.buildLevelUpOverlay();
    this.buildCubePanel();
    this.buildUpgradePanel();
    this.buildPartyHud();

    this.buildBranchPanel();
    this.buildWorldMap();
    this.buildFeedbackPanel();
    this.buildPlayerContextMenu();
    this.buildNpcContextMenu();
    this.buildStatsTooltip();
    this.buildBlockedListPanel();
    this.buildFamiliarPanel();
    this.buildCodexPanel();
    this.buildAchievePanel();
    this.buildAnnouncementBanner();

    this.setupInventoryToggle();
    this.setupStatPanelToggle();
    this.setupEquipPanelToggle();
    this.setupSkillTreeToggle();
    this.setupQuestLogToggle();
    this.buildGuidePanel();
    this.setupGuidePanelToggle();
    this.setupSocialToggles();
    this.setupChatInput();
    this.setupInputFocusPolicy();

    this.setupDialogInput();
    this.setupBranchPanel();
    this.setupCubePanelToggle();
    this.setupUpgradePanelToggle();
    this.setupWorldMapToggle();
    this.setupFeedbackToggle();
    this.setupPlayerContextMenu();
    this.setupNpcContextMenu();
    this.setupBlockedListToggle();
    this.setupFamiliarPanelToggle();
    this.setupCodexPanelToggle();
    this.setupAchievePanelToggle();
    this.buildQuickslots();
    this.setupQuickslotKeyboard();
    this.buildMuteButton();
    this.setupSettingsToggle();
    this.setupHelpToggle();
    this.setupReplayEvents();

    // Re-anchor the right/bottom-aligned pieces whenever the window (RESIZE scale mode) changes.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.layout();

    // Tidy up timers + schema listeners if this scene is ever stopped/restarted.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    this.resolveRoom();
  }

  // ─── Room acquisition + reactive binding ─────────────────────────────────────────────────────
  /** Grab the room from the registry, or poll until MeadowfieldScene publishes it post-connect. */
  private resolveRoom(): void {
    const existing = this.registry.get(ROOM_REGISTRY_KEY) as
      | Room<unknown, TownStateView>
      | undefined;
    // `room.state` and its nested `players` MapSchema are populated on the first
    // sync, a beat after the room lands in the registry. bindRoom reads
    // `room.state.players`, so wait until that MapSchema exists before binding —
    // otherwise a `.get` on an undefined map throws and the HUD never mounts.
    if (existing?.state?.players) {
      this.bindRoom(existing);
      return;
    }
    this.roomPoll = this.time.addEvent({
      delay: ROOM_POLL_MS,
      loop: true,
      callback: () => {
        const room = this.registry.get(ROOM_REGISTRY_KEY) as
          | Room<unknown, TownStateView>
          | undefined;
        if (!room?.state?.players) return;
        this.roomPoll?.remove();
        this.roomPoll = undefined;
        this.bindRoom(room);
      },
    });
  }

  /** Listen for server CHAT broadcasts and append them to the chat panel. */
  private bindChat(room: Room<unknown, TownStateView>): void {
    this.chatRoom = room;
    room.onMessage(MessageType.CHAT, (msg: ChatMessage) => {
      // Filter out messages from blocked players (client-side). Server filters whispers/trades.
      if (
        msg.sessionId !== "" &&
        this.blockedNames.some((n) => n.toLowerCase() === msg.name.toLowerCase())
      )
        return;
      this.addChatLine(msg.name, msg.text, "map");
    });

    // Cross-channel whisper relay.
    room.onMessage(MessageType.WHISPER_RELAY, (payload: { senderName: string; text: string }) => {
      if (this.blockedNames.some((n) => n.toLowerCase() === payload.senderName.toLowerCase()))
        return;
      this.addChatLine(payload.senderName, payload.text, "whisper");
    });

    // Whisper failure.
    room.onMessage(
      MessageType.WHISPER_FAILED,
      (payload: { targetName: string; reason: string }) => {
        this.addChatLine("System", `${payload.targetName}: ${payload.reason}`, "system");
      },
    );

    // Party chat relay.
    room.onMessage(MessageType.PARTY_CHAT_RELAY, (payload: PartyChatRelayPayload) => {
      this.addChatLine(payload.senderName, payload.text, "party");
    });

    // Guild chat relay.
    room.onMessage(
      MessageType.GUILD_CHAT_RELAY,
      (payload: { senderName: string; text: string }) => {
        this.addChatLine(payload.senderName, payload.text, "guild");
      },
    );
  }

  /** Attach schema callbacks once we have the room. Finds (or waits for) the local player. */
  private bindRoom(room: Room<unknown, TownStateView>): void {
    this.bindChat(room);
    this.setupFeedbackResponse(room);
    this.setupModerationListeners(room);
    this.setupSkillLearnListener(room);
    this.setupCombatListeners(room);
    this.setupGuildListeners(room);
    this.setupCubeMessageListener(room);
    this.setupUpgradeMessageListener(room);
    this.setupQuickslotMessageListeners(room);
    this.setupPartyListeners(room);
    this.setupFriendsListeners(room);

    // Title sync listener.
    room.onMessage(MessageType.TITLE_SYNC, (payload: import("@maple/shared").TitleSyncPayload) => {
      this.ownedTitles = payload.ownedTitles;
      this.equippedTitle = payload.equippedTitle;
      if (this.statPanelOpen) this.publishCharacter();
    });

    // Live-ops events sync.
    room.onMessage(
      MessageType.EVENTS_SYNC,
      (payload: import("@maple/shared").EventsSyncPayload) => {
        uiStore.getState().setEvents(payload.events);
      },
    );

    // Title fame-blocked notification.
    room.onMessage("title_fame_blocked" as string, (payload: { message: string }) => {
      this.addChatLine("System", payload.message, "system");
    });

    // Fame result listener.
    room.onMessage(
      MessageType.FAME_RESULT,
      (payload: import("@maple/shared").FameResultPayload) => {
        if (payload.myFame !== undefined && this.localPlayer) {
          (this.localPlayer as unknown as { displayFame: number }).displayFame = payload.myFame;
        }
        this.addChatLine("Fame", payload.message, "system");
        if (this.statPanelOpen) this.publishCharacter();
      },
    );

    // Familiar sync listener.
    room.onMessage(MessageType.FAMILIAR_SYNC, (payload: FamiliarSyncPayload) => {
      this.familiarRegistered = payload.registered;
      this.familiarSummoned = payload.summoned;
      if (this.familiarPanelOpen) this.renderFamiliarPanel();
    });
    room.onMessage(MessageType.FAMILIAR_CARD_DROP, (payload: FamiliarCardDropPayload) => {
      this.addChatLine("System", `✨ You found a ${payload.mobName} Familiar Card!`, "system");
    });

    // Codex sync.
    room.onMessage(
      MessageType.CODEX_SYNC,
      (payload: {
        codex: Record<string, number>;
        statBonus: { STR: number; DEX: number; INT: number; LUK: number; HP: number; MP: number };
        expBonus: number;
      }) => {
        this.codexData = payload.codex;
        this.codexStatBonus = payload.statBonus;
        this.codexExpBonus = payload.expBonus;
        if (this.codexPanelOpen) this.renderCodexPanel();
      },
    );

    // Achievement sync.
    room.onMessage(
      MessageType.ACHIEVEMENT_SYNC,
      (payload: {
        achievements: {
          id: string;
          name: string;
          description: string;
          category: string;
          completed: boolean;
          progress: { current: number; target: number }[];
        }[];
      }) => {
        this.achieveData = payload.achievements;
        if (this.achievePanelOpen) this.renderAchievePanel();
      },
    );

    // Exploration sync.
    room.onMessage(
      MessageType.EXPLORATION_SYNC,
      (payload: {
        slots: {
          slotIndex: number;
          mobId: string;
          startAt: number;
          duration: string;
          durationMs: number;
          completeAt: number;
          claimed: boolean;
        }[];
        maxSlots: number;
        registeredCount: number;
      }) => {
        this.explorationSlots = payload.slots;
        this.explorationMaxSlots = payload.maxSlots;
        this.explorationRegisteredCount = payload.registeredCount;
        if (this.codexPanelOpen) this.renderCodexPanel();
      },
    );

    // Exploration start result.
    room.onMessage(
      MessageType.EXPLORATION_START,
      (payload: { success: boolean; message: string }) => {
        this.addChatLine("System", payload.message, "system");
      },
    );

    // Exploration claim result.
    room.onMessage(
      MessageType.EXPLORATION_CLAIM,
      (payload: {
        success: boolean;
        claims: { slotIndex: number; mobId: string; mesos: number; items: string[] }[];
        totalMesos: number;
        totalItems: string[];
        message: string;
      }) => {
        if (payload.success) {
          this.addChatLine("System", `📦 ${payload.message}`, "system");
        } else {
          this.addChatLine("System", payload.message, "system");
        }
      },
    );

    // Player role from server (gates GM console visibility).
    room.onMessage("playerRole" as string, (payload: { role: string }) => {
      this.playerRole = payload.role ?? "player";
    });

    // GM command results — shown in chat as system messages.
    room.onMessage(MessageType.GM_RESULT, (payload: { success: boolean; message: string }) => {
      this.addChatLine("GM", payload.message, "system");
    });

    // Receive authoritative settings from the server on join.
    room.onMessage(
      MessageType.SETTINGS_SYNC,
      (payload: import("@maple/shared").SettingsPayload) => {
        keybindings.loadFromServer(payload);
      },
    );

    const $ = getStateCallbacks(room);

    // Wire the HUD to the local player's schema exactly once, reacting to every field + inventory
    // change. `$` is captured here so we never have to name its (internal) proxy type.
    const bindLocal = (player: PlayerView, sessionId: string): void => {
      if (this.localBound || sessionId !== room.sessionId) return;
      this.localBound = true;
      this.localPlayer = player;

      // GM role comes from the synced schema (reliable, unlike the onJoin message).
      // Read it now; the onChange subscription below also keeps it current if the
      // field syncs a beat after bind.
      if (player.role) this.playerRole = player.role;

      // Register React-overlay action handlers (equip/use/reorder/close) now that
      // we have an authoritative room to send messages on.
      this.registerUIActions(room);
      this.registerSocialActions(room);
      this.registerHudActions();
      this.registerChatActions();
      this.registerCharacterActions();
      this.registerReportActions();
      this.publishChat();

      // Any field change (hp, mp, level, exp, mesos, name, role, …) refreshes the
      // bottom HUD and keeps the GM role current.
      this.unsubscribers.push(
        $(player).onChange(() => {
          if (player.role) this.playerRole = player.role;
          this.updateHud();
        }),
      );

      // The inventory is a nested MapSchema — its add/remove drives the item panel.
      this.unsubscribers.push(
        $(player).inventory.onAdd(() => {
          this.renderInventory();
          if (this.cubePanelOpen) this.renderCubePanel();
          if (this.upgradePanelOpen) this.renderUpgradePanel();
          if (this.equipPanelOpen) this.publishEquipment();
          if (this.statPanelOpen) this.publishCharacter();
          this.publishHudSkills();
          this.publishHud();
        }),
      );
      this.unsubscribers.push(
        $(player).inventory.onRemove(() => {
          this.renderInventory();
          if (this.cubePanelOpen) this.renderCubePanel();
          if (this.upgradePanelOpen) this.renderUpgradePanel();
          if (this.equipPanelOpen) this.publishEquipment();
          if (this.statPanelOpen) this.publishCharacter();
          this.publishHudSkills();
          this.publishHud();
        }),
      );
      // Equipped gear changes also re-render the inventory and equipment panels.
      this.unsubscribers.push(
        $(player).equipped.onAdd(() => {
          this.renderInventory();
          if (this.equipPanelOpen) this.publishEquipment();
          if (this.statPanelOpen) this.publishCharacter();
        }),
      );
      this.unsubscribers.push(
        $(player).equipped.onRemove(() => {
          this.renderInventory();
          if (this.equipPanelOpen) this.publishEquipment();
          if (this.statPanelOpen) this.publishCharacter();
        }),
      );

      this.updateHud();
      this.renderInventory();

      // Load quickslots from server or fallback to localStorage.
      const charId = getCharId();
      if (charId) {
        this.quickslots = getQuickslots(charId);
        if (this.quickslots.length === 0) {
          this.quickslots = Array.from<QuickSlotEntry | null>({ length: QS_COUNT }).fill(null);
        }
        // Ensure correct length.
        while (this.quickslots.length < QS_COUNT) this.quickslots.push(null);
      } else {
        this.quickslots = Array.from<QuickSlotEntry | null>({ length: QS_COUNT }).fill(null);
      }
      this.publishHudSkills();
    };

    // Quest log: full snapshot pushed by the server whenever quest state changes.
    room.onMessage(MessageType.QUEST_UPDATE, (payload: QuestUpdatePayload) => {
      this.questData = payload;
      this.renderQuestTracker();
      this.publishQuestLog();
      this.publishMinimap(); // refresh quest markers on NPCs
    });

    // Guided progression sync.
    room.onMessage(
      MessageType.GUIDANCE_SYNC,
      (payload: import("@maple/shared").GuidanceSyncPayload) => {
        this.guideData = payload;
        if (this.guidePanelOpen) this.renderGuidePanel();
        this.publishMinimap(); // refresh guide objective marker
      },
    );

    // Bonus hunting map sync.
    room.onMessage(
      MessageType.BONUS_HUNT_SYNC,
      (payload: import("@maple/shared").BonusHuntSyncPayload) => {
        this.bonusHuntData = payload;
        if (payload.isActive) {
          this.showQuestNotification(
            `⚔️ Bonus Hunting is active here! EXP ×${payload.expMultiplier}, Drop ×${payload.dropMultiplier}`,
          );
        }
      },
    );

    // Quest turn-in notification.
    room.onMessage(
      "quest_turnin",
      (payload: {
        questId: string;
        questName: string;
        mesos: number;
        exp: number;
        items: string[];
      }) => {
        getAudioManager().playSfx("quest_complete");
        this.showQuestNotification(
          `✅ Turned in: ${payload.questName}  —  +${payload.mesos} mesos, +${payload.exp} EXP`,
        );
      },
    );

    // Quest offer (accept/decline panel).
    room.onMessage(
      "quest_offer",
      (payload: {
        questId: string;
        questName: string;
        giverNpcId: string;
        giverNpcName: string;
        objectives: { kind: string; description: string; target: number }[];
        rewards: { mesos?: number; exp?: number; items?: string[] };
        requiredLevel?: number;
      }) => {
        uiStore.getState().setQuestOffer(payload);
      },
    );

    // Quest turn-in offer (rewards panel).
    room.onMessage(
      "quest_turnin_offer",
      (payload: {
        questId: string;
        questName: string;
        giverNpcId: string;
        giverNpcName: string;
        rewards: { mesos?: number; exp?: number; items?: string[] };
      }) => {
        uiStore.getState().setQuestTurnin(payload);
      },
    );

    // The local player may already be in state, or may arrive a beat later — handle both.
    const existing = room.state.players.get(room.sessionId);
    if (existing) bindLocal(existing, room.sessionId);
    this.unsubscribers.push(
      $(room.state).players.onAdd((player: PlayerView, sessionId: string) =>
        bindLocal(player, sessionId),
      ),
    );
  }

  // ─── Combat listeners (status effects + level-up overlay) ────────────────────────────
  private setupCombatListeners(room: Room<unknown, TownStateView>): void {
    room.onMessage(MessageType.STATUS_EFFECTS, (payload: StatusEffectsPayload) => {
      this.statusEffects.length = 0;
      this.statusEffects.push(...payload.effects);
      this.publishStatusEffects();
    });

    room.onMessage(MessageType.LEVEL_UP, (payload: LevelUpPayload) => {
      this.showLevelUpOverlay(payload);
    });
  }

  // ─── Status effect icons (rendered by src/ui/StatusEffects.tsx) ───────────────────────
  /** Push the active buff/debuff list to the React HUD strip. */
  private publishStatusEffects(): void {
    uiStore.getState().setStatusEffects(
      this.statusEffects.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        stacks: e.stacks,
        durationMs: e.durationMs,
        remainingMs: e.remainingMs,
      })),
    );
  }

  // ─── Combo counter HUD ──────────────────────────────────────────────────────────────
  private buildComboCounter(): void {
    this.comboBg = this.add.graphics();
    this.comboText = this.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "22px",
        color: "#facc15",
        fontStyle: "bold",
        stroke: "#0a0e16",
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.comboLabel = this.add
      .text(0, 18, "COMBO", {
        fontFamily: FONT,
        fontSize: "10px",
        color: "#e5e7eb",
        fontStyle: "bold",
        stroke: "#0a0e16",
        strokeThickness: 2,
      })
      .setOrigin(0.5);
    this.comboContainer = this.add.container(0, 0, [this.comboBg, this.comboText, this.comboLabel]);
    this.comboContainer.setDepth(9600).setVisible(false);
  }

  private updateComboDisplay(): void {
    const p = this.localPlayer;
    if (!p || p.comboCount < 2) {
      this.comboContainer.setVisible(false);
      return;
    }
    this.comboContainer.setVisible(true);
    this.comboText.setText(`${p.comboCount}x`);
    const sw = this.scale.width;
    const barY = this.scale.height - BOTTOM_BAR_H - BOTTOM_BAR_MARGIN;
    this.comboContainer.setPosition(sw / 2, barY - 28);
  }

  // ─── Level-up overlay ────────────────────────────────────────────────────────────────
  private buildLevelUpOverlay(): void {
    this.levelUpOverlay = this.add.container(0, 0);
    this.levelUpOverlay.setDepth(9800).setVisible(false);
    this.levelUpText = this.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "24px",
        color: "#9ad06b",
        fontStyle: "bold",
        stroke: "#0a0e16",
        strokeThickness: 5,
      })
      .setOrigin(0.5);
    this.levelUpOverlay.add(this.levelUpText);
  }

  /** Show a dramatic level-up overlay with burst ring, particles, and EXP bar fill. */
  private showLevelUpOverlay(payload: LevelUpPayload): void {
    const sw = this.scale.width;
    const sh = this.scale.height;
    const cx = sw / 2;
    const cy = sh / 2 - 60;

    this.levelUpText.setText(`LEVEL UP!  Lv.${payload.level}`);
    this.levelUpOverlay.setPosition(cx, cy);
    this.levelUpOverlay.setVisible(true);
    this.levelUpOverlay.setScale(1.6);
    this.levelUpOverlay.setAlpha(1);

    this.tweens.add({
      targets: this.levelUpOverlay,
      scaleX: 1,
      scaleY: 1,
      duration: 400,
      ease: "Back.easeOut",
    });
    this.tweens.add({
      targets: this.levelUpOverlay,
      y: cy - 30,
      alpha: 0,
      delay: 1600,
      duration: 800,
      ease: "Quad.easeIn",
      onComplete: () => this.levelUpOverlay.setVisible(false),
    });

    // ── Burst ring — expanding circle that fades out. ──
    const ring = this.add.circle(cx, cy, 8, 0x9ad06b, 0).setDepth(9799);
    ring.setStrokeStyle(3, 0x9ad06b, 0.9);
    this.tweens.add({
      targets: ring,
      scaleX: 10,
      scaleY: 10,
      alpha: 0,
      duration: 550,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });

    // ── Radial particle burst — sparkle dots radiating outward. ──
    const PARTICLE_COUNT = 16;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 50 + Math.random() * 60;
      const dot = this.add.circle(cx, cy, 2 + Math.random() * 2, 0x9ad06b, 0.9).setDepth(9799);
      this.tweens.add({
        targets: dot,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist - 20,
        alpha: 0,
        duration: 400 + Math.random() * 200,
        ease: "Quad.easeOut",
        onComplete: () => dot.destroy(),
      });
    }

    // ── Flash overlay — bright white pulse. ──
    const flash = this.add.rectangle(cx, cy, sw, sh, 0xffffff, 0.25).setDepth(9798);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 350,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });

    // Level-up cue is played by MapScene.playLevelUpBurst (the level-state
    // change) via getAudioManager().playSfx("levelup"), so the overlay stays
    // silent to avoid a doubled jingle.
  }

  // ─── Per-frame updates ────────────────────────────────────────────────────────────────────────
  override update(_time: number, delta: number): void {
    // Tick status effect countdowns.
    this.effectUpdateTimer += delta;
    if (this.effectUpdateTimer > 500 && this.statusEffects.length > 0) {
      this.effectUpdateTimer = 0;
      let changed = false;
      for (const e of this.statusEffects) {
        const prev = e.remainingMs;
        e.remainingMs = Math.max(0, e.remainingMs - 500);
        if (e.remainingMs !== prev) changed = true;
      }
      // Remove expired effects.
      const before = this.statusEffects.length;
      for (let i = this.statusEffects.length - 1; i >= 0; i--) {
        if (this.statusEffects[i]?.remainingMs === 0) {
          this.statusEffects.splice(i, 1);
        }
      }
      if (this.statusEffects.length !== before) changed = true;
      if (changed) this.publishStatusEffects();
    }

    // Expire quickslot cooldowns and republish so the React skill bar updates
    // (the cooldown sweep itself is drawn by src/ui/hud/SkillBar.tsx).
    const now = this.time.now;
    let cooldownExpired = false;
    for (let i = 0; i < QS_COUNT; i++) {
      const endAt = this.qsCooldownEndAt.get(i);
      if (endAt === undefined) continue;
      if (now >= endAt) {
        this.qsCooldownEndAt.delete(i);
        cooldownExpired = true;
      }
    }
    if (cooldownExpired) this.publishHudSkills();

    // Refresh live minimap dots (throttled) + auto-pot.
    this.minimapPublishTimer += delta;
    if (this.minimapPublishTimer > 250) {
      this.minimapPublishTimer = 0;
      this.publishMinimap();
    }

    // 9) Auto-pot: auto-use potions when HP/MP drops below threshold.
    this.tickAutoPot(_time);
  }

  /** Throttle accumulator for republishing live minimap dots. */
  private minimapPublishTimer = 0;

  /** Auto-use potions when HP/MP drops below configured thresholds. */
  private tickAutoPot(time: number): void {
    if (!this.localPlayer || this.localPlayer.dead) return;
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;

    const p = this.localPlayer;
    const hpPct = p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 100;
    const mpPct = p.maxMp > 0 ? (p.mp / p.maxMp) * 100 : 100;

    if (
      this.autoPotConfig.hpEnabled &&
      hpPct < this.autoPotConfig.hpThreshold &&
      time - this.lastAutoPotHpAt > this.AUTO_POT_COOLDOWN_MS
    ) {
      this.lastAutoPotHpAt = time;
      room.send(MessageType.USE_CONSUMABLE, { defId: this.autoPotConfig.hpPotionId });
    }
    if (
      this.autoPotConfig.mpEnabled &&
      mpPct < this.autoPotConfig.mpThreshold &&
      time - this.lastAutoPotMpAt > this.AUTO_POT_COOLDOWN_MS
    ) {
      this.lastAutoPotMpAt = time;
      room.send(MessageType.USE_CONSUMABLE, { defId: this.autoPotConfig.mpPotionId });
    }
  }

  /** Execute a skill macro by index. */
  private executeMacro(index: number): void {
    const macro = this.macros[index];
    if (!macro) return;
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;
    room.send(MessageType.MACRO_CAST, { macroId: macro.id });
  }

  /** Estimate the cooldown duration for a quickslot entry (used for sweep animation). */
  private estimateCooldownMs(entry: QuickSlotEntry): number {
    if (entry.type === "skill") {
      // Try to look up skill cooldown.
      const p = this.localPlayer;
      if (p) {
        try {
          const skills = allSkillsForClass(p.archetype as ClassArchetype);
          const skill = skills.find((s: { id: string }) => s.id === entry.id);
          if (skill) {
            const lvl = this.localSkillBook[entry.id] ?? 1;
            return skillStatAt(skill, lvl).cooldownMs;
          }
        } catch {
          /* ignore */
        }
      }
      return 1000; // fallback
    } else {
      try {
        const def = getConsumableDef(entry.id);
        return def?.cooldownMs ?? 1000;
      } catch {
        return 1000;
      }
    }
  }

  // ─── HUD updates (reactive) ─────────────────────────────────────────────────────────────────
  /** Mirror the local player's vitals/progression/mesos. Called only on state change. */
  private updateHud(): void {
    const p = this.localPlayer;
    if (!p) return;

    // Vitals / EXP / nameplate now live in the React HUD (src/ui/hud/StatusBars.tsx).
    this.publishHud();

    // The mesos counter (top-right) is still Phaser-drawn.
    this.mesosText.setText(p.mesos.toLocaleString());
    this.positionMesos();

    if (this.statPanelOpen) this.publishCharacter();
    if (this.equipPanelOpen) this.publishEquipment();
    if (this.inventoryOpen) this.renderInventory();

    // Republish quickslots (MP changed, so affordability/cooldowns may differ).
    this.publishHudSkills();

    this.updateComboDisplay();
  }

  private setupInventoryToggle(): void {
    this.input.keyboard?.on("keydown-I", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      getAudioManager().playSfx("button_click");
      this.setInventoryOpen(!this.inventoryOpen);
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.inventoryOpen && !this.chatFocused) {
        this.setInventoryOpen(false);
      }
    });
  }

  /** Toggle the React quest-log overlay by flipping the bridge store open flag. */
  private setupQuestLogToggle(): void {
    this.input.keyboard?.on("keydown-Q", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      getAudioManager().playSfx("button_click");
      const open = !uiStore.getState().questLogOpen;
      uiStore.getState().setQuestLogOpen(open);
      if (open) this.publishQuestLog();
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      if (uiStore.getState().questLogOpen && !this.chatFocused) {
        uiStore.getState().setQuestLogOpen(false);
      }
    });
  }

  // ─── Guide panel (Maple Guide, toggled with J) ──────────────────────────────
  private buildGuidePanel(): void {
    this.guidePanelBg = this.add.graphics();
    this.guidePanelContainer = this.add.container(0, 0, [this.guidePanelBg]);
    this.guidePanelContainer.setDepth(9500).setVisible(false);
  }

  private setupGuidePanelToggle(): void {
    this.input.keyboard?.on("keydown-J", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      getAudioManager().playSfx("button_click");
      this.guidePanelOpen = !this.guidePanelOpen;
      this.guidePanelContainer.setVisible(this.guidePanelOpen);
      if (this.guidePanelOpen) this.renderGuidePanel();
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.guidePanelOpen && !this.chatFocused) {
        this.guidePanelOpen = false;
        this.guidePanelContainer.setVisible(false);
      }
    });
  }

  private renderGuidePanel(): void {
    for (const el of this.guidePanelElements) el.destroy();
    this.guidePanelElements.length = 0;

    const sw = this.scale.width;
    const px = GUIDE_PANEL_PAD;
    let y = GUIDE_PANEL_PAD;

    // ── Title ──
    const title = this.add.text(px, y, "Maple Guide", {
      fontFamily: FONT,
      fontSize: "15px",
      color: TEXT.level,
      fontStyle: "bold",
    });
    this.guidePanelContainer.add(title);
    this.guidePanelElements.push(title);

    const closeHint = this.add
      .text(GUIDE_PANEL_W - px, y + 2, "[ J / ESC ]", {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.dim,
      })
      .setOrigin(1, 0);
    this.guidePanelContainer.add(closeHint);
    this.guidePanelElements.push(closeHint);

    y += GUIDE_PANEL_HEADER_H;
    y = this.addPanelDivider(
      y,
      GUIDE_PANEL_W,
      GUIDE_PANEL_PAD,
      this.guidePanelContainer,
      this.guidePanelElements,
    );

    const data = this.guideData;
    if (!data) {
      const hint = this.add.text(px, y + 8, "No guidance available yet.", {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.dim,
      });
      this.guidePanelContainer.add(hint);
      this.guidePanelElements.push(hint);
      y += 28;
    } else {
      // ── Milestone title ──
      const mTitle = this.add.text(px, y, data.title, {
        fontFamily: FONT,
        fontSize: "13px",
        color: TEXT.bright,
        fontStyle: "bold",
        wordWrap: { width: GUIDE_DESC_WRAP },
      });
      this.guidePanelContainer.add(mTitle);
      this.guidePanelElements.push(mTitle);
      y += mTitle.height + 4;

      // ── Description ──
      const desc = this.add.text(px, y, data.description, {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.hint,
        wordWrap: { width: GUIDE_DESC_WRAP },
      });
      this.guidePanelContainer.add(desc);
      this.guidePanelElements.push(desc);
      y += desc.height + 8;

      y = this.addPanelDivider(
        y,
        GUIDE_PANEL_W,
        GUIDE_PANEL_PAD,
        this.guidePanelContainer,
        this.guidePanelElements,
      );

      // ── Steps ──
      for (const step of data.steps) {
        if (!step) continue;
        const marker = step.completed ? "✅" : step.active ? "➡️" : "⬜";
        const stepColor = step.completed ? "#6b8a5a" : step.active ? TEXT.level : TEXT.dim;
        const stepText = this.add.text(px + 4, y, `${marker} ${step.label}`, {
          fontFamily: FONT,
          fontSize: "12px",
          color: stepColor,
          wordWrap: { width: GUIDE_DESC_WRAP - 4 },
        });
        this.guidePanelContainer.add(stepText);
        this.guidePanelElements.push(stepText);
        y += Math.max(stepText.height, GUIDE_STEP_H);
      }

      // ── Go There button ──
      if (!data.allComplete && this.localPlayer) {
        y += 6;
        y = this.addPanelDivider(
          y,
          GUIDE_PANEL_W,
          GUIDE_PANEL_PAD,
          this.guidePanelContainer,
          this.guidePanelElements,
        );
        y += 6;

        const targetMap = data.teleportMapId ?? data.mapId;
        const currentMap = this.currentMapId;

        if (currentMap !== targetMap) {
          const btn = this.createPanelButton(
            GUIDE_PANEL_W / 2 - GUIDE_BTN_W / 2,
            y,
            GUIDE_BTN_W,
            GUIDE_BTN_H,
            `🚀 Go There`,
            () => {
              const room = this.registry.get("room");
              if (room) {
                room.send(MessageType.GUIDE_TRAVEL, { targetMapId: targetMap });
              }
            },
          );
          this.guidePanelContainer.add(btn);
          this.guidePanelElements.push(btn);
          y += GUIDE_BTN_H + 4;

          // Show map name + fee hint.
          const destDef = getMap(targetMap);
          const fee = travelFee(currentMap, targetMap);
          if (destDef) {
            const feeText = this.add
              .text(
                GUIDE_PANEL_W / 2,
                y,
                `${destDef.name}${fee > 0 ? ` — ${fee} mesos` : " (free)"}`,
                {
                  fontFamily: FONT,
                  fontSize: "11px",
                  color: TEXT.dim,
                },
              )
              .setOrigin(0.5, 0);
            this.guidePanelContainer.add(feeText);
            this.guidePanelElements.push(feeText);
            y += 18;
          }
        } else {
          const hereText = this.add.text(px, y, "📍 You're here! Complete the steps above.", {
            fontFamily: FONT,
            fontSize: "11px",
            color: TEXT.dim,
          });
          this.guidePanelContainer.add(hereText);
          this.guidePanelElements.push(hereText);
          y += 22;
        }
      }
    }

    // ── Background ──
    const totalH = y + GUIDE_PANEL_PAD;
    this.guidePanelBg
      .clear()
      .fillStyle(PALETTE.panelFill, 0.92)
      .fillRoundedRect(0, 0, GUIDE_PANEL_W, totalH, 8)
      .lineStyle(1, PALETTE.panelStroke, 0.9)
      .strokeRoundedRect(0, 0, GUIDE_PANEL_W, totalH, 8);

    // Position top-right.
    this.guidePanelContainer.setPosition(sw - GUIDE_PANEL_W - 12, 12);
  }

  // ─── Character progression panels (React: StatsPanel / EquipmentPanel / SkillTreePanel) ────────
  /** Open/close the React stat panel, keeping Phaser's flag + store in sync. */
  private setStatPanelOpen(open: boolean): void {
    this.statPanelOpen = open;
    uiStore.getState().setStatPanelOpen(open);
    if (open) this.publishCharacter();
  }

  /** Open/close the React equipment panel, keeping Phaser's flag + store in sync. */
  private setEquipmentPanelOpen(open: boolean): void {
    this.equipPanelOpen = open;
    uiStore.getState().setEquipmentOpen(open);
    if (open) this.publishEquipment();
  }

  /** Open/close the React skill-tree panel; requests the latest skill book on open. */
  private setSkillTreePanelOpen(open: boolean): void {
    this.skillTreeOpen = open;
    uiStore.getState().setSkillTreeOpen(open);
    if (open) {
      this.requestSkillBook();
      this.publishCharacter();
      this.publishSkillBook();
    }
  }

  private setupStatPanelToggle(): void {
    this.input.keyboard?.on("keydown-S", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      getAudioManager().playSfx("button_click");
      this.setStatPanelOpen(!this.statPanelOpen);
    });
  }

  private setupEquipPanelToggle(): void {
    this.input.keyboard?.on("keydown-E", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      getAudioManager().playSfx("button_click");
      this.setEquipmentPanelOpen(!this.equipPanelOpen);
    });
  }

  /** Convert a synced inventory item into the plain bridge snapshot shape. */
  private itemToSnapshot(it: InventoryItemView): InvItemSnapshot {
    return {
      uid: it.uid,
      defId: it.defId,
      baseRank: it.baseRank,
      potentialTier: it.potentialTier,
      lines: it.lines,
      potentialLines: it.potentialLines,
      bonusStats: (it as { bonusStats?: string }).bonusStats ?? "[]",
      stars: it.stars ?? 0,
      count: it.count,
    };
  }

  /** Push the local player's progression snapshot to the React stat panel. */
  private publishCharacter(): void {
    const p = this.localPlayer;
    if (!p) {
      uiStore.getState().setCharacter(null);
      return;
    }

    const cls = getClass(p.archetype as ClassArchetype);
    const primary = cls.primaryStat;

    // ── Equipment bonus (primary + secondary stats from gear) ─────
    const equipBonus = this.computeEquipBonus();

    // ── Equipped defIds → set bonuses ─────────────────────────────
    const equippedRec = Object.fromEntries(p.equipped.entries());
    const equippedDefIds = Object.values(equippedRec)
      .map((uid) => {
        const item = p.inventory.get(uid);
        return item ? getItemDef(item.defId)?.id : undefined;
      })
      .filter((id): id is string => id !== undefined);
    const setBonus = computeSetBonuses(equippedDefIds);

    // ── Passive skill bonuses (secondary stats) ───────────────────
    const _passiveRaw = passiveEffectBonus(p.archetype as ClassArchetype, this.localSkillBook);
    const passiveBonus: SecondaryStats = {
      atk: _passiveRaw.atk ?? 0,
      mAtk: _passiveRaw.mAtk ?? 0,
      wDef: _passiveRaw.wDef ?? 0,
      mDef: _passiveRaw.mDef ?? 0,
      critRate: _passiveRaw.critRate ?? 0,
      speed: _passiveRaw.speed ?? 0,
      jump: _passiveRaw.jump ?? 0,
      accuracy: _passiveRaw.accuracy ?? 0,
      avoid: _passiveRaw.avoid ?? 0,
    };

    // ── Active buff bonuses (reverse-lookup from status effect IDs) ──
    const buffAcc: Record<string, number> = {};
    const allSkills = allSkillsForClass(p.archetype as ClassArchetype);
    const skillById = new Map(allSkills.map((s) => [s.id, s]));
    for (const effect of this.statusEffects) {
      if (effect.kind !== "buff") continue;
      const skill = skillById.get(effect.id);
      if (skill?.buffEffect) {
        const sec = buffEffectToSecondary(skill.buffEffect);
        for (const [k, v] of Object.entries(sec)) {
          if (v === undefined || v === 0) continue;
          buffAcc[k] = (buffAcc[k] ?? 0) + v * effect.stacks;
        }
        continue;
      }
      // Try consumable buff
      const consDef = getConsumableDef(effect.id);
      if (consDef?.effect.kind === "buff") {
        for (const [k, v] of Object.entries(consDef.effect.secondary)) {
          if (v === undefined || v === 0) continue;
          buffAcc[k] = (buffAcc[k] ?? 0) + (v as number) * effect.stacks;
        }
      }
    }
    const buffBonus: SecondaryStats = {
      atk: buffAcc.atk ?? 0,
      mAtk: buffAcc.mAtk ?? 0,
      wDef: buffAcc.wDef ?? 0,
      mDef: buffAcc.mDef ?? 0,
      critRate: buffAcc.critRate ?? 0,
      speed: buffAcc.speed ?? 0,
      jump: buffAcc.jump ?? 0,
      accuracy: buffAcc.accuracy ?? 0,
      avoid: buffAcc.avoid ?? 0,
    };

    // ── Total effective primary stats (base + gear + set) ──────────
    const totalStats = {
      STR: p.str + equipBonus.str + setBonus.STR,
      DEX: p.dex + equipBonus.dex + setBonus.DEX,
      INT: p.intel + equipBonus.int + setBonus.INT,
      LUK: p.luk + equipBonus.luk + setBonus.LUK,
      HP: p.hp + equipBonus.hp + setBonus.HP,
      MP: p.mp + equipBonus.mp + setBonus.MP,
    };

    // ── Merged effect bonus (passive + buff) for deriveSecondary ───
    const effectBonus: SecondaryStats = {
      atk: passiveBonus.atk + buffBonus.atk,
      mAtk: passiveBonus.mAtk + buffBonus.mAtk,
      wDef: passiveBonus.wDef + buffBonus.wDef,
      mDef: passiveBonus.mDef + buffBonus.mDef,
      critRate: passiveBonus.critRate + buffBonus.critRate,
      speed: passiveBonus.speed + buffBonus.speed,
      jump: passiveBonus.jump + buffBonus.jump,
      accuracy: passiveBonus.accuracy + buffBonus.accuracy,
      avoid: passiveBonus.avoid + buffBonus.avoid,
    };

    // ── Merge set secondary stats into equipBonus (matches server) ──
    const equipWithSet: Partial<SecondaryStats> = {
      atk: equipBonus.atk + setBonus.atk,
      mAtk: setBonus.mAtk,
      wDef: equipBonus.wDef + setBonus.wDef,
      mDef: equipBonus.mDef + setBonus.mDef,
      critRate: setBonus.critRate,
      speed: equipBonus.speed + setBonus.speed,
      jump: equipBonus.jump + setBonus.jump,
      accuracy: setBonus.accuracy,
      avoid: setBonus.avoid,
    };

    // ── Final derived secondary stats (same as server combat math) ──
    const derived = deriveSecondary(totalStats, primary, equipWithSet, effectBonus);

    uiStore.getState().setCharacter({
      name: p.name || "Adventurer",
      level: p.level,
      archetype: p.archetype,
      branchId: p.branchId || "",
      jobTitle: this.getJobTitle(),
      primaryStat: primary,
      str: p.str,
      dex: p.dex,
      intel: p.intel,
      luk: p.luk,
      hp: p.hp,
      maxHp: p.maxHp,
      mp: p.mp,
      maxMp: p.maxMp,
      exp: p.exp,
      expNeed: expForLevel(p.level),
      ap: p.ap,
      fame: p.displayFame ?? 0,
      equippedTitle: this.equippedTitle,
      ownedTitles: [...this.ownedTitles],
      equipBonus,
      setBonus: {
        STR: setBonus.STR,
        DEX: setBonus.DEX,
        INT: setBonus.INT,
        LUK: setBonus.LUK,
        HP: setBonus.HP,
        MP: setBonus.MP,
        atk: setBonus.atk,
        mAtk: setBonus.mAtk,
        wDef: setBonus.wDef,
        mDef: setBonus.mDef,
        speed: setBonus.speed,
        jump: setBonus.jump,
        accuracy: setBonus.accuracy,
        avoid: setBonus.avoid,
        critRate: setBonus.critRate,
      },
      passiveBonus,
      buffBonus,
      derived,
      appearance: {
        gender: (p.gender as "M" | "F") || "M",
        skinId: p.skinId,
        hairId: p.hairId,
        hairColorId: p.hairColorId,
        faceId: p.faceId,
        outfitId: p.outfitId,
      },
    });
  }

  /** Push the equipped-gear paper-doll snapshot to the React equipment panel. */
  private publishEquipment(): void {
    const p = this.localPlayer;
    const slots = EQUIP_SLOT_ORDER.map((slot) => {
      const uid = p?.equipped.get(slot);
      const item = uid ? p?.inventory.get(uid) : undefined;
      return {
        slot,
        item: item ? this.itemToSnapshot(item) : null,
      };
    });
    uiStore.getState().setEquipment(slots);
    // Equipped gear feeds derived stats too — keep the stat panel fresh.
    if (this.statPanelOpen) this.publishCharacter();
  }

  /** Push the latest learned skill book to the React skill-tree panel. */
  private publishSkillBook(): void {
    uiStore.getState().setSkillBook({ ...this.localSkillBook });
  }

  /** Register the character-progression bridge actions. Idempotent-safe. */
  private registerCharacterActions(): void {
    uiStore.getState().setCharacterActions({
      spendAp: (stat) => {
        getAudioManager().playSfx("button_click");
        this.sendSpendAp(stat);
      },
      autoAssignAp: () => {
        getAudioManager().playSfx("button_click");
        this.sendAutoAssign();
      },
      equipTitle: (title) => {
        getAudioManager().playSfx("button_click");
        this.sendEquipTitle(title);
      },
      learnSkill: (skillId) => {
        getAudioManager().playSfx("button_click");
        this.sendLearnSkill(skillId);
      },
      unequip: (slot) => {
        getAudioManager().playSfx("button_click");
        const room = this.registry.get(ROOM_REGISTRY_KEY) as
          | Room<unknown, TownStateView>
          | undefined;
        if (room) room.send(MessageType.UNEQUIP_ITEM, { slot });
      },
      closeStatPanel: () => this.setStatPanelOpen(false),
      closeSkillTree: () => this.setSkillTreePanelOpen(false),
      closeEquipment: () => this.setEquipmentPanelOpen(false),
    });
  }

  private computeEquipBonus(): import("@maple/shared").EquippedBonuses {
    const p = this.localPlayer;
    if (!p)
      return {
        atk: 0,
        str: 0,
        dex: 0,
        int: 0,
        luk: 0,
        wDef: 0,
        mDef: 0,
        speed: 0,
        jump: 0,
        hp: 0,
        mp: 0,
      };
    const equippedRec = Object.fromEntries(p.equipped.entries());
    return resolveEquippedBonus(
      equippedRec,
      (uid) => {
        const item = p.inventory.get(uid);
        return item ? getItemDef(item.defId) : undefined;
      },
      (uid) => {
        const item = p.inventory.get(uid);
        return (item?.baseRank ?? "NORMAL") as import("@maple/shared").BaseRank;
      },
      (uid) => {
        const item = p.inventory.get(uid);
        if (!item?.potentialLines) return [];
        try {
          return JSON.parse(item.potentialLines) as import("@maple/shared").PotentialLine[];
        } catch {
          return [];
        }
      },
      (uid) => {
        const item = p.inventory.get(uid);
        if (!item?.bonusStats) return [];
        try {
          const parsed = JSON.parse(item.bonusStats) as import("@maple/shared").BonusStatLine[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
    );
  }

  private getJobTitle(): string {
    const p = this.localPlayer;
    if (!p) return "Beginner";
    try {
      const cls = getClass(p.archetype as ClassArchetype);
      return cls.name;
    } catch {
      return p.archetype;
    }
  }

  private sendSpendAp(stat: "STR" | "DEX" | "INT" | "LUK" | "HP" | "MP"): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.SPEND_AP, { stat });
    // Optimistic local update will be corrected by the next state patch.
  }

  private sendEquipTitle(title: string): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.TITLE_EQUIP, { title });
  }

  private sendAutoAssign(): void {
    // Spend all available AP one at a time into the class primary stat.
    const p = this.localPlayer;
    if (!p || p.ap <= 0) return;
    // Determine primary stat from archetype via shared (client has no getClass, so hardcode common ones).
    const primaryMap: Record<string, "STR" | "DEX" | "INT" | "LUK"> = {
      BEGINNER: "STR",
      WARRIOR: "STR",
      MAGICIAN: "INT",
      ARCHER: "DEX",
      THIEF: "LUK",
      BOWMAN: "DEX",
    };
    const primary = primaryMap[p.archetype] ?? "STR";
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;
    for (let i = 0; i < p.ap; i++) {
      room.send(MessageType.SPEND_AP, { stat: primary });
    }
  }

  // ─── Mesos counter ───────────────────────────────────────────────────────────────────────────
  private buildMesosCounter(): void {
    this.mesosBg = this.add.graphics();
    this.coin = this.add.image(0, MESOS_Y, "ui_coin").setOrigin(0.5, 0.5);
    this.mesosText = this.add
      .text(0, MESOS_Y, "0", {
        fontFamily: FONT,
        fontSize: "15px",
        color: TEXT.mesos,
        fontStyle: "bold",
      })
      .setOrigin(1, 0.5);
  }

  /** Bucket all non-equipped items from the flat server map into per-tab arrays. */
  private invBucketItems(): Map<InventoryTab, InventoryItemView[]> {
    const buckets = new Map<InventoryTab, InventoryItemView[]>();
    for (const tab of INV_TAB_LABELS) buckets.set(tab, []);
    const p = this.localPlayer;
    if (!p) return buckets;

    const equippedUids = new Set<string>();
    p.equipped.forEach((uid) => equippedUids.add(uid));

    p.inventory.forEach((item) => {
      if (equippedUids.has(item.uid)) return;
      const tab = tabForItem(item.defId);
      buckets.get(tab)?.push(item);
    });

    // Apply client-side ordering (items not in order appear at end).
    for (const tab of INV_TAB_LABELS) {
      const items = buckets.get(tab);
      if (!items || items.length <= 1) continue;
      const order = this.invClientOrder[tab] ?? [];
      const uidToItem = new Map<string, InventoryItemView>();
      for (const it of items) uidToItem.set(it.uid, it);

      const sorted: InventoryItemView[] = [];
      const seen = new Set<string>();
      for (const uid of order) {
        const it = uidToItem.get(uid);
        if (it) {
          sorted.push(it);
          seen.add(uid);
        }
      }
      for (const it of items) {
        if (!seen.has(it.uid)) sorted.push(it);
      }
      buckets.set(tab, sorted);
    }

    return buckets;
  }

  /** Ensure the client-side order array is populated for a tab. */
  private ensureInvOrder(tab: InventoryTab): void {
    const order = this.invClientOrder[tab];
    if (!order || order.length === 0) {
      const buckets = this.invBucketItems();
      const items = buckets.get(tab) ?? [];
      this.invClientOrder[tab] = items.map((it) => it.uid);
    }
  }

  /** Load client-side inventory ordering from localStorage. */
  private loadInvClientOrder(): void {
    try {
      const raw = localStorage.getItem("cryptomaple_inv_order");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string[]>;
        for (const tab of INV_TAB_LABELS) {
          if (Array.isArray(parsed[tab])) this.invClientOrder[tab] = parsed[tab];
        }
      }
    } catch {
      /* ignore */
    }
  }

  /** Save client-side inventory ordering to localStorage. */
  private saveInvClientOrder(): void {
    try {
      localStorage.setItem("cryptomaple_inv_order", JSON.stringify(this.invClientOrder));
    } catch {
      /* ignore */
    }
  }

  /**
   * Refresh the inventory. The inventory is rendered entirely by the React overlay, so this just
   * mirrors the latest state to the overlay store. Kept as the single entry point that callers and
   * schema subscriptions invoke on any inventory/equip change.
   */
  private renderInventory(): void {
    this.publishInventory();
  }

  /** Register the React-overlay bridge actions. Idempotent. */
  private registerUIActions(room: Room<unknown, TownStateView>): void {
    if (this.uiActionsRegistered) return;
    this.uiActionsRegistered = true;
    uiStore.getState().setActions({
      equip: (uid: string) => {
        getAudioManager().playSfx("button_click");
        room.send(MessageType.EQUIP_ITEM, { uid });
      },
      use: (defId: string) => {
        getAudioManager().playSfx("button_click");
        room.send(MessageType.USE_CONSUMABLE, { defId });
      },
      reorder: (tab: InventoryTab, fromUid: string, toUid: string) =>
        this.reorderInvByUid(tab, fromUid, toUid),
      sort: (tab: InventoryTab) => {
        getAudioManager().playSfx("button_click");
        room.send(MessageType.INVENTORY_SORT, { tab });
        // Optimistic client-side sort of the display order for instant feedback.
        this.sortInvClientOrder(tab);
        this.renderInventory();
      },
      close: () => this.setInventoryOpen(false),
    });

    // World map travel action — sends MAP_TRAVEL to the authoritative server.
    uiStore.getState().setWorldMapActions({
      travelTo: (targetMapId: string) => {
        getAudioManager().playSfx("button_click");
        const targetDef = getMap(targetMapId);
        const targetName = targetDef?.name ?? targetMapId;
        this.showFloatMessage(`Traveling to ${targetName}...`);
        uiStore.getState().setWorldMapOpen(false);
        room.send(MessageType.MAP_TRAVEL, { targetMapId });
      },
    });

    // NPC dialog actions — the server walks the dialog tree and fires the
    // downstream effect (open shop / travel / advance job / …); the client only
    // sends the chosen index (-1 advances a line node / closes).
    uiStore.getState().setDialogActions({
      next: () => room.send(MessageType.DIALOG_CHOICE, { choiceIndex: -1 }),
      choose: (index: number) => {
        getAudioManager().playSfx("button_click");
        room.send(MessageType.DIALOG_CHOICE, { choiceIndex: index });
      },
      close: () => room.send(MessageType.DIALOG_CHOICE, { choiceIndex: -1 }),
    });

    // Quest offer / turn-in / log actions.
    uiStore.getState().setQuestActions({
      acceptOffer: (questId: string) => {
        getAudioManager().playSfx("button_click");
        room.send(MessageType.QUEST_ACCEPT, { questId });
        uiStore.getState().setQuestOffer(null);
      },
      declineOffer: (questId: string) => {
        room.send(MessageType.QUEST_DECLINE, { questId });
        uiStore.getState().setQuestOffer(null);
      },
      acceptTurnin: (questId: string) => {
        getAudioManager().playSfx("button_click");
        room.send(MessageType.QUEST_TURNIN_ACCEPT, { questId });
        uiStore.getState().setQuestTurnin(null);
      },
      declineTurnin: (questId: string) => {
        room.send(MessageType.QUEST_TURNIN_DECLINE, { questId });
        uiStore.getState().setQuestTurnin(null);
      },
      closeLog: () => uiStore.getState().setQuestLogOpen(false),
      abandonQuest: (questId: string) => {
        room.send(MessageType.QUEST_ABANDON, { questId });
      },
    });

    // Push the initial dialog + quest-log snapshots in case state already exists.
    this.publishDialog();
    this.publishQuestLog();
  }

  // ─── Always-on HUD bridge (rendered by src/ui/HUD.tsx) ────────────────────────────────
  /** Register the HUD action registry (skill-bar quickslot use). Idempotent-safe. */
  private registerHudActions(): void {
    uiStore.getState().setHudActions({
      useSkill: (index: number) => this.executeQuickslot(index),
    });
  }

  /** Register the chat action registry (send + focus reporting) for the React chat box. */
  private registerChatActions(): void {
    uiStore.getState().setChatActions({
      send: (channel: ChatChannel, text: string) => this.sendChatFromReact(channel, text),
    });
  }

  /** Push the local player's vitals/progression into the HUD snapshot. */
  private publishHud(): void {
    const p = this.localPlayer;
    if (!p) return;
    const expNeed = expForLevel(p.level);
    const expRatio = expNeed > 0 ? Math.min(1, p.exp / expNeed) : 0;
    // Resolve equipped ammo info.
    let ammoInfo: { category: string; name: string; count: number; atkBonus: number } | null = null;
    const weaponUid = p.equipped?.get(EquipSlot.WEAPON);
    if (weaponUid) {
      const weaponItem = p.inventory?.get(weaponUid);
      if (weaponItem) {
        const weaponDef = getItemDef(weaponItem.defId);
        if (weaponDef?.ammoType) {
          let totalCount = 0;
          let firstAmmoName = "";
          let firstAtkBonus = 0;
          p.inventory?.forEach((item) => {
            if (isAmmoItem(item.defId)) {
              const ad = getAmmoDef(item.defId);
              if (ad && ad.category === weaponDef.ammoType) {
                totalCount += item.count ?? 1;
                if (!firstAmmoName) {
                  firstAmmoName = ad.name;
                  firstAtkBonus = ad.atkBonus;
                }
              }
            }
          });
          ammoInfo = {
            category: weaponDef.ammoType,
            name: firstAmmoName || weaponDef.ammoType,
            count: totalCount,
            atkBonus: firstAtkBonus,
          };
        }
      }
    }
    uiStore.getState().setHud({
      visible: true,
      name: p.name || "Adventurer",
      level: p.level,
      archetype: p.archetype || "BEGINNER",
      mesos: p.mesos,
      hp: Math.max(0, p.hp),
      maxHp: p.maxHp,
      mp: Math.max(0, p.mp),
      maxMp: p.maxMp,
      expRatio,
      expPct: (expRatio * 100).toFixed(1),
      dead: p.dead,
      ammo: ammoInfo,
    });
  }

  /** Resolve the quickslot layout to plain display data and publish it to the HUD. */
  private publishHudSkills(): void {
    const p = this.localPlayer;
    const now = this.time.now;
    const skills: HudSkillSlot[] = [];
    for (let i = 0; i < QS_COUNT; i++) {
      const entry = this.quickslots[i];
      const key = QS_BINDINGS[i] ?? `${i + 1}`;
      if (!entry) {
        skills.push({
          index: i,
          key,
          kind: null,
          id: "",
          label: "",
          fullName: "",
          usable: false,
          cooldownEndAt: 0,
          cooldownTotalMs: 0,
        });
        continue;
      }
      let label: string;
      let fullName: string;
      let usable = true;
      let count: number | undefined;
      let skillKind: "active" | "buff" | "passive" | undefined;
      if (entry.type === "skill") {
        const learned = this.localSkillBook[entry.id] ?? 0;
        const allSkills = p ? allSkillsForClass(p.archetype as ClassArchetype) : [];
        const skillDef = allSkills.find((s: { id: string }) => s.id === entry.id);
        fullName = skillDef?.name ?? entry.id;
        label = (skillDef?.name ?? entry.id.slice(entry.id.lastIndexOf(".") + 1)).slice(0, 6);
        if (skillDef) {
          skillKind = skillDef.kind;
          if (p) usable = p.mp >= skillStatAt(skillDef, learned).mpCost;
        }
        if (learned <= 0) usable = false;
      } else {
        let stack = 0;
        if (p)
          p.inventory.forEach((item) => {
            if (item.defId === entry.id) stack = item.count;
          });
        const def = getItemDef(entry.id);
        fullName = def?.name ?? entry.id;
        label = (def?.name ?? entry.id.slice(entry.id.lastIndexOf(".") + 1)).slice(0, 6);
        usable = stack > 0;
        count = stack;
      }
      const cdEnd = this.qsCooldownEndAt.get(i);
      const cooldownEndAt = cdEnd !== undefined && cdEnd > now ? Date.now() + (cdEnd - now) : 0;
      const cooldownTotalMs = cooldownEndAt > 0 ? this.estimateCooldownMs(entry) : 0;
      skills.push({
        index: i,
        key,
        kind: entry.type,
        id: entry.id,
        skillKind,
        label,
        fullName,
        usable,
        count,
        cooldownEndAt,
        cooldownTotalMs,
      });
    }
    uiStore.getState().setHud({ skills });
  }

  /** Publish the always-on quest tracker (active + complete quests, bonus-hunt banner). */
  private publishQuestTrackerHud(): void {
    const active = this.questData.quests.filter(
      (q) => q.status === "active" || q.status === "complete",
    );
    uiStore.getState().setHud({
      quests: active.map((q) => ({
        questId: q.questId,
        name: q.name,
        complete: q.status === "complete",
        objectives: q.objectiveProgress.map((o) => ({
          description: o.description,
          current: o.current,
          target: o.target,
          done: o.current >= o.target,
        })),
      })),
      bonusHunt: this.bonusHuntData?.isActive
        ? {
            expMultiplier: this.bonusHuntData.expMultiplier,
            dropMultiplier: this.bonusHuntData.dropMultiplier,
          }
        : null,
    });
  }

  /** Publish the minimap snapshot (static geometry + live entity dots) to the HUD. */
  private publishMinimap(): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    const map = this.resolveCurrentMap();
    const dots: { x: number; y: number; kind: "self" | "player" | "mob" }[] = [];
    let playerCount = 0;
    if (room?.state?.players && room.state.mobs) {
      room.state.mobs.forEach((mob) => {
        if (!mob.dead) dots.push({ x: mob.x, y: mob.y, kind: "mob" });
      });
      room.state.players.forEach((player, sessionId) => {
        playerCount++;
        dots.push({
          x: player.x,
          y: player.y,
          kind: sessionId === room.sessionId ? "self" : "player",
        });
      });
    }
    uiStore.getState().setHud({
      minimap: {
        mapName: map.name,
        playerCount,
        width: map.width,
        height: map.height,
        footholds: map.footholds.map((f) => ({ x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2 })),
        ladders: map.ladders.map((l) => ({ x: l.x, yTop: l.yTop, yBottom: l.yBottom })),
        portals: map.portals.map((pt) => ({ x: pt.x, y: pt.y })),
        npcs: getNpcsForMap(this.currentMapId).map((n) => {
          // Compute quest marker for this NPC from the live quest log.
          let quest: "available" | "active" | "turnin" | "guide" | undefined;
          // Guidance target takes top priority — the player should always see
          // where the current objective NPC is.
          if (
            this.guideData &&
            !this.guideData.allComplete &&
            this.guideData.targetNpcId === n.id &&
            this.guideData.mapId === this.currentMapId
          ) {
            quest = "guide";
          } else {
            // Walk quest log for this NPC (uses QUESTS[].giverNpcId).
            let hasTurnin = false;
            let hasActive = false;
            let hasAvailable = false;
            for (const qs of this.questData.quests) {
              const def = QUESTS[qs.questId];
              if (!def || def.giverNpcId !== n.id) continue;
              if (qs.status === "complete") hasTurnin = true;
              else if (qs.status === "active") hasActive = true;
              else if (qs.status === "available") hasAvailable = true;
            }
            // Priority: turn-in > active > available
            if (hasTurnin) quest = "turnin";
            else if (hasActive) quest = "active";
            else if (hasAvailable) quest = "available";
          }
          return { x: n.x, y: n.y, quest };
        }),
        dots,
      },
    });
  }

  /** Push a plain inventory snapshot to the React overlay store. */
  private publishInventory(): void {
    const p = this.localPlayer;
    const buckets = this.invBucketItems();
    const toSnap = (it: InventoryItemView): InvItemSnapshot => ({
      uid: it.uid,
      defId: it.defId,
      baseRank: it.baseRank,
      potentialTier: it.potentialTier,
      lines: it.lines,
      potentialLines: it.potentialLines,
      bonusStats: (it as { bonusStats?: string }).bonusStats ?? "[]",
      stars: it.stars ?? 0,
      count: it.count,
    });
    const out: Record<InventoryTab, InvItemSnapshot[]> = { EQUIP: [], USE: [], ETC: [], CASH: [] };
    for (const tab of INV_TAB_LABELS) out[tab] = (buckets.get(tab) ?? []).map(toSnap);

    const equippedDefIds: string[] = [];
    if (p) {
      p.equipped.forEach((uid) => {
        const inv = p.inventory.get(uid);
        if (inv) equippedDefIds.push(inv.defId);
      });
    }
    uiStore.getState().setInventory({
      buckets: out,
      mesos: p ? p.mesos : 0,
      player: p
        ? {
            level: p.level,
            str: p.str,
            dex: p.dex,
            intel: p.intel,
            luk: p.luk,
            hp: p.hp,
            mp: p.mp,
            archetype: p.archetype,
          }
        : null,
      equippedDefIds,
    });
  }

  /** Swap two items within a tab by uid (React drag-reorder), then republish. */
  private reorderInvByUid(tab: InventoryTab, fromUid: string, toUid: string): void {
    this.ensureInvOrder(tab);
    const order = this.invClientOrder[tab];
    if (order) {
      const fromPos = order.indexOf(fromUid);
      const toPos = order.indexOf(toUid);
      if (fromPos >= 0 && toPos >= 0) {
        order[fromPos] = toUid;
        order[toPos] = fromUid;
        this.saveInvClientOrder();
      }
    }
    this.renderInventory();
  }

  /** Optimistically sort client-side display order for instant feedback. */
  private sortInvClientOrder(tab: InventoryTab): void {
    this.ensureInvOrder(tab);
    const order = this.invClientOrder[tab];
    if (!order || order.length <= 1) return;
    const p = this.localPlayer;
    if (!p) return;
    order.sort((aUid, bUid) => {
      const a = p.inventory.get(aUid);
      const b = p.inventory.get(bUid);
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      const defCmp = a.defId.localeCompare(b.defId);
      if (defCmp !== 0) return defCmp;
      return (b.count || 1) - (a.count || 1);
    });
    this.saveInvClientOrder();
  }

  /** Open/close the inventory, keeping the Phaser flag and React store in sync. */
  private setInventoryOpen(open: boolean): void {
    this.inventoryOpen = open;
    uiStore.getState().setInventoryOpen(open);
    if (open) {
      this.registry.set("coachmark:inventory", true);
      this.loadInvClientOrder();
      this.renderInventory();
    }
  }

  // ─── Hint line ───────────────────────────────────────────────────────────────────────────────
  private buildHint(): void {
    this.hintText = this.add
      .text(
        14,
        0,
        "Arrows/WASD move · Up/Down climb · Alt jump · SPACE attack · ENTER talk · Q quests · I inventory · M market · P cash shop",
        {
          fontFamily: FONT,
          fontSize: "12px",
          color: TEXT.hint,
          stroke: TEXT.stroke,
          strokeThickness: 3,
        },
      )
      .setOrigin(0, 1);
    // Hint is rebuilt in layout().
  }

  // ─── Chat (rendered by React: src/ui/hud/ChatBox.tsx) ────────────────────────────────────────
  /** Route a composed chat line from the React input to the right server message. */
  private sendChatFromReact(channel: ChatChannel, raw: string): void {
    const room = this.chatRoom;
    const text = raw.trim();
    if (!text || !room) return;

    // GM commands (admin only) intercept before chat routing.
    if (this.playerRole === "admin") {
      const GM_PREFIXES = [
        "/tp ",
        "/teleport ",
        "/spawn ",
        "/boss ",
        "/give ",
        "/level ",
        "/lvl ",
        "/killall",
        "/mute ",
        "/unmute ",
        "/kick ",
        "/ban ",
        "/unban ",
        "/god",
        "/announce ",
        "/shout ",
        "/help",
      ];
      if (GM_PREFIXES.some((p) => text.toLowerCase().startsWith(p))) {
        room.send(MessageType.GM_COMMAND, { command: text });
        return;
      }
    }

    // Slash commands override the active channel.
    const whisperMatch = text.match(/^\/(?:w|whisper)\s+(\S+)\s+(.+)$/i);
    if (whisperMatch) {
      const [, targetName, msg] = whisperMatch;
      room.send(MessageType.WHISPER, { targetName, text: msg });
      return;
    }
    if (text.startsWith("/p ") || text.startsWith("/party ")) {
      const msg = text.replace(/^\/p(?:arty)?\s+/i, "");
      if (msg.length > 0) room.send(MessageType.PARTY_CHAT, { text: msg });
      return;
    }
    if (text.startsWith("/g ") || text.startsWith("/guild ")) {
      const msg = text.replace(/^\/g(?:uild)?\s+/i, "");
      if (msg.length > 0) room.send(MessageType.GUILD_CHAT, { text: msg });
      return;
    }

    // Route by the channel tab the player is on.
    switch (channel) {
      case "whisper": {
        const parts = text.split(/\s+/);
        const target = parts[0] ?? "";
        const msg = parts.slice(1).join(" ");
        if (target && msg) room.send(MessageType.WHISPER, { targetName: target, text: msg });
        break;
      }
      case "party":
        room.send(MessageType.PARTY_CHAT, { text });
        break;
      case "guild":
        room.send(MessageType.GUILD_CHAT, { text });
        break;
      default:
        room.send(MessageType.CHAT, { text });
        break;
    }
  }

  /**
   * Subscribe the scene to the single input-routing policy (ui/inputFocus.ts).
   * Any focused text field in the React overlay — chat, market search, report,
   * character name, … — now suppresses Phaser keyboard input through one path,
   * instead of each field wiring its own onFocus/onBlur.
   */
  private setupInputFocusPolicy(): void {
    const off = subscribeInputFocus((f) => this.applyTextInputFocus(f));
    this.unsubscribers.push(off);
    // Sync to the current state in case a field is already focused on launch.
    this.applyTextInputFocus(isTextInputFocused());
  }

  /**
   * Apply the "is the player typing?" state to every Phaser input path:
   *  - `chatFocused` + the `chatFocused` registry flag gate the keydown handlers
   *    (this scene) and movement/attack/jump/interact (MapScene `suppressed`).
   *  - Disabling the keyboard plugin (`enabled = false`) hard-stops this scene's
   *    `kb.on(...)` hotkeys AND `Key.isDown` polling in one switch.
   *  - Releasing global capture lets the focused DOM `<input>` receive the keys
   *    (Phaser stops calling preventDefault on bound keys).
   */
  private applyTextInputFocus(focused: boolean): void {
    this.chatFocused = focused;
    this.registry.set(CHAT_FOCUSED_KEY, focused);
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.enabled = !focused;
    if (focused) kb.disableGlobalCapture();
    else kb.enableGlobalCapture();
  }

  /** Bind Enter to focus the React chat input (when not already typing / in a dialog). */
  private setupChatInput(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on("keydown-ENTER", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      if (this.registry.get(DIALOG_OPEN_KEY) === true) return;
      uiStore.getState().requestChatFocus();
    });
  }

  /** Append a chat line to the scrollback buffer and republish to the overlay. */
  private addChatLine(name: string, text: string, scope: ChatScope | "system"): void {
    this.chatMsgBuffer.push({ id: this.chatMsgSeq++, name, text, scope });
    while (this.chatMsgBuffer.length > 80) this.chatMsgBuffer.shift();
    this.publishChat();
  }

  /** Push the chat scrollback snapshot to the React overlay store. */
  private publishChat(): void {
    uiStore.getState().setChat({
      channels: ["map", "whisper", "party", "guild"],
      messages: this.chatMsgBuffer.map((m) => ({
        id: m.id,
        name: m.name,
        text: m.text,
        scope: m.scope,
      })),
    });
  }

  // ─── Dialog box (React overlay bridge — src/ui/DialogPanel.tsx) ──────────────────────────────
  /**
   * Mirror the registry dialog state (set by MapScene on each DIALOG /
   * DIALOG_END message) into the bridge store so the React DialogPanel can
   * render it. Pushes a plain serializable snapshot only.
   */
  private publishDialog(): void {
    const state = this.registry.get(DIALOG_STATE_KEY) as {
      open: boolean;
      npcId: string;
      npcName: string;
      text: string;
      choices: readonly { label: string; index: number }[] | null;
      hasNext: boolean;
    } | null;

    if (!state || !state.open) {
      uiStore.getState().setDialog(null);
      return;
    }

    uiStore.getState().setDialog({
      npcId: state.npcId,
      npcName: state.npcName,
      text: state.text,
      choices: state.choices
        ? state.choices.map((c) => ({ label: c.label, index: c.index }))
        : null,
      hasNext: state.hasNext,
    });
  }

  /** Bridge the registry dialog/quest-notify events into the React overlay. */
  private setupDialogInput(): void {
    // Mirror registry dialog state into the bridge store for DialogPanel.
    this.registry.events.on("changedata-dialogState", () => this.publishDialog());

    // Show a floating quest acceptance notification when the server accepts a quest.
    this.registry.events.on("changedata-questNotify", () => {
      const msg = this.registry.get(QUEST_NOTIFY_KEY) as string | undefined;
      if (!msg) return;
      this.showQuestNotification(msg);
    });
  }

  // ─── Branch-choice panel (2nd-job advancement) ───────────────────────────────
  private buildBranchPanel(): void {
    this.branchPanelBg = this.add.graphics();
    this.branchPanelTitle = this.add.text(0, 0, "", {
      fontFamily: FONT,
      fontSize: "16px",
      color: "#ffd700",
      fontStyle: "bold",
    });
    this.branchPanelDesc = this.add.text(0, 0, "", {
      fontFamily: FONT,
      fontSize: "12px",
      color: "#c0c6d0",
      wordWrap: { width: 340 },
      lineSpacing: 3,
    });
    this.branchPanelContainer = this.add.container(0, 0, [
      this.branchPanelBg,
      this.branchPanelTitle,
      this.branchPanelDesc,
    ]);
    this.branchPanelContainer.setDepth(9700).setVisible(false);
  }

  private setupBranchPanel(): void {
    this.registry.events.on("changedata-branchList", () => this.updateBranchPanel());
  }

  private updateBranchPanel(): void {
    const data = this.registry.get("branchList") as {
      branches: readonly { id: string; name: string; description: string }[];
      archetype: string;
    } | null;

    // Destroy old buttons.
    for (const btn of this.branchButtons) btn.destroy();
    this.branchButtons.length = 0;

    if (!data || data.branches.length === 0) {
      this.branchPanelContainer.setVisible(false);
      return;
    }

    const sw = this.scale.width;
    const sh = this.scale.height;
    const panelW = 380;
    const btnH = 48;
    const btnPad = 8;
    const panelPad = 20;
    const headerH = 56;
    const panelH = headerH + panelPad + data.branches.length * (btnH + btnPad) + panelPad;
    const panelX = sw / 2 - panelW / 2;
    const panelY = sh / 2 - panelH / 2;

    this.branchPanelBg
      .clear()
      .fillStyle(0x0f1520, 0.95)
      .fillRoundedRect(panelX, panelY, panelW, panelH, 12)
      .lineStyle(2, 0xd4a828, 1)
      .strokeRoundedRect(panelX, panelY, panelW, panelH, 12);

    this.branchPanelTitle
      .setPosition(panelX + panelPad, panelY + panelPad)
      .setText("Choose Your Specialization");
    this.branchPanelDesc
      .setPosition(panelX + panelPad, panelY + panelPad + 22)
      .setText("Select the path that defines your future. This choice is permanent.");

    for (let i = 0; i < data.branches.length; i++) {
      const branch = data.branches[i];
      if (!branch) continue;
      const btnY = panelY + headerH + panelPad + i * (btnH + btnPad) + btnH / 2;
      const btn = this.createBranchButton(
        panelX + panelW / 2,
        btnY,
        branch.name,
        branch.description,
        panelW - panelPad * 2,
        btnH,
        () => this.onBranchChoice(branch.id),
      );
      this.branchButtons.push(btn);
    }
    this.branchPanelContainer.setVisible(true);
  }

  private createBranchButton(
    x: number,
    y: number,
    name: string,
    description: string,
    w: number,
    h: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const bg = this.add.graphics();
    bg.fillStyle(0x1c2840, 0.95);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    bg.lineStyle(1, 0x4a6a8a, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);

    const nameLabel = this.add
      .text(-w / 2 + 12, -h / 2 + 6, name, {
        fontFamily: FONT,
        fontSize: "14px",
        color: "#ffd700",
        fontStyle: "bold",
      })
      .setOrigin(0, 0);
    const descLabel = this.add
      .text(-w / 2 + 12, -h / 2 + 24, description, {
        fontFamily: FONT,
        fontSize: "10px",
        color: "#8899aa",
        wordWrap: { width: w - 24 },
      })
      .setOrigin(0, 0);

    const container = this.add.container(x, y, [bg, nameLabel, descLabel]);
    container.setDepth(9701).setSize(w, h).setInteractive();
    container.on("pointerover", () => {
      bg.clear();
      bg.fillStyle(0x263850, 1);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
      bg.lineStyle(1.5, 0x88aacc, 1);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
    });
    container.on("pointerout", () => {
      bg.clear();
      bg.fillStyle(0x1c2840, 0.95);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
      bg.lineStyle(1, 0x4a6a8a, 0.8);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
    });
    container.on("pointerdown", onClick);
    return container;
  }

  private onBranchChoice(branchId: string): void {
    const room = this.registry.get("room") as Room<unknown, TownStateView> | undefined;
    if (!room) return;
    room.send(MessageType.BRANCH_CHOICE, { branchId });
    // Hide the panel — the server will respond with JOB_ADVANCE.
    this.branchPanelContainer.setVisible(false);
    for (const btn of this.branchButtons) btn.setVisible(false);
  }

  /** Float a quest-acceptance notification above the bottom bar that fades after 3s. */
  private showQuestNotification(text: string): void {
    const sw = this.scale.width;
    const sh = this.scale.height;
    const label = this.add
      .text(sw / 2, sh - 80, text, {
        fontFamily: FONT,
        fontSize: "14px",
        color: "#9ad06b",
        fontStyle: "bold",
        stroke: "#0a0e16",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(9800);

    this.tweens.add({
      targets: label,
      y: label.y - 30,
      alpha: 0,
      duration: 3000,
      ease: "Quad.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  // ─── Quest tracker HUD (always-on, top-right) ──────────────────────────────────────────────
  /** Republish the always-on quest tracker snapshot (rendered by src/ui/hud/QuestTracker.tsx). */
  private renderQuestTracker(): void {
    this.publishQuestTrackerHud();
  }

  // ─── Quest log panel (React overlay — src/ui/QuestLogPanel.tsx) ───────────────────────────────
  /** Push the quest journal snapshot to the bridge store for the React QuestLogPanel. */
  private publishQuestLog(): void {
    uiStore.getState().setQuestLog({
      quests: this.questData.quests.map((q) => ({
        questId: q.questId,
        name: q.name,
        status: q.status,
        isRepeatable: q.isRepeatable ?? false,
        objectiveProgress: q.objectiveProgress.map((o) => ({
          kind: o.kind,
          description: o.description,
          current: o.current,
          target: o.target,
        })),
      })),
    });
  }

  // ─── Skill tree panel (rendered by src/ui/SkillTreePanel.tsx) ────────────────────────────────
  private setupSkillTreeToggle(): void {
    this.input.keyboard?.on("keydown-K", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      getAudioManager().playSfx("button_click");
      this.setSkillTreePanelOpen(!this.skillTreeOpen);
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.skillTreeOpen && !this.chatFocused) this.setSkillTreePanelOpen(false);
    });
  }

  private sendLearnSkill(skillId: string): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.LEARN_SKILL, { skillId });
  }

  private requestSkillBook(): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.SKILL_BOOK, {});
  }

  private setupSkillLearnListener(room: Room<unknown, TownStateView>): void {
    room.onMessage(
      MessageType.LEARN_SKILL,
      (result: { success: boolean; skillId: string; book?: Record<string, number> }) => {
        if (result.success && result.book) {
          this.localSkillBook = result.book;
          this.publishSkillBook();
          // SP spend can change derived stats / AP context — refresh the stat panel.
          if (this.statPanelOpen) this.publishCharacter();
        }
      },
    );
    room.onMessage(MessageType.SKILL_BOOK, (result: { book: Record<string, number> }) => {
      this.localSkillBook = result.book ?? {};
      this.publishSkillBook();
    });
  }

  // ─── Layout (right/bottom anchoring on resize) ───────────────────────────────────────────────
  private layout(): void {
    const sw = this.scale.width;
    const sh = this.scale.height;

    // The bottom status bar, quickslot strip, minimap, and quest tracker are now
    // React HUD widgets (src/ui/HUD.tsx) — only the invisible quickslot hit-zones
    // and the remaining Phaser chrome are positioned here.
    this.positionQuickslots();

    // Mute toggle (top-right, just below the mesos counter).
    this.muteBtn.setPosition(sw - 24, MESOS_Y + 32);

    // Mesos counter (top-right).
    this.positionMesos();

    // Status effects, stat, equipment, and skill-tree panels are React overlays
    // (self-positioned via CSS).

    // Quest log panel is a React overlay (self-positioned via CSS).

    // Hint line (top-left, just below the React minimap — away from the bottom HUD widgets).
    this.hintText.setText(
      "Arrows/WASD move · Up/Down climb · Alt jump · SPACE attack · ENTER talk · Q quests · I inventory · S stats · E equip · K skills · G guild · C cube · U forge · M market · W map · P cash shop",
    );
    this.hintText.setPosition(12, MINIMAP_Y + MINIMAP_H + 28);

    // Cube panel (centred).
    this.cubePanelContainer.setPosition(sw / 2 - CUBE_PANEL_W / 2, sh / 2 - 140);
    // Upgrade panel (centred).
    this.upgradePanelContainer.setPosition(sw / 2 - UPGRADE_PANEL_W / 2, sh / 2 - 140);
    // Party / guild / friends panels are React overlays (self-positioned via CSS).
  }

  /** Right-align the mesos counter to the screen edge and fit its backing pill around coin + text. */
  private positionMesos(): void {
    const right = this.scale.width - 12;
    this.mesosText.setPosition(right - 6, MESOS_Y);
    const coinX = this.mesosText.x - this.mesosText.width - 12;
    this.coin.setPosition(coinX, MESOS_Y);

    const leftX = coinX - 12;
    const w = right + 2 - leftX;
    this.mesosBg
      .clear()
      .fillStyle(PALETTE.panelFill, 0.82)
      .fillRoundedRect(leftX, MESOS_Y - 16, w, 32, 9)
      .lineStyle(1, PALETTE.panelStroke, 0.9)
      .strokeRoundedRect(leftX, MESOS_Y - 16, w, 32, 9);
  }

  // ─── Minimap ─────────────────────────────────────────────────────────────────────────────────
  /** Resolve the current map from the registry (set by MapScene). Drives the React minimap snapshot. */
  private resolveCurrentMap(): GameMap {
    const mapId = (this.registry.get("mapId") as string) || this.currentMapId;
    this.currentMapId = mapId;
    this.discoveredMaps.add(mapId);
    return getMap(mapId) ?? MEADOWFIELD;
  }

  // ─── World map overlay (toggled with W) ───────────────────────────────────────────────────────

  private buildWorldMap(): void {
    /* React overlay — no Phaser objects needed. */
  }

  /** Compute and push the world map snapshot to the React overlay. */
  private publishWorldMapSnapshot(): void {
    const currentId = this.currentMapId;
    const p = this.localPlayer;
    const playerLevel = p?.level ?? 1;

    // Build adjacency from portal links.
    const currentMapDef = MAPS[currentId];
    const outgoingPortals = currentMapDef?.portals ?? [];
    const connectedFromCurrent = new Map<string, Portal>();
    for (const portal of outgoingPortals) {
      connectedFromCurrent.set(portal.toMapId, portal);
    }

    // Build discovered maps set (track visited).
    this.discoveredMaps.add(currentId);

    // Region membership map.
    const REGION_MAP: Record<string, string> = {};
    const dawnIds = ["dawn_isle"];
    const heartlandIds = [
      "heartland_harbor",
      "harbor_docks",
      "crossway",
      "meadowfield",
      "sylvanreach",
      "sylvanreach_canopy",
      "sylvanreach_roots",
      "craghold",
      "craghold_cliffs",
      "craghold_quarry",
      "dusk_ward",
      "dusk_ward_subway",
      "dusk_ward_backalley",
      "dusk_subway_pq_staging",
      "dusk_subway_pq_stage1",
      "dusk_subway_pq_stage2",
      "dusk_subway_pq_stage3",
      "dusk_subway_pq_stage4",
      "mirefen",
      "mirefen_ruins",
      "free_market",
    ];
    const farReachesIds = [
      "skyhaven",
      "skyhaven_driftpeaks",
      "frosthold",
      "frosthold_slopes",
      "frosthold_icecave",
      "tideways",
      "tideways_reef",
      "tideways_abyss",
      "drakemoor",
      "drakemoor_jungle_floor",
      "drakemoor_dragon_abyss",
    ];
    for (const id of dawnIds) REGION_MAP[id] = "dawn_isle";
    for (const id of heartlandIds) REGION_MAP[id] = "heartland";
    for (const id of farReachesIds) REGION_MAP[id] = "far_reaches";

    // Build nodes.
    const nodes = Object.entries(MAPS).map(([id, mapDef]) => {
      const conn = connectedFromCurrent.get(id);
      const isCurrent = id === currentId;
      const discovered = this.discoveredMaps.has(id);
      const region = REGION_MAP[id] ?? "far_reaches";

      let isConnected = false;
      let comingSoon = false;
      let requiresLevel = 0;
      let meetsLevel = true;
      let clickable = false;

      if (conn) {
        isConnected = true;
        comingSoon = conn.comingSoon ?? false;
        requiresLevel = conn.requiresLevel ?? 0;
        meetsLevel = !requiresLevel || playerLevel >= requiresLevel;
        clickable = !comingSoon && meetsLevel;
      }

      const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
      let playerCount = 0;
      if (isCurrent && room) {
        room.state.players.forEach(() => {
          playerCount++;
        });
      }

      return {
        id,
        name: mapDef.name,
        region,
        isCurrent,
        isConnected,
        comingSoon,
        requiresLevel,
        meetsLevel,
        discovered,
        playerCount,
        clickable,
      };
    });

    // Build links.
    const linkSet = new Set<string>();
    const links: { fromId: string; toId: string; isFromCurrent: boolean; comingSoon: boolean }[] =
      [];
    for (const [id, m] of Object.entries(MAPS)) {
      for (const pt of m.portals) {
        const key = [id, pt.toMapId].sort().join("|");
        if (linkSet.has(key)) continue;
        linkSet.add(key);
        links.push({
          fromId: id,
          toId: pt.toMapId,
          isFromCurrent: id === currentId || pt.toMapId === currentId,
          comingSoon: pt.comingSoon ?? false,
        });
      }
    }

    // Region definitions.
    const regions = [
      {
        key: "dawn_isle",
        label: "Dawn Isle",
        levelBand: "Lv 1–10",
        gradient: "linear-gradient(135deg, #2d5a27, #6ab856)",
        mapIds: dawnIds,
      },
      {
        key: "heartland",
        label: "The Heartland",
        levelBand: "Lv 10–30",
        gradient: "linear-gradient(135deg, #1e3a5f, #4a8fc4)",
        mapIds: heartlandIds,
      },
      {
        key: "far_reaches",
        label: "Far Reaches",
        levelBand: "Lv 30–120+",
        gradient: "linear-gradient(135deg, #3b1a5e, #9b6dd7)",
        mapIds: farReachesIds,
      },
    ];

    uiStore.getState().setWorldMap({
      currentMapId: currentId,
      nodes,
      links,
      regions,
      playerLevel,
      discoveredMaps: [...this.discoveredMaps],
    });
  }

  // (old computeWorldMapLayout removed — layout is handled by the React WorldMapPanel)

  private setupWorldMapToggle(): void {
    this.input.keyboard?.on("keydown-W", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      getAudioManager().playSfx("button_click");
      const next = !uiStore.getState().worldMap.open;
      uiStore.getState().setWorldMapOpen(next);
      if (next) this.publishWorldMapSnapshot();
    });
    // ESC is handled by the React WorldMapPanel itself.
  }

  /** Float a short system message above the character (portal-blocked style). */
  private showFloatMessage(text: string): void {
    const p = this.localPlayer;
    if (!p) return;
    // Reuse the same float-text pattern as the portal-blocked handler in MapScene.
    // We just create a temporary text that fades out.
    const txt = this.add
      .text(p.x, p.y - 60, text, {
        fontFamily: FONT,
        fontSize: "13px",
        color: "#f6c177",
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setDepth(8000);
    this.tweens.add({
      targets: txt,
      alpha: 0,
      y: txt.y - 30,
      duration: 2000,
      ease: "Cubic.easeOut",
      onComplete: () => txt.destroy(),
    });
  }

  // ─── Low-level builders ──────────────────────────────────────────────────────────────────────

  /** (Bottom status-bar helpers removed — the bars are now React: src/ui/hud/StatusBars.tsx.) */

  // ─── Quickslot Hotbar ────────────────────────────────────────────────────────

  /**
   * Create the quickslot container of invisible hit-zones (called once in create).
   * The bar itself renders in React (src/ui/hud/SkillBar.tsx); these transparent
   * zones only serve as the skill-tree drag-to-assign drop target and as a
   * right-click-to-clear surface, overlaid on the React bar's slots via layout().
   */
  private buildQuickslots(): void {
    this.qsContainer = this.add.container(0, 0);
    this.qsContainer.setDepth(500);

    for (let i = 0; i < QS_COUNT; i++) {
      const sx = i * (QS_SIZE + QS_GAP) + QS_SIZE / 2;
      const hitZone = this.add
        .rectangle(sx, QS_SIZE / 2, QS_SIZE, QS_SIZE)
        .setOrigin(0.5)
        .setInteractive()
        .setAlpha(0.001);
      const slotIdx = i;
      hitZone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (pointer.rightButtonDown()) {
          // Right-click: clear slot.
          this.quickslots[slotIdx] = null;
          this.publishHudSkills();
          this.persistQuickslots();
        }
      });
      this.qsContainer.add(hitZone);
    }
  }

  /** Build the mute toggle button (speaker icon) placed at the far-right of the bottom bar. */
  private buildMuteButton(): void {
    const bg = this.add.graphics();
    const label = this.add
      .text(0, 0, "🔊", {
        fontFamily: FONT,
        fontSize: "14px",
        color: TEXT.bright,
      })
      .setOrigin(0.5);

    const MUTE_SIZE = 28;
    this.muteBtn = this.add.container(0, 0, [bg, label]);
    this.muteBtn.setSize(MUTE_SIZE, MUTE_SIZE);
    this.muteBtn.setInteractive({ cursor: "pointer" });
    this.muteBtn.setDepth(500);
    this.muteBtnLabel = label;

    const drawNormal = () => {
      bg.clear();
      bg.fillStyle(PALETTE.panelFill, 0.85);
      bg.fillRoundedRect(-MUTE_SIZE / 2, -MUTE_SIZE / 2, MUTE_SIZE, MUTE_SIZE, 5);
      bg.lineStyle(1, PALETTE.panelStroke, 0.8);
      bg.strokeRoundedRect(-MUTE_SIZE / 2, -MUTE_SIZE / 2, MUTE_SIZE, MUTE_SIZE, 5);
    };
    const drawHover = () => {
      bg.clear();
      bg.fillStyle(0x3a4862, 1);
      bg.fillRoundedRect(-MUTE_SIZE / 2, -MUTE_SIZE / 2, MUTE_SIZE, MUTE_SIZE, 5);
      bg.lineStyle(1.5, 0x6a8aaa, 1);
      bg.strokeRoundedRect(-MUTE_SIZE / 2, -MUTE_SIZE / 2, MUTE_SIZE, MUTE_SIZE, 5);
    };
    drawNormal();

    this.muteBtn.on("pointerdown", () => {
      const am = getAudioManager();
      const nowMuted = am.toggleMute();
      this.muteBtnLabel.setText(nowMuted ? "🔇" : "🔊");
      getAudioManager().playSfx("button_click");
    });
    this.muteBtn.on("pointerover", drawHover);
    this.muteBtn.on("pointerout", drawNormal);
  }

  /** Position the invisible quickslot hit-zone container to overlay the React bar. */
  private positionQuickslots(): void {
    const sw = this.scale.width;
    const sh = this.scale.height;
    // Mirror the React bar's bottom-right anchor (see src/ui/hud/SkillBar.tsx):
    // container right/bottom margin = QS_MARGIN, inner padding = QS_PAD.
    const x = sw - QS_MARGIN - QS_PAD - QS_SECTION_W;
    const y = sh - QS_MARGIN - QS_PAD - QS_SIZE;
    this.qsContainer.setPosition(x, y);
  }

  /** Set up keyboard input for quickslots — respects current keybindings. */
  private setupQuickslotKeyboard(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    // Listen for raw keydown events and match against bound quickslot keys.
    kb.on("keydown", (event: KeyboardEvent) => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      for (let i = 0; i < 10; i++) {
        const action = `quickslot${i + 1}` as ActionId;
        const bound = keybindings.getActionKey(action);
        if (this.matchKeyToEvent(event, bound)) {
          this.executeQuickslot(i);
          return;
        }
      }
      // Numpad fallback (always bound, not rebindable).
      if (event.code.startsWith("Numpad") && event.code.length === 8) {
        const n = parseInt(event.code.charAt(7), 10);
        if (Number.isFinite(n)) this.executeQuickslot(n);
      }
      // Macro keys (F1-F5 or custom bindings).
      for (let i = 0; i < Math.min(this.macros.length, 5); i++) {
        const action = `macro${i + 1}` as ActionId;
        const bound = keybindings.getActionKey(action);
        if (bound && this.matchKeyToEvent(event, bound)) {
          this.executeMacro(i);
          return;
        }
      }
    });
  }

  /** Match a browser KeyboardEvent to a Phaser KeyCodes name string. */
  private matchKeyToEvent(event: KeyboardEvent, phaserKey: string): boolean {
    const code = event.code;
    // Letter keys: KeyA → "A", etc.
    if (code.startsWith("Key") && code.length === 4) {
      return code.charAt(3) === phaserKey;
    }
    // Digit keys: Digit0 → "ZERO", Digit1 → "ONE", etc.
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
    // Special keys.
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
    };
    return specialMap[code] === phaserKey;
  }

  /** Execute the action for a quickslot. */
  private executeQuickslot(i: number): void {
    const entry = this.quickslots[i];
    if (!entry) return;
    // Check if already on cooldown.
    const now = this.time.now;
    const cdEnd = this.qsCooldownEndAt.get(i);
    if (cdEnd !== undefined && now < cdEnd) return;

    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;

    if (entry.type === "skill") {
      room.send(MessageType.SKILL_CAST, { skillId: entry.id });
    } else if (entry.type === "consumable") {
      room.send(MessageType.USE_CONSUMABLE, { defId: entry.id });
    }
  }

  /** Wire server message listeners for skill cast + consumable use results. */
  private setupQuickslotMessageListeners(room: Room<unknown, TownStateView>): void {
    room.onMessage(
      MessageType.SKILL_CAST,
      (payload: { success: boolean; skillId: string; cooldownMs: number; message: string }) => {
        if (payload.success) {
          // Per-skill SFX is played by MapScene's SKILL_VFX handler.
          if (payload.cooldownMs > 0) {
            this.startQuickslotCooldown(payload.skillId, "skill", payload.cooldownMs);
          }
        }
        // Republish the skill bar (MP changed).
        this.publishHudSkills();
      },
    );

    room.onMessage(
      MessageType.USE_CONSUMABLE,
      (payload: { success: boolean; defId: string; cooldownMs: number; message: string }) => {
        if (payload.success && payload.cooldownMs > 0) {
          this.startQuickslotCooldown(payload.defId, "consumable", payload.cooldownMs);
        }
        // Republish the skill bar (inventory changed).
        this.publishHudSkills();
      },
    );

    room.onMessage(
      MessageType.QUICKSLOT_LAYOUT,
      (payload: { slots: (QuickSlotEntry | null)[] }) => {
        if (payload.slots) {
          this.quickslots = payload.slots;
          while (this.quickslots.length < QS_COUNT) this.quickslots.push(null);
          this.publishHudSkills();
        }
      },
    );

    room.onMessage(
      MessageType.AUTO_POT_SYNC,
      (payload: {
        config: {
          hpEnabled: boolean;
          hpThreshold: number;
          mpEnabled: boolean;
          mpThreshold: number;
          hpPotionId: string;
          mpPotionId: string;
        };
      }) => {
        if (payload?.config) {
          this.autoPotConfig = payload.config;
        }
      },
    );

    room.onMessage(
      MessageType.MACRO_LAYOUT,
      (payload: {
        macros: {
          id: string;
          name: string;
          steps: { type: "skill" | "consumable"; id: string }[];
        }[];
      }) => {
        if (payload?.macros) {
          this.macros = payload.macros;
        }
      },
    );
  }

  /** Start a cooldown sweep animation for a quickslot. */
  private startQuickslotCooldown(
    id: string,
    type: "skill" | "consumable",
    durationMs: number,
  ): void {
    const now = this.time.now;
    const endAt = now + durationMs;
    for (let i = 0; i < QS_COUNT; i++) {
      const entry = this.quickslots[i];
      if (entry && entry.type === type && entry.id === id) {
        this.qsCooldownEndAt.set(i, endAt);
      }
    }
  }

  /** Persist the current quickslot layout to localStorage + server. */
  private persistQuickslots(): void {
    const charId = getCharId();
    if (charId) setQuickslots(charId, this.quickslots);
    // Also send to server for cross-device persistence.
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.QUICKSLOT_LAYOUT, { slots: this.quickslots });
  }

  /** Bake a small gold coin glyph used by the mesos counter (idempotent across HMR reloads). */
  private ensureCoinTexture(): void {
    const key = "ui_coin";
    if (this.textures.exists(key)) return;
    const d = 16;
    const g = this.make.graphics();
    g.fillStyle(PALETTE.coinRim, 1).fillCircle(d / 2, d / 2, d / 2 - 1);
    g.fillStyle(PALETTE.coinBody, 1).fillCircle(d / 2, d / 2, d / 2 - 2.5);
    g.fillStyle(PALETTE.coinShine, 0.9).fillCircle(d / 2 - 2, d / 2 - 2, 2);
    g.lineStyle(1, PALETTE.coinRim, 0.8).strokeCircle(d / 2, d / 2, d / 2 - 4);
    g.generateTexture(key, d, d);
    g.destroy();
  }

  // ─── Cube (potential reroll) panel ──────────────────────────────────────────────────────────────

  private buildCubePanel(): void {
    this.cubePanelBg = this.add.graphics();
    this.cubePanelContainer = this.add.container(0, 0, [this.cubePanelBg]);
    this.cubePanelContainer.setDepth(1000).setVisible(false);
  }

  private setupCubePanelToggle(): void {
    this.input.keyboard?.on("keydown-C", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      getAudioManager().playSfx("button_click");
      this.cubePanelOpen = !this.cubePanelOpen;
      this.cubePanelContainer.setVisible(this.cubePanelOpen);
      if (this.cubePanelOpen) this.renderCubePanel();
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.cubePanelOpen && !this.chatFocused) {
        this.cubePanelOpen = false;
        this.cubePanelContainer.setVisible(false);
        this.cubeLastResult = null;
      }
    });
  }

  private renderCubePanel(): void {
    for (const el of this.cubePanelElements) el.destroy();
    this.cubePanelElements.length = 0;

    const p = this.localPlayer;
    if (!p) {
      this.drawCubePanelBackground(CUBE_PANEL_PAD * 2 + CUBE_PANEL_HEADER_H);
      return;
    }

    let y = CUBE_PANEL_PAD;

    // ── Title ──
    const title = this.add.text(CUBE_PANEL_PAD, y, "Potential Cube", {
      fontFamily: FONT,
      fontSize: "14px",
      color: TEXT.level,
      fontStyle: "bold",
    });
    this.cubePanelContainer.add(title);
    this.cubePanelElements.push(title);

    const closeHint = this.add
      .text(CUBE_PANEL_W - CUBE_PANEL_PAD, y, "[ C ]", {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.dim,
      })
      .setOrigin(1, 0);
    this.cubePanelContainer.add(closeHint);
    this.cubePanelElements.push(closeHint);

    y += CUBE_PANEL_HEADER_H;
    y = this.addPanelDivider(
      y,
      CUBE_PANEL_W,
      CUBE_PANEL_PAD,
      this.cubePanelContainer,
      this.cubePanelElements,
    );

    // ── PUBLIC ODDS TABLE (the provably fair selling point) ──
    const oddsHeader = this.add.text(CUBE_PANEL_PAD, y, "Public Drop Table", {
      fontFamily: FONT,
      fontSize: "12px",
      color: TEXT.bright,
      fontStyle: "bold",
    });
    this.cubePanelContainer.add(oddsHeader);
    this.cubePanelElements.push(oddsHeader);
    y += 18;

    const fairNote = this.add.text(
      CUBE_PANEL_PAD,
      y,
      "Provably fair \u2014 identical odds to all drops",
      {
        fontFamily: FONT,
        fontSize: "10px",
        color: TEXT.dim,
      },
    );
    this.cubePanelContainer.add(fairNote);
    this.cubePanelElements.push(fairNote);
    y += 18;

    const odds = potentialOdds();
    for (const tier of POTENTIAL_TIERS) {
      const pct = odds[tier.tier] * 100;
      const pctStr = pct >= 10 ? pct.toFixed(2) : pct >= 1 ? pct.toFixed(2) : pct.toFixed(3);

      const lbl = this.add.text(CUBE_PANEL_PAD, y + 1, tier.label, {
        fontFamily: FONT,
        fontSize: "11px",
        color: tier.color,
      });
      this.cubePanelContainer.add(lbl);
      this.cubePanelElements.push(lbl);

      const barBg = this.add.graphics();
      barBg.fillStyle(PALETTE.barTrack, 1);
      barBg.fillRoundedRect(CUBE_PANEL_PAD + 72, y, CUBE_ODDS_BAR_MAX, 14, 3);
      this.cubePanelContainer.add(barBg);
      this.cubePanelElements.push(barBg);

      const barW = Math.max(4, (tier.weight / 1000) * CUBE_ODDS_BAR_MAX);
      const barFill = this.add.graphics();
      barFill.fillStyle(this.cssInt(tier.color), 0.85);
      barFill.fillRoundedRect(CUBE_PANEL_PAD + 72, y, barW, 14, 3);
      this.cubePanelContainer.add(barFill);
      this.cubePanelElements.push(barFill);

      const pctText = this.add.text(
        CUBE_PANEL_PAD + 72 + CUBE_ODDS_BAR_MAX + 8,
        y + 1,
        `${pctStr}%`,
        {
          fontFamily: FONT,
          fontSize: "11px",
          color: TEXT.bright,
        },
      );
      this.cubePanelContainer.add(pctText);
      this.cubePanelElements.push(pctText);

      const linesText = this.add
        .text(
          CUBE_PANEL_W - CUBE_PANEL_PAD,
          y + 1,
          `${tier.lines} line${tier.lines > 1 ? "s" : ""}`,
          {
            fontFamily: FONT,
            fontSize: "10px",
            color: TEXT.dim,
          },
        )
        .setOrigin(1, 0);
      this.cubePanelContainer.add(linesText);
      this.cubePanelElements.push(linesText);

      y += 20;
    }

    y += 4;
    y = this.addPanelDivider(
      y,
      CUBE_PANEL_W,
      CUBE_PANEL_PAD,
      this.cubePanelContainer,
      this.cubePanelElements,
    );

    // ── Cost ──
    const costText = this.add.text(CUBE_PANEL_PAD, y, `Reroll cost: ${CUBE_REROLL_COST} Mesos`, {
      fontFamily: FONT,
      fontSize: "12px",
      color: TEXT.mesos,
    });
    this.cubePanelContainer.add(costText);
    this.cubePanelElements.push(costText);
    y += 20;

    y = this.addPanelDivider(
      y,
      CUBE_PANEL_W,
      CUBE_PANEL_PAD,
      this.cubePanelContainer,
      this.cubePanelElements,
    );

    // ── Item selector ──
    const selHeader = this.add.text(CUBE_PANEL_PAD, y, "Select an item:", {
      fontFamily: FONT,
      fontSize: "11px",
      color: TEXT.dim,
      fontStyle: "bold",
    });
    this.cubePanelContainer.add(selHeader);
    this.cubePanelElements.push(selHeader);
    y += 18;

    const equippedUids = new Set<string>();
    p.equipped.forEach((uid) => equippedUids.add(uid));

    const bagged: InventoryItemView[] = [];
    p.inventory.forEach((item, uid) => {
      if (equippedUids.has(uid)) return;
      if (getItemDef(item.defId)) bagged.push(item);
    });

    // Validate selection.
    if (this.cubeSelectedItemUid && !bagged.find((i) => i.uid === this.cubeSelectedItemUid)) {
      this.cubeSelectedItemUid = null;
      this.cubeLastResult = null;
    }

    if (bagged.length === 0) {
      const empty = this.add.text(CUBE_PANEL_PAD, y, "No items in bag", {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.dim,
      });
      this.cubePanelContainer.add(empty);
      this.cubePanelElements.push(empty);
      y += 20;
    } else {
      for (const item of bagged) {
        const selected = item.uid === this.cubeSelectedItemUid;
        const tierInfo = getPotentialTierInfo(item.potentialTier as PotentialTier);
        const rankInfo = getBaseRankInfo(item.baseRank as BaseRank);
        const name = getItemDef(item.defId)?.name ?? item.defId;

        if (selected) {
          const rowBg = this.add.graphics();
          rowBg.fillStyle(0x2a3852, 0.6);
          rowBg.fillRoundedRect(CUBE_PANEL_PAD, y, CUBE_PANEL_W - CUBE_PANEL_PAD * 2, 22, 4);
          this.cubePanelContainer.add(rowBg);
          this.cubePanelElements.push(rowBg);
        }

        const swatch = this.add.graphics();
        swatch.fillStyle(this.cssInt(tierInfo.color), 1);
        swatch.fillRoundedRect(CUBE_PANEL_PAD + 4, y + 4, 14, 14, 3);
        this.cubePanelContainer.add(swatch);
        this.cubePanelElements.push(swatch);

        const nameText = this.add
          .text(CUBE_PANEL_PAD + 24, y + 11, name, {
            fontFamily: FONT,
            fontSize: "11px",
            color: rankInfo.color,
            fontStyle: selected ? "bold" : undefined,
          })
          .setOrigin(0, 0.5);
        this.cubePanelContainer.add(nameText);
        this.cubePanelElements.push(nameText);

        const tierLbl = this.add
          .text(CUBE_PANEL_W - CUBE_PANEL_PAD - 4, y + 11, tierInfo.label, {
            fontFamily: FONT,
            fontSize: "10px",
            color: tierInfo.color,
          })
          .setOrigin(1, 0.5);
        this.cubePanelContainer.add(tierLbl);
        this.cubePanelElements.push(tierLbl);

        const hitZone = this.add
          .rectangle(CUBE_PANEL_W / 2, y + 11, CUBE_PANEL_W - CUBE_PANEL_PAD * 2, 22)
          .setOrigin(0.5, 0.5)
          .setInteractive()
          .setAlpha(0.001);
        const uid = item.uid;
        hitZone.on("pointerdown", () => {
          this.cubeSelectedItemUid = uid;
          this.cubeLastResult = null;
          this.renderCubePanel();
        });
        this.cubePanelContainer.add(hitZone);
        this.cubePanelElements.push(hitZone);

        y += 24;
      }
    }

    // ── Selected item details ──
    if (this.cubeSelectedItemUid) {
      const item = bagged.find((i) => i.uid === this.cubeSelectedItemUid);
      if (item) {
        y += 4;
        y = this.addPanelDivider(
          y,
          CUBE_PANEL_W,
          CUBE_PANEL_PAD,
          this.cubePanelContainer,
          this.cubePanelElements,
        );

        const tierInfo = getPotentialTierInfo(item.potentialTier as PotentialTier);
        const curLabel = this.add.text(CUBE_PANEL_PAD, y, "Current Potential:", {
          fontFamily: FONT,
          fontSize: "11px",
          color: TEXT.dim,
          fontStyle: "bold",
        });
        this.cubePanelContainer.add(curLabel);
        this.cubePanelElements.push(curLabel);
        y += 16;

        let potLines: PotentialLine[] = [];
        try {
          potLines = JSON.parse(item.potentialLines) as PotentialLine[];
        } catch {
          /* empty */
        }

        if (potLines.length > 0) {
          for (const line of potLines) {
            const lt = this.add.text(CUBE_PANEL_PAD + 8, y, `+${line.percent}% ${line.stat}`, {
              fontFamily: FONT,
              fontSize: "11px",
              color: tierInfo.color,
            });
            this.cubePanelContainer.add(lt);
            this.cubePanelElements.push(lt);
            y += 16;
          }
        } else {
          const noLines = this.add.text(CUBE_PANEL_PAD + 8, y, "No potential lines", {
            fontFamily: FONT,
            fontSize: "11px",
            color: TEXT.dim,
          });
          this.cubePanelContainer.add(noLines);
          this.cubePanelElements.push(noLines);
          y += 16;
        }

        y += 4;

        // ── Previous vs New comparison (after a reroll) ──
        if (this.cubeLastResult && this.cubeLastResult.uid === item.uid) {
          const res = this.cubeLastResult;
          const prevTierLabel = res.prevTier ?? "?";
          const newTierLabel = res.newTier ?? "?";
          const newTierInfo = getPotentialTierInfo((res.newTier ?? "RARE") as PotentialTier);

          y = this.addPanelDivider(
            y,
            CUBE_PANEL_W,
            CUBE_PANEL_PAD,
            this.cubePanelContainer,
            this.cubePanelElements,
          );

          const cmpHeader = this.add.text(CUBE_PANEL_PAD, y, "Result:", {
            fontFamily: FONT,
            fontSize: "11px",
            color: TEXT.level,
            fontStyle: "bold",
          });
          this.cubePanelContainer.add(cmpHeader);
          this.cubePanelElements.push(cmpHeader);
          y += 16;

          // Previous
          const prevLabel = this.add.text(CUBE_PANEL_PAD + 4, y, `Was: ${prevTierLabel}`, {
            fontFamily: FONT,
            fontSize: "11px",
            color: TEXT.dim,
          });
          this.cubePanelContainer.add(prevLabel);
          this.cubePanelElements.push(prevLabel);
          if (res.prevLines && res.prevLines.length > 0) {
            const prevLineTexts = res.prevLines.map((l) => `+${l.percent}% ${l.stat}`).join(", ");
            const prevLineLabel = this.add.text(CUBE_PANEL_PAD + 4, y + 14, prevLineTexts, {
              fontFamily: FONT,
              fontSize: "10px",
              color: TEXT.dim,
            });
            this.cubePanelContainer.add(prevLineLabel);
            this.cubePanelElements.push(prevLineLabel);
          }
          y += res.prevLines && res.prevLines.length > 0 ? 30 : 16;

          // New
          const newLabel = this.add.text(CUBE_PANEL_PAD + 4, y, `Now: ${newTierLabel}`, {
            fontFamily: FONT,
            fontSize: "12px",
            color: newTierInfo.color,
            fontStyle: "bold",
          });
          this.cubePanelContainer.add(newLabel);
          this.cubePanelElements.push(newLabel);
          y += 16;
          if (res.newLines && res.newLines.length > 0) {
            for (const nl of res.newLines) {
              const nlText = this.add.text(CUBE_PANEL_PAD + 12, y, `+${nl.percent}% ${nl.stat}`, {
                fontFamily: FONT,
                fontSize: "11px",
                color: newTierInfo.color,
              });
              this.cubePanelContainer.add(nlText);
              this.cubePanelElements.push(nlText);
              y += 14;
            }
          }
          y += 6;
        }

        // Reroll button
        const canAfford = p.mesos >= CUBE_REROLL_COST;
        if (canAfford) {
          const btn = this.createPanelButton(
            CUBE_PANEL_PAD,
            y,
            CUBE_PANEL_W - CUBE_PANEL_PAD * 2,
            28,
            "Reroll Potential",
            () => this.sendCubeReroll(item.uid),
          );
          this.cubePanelContainer.add(btn);
          this.cubePanelElements.push(btn);
          y += 34;
        } else {
          const cant = this.add.text(
            CUBE_PANEL_PAD,
            y,
            `Need ${CUBE_REROLL_COST} Mesos (have ${p.mesos.toLocaleString()})`,
            {
              fontFamily: FONT,
              fontSize: "11px",
              color: "#ef4444",
            },
          );
          this.cubePanelContainer.add(cant);
          this.cubePanelElements.push(cant);
          y += 20;
        }
      }
    }

    this.drawCubePanelBackground(y);
  }

  private drawCubePanelBackground(height: number): void {
    const h = Math.max(height + CUBE_PANEL_PAD, CUBE_PANEL_HEADER_H + CUBE_PANEL_PAD);
    this.cubePanelBg
      .clear()
      .fillStyle(PALETTE.panelFill, 0.92)
      .fillRoundedRect(0, 0, CUBE_PANEL_W, h, 12)
      .lineStyle(1, PALETTE.panelStroke, 1)
      .strokeRoundedRect(0, 0, CUBE_PANEL_W, h, 12)
      .lineStyle(1, PALETTE.panelStroke, 0.6)
      .lineBetween(
        CUBE_PANEL_PAD,
        CUBE_PANEL_HEADER_H,
        CUBE_PANEL_W - CUBE_PANEL_PAD,
        CUBE_PANEL_HEADER_H,
      );
  }

  private setupCubeMessageListener(room: Room<unknown, TownStateView>): void {
    room.onMessage(MessageType.CUBE_REROLL, (payload: CubeRerollResultPayload) => {
      if (payload.success) {
        this.showCubeResult(payload);
      }
    });
  }

  private sendCubeReroll(uid: string): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.CUBE_REROLL, { uid });
  }

  private showCubeResult(payload: CubeRerollResultPayload): void {
    // Store the result for the prev/new comparison display.
    this.cubeLastResult = payload;

    const sw = this.scale.width;
    const sh = this.scale.height;
    const newTier = payload.newTier ?? "?";
    const floatText = this.add
      .text(sw / 2, sh / 2, `\u2212${CUBE_REROLL_COST} Mesos  \u2192  ${newTier}`, {
        fontFamily: FONT,
        fontSize: "14px",
        color: "#ef4444",
        fontStyle: "bold",
        stroke: TEXT.stroke,
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(9500);
    this.tweens.add({
      targets: floatText,
      y: floatText.y - 40,
      alpha: 0,
      duration: 1200,
      ease: "Quad.easeOut",
      onComplete: () => floatText.destroy(),
    });

    if (this.cubePanelOpen) this.renderCubePanel();
  }

  // ─── Upgrade (base-rank) panel ─────────────────────────────────────────────────────────────────

  private buildUpgradePanel(): void {
    this.upgradePanelBg = this.add.graphics();
    this.upgradePanelContainer = this.add.container(0, 0, [this.upgradePanelBg]);
    this.upgradePanelContainer.setDepth(1000).setVisible(false);
  }

  private setupUpgradePanelToggle(): void {
    this.input.keyboard?.on("keydown-U", () => {
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      getAudioManager().playSfx("button_click");
      this.upgradePanelOpen = !this.upgradePanelOpen;
      this.upgradePanelContainer.setVisible(this.upgradePanelOpen);
      if (this.upgradePanelOpen) this.renderUpgradePanel();
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.upgradePanelOpen && !this.chatFocused) {
        this.upgradePanelOpen = false;
        this.upgradePanelContainer.setVisible(false);
      }
    });
  }

  private renderUpgradePanel(): void {
    for (const el of this.upgradePanelElements) el.destroy();
    this.upgradePanelElements.length = 0;

    const p = this.localPlayer;
    if (!p) {
      this.drawUpgradePanelBackground(UPGRADE_PANEL_PAD * 2 + UPGRADE_PANEL_HEADER_H);
      return;
    }

    let y = UPGRADE_PANEL_PAD;

    // ── Title ──
    const title = this.add.text(UPGRADE_PANEL_PAD, y, "Star Forge", {
      fontFamily: FONT,
      fontSize: "14px",
      color: TEXT.level,
      fontStyle: "bold",
    });
    this.upgradePanelContainer.add(title);
    this.upgradePanelElements.push(title);

    const closeHint = this.add
      .text(UPGRADE_PANEL_W - UPGRADE_PANEL_PAD, y, "[ U ]", {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.dim,
      })
      .setOrigin(1, 0);
    this.upgradePanelContainer.add(closeHint);
    this.upgradePanelElements.push(closeHint);

    y += UPGRADE_PANEL_HEADER_H;
    y = this.addPanelDivider(
      y,
      UPGRADE_PANEL_W,
      UPGRADE_PANEL_PAD,
      this.upgradePanelContainer,
      this.upgradePanelElements,
    );

    // ── Success rate ──
    const rateText = this.add.text(
      UPGRADE_PANEL_PAD,
      y,
      `Success rate: ${Math.round(UPGRADE_BASE_RATE * 100)}%`,
      {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.bright,
        fontStyle: "bold",
      },
    );
    this.upgradePanelContainer.add(rateText);
    this.upgradePanelElements.push(rateText);
    y += 20;

    y = this.addPanelDivider(
      y,
      UPGRADE_PANEL_W,
      UPGRADE_PANEL_PAD,
      this.upgradePanelContainer,
      this.upgradePanelElements,
    );

    // ── Item selector ──
    const selHeader = this.add.text(UPGRADE_PANEL_PAD, y, "Select an item to upgrade:", {
      fontFamily: FONT,
      fontSize: "11px",
      color: TEXT.dim,
      fontStyle: "bold",
    });
    this.upgradePanelContainer.add(selHeader);
    this.upgradePanelElements.push(selHeader);
    y += 18;

    const equippedUids = new Set<string>();
    p.equipped.forEach((uid) => equippedUids.add(uid));

    const bagged: InventoryItemView[] = [];
    p.inventory.forEach((item, uid) => {
      if (equippedUids.has(uid)) return;
      const def = getItemDef(item.defId);
      if (!def) return;
      const next = nextBaseRank(item.baseRank as BaseRank);
      if (next) bagged.push(item); // exclude MYTHIC (next === null)
    });

    // Validate selection.
    if (this.upgradeSelectedItemUid && !bagged.find((i) => i.uid === this.upgradeSelectedItemUid)) {
      this.upgradeSelectedItemUid = null;
    }

    if (bagged.length === 0) {
      const empty = this.add.text(UPGRADE_PANEL_PAD, y, "No upgradeable items in bag", {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.dim,
      });
      this.upgradePanelContainer.add(empty);
      this.upgradePanelElements.push(empty);
      y += 20;
    } else {
      for (const item of bagged) {
        const selected = item.uid === this.upgradeSelectedItemUid;
        const rankInfo = getBaseRankInfo(item.baseRank as BaseRank);
        const name = getItemDef(item.defId)?.name ?? item.defId;
        const next = nextBaseRank(item.baseRank as BaseRank);
        if (!next) continue; // bagged only holds upgradeable items (next !== null)
        const nextInfo = getBaseRankInfo(next);

        if (selected) {
          const rowBg = this.add.graphics();
          rowBg.fillStyle(0x2a3852, 0.6);
          rowBg.fillRoundedRect(
            UPGRADE_PANEL_PAD,
            y,
            UPGRADE_PANEL_W - UPGRADE_PANEL_PAD * 2,
            22,
            4,
          );
          this.upgradePanelContainer.add(rowBg);
          this.upgradePanelElements.push(rowBg);
        }

        const swatch = this.add.graphics();
        swatch.fillStyle(this.cssInt(rankInfo.color), 1);
        swatch.fillRoundedRect(UPGRADE_PANEL_PAD + 4, y + 4, 14, 14, 3);
        this.upgradePanelContainer.add(swatch);
        this.upgradePanelElements.push(swatch);

        const nameText = this.add
          .text(UPGRADE_PANEL_PAD + 24, y + 11, name, {
            fontFamily: FONT,
            fontSize: "11px",
            color: rankInfo.color,
            fontStyle: selected ? "bold" : undefined,
          })
          .setOrigin(0, 0.5);
        this.upgradePanelContainer.add(nameText);
        this.upgradePanelElements.push(nameText);

        const rankLbl = this.add
          .text(
            UPGRADE_PANEL_W - UPGRADE_PANEL_PAD - 4,
            y + 11,
            `${rankInfo.label} \u2192 ${nextInfo.label}`,
            {
              fontFamily: FONT,
              fontSize: "10px",
              color: nextInfo.color,
            },
          )
          .setOrigin(1, 0.5);
        this.upgradePanelContainer.add(rankLbl);
        this.upgradePanelElements.push(rankLbl);

        const hitZone = this.add
          .rectangle(UPGRADE_PANEL_W / 2, y + 11, UPGRADE_PANEL_W - UPGRADE_PANEL_PAD * 2, 22)
          .setOrigin(0.5, 0.5)
          .setInteractive()
          .setAlpha(0.001);
        const uid = item.uid;
        hitZone.on("pointerdown", () => {
          this.upgradeSelectedItemUid = uid;
          this.renderUpgradePanel();
        });
        this.upgradePanelContainer.add(hitZone);
        this.upgradePanelElements.push(hitZone);

        y += 24;
      }
    }

    // ── Selected item details ──
    if (this.upgradeSelectedItemUid) {
      const item = bagged.find((i) => i.uid === this.upgradeSelectedItemUid);
      if (item) {
        y += 4;
        y = this.addPanelDivider(
          y,
          UPGRADE_PANEL_W,
          UPGRADE_PANEL_PAD,
          this.upgradePanelContainer,
          this.upgradePanelElements,
        );

        const curRank = item.baseRank as BaseRank;
        const curInfo = getBaseRankInfo(curRank);
        const nxt = nextBaseRank(curRank);
        // `item` comes from `bagged`, which only holds upgradeable items, so
        // `nxt` is always non-null here; the guard preserves that invariant.
        if (nxt) {
          const nxtInfo = getBaseRankInfo(nxt);

          // Rank progression: Current \u2192 Next
          const rankLine = this.add.text(UPGRADE_PANEL_PAD, y, curInfo.label, {
            fontFamily: FONT,
            fontSize: "13px",
            color: curInfo.color,
            fontStyle: "bold",
          });
          this.upgradePanelContainer.add(rankLine);
          this.upgradePanelElements.push(rankLine);

          const arrow = this.add.text(UPGRADE_PANEL_PAD + rankLine.width + 8, y, "\u2192", {
            fontFamily: FONT,
            fontSize: "13px",
            color: TEXT.dim,
          });
          this.upgradePanelContainer.add(arrow);
          this.upgradePanelElements.push(arrow);

          const nxtLabel = this.add.text(
            UPGRADE_PANEL_PAD + rankLine.width + 28,
            y,
            nxtInfo.label,
            {
              fontFamily: FONT,
              fontSize: "13px",
              color: nxtInfo.color,
              fontStyle: "bold",
            },
          );
          this.upgradePanelContainer.add(nxtLabel);
          this.upgradePanelElements.push(nxtLabel);
          y += 20;

          // Stat multiplier comparison
          const multText = this.add.text(
            UPGRADE_PANEL_PAD,
            y,
            `${curInfo.statMultiplier}\u00d7 base stats \u2192 ${nxtInfo.statMultiplier}\u00d7`,
            {
              fontFamily: FONT,
              fontSize: "11px",
              color: TEXT.bright,
            },
          );
          this.upgradePanelContainer.add(multText);
          this.upgradePanelElements.push(multText);
          y += 18;

          const pctIncrease = Math.round(
            ((nxtInfo.statMultiplier - curInfo.statMultiplier) / curInfo.statMultiplier) * 100,
          );
          const boostText = this.add.text(
            UPGRADE_PANEL_PAD,
            y,
            `+${pctIncrease}% effective stats`,
            {
              fontFamily: FONT,
              fontSize: "11px",
              color: TEXT.level,
            },
          );
          this.upgradePanelContainer.add(boostText);
          this.upgradePanelElements.push(boostText);
          y += 20;

          y = this.addPanelDivider(
            y,
            UPGRADE_PANEL_W,
            UPGRADE_PANEL_PAD,
            this.upgradePanelContainer,
            this.upgradePanelElements,
          );

          // Cost
          const mesosNeeded = upgradeCost(nxt);
          const shardsNeeded = upgradeMaterialCost(nxt);

          let shardsOwned = 0;
          p.inventory.forEach((invItem) => {
            if (invItem.defId === UPGRADE_SHARD_DEF_ID) shardsOwned += invItem.count;
          });

          const costLine1 = this.add.text(
            UPGRADE_PANEL_PAD,
            y,
            `Cost: ${mesosNeeded.toLocaleString()} Mesos`,
            {
              fontFamily: FONT,
              fontSize: "12px",
              color: TEXT.mesos,
            },
          );
          this.upgradePanelContainer.add(costLine1);
          this.upgradePanelElements.push(costLine1);
          y += 18;

          const shardColor = shardsOwned >= shardsNeeded ? TEXT.bright : "#ef4444";
          const costLine2 = this.add.text(
            UPGRADE_PANEL_PAD,
            y,
            `${UPGRADE_SHARD_NAME}: ${shardsOwned} / ${shardsNeeded}`,
            {
              fontFamily: FONT,
              fontSize: "12px",
              color: shardColor,
            },
          );
          this.upgradePanelContainer.add(costLine2);
          this.upgradePanelElements.push(costLine2);
          y += 22;

          // Upgrade button
          const canAfford = p.mesos >= mesosNeeded && shardsOwned >= shardsNeeded;
          if (canAfford) {
            const btn = this.createPanelButton(
              UPGRADE_PANEL_PAD,
              y,
              UPGRADE_PANEL_W - UPGRADE_PANEL_PAD * 2,
              28,
              "Upgrade",
              () => this.sendUpgradeItem(item.uid),
            );
            this.upgradePanelContainer.add(btn);
            this.upgradePanelElements.push(btn);
            y += 34;
          } else {
            const reasons: string[] = [];
            if (p.mesos < mesosNeeded) reasons.push("not enough Mesos");
            if (shardsOwned < shardsNeeded)
              reasons.push(`need ${shardsNeeded - shardsOwned} more ${UPGRADE_SHARD_NAME}`);
            const cant = this.add.text(UPGRADE_PANEL_PAD, y, reasons.join("; "), {
              fontFamily: FONT,
              fontSize: "11px",
              color: "#ef4444",
            });
            this.upgradePanelContainer.add(cant);
            this.upgradePanelElements.push(cant);
            y += 20;
          }
        }
      }
    }

    this.drawUpgradePanelBackground(y);
  }

  private drawUpgradePanelBackground(height: number): void {
    const h = Math.max(height + UPGRADE_PANEL_PAD, UPGRADE_PANEL_HEADER_H + UPGRADE_PANEL_PAD);
    this.upgradePanelBg
      .clear()
      .fillStyle(PALETTE.panelFill, 0.92)
      .fillRoundedRect(0, 0, UPGRADE_PANEL_W, h, 12)
      .lineStyle(1, PALETTE.panelStroke, 1)
      .strokeRoundedRect(0, 0, UPGRADE_PANEL_W, h, 12)
      .lineStyle(1, PALETTE.panelStroke, 0.6)
      .lineBetween(
        UPGRADE_PANEL_PAD,
        UPGRADE_PANEL_HEADER_H,
        UPGRADE_PANEL_W - UPGRADE_PANEL_PAD,
        UPGRADE_PANEL_HEADER_H,
      );
  }

  private setupUpgradeMessageListener(room: Room<unknown, TownStateView>): void {
    room.onMessage(MessageType.UPGRADE_ITEM, (payload: UpgradeItemResultPayload) => {
      if (payload.success) {
        this.showUpgradeResult(payload);
      }
    });
  }

  private sendUpgradeItem(uid: string): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.UPGRADE_ITEM, { uid });
  }

  private showUpgradeResult(payload: UpgradeItemResultPayload): void {
    const sw = this.scale.width;
    const sh = this.scale.height;

    if (payload.downgraded) {
      const failText = this.add
        .text(sw / 2, sh / 2, `Downgraded to ${payload.newRank}`, {
          fontFamily: FONT,
          fontSize: "14px",
          color: "#ef4444",
          fontStyle: "bold",
          stroke: TEXT.stroke,
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(9500);
      this.tweens.add({
        targets: failText,
        y: failText.y - 40,
        alpha: 0,
        duration: 1400,
        ease: "Quad.easeOut",
        onComplete: () => failText.destroy(),
      });
    } else if (payload.prevRank !== payload.newRank) {
      const successText = this.add
        .text(sw / 2, sh / 2, `Success! ${payload.prevRank} \u2192 ${payload.newRank}`, {
          fontFamily: FONT,
          fontSize: "14px",
          color: TEXT.level,
          fontStyle: "bold",
          stroke: TEXT.stroke,
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(9500);
      this.tweens.add({
        targets: successText,
        y: successText.y - 40,
        alpha: 0,
        duration: 1400,
        ease: "Quad.easeOut",
        onComplete: () => successText.destroy(),
      });
    } else {
      const failText = this.add
        .text(sw / 2, sh / 2, "Upgrade failed!", {
          fontFamily: FONT,
          fontSize: "14px",
          color: "#ef4444",
          fontStyle: "bold",
          stroke: TEXT.stroke,
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(9500);
      this.tweens.add({
        targets: failText,
        y: failText.y - 40,
        alpha: 0,
        duration: 1400,
        ease: "Quad.easeOut",
        onComplete: () => failText.destroy(),
      });
    }

    if (this.upgradePanelOpen) this.renderUpgradePanel();
  }

  // ─── Shared panel helpers ───────────────────────────────────────────────────────────────────────

  /** A panel-style button with hover state, used by cube and upgrade panels. */
  private createPanelButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const bg = this.add.graphics();
    const color = 0x2a3852;
    const border = 0x4a6a8a;
    bg.fillStyle(color, 0.9);
    bg.fillRoundedRect(0, 0, w, h, 4);
    bg.lineStyle(1, border, 0.9);
    bg.strokeRoundedRect(0, 0, w, h, 4);

    const text = this.add
      .text(w / 2, h / 2, label, {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.bright,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const container = this.add.container(x, y, [bg, text]);
    container.setSize(w, h);
    container.setInteractive();
    container.on("pointerdown", onClick);
    container.on("pointerover", () => {
      bg.clear();
      bg.fillStyle(0x3a4862, 1);
      bg.fillRoundedRect(0, 0, w, h, 4);
      bg.lineStyle(1.5, 0x6a8aaa, 1);
      bg.strokeRoundedRect(0, 0, w, h, 4);
      text.setColor("#ffffff");
    });
    container.on("pointerout", () => {
      bg.clear();
      bg.fillStyle(color, 0.9);
      bg.fillRoundedRect(0, 0, w, h, 4);
      bg.lineStyle(1, border, 0.9);
      bg.strokeRoundedRect(0, 0, w, h, 4);
      text.setColor(TEXT.bright);
    });
    return container;
  }

  /** Draw a horizontal divider line and return the y below it. */
  private addPanelDivider(
    y: number,
    panelW: number,
    pad: number,
    container: Phaser.GameObjects.Container,
    elements: Phaser.GameObjects.GameObject[],
  ): number {
    const g = this.add.graphics();
    g.lineStyle(1, PALETTE.panelStroke, 0.6);
    g.lineBetween(pad, y, panelW - pad, y);
    container.add(g);
    elements.push(g);
    return y + 8;
  }

  /** Convert a "#rrggbb" CSS color to the integer Graphics fills want. */
  private cssInt(css: string): number {
    return Phaser.Display.Color.HexStringToColor(css).color;
  }

  // ─── Party HUD + party message listeners ────────────────────────────────────────
  private setupPartyListeners(room: Room<unknown, TownStateView>): void {
    room.onMessage(MessageType.PARTY_UPDATE, (payload: PartyUpdatePayload) => {
      this.partyMembers = payload.members;
      this.partyLootRule = payload.lootRule ?? "ffa";
      this.renderPartyHud();
      this.publishParty();
    });

    room.onMessage(MessageType.PARTY_INVITE_RECEIVED, (payload: PartyInviteReceivedPayload) => {
      this.pendingPartyInvite = { fromCharId: payload.fromCharId, fromName: payload.fromName };
      // Surface the accept/decline dialog by opening the panel (publishParty pushes the invite).
      this.setPartyPanelOpen(true);
    });
  }

  private buildPartyHud(): void {
    this.partyHudBg = this.add.graphics();
    this.partyHudHeader = this.add.text(0, 0, "", {
      fontFamily: FONT,
      fontSize: "11px",
      color: TEXT.level,
    });
    this.partyHudContainer = this.add.container(0, 0, [this.partyHudBg, this.partyHudHeader]);
    this.partyHudContainer.setDepth(800).setVisible(false);
  }

  private renderPartyHud(): void {
    for (const el of this.partyHudElements) el.destroy();
    this.partyHudElements.length = 0;

    if (this.partyMembers.length === 0) {
      this.partyHudContainer.setVisible(false);
      return;
    }

    const PAD = 8;
    const ROW_H = 18;
    const BAR_W = 80;
    const BAR_H = 6;
    const HEADER_H = 18;
    const PANEL_W = BAR_W + PAD * 2 + 60; // name + level on right
    const totalH = HEADER_H + this.partyMembers.length * ROW_H + PAD;

    // Background.
    this.partyHudBg.clear();
    this.partyHudBg.fillStyle(PALETTE.panelFill, 0.88);
    this.partyHudBg.fillRoundedRect(0, 0, PANEL_W, totalH, 6);
    this.partyHudBg.lineStyle(1, PALETTE.panelStroke, 0.9);
    this.partyHudBg.strokeRoundedRect(0, 0, PANEL_W, totalH, 6);

    // Header.
    this.partyHudHeader.setText(`Party (${this.partyMembers.length})`);
    this.partyHudHeader.setPosition(PAD, 3);

    let y = HEADER_H;
    for (const m of this.partyMembers) {
      // Name + level.
      const leaderMark = m.leader ? "★ " : "";
      const nameText = this.add.text(PAD, y + 1, `${leaderMark}${m.name}`, {
        fontFamily: FONT,
        fontSize: "10px",
        color: m.leader ? TEXT.level : TEXT.bright,
      });
      this.partyHudContainer.add(nameText);
      this.partyHudElements.push(nameText);

      const lvText = this.add
        .text(PANEL_W - PAD, y + 1, `Lv${m.level}`, {
          fontFamily: FONT,
          fontSize: "10px",
          color: TEXT.dim,
        })
        .setOrigin(1, 0);
      this.partyHudContainer.add(lvText);
      this.partyHudElements.push(lvText);

      // HP bar.
      const hpY = y + 13;
      const hpTrack = this.add.graphics();
      hpTrack.fillStyle(PALETTE.barTrack, 1);
      hpTrack.fillRoundedRect(PAD, hpY, BAR_W, BAR_H, 2);
      this.partyHudContainer.add(hpTrack);
      this.partyHudElements.push(hpTrack);

      const hpRatio = m.maxHp > 0 ? Phaser.Math.Clamp(m.hp / m.maxHp, 0, 1) : 0;
      const hpFill = this.add.graphics();
      hpFill.fillStyle(m.dead ? 0x666666 : PALETTE.hp, 1);
      if (hpRatio > 0) hpFill.fillRoundedRect(PAD, hpY, BAR_W * hpRatio, BAR_H, 2);
      this.partyHudContainer.add(hpFill);
      this.partyHudElements.push(hpFill);

      // MP bar (below HP).
      const mpY = hpY + BAR_H + 1;
      const mpTrack = this.add.graphics();
      mpTrack.fillStyle(PALETTE.barTrack, 1);
      mpTrack.fillRoundedRect(PAD, mpY, BAR_W, BAR_H, 2);
      this.partyHudContainer.add(mpTrack);
      this.partyHudElements.push(mpTrack);

      const mpRatio = m.maxMp > 0 ? Phaser.Math.Clamp(m.mp / m.maxMp, 0, 1) : 0;
      const mpFill = this.add.graphics();
      mpFill.fillStyle(PALETTE.mp, 1);
      if (mpRatio > 0) mpFill.fillRoundedRect(PAD, mpY, BAR_W * mpRatio, BAR_H, 2);
      this.partyHudContainer.add(mpFill);
      this.partyHudElements.push(mpFill);

      y += ROW_H + 4;
    }

    // Position: left side, above chat panel.
    this.partyHudContainer.setPosition(
      12,
      this.scale.height -
        BOTTOM_BAR_H -
        BOTTOM_BAR_MARGIN -
        totalH -
        CHAT_BOTTOM_MARGIN -
        CHAT_INPUT_H -
        CHAT_PANEL_PAD * 2 -
        CHAT_MAX_MSGS * CHAT_MSG_H -
        12,
    );
    this.partyHudContainer.setVisible(true);
  }

  // ─── React-overlay bridge: party / guild / friends ───────────────────────────
  // The party panel (O), guild window (G), and friends list (F) are React
  // overlays (src/ui/{PartyPanel,GuildPanel,FriendsPanel}.tsx). UIScene only
  // publishes plain snapshots into the zustand bridge store and registers the
  // authoritative room.send actions — it never draws these panels.

  /** Push the current party state (members, loot rule, pending invite) to React. */
  private publishParty(): void {
    uiStore.getState().setParty({
      members: this.partyMembers.map((m) => ({
        charId: m.charId,
        sessionId: m.sessionId,
        name: m.name,
        level: m.level,
        hp: m.hp,
        maxHp: m.maxHp,
        mp: m.mp,
        maxMp: m.maxMp,
        dead: m.dead,
        mapId: m.mapId,
        leader: m.leader,
      })),
      lootRule: this.partyLootRule,
      invite: this.pendingPartyInvite
        ? {
            fromCharId: this.pendingPartyInvite.fromCharId,
            fromName: this.pendingPartyInvite.fromName,
          }
        : null,
      selfCharId: getCharId() ?? "",
    });
  }

  /** Push the current guild state to React (emblem color as a CSS hex string). */
  private publishGuild(): void {
    const g = this.guildData;
    const hex = `#${(g.emblem.color >>> 0).toString(16).padStart(6, "0").slice(-6)}`;
    uiStore.getState().setGuild({
      guildId: g.guildId,
      guildName: g.guildName,
      emblem: { color: hex, label: g.emblem.label },
      members: g.members.map((m) => ({
        charId: m.charId,
        name: m.name,
        level: m.level,
        rank: m.rank as "master" | "officer" | "member",
        online: m.online,
      })),
      createdDate: g.createdDate,
      selfCharId: getCharId() ?? "",
    });
  }

  /** Push the current friends list to React. */
  private publishFriends(): void {
    uiStore.getState().setFriends({
      friends: this.friendsData.map((f) => ({
        charId: f.charId,
        name: f.name,
        level: f.level,
        online: f.online,
        mapId: f.mapId,
      })),
    });
  }

  /** Open/close the React party panel, keeping Phaser's flag + store in sync. */
  private setPartyPanelOpen(open: boolean): void {
    this.partyPanelOpen = open;
    uiStore.getState().setPartyOpen(open);
    if (open) this.publishParty();
  }

  /** Open/close the React guild panel, keeping Phaser's flag + store in sync. */
  private setGuildPanelOpen(open: boolean): void {
    this.guildPanelOpen = open;
    uiStore.getState().setGuildOpen(open);
    if (open) this.publishGuild();
  }

  /** Open/close the React friends panel, keeping Phaser's flag + store in sync. */
  private setFriendsPanelOpen(open: boolean): void {
    this.friendsPanelOpen = open;
    uiStore.getState().setFriendsOpen(open);
    if (open) this.publishFriends();
  }

  /** Resolve an online player's session id by (case-insensitive) name. */
  private resolveSessionByName(name: string): string {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return "";
    let sessionId = "";
    room.state.players.forEach((player: PlayerView, sid: string) => {
      if (player.name.toLowerCase() === name.toLowerCase()) sessionId = sid;
    });
    return sessionId;
  }

  /** Register the social action registry (party/guild/friends). Idempotent via UIScene flag. */
  private registerSocialActions(room: Room<unknown, TownStateView>): void {
    uiStore.getState().setPartyActions({
      invite: (name) => {
        const targetName = name.trim();
        if (!targetName) return;
        room.send(MessageType.PARTY_INVITE, { targetName });
      },
      kick: (targetCharId) => room.send(MessageType.PARTY_KICK, { targetCharId }),
      leave: () => room.send(MessageType.PARTY_LEAVE, {}),
      setLootRule: (lootRule) => room.send(MessageType.PARTY_SET_LOOT_RULE, { lootRule }),
      acceptInvite: (fromCharId) => {
        room.send(MessageType.PARTY_ACCEPT, { fromCharId });
        this.pendingPartyInvite = null;
        this.publishParty();
      },
      declineInvite: () => {
        this.pendingPartyInvite = null;
        this.publishParty();
      },
      close: () => this.setPartyPanelOpen(false),
    });

    uiStore.getState().setGuildActions({
      create: (name) => {
        const n = name.trim();
        if (n.length < 2) return;
        room.send(MessageType.GUILD_CREATE, { name: n, color: 0xfacc15 });
      },
      invite: (name) => {
        const targetSessionId = this.resolveSessionByName(name.trim());
        if (targetSessionId) {
          room.send(MessageType.GUILD_INVITE, { targetSessionId });
        } else {
          this.addChatLine("System", `Player "${name}" not found on this map.`, "system");
        }
      },
      kick: (targetCharId) => room.send(MessageType.GUILD_KICK, { targetCharId }),
      setRank: (targetCharId, newRank) =>
        room.send(MessageType.GUILD_RANK, { targetCharId, newRank }),
      leave: () => {
        room.send(MessageType.GUILD_LEAVE, {});
        this.setGuildPanelOpen(false);
      },
      disband: () => {
        room.send(MessageType.GUILD_DISBAND, {});
        this.setGuildPanelOpen(false);
      },
      close: () => this.setGuildPanelOpen(false),
    });

    uiStore.getState().setFriendsActions({
      add: (name) => {
        const targetName = name.trim();
        if (!targetName) return;
        room.send(MessageType.FRIEND_ADD, { targetName });
      },
      remove: (name) => room.send(MessageType.FRIEND_REMOVE, { targetName: name }),
      whisper: (name) => {
        this.setFriendsPanelOpen(false);
        uiStore.getState().requestChatFocus(`/w ${name} `);
      },
      close: () => this.setFriendsPanelOpen(false),
    });
  }

  /** Hotkeys for the React social panels: O = party, G = guild, F = friends. */
  private setupSocialToggles(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    const blocked = () => this.chatFocused || this.registry.get("settingsOpen") === true;

    kb.on("keydown-O", () => {
      if (blocked()) return;
      getAudioManager().playSfx("button_click");
      this.setPartyPanelOpen(!this.partyPanelOpen);
    });
    kb.on("keydown-G", () => {
      if (blocked()) return;
      getAudioManager().playSfx("button_click");
      this.setGuildPanelOpen(!this.guildPanelOpen);
    });
    kb.on("keydown-F", () => {
      if (blocked()) return;
      getAudioManager().playSfx("button_click");
      this.setFriendsPanelOpen(!this.friendsPanelOpen);
    });
    kb.on("keydown-ESC", () => {
      if (this.chatFocused) return;
      if (this.partyPanelOpen) this.setPartyPanelOpen(false);
      if (this.guildPanelOpen) this.setGuildPanelOpen(false);
      if (this.friendsPanelOpen) this.setFriendsPanelOpen(false);
    });
  }

  // ─── Guild message listeners ──────────────────────────────────────────────────
  private setupGuildListeners(room: Room<unknown, TownStateView>): void {
    room.onMessage(MessageType.GUILD_UPDATE, (payload: GuildUpdateView) => {
      this.guildData = payload;
      this.publishGuild();
    });

    // GUILD_CHAT_RELAY is handled in bindChat().

    room.onMessage(MessageType.GUILD_RESULT, (payload: { success: boolean; message: string }) => {
      this.addChatLine("System", payload.message, "guild");
    });
  }

  // ─── Friends / Buddy message listeners ────────────────────────────────────────
  private setupFriendsListeners(room: Room<unknown, TownStateView>): void {
    room.onMessage(MessageType.FRIEND_LIST, (payload: FriendListPayload) => {
      this.friendsData = payload.friends;
      this.publishFriends();
    });
    room.onMessage(MessageType.FRIEND_RESULT, (payload: FriendResultPayload) => {
      this.addChatLine("Friends", payload.message, "system");
    });
    room.onMessage(MessageType.FRIEND_REMOVED, (payload: FriendRemovedPayload) => {
      this.friendsData = this.friendsData.filter((f) => f.charId !== payload.charId);
      this.publishFriends();
      this.addChatLine("Friends", `${payload.name} removed you from their friends list.`, "system");
    });
    room.onMessage(MessageType.ONLINE_STATUS, (payload: OnlineStatusPayload) => {
      for (const u of payload.updates) {
        const existing = this.friendsData.find((f) => f.charId === u.charId);
        if (existing) {
          existing.online = u.online;
          existing.mapId = u.mapId;
        }
      }
      this.publishFriends();
    });
  }

  // ─── Feedback / Bug Report panel ──────────────────────────────────────────────
  private buildFeedbackPanel(): void {
    this.feedbackBg = this.add.graphics();
    this.feedbackContainer = this.add.container(0, 0, [this.feedbackBg]);
    this.feedbackContainer.setDepth(9500).setVisible(false);
  }

  private setupFeedbackToggle(): void {
    const openFeedback = () => {
      if (this.feedbackOpen) return;
      this.closeAllPanels();
      this.feedbackOpen = true;
      this.feedbackInputText = "";
      this.feedbackSelectedCategory = "bug";
      this.renderFeedbackPanel();
      this.feedbackContainer.setVisible(true);
    };

    // Toggle with B key.
    this.input.keyboard?.on("keydown-B", () => {
      if (this.chatFocused) return;
      if (this.feedbackOpen) {
        this.feedbackOpen = false;
        this.feedbackContainer.setVisible(false);
      } else {
        openFeedback();
      }
    });

    // Persistent HUD button (React) dispatches this CustomEvent.
    this._feedbackEventHandler = openFeedback;
    window.addEventListener("open-feedback", this._feedbackEventHandler);
  }

  private renderFeedbackPanel(): void {
    // Destroy previous dynamic children.
    for (const child of this.feedbackContainer.list) {
      if (child !== this.feedbackBg && child !== this.feedbackContainer) {
        child.destroy();
      }
    }
    // Re-add the background.
    this.feedbackContainer.removeAll(false);
    this.feedbackContainer.add(this.feedbackBg);
    this.feedbackCategoryBtns = [];
    this.feedbackCategoryHighlights = [];

    const sw = this.scale.width;
    const sh = this.scale.height;
    const pw = FEEDBACK_PANEL_W;
    const ph = FEEDBACK_PANEL_H;
    const px = (sw - pw) / 2;
    const py = (sh - ph) / 2;

    // Background.
    this.feedbackBg.clear();
    this.feedbackBg.fillStyle(PALETTE.panelFill, 0.95);
    this.feedbackBg.fillRoundedRect(px, py, pw, ph, 8);
    this.feedbackBg.lineStyle(1.5, PALETTE.panelStroke, 1);
    this.feedbackBg.strokeRoundedRect(px, py, pw, ph, 8);

    const pad = FEEDBACK_PANEL_PAD;
    let y = py + pad;

    // Title + close button.
    const title = this.add.text(px + pad, y, "📝  Bug Report / Feedback", {
      fontFamily: FONT,
      fontSize: "14px",
      color: TEXT.name,
      fontStyle: "bold",
    });
    this.feedbackContainer.add(title);

    // Build/protocol version, attached to every report and shown so testers can quote it.
    const versionLabel = this.add.text(px + pad + 140, y + 2, VERSION_LABEL, {
      fontFamily: FONT,
      fontSize: "10px",
      color: TEXT.dim,
    });
    this.feedbackContainer.add(versionLabel);

    const closeBtn = this.add
      .text(px + pw - pad - 20, y, "✕", {
        fontFamily: FONT,
        fontSize: "16px",
        color: TEXT.dim,
      })
      .setInteractive({ cursor: "pointer" });
    closeBtn.on("pointerdown", () => {
      this.feedbackOpen = false;
      this.feedbackContainer.setVisible(false);
      getAudioManager().playSfx("button_click");
    });
    this.feedbackContainer.add(closeBtn);
    y += FEEDBACK_PANEL_HEADER_H;

    // Category buttons.
    const categories: { key: FeedbackCategory; label: string; emoji: string }[] = [
      { key: "bug", label: "Bug", emoji: "🐛" },
      { key: "idea", label: "Idea", emoji: "💡" },
      { key: "balance", label: "Balance", emoji: "⚖️" },
    ];
    let catX = px + pad;
    for (const cat of categories) {
      const isSelected = this.feedbackSelectedCategory === cat.key;
      const catBg = this.add.graphics();
      const highlight = this.add.graphics();
      this.feedbackCategoryBtns.push(catBg as unknown as Phaser.GameObjects.Container);
      this.feedbackCategoryHighlights.push(highlight);

      const drawBtn = (sel: boolean) => {
        catBg.clear();
        highlight.clear();
        const col = sel ? 0x3b82f6 : PALETTE.panelStroke;
        highlight.fillStyle(col, sel ? 0.3 : 0);
        highlight.fillRoundedRect(catX, y, FEEDBACK_CATEGORY_BTN_W, FEEDBACK_CATEGORY_BTN_H, 5);
        highlight.lineStyle(1, col, sel ? 1 : 0.5);
        highlight.strokeRoundedRect(catX, y, FEEDBACK_CATEGORY_BTN_W, FEEDBACK_CATEGORY_BTN_H, 5);
      };
      drawBtn(isSelected);
      this.feedbackContainer.add(catBg);
      this.feedbackContainer.add(highlight);

      const catLabel = this.add
        .text(
          catX + FEEDBACK_CATEGORY_BTN_W / 2,
          y + FEEDBACK_CATEGORY_BTN_H / 2,
          `${cat.emoji} ${cat.label}`,
          {
            fontFamily: FONT,
            fontSize: "12px",
            color: isSelected ? "#93c5fd" : TEXT.dim,
            fontStyle: isSelected ? "bold" : "normal",
          },
        )
        .setOrigin(0.5)
        .setInteractive({ cursor: "pointer" });
      this.feedbackContainer.add(catLabel);

      catLabel.on("pointerdown", () => {
        this.feedbackSelectedCategory = cat.key;
        this.renderFeedbackPanel();
        getAudioManager().playSfx("button_click");
      });

      catX += FEEDBACK_CATEGORY_BTN_W + 8;
    }
    y += FEEDBACK_CATEGORY_BTN_H + 12;

    // Hint text.
    const hint = this.add.text(px + pad, y, "Describe the issue, idea, or balance concern:", {
      fontFamily: FONT,
      fontSize: "11px",
      color: TEXT.hint,
    });
    this.feedbackContainer.add(hint);
    y += 18;

    // Textarea background.
    const taBg = this.add.graphics();
    taBg.fillStyle(0x0a0e16, 0.8);
    taBg.fillRoundedRect(px + pad, y, pw - pad * 2, FEEDBACK_TEXTAREA_H, 4);
    taBg.lineStyle(1, PALETTE.panelStroke, 0.6);
    taBg.strokeRoundedRect(px + pad, y, pw - pad * 2, FEEDBACK_TEXTAREA_H, 4);
    this.feedbackContainer.add(taBg);

    // Text input.
    this.feedbackInput = this.add.text(
      px + pad + 8,
      y + 6,
      this.feedbackInputText || "Click here to type...",
      {
        fontFamily: FONT,
        fontSize: "12px",
        color: this.feedbackInputText ? TEXT.bright : TEXT.dim,
        wordWrap: { width: pw - pad * 2 - 16 },
        lineSpacing: 4,
      },
    );
    this.feedbackContainer.add(this.feedbackInput);

    // Interactive zone for typing.
    const taZone = this.add
      .zone(px + pad, y, pw - pad * 2, FEEDBACK_TEXTAREA_H)
      .setInteractive({ cursor: "text" });
    this.feedbackContainer.add(taZone);

    // Simple single-line text input (Phaser doesn't have native textarea).
    taZone.on("pointerdown", () => {
      this.feedbackInputFocused = true;
    });

    y += FEEDBACK_TEXTAREA_H + 4;

    // Character count.
    const charCount = this.add
      .text(px + pw - pad, y, `${this.feedbackInputText.length}/2000`, {
        fontFamily: FONT,
        fontSize: "10px",
        color: TEXT.dim,
      })
      .setOrigin(1, 0);
    this.feedbackContainer.add(charCount);
    y += 18;

    // Status text (shown after submit).
    this.feedbackStatusText = this.add
      .text(px + pw / 2, y, "", {
        fontFamily: FONT,
        fontSize: "12px",
        color: "#9ad06b",
      })
      .setOrigin(0.5, 0);
    this.feedbackContainer.add(this.feedbackStatusText);
    y += 20;

    // Submit button.
    const submitBg = this.add.graphics();
    submitBg.fillStyle(0x2563eb, 1);
    submitBg.fillRoundedRect(
      px + pw / 2 - FEEDBACK_SUBMIT_BTN_W / 2,
      y,
      FEEDBACK_SUBMIT_BTN_W,
      FEEDBACK_SUBMIT_BTN_H,
      6,
    );
    this.feedbackContainer.add(submitBg);

    const submitLabel = this.add
      .text(px + pw / 2, y + FEEDBACK_SUBMIT_BTN_H / 2, "🚀  Submit Report", {
        fontFamily: FONT,
        fontSize: "13px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.feedbackContainer.add(submitLabel);

    const submitZone = this.add
      .zone(
        px + pw / 2,
        y + FEEDBACK_SUBMIT_BTN_H / 2,
        FEEDBACK_SUBMIT_BTN_W,
        FEEDBACK_SUBMIT_BTN_H,
      )
      .setInteractive({ cursor: "pointer" });
    this.feedbackContainer.add(submitZone);

    submitZone.on("pointerdown", () => {
      this.submitFeedback();
    });
    submitZone.on("pointerover", () => {
      submitBg.clear();
      submitBg.fillStyle(0x3b82f6, 1);
      submitBg.fillRoundedRect(
        px + pw / 2 - FEEDBACK_SUBMIT_BTN_W / 2,
        y,
        FEEDBACK_SUBMIT_BTN_W,
        FEEDBACK_SUBMIT_BTN_H,
        6,
      );
    });
    submitZone.on("pointerout", () => {
      submitBg.clear();
      submitBg.fillStyle(0x2563eb, 1);
      submitBg.fillRoundedRect(
        px + pw / 2 - FEEDBACK_SUBMIT_BTN_W / 2,
        y,
        FEEDBACK_SUBMIT_BTN_W,
        FEEDBACK_SUBMIT_BTN_H,
        6,
      );
    });

    // Keyboard input handler for the feedback text field.
    this.input.keyboard?.off("keydown", this._feedbackKeyHandler);
    this._feedbackKeyHandler = (event: KeyboardEvent) => {
      if (!this.feedbackInputFocused || !this.feedbackOpen) return;
      if (event.key === "Escape") {
        this.feedbackInputFocused = false;
        return;
      }
      if (event.key === "Backspace") {
        this.feedbackInputText = this.feedbackInputText.slice(0, -1);
      } else if (event.key === "Enter") {
        // Ignore — submit button is the way to send.
        return;
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        if (this.feedbackInputText.length < 2000) {
          this.feedbackInputText += event.key;
        }
      }
      // Update displayed text.
      this.feedbackInput.setText(this.feedbackInputText || "Click here to type...");
      this.feedbackInput.setColor(this.feedbackInputText ? TEXT.bright : TEXT.dim);
      charCount.setText(`${this.feedbackInputText.length}/2000`);
    };
    this.input.keyboard?.on("keydown", this._feedbackKeyHandler);

    // Click outside to unfocus text input.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (!this.feedbackOpen) return;
      const inTextarea =
        p.x >= px + pad &&
        p.x <= px + pw - pad &&
        p.y >= y - FEEDBACK_TEXTAREA_H - 4 &&
        p.y <= y - 4;
      if (!inTextarea) {
        this.feedbackInputFocused = false;
      }
    });
  }

  private submitFeedback(): void {
    const msg = this.feedbackInputText.trim();
    if (msg.length === 0) {
      this.feedbackStatusText.setText("⚠️ Please type a message first.");
      this.feedbackStatusText.setColor("#fbbf24");
      return;
    }

    const p = this.localPlayer;
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room || !p) {
      this.feedbackStatusText.setText("⚠️ Not connected to server.");
      this.feedbackStatusText.setColor("#fbbf24");
      return;
    }

    this.feedbackStatusText.setText("Sending...");
    this.feedbackStatusText.setColor(TEXT.dim);

    this.feedbackPending = true;

    // Send with auto-attached context.
    room.send(MessageType.FEEDBACK_SUBMIT, {
      category: this.feedbackSelectedCategory,
      message: msg,
      context: {
        mapId: this.currentMapId,
        x: p.x,
        y: p.y,
        level: p.level,
        archetype: p.archetype,
        clientVersion: VERSION_LABEL,
        serverVersion: "dev",
        logLines: getLastLogLines(50),
        userAgent: navigator.userAgent,
      },
    });
  }

  // ─── Feedback response listener (per-room) ─────────────────────────────────────
  private setupFeedbackResponse(room: Room<unknown, TownStateView>): void {
    room.onMessage(MessageType.FEEDBACK_SUBMIT, (result: FeedbackResultPayload) => {
      if (!this.feedbackPending) return;
      this.feedbackPending = false;
      if (result.success) {
        this.feedbackStatusText.setText("✅ " + result.message);
        this.feedbackStatusText.setColor("#9ad06b");
        this.feedbackInputText = "";
        this.feedbackInput.setText("Click here to type...");
        this.feedbackInput.setColor(TEXT.dim);
        this.time.delayedCall(1500, () => {
          if (this.feedbackOpen) {
            this.feedbackOpen = false;
            this.feedbackContainer.setVisible(false);
          }
        });
      } else {
        this.feedbackStatusText.setText("❌ " + result.message);
        this.feedbackStatusText.setColor("#f87171");
      }
    });
  }

  // ─── Moderation message listeners ────────────────────────────────────────
  private setupModerationListeners(room: Room<unknown, TownStateView>): void {
    room.onMessage(MessageType.SERVER_ANNOUNCEMENT, (payload: ServerAnnouncementPayload) => {
      this.showAnnouncement(payload.text);
    });
    room.onMessage(MessageType.PLAYER_REPORT_RESULT, (payload: PlayerReportResultPayload) => {
      this.addChatLine("Report", payload.message, "system");
    });
    room.onMessage(MessageType.MOD_ACTION_RESULT, (payload: ModActionResultPayload) => {
      this.addChatLine("System", payload.message, "system");
    });
    room.onMessage(MessageType.BLOCKED_LIST_RESULT, (payload: BlockedListResultPayload) => {
      this.blockedNames = payload.blockedNames;
      if (this.blockedOpen) this.renderBlockedList();
    });
  }

  // ─── Settings overlay toggle ─────────────────────────────────────────────────────
  private setupSettingsToggle(): void {
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.chatFocused) return;
      const isOpen = this.registry.get("settingsOpen") === true;
      if (isOpen) {
        this.scene.stop("settings");
        this.registry.set("settingsOpen", false);
      } else {
        this.closeAllPanels();
        loadScene(this.game, "settings", () => import("./SettingsUI")).then(() => {
          this.scene.launch("settings");
        });
        this.registry.set("settingsOpen", true);
      }
    });
  }

  // ─── Help panel toggle (F1) ──────────────────────────────────────────────
  private setupHelpToggle(): void {
    this.input.keyboard?.on("keydown-F1", (event: KeyboardEvent) => {
      // Prevent the browser's default F1 help behavior.
      event.preventDefault();
      if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
      const next = !uiStore.getState().helpOpen;
      uiStore.getState().setHelpOpen(next);
    });
  }

  // ─── Replay events from the Help panel ───────────────────────────────────
  private setupReplayEvents(): void {
    // Replay coach marks: triggered by HelpPanel dispatching "replay-coachmarks".
    // Restart the scene so it re-reads the (now-cleared) seen set from localStorage,
    // then stagger the triggers so they show one at a time.
    window.addEventListener("replay-coachmarks", () => {
      if (this.scene.isActive("coachmarks")) {
        this.scene.stop("coachmarks");
      }
      loadScene(this.game, "coachmarks", () => import("./CoachMarks")).then(() => {
        if (!this.scene.isActive("coachmarks")) this.scene.launch("coachmarks");
        const triggers = ["firstObjective", "move", "attack", "jump", "inventory", "talk"];
        triggers.forEach((id, i) => {
          setTimeout(() => this.registry.set(`coachmark:${id}`, true), i * 5200);
        });
      });
    });

    // Replay intro cinematic: triggered by HelpPanel dispatching "replay-intro".
    window.addEventListener("replay-intro", () => {
      loadScene(this.game, "intro", () => import("./Intro")).then(() => {
        this.scene.launch("intro");
      });
    });
  }

  // ─── Player context menu (right-click on player sprite) ───────────────────
  private buildPlayerContextMenu(): void {
    this.contextMenuBg = this.add.graphics();
    this.contextMenuContainer = this.add.container(0, 0, [this.contextMenuBg]);
    this.contextMenuContainer.setDepth(10200).setVisible(false);
  }

  private setupPlayerContextMenu(): void {
    this.game.events.on(
      "player-rightclick",
      (data: { sessionId: string; name: string; worldX: number; worldY: number }) => {
        // Convert world coords to screen coords.
        const cam = this.cameras.main;
        const sx = data.worldX - cam.scrollX;
        const sy = data.worldY - cam.scrollY;
        this.showPlayerContextMenu(sx, sy, data.sessionId, data.name);
      },
    );
    // Hide on any left-click on the scene background.
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.hidePlayerContextMenu();
    });
  }

  private showPlayerContextMenu(x: number, y: number, sessionId: string, name: string): void {
    for (const el of this.contextMenuElements) el.destroy();
    this.contextMenuElements.length = 0;

    const MENU_W = 140;
    const ROW_H = 24;
    const MENU_PAD = 6;
    const items: { label: string; fn: () => void }[] = [
      {
        label: "💬 Whisper",
        fn: () => {
          uiStore.getState().requestChatFocus(`/w ${name} `);
        },
      },
      {
        label: "📨 Invite Party",
        fn: () => {
          this.sendPartyInviteByName(name);
        },
      },
      {
        label: "🏰 Invite Guild",
        fn: () => {
          const targetSessionId = this.resolveSessionByName(name);
          if (targetSessionId) {
            const room = this.registry.get(ROOM_REGISTRY_KEY) as
              | Room<unknown, TownStateView>
              | undefined;
            if (room) room.send(MessageType.GUILD_INVITE, { targetSessionId });
          } else {
            this.addChatLine("System", `Player '${name}' not found on this map.`, "system");
          }
        },
      },
      {
        label: "🔄 Trade",
        fn: () => {
          const targetSessionId = this.resolveSessionByName(name);
          if (targetSessionId) {
            const room = this.registry.get(ROOM_REGISTRY_KEY) as
              | Room<unknown, TownStateView>
              | undefined;
            if (room) room.send(MessageType.TRADE_INVITE, { targetSessionId });
          } else {
            this.addChatLine("System", `Player '${name}' not found on this map.`, "system");
          }
        },
      },
      {
        label: "👤 Add Friend",
        fn: () => {
          const room = this.registry.get(ROOM_REGISTRY_KEY) as
            | Room<unknown, TownStateView>
            | undefined;
          if (room) room.send(MessageType.FRIEND_ADD, { targetName: name });
        },
      },
      {
        label: "⭐ Give Fame",
        fn: () => {
          this.sendGiveFame(sessionId);
        },
      },
      {
        label: "📊 View Stats",
        fn: () => {
          this.showPlayerStatsTooltip(sessionId, name);
        },
      },
      {
        label: "🚫 Block",
        fn: () => {
          this.sendBlockPlayer(name);
        },
      },
      {
        label: "🚩 Report",
        fn: () => {
          this.openReportDialog(name);
        },
      },
    ];
    const MENU_H = MENU_PAD * 2 + items.length * ROW_H + (items.length - 1) * 2;

    items.forEach((item, i) => {
      const btn = this.createPanelButton(
        MENU_PAD,
        MENU_PAD + i * (ROW_H + 2),
        MENU_W - MENU_PAD * 2,
        ROW_H,
        item.label,
        () => {
          item.fn();
          this.hidePlayerContextMenu();
        },
      );
      this.contextMenuContainer.add(btn);
      this.contextMenuElements.push(btn);
    });

    const sw = this.scale.width;
    const sh = this.scale.height;
    let mx = x;
    let my = y;
    if (mx + MENU_W > sw) mx = sw - MENU_W - 4;
    if (my + MENU_H > sh) my = sh - MENU_H - 4;

    this.contextMenuBg
      .clear()
      .fillStyle(PALETTE.panelFill, 0.96)
      .fillRoundedRect(0, 0, MENU_W, MENU_H, 8)
      .lineStyle(1, PALETTE.panelStroke, 1)
      .strokeRoundedRect(0, 0, MENU_W, MENU_H, 8);

    this.contextMenuContainer.setPosition(mx, my);
    this.contextMenuContainer.setVisible(true);
  }

  private hidePlayerContextMenu(): void {
    this.contextMenuContainer.setVisible(false);
  }

  // ─── NPC context menu (right-click on NPC sprite) ────────────────────
  private buildNpcContextMenu(): void {
    this.npcContextMenuBg = this.add.graphics();
    this.npcContextMenuContainer = this.add.container(0, 0, [this.npcContextMenuBg]);
    this.npcContextMenuContainer.setDepth(10200).setVisible(false);
  }

  private setupNpcContextMenu(): void {
    this.game.events.on(
      "npc-rightclick",
      (data: { npcId: string; npcName: string; role: string; worldX: number; worldY: number }) => {
        const cam = this.cameras.main;
        const sx = data.worldX - cam.scrollX;
        const sy = data.worldY - cam.scrollY;
        this.showNpcContextMenu(sx, sy, data.npcId, data.npcName, data.role);
      },
    );
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.hideNpcContextMenu();
    });
  }

  private showNpcContextMenu(
    x: number,
    y: number,
    npcId: string,
    npcName: string,
    role: string,
  ): void {
    for (const el of this.npcContextMenuElements) el.destroy();
    this.npcContextMenuElements.length = 0;

    const MENU_W = 140;
    const ROW_H = 24;
    const MENU_PAD = 6;

    // Build entries based on NPC role.
    const items: { label: string; fn: () => void }[] = [];

    // Primary action based on role.
    switch (role) {
      case "shop":
        items.push({
          label: "🛒 Shop",
          fn: () => this.talkToNpc(npcId),
        });
        break;
      case "storage":
        items.push({
          label: "📦 Storage",
          fn: () => this.talkToNpc(npcId),
        });
        break;
      case "travel":
        items.push({
          label: "🚕 Travel",
          fn: () => this.talkToNpc(npcId),
        });
        break;
      case "ferry":
        items.push({
          label: "⛵ Ferry",
          fn: () => this.talkToNpc(npcId),
        });
        break;
      case "job":
        items.push({
          label: "⚔️ Job Advance",
          fn: () => this.talkToNpc(npcId),
        });
        break;
      case "quest":
        items.push({
          label: "❓ Quest",
          fn: () => this.talkToNpc(npcId),
        });
        break;
      default: // guide and others
        items.push({
          label: "💬 Talk",
          fn: () => this.talkToNpc(npcId),
        });
        break;
    }

    // Always show the NPC name as a disabled header row.
    const MENU_H = MENU_PAD * 2 + (items.length + 1) * ROW_H + items.length * 2;

    // NPC name header (non-clickable).
    const headerContainer = this.add.container(MENU_PAD, MENU_PAD);
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x1a2540, 0.9);
    headerBg.fillRoundedRect(0, 0, MENU_W - MENU_PAD * 2, ROW_H, 4);
    const headerText = this.add
      .text((MENU_W - MENU_PAD * 2) / 2, ROW_H / 2, npcName, {
        fontFamily: FONT,
        fontSize: "11px",
        color: "#ffe08a",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    headerContainer.add([headerBg, headerText]);
    this.npcContextMenuContainer.add(headerContainer);
    this.npcContextMenuElements.push(headerContainer);

    // Action rows below the header.
    items.forEach((item, i) => {
      const btn = this.createPanelButton(
        MENU_PAD,
        MENU_PAD + (i + 1) * (ROW_H + 2),
        MENU_W - MENU_PAD * 2,
        ROW_H,
        item.label,
        () => {
          item.fn();
          this.hideNpcContextMenu();
        },
      );
      this.npcContextMenuContainer.add(btn);
      this.npcContextMenuElements.push(btn);
    });

    const sw = this.scale.width;
    const sh = this.scale.height;
    let mx = x;
    let my = y;
    if (mx + MENU_W > sw) mx = sw - MENU_W - 4;
    if (my + MENU_H > sh) my = sh - MENU_H - 4;

    this.npcContextMenuBg
      .clear()
      .fillStyle(PALETTE.panelFill, 0.96)
      .fillRoundedRect(0, 0, MENU_W, MENU_H, 8)
      .lineStyle(1, PALETTE.panelStroke, 1)
      .strokeRoundedRect(0, 0, MENU_W, MENU_H, 8);

    this.npcContextMenuContainer.setPosition(mx, my);
    this.npcContextMenuContainer.setVisible(true);
  }

  private hideNpcContextMenu(): void {
    this.npcContextMenuContainer.setVisible(false);
  }

  /** Send TALK_NPC to the server for the given NPC id. */
  private talkToNpc(npcId: string): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;
    room.send(MessageType.TALK_NPC, { npcId });
  }

  // ─── Player stats tooltip (shown from context menu "View Stats") ─────
  private buildStatsTooltip(): void {
    this.statsTooltipBg = this.add.graphics();
    this.statsTooltipContainer = this.add.container(0, 0, [this.statsTooltipBg]);
    this.statsTooltipContainer.setDepth(10201).setVisible(false);
  }

  private showPlayerStatsTooltip(sessionId: string, name: string): void {
    for (const el of this.statsTooltipElements) el.destroy();
    this.statsTooltipElements.length = 0;

    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;
    const player = room.state.players.get(sessionId);
    if (!player) return;

    const PANEL_W = 180;
    const ROW_H = 18;
    const PAD = 10;
    const HEADER_H = 22;
    const lines: string[] = [
      `Level: ${player.level}`,
      `HP: ${player.hp} / ${player.maxHp}`,
      `MP: ${player.mp} / ${player.maxMp}`,
      `STR: ${player.str}`,
      `DEX: ${player.dex}`,
      `INT: ${player.intel}`,
      `LUK: ${player.luk}`,
      `Fame: ${player.displayFame}`,
    ];
    const PANEL_H = PAD * 2 + HEADER_H + lines.length * (ROW_H + 2);

    // Header.
    const headerContainer = this.add.container(PAD, PAD);
    const headerBg = this.add.graphics();
    headerBg.fillStyle(0x1a2540, 0.9);
    headerBg.fillRoundedRect(0, 0, PANEL_W - PAD * 2, HEADER_H, 4);
    const headerText = this.add
      .text((PANEL_W - PAD * 2) / 2, HEADER_H / 2, `${name}'s Stats`, {
        fontFamily: FONT,
        fontSize: "12px",
        color: "#f6c177",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    headerContainer.add([headerBg, headerText]);
    this.statsTooltipContainer.add(headerContainer);
    this.statsTooltipElements.push(headerContainer);

    // Stat rows.
    lines.forEach((line, i) => {
      const text = this.add.text(PAD, PAD + HEADER_H + 4 + i * (ROW_H + 2), line, {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.bright,
      });
      this.statsTooltipContainer.add(text);
      this.statsTooltipElements.push(text);
    });

    // Position at center of screen.
    const sw = this.scale.width;
    const sh = this.scale.height;
    const mx = (sw - PANEL_W) / 2;
    const my = (sh - PANEL_H) / 2;

    this.statsTooltipBg
      .clear()
      .fillStyle(PALETTE.panelFill, 0.96)
      .fillRoundedRect(0, 0, PANEL_W, PANEL_H, 8)
      .lineStyle(1, PALETTE.panelStroke, 1)
      .strokeRoundedRect(0, 0, PANEL_W, PANEL_H, 8);

    this.statsTooltipContainer.setPosition(mx, my);
    this.statsTooltipContainer.setVisible(true);

    // Auto-hide on left click.
    const hideHandler = () => {
      this.statsTooltipContainer.setVisible(false);
      this.input.off("pointerdown", hideHandler);
    };
    this.time.delayedCall(100, () => {
      this.input.on("pointerdown", hideHandler);
    });
  }

  private sendPartyInviteByName(name: string): void {
    const targetName = name.trim();
    if (!targetName) return;
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;
    // Server resolves the target by name across maps (see handlePartyInvite).
    room.send(MessageType.PARTY_INVITE, { targetName });
  }

  private sendGiveFame(targetSessionId: string): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;
    const target = room.state.players.get(targetSessionId);
    if (!target) {
      this.addChatLine("System", "Player not found on this map.", "system");
      return;
    }
    const targetCharId = target.charId;
    if (!targetCharId) {
      this.addChatLine("System", "Cannot identify target player.", "system");
      return;
    }
    room.send(MessageType.GIVE_FAME, {
      targetCharId,
      amount: 1,
    } as import("@maple/shared").GiveFamePayload);
  }

  private sendBlockPlayer(name: string): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;
    room.send(MessageType.BLOCK_PLAYER, { targetName: name });
  }

  private sendUnblockPlayer(name: string): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (!room) return;
    room.send(MessageType.UNBLOCK_PLAYER, { targetName: name });
  }

  // ─── Blocked list panel (toggled with Shift+B) ──────────────────────────
  private buildBlockedListPanel(): void {
    this.blockedBg = this.add.graphics();
    this.blockedContainer = this.add.container(0, 0, [this.blockedBg]);
    this.blockedContainer.setDepth(9500).setVisible(false);
  }

  private setupBlockedListToggle(): void {
    this.input.keyboard?.on("keydown-B", (event: KeyboardEvent) => {
      if (this.chatFocused) return;
      if (event.shiftKey) {
        if (this.blockedOpen) {
          this.blockedOpen = false;
          this.blockedContainer.setVisible(false);
        } else {
          this.closeAllPanels();
          this.blockedOpen = true;
          this.renderBlockedList();
          this.blockedContainer.setVisible(true);
        }
      }
    });
  }

  private renderBlockedList(): void {
    for (const el of this.blockedElements) el.destroy();
    this.blockedElements.length = 0;
    this.blockedContainer.removeAll(false);
    this.blockedContainer.add(this.blockedBg);

    const PANEL_W = 240;
    const ROW_H = 24;
    const PAD = 12;
    const HEADER_H = 34;
    const sw = this.scale.width;
    const sh = this.scale.height;
    const px = (sw - PANEL_W) / 2;
    let py = (sh - 200) / 2;

    this.blockedBg.clear();
    this.blockedBg.fillStyle(PALETTE.panelFill, 0.95);
    this.blockedBg.fillRoundedRect(px, py, PANEL_W, 200, 8);
    this.blockedBg.lineStyle(1.5, PALETTE.panelStroke, 1);
    this.blockedBg.strokeRoundedRect(px, py, PANEL_W, 200, 8);

    const title = this.add.text(px + PAD, py + 10, "🚫 Blocked Players", {
      fontFamily: FONT,
      fontSize: "14px",
      color: TEXT.name,
      fontStyle: "bold",
    });
    this.blockedContainer.add(title);
    this.blockedElements.push(title);

    const closeBtn = this.add
      .text(px + PANEL_W - PAD - 20, py + 10, "✕", {
        fontFamily: FONT,
        fontSize: "16px",
        color: TEXT.dim,
      })
      .setInteractive({ cursor: "pointer" });
    closeBtn.on("pointerdown", () => {
      this.blockedOpen = false;
      this.blockedContainer.setVisible(false);
    });
    this.blockedContainer.add(closeBtn);
    this.blockedElements.push(closeBtn);
    py += HEADER_H;

    if (this.blockedNames.length === 0) {
      const empty = this.add.text(px + PAD, py + 8, "No blocked players.", {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.dim,
      });
      this.blockedContainer.add(empty);
      this.blockedElements.push(empty);
    } else {
      for (const name of this.blockedNames) {
        const row = this.add.text(px + PAD, py + 4, name, {
          fontFamily: FONT,
          fontSize: "12px",
          color: TEXT.bright,
        });
        this.blockedContainer.add(row);
        this.blockedElements.push(row);

        const unblockBtn = this.add
          .text(px + PANEL_W - PAD - 50, py + 4, "[unblock]", {
            fontFamily: FONT,
            fontSize: "11px",
            color: "#ef4444",
          })
          .setInteractive({ cursor: "pointer" });
        unblockBtn.on("pointerdown", () => {
          this.sendUnblockPlayer(name);
        });
        this.blockedContainer.add(unblockBtn);
        this.blockedElements.push(unblockBtn);
        py += ROW_H;
      }
    }
  }

  // ─── Report dialog (rendered by src/ui/ReportDialog.tsx) ───────────────────
  /** Open/close the React report modal, keeping Phaser's flag + store in sync. */
  private setReportOpen(open: boolean): void {
    this.reportOpen = open;
    uiStore.getState().setReportOpen(open);
  }

  /** Open the report modal targeting a player; pushes target + opens via the store. */
  private openReportDialog(targetName: string): void {
    this.reportTargetName = targetName;
    uiStore.getState().setReportTarget(targetName);
    this.setReportOpen(true);
  }

  /** Register the report action registry (submit + close). Idempotent-safe. */
  private registerReportActions(): void {
    uiStore.getState().setReportActions({
      submit: (reason: string) => {
        const trimmed = reason.trim();
        if (!trimmed) return;
        const room = this.registry.get(ROOM_REGISTRY_KEY) as
          | Room<unknown, TownStateView>
          | undefined;
        if (room) {
          // Collect recent chat lines for moderation context.
          const chatContext = this.chatMsgBuffer.slice(-20).map((m) => `${m.name}: ${m.text}`);
          room.send(MessageType.PLAYER_REPORT, {
            targetName: this.reportTargetName,
            reason: trimmed,
            chatContext,
          });
        }
        this.setReportOpen(false);
      },
      close: () => this.setReportOpen(false),
    });
  }

  // ─── Server announcement banner ──────────────────────────────────────────
  private buildAnnouncementBanner(): void {
    this.announcementBg = this.add.graphics();
    this.announcementText = this.add
      .text(0, 0, "", {
        fontFamily: FONT,
        fontSize: "13px",
        color: "#ffffff",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.announcementContainer = this.add.container(0, 0, [
      this.announcementBg,
      this.announcementText,
    ]);
    this.announcementContainer.setDepth(10000).setVisible(false);
  }

  private showAnnouncement(text: string): void {
    const sw = this.scale.width;
    const bannerH = 32;
    const pad = 20;
    const bannerW = sw - pad * 2;
    const bx = pad;
    const by = 40; // below minimap area

    this.announcementBg
      .clear()
      .fillStyle(0x1e3a5f, 0.92)
      .fillRoundedRect(bx, by, bannerW, bannerH, 6)
      .lineStyle(1, 0x3b82f6, 0.8)
      .strokeRoundedRect(bx, by, bannerW, bannerH, 6);

    this.announcementText.setText(`📢 ${text}`);
    this.announcementText.setPosition(bx + bannerW / 2, by + bannerH / 2);
    this.announcementContainer.setVisible(true);

    // Auto-hide after 8 seconds.
    this.time.delayedCall(8000, () => {
      this.announcementContainer.setVisible(false);
    });

    // Also show in chat.
    this.addChatLine("Announcement", text, "system");
  }

  /** Close every open panel overlay (called before opening settings). */
  private closeAllPanels(): void {
    if (this.inventoryOpen) {
      this.setInventoryOpen(false);
    }
    if (uiStore.getState().questLogOpen) {
      uiStore.getState().setQuestLogOpen(false);
    }
    if (this.statPanelOpen) {
      this.setStatPanelOpen(false);
    }
    if (this.equipPanelOpen) {
      this.setEquipmentPanelOpen(false);
    }
    if (this.skillTreeOpen) {
      this.setSkillTreePanelOpen(false);
    }
    if (uiStore.getState().worldMap.open) {
      uiStore.getState().setWorldMapOpen(false);
    }
    if (this.cubePanelOpen) {
      this.cubePanelOpen = false;
      this.cubePanelContainer.setVisible(false);
    }
    if (this.upgradePanelOpen) {
      this.upgradePanelOpen = false;
      this.upgradePanelContainer.setVisible(false);
    }
    if (this.partyPanelOpen) {
      this.setPartyPanelOpen(false);
    }
    if (this.friendsPanelOpen) {
      this.setFriendsPanelOpen(false);
    }
    if (this.guildPanelOpen) {
      this.setGuildPanelOpen(false);
    }
    if (this.feedbackOpen) {
      this.feedbackOpen = false;
      this.feedbackContainer.setVisible(false);
    }
    if (this.blockedOpen) {
      this.blockedOpen = false;
      this.blockedContainer.setVisible(false);
    }
    if (this.reportOpen) {
      this.setReportOpen(false);
    }
    if (this.guidePanelOpen) {
      this.guidePanelOpen = false;
      this.guidePanelContainer.setVisible(false);
    }
    this.hidePlayerContextMenu();
    this.hideNpcContextMenu();
    this.statsTooltipContainer.setVisible(false);
  }

  /** Send current settings to the server for persistence. */
  sendSettingsToServer(): void {
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.SETTINGS_SYNC, keybindings.toPayload());
  }

  // ── Combat QoL: public accessors for SettingsUI ─────────────────────────────

  /** Get current auto-pot config (read by SettingsUI). */
  getAutoPotConfig(): import("@maple/shared").AutoPotConfig {
    return { ...this.autoPotConfig };
  }

  /** Get current skill macros (read by SettingsUI). */
  getMacros(): {
    id: string;
    name: string;
    steps: { type: "skill" | "consumable"; id: string }[];
  }[] {
    return this.macros.map((m) => ({
      id: m.id,
      name: m.name,
      steps: m.steps.map((s) => ({ ...s })),
    }));
  }

  /** Update auto-pot config + send to server for persistence. */
  updateAutoPotConfig(config: import("@maple/shared").AutoPotConfig): void {
    this.autoPotConfig = { ...config };
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.AUTO_POT_SYNC, { config });
  }

  /** Update skill macros + send to server for persistence. */
  updateMacros(
    macros: {
      id: string;
      name: string;
      steps: { type: "skill" | "consumable"; id: string }[];
    }[],
  ): void {
    this.macros = macros.map((m) => ({
      id: m.id,
      name: m.name,
      steps: m.steps.map((s) => ({ ...s })),
    }));
    const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<unknown, TownStateView> | undefined;
    if (room) room.send(MessageType.MACRO_LAYOUT, { macros });
  }

  // ─── Familiar collection/summon panel (toggled with V) ────────────────
  private buildFamiliarPanel(): void {
    this.familiarPanelBg = this.add.graphics();
    this.familiarPanelContainer = this.add.container(0, 0, [this.familiarPanelBg]);
    this.familiarPanelContainer.setDepth(5000).setVisible(false);
  }

  private setupFamiliarPanelToggle(): void {
    if (!FAMILIAR_ENABLED) return;
    this.game.events.on("keydown", (event: KeyboardEvent) => {
      if (event.key === "v" || event.key === "V") {
        // Don't toggle while typing in chat or any input.
        if (this.chatFocused) return;
        this.familiarPanelOpen = !this.familiarPanelOpen;
        this.renderFamiliarPanel();
      }
    });
  }

  private renderFamiliarPanel(): void {
    for (const el of this.familiarPanelElements) el.destroy();
    this.familiarPanelElements.length = 0;

    if (!this.familiarPanelOpen) {
      this.familiarPanelContainer.setVisible(false);
      return;
    }
    this.familiarPanelContainer.setVisible(true);

    const sw = this.scale.width;
    const sh = this.scale.height;
    const panelW = 320;
    const pad = 14;
    const headerH = 34;
    const rowH = 32;
    const contentH = Math.max(120, this.familiarRegistered.length * rowH + 40);
    const panelH = headerH + contentH + pad * 2;
    const px = (sw - panelW) / 2;
    const py = (sh - panelH) / 2;

    // Background.
    this.familiarPanelBg.clear();
    this.familiarPanelBg.fillStyle(PALETTE.panelFill, 0.92);
    this.familiarPanelBg.fillRoundedRect(px, py, panelW, panelH, 8);
    this.familiarPanelBg.lineStyle(1, PALETTE.panelStroke, 0.9);
    this.familiarPanelBg.strokeRoundedRect(px, py, panelW, panelH, 8);
    this.familiarPanelContainer.add(this.familiarPanelBg);

    // Header.
    const header = this.add
      .text(px + panelW / 2, py + headerH / 2, "🐾 Familiars", {
        fontFamily: FONT,
        fontSize: "14px",
        color: TEXT.bright,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.familiarPanelContainer.add(header);
    this.familiarPanelElements.push(header);

    // Summoned count.
    const countText = this.add.text(
      px + pad,
      py + headerH + 4,
      `Summoned: ${this.familiarSummoned.length} / ${FAMILIAR_MAX_SUMMONED}`,
      {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.dim,
      },
    );
    this.familiarPanelContainer.add(countText);
    this.familiarPanelElements.push(countText);

    // List registered familiars.
    let y = py + headerH + 22;
    for (const mobId of this.familiarRegistered) {
      const mobName = mobId.split(".").pop() ?? mobId;
      const isSummoned = this.familiarSummoned.includes(mobId);

      // Row background.
      const rowBg = this.add.graphics();
      rowBg.fillStyle(isSummoned ? 0x1a3a1a : PALETTE.panelFill, 0.7);
      rowBg.fillRoundedRect(px + pad, y, panelW - pad * 2, rowH - 2, 4);
      this.familiarPanelContainer.add(rowBg);
      this.familiarPanelElements.push(rowBg);

      // Name.
      const nameText = this.add
        .text(px + pad + 8, y + rowH / 2 - 7, mobName.replace(/_/g, " "), {
          fontFamily: FONT,
          fontSize: "11px",
          color: isSummoned ? "#4ade80" : TEXT.bright,
        })
        .setOrigin(0, 0.5);
      this.familiarPanelContainer.add(nameText);
      this.familiarPanelElements.push(nameText);

      // Summon / Dismiss button.
      const btnLabel = isSummoned ? "Dismiss" : "Summon";
      const btnColor = isSummoned ? 0x991b1b : 0x166534;
      const btn = this.add.graphics();
      const btnX = px + panelW - pad - 68;
      const btnY = y + 4;
      btn.fillStyle(btnColor, 0.9);
      btn.fillRoundedRect(btnX, btnY, 60, rowH - 10, 4);
      this.familiarPanelContainer.add(btn);
      this.familiarPanelElements.push(btn);
      const btnText = this.add
        .text(btnX + 30, btnY + (rowH - 10) / 2, btnLabel, {
          fontFamily: FONT,
          fontSize: "10px",
          color: "#ffffff",
        })
        .setOrigin(0.5);
      this.familiarPanelContainer.add(btnText);
      this.familiarPanelElements.push(btnText);

      // Click handler.
      const hitZone = this.add.zone(btnX, btnY, 60, rowH - 10).setInteractive();
      hitZone.on("pointerdown", () => {
        const room = this.registry.get(ROOM_REGISTRY_KEY) as
          | Room<unknown, TownStateView>
          | undefined;
        if (!room) return;
        if (isSummoned) {
          room.send(MessageType.FAMILIAR_DISMISS, { mobId });
        } else {
          room.send(MessageType.FAMILIAR_SUMMON, { mobId });
        }
      });
      this.familiarPanelContainer.add(hitZone);
      this.familiarPanelElements.push(hitZone);

      y += rowH;
    }

    if (this.familiarRegistered.length === 0) {
      const emptyText = this.add
        .text(px + panelW / 2, y + 20, "No familiar cards found yet. Defeat mobs to find them!", {
          fontFamily: FONT,
          fontSize: "11px",
          color: TEXT.dim,
          align: "center",
        })
        .setOrigin(0.5);
      this.familiarPanelContainer.add(emptyText);
      this.familiarPanelElements.push(emptyText);
    }
  }

  // ─── Codex / Exploration Dispatch panel (toggled with C) ─────────────────
  private buildCodexPanel(): void {
    this.codexPanelBg = this.add.graphics();
    this.codexPanelContainer = this.add.container(0, 0, [this.codexPanelBg]);
    this.codexPanelContainer.setDepth(5000).setVisible(false);
  }

  private setupCodexPanelToggle(): void {
    this.game.events.on("keydown", (event: KeyboardEvent) => {
      if (event.key === "c" || event.key === "C") {
        if (this.chatFocused) return;
        this.codexPanelOpen = !this.codexPanelOpen;
        if (this.codexPanelOpen) {
          const room = this.registry.get(ROOM_REGISTRY_KEY) as
            | Room<unknown, TownStateView>
            | undefined;
          if (room) {
            room.send(MessageType.VIEW_CODEX);
          }
        }
        this.renderCodexPanel();
      }
    });
  }

  private renderCodexPanel(): void {
    for (const el of this.codexPanelElements) el.destroy();
    this.codexPanelElements.length = 0;

    if (!this.codexPanelOpen) {
      this.codexPanelContainer.setVisible(false);
      return;
    }
    this.codexPanelContainer.setVisible(true);

    const sw = this.scale.width;
    const sh = this.scale.height;
    const panelW = 420;
    const pad = 14;
    const headerH = 36;
    const tabH = 28;
    const panelH = Math.min(sh - 40, 520);
    const px = (sw - panelW) / 2;
    const py = (sh - panelH) / 2;

    // Background.
    this.codexPanelBg.clear();
    this.codexPanelBg.fillStyle(PALETTE.panelFill, 0.95);
    this.codexPanelBg.fillRoundedRect(px, py, panelW, panelH, 8);
    this.codexPanelBg.lineStyle(1, PALETTE.panelStroke, 0.9);
    this.codexPanelBg.strokeRoundedRect(px, py, panelW, panelH, 8);
    this.codexPanelContainer.add(this.codexPanelBg);

    // Header.
    const header = this.add
      .text(px + panelW / 2, py + headerH / 2, "📖 Monster Codex", {
        fontFamily: FONT,
        fontSize: "14px",
        color: TEXT.bright,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.codexPanelContainer.add(header);
    this.codexPanelElements.push(header);

    // Close button.
    const closeBtn = this.add
      .text(px + panelW - 20, py + 8, "✕", {
        fontFamily: FONT,
        fontSize: "16px",
        color: TEXT.dim,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    closeBtn.on("pointerdown", () => {
      this.codexPanelOpen = false;
      this.renderCodexPanel();
    });
    this.codexPanelContainer.add(closeBtn);
    this.codexPanelElements.push(closeBtn);

    // Tabs.
    const tabs: { key: "collection" | "exploration"; label: string }[] = [
      { key: "collection", label: "Collection" },
      { key: "exploration", label: "Exploration" },
    ];
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      if (!t) continue;
      const tx = px + pad + i * 100;
      const ty = py + headerH + 4;
      const isActive = this.codexTab === t.key;
      const tabBg = this.add.graphics();
      tabBg.fillStyle(isActive ? 0x2563eb : 0x1a2234, 0.8);
      tabBg.fillRoundedRect(tx, ty, 94, tabH, 4);
      this.codexPanelContainer.add(tabBg);
      this.codexPanelElements.push(tabBg);

      const tabLabel = this.add
        .text(tx + 47, ty + tabH / 2, t.label, {
          fontFamily: FONT,
          fontSize: "11px",
          color: isActive ? "#ffffff" : TEXT.dim,
          fontStyle: "bold",
        })
        .setOrigin(0.5);
      this.codexPanelContainer.add(tabLabel);
      this.codexPanelElements.push(tabLabel);

      const hitZone = this.add
        .zone(tx + 47, ty + tabH / 2, 94, tabH)
        .setInteractive({ useHandCursor: true });
      hitZone.on("pointerdown", () => {
        this.codexTab = t.key;
        this.renderCodexPanel();
      });
      this.codexPanelContainer.add(hitZone);
      this.codexPanelElements.push(hitZone);
    }

    const contentY = py + headerH + tabH + 12;
    const contentH = panelH - headerH - tabH - pad - 12;

    if (this.codexTab === "collection") {
      this.renderCodexCollection(px, contentY, panelW, contentH, pad);
    } else {
      this.renderCodexExploration(px, contentY, panelW, contentH, pad);
    }
  }

  private renderCodexCollection(
    px: number,
    startY: number,
    panelW: number,
    maxH: number,
    pad: number,
  ): void {
    {
      const entries = Object.entries(CODEX_ENTRIES);
      const colW = (panelW - pad * 2 - 8) / 3; // 3 columns
      const rowH = 56;
      const cols = 3;

      // Stats summary.
      const statsText = this.add.text(
        px + pad,
        startY,
        `Bonuses: +${this.codexStatBonus.STR} STR  +${this.codexStatBonus.DEX} DEX  +${this.codexStatBonus.INT} INT  +${this.codexStatBonus.LUK} LUK  +${(this.codexExpBonus * 100).toFixed(0)}% EXP`,
        {
          fontFamily: FONT,
          fontSize: "10px",
          color: TEXT.mesos,
        },
      );
      this.codexPanelContainer.add(statsText);
      this.codexPanelElements.push(statsText);

      const gridY = startY + 18;
      const registeredCount = Object.values(this.codexData).filter((k) => k >= 1).length;
      const totalCountText = this.add.text(
        px + pad,
        gridY,
        `Discovered: ${registeredCount} / ${entries.length}`,
        {
          fontFamily: FONT,
          fontSize: "10px",
          color: TEXT.dim,
        },
      );
      this.codexPanelContainer.add(totalCountText);
      this.codexPanelElements.push(totalCountText);

      const gridStartY = gridY + 18;

      for (let i = 0; i < entries.length; i++) {
        const tuple = entries[i];
        if (!tuple) continue;
        const [mobId, entry] = tuple;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = px + pad + col * (colW + 4);
        const cy = gridStartY + row * rowH;

        if (cy + rowH > startY + maxH) break; // stop if we overflow

        const kills = this.codexData[mobId] ?? 0;
        const isRegistered = kills >= 1;
        const mobDef = MOBS[mobId];
        const mobName = mobDef?.name ?? mobId.split(".").pop() ?? mobId;

        // Card background.
        const cardBg = this.add.graphics();
        cardBg.fillStyle(isRegistered ? 0x1a2a1a : 0x1a1a22, 0.7);
        cardBg.fillRoundedRect(cx, cy, colW - 2, rowH - 4, 4);
        cardBg.lineStyle(1, isRegistered ? 0x4a8a4a : PALETTE.panelStroke, 0.5);
        cardBg.strokeRoundedRect(cx, cy, colW - 2, rowH - 4, 4);
        this.codexPanelContainer.add(cardBg);
        this.codexPanelElements.push(cardBg);

        // Mob name.
        const nameText = this.add.text(cx + 4, cy + 3, isRegistered ? mobName : "?", {
          fontFamily: FONT,
          fontSize: "9px",
          color: isRegistered ? TEXT.bright : TEXT.dim,
          fontStyle: "bold",
        });
        this.codexPanelContainer.add(nameText);
        this.codexPanelElements.push(nameText);

        // Kill count.
        const killText = this.add.text(
          cx + 4,
          cy + 18,
          isRegistered ? `${kills} kills` : "Undiscovered",
          {
            fontFamily: FONT,
            fontSize: "9px",
            color: TEXT.dim,
          },
        );
        this.codexPanelContainer.add(killText);
        this.codexPanelElements.push(killText);

        // Milestone progress bar.
        if (isRegistered && entry.milestones.length > 0) {
          const lastMilestone = entry.milestones[entry.milestones.length - 1];
          if (!lastMilestone) continue;
          const maxKills = lastMilestone.kills;
          const ratio = Math.min(kills / maxKills, 1);
          const barW = colW - 10;
          const barH = 5;
          const barX = cx + 4;
          const barY = cy + 32;
          const bar = this.add.graphics();
          bar.fillStyle(0x0c1019, 0.8);
          bar.fillRoundedRect(barX, barY, barW, barH, 2);
          bar.fillStyle(0x9ad06b, 0.9);
          bar.fillRoundedRect(barX, barY, Math.max(barW * ratio, 1), barH, 2);
          this.codexPanelContainer.add(bar);
          this.codexPanelElements.push(bar);

          // Milestone count.
          const achieved = entry.milestones.filter((m) => kills >= m.kills).length;
          const msText = this.add.text(
            cx + 4,
            cy + 40,
            `${achieved}/${entry.milestones.length} ms`,
            {
              fontFamily: FONT,
              fontSize: "8px",
              color: TEXT.dim,
            },
          );
          this.codexPanelContainer.add(msText);
          this.codexPanelElements.push(msText);
        } else if (!isRegistered) {
          const lockText = this.add.text(cx + 4, cy + 34, "🔒", {
            fontFamily: FONT,
            fontSize: "12px",
          });
          this.codexPanelContainer.add(lockText);
          this.codexPanelElements.push(lockText);
        }
      }
    }
  }

  private renderCodexExploration(
    px: number,
    startY: number,
    panelW: number,
    maxH: number,
    pad: number,
  ): void {
    {
      const now = Date.now();

      // Header info.
      const infoText = this.add.text(
        px + pad,
        startY,
        `Slots: ${this.explorationSlots.filter((s) => !s.claimed).length} / ${this.explorationMaxSlots}  |  Registered: ${this.explorationRegisteredCount}`,
        {
          fontFamily: FONT,
          fontSize: "10px",
          color: TEXT.dim,
        },
      );
      this.codexPanelContainer.add(infoText);
      this.codexPanelElements.push(infoText);

      let y = startY + 22;

      // Active explorations.
      const activeSlots = this.explorationSlots.filter((s) => !s.claimed);
      if (activeSlots.length > 0) {
        const sectionTitle = this.add.text(px + pad, y, "Active Explorations", {
          fontFamily: FONT,
          fontSize: "11px",
          color: TEXT.bright,
          fontStyle: "bold",
        });
        this.codexPanelContainer.add(sectionTitle);
        this.codexPanelElements.push(sectionTitle);
        y += 20;

        for (const slot of activeSlots) {
          if (y + 44 > startY + maxH) break;
          const mobDef = MOBS[slot.mobId];
          const mobName = mobDef?.name ?? slot.mobId;
          const remaining = Math.max(0, slot.completeAt - now);
          const isComplete = remaining <= 0;

          const rowBg = this.add.graphics();
          rowBg.fillStyle(isComplete ? 0x1a3a1a : 0x1a2234, 0.7);
          rowBg.fillRoundedRect(px + pad, y, panelW - pad * 2, 40, 4);
          this.codexPanelContainer.add(rowBg);
          this.codexPanelElements.push(rowBg);

          const nameText = this.add.text(px + pad + 8, y + 4, `${mobName} (${slot.duration})`, {
            fontFamily: FONT,
            fontSize: "10px",
            color: TEXT.bright,
            fontStyle: "bold",
          });
          this.codexPanelContainer.add(nameText);
          this.codexPanelElements.push(nameText);

          if (isComplete) {
            // Progress bar at 100%.
            const bar = this.add.graphics();
            bar.fillStyle(0x9ad06b, 0.9);
            bar.fillRoundedRect(px + pad + 8, y + 22, panelW - pad * 2 - 16, 4, 2);
            this.codexPanelContainer.add(bar);
            this.codexPanelElements.push(bar);

            const claimText = this.add.text(px + pad + 8, y + 28, "✅ Complete!", {
              fontFamily: FONT,
              fontSize: "9px",
              color: "#9ad06b",
            });
            this.codexPanelContainer.add(claimText);
            this.codexPanelElements.push(claimText);
          } else {
            // Progress bar.
            const elapsed = now - slot.startAt;
            const ratio = Math.min(elapsed / slot.durationMs, 1);
            const bar = this.add.graphics();
            bar.fillStyle(0x0c1019, 0.8);
            bar.fillRoundedRect(px + pad + 8, y + 22, panelW - pad * 2 - 16, 4, 2);
            bar.fillStyle(0x3b82f6, 0.9);
            bar.fillRoundedRect(
              px + pad + 8,
              y + 22,
              Math.max((panelW - pad * 2 - 16) * ratio, 1),
              4,
              2,
            );
            this.codexPanelContainer.add(bar);
            this.codexPanelElements.push(bar);

            const mins = Math.ceil(remaining / 60_000);
            const timeText = this.add.text(px + pad + 8, y + 28, `${mins} min remaining`, {
              fontFamily: FONT,
              fontSize: "9px",
              color: TEXT.dim,
            });
            this.codexPanelContainer.add(timeText);
            this.codexPanelElements.push(timeText);
          }
          y += 46;
        }
      }

      // Claim button (if any complete).
      const hasComplete = activeSlots.some((s) => s.completeAt - now <= 0);
      if (hasComplete || this.explorationSlots.some((s) => !s.claimed && s.completeAt - now <= 0)) {
        const btnX = px + panelW - pad - 120;
        const btnY = y + 4;
        const btnBg = this.add.graphics();
        btnBg.fillStyle(0x22c55e, 0.9);
        btnBg.fillRoundedRect(btnX, btnY, 110, 26, 4);
        this.codexPanelContainer.add(btnBg);
        this.codexPanelElements.push(btnBg);

        const btnText = this.add
          .text(btnX + 55, btnY + 13, "📦 Claim All", {
            fontFamily: FONT,
            fontSize: "11px",
            color: "#ffffff",
            fontStyle: "bold",
          })
          .setOrigin(0.5);
        this.codexPanelContainer.add(btnText);
        this.codexPanelElements.push(btnText);

        const hitZone = this.add
          .zone(btnX + 55, btnY + 13, 110, 26)
          .setInteractive({ useHandCursor: true });
        hitZone.on("pointerdown", () => {
          const room = this.registry.get(ROOM_REGISTRY_KEY) as
            | Room<unknown, TownStateView>
            | undefined;
          if (room) room.send(MessageType.EXPLORATION_CLAIM, {});
        });
        this.codexPanelContainer.add(hitZone);
        this.codexPanelElements.push(hitZone);
        y += 36;
      }

      // Dispatch section.
      if (y + 80 < startY + maxH) {
        y += 8;
        const dispatchTitle = this.add.text(px + pad, y, "Send on Exploration", {
          fontFamily: FONT,
          fontSize: "11px",
          color: TEXT.bright,
          fontStyle: "bold",
        });
        this.codexPanelContainer.add(dispatchTitle);
        this.codexPanelElements.push(dispatchTitle);
        y += 20;

        // Show registered mobs that aren't currently dispatched.
        const dispatchedMobIds = new Set(
          this.explorationSlots.filter((s) => !s.claimed).map((s) => s.mobId),
        );
        const registeredMobs = Object.entries(this.codexData)
          .filter(([id, kills]) => kills >= 1 && !dispatchedMobIds.has(id))
          .slice(0, 12); // show up to 12

        if (registeredMobs.length === 0) {
          const emptyText = this.add.text(
            px + pad,
            y,
            "No available mobs to dispatch. Kill more to discover!",
            {
              fontFamily: FONT,
              fontSize: "10px",
              color: TEXT.dim,
            },
          );
          this.codexPanelContainer.add(emptyText);
          this.codexPanelElements.push(emptyText);
        } else {
          const durations: { key: "short" | "medium" | "long"; label: string }[] = [
            { key: "short", label: "15m" },
            { key: "medium", label: "1h" },
            { key: "long", label: "4h" },
          ];

          for (const [mobId, kills] of registeredMobs) {
            if (y + 22 > startY + maxH) break;
            const mobDef = MOBS[mobId];
            const mobName = mobDef?.name ?? mobId.split(".").pop() ?? mobId;

            const nameText = this.add.text(px + pad, y, `${mobName} (${kills} kills)`, {
              fontFamily: FONT,
              fontSize: "9px",
              color: TEXT.bright,
            });
            this.codexPanelContainer.add(nameText);
            this.codexPanelElements.push(nameText);

            for (let di = 0; di < durations.length; di++) {
              const d = durations[di];
              if (!d) continue;
              const btnX = px + panelW - pad - (3 - di) * 42;
              const btnBg = this.add.graphics();
              btnBg.fillStyle(0x2563eb, 0.7);
              btnBg.fillRoundedRect(btnX, y - 2, 36, 18, 3);
              this.codexPanelContainer.add(btnBg);
              this.codexPanelElements.push(btnBg);

              const btnLabel = this.add
                .text(btnX + 18, y + 7, d.label, {
                  fontFamily: FONT,
                  fontSize: "9px",
                  color: "#ffffff",
                  fontStyle: "bold",
                })
                .setOrigin(0.5);
              this.codexPanelContainer.add(btnLabel);
              this.codexPanelElements.push(btnLabel);

              const hitZone = this.add
                .zone(btnX + 18, y + 7, 36, 18)
                .setInteractive({ useHandCursor: true });
              const capturedMobId = mobId;
              const capturedDuration = d.key;
              hitZone.on("pointerdown", () => {
                const room = this.registry.get(ROOM_REGISTRY_KEY) as
                  | Room<unknown, TownStateView>
                  | undefined;
                if (room) {
                  room.send(MessageType.EXPLORATION_START, {
                    mobId: capturedMobId,
                    duration: capturedDuration,
                  });
                }
              });
              this.codexPanelContainer.add(hitZone);
              this.codexPanelElements.push(hitZone);
            }
            y += 22;
          }
        }
      }
    }
  }

  // ─── Achievement panel (toggled with J) ─────────────────────────────────
  private buildAchievePanel(): void {
    this.achievePanelBg = this.add.graphics();
    this.achievePanelContainer = this.add.container(0, 0, [this.achievePanelBg]);
    this.achievePanelContainer.setDepth(5000).setVisible(false);
  }

  private setupAchievePanelToggle(): void {
    this.game.events.on("keydown", (event: KeyboardEvent) => {
      if (event.key === "j" || event.key === "J") {
        if (this.chatFocused) return;
        this.achievePanelOpen = !this.achievePanelOpen;
        if (this.achievePanelOpen) {
          const room = this.registry.get(ROOM_REGISTRY_KEY) as
            | Room<unknown, TownStateView>
            | undefined;
          if (room) {
            room.send(MessageType.VIEW_ACHIEVEMENTS);
          }
        }
        this.renderAchievePanel();
      }
    });
  }

  private renderAchievePanel(): void {
    for (const el of this.achievePanelElements) el.destroy();
    this.achievePanelElements.length = 0;

    if (!this.achievePanelOpen) {
      this.achievePanelContainer.setVisible(false);
      return;
    }
    this.achievePanelContainer.setVisible(true);

    const sw = this.scale.width;
    const sh = this.scale.height;
    const panelW = 420;
    const pad = 14;
    const headerH = 36;
    const panelH = Math.min(sh - 40, 520);
    const px = (sw - panelW) / 2;
    const py = (sh - panelH) / 2;

    // Background.
    this.achievePanelBg.clear();
    this.achievePanelBg.fillStyle(PALETTE.panelFill, 0.95);
    this.achievePanelBg.fillRoundedRect(px, py, panelW, panelH, 8);
    this.achievePanelBg.lineStyle(1, PALETTE.panelStroke, 0.9);
    this.achievePanelBg.strokeRoundedRect(px, py, panelW, panelH, 8);
    this.achievePanelContainer.add(this.achievePanelBg);

    // Header.
    const header = this.add
      .text(px + panelW / 2, py + headerH / 2, "🏆 Achievements", {
        fontFamily: FONT,
        fontSize: "14px",
        color: TEXT.bright,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.achievePanelContainer.add(header);
    this.achievePanelElements.push(header);

    // Close button.
    const closeBtn = this.add
      .text(px + panelW - 20, py + 8, "✕", {
        fontFamily: FONT,
        fontSize: "16px",
        color: TEXT.dim,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    closeBtn.on("pointerdown", () => {
      this.achievePanelOpen = false;
      this.renderAchievePanel();
    });
    this.achievePanelContainer.add(closeBtn);
    this.achievePanelElements.push(closeBtn);

    // Summary.
    const completedCount = this.achieveData.filter((a) => a.completed).length;
    const summaryText = this.add.text(
      px + pad,
      py + headerH + 4,
      `${completedCount} / ${this.achieveData.length} completed`,
      { fontFamily: FONT, fontSize: "10px", color: TEXT.dim },
    );
    this.achievePanelContainer.add(summaryText);
    this.achievePanelElements.push(summaryText);

    // Category tabs.
    const categories = ["combat", "exploration", "collection", "milestone"] as const;
    const categoryLabels: Record<string, string> = {
      combat: "⚔️ Combat",
      exploration: "🗺️ Exploration",
      collection: "📦 Collection",
      milestone: "📈 Milestone",
    };
    let y = py + headerH + 24;

    // Category filter row.
    const allBtnBg = this.add.graphics();
    allBtnBg.fillStyle(0x2563eb, 0.8);
    allBtnBg.fillRoundedRect(px + pad, y, 40, 20, 3);
    this.achievePanelContainer.add(allBtnBg);
    this.achievePanelElements.push(allBtnBg);
    const allBtnLabel = this.add
      .text(px + pad + 20, y + 10, "All", {
        fontFamily: FONT,
        fontSize: "9px",
        color: "#ffffff",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.achievePanelContainer.add(allBtnLabel);
    this.achievePanelElements.push(allBtnLabel);

    for (let ci = 0; ci < categories.length; ci++) {
      const cat = categories[ci];
      const catX = px + pad + 46 + ci * 80;
      const catBg = this.add.graphics();
      catBg.fillStyle(0x1a2234, 0.8);
      catBg.fillRoundedRect(catX, y, 74, 20, 3);
      this.achievePanelContainer.add(catBg);
      this.achievePanelElements.push(catBg);
      const catLabel = this.add
        .text(catX + 37, y + 10, categoryLabels[cat] ?? cat, {
          fontFamily: FONT,
          fontSize: "9px",
          color: TEXT.dim,
        })
        .setOrigin(0.5);
      this.achievePanelContainer.add(catLabel);
      this.achievePanelElements.push(catLabel);
    }
    y += 28;

    // Achievement list.
    const contentY = y;
    const contentH = panelH - headerH - 28 - pad - (y - (py + headerH + 24));
    const rowH = 48;

    // Sort: uncompleted first, then completed.
    const sorted = [...this.achieveData].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return a.id.localeCompare(b.id);
    });

    let rowCount = 0;
    for (const ach of sorted) {
      if (rowCount * rowH + rowH > contentH) break;
      const ry = contentY + rowCount * rowH;
      const isCompleted = ach.completed;

      // Row background.
      const rowBg = this.add.graphics();
      rowBg.fillStyle(isCompleted ? 0x1a2a1a : 0x1a1a22, 0.7);
      rowBg.fillRoundedRect(px + pad, ry, panelW - pad * 2, rowH - 4, 4);
      rowBg.lineStyle(1, isCompleted ? 0x4a8a4a : PALETTE.panelStroke, 0.5);
      rowBg.strokeRoundedRect(px + pad, ry, panelW - pad * 2, rowH - 4, 4);
      this.achievePanelContainer.add(rowBg);
      this.achievePanelElements.push(rowBg);

      // Name + description.
      const nameColor = isCompleted ? "#9ad06b" : TEXT.bright;
      const nameText = this.add.text(px + pad + 8, ry + 4, ach.name, {
        fontFamily: FONT,
        fontSize: "10px",
        color: nameColor,
        fontStyle: "bold",
      });
      this.achievePanelContainer.add(nameText);
      this.achievePanelElements.push(nameText);

      const descText = this.add.text(px + pad + 8, ry + 18, ach.description, {
        fontFamily: FONT,
        fontSize: "9px",
        color: TEXT.dim,
        wordWrap: { width: panelW - pad * 2 - 16 },
      });
      this.achievePanelContainer.add(descText);
      this.achievePanelElements.push(descText);

      // Progress bar for each condition.
      const progress = ach.progress[0];
      if (progress) {
        const barX = px + pad + 8;
        const barY = ry + 34;
        const barW = panelW - pad * 2 - 16;
        const barH = 4;
        const ratio = Math.min(progress.current / Math.max(progress.target, 1), 1);
        const bar = this.add.graphics();
        bar.fillStyle(0x0c1019, 0.8);
        bar.fillRoundedRect(barX, barY, barW, barH, 2);
        bar.fillStyle(isCompleted ? 0x9ad06b : 0x3b82f6, 0.9);
        bar.fillRoundedRect(barX, barY, Math.max(barW * ratio, 1), barH, 2);
        this.achievePanelContainer.add(bar);
        this.achievePanelElements.push(bar);

        const progressLabel = this.add.text(
          barX + barW + 4,
          barY - 1,
          `${progress.current}/${progress.target}`,
          { fontFamily: FONT, fontSize: "8px", color: TEXT.dim },
        );
        this.achievePanelContainer.add(progressLabel);
        this.achievePanelElements.push(progressLabel);
      }

      // Completion badge.
      if (isCompleted) {
        const badge = this.add.text(px + panelW - pad - 16, ry + 4, "✅", {
          fontFamily: FONT,
          fontSize: "14px",
        });
        this.achievePanelContainer.add(badge);
        this.achievePanelElements.push(badge);
      }

      // Reward summary.
      const rewardParts: string[] = [];
      if (ach.rewards.mesos) rewardParts.push(`${ach.rewards.mesos} mesos`);
      if (ach.rewards.exp) rewardParts.push(`${ach.rewards.exp} exp`);
      if (ach.rewards.title) rewardParts.push(`Title: ${ach.rewards.title}`);
      if (rewardParts.length > 0) {
        const rewardText = this.add.text(px + panelW - pad - 16, ry + 22, rewardParts.join(" | "), {
          fontFamily: FONT,
          fontSize: "8px",
          color: TEXT.mesos,
        });
        this.achievePanelContainer.add(rewardText);
        this.achievePanelElements.push(rewardText);
      }

      rowCount++;
    }

    if (rowCount === 0) {
      const emptyText = this.add
        .text(px + panelW / 2, contentY + 40, "No achievements to display.", {
          fontFamily: FONT,
          fontSize: "11px",
          color: TEXT.dim,
          align: "center",
        })
        .setOrigin(0.5);
      this.achievePanelContainer.add(emptyText);
      this.achievePanelElements.push(emptyText);
    }
  }

  private teardown(): void {
    this.roomPoll?.remove();
    this.roomPoll = undefined;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    this.qsCooldownEndAt.clear();
    this.applyTextInputFocus(false);
    this.registry.set(DIALOG_OPEN_KEY, false);
    this.registry.set(DIALOG_STATE_KEY, null);
    // The dialog + quest log/offer/turn-in panels are React overlays — clear
    // their bridge-store snapshots so nothing lingers across a scene restart.
    uiStore.getState().setDialog(null);
    uiStore.getState().setQuestOffer(null);
    uiStore.getState().setQuestTurnin(null);
    uiStore.getState().setQuestLogOpen(false);
    // Stat / equipment / skill-tree / status-effects / report panels are React
    // overlays — reset their bridge-store snapshots + open flags.
    uiStore.getState().setStatPanelOpen(false);
    uiStore.getState().setEquipmentOpen(false);
    uiStore.getState().setSkillTreeOpen(false);
    uiStore.getState().setReportOpen(false);
    uiStore.getState().setHelpOpen(false);
    uiStore.getState().setStatusEffects([]);
    for (const el of this.guidePanelElements) el.destroy();
    this.guidePanelElements.length = 0;
    for (const el of this.cubePanelElements) el.destroy();
    this.cubePanelElements.length = 0;
    for (const el of this.upgradePanelElements) el.destroy();
    this.upgradePanelElements.length = 0;
    for (const el of this.partyHudElements) el.destroy();
    this.partyHudElements.length = 0;
    // World map is React — close on shutdown.
    if (uiStore.getState().worldMap.open) {
      uiStore.getState().setWorldMapOpen(false);
    }
    // Clean up moderation elements.
    for (const el of this.contextMenuElements) el.destroy();
    this.contextMenuElements.length = 0;
    for (const el of this.npcContextMenuElements) el.destroy();
    this.npcContextMenuElements.length = 0;
    for (const el of this.statsTooltipElements) el.destroy();
    this.statsTooltipElements.length = 0;
    for (const el of this.blockedElements) el.destroy();
    this.blockedElements.length = 0;
    for (const el of this.familiarPanelElements) el.destroy();
    this.familiarPanelElements.length = 0;
    for (const el of this.codexPanelElements) el.destroy();
    this.codexPanelElements.length = 0;
    this.game.events.off("player-rightclick");
    this.game.events.off("npc-rightclick");
    if (this._feedbackEventHandler) {
      window.removeEventListener("open-feedback", this._feedbackEventHandler);
    }
  }
}
