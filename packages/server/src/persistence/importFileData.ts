/**
 * One-time importer: reads legacy `.data/*.json` files and inserts them into the SQLite database.
 *
 * Usage:
 *   npx tsx src/persistence/importFileData.ts [data-dir]
 *
 * The data-dir defaults to `DATA_DIR` env var or `.data`. Idempotent — skips accounts/characters
 * that already exist in the DB.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Account, CharacterRecord, ListingRecord, Treasury } from "./store";
import { openDb } from "./db";

function readJson<T>(file: string, fallback: T): T {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    console.warn(`[import] could not read ${file}:`, (err as Error).message);
  }
  return fallback;
}

// ─── Helpers for serializing character rows ─────────────────────────────────

const CHAR_COL_MAP: Record<string, string> = {
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
  createdAt: "created_at",
};

const JSON_KEYS = new Set([
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
]);

function serializeChar(rec: CharacterRecord): { cols: string; values: unknown[] } {
  const entries: [string, unknown][] = [];
  for (const [jsKey, sqlCol] of Object.entries(CHAR_COL_MAP)) {
    const val = rec[jsKey as keyof CharacterRecord];
    entries.push([sqlCol, JSON_KEYS.has(jsKey) ? JSON.stringify(val) : val]);
  }
  return {
    cols: entries.map(([k]) => k).join(", "),
    values: entries.map(([, v]) => v),
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  const dataDir = resolve(process.argv[2] || process.env.DATA_DIR || ".data");
  console.log(`[import] reading legacy data from ${dataDir}`);

  const db = openDb();

  // ── Accounts ───────────────────────────────────────────────────────────
  const accountsFile = `${dataDir}/accounts.json`;
  const rawAccounts = readJson<Record<string, Account>>(accountsFile, {});
  const acctCount = Object.keys(rawAccounts).length;
  console.log(`[import] found ${acctCount} accounts in ${accountsFile}`);

  const upsertAcct = db.prepare(
    "INSERT INTO accounts (account_id, cash, cash_inventory, storage) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(account_id) DO UPDATE SET cash=excluded.cash, cash_inventory=excluded.cash_inventory, storage=excluded.storage",
  );

  const importAccounts = db.transaction(() => {
    let imported = 0;
    for (const [id, acc] of Object.entries(rawAccounts)) {
      upsertAcct.run(
        id,
        acc.cash ?? 10_000,
        JSON.stringify(acc.cashInventory ?? []),
        JSON.stringify(acc.storage ?? {}),
      );
      imported++;
    }
    return imported;
  });
  const acctImported = importAccounts();
  console.log(`[import] ✔ ${acctImported} accounts imported`);

  // ── Characters ─────────────────────────────────────────────────────────
  const charsFile = `${dataDir}/characters.json`;
  const rawChars = readJson<Record<string, CharacterRecord>>(charsFile, {});
  const charCount = Object.keys(rawChars).length;
  console.log(`[import] found ${charCount} characters in ${charsFile}`);

  const importChars = db.transaction(() => {
    let imported = 0;
    for (const [, rec] of Object.entries(rawChars)) {
      const { cols, values } = serializeChar(rec);
      const placeholders = values.map(() => "?").join(", ");
      db.prepare(`INSERT OR REPLACE INTO characters (${cols}) VALUES (${placeholders})`).run(
        ...values,
      );
      imported++;
    }
    return imported;
  });
  const charImported = importChars();
  console.log(`[import] ✔ ${charImported} characters imported`);

  // ── Listings ───────────────────────────────────────────────────────────
  const listingsFile = `${dataDir}/listings.json`;
  const rawListings = readJson<ListingRecord[]>(listingsFile, []);
  console.log(`[import] found ${rawListings.length} listings in ${listingsFile}`);

  const importListings = db.transaction(() => {
    let imported = 0;
    for (const rec of rawListings) {
      db.prepare(
        "INSERT OR REPLACE INTO listings (listing_id, seller_id, seller_name, item, price, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        rec.listingId,
        rec.sellerId,
        rec.sellerName,
        JSON.stringify(rec.item),
        rec.price,
        rec.createdAt,
      );
      imported++;
    }
    return imported;
  });
  const listImported = importListings();
  console.log(`[import] ✔ ${listImported} listings imported`);

  // ── Treasury ───────────────────────────────────────────────────────────
  const treasuryFile = `${dataDir}/treasury.json`;
  const rawTreasury = readJson<Treasury>(treasuryFile, { totalBurned: 0, byReason: {} });
  console.log(`[import] treasury: totalBurned=${rawTreasury.totalBurned}`);

  db.prepare(
    "INSERT INTO treasury (id, total_burned, by_reason) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET total_burned=excluded.total_burned, by_reason=excluded.by_reason",
  ).run(rawTreasury.totalBurned, JSON.stringify(rawTreasury.byReason ?? {}));
  console.log(`[import] ✔ treasury imported`);

  // ── Guilds ─────────────────────────────────────────────────────────────
  const guildsFile = `${dataDir}/guilds.json`;
  interface GuildFileRecord {
    guildId: string;
    name: string;
    emblem: { color: number; label: string };
    createdDate: number;
    rosterEntries: [string, string][];
  }
  const rawGuilds = readJson<GuildFileRecord[]>(guildsFile, []);
  console.log(`[import] found ${rawGuilds.length} guilds in ${guildsFile}`);

  const importGuilds = db.transaction(() => {
    let imported = 0;
    for (const g of rawGuilds) {
      db.prepare(
        "INSERT OR REPLACE INTO guilds (guild_id, name, emblem, created_date, roster_entries) VALUES (?, ?, ?, ?, ?)",
      ).run(
        g.guildId,
        g.name,
        JSON.stringify(g.emblem),
        g.createdDate,
        JSON.stringify(g.rosterEntries),
      );
      imported++;
    }
    return imported;
  });
  const guildImported = importGuilds();
  console.log(`[import] ✔ ${guildImported} guilds imported`);

  db.close();
  console.log(`\n[import] ═══ DONE ═══`);
  console.log(`  accounts:  ${acctImported}`);
  console.log(`  characters: ${charImported}`);
  console.log(`  listings:  ${listImported}`);
  console.log(`  guilds:    ${guildImported}`);
}

main();
