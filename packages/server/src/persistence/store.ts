/**
 * Durable persistence for the off-chain economy: player accounts, multi-character records (Mesos +
 * owned items per character), the global Free-Market order book, guilds, and the mesos treasury.
 *
 * Both TownRoom and MarketRoom share these singletons, so the loop is real: loot an item in town →
 * it lands in your character → open the market → list it → another character buys it → Mesos move.
 *
 * Backed by SQLite (via better-sqlite3) with WAL mode for concurrent reads. Complex nested data
 * (inventory, equipped gear, appearance, stats, quests, skill book, account storage) is stored as
 * JSON columns — loaded and saved as a unit, with a clear path to normalize later.
 *
 * This is the off-chain economy. The on-chain Premium Market ($MAPLE, NFTs) is Phase 2; this layer
 * is exactly what gets mirrored on-chain later.
 */
import type {
  CharacterAppearance,
  CashCategory,
  QuestState,
  GuildRank,
  CodexState,
  FameState,
  AchievementProgress,
  PlayerSettings,
  AutoPotConfig,
  SkillMacro,
  ExplorationState,
} from "@maple/shared";
import type Database from "better-sqlite3";
import { openDb } from "./db";
import { guildManager } from "../guildManager";
import { friendManager } from "../friendManager";

// ─── Constants ─────────────────────────────────────────────────────────────

/** Mesos granted to a brand-new character so the market is immediately explorable. */
const STARTER_MESOS = 300;

/** Premium currency granted to every new account for dev/testing. */
const STARTER_CASH = 10_000;

// ─── Types (unchanged) ─────────────────────────────────────────────────────

export interface ItemRecord {
  uid: string;
  defId: string;
  baseRank: string;
  potentialTier: string;
  lines: number;
  minted: boolean;
  potentialLines?: import("@maple/shared").PotentialLine[];
  bonusStats?: import("@maple/shared").BonusStatLine[];
  /** Star Force level (0–15). */
  stars?: number;
  count?: number;
}

/** Account-wide record. Cash balance, cash inventory, and shared storage live here. */
export interface Account {
  accountId: string;
  /** Premium currency balance (Maple Crystals). Account-wide. */
  cash: number;
  /** Owned cash-item ids. Account-wide — any character on this account can equip owned cosmetics. */
  cashInventory: string[];
  /** Shared stash: items accessible by any character on this account. */
  storage: Record<string, ItemRecord>;
  /** Moderation role: "player" (default), "gm", or "admin". */
  role: string;
  /** Epoch ms until which the account is muted. null = not muted. */
  mutedUntil: number | null;
  /** Whether the account is banned (cannot join). */
  banned: boolean;
  /** Reason for the ban (for audit). */
  banReason: string;
  /** Character names this account has blocked. */
  blockedPlayers: string[];
}

/** Per-server treasury — tracks mesos removed from circulation (sinks). */
export interface Treasury {
  /** Total mesos burned since server inception. */
  totalBurned: number;
  /** Breakdown by reason for auditing. */
  byReason: Record<string, number>;
}

/** Max number of slots in the shared account stash. */
export const STORAGE_CAPACITY = 48;

/**
 * A single playable character. Mesos and inventory live here (not on Account).
 */
export interface CharacterRecord {
  charId: string;
  accountId: string;
  name: string;
  archetype: string;
  /** Job tier: 0 = Beginner, 1 = 1st job, 2 = 2nd job branch, etc. */
  jobTier?: number;
  /** Branch id chosen at 2nd-job advancement (e.g. "berserker"). */
  branchId?: string;
  appearance: CharacterAppearance;
  level: number;
  exp: number;
  ap: number;
  sp: number;
  stats: {
    STR: number;
    DEX: number;
    INT: number;
    LUK: number;
    HP: number;
    MP: number;
  };
  maxHp: number;
  maxMp: number;
  mesos: number;
  mapId: string;
  x: number;
  y: number;
  inventory: Record<string, ItemRecord>;
  equipped?: Record<string, string>;
  /** Per-character equipped cash items: category → equip record (itemId + expiry). */
  equippedCash?: Record<string, { itemId: string; equippedAt: number; durationDays?: number }>;
  quests?: QuestState[];
  /** Skill IDs the character has unlocked (granted by job advancement). */
  learnedSkills?: string[];
  /** Skill book: skillId → learned level. */
  skillBook?: Record<string, number>;
  /** Monster Codex: mobId → total kill count. */
  codex?: CodexState;
  /** Fame state: current fame + daily history. */
  fame?: FameState;
  /** Achievement progress: achievementId → condition progress values. */
  achievements?: AchievementProgress;
  /** Total mesos earned (lifetime, for achievement tracking). */
  totalMesosEarned?: number;
  /** Total quests completed (lifetime, for achievement tracking). */
  totalQuestsCompleted?: number;
  /** Total items collected (lifetime, for achievement tracking). */
  totalItemsCollected?: number;
  /** Quickslot layout: slot index → {type, id} entry. */
  quickslots?: ({ type: "skill" | "consumable"; id: string } | null)[];
  /** Player settings (controls + video + audio + gameplay). */
  settings?: PlayerSettings;
  /** Auto-pot threshold config. */
  autoPot?: AutoPotConfig;
  /** Skill macros: named sequences of skills/consumables. */
  macros?: SkillMacro[];
  /** Familiar collection: registered card mob ids + currently summoned mob ids. */
  familiars?: import("@maple/shared").FamiliarCollection;
  /** Exploration dispatch slots. */
  exploration?: ExplorationState;
  /** Owned title strings (earned from achievements). */
  ownedTitles?: string[];
  /** Currently equipped title (shown above character). */
  equippedTitle?: string;
  /** Epoch-ms of the last daily quest reset for this character. */
  lastDailyResetAt?: number;
  /** Daily quest completion log: questId → epoch-ms of last turn-in. */
  dailyCompletions?: Record<string, number>;
  createdAt: number;
}

export interface ListingRecord {
  listingId: string;
  sellerId: string;
  sellerName: string;
  item: ItemRecord;
  price: number;
  createdAt: number;
  listingType: string; // "fixed" | "auction"
  endsAt: number; // epoch-ms, 0 = no expiry
  currentBid: number; // auction only
  highBidderCharId: string; // auction only
}

export interface BuyOrderRecord {
  buyOrderId: string;
  buyerCharId: string;
  buyerName: string;
  defId: string;
  maxPrice: number;
  qty: number;
  mesosEscrowed: number;
  createdAt: number;
}

export interface PriceHistoryRecord {
  id?: number;
  defId: string;
  salePrice: number;
  soldAt: number;
}

// ─── DB column helpers ─────────────────────────────────────────────────────

/** Map JS field names → SQL column names for the characters table. */
const CHAR_COL: Record<keyof CharacterRecord, string> = {
  charId: "char_id",
  accountId: "account_id",
  name: "name",
  archetype: "archetype",
  jobTier: "job_tier",
  branchId: "branch_id",
  appearance: "appearance",
  level: "level",
  exp: "exp",
  ap: "ap",
  sp: "sp",
  stats: "stats",
  maxHp: "max_hp",
  maxMp: "max_mp",
  mesos: "mesos",
  mapId: "map_id",
  x: "x",
  y: "y",
  inventory: "inventory",
  equipped: "equipped",
  equippedCash: "equipped_cash",
  quests: "quests",
  learnedSkills: "learned_skills",
  skillBook: "skill_book",
  codex: "codex",
  fame: "fame",
  achievements: "achievements",
  totalMesosEarned: "total_mesos_earned",
  totalQuestsCompleted: "total_quests_completed",
  totalItemsCollected: "total_items_collected",
  quickslots: "quickslots",
  settings: "settings",
  autoPot: "auto_pot",
  macros: "macros",
  familiars: "familiars",
  exploration: "exploration",
  ownedTitles: "owned_titles",
  equippedTitle: "equipped_title",
  lastDailyResetAt: "last_daily_reset_at",
  dailyCompletions: "daily_completions",
  createdAt: "created_at",
};

const JSON_CHAR_KEYS: ReadonlySet<keyof CharacterRecord> = new Set([
  "appearance",
  "stats",
  "inventory",
  "equipped",
  "equippedCash",
  "quests",
  "learnedSkills",
  "skillBook",
  "codex",
  "fame",
  "achievements",
  "quickslots",
  "settings",
  "autoPot",
  "macros",
  "familiars",
  "exploration",
  "ownedTitles",
  "dailyCompletions",
]);

/** Serialize a CharacterRecord row for SQL INSERT/UPDATE. */
function serializeCharRow(rec: CharacterRecord): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [jsKey, sqlCol] of Object.entries(CHAR_COL)) {
    const val = rec[jsKey as keyof CharacterRecord];
    if (JSON_CHAR_KEYS.has(jsKey as keyof CharacterRecord)) {
      // JSON.stringify(undefined) → undefined (not a string), so coalesce to SQL-friendly defaults.
      row[sqlCol] =
        val != null
          ? JSON.stringify(val)
          : jsKey === "learnedSkills" ||
              jsKey === "quickslots" ||
              jsKey === "macros" ||
              jsKey === "ownedTitles"
            ? "[]"
            : jsKey === "familiars"
              ? '{"registered":[],"summoned":[]}'
              : jsKey === "exploration"
                ? '{"slots":[]}'
                : jsKey === "skillBook" ||
                    jsKey === "settings" ||
                    jsKey === "autoPot" ||
                    jsKey === "dailyCompletions"
                  ? "{}"
                  : null;
    } else {
      // Coalesce undefined to safe defaults so NOT NULL columns never get NULL.
      if (val === undefined || val === null) {
        row[sqlCol] = jsKey === "jobTier" ? 0 : jsKey === "branchId" ? "" : val;
      } else {
        row[sqlCol] = val;
      }
    }
  }
  return row;
}

/** Deserialize a raw SQL row back into a CharacterRecord. */
function deserializeCharRow(row: Record<string, unknown>): CharacterRecord {
  return {
    charId: row.char_id as string,
    accountId: row.account_id as string,
    name: row.name as string,
    archetype: row.archetype as string,
    jobTier: row.job_tier as number | undefined,
    branchId: row.branch_id as string | undefined,
    appearance: JSON.parse(row.appearance as string) as CharacterAppearance,
    level: row.level as number,
    exp: row.exp as number,
    ap: row.ap as number,
    sp: row.sp as number,
    stats: JSON.parse(row.stats as string) as CharacterRecord["stats"],
    maxHp: row.max_hp as number,
    maxMp: row.max_mp as number,
    mesos: row.mesos as number,
    mapId: row.map_id as string,
    x: row.x as number,
    y: row.y as number,
    inventory: JSON.parse(row.inventory as string) as Record<string, ItemRecord>,
    equipped:
      row.equipped != null
        ? (JSON.parse(row.equipped as string) as Record<string, string>)
        : undefined,
    equippedCash:
      row.equipped_cash != null
        ? (JSON.parse(row.equipped_cash as string) as Record<
            string,
            { itemId: string; equippedAt: number; durationDays?: number }
          >)
        : undefined,
    quests: row.quests != null ? (JSON.parse(row.quests as string) as QuestState[]) : undefined,
    learnedSkills:
      row.learned_skills != null
        ? (JSON.parse(row.learned_skills as string) as string[])
        : undefined,
    skillBook:
      row.skill_book != null
        ? (JSON.parse(row.skill_book as string) as Record<string, number>)
        : undefined,
    codex: row.codex != null ? (JSON.parse(row.codex as string) as CodexState) : undefined,
    fame: row.fame != null ? (JSON.parse(row.fame as string) as FameState) : undefined,
    achievements:
      row.achievements != null
        ? (JSON.parse(row.achievements as string) as AchievementProgress)
        : undefined,
    totalMesosEarned: row.total_mesos_earned as number | undefined,
    totalQuestsCompleted: row.total_quests_completed as number | undefined,
    totalItemsCollected: row.total_items_collected as number | undefined,
    quickslots:
      row.quickslots != null
        ? (JSON.parse(row.quickslots as string) as CharacterRecord["quickslots"])
        : undefined,
    settings:
      row.settings != null ? (JSON.parse(row.settings as string) as PlayerSettings) : undefined,
    autoPot:
      row.auto_pot != null ? (JSON.parse(row.auto_pot as string) as AutoPotConfig) : undefined,
    macros: row.macros != null ? (JSON.parse(row.macros as string) as SkillMacro[]) : undefined,
    familiars:
      row.familiars != null
        ? (JSON.parse(row.familiars as string) as import("@maple/shared").FamiliarCollection)
        : undefined,
    exploration:
      row.exploration != null
        ? (JSON.parse(row.exploration as string) as ExplorationState)
        : undefined,
    ownedTitles:
      row.owned_titles != null ? (JSON.parse(row.owned_titles as string) as string[]) : [],
    equippedTitle: (row.equipped_title as string) || "",
    lastDailyResetAt: row.last_daily_reset_at as number | undefined,
    dailyCompletions:
      row.daily_completions != null
        ? (JSON.parse(row.daily_completions as string) as Record<string, number>)
        : undefined,
    createdAt: row.created_at as number,
  };
}

// ─── AccountStore ──────────────────────────────────────────────────────────

export class AccountStore {
  /** In-memory cache — read from here on hot path, write-through to SQLite. */
  private accounts = new Map<string, Account>();
  private characters = new Map<string, CharacterRecord>();
  private charSeq = 0;
  private db: Database.Database;

  constructor(dataDir?: string) {
    // Resolve path: if it ends with .db treat as file, otherwise as directory.
    let dbPath: string | undefined;
    if (dataDir) {
      dbPath = dataDir.endsWith(".db") ? dataDir : `${dataDir}/maple.db`;
    }
    this.db = openDb(dbPath);

    // ── Hydrate accounts cache ────────────────────────────────────────────
    const acctRows = this.db.prepare("SELECT * FROM accounts").all() as Record<string, unknown>[];
    for (const r of acctRows) {
      this.accounts.set(r.account_id as string, {
        accountId: r.account_id as string,
        cash: r.cash as number,
        cashInventory: JSON.parse(r.cash_inventory as string) as string[],
        storage: JSON.parse(r.storage as string) as Record<string, ItemRecord>,
        role: (r.role as string) || "player",
        mutedUntil: r.muted_until != null ? (r.muted_until as number) : null,
        banned: (r.banned as number) === 1,
        banReason: (r.ban_reason as string) || "",
        blockedPlayers: JSON.parse(r.blocked_players as string) as string[],
      });
    }

    // ── Hydrate characters cache ──────────────────────────────────────────
    const charRows = this.db.prepare("SELECT * FROM characters").all() as Record<string, unknown>[];
    for (const row of charRows) {
      const rec = deserializeCharRow(row);
      this.characters.set(rec.charId, rec);
      const n = Number(rec.charId.split("_")[1]);
      if (Number.isFinite(n) && n > this.charSeq) this.charSeq = n;
    }
    // Backfill quickslots on older character records.
    for (const chr of this.characters.values()) {
      if (!chr.quickslots) chr.quickslots = [];
    }
    for (const chr of this.characters.values()) {
      if (!chr.autoPot)
        chr.autoPot = {
          hpEnabled: false,
          hpThreshold: 50,
          mpEnabled: false,
          mpThreshold: 50,
          hpPotionId: "pot.large_hp",
          mpPotionId: "pot.large_mp",
        };
      if (!chr.macros) chr.macros = [];
    }
  }

  // ─── Account-level ──────────────────────────────────────────────────────────

  getOrCreate(accountId: string): Account {
    let acc = this.accounts.get(accountId);
    if (!acc) {
      acc = {
        accountId,
        cash: STARTER_CASH,
        cashInventory: [],
        storage: {},
        role: "player",
        mutedUntil: null,
        banned: false,
        banReason: "",
        blockedPlayers: [],
      };
      this.accounts.set(accountId, acc);
      this.db
        .prepare(
          "INSERT INTO accounts (account_id, cash, cash_inventory, storage) VALUES (?, ?, ?, ?)",
        )
        .run(accountId, acc.cash, JSON.stringify(acc.cashInventory), JSON.stringify(acc.storage));
    }
    // Backfill fields missing from older persistence snapshots.
    if (acc.cash === undefined) acc.cash = STARTER_CASH;
    if (!acc.cashInventory) acc.cashInventory = [];
    if (!acc.storage) acc.storage = {};
    if (!acc.role) acc.role = "player";
    if (acc.mutedUntil === undefined) acc.mutedUntil = null;
    if (acc.banned === undefined) acc.banned = false;
    if (!acc.banReason) acc.banReason = "";
    if (!acc.blockedPlayers) acc.blockedPlayers = [];

    // Backfill codex/fame/achievements on older character records.
    for (const chr of this.characters.values()) {
      if (chr.accountId !== accountId) continue;
      if (!chr.codex) chr.codex = {};
      if (!chr.fame) chr.fame = { fame: 0, fameHistory: {} };
      if (!chr.achievements) chr.achievements = {};
      if (!chr.ownedTitles) chr.ownedTitles = [];
      if (chr.equippedTitle === undefined) chr.equippedTitle = "";
    }

    return acc;
  }

  private persistAccount(acc: Account): void {
    this.db
      .prepare(
        "INSERT INTO accounts (account_id, cash, cash_inventory, storage, role, muted_until, banned, ban_reason, blocked_players) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(account_id) DO UPDATE SET cash=excluded.cash, cash_inventory=excluded.cash_inventory, storage=excluded.storage, " +
          "role=excluded.role, muted_until=excluded.muted_until, banned=excluded.banned, ban_reason=excluded.ban_reason, blocked_players=excluded.blocked_players",
      )
      .run(
        acc.accountId,
        acc.cash,
        JSON.stringify(acc.cashInventory),
        JSON.stringify(acc.storage),
        acc.role,
        acc.mutedUntil,
        acc.banned ? 1 : 0,
        acc.banReason,
        JSON.stringify(acc.blockedPlayers),
      );
  }

  // ─── Moderation methods ─────────────────────────────────────────────────

  /** Get an account by id (or undefined if not found). */
  getAccount(accountId: string): Account | undefined {
    return this.accounts.get(accountId);
  }

  /** Check if an account is currently muted. */
  isMuted(accountId: string): boolean {
    const acc = this.accounts.get(accountId);
    if (!acc || !acc.mutedUntil) return false;
    if (Date.now() < acc.mutedUntil) return true;
    // Expired — clear it.
    acc.mutedUntil = null;
    this.persistAccount(acc);
    return false;
  }

  /** Mute an account until a given epoch ms. Pass null to unmute. */
  setMuted(accountId: string, mutedUntil: number | null): void {
    const acc = this.accounts.get(accountId);
    if (!acc) return;
    acc.mutedUntil = mutedUntil;
    this.persistAccount(acc);
  }

  /** Ban an account. */
  setBanned(accountId: string, banned: boolean, reason = ""): void {
    const acc = this.accounts.get(accountId);
    if (!acc) return;
    acc.banned = banned;
    acc.banReason = reason;
    this.persistAccount(acc);
  }

  /** Set the role for an account ("player", "gm", or "admin"). */
  setRole(accountId: string, role: string): void {
    const acc = this.accounts.get(accountId);
    if (!acc) return;
    acc.role = role;
    this.persistAccount(acc);
  }

  /** Add a name to the account's block list. */
  blockPlayer(accountId: string, targetName: string): boolean {
    const acc = this.accounts.get(accountId);
    if (!acc) return false;
    const lower = targetName.toLowerCase();
    if (acc.blockedPlayers.some((n) => n.toLowerCase() === lower)) return false;
    acc.blockedPlayers.push(targetName);
    this.persistAccount(acc);
    return true;
  }

  /** Remove a name from the account's block list. */
  unblockPlayer(accountId: string, targetName: string): boolean {
    const acc = this.accounts.get(accountId);
    if (!acc) return false;
    const lower = targetName.toLowerCase();
    const idx = acc.blockedPlayers.findIndex((n) => n.toLowerCase() === lower);
    if (idx < 0) return false;
    acc.blockedPlayers.splice(idx, 1);
    this.persistAccount(acc);
    return true;
  }

  /** Check if accountId has blocked targetName. */
  hasBlocked(accountId: string, targetName: string): boolean {
    const acc = this.accounts.get(accountId);
    if (!acc) return false;
    const lower = targetName.toLowerCase();
    return acc.blockedPlayers.some((n) => n.toLowerCase() === lower);
  }

  // ─── Friends (persistent per-account buddy list) ───────────────────────────

  /** Record a friend relationship in the DB (call for both directions). */
  addFriend(accountId: string, friendAccountId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO friends (account_id, friend_account_id) VALUES (?, ?)")
      .run(accountId, friendAccountId);
  }

  /** Remove a friend relationship from the DB (call for both directions). */
  removeFriend(accountId: string, friendAccountId: string): void {
    this.db
      .prepare("DELETE FROM friends WHERE account_id = ? AND friend_account_id = ?")
      .run(accountId, friendAccountId);
  }

  /** Get friend accountIds for a given account from the DB. */
  getFriendAccountIds(accountId: string): string[] {
    const rows = this.db
      .prepare("SELECT friend_account_id FROM friends WHERE account_id = ?")
      .all(accountId) as { friend_account_id: string }[];
    return rows.map((r) => r.friend_account_id);
  }

  // ─── Character CRUD ─────────────────────────────────────────────────────────

  createCharacter(
    accountId: string,
    opts: { name: string; archetype: string; appearance: CharacterAppearance },
  ): CharacterRecord {
    this.getOrCreate(accountId); // ensure account shell exists

    const charId = `chr_${++this.charSeq}`;
    const rec: CharacterRecord = {
      charId,
      accountId,
      name: opts.name.slice(0, 16),
      archetype: opts.archetype,
      jobTier: 0,
      branchId: "",
      appearance: opts.appearance,
      level: 1,
      exp: 0,
      ap: 0,
      sp: 0,
      maxHp: 50,
      maxMp: 5,
      stats: { STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0, MP: 0 },
      mesos: STARTER_MESOS,
      mapId: "meadowfield",
      x: 0,
      y: 0,
      inventory: {},
      codex: {},
      fame: { fame: 0, fameHistory: {} },
      achievements: {},
      totalMesosEarned: 0,
      totalQuestsCompleted: 0,
      totalItemsCollected: 0,
      quickslots: [],
      ownedTitles: [],
      equippedTitle: "",
      createdAt: Date.now(),
    };
    this.characters.set(charId, rec);

    const row = serializeCharRow(rec);
    const cols = Object.keys(row).join(", ");
    const placeholders = Object.keys(row)
      .map(() => "?")
      .join(", ");
    this.db
      .prepare(`INSERT INTO characters (${cols}) VALUES (${placeholders})`)
      .run(...Object.values(row));

    return rec;
  }

  listCharacters(accountId: string): CharacterRecord[] {
    return [...this.characters.values()].filter((c) => c.accountId === accountId);
  }

  getCharacter(charId: string): CharacterRecord | undefined {
    return this.characters.get(charId);
  }

  /** Look up a character by name (case-insensitive). Returns undefined if not found. */
  getCharacterByName(name: string): CharacterRecord | undefined {
    const lower = name.toLowerCase();
    for (const rec of this.characters.values()) {
      if (rec.name.toLowerCase() === lower) return rec;
    }
    return undefined;
  }

  /** Check whether a character name is already taken (case-insensitive). */
  characterNameExists(name: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM characters WHERE LOWER(name) = LOWER(?)").get(name);
    return !!row;
  }

  updateCharacter(charId: string, patch: Partial<CharacterRecord>): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    Object.assign(rec, patch);
    this.writeCharacter(rec);
  }

  deleteCharacter(charId: string): boolean {
    const existed = this.characters.delete(charId);
    if (existed) {
      this.db.prepare("DELETE FROM characters WHERE char_id = ?").run(charId);
    }
    return existed;
  }

  /** Write a full character row to SQLite. */
  private writeCharacter(rec: CharacterRecord): void {
    const row = serializeCharRow(rec);
    const sets = Object.keys(row)
      .map((k) => `${k}=?`)
      .join(", ");
    this.db
      .prepare(`UPDATE characters SET ${sets} WHERE char_id=?`)
      .run(...Object.values(row), rec.charId);
  }

  // ─── Account-level premium currency ─────────────────────────────────────────

  getCash(accountId: string): number {
    return this.getOrCreate(accountId).cash;
  }

  /** Returns true and deducts if affordable; false otherwise. */
  spendCash(accountId: string, amount: number): boolean {
    const acc = this.getOrCreate(accountId);
    if (acc.cash < amount) return false;
    acc.cash -= amount;
    this.persistAccount(acc);
    return true;
  }

  addCashInventory(accountId: string, itemId: string): void {
    const acc = this.getOrCreate(accountId);
    if (!acc.cashInventory.includes(itemId)) {
      acc.cashInventory.push(itemId);
      this.persistAccount(acc);
    }
  }

  hasCashItem(accountId: string, itemId: string): boolean {
    return this.getOrCreate(accountId).cashInventory.includes(itemId);
  }

  /** Equip a cash item on a character (category-slot based). */
  equipCashItem(
    charId: string,
    itemId: string,
    category: CashCategory,
    durationDays?: number,
  ): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    if (!rec.equippedCash) rec.equippedCash = {};
    rec.equippedCash[category] = {
      itemId,
      equippedAt: Date.now(),
      durationDays,
    };
    this.db
      .prepare("UPDATE characters SET equipped_cash=? WHERE char_id=?")
      .run(JSON.stringify(rec.equippedCash), charId);
  }

  /** Remove the equipped cash item in the given category. */
  unequipCashCategory(charId: string, category: CashCategory): void {
    const rec = this.characters.get(charId);
    if (!rec?.equippedCash) return;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete rec.equippedCash[category];
    this.db
      .prepare("UPDATE characters SET equipped_cash=? WHERE char_id=?")
      .run(JSON.stringify(rec.equippedCash), charId);
  }

  /** Get the equipped cash entry for a given category on a character. */
  getEquippedCash(
    charId: string,
    category: CashCategory,
  ): { itemId: string; equippedAt: number; durationDays?: number } | undefined {
    return this.characters.get(charId)?.equippedCash?.[category];
  }

  /** Remove all expired cash cosmetics from a character. Returns the list of category keys that were expired. */
  expireCashItems(charId: string): string[] {
    const rec = this.characters.get(charId);
    if (!rec?.equippedCash) return [];
    const now = Date.now();
    const MS_PER_DAY = 86_400_000;
    const expired: string[] = [];
    for (const [cat, entry] of Object.entries(rec.equippedCash)) {
      if (entry.durationDays && now >= entry.equippedAt + entry.durationDays * MS_PER_DAY) {
        expired.push(cat);
      }
    }
    for (const cat of expired) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete rec.equippedCash[cat];
    }
    if (expired.length > 0) {
      this.db
        .prepare("UPDATE characters SET equipped_cash=? WHERE char_id=?")
        .run(JSON.stringify(rec.equippedCash), charId);
    }
    return expired;
  }

  // ─── Character-level mesos ──────────────────────────────────────────────────

  setMesos(charId: string, mesos: number): void {
    const rec = this.characters.get(charId);
    if (rec) {
      rec.mesos = Math.max(0, Math.floor(mesos));
      this.db.prepare("UPDATE characters SET mesos=? WHERE char_id=?").run(rec.mesos, charId);
    }
  }

  addMesos(charId: string, delta: number): number {
    const rec = this.characters.get(charId);
    if (!rec) return 0;
    rec.mesos = Math.max(0, rec.mesos + Math.floor(delta));
    this.db.prepare("UPDATE characters SET mesos=? WHERE char_id=?").run(rec.mesos, charId);
    return rec.mesos;
  }

  /** Returns true and deducts if affordable; false otherwise. */
  spendMesos(charId: string, amount: number): boolean {
    const rec = this.characters.get(charId);
    if (!rec || rec.mesos < amount) return false;
    rec.mesos -= amount;
    this.db.prepare("UPDATE characters SET mesos=? WHERE char_id=?").run(rec.mesos, charId);
    return true;
  }

  // ─── Character-level equipped gear ─────────────────────────────────────────

  equipItem(charId: string, slot: string, uid: string): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    if (!rec.equipped) rec.equipped = {};
    rec.equipped[slot] = uid;
    this.db
      .prepare("UPDATE characters SET equipped=? WHERE char_id=?")
      .run(JSON.stringify(rec.equipped), charId);
  }

  unequipItem(charId: string, slot: string): void {
    const rec = this.characters.get(charId);
    if (!rec?.equipped) return;
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete rec.equipped[slot];
    this.db
      .prepare("UPDATE characters SET equipped=? WHERE char_id=?")
      .run(JSON.stringify(rec.equipped), charId);
  }

  getEquipped(charId: string): Record<string, string> {
    return this.characters.get(charId)?.equipped ?? {};
  }

  // ─── Character-level inventory ──────────────────────────────────────────────

  addItem(charId: string, item: ItemRecord): void {
    const rec = this.characters.get(charId);
    if (rec) {
      rec.inventory[item.uid] = item;
      this.db
        .prepare("UPDATE characters SET inventory=? WHERE char_id=?")
        .run(JSON.stringify(rec.inventory), charId);
    }
  }

  removeItem(charId: string, uid: string): ItemRecord | undefined {
    const rec = this.characters.get(charId);
    if (!rec) return undefined;
    const item = rec.inventory[uid];
    // inventory is a plain Record persisted as JSON; deleting the key is the intended removal.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    if (item) delete rec.inventory[uid];
    this.db
      .prepare("UPDATE characters SET inventory=? WHERE char_id=?")
      .run(JSON.stringify(rec.inventory), charId);
    return item;
  }

  getItem(charId: string, uid: string): ItemRecord | undefined {
    return this.characters.get(charId)?.inventory[uid];
  }

  // ─── Account-level shared storage (stash) ──────────────────────────────────

  /** Deposit an item from a character's inventory into the account stash. */
  depositToStorage(charId: string, uid: string, qty?: number): { ok: boolean; reason?: string } {
    const rec = this.characters.get(charId);
    if (!rec) return { ok: false, reason: "Character not found." };

    const item = rec.inventory[uid];
    if (!item) return { ok: false, reason: "Item not in inventory." };

    const acc = this.getOrCreate(rec.accountId);
    const count = Math.max(1, qty ?? item.count ?? 1);

    // Check capacity: count existing stash items.
    const usedSlots = Object.keys(acc.storage).length;
    const isStackable = count > 1 && (item.count === undefined || item.count <= 1);
    // Stackable items: if same defId already in stash, we fill; else need a new slot.
    if (isStackable) {
      const existing = Object.values(acc.storage).find((s) => s.defId === item.defId);
      if (!existing && usedSlots >= STORAGE_CAPACITY) {
        return { ok: false, reason: "Storage is full." };
      }
    } else {
      // Non-stackable: each unit needs its own slot.
      if (usedSlots >= STORAGE_CAPACITY) {
        return { ok: false, reason: "Storage is full." };
      }
    }

    // Remove from character inventory.
    const itemQty = item.count ?? 1;
    if (count >= itemQty) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete rec.inventory[uid];
    } else {
      item.count = itemQty - count;
    }

    // Add to stash (create a new uid in the stash to avoid collision).
    const stashUid = `stash_${charId}_${uid}`;
    const stashItem: ItemRecord = {
      ...item,
      uid: stashUid,
      count: count,
    };
    acc.storage[stashUid] = stashItem;

    // Write both to DB atomically.
    const writeAll = this.db.transaction(() => {
      this.db
        .prepare("UPDATE characters SET inventory=? WHERE char_id=?")
        .run(JSON.stringify(rec.inventory), charId);
      this.persistAccount(acc);
    });
    writeAll();

    return { ok: true };
  }

  /** Withdraw an item from the account stash into a character's inventory. */
  withdrawFromStorage(
    charId: string,
    stashUid: string,
    qty?: number,
  ): { ok: boolean; reason?: string } {
    const rec = this.characters.get(charId);
    if (!rec) return { ok: false, reason: "Character not found." };

    const acc = this.getOrCreate(rec.accountId);
    const stashItem = acc.storage[stashUid];
    if (!stashItem) return { ok: false, reason: "Item not in storage." };

    const count = Math.max(1, qty ?? stashItem.count ?? 1);
    const stashQty = stashItem.count ?? 1;
    if (count > stashQty) return { ok: false, reason: "Not enough in storage." };

    // Check character inventory has space (use a new uid to avoid collision).
    const newUid = `item_${stashUid}`;
    const invItem: ItemRecord = { ...stashItem, uid: newUid, count: count };
    rec.inventory[newUid] = invItem;

    // Remove or decrement stash.
    if (count >= stashQty) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete acc.storage[stashUid];
    } else {
      stashItem.count = stashQty - count;
    }

    // Write both to DB atomically.
    const writeAll = this.db.transaction(() => {
      this.db
        .prepare("UPDATE characters SET inventory=? WHERE char_id=?")
        .run(JSON.stringify(rec.inventory), charId);
      this.persistAccount(acc);
    });
    writeAll();

    return { ok: true };
  }

  /** Get all items in an account's shared stash. */
  getStorage(accountId: string): ItemRecord[] {
    const acc = this.getOrCreate(accountId);
    return Object.values(acc.storage);
  }

  /** Return the number of occupied stash slots. */
  storageUsed(accountId: string): number {
    const acc = this.getOrCreate(accountId);
    return Object.keys(acc.storage).length;
  }

  // ─── Mesos burn (sink) — removes mesos from player and records in treasury ──

  /**
   * Deduct mesos from a character AND record the burn in the treasury.
   * This is the single authoritative "remove mesos from circulation" path.
   */
  burnMesos(charId: string, amount: number, reason: string): boolean {
    const rec = this.characters.get(charId);
    if (!rec || rec.mesos < amount) return false;
    rec.mesos -= amount;
    treasury.recordBurn(amount, reason);
    this.db.prepare("UPDATE characters SET mesos=? WHERE char_id=?").run(rec.mesos, charId);
    return true;
  }

  // ─── Exploration Dispatch ────────────────────────────────────────────────

  /** Get the exploration state for a character. Returns empty state if missing. */
  getExploration(charId: string): ExplorationState {
    const rec = this.characters.get(charId);
    if (!rec) return { slots: [] };
    if (!rec.exploration) rec.exploration = { slots: [] };
    return rec.exploration;
  }

  /** Set exploration state and persist. */
  setExploration(charId: string, state: ExplorationState): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    rec.exploration = state;
    this.db
      .prepare("UPDATE characters SET exploration=? WHERE char_id=?")
      .run(JSON.stringify(state), charId);
  }

  // ─── Codex / Fame / Achievements (retention systems) ──────────────────────

  /** Get the codex state for a character. Returns {} if missing (backfill). */
  getCodex(charId: string): CodexState {
    const rec = this.characters.get(charId);
    if (!rec) return {};
    if (!rec.codex) rec.codex = {};
    return rec.codex;
  }

  /** Increment a mob's kill count in the codex and persist. */
  recordCodexKill(charId: string, mobId: string, count: number): CodexState {
    const rec = this.characters.get(charId);
    if (!rec) return {};
    if (!rec.codex) rec.codex = {};
    rec.codex[mobId] = (rec.codex[mobId] ?? 0) + count;
    this.db
      .prepare("UPDATE characters SET codex=? WHERE char_id=?")
      .run(JSON.stringify(rec.codex), charId);
    return rec.codex;
  }

  /** Get the fame state for a character. */
  getFame(charId: string): FameState {
    const rec = this.characters.get(charId);
    if (!rec) return { fame: 0, fameHistory: {} };
    if (!rec.fame) rec.fame = { fame: 0, fameHistory: {} };
    return rec.fame;
  }

  /** Set fame value and persist. */
  setFame(charId: string, fame: number, fameHistory: Record<string, number>): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    rec.fame = { fame, fameHistory };
    this.db
      .prepare("UPDATE characters SET fame=? WHERE char_id=?")
      .run(JSON.stringify(rec.fame), charId);
  }

  /** Get achievement progress for a character. */
  getAchievements(charId: string): AchievementProgress {
    const rec = this.characters.get(charId);
    if (!rec) return {};
    if (!rec.achievements) rec.achievements = {};
    return rec.achievements;
  }

  /** Persist achievement progress. */
  setAchievements(charId: string, achievements: AchievementProgress): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    rec.achievements = achievements;
    this.db
      .prepare("UPDATE characters SET achievements=? WHERE char_id=?")
      .run(JSON.stringify(achievements), charId);
  }

  // ─── Quickslot layout persistence ──────────────────────────────────────────

  /** Get the quickslot layout for a character. Returns [] if missing. */
  getQuickslots(charId: string): ({ type: "skill" | "consumable"; id: string } | null)[] {
    const rec = this.characters.get(charId);
    if (!rec) return [];
    if (!rec.quickslots) rec.quickslots = [];
    return rec.quickslots;
  }

  /** Persist the quickslot layout for a character. */
  setQuickslots(
    charId: string,
    slots: ({ type: "skill" | "consumable"; id: string } | null)[],
  ): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    rec.quickslots = slots;
    this.db
      .prepare("UPDATE characters SET quickslots=? WHERE char_id=?")
      .run(JSON.stringify(slots), charId);
  }

  // ─── Player settings persistence ──────────────────────────────────────────

  /** Get the settings for a character. Returns undefined if missing (caller uses DEFAULT_SETTINGS). */
  getSettings(charId: string): PlayerSettings | undefined {
    return this.characters.get(charId)?.settings;
  }

  /** Persist player settings for a character. */
  setSettings(charId: string, settings: PlayerSettings): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    rec.settings = settings;
    this.db
      .prepare("UPDATE characters SET settings=? WHERE char_id=?")
      .run(JSON.stringify(settings), charId);
  }

  // ─── Auto-pot + Macros persistence ─────────────────────────────────────

  /** Get the auto-pot config for a character. */
  getAutoPot(charId: string): AutoPotConfig | undefined {
    return this.characters.get(charId)?.autoPot;
  }

  /** Persist auto-pot config for a character. */
  setAutoPot(charId: string, config: AutoPotConfig): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    rec.autoPot = config;
    this.db
      .prepare("UPDATE characters SET auto_pot=? WHERE char_id=?")
      .run(JSON.stringify(config), charId);
  }

  /** Get the skill macros for a character. */
  getMacros(charId: string): SkillMacro[] {
    return this.characters.get(charId)?.macros ?? [];
  }

  /** Persist skill macros for a character. */
  setMacros(charId: string, macros: SkillMacro[]): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    rec.macros = macros;
    this.db
      .prepare("UPDATE characters SET macros=? WHERE char_id=?")
      .run(JSON.stringify(macros), charId);
  }

  /** Increment a lifetime counter (mesos earned, quests completed, items collected). */
  incrementLifetimeCounter(
    charId: string,
    field: "totalMesosEarned" | "totalQuestsCompleted" | "totalItemsCollected",
    amount: number,
  ): number {
    const rec = this.characters.get(charId);
    if (!rec) return 0;
    const sqlCol =
      field === "totalMesosEarned"
        ? "total_mesos_earned"
        : field === "totalQuestsCompleted"
          ? "total_quests_completed"
          : "total_items_collected";
    const current = rec[field] ?? 0;
    const newVal = current + amount;
    Object.assign(rec, { [field]: newVal });
    this.db.prepare(`UPDATE characters SET ${sqlCol}=? WHERE char_id=?`).run(newVal, charId);
    return newVal;
  }

  /** Record a daily quest completion timestamp. */
  setDailyCompletion(charId: string, questId: string, completedAt: number): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    if (!rec.dailyCompletions) rec.dailyCompletions = {};
    rec.dailyCompletions[questId] = completedAt;
    this.db
      .prepare("UPDATE characters SET daily_completions=? WHERE char_id=?")
      .run(JSON.stringify(rec.dailyCompletions), charId);
  }

  /** Record the last daily quest reset timestamp. */
  setLastDailyReset(charId: string, resetAt: number): void {
    const rec = this.characters.get(charId);
    if (!rec) return;
    rec.lastDailyResetAt = resetAt;
    this.db
      .prepare("UPDATE characters SET last_daily_reset_at=? WHERE char_id=?")
      .run(resetAt, charId);
  }

  // ─── Persistence (no-op — data is already durable via SQLite) ──────────────

  persistNow(): void {
    // SQLite WAL handles durability. This is a no-op kept for backward compat
    // with callers that call it on shutdown / room dispose.
  }
}

// ─── MarketStore ───────────────────────────────────────────────────────────

interface ListingRow {
  listing_id: string;
  seller_id: string;
  seller_name: string;
  item: string;
  price: number;
  created_at: number;
  listing_type: string;
  ends_at: number;
  current_bid: number;
  high_bidder_char_id: string;
}

function rowToListingRecord(r: ListingRow): ListingRecord {
  return {
    listingId: r.listing_id,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    item: JSON.parse(r.item) as ItemRecord,
    price: r.price,
    createdAt: r.created_at,
    listingType: r.listing_type ?? "fixed",
    endsAt: r.ends_at ?? 0,
    currentBid: r.current_bid ?? 0,
    highBidderCharId: r.high_bidder_char_id ?? "",
  };
}

class MarketStore {
  private db: Database.Database;

  constructor() {
    this.db = openDb();
  }

  all(): ListingRecord[] {
    const rows = this.db.prepare("SELECT * FROM listings").all() as ListingRow[];
    return rows.map(rowToListingRecord);
  }

  get(listingId: string): ListingRecord | undefined {
    const r = this.db.prepare("SELECT * FROM listings WHERE listing_id=?").get(listingId) as
      | ListingRow
      | undefined;
    if (!r) return undefined;
    return rowToListingRecord(r);
  }

  add(rec: Omit<ListingRecord, "listingId" | "createdAt">): ListingRecord {
    const listingId = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const full: ListingRecord = {
      ...rec,
      listingId,
      createdAt: Date.now(),
      listingType: rec.listingType ?? "fixed",
      endsAt: rec.endsAt ?? 0,
      currentBid: rec.currentBid ?? 0,
      highBidderCharId: rec.highBidderCharId ?? "",
    };
    this.db
      .prepare(
        "INSERT INTO listings (listing_id, seller_id, seller_name, item, price, created_at, listing_type, ends_at, current_bid, high_bidder_char_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        full.listingId,
        full.sellerId,
        full.sellerName,
        JSON.stringify(full.item),
        full.price,
        full.createdAt,
        full.listingType,
        full.endsAt,
        full.currentBid,
        full.highBidderCharId,
      );
    return full;
  }

  /** Update mutable auction fields (currentBid, highBidderCharId). */
  updateBid(listingId: string, currentBid: number, highBidderCharId: string): void {
    this.db
      .prepare("UPDATE listings SET current_bid=?, high_bidder_char_id=? WHERE listing_id=?")
      .run(currentBid, highBidderCharId, listingId);
  }

  remove(listingId: string): ListingRecord | undefined {
    const rec = this.get(listingId);
    if (rec) {
      this.db.prepare("DELETE FROM listings WHERE listing_id=?").run(listingId);
    }
    return rec;
  }

  /** Remove all expired listings (ends_at > 0 AND ends_at <= now). */
  removeExpired(): ListingRecord[] {
    const now = Date.now();
    const rows = this.db
      .prepare("SELECT * FROM listings WHERE ends_at > 0 AND ends_at <= ?")
      .all(now) as ListingRow[];
    if (rows.length === 0) return [];
    this.db.prepare("DELETE FROM listings WHERE ends_at > 0 AND ends_at <= ?").run(now);
    return rows.map(rowToListingRecord);
  }

  persistNow(): void {
    // No-op — already durable.
  }
}

// ─── BuyOrderStore ────────────────────────────────────────────────────────

class BuyOrderStore {
  private db: Database.Database;

  constructor() {
    this.db = openDb();
  }

  all(): BuyOrderRecord[] {
    const rows = this.db.prepare("SELECT * FROM buy_orders").all() as {
      buy_order_id: string;
      buyer_char_id: string;
      buyer_name: string;
      def_id: string;
      max_price: number;
      qty: number;
      mesos_escrowed: number;
      created_at: number;
    }[];
    return rows.map((r) => ({
      buyOrderId: r.buy_order_id,
      buyerCharId: r.buyer_char_id,
      buyerName: r.buyer_name,
      defId: r.def_id,
      maxPrice: r.max_price,
      qty: r.qty,
      mesosEscrowed: r.mesos_escrowed,
      createdAt: r.created_at,
    }));
  }

  get(buyOrderId: string): BuyOrderRecord | undefined {
    const r = this.db.prepare("SELECT * FROM buy_orders WHERE buy_order_id=?").get(buyOrderId) as
      | {
          buy_order_id: string;
          buyer_char_id: string;
          buyer_name: string;
          def_id: string;
          max_price: number;
          qty: number;
          mesos_escrowed: number;
          created_at: number;
        }
      | undefined;
    if (!r) return undefined;
    return {
      buyOrderId: r.buy_order_id,
      buyerCharId: r.buyer_char_id,
      buyerName: r.buyer_name,
      defId: r.def_id,
      maxPrice: r.max_price,
      qty: r.qty,
      mesosEscrowed: r.mesos_escrowed,
      createdAt: r.created_at,
    };
  }

  add(rec: Omit<BuyOrderRecord, "buyOrderId" | "createdAt">): BuyOrderRecord {
    const buyOrderId = `bord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const full: BuyOrderRecord = { ...rec, buyOrderId, createdAt: Date.now() };
    this.db
      .prepare(
        "INSERT INTO buy_orders (buy_order_id, buyer_char_id, buyer_name, def_id, max_price, qty, mesos_escrowed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        full.buyOrderId,
        full.buyerCharId,
        full.buyerName,
        full.defId,
        full.maxPrice,
        full.qty,
        full.mesosEscrowed,
        full.createdAt,
      );
    return full;
  }

  remove(buyOrderId: string): BuyOrderRecord | undefined {
    const rec = this.get(buyOrderId);
    if (rec) {
      this.db.prepare("DELETE FROM buy_orders WHERE buy_order_id=?").run(buyOrderId);
    }
    return rec;
  }

  persistNow(): void {
    // No-op — already durable.
  }
}

// ─── PriceHistoryStore ──────────────────────────────────────────────────────

class PriceHistoryStore {
  private db: Database.Database;

  constructor() {
    this.db = openDb();
  }

  /** Record a completed sale. */
  record(defId: string, salePrice: number): void {
    this.db
      .prepare("INSERT INTO price_history (def_id, sale_price, sold_at) VALUES (?, ?, ?)")
      .run(defId, salePrice, Date.now());
  }

  /** Get recent price history for a defId (most recent first, max 50). */
  recent(defId: string, limit = 50): PriceHistoryRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM price_history WHERE def_id=? ORDER BY sold_at DESC LIMIT ?")
      .all(defId, limit) as {
      id: number;
      def_id: string;
      sale_price: number;
      sold_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      defId: r.def_id,
      salePrice: r.sale_price,
      soldAt: r.sold_at,
    }));
  }

  persistNow(): void {
    // No-op — already durable.
  }
}

// ─── Treasury (mesos sink tracker) ─────────────────────────────────────────

class TreasuryStore {
  private db: Database.Database;
  private cache: Treasury;

  constructor() {
    this.db = openDb();
    const row = this.db.prepare("SELECT * FROM treasury WHERE id=1").get() as
      | { total_burned: number; by_reason: string }
      | undefined;
    if (row) {
      this.cache = {
        totalBurned: row.total_burned,
        byReason: JSON.parse(row.by_reason) as Record<string, number>,
      };
    } else {
      this.cache = { totalBurned: 0, byReason: {} };
      this.db
        .prepare("INSERT INTO treasury (id, total_burned, by_reason) VALUES (1, 0, '{}')")
        .run();
    }
  }

  /** Record mesos burned (removed from circulation). */
  recordBurn(amount: number, reason: string): void {
    this.cache.totalBurned += amount;
    this.cache.byReason[reason] = (this.cache.byReason[reason] ?? 0) + amount;
    this.db
      .prepare(
        "INSERT INTO treasury (id, total_burned, by_reason) VALUES (1, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET total_burned=excluded.total_burned, by_reason=excluded.by_reason",
      )
      .run(this.cache.totalBurned, JSON.stringify(this.cache.byReason));
  }

  /** Get the current treasury state. */
  snapshot(): Treasury {
    return { ...this.cache, byReason: { ...this.cache.byReason } };
  }

  persistNow(): void {
    // No-op — already durable.
  }
}

// ─── Guild persistence ──────────────────────────────────────────────────────

class GuildStore {
  private db: Database.Database;

  constructor() {
    this.db = openDb();
    const rows = this.db.prepare("SELECT * FROM guilds").all() as {
      guild_id: string;
      name: string;
      emblem: string;
      created_date: number;
      roster_entries: string;
    }[];

    const guildMap = new Map<string, import("../guildManager").GuildRecord>();
    for (const r of rows) {
      guildMap.set(r.guild_id, {
        guildId: r.guild_id,
        name: r.name,
        emblem: JSON.parse(r.emblem) as { color: number; label: string },
        createdDate: r.created_date,
        roster: new Map(JSON.parse(r.roster_entries) as [string, GuildRank][]),
      });
    }
    guildManager.loadGuilds(guildMap);
  }

  persistNow(): void {
    const snapshot = guildManager.snapshotForPersist();

    // Clear and re-insert all guilds (guilds are few; this is simpler than diffing).
    const persist = this.db.transaction(() => {
      this.db.exec("DELETE FROM guilds");
      const ins = this.db.prepare(
        "INSERT INTO guilds (guild_id, name, emblem, created_date, roster_entries) VALUES (?, ?, ?, ?, ?)",
      );
      for (const [, guild] of snapshot) {
        ins.run(
          guild.guildId,
          guild.name,
          JSON.stringify(guild.emblem),
          guild.createdDate,
          JSON.stringify([...guild.roster.entries()]),
        );
      }
    });
    persist();
  }
}

// ─── FeedbackStore (bug reports / alpha feedback) ────────────────────────

/** Maximum reports an account may submit within the rate-limit window. */
const FEEDBACK_RATE_LIMIT_MAX = 5;
/** Rate-limit window in milliseconds (5 minutes). */
const FEEDBACK_RATE_LIMIT_WINDOW_MS = 5 * 60_000;
/** Maximum message length (characters). */
const FEEDBACK_MAX_MSG_LEN = 2000;
/** Maximum number of client log lines to store. */
const FEEDBACK_MAX_LOG_LINES = 50;

export interface FeedbackReport {
  id: number;
  accountId: string;
  charId: string;
  charName: string;
  category: string;
  message: string;
  mapId: string;
  level: number;
  archetype: string;
  clientVersion: string;
  logLines: string[];
  userAgent: string;
  createdAt: number;
}

class FeedbackStore {
  private db: Database.Database;
  /** Per-account rate limiter: accountId → array of submission timestamps. */
  private recentSubmissions = new Map<string, number[]>();

  constructor() {
    this.db = openDb();
  }

  /**
   * Submit a feedback report. Returns { ok: true } on success or { ok: false, reason } on failure
   * (rate limit, validation, etc.).
   */
  submit(
    accountId: string,
    charId: string,
    charName: string,
    category: string,
    message: string,
    context: {
      mapId: string;
      level: number;
      archetype: string;
      clientVersion: string;
      logLines: string[];
      userAgent: string;
    },
  ): { ok: boolean; reason?: string } {
    // Validate category.
    if (category !== "bug" && category !== "idea" && category !== "balance") {
      return { ok: false, reason: "Invalid category." };
    }

    // Validate message.
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: "Message cannot be empty." };
    }
    if (trimmed.length > FEEDBACK_MAX_MSG_LEN) {
      return { ok: false, reason: `Message too long (max ${FEEDBACK_MAX_MSG_LEN} chars).` };
    }

    // Rate-limit check.
    const now = Date.now();
    const timestamps = this.recentSubmissions.get(accountId) ?? [];
    // Prune old entries outside the window.
    const recent = timestamps.filter((t) => now - t < FEEDBACK_RATE_LIMIT_WINDOW_MS);
    if (recent.length >= FEEDBACK_RATE_LIMIT_MAX) {
      return {
        ok: false,
        reason: "Too many reports. Please wait a few minutes before submitting again.",
      };
    }
    recent.push(now);
    this.recentSubmissions.set(accountId, recent);

    // Truncate log lines.
    const logLines = context.logLines.slice(-FEEDBACK_MAX_LOG_LINES);

    this.db
      .prepare(
        "INSERT INTO feedback_reports (account_id, char_id, char_name, category, message, map_id, level, archetype, client_version, log_lines, user_agent, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        accountId,
        charId,
        charName,
        category,
        trimmed,
        context.mapId,
        context.level,
        context.archetype,
        context.clientVersion,
        JSON.stringify(logLines),
        context.userAgent,
        now,
      );

    return { ok: true };
  }

  /** List reports, most recent first. Optional limit. */
  list(limit = 50): FeedbackReport[] {
    const rows = this.db
      .prepare("SELECT * FROM feedback_reports ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      accountId: r.account_id as string,
      charId: r.char_id as string,
      charName: r.char_name as string,
      category: r.category as string,
      message: r.message as string,
      mapId: r.map_id as string,
      level: r.level as number,
      archetype: r.archetype as string,
      clientVersion: r.client_version as string,
      logLines: JSON.parse(r.log_lines as string) as string[],
      userAgent: r.user_agent as string,
      createdAt: r.created_at as number,
    }));
  }

  /** Count reports in the current rate-limit window for an account. */
  recentCount(accountId: string): number {
    const now = Date.now();
    const timestamps = this.recentSubmissions.get(accountId) ?? [];
    return timestamps.filter((t) => now - t < FEEDBACK_RATE_LIMIT_WINDOW_MS).length;
  }

  /** Total count of all reports. */
  totalCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS cnt FROM feedback_reports").get() as {
      cnt: number;
    };
    return row.cnt;
  }
}

// ─── ModerationStore (player reports) ───────────────────────────────────

/** Rate-limit: max reports an account can submit within the window. */
const REPORT_RATE_LIMIT_MAX = 10;
/** Rate-limit window in ms (10 minutes). */
const REPORT_RATE_LIMIT_WINDOW_MS = 10 * 60_000;
/** Max report reason length. */
const REPORT_MAX_REASON_LEN = 500;
/** Max chat context lines to store. */
const REPORT_MAX_CONTEXT_LINES = 10;

export interface PlayerReport {
  id: number;
  reporterAcc: string;
  reporterName: string;
  targetName: string;
  reason: string;
  chatContext: string[];
  mapId: string;
  createdAt: number;
}

class ModerationStore {
  private db: Database.Database;
  private recentReports = new Map<string, number[]>();

  constructor() {
    this.db = openDb();
  }

  /** Submit a player report. Returns { ok } with reason on failure. */
  submitReport(
    accountId: string,
    reporterName: string,
    targetName: string,
    reason: string,
    chatContext: string[],
    mapId: string,
  ): { ok: boolean; reason?: string } {
    if (!targetName || !reason.trim()) {
      return { ok: false, reason: "Target name and reason are required." };
    }
    const trimmed = reason.trim().slice(0, REPORT_MAX_REASON_LEN);

    // Rate-limit.
    const now = Date.now();
    const timestamps = this.recentReports.get(accountId) ?? [];
    const recent = timestamps.filter((t) => now - t < REPORT_RATE_LIMIT_WINDOW_MS);
    if (recent.length >= REPORT_RATE_LIMIT_MAX) {
      return { ok: false, reason: "Too many reports. Please wait before submitting again." };
    }
    recent.push(now);
    this.recentReports.set(accountId, recent);

    const ctx = chatContext.slice(-REPORT_MAX_CONTEXT_LINES);

    this.db
      .prepare(
        "INSERT INTO player_reports (reporter_acc, reporter_name, target_name, reason, chat_context, map_id, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(accountId, reporterName, targetName, trimmed, JSON.stringify(ctx), mapId, now);

    return { ok: true };
  }

  /** List reports, newest first. */
  listReports(limit = 50): PlayerReport[] {
    const rows = this.db
      .prepare("SELECT * FROM player_reports ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      reporterAcc: r.reporter_acc as string,
      reporterName: r.reporter_name as string,
      targetName: r.target_name as string,
      reason: r.reason as string,
      chatContext: JSON.parse(r.chat_context as string) as string[],
      mapId: r.map_id as string,
      createdAt: r.created_at as number,
    }));
  }

  /** Total report count. */
  totalCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS cnt FROM player_reports").get() as {
      cnt: number;
    };
    return row.cnt;
  }
}

// ─── Friends persistence ───────────────────────────────────────────────────

class FriendStore {
  private db: Database.Database;

  constructor() {
    this.db = openDb();
    const rows = this.db.prepare("SELECT * FROM friends").all() as {
      account_id: string;
      friend_account_id: string;
    }[];

    // Build the adjacency map for friendManager.
    const adj = new Map<string, string[]>();
    for (const r of rows) {
      let list = adj.get(r.account_id);
      if (!list) {
        list = [];
        adj.set(r.account_id, list);
      }
      list.push(r.friend_account_id);
    }
    friendManager.loadFriends(adj);
  }

  persistNow(): void {
    const snapshot = friendManager.snapshotForPersist();
    const persist = this.db.transaction(() => {
      this.db.exec("DELETE FROM friends");
      const ins = this.db.prepare(
        "INSERT INTO friends (account_id, friend_account_id) VALUES (?, ?)",
      );
      for (const [accountId, friendIds] of snapshot) {
        for (const fid of friendIds) {
          ins.run(accountId, fid);
        }
      }
    });
    persist();
  }
}

// ─── Singletons ────────────────────────────────────────────────────────────

export const accountStore = new AccountStore();
export const marketStore = new MarketStore();
export const buyOrderStore = new BuyOrderStore();
export const priceHistoryStore = new PriceHistoryStore();
const treasury = new TreasuryStore();
const guildStore = new GuildStore();
const friendStore = new FriendStore();
export const feedbackStore = new FeedbackStore();
export const moderationStore = new ModerationStore();

/** Exported treasury singleton for rooms to read the burn counter. */
export { treasury as treasuryStore };

// Best-effort flush on shutdown (DB is already durable, but guild + friend need snapshots).
for (const sig of ["SIGINT", "SIGTERM", "beforeExit"] as const) {
  process.once(sig, () => {
    guildStore.persistNow();
    friendStore.persistNow();
  });
}
