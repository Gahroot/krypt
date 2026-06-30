/**
 * Multi-character account test — proves character isolation, persistence, and room-level join:
 *   1. Create an account with two characters (store-level)
 *   2. Mutate one character's mesos + inventory
 *   3. Reload the store from disk → assert isolation + persistence
 *   4. Boot the server, join a room as a character → verify appearance synced + position persisted
 *
 * Run: npx tsx test/characters.ts
 */
import assert from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { bootAuthed } from "./authBoot";
import { randomizeAppearance } from "@maple/shared";
import appConfig from "../src/app.config";
import { AccountStore } from "../src/persistence/store";
import {
  validateCharacterNameFormat,
  NAME_TAKEN_CODE,
  NAME_TAKEN_MESSAGE,
} from "../src/characters";

const TEST_DIR = ".data_test_characters";

// Wipe + prepare a fresh data directory for this test.
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

const watchdog = setTimeout(() => {
  console.error("[characters] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 15_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function testNameValidation() {
  // ── Format rules: length 2–16, charset, profanity (shared), reserved words ──
  assert.strictEqual(validateCharacterNameFormat("Mapler"), null, "clean name accepted");
  assert.ok(validateCharacterNameFormat("A"), "1-char name rejected (min 2)");
  assert.ok(validateCharacterNameFormat("x".repeat(17)), "17-char name rejected (max 16)");
  assert.ok(validateCharacterNameFormat("Bad!Name"), "illegal charset rejected");
  assert.ok(validateCharacterNameFormat("Shithead"), "profane name rejected");
  assert.ok(validateCharacterNameFormat("Admin"), "reserved name rejected");
  assert.ok(validateCharacterNameFormat("g m"), "reserved name rejected ignoring spacing");
  // The taken-name error must be a distinct code plus a user-visible message.
  assert.notStrictEqual(NAME_TAKEN_MESSAGE, NAME_TAKEN_CODE, "name_taken has a human message");
  assert.ok(/\s/.test(NAME_TAKEN_MESSAGE), "name_taken message is user-friendly");
  console.log("[characters] name format: ✔ length/charset/profanity/reserved enforced");

  // ── Global uniqueness + system default generation (isolated DB) ────────────
  const dir = `${TEST_DIR}_names`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const store = new AccountStore(dir);

  store.createCharacter("acct_unique", {
    name: "Duplicate",
    archetype: "BEGINNER",
    appearance: randomizeAppearance(() => 0.3),
  });
  assert.ok(store.characterNameExists("Duplicate"), "created name is taken");
  assert.ok(store.characterNameExists("duplicate"), "uniqueness is case-insensitive");

  // A duplicate passes format but is globally taken → the authoritative create
  // handler returns name_taken rather than silently renaming.
  assert.strictEqual(validateCharacterNameFormat("Duplicate"), null, "duplicate passes format");

  // System auto-provisioning never collides and never reuses the taken name.
  const generated = store.generateUniqueName("Duplicate");
  assert.notStrictEqual(
    generated.toLowerCase(),
    "duplicate",
    "generated default avoids the taken name",
  );
  assert.ok(!store.characterNameExists(generated), "generated default is free");

  // A valid, unique, well-formed name succeeds and persists verbatim (no suffix).
  assert.strictEqual(validateCharacterNameFormat("FreshHero"), null, "fresh name format ok");
  assert.ok(!store.characterNameExists("FreshHero"), "fresh name is free");
  const rec = store.createCharacter("acct_unique", {
    name: "FreshHero",
    archetype: "BEGINNER",
    appearance: randomizeAppearance(() => 0.6),
  });
  assert.strictEqual(rec.name, "FreshHero", "valid unique name persisted verbatim");

  store.persistNow();
  rmSync(dir, { recursive: true, force: true });
  console.log(
    "[characters] uniqueness: ✔ duplicates rejected, defaults unique, valid names succeed",
  );
}

function testStore() {
  // ── Phase 1: create + mutate ────────────────────────────────────────────────

  // Fresh store pointing at the isolated test directory.
  const store = new AccountStore(TEST_DIR);

  const accountId = "test_acct";
  store.getOrCreate(accountId);

  const alpha = store.createCharacter(accountId, {
    name: "Alpha",
    archetype: "WARRIOR",
    appearance: randomizeAppearance(() => 0.1),
  });
  const beta = store.createCharacter(accountId, {
    name: "Beta",
    archetype: "MAGE",
    appearance: randomizeAppearance(() => 0.9),
  });

  // Both characters exist.
  const chars = store.listCharacters(accountId);
  assert.strictEqual(chars.length, 2, "account should have 2 characters");
  console.log(
    `[characters] created ${alpha.charId} (${alpha.name}) and ${beta.charId} (${beta.name})`,
  );

  // Mutate alpha: mesos + inventory.
  store.setMesos(alpha.charId, 500);
  store.addItem(alpha.charId, {
    uid: "item_alpha_1",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "EPIC",
    lines: 2,
    minted: false,
  });

  // Verify mutation.
  assert.strictEqual(store.getCharacter(alpha.charId)!.mesos, 500, "alpha mesos");
  assert.ok(store.getItem(alpha.charId, "item_alpha_1"), "alpha has item");

  // Beta is untouched.
  assert.strictEqual(store.getCharacter(beta.charId)!.mesos, 300, "beta mesos unchanged (starter)");
  assert.strictEqual(
    Object.keys(store.getCharacter(beta.charId)!.inventory).length,
    0,
    "beta inventory empty",
  );

  // ── Phase 2: persist + reload ───────────────────────────────────────────────

  store.persistNow();

  // Create a brand-new store instance that reads from disk.
  const store2 = new AccountStore(TEST_DIR);

  const alpha2 = store2.getCharacter(alpha.charId);
  const beta2 = store2.getCharacter(beta.charId);

  assert.ok(alpha2, "alpha persisted");
  assert.ok(beta2, "beta persisted");

  // Isolation: alpha's mutations survived; beta is still default.
  assert.strictEqual(alpha2!.mesos, 500, "alpha mesos persisted");
  assert.ok(alpha2!.inventory["item_alpha_1"], "alpha item persisted");
  assert.strictEqual(alpha2!.name, "Alpha", "alpha name persisted");

  assert.strictEqual(beta2!.mesos, 300, "beta mesos still starter after reload");
  assert.strictEqual(Object.keys(beta2!.inventory).length, 0, "beta inventory still empty");

  // ── Phase 3: delete + reload ────────────────────────────────────────────────

  store2.deleteCharacter(beta.charId);
  const remaining = store2.listCharacters(accountId);
  assert.strictEqual(remaining.length, 1, "only alpha remains after delete");
  assert.strictEqual(remaining[0]!.charId, alpha.charId, "remaining is alpha");

  store2.persistNow();

  const store3 = new AccountStore(TEST_DIR);
  const alpha3 = store3.getCharacter(alpha.charId);
  const beta3 = store3.getCharacter(beta.charId);

  assert.ok(alpha3, "alpha still exists after reload");
  assert.strictEqual(alpha3!.mesos, 500, "alpha mesos still correct after delete+reload");
  assert.ok(!beta3, "beta is gone after delete+reload");

  clearTimeout(watchdog);

  // Cleanup test directory.
  rmSync(TEST_DIR, { recursive: true, force: true });

  console.log("[characters] store: ✔  create / mutate / reload / isolation / delete works");
}

async function testJoinRoom() {
  console.log("[characters] ── room join ──");
  const colyseus = await bootAuthed(appConfig);

  // Create a character via the singleton store (same one the rooms use).
  const { accountStore } = await import("../src/persistence/store");
  const acctId = "test_join_acct";
  // Idempotency: character names are globally UNIQUE. Purge any "RoomHero" left
  // behind by a previous run so re-running the suite never collides on the
  // UNIQUE(name) constraint against the persistent dev database.
  const stale = accountStore.getCharacterByName("RoomHero");
  if (stale) accountStore.deleteCharacter(stale.charId);
  const rec = accountStore.createCharacter(acctId, {
    name: "RoomHero",
    archetype: "BEGINNER",
    appearance: {
      gender: "F",
      skinId: "skin_tan",
      hairId: "hair_spiky",
      hairColorId: "color_blue",
      faceId: "face_happy",
      outfitId: "outfit_dress",
    },
  });

  // Join meadowfield as that character.
  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    charId: rec.charId,
    accountId: acctId,
  });
  await sleep(200);

  const sessionId = room.sessionId;
  const me = () => (room.state as any).players.get(sessionId);
  assert.ok(me(), "player should exist after join");

  // Verify appearance fields are synced.
  const p = me();
  assert.strictEqual(p.gender, "F", "gender synced");
  assert.strictEqual(p.skinId, "skin_tan", "skinId synced");
  assert.strictEqual(p.hairId, "hair_spiky", "hairId synced");
  assert.strictEqual(p.hairColorId, "color_blue", "hairColorId synced");
  assert.strictEqual(p.faceId, "face_happy", "faceId synced");
  assert.strictEqual(p.outfitId, "outfit_dress", "outfitId synced");
  assert.strictEqual(p.archetype, "BEGINNER", "archetype is BEGINNER");
  assert.strictEqual(p.name, "RoomHero", "name synced");
  assert.strictEqual(p.level, 1, "new char starts at level 1");
  assert.ok(p.mesos > 0, "new char has starter mesos");
  console.log(
    `[characters] join: gender=${p.gender} skin=${p.skinId} hair=${p.hairId} archetype=${p.archetype}`,
  );

  // Walk right a bit and leave — verify position is persisted.
  const { MessageType } = await import("../src/types");
  for (let i = 0; i < 30; i++) {
    room.send(MessageType.INPUT, {
      left: false,
      right: true,
      up: false,
      down: false,
      attack: false,
      jump: false,
      interact: false,
      tick: i,
    });
    await sleep(16);
  }
  await sleep(100);
  const xAfterWalk = me().x;
  assert.ok(xAfterWalk > 0, "player moved right");
  console.log(`[characters] walked to x=${Math.round(xAfterWalk)}`);

  await room.leave();
  await sleep(300); // let the debounce flush

  // Verify position persisted back to the store.
  const persisted = accountStore.getCharacter(rec.charId)!;
  assert.ok(persisted, "character still in store after leave");
  assert.ok(
    Math.abs(persisted.x - xAfterWalk) < 5,
    `persisted x≈walked x (${Math.round(persisted.x)} vs ${Math.round(xAfterWalk)})`,
  );
  console.log(`[characters] persistence: x persisted as ${Math.round(persisted.x)}`);

  await colyseus.shutdown();

  // Clean up the character we created so the persistent dev database stays
  // free of test pollution and the next run starts from a clean slate.
  accountStore.deleteCharacter(rec.charId);

  console.log("[characters] room join: ✔  appearance synced + position persisted on leave");
}

testNameValidation();
testStore();
testJoinRoom()
  .then(() => {
    clearTimeout(watchdog);
    rmSync(TEST_DIR, { recursive: true, force: true });
    console.log("[characters] PASS ✔  all tests passed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[characters] FAIL ✘", err);
    process.exit(1);
  });
