/**
 * Database round-trip test — proves a fully-loaded character persists through SQLite
 * and comes back with every field intact. Also covers market listings, treasury, and guild persistence.
 *
 * Run: npx tsx test/dbStore.ts
 */
import assert from "node:assert";
import { rmSync } from "node:fs";
import { randomizeAppearance } from "@maple/shared";

rmSync(".data_test_dbstore", { recursive: true, force: true });

const watchdog = setTimeout(() => {
  console.error("[dbStore] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 10_000);

async function main() {
  // Import stores — this triggers DB creation + migrations.
  const { AccountStore, marketStore, treasuryStore } = await import("../src/persistence/store");

  // ── Phase 1: Create a store with a fresh DB ─────────────────────────────
  const store = new AccountStore(".data_test_dbstore");

  const accountId = "dbstore_acct";
  store.getOrCreate(accountId);

  // Create a fully-loaded character.
  const appearance = randomizeAppearance(() => 0.42);
  const char = store.createCharacter(accountId, {
    name: "DbHero",
    archetype: "WARRIOR",
    appearance,
  });

  // Mutate every field to exercise full serialization.
  store.setMesos(char.charId, 9999);
  store.updateCharacter(char.charId, {
    level: 50,
    exp: 123456,
    ap: 30,
    sp: 20,
    maxHp: 800,
    maxMp: 200,
    stats: { STR: 120, DEX: 45, INT: 10, LUK: 30, HP: 800, MP: 200 },
    mapId: "dawn_isle",
    x: 420,
    y: 300,
    learnedSkills: ["slash", "ironWill", "rage"],
    skillBook: { slash: 3, ironWill: 2, rage: 1 },
    quests: [
      {
        questId: "q_slime_hunt",
        status: "inProgress",
        objectives: [{ key: "kill", current: 5, target: 10 }],
      },
    ],
  });

  // Add inventory items.
  store.addItem(char.charId, {
    uid: "sword_1",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "EPIC",
    lines: 2,
    minted: false,
    potentialLines: [
      { stat: "STR", value: 6, tier: "EPIC" },
      { stat: "AllStats", value: 3, tier: "RARE" },
    ],
  });
  store.addItem(char.charId, {
    uid: "potion_1",
    defId: "use.hp_potion",
    baseRank: "NORMAL",
    potentialTier: "COMMON",
    lines: 0,
    minted: false,
    count: 50,
  });

  // Equip gear.
  store.equipItem(char.charId, "weapon", "sword_1");

  // Equip cash cosmetics.
  store.equipCashItem(char.charId, "cash cape_1", "cape", 30);
  store.equipCashItem(char.charId, "cash hat_1", "hat");

  // Exercise the full "everything persists" snapshot that MapRoom.persistPlayer writes
  // on leave / autosave: job tier, retention systems, QoL layouts, titles, counters,
  // and idle exploration. A crash + reboot must bring all of this back intact.
  store.updateCharacter(char.charId, {
    jobTier: 2,
    branchId: "berserker",
    quickslots: [{ type: "skill", id: "slash" }, null, { type: "consumable", id: "use.hp_potion" }],
    codex: { "mob.slime": 120, "mob.snail": 30 },
    fame: { fame: 75, fameHistory: { chr_99: 1_717_000_000_000 } },
    achievements: { firstBlood: [1], slimeSlayer: [120] },
    totalMesosEarned: 50_000,
    totalQuestsCompleted: 12,
    totalItemsCollected: 88,
    autoPot: {
      hpEnabled: true,
      hpThreshold: 40,
      mpEnabled: true,
      mpThreshold: 30,
      hpPotionId: "pot.large_hp",
      mpPotionId: "pot.large_mp",
    },
    macros: [{ id: "m1", name: "Combo", steps: [{ type: "skill", id: "slash" }] }],
    exploration: {
      slots: [
        {
          slotIndex: 0,
          mobId: "mob.slime",
          startAt: 1_717_000_000_000,
          duration: "short",
          durationMs: 3_600_000,
          completeAt: 1_717_003_600_000,
          claimed: false,
        },
      ],
    },
    ownedTitles: ["Slime Slayer", "Pioneer"],
    equippedTitle: "Pioneer",
    familiars: { registered: ["mob.slime"], summoned: ["mob.slime"] },
  });

  // Verify in-memory state before persistence.
  const loaded = store.getCharacter(char.charId)!;
  assert.ok(loaded, "character exists in memory");
  assert.strictEqual(loaded.level, 50, "level set");
  assert.strictEqual(loaded.exp, 123456, "exp set");
  assert.strictEqual(loaded.ap, 30, "ap set");
  assert.strictEqual(loaded.sp, 20, "sp set");
  assert.strictEqual(loaded.mesos, 9999, "mesos set");
  assert.strictEqual(loaded.maxHp, 800, "maxHp set");
  assert.strictEqual(loaded.maxMp, 200, "maxMp set");
  assert.strictEqual(loaded.stats.STR, 120, "STR set");
  assert.strictEqual(loaded.mapId, "dawn_isle", "mapId set");
  assert.strictEqual(loaded.x, 420, "x set");
  assert.strictEqual(loaded.y, 300, "y set");
  assert.ok(loaded.inventory["sword_1"], "sword in inventory");
  assert.ok(loaded.inventory["potion_1"], "potion in inventory");
  assert.strictEqual(loaded.inventory["potion_1"].count, 50, "potion count");
  assert.strictEqual(loaded.equipped?.["weapon"], "sword_1", "weapon equipped");
  assert.ok(loaded.equippedCash?.["cape"], "cape cash equipped");
  assert.ok(loaded.equippedCash?.["hat"], "hat cash equipped");
  assert.strictEqual(loaded.learnedSkills?.length, 3, "3 learned skills");
  assert.strictEqual(loaded.skillBook?.["slash"], 3, "slash skill book level");
  assert.ok(loaded.quests?.length, "quest recorded");
  assert.ok(loaded.appearance, "appearance preserved");

  console.log("[dbStore] ✔ in-memory state verified");

  // ── Phase 2: Reload from DB and verify round-trip ──────────────────────
  const store2 = new AccountStore(".data_test_dbstore");
  const reloaded = store2.getCharacter(char.charId)!;
  assert.ok(reloaded, "character exists after reload");

  assert.strictEqual(reloaded.charId, char.charId, "charId round-trips");
  assert.strictEqual(reloaded.accountId, accountId, "accountId round-trips");
  assert.strictEqual(reloaded.name, "DbHero", "name round-trips");
  assert.strictEqual(reloaded.archetype, "WARRIOR", "archetype round-trips");
  assert.strictEqual(reloaded.level, 50, "level round-trips");
  assert.strictEqual(reloaded.exp, 123456, "exp round-trips");
  assert.strictEqual(reloaded.ap, 30, "ap round-trips");
  assert.strictEqual(reloaded.sp, 20, "sp round-trips");
  assert.strictEqual(reloaded.maxHp, 800, "maxHp round-trips");
  assert.strictEqual(reloaded.maxMp, 200, "maxMp round-trips");
  assert.strictEqual(reloaded.mesos, 9999, "mesos round-trips");
  assert.strictEqual(reloaded.mapId, "dawn_isle", "mapId round-trips");
  assert.strictEqual(reloaded.x, 420, "x round-trips");
  assert.strictEqual(reloaded.y, 300, "y round-trips");
  assert.deepStrictEqual(
    reloaded.stats,
    { STR: 120, DEX: 45, INT: 10, LUK: 30, HP: 800, MP: 200 },
    "stats round-trip",
  );
  assert.deepStrictEqual(reloaded.appearance, appearance, "appearance round-trips");

  // Inventory
  assert.ok(reloaded.inventory["sword_1"], "sword survived");
  assert.ok(reloaded.inventory["potion_1"], "potion survived");
  assert.strictEqual(reloaded.inventory["potion_1"].count, 50, "potion count survived");
  assert.strictEqual(
    reloaded.inventory["sword_1"].potentialLines?.length,
    2,
    "potential lines survived",
  );

  // Equipped
  assert.strictEqual(reloaded.equipped?.["weapon"], "sword_1", "equipped round-trips");

  // Cash equipped
  assert.ok(reloaded.equippedCash?.["cape"], "cape cash survived");
  assert.strictEqual(
    reloaded.equippedCash?.["hat"].itemId,
    "cash hat_1",
    "hat cash itemId survived",
  );

  // Skills
  assert.deepStrictEqual(
    reloaded.learnedSkills,
    ["slash", "ironWill", "rage"],
    "learnedSkills round-trip",
  );
  assert.deepStrictEqual(
    reloaded.skillBook,
    { slash: 3, ironWill: 2, rage: 1 },
    "skillBook round-trip",
  );

  // Quests
  assert.strictEqual(reloaded.quests?.length, 1, "quest survived");
  assert.strictEqual(reloaded.quests?.[0].questId, "q_slime_hunt", "quest id survived");

  // Account
  const reloadedAcct = store2.getOrCreate(accountId);
  assert.strictEqual(reloadedAcct.cash, 10_000, "starter cash survived");

  console.log("[dbStore] ✔ full character round-trip verified");

  // ── Phase 2b: crash-recovery snapshot — every persistPlayer field survives ──
  // store2 was constructed fresh from the same on-disk DB, exactly as a rebooted
  // server would hydrate. Assert the full progress snapshot (position, vitals,
  // retention systems, QoL layouts, titles, quests, exploration) is all intact.
  assert.strictEqual(reloaded.jobTier, 2, "jobTier round-trips");
  assert.strictEqual(reloaded.branchId, "berserker", "branchId round-trips");

  // Quickslots (hotbar layout, including the null gap).
  assert.strictEqual(reloaded.quickslots?.length, 3, "quickslots length");
  assert.deepStrictEqual(
    reloaded.quickslots?.[0],
    { type: "skill", id: "slash" },
    "quickslot 0 round-trips",
  );
  assert.strictEqual(reloaded.quickslots?.[1], null, "quickslot gap preserved");
  assert.deepStrictEqual(
    reloaded.quickslots?.[2],
    { type: "consumable", id: "use.hp_potion" },
    "quickslot 2 round-trips",
  );

  // Retention systems: codex, fame, achievements, lifetime counters.
  assert.strictEqual(reloaded.codex?.["mob.slime"], 120, "codex kill count round-trips");
  assert.strictEqual(reloaded.fame?.fame, 75, "fame round-trips");
  assert.strictEqual(reloaded.fame?.fameHistory?.["chr_99"], 1_717_000_000_000, "fame history");
  assert.deepStrictEqual(reloaded.achievements?.["slimeSlayer"], [120], "achievement progress");
  assert.strictEqual(reloaded.totalMesosEarned, 50_000, "totalMesosEarned round-trips");
  assert.strictEqual(reloaded.totalQuestsCompleted, 12, "totalQuestsCompleted round-trips");
  assert.strictEqual(reloaded.totalItemsCollected, 88, "totalItemsCollected round-trips");

  // QoL: auto-pot, macros.
  assert.strictEqual(reloaded.autoPot?.hpEnabled, true, "autoPot hpEnabled round-trips");
  assert.strictEqual(reloaded.autoPot?.mpThreshold, 30, "autoPot mpThreshold round-trips");
  assert.strictEqual(reloaded.macros?.[0]?.id, "m1", "macro id round-trips");
  assert.strictEqual(reloaded.macros?.[0]?.steps?.length, 1, "macro steps round-trip");

  // Idle exploration dispatch.
  assert.strictEqual(reloaded.exploration?.slots?.length, 1, "exploration slot survived");
  assert.strictEqual(reloaded.exploration?.slots?.[0]?.mobId, "mob.slime", "exploration mobId");
  assert.strictEqual(reloaded.exploration?.slots?.[0]?.claimed, false, "exploration claimed flag");

  // Titles.
  assert.deepStrictEqual(
    reloaded.ownedTitles,
    ["Slime Slayer", "Pioneer"],
    "ownedTitles round-trip",
  );
  assert.strictEqual(reloaded.equippedTitle, "Pioneer", "equippedTitle round-trips");

  // Familiars (registered + summoned re-summon on reload).
  assert.deepStrictEqual(reloaded.familiars?.registered, ["mob.slime"], "familiars registered");
  assert.deepStrictEqual(reloaded.familiars?.summoned, ["mob.slime"], "familiars summoned");

  console.log("[dbStore] ✔ crash-recovery snapshot (all progress fields) verified");

  // ── Phase 2c: WAL + checkpoint durability ───────────────────────────────
  // WAL mode is what keeps committed writes recoverable after a hard kill, and the
  // checkpoint helper flushes the WAL into the main .db on graceful shutdown.
  const journalMode = store2.walMode();
  assert.strictEqual(journalMode.toLowerCase(), "wal", "journal mode is WAL");
  store2.checkpoint(); // must not throw

  console.log("[dbStore] ✔ WAL mode + checkpoint verified");

  // ── Phase 3: MarketStore round-trip ─────────────────────────────────────
  const listing = marketStore.add({
    sellerId: char.charId,
    sellerName: "DbHero",
    item: {
      uid: "market_item_1",
      defId: "wpn.mythic_blade",
      baseRank: "UNIQUE",
      potentialTier: "LEGENDARY",
      lines: 3,
      minted: false,
    },
    price: 50000,
  });

  const fetched = marketStore.get(listing.listingId);
  assert.ok(fetched, "listing exists");
  assert.strictEqual(fetched!.price, 50000, "listing price");
  assert.strictEqual(fetched!.item.defId, "wpn.mythic_blade", "listing item defId");

  // Reload market from DB.
  const { marketStore: market2 } = await import("../src/persistence/store");
  const allListings = market2.all();
  assert.ok(allListings.length >= 1, "listing persisted");
  const found = allListings.find((l) => l.listingId === listing.listingId);
  assert.ok(found, "listing found after reload");

  marketStore.remove(listing.listingId);

  console.log("[dbStore] ✔ market listing round-trip verified");

  // ── Phase 4: Treasury round-trip ───────────────────────────────────────
  treasuryStore.recordBurn(1000, "test_burn");
  const snap = treasuryStore.snapshot();
  assert.ok(snap.totalBurned >= 1000, "treasury burn recorded");
  assert.ok((snap.byReason["test_burn"] ?? 0) >= 1000, "treasury by-reason recorded");

  console.log("[dbStore] ✔ treasury round-trip verified");

  // ── Phase 5: Delete character ───────────────────────────────────────────
  assert.ok(store2.deleteCharacter(char.charId), "delete returns true");
  assert.ok(!store2.getCharacter(char.charId), "character gone after delete");

  const store3 = new AccountStore(".data_test_dbstore");
  assert.ok(!store3.getCharacter(char.charId), "character stays gone after reload");

  console.log("[dbStore] ✔ delete round-trip verified");

  // ── Cleanup ─────────────────────────────────────────────────────────────
  clearTimeout(watchdog);
  rmSync(".data_test_dbstore", { recursive: true, force: true });

  console.log("[dbStore] PASS ✔  all round-trip tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[dbStore] FAIL ✘", err);
  clearTimeout(watchdog);
  rmSync(".data_test_dbstore", { recursive: true, force: true });
  process.exit(1);
});
