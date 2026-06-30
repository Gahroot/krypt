import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";
import { InventoryItem } from "./InventoryItem";
import type { InputData } from "../../types";
import type {
  QuestState,
  CodexState,
  FameState,
  AchievementProgress,
  PlayerSettings,
  StatusEffect,
  ExplorationState,
} from "@maple/shared";
import { DEFAULT_SETTINGS } from "@maple/shared";

/**
 * Player — the authoritative character state, synced to all clients in the room.
 * Server-only fields (input queue, cooldowns) are plain properties WITHOUT @type so they never sync.
 */
export class Player extends Schema {
  // ─ Transform ─
  @type("number") x = 0;
  @type("number") y = 0;
  @type("int8") facing = 1; // -1 = left, 1 = right
  @type("number") tick = 0; // last processed input tick (for client reconciliation)

  // ─ Identity ─
  @type("string") name = "";
  @type("string") archetype = "BEGINNER";
  @type("uint8") jobTier = 0; // 0 = Beginner, 1 = 1st job, 2 = 2nd job branch, etc.
  @type("string") branchId = ""; // e.g. "berserker" — set on 2nd-job advancement

  // ─ Appearance (synced so clients can render looks) ─
  @type("string") gender = "M";
  @type("string") skinId = "";
  @type("string") hairId = "";
  @type("string") hairColorId = "";
  @type("string") faceId = "";
  @type("string") outfitId = "";

  // ─ Vitals ─
  @type("uint8") level = 1;
  @type("int16") hp = 50;
  @type("int16") maxHp = 50;
  @type("int16") mp = 5;
  @type("int16") maxMp = 5;
  @type("boolean") dead = false;
  // False while the owner is in the reconnection grace window (flaky-connection drop).
  // The entity is held in room state during this window; flips back to true on reconnect.
  @type("boolean") connected = true;

  // ─ Stats (STR/DEX/INT/LUK) ─
  @type("uint16") str = 4;
  @type("uint16") dex = 4;
  @type("uint16") intel = 4;
  @type("uint16") luk = 4;

  // ─ Progression ─
  @type("uint32") exp = 0;
  @type("uint16") ap = 0; // unspent ability points
  @type("uint16") sp = 0; // unspent skill points
  @type("uint32") mesos = 0;

  // ─ Combat presentation ─
  @type("boolean") attacking = false;
  @type("string") attackType = "MELEE"; // synced so the client plays the right attack visual
  @type("uint16") comboCount = 0; // synced: consecutive-hit combo counter

  // ─ Side-scroller physics ─
  @type("number") vy = 0; // vertical velocity
  @type("boolean") grounded = false;
  @type("boolean") climbing = false; // on a ladder/rope
  @type("int16") ladderId = -1; // which ladder is being climbed (-1 = none)

  // ─ Owned items ─
  @type({ map: InventoryItem }) inventory = new MapSchema<InventoryItem>();

  // ─ Equipped gear (slot name → item uid) ─
  @type({ map: "string" }) equipped = new MapSchema<string>();

  // ─ Titles ─
  @type("string") equippedTitle = "";
  @type(["string"]) ownedTitles: ArraySchema<string> = new ArraySchema<string>();

  // ─ Fame (synced display value) ─
  @type("int16") displayFame = 0;

  // ─── Synced identity ───────────────────────────────────────────────
  @type("string") charId = ""; // persistent character id for mesos/inventory writes

  // ─── Server-only (NOT synced) ───────────────────────────────────────
  accountId = "";
  inputQueue: InputData[] = [];
  attackCooldown = 0; // ms remaining before next melee swing
  attackTimer = 0; // ms remaining of the current swing animation
  respawnTimer = 0; // ms remaining before respawn when dead
  dropThroughTimer = 0; // ms of grace after dropping through a platform
  dropThroughFootholdId = -1; // id of the foothold being dropped through (-1 = none)
  lastJumpHeld = false; // edge-trigger: was jump held last tick?
  lastInteractHeld = false; // edge-trigger: was interact held last tick?
  vx = 0; // horizontal velocity (server-only, not synced)
  /** Epoch (ms) when invulnerability frames expire; 0 = no i-frames active. */
  iframesUntil = 0;
  /** Epoch (ms) of the last successful hit — drives the combo window timer. */
  comboLastHitAt = 0;
  /** Server-authoritative knockback velocity applied after taking contact/boss damage. */
  knockbackVx = 0;

  // ─── Dialog (server-only, not synced) ────────────────────────────────
  dialogNpcId = ""; // currently talking to this NPC (empty = no dialog active)
  dialogNodeIndex = 0; // current position in the NPC's dialog tree

  // ─── Quests (server-only, not synced) ────────────────────────────────
  questState: QuestState[] = [];
  /** Pending quest offer waiting for accept/decline (quest id). */
  pendingQuestOffer: string | undefined;
  /** Pending quest turn-in waiting for accept/decline (quest id). */
  pendingQuestTurnin: string | undefined;

  // ─── Settings (server-only, not synced) ────────────────────────────
  /** Player settings (controls + video + audio + gameplay). */
  settings: PlayerSettings = structuredClone(DEFAULT_SETTINGS);

  // ─── Active effects (server-only, not synced) ─────────────────────────
  /** Timed status effects currently applied to this player (buffs, debuffs, DoT, HoT). */
  activeEffects: StatusEffect[] = [];
  /** Elapsed time per effect id — mutable, owned by tickEffects. */
  effectElapsed = new Map<string, number>();

  // ─── Skills (server-only, not synced) ────────────────────────────────
  /** Skill IDs the character has unlocked (granted by job advancement). */
  learnedSkills: string[] = [];
  /** Skill book: skillId → learned level (SP investment per skill). */
  skillBook: Record<string, number> = {};
  /** Active skill cooldowns: skillId → remaining ms. */
  skillCooldowns = new Map<string, number>();
  /** Active consumable cooldowns: defId → remaining ms. */
  consumableCooldowns = new Map<string, number>();
  /** Quickslot layout: slot index → {type, id} or null. */
  quickslots: ({ type: "skill" | "consumable"; id: string } | null)[] = [];

  // ─── Retention systems (server-only, not synced) ────────────────────
  /** Monster Codex: mobId → total kill count. */
  codex: CodexState = {};
  /** Fame state: current fame + daily history. */
  fame: FameState = { fame: 0, fameHistory: {} };
  /** Achievement progress: achievementId → condition values. */
  achievements: AchievementProgress = {};
  /** Total mesos earned (lifetime, for achievement tracking). */
  totalMesosEarned = 0;
  /** Total quests completed (lifetime, for achievement tracking). */
  totalQuestsCompleted = 0;
  /** Total items collected (lifetime, for achievement tracking). */
  totalItemsCollected = 0;

  // ─── Combat QoL (server-only, not synced) ──────────────────────────────
  /** Auto-pot config: threshold-based auto-use of HP/MP potions. */
  autoPot: import("@maple/shared").AutoPotConfig = {
    hpEnabled: false,
    hpThreshold: 50,
    mpEnabled: false,
    mpThreshold: 50,
    hpPotionId: "pot.large_hp",
    mpPotionId: "pot.large_mp",
  };
  /** Skill macros: named sequences of skills/consumables. */
  macros: import("@maple/shared").SkillMacro[] = [];

  // ─── Exploration Dispatch (idle Monster Collection, server-only) ──────────
  /** Active exploration dispatch slots. */
  exploration: ExplorationState = { slots: [] };
}
