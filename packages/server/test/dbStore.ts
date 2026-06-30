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
