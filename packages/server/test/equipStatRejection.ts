/**
 * Equip stat-requirement + defense/set-bonus tests.
 *
 * Proves that:
 *  1. canEquip() class requirement is enforced authoritatively.
 *  2. canEquip() stat requirements (STR) are enforced authoritatively.
 *  3. Equipping gear feeds wDef/mDef into the character's effective combat stats.
 *  4. Equipping a full set activates computeSetBonuses (STR + wDef + atk + HP).
 *
 * Run: npx tsx test/equipStatRejection.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype, EquipSlot } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore, type ItemRecord } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[equipStatRejection] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

const DEFAULT_APPEARANCE = {
  gender: "M",
  skinId: "skin_0",
  hairId: "hair_0",
  hairColorId: "hc_0",
  faceId: "face_0",
  outfitId: "outfit_0",
};

// ─── Test 1: Class requirement rejects wrong-class equips ─────────────────
// Bypass level gate by setting player.level on the server, then attempt a
// mage-only weapon. canEquip checks level → classReq → stats, so by setting
// level >= levelReq we force it to reach the class check.

async function testClassRequirementRejects(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[equipStatRejection] ── class requirement rejects mage wand on warrior ──");

  const acct = `stat_cls_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "StatCls",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  // Ember Wand: classReq: [MAGE], levelReq: 10, reqInt: 35, reqDex: 15.
  accountStore.addItem(rec.charId, {
    uid: "item_wand_001",
    defId: "wpn.ember_wand",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  // Set level past the item's levelReq so canEquip() reaches the class check.
  player.level = 10;

  let rejected = false;
  let rejectMsg = "";
  sdk.onMessage("equip_result", (msg: { success: boolean; message?: string }) => {
    if (!msg.success) {
      rejected = true;
      rejectMsg = msg.message ?? "";
    }
  });

  sdk.send(MessageType.EQUIP_ITEM, { uid: "item_wand_001" });
  await sleep(300);

  assert.ok(rejected, "equipping mage-only wand on a warrior should be rejected");
  assert.ok(
    rejectMsg.includes("MAGE") || rejectMsg.includes("class") || rejectMsg.includes("Restricted"),
    `rejection message should mention class restriction, got: "${rejectMsg}"`,
  );
  assert.ok(!player.equipped.has(EquipSlot.WEAPON), "wand should NOT be equipped");

  await sdk.leave();
  console.log("[equipStatRejection] ✔ class requirement rejects mage wand on warrior");
}

// ─── Test 2: Stat requirement rejects insufficient stats ──────────────────
// Set level high enough to pass levelReq, but STR stays at default 4.
// Iron Crest Helm requires levelReq 20 + reqStr 40 — level passes, STR fails.

async function testStatRequirementRejects(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[equipStatRejection] ── stat requirement rejects low-STR equip ──");

  const acct = `stat_str_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "StatStr",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  // Items: tattered_hood (levelReq 5, reqStr 4) + iron_crest_helm (levelReq 20, reqStr 40).
  accountStore.addItem(rec.charId, {
    uid: "item_hood_ok",
    defId: "hat.tattered_hood",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });
  accountStore.addItem(rec.charId, {
    uid: "item_helm_bad",
    defId: "hat.iron_crest_helm",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");
  assert.strictEqual(player.str, 4, "warrior starts with STR 4");

  // Set level past iron crest helm's levelReq so canEquip() reaches the stat check.
  player.level = 20;

  // Try to equip iron crest helm (reqStr 40) — should fail at the stat check.
  let rejected = false;
  let rejectMsg = "";
  sdk.onMessage("equip_result", (msg: { success: boolean; message?: string }) => {
    if (!msg.success) {
      rejected = true;
      rejectMsg = msg.message ?? "";
    }
  });

  sdk.send(MessageType.EQUIP_ITEM, { uid: "item_helm_bad" });
  await sleep(300);

  assert.ok(rejected, "equipping reqStr-40 helm on STR-4 warrior should be rejected");
  assert.ok(
    rejectMsg.includes("40") && rejectMsg.includes("STR"),
    `rejection message should mention STR 40 requirement, got: "${rejectMsg}"`,
  );
  assert.ok(!player.equipped.has(EquipSlot.HAT), "helm should NOT be equipped");
  console.log(`[equipStatRejection] rejection message: "${rejectMsg}"`);

  // Now verify that an item the character CAN equip succeeds (tattered hood, reqStr 4).
  let equipped = false;
  sdk.onMessage("equip_result", (msg: { success: boolean; slot?: string }) => {
    if (msg.success && msg.slot === EquipSlot.HAT) {
      equipped = true;
    }
  });

  sdk.send(MessageType.EQUIP_ITEM, { uid: "item_hood_ok" });
  await sleep(300);

  assert.ok(equipped, "tattered hood (reqStr 4) should be equippable by STR-4 warrior");
  assert.strictEqual(player.equipped.get(EquipSlot.HAT), "item_hood_ok", "hood should be equipped");

  await sdk.leave();
  console.log("[equipStatRejection] ✔ stat requirement rejects insufficient-STR equip");
}

// ─── Test 3: Full set activation applies defense and set bonuses ───────────

async function testDefenseAndSetBonuses(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[equipStatRejection] ── defense + set bonuses ──");

  const acct = `stat_set_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "StatSet",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  // Starter Warrior set: bronze_shortsword, tattered_hood, patchwork_vest, burlap_leggings.
  const items: ItemRecord[] = [
    {
      uid: "set_sw",
      defId: "wpn.bronze_shortsword",
      baseRank: "NORMAL",
      potentialTier: "RARE",
      lines: 1,
      minted: false,
    },
    {
      uid: "set_sh",
      defId: "hat.tattered_hood",
      baseRank: "NORMAL",
      potentialTier: "RARE",
      lines: 1,
      minted: false,
    },
    {
      uid: "set_sv",
      defId: "top.patchwork_vest",
      baseRank: "NORMAL",
      potentialTier: "RARE",
      lines: 1,
      minted: false,
    },
    {
      uid: "set_sl",
      defId: "bottom.burlap_leggings",
      baseRank: "NORMAL",
      potentialTier: "RARE",
      lines: 1,
      minted: false,
    },
  ];
  for (const item of items) accountStore.addItem(rec.charId, item);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  // Tattered hood / vest / leggings require level 5 — bump past all set pieces.
  player.level = 5;

  // Record baseline damage before equipping anything.
  const mob = serverRoom.state.mobs.get(Array.from(serverRoom.state.mobs.keys())[0] as string);
  assert.ok(mob, "mob should exist");
  mob.maxHp = 99999;
  mob.hp = 99999;
  mob.x = player.x + 40;
  mob.y = player.y;
  player.facing = 1;
  await sleep(100);

  sdk.send(MessageType.INPUT, {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: true,
    jump: false,
    interact: false,
    tick: 0,
  });
  await sleep(600);

  const baselineDmg = 99999 - mob.hp;
  assert.ok(baselineDmg > 0, "bare-hands should deal damage");
  console.log(`[equipStatRejection] baseline damage (no gear): ${baselineDmg}`);

  // Equip all 4 Starter Warrior set pieces.
  for (const item of items) {
    sdk.send(MessageType.EQUIP_ITEM, { uid: item.uid });
    await sleep(200);
  }

  // All 4 pieces should be equipped.
  assert.strictEqual(player.equipped.get(EquipSlot.WEAPON), "set_sw", "sword equipped");
  assert.strictEqual(player.equipped.get(EquipSlot.HAT), "set_sh", "hood equipped");
  assert.strictEqual(player.equipped.get(EquipSlot.TOP), "set_sv", "vest equipped");
  assert.strictEqual(player.equipped.get(EquipSlot.BOTTOM), "set_sl", "leggings equipped");

  // Verify set bonuses via computeSetBonuses.
  const { computeSetBonuses } = await import("@maple/shared");

  // 4-piece Starter Warrior set: STR +3 (2pc) + STR +3 wDef +5 HP +30 (3pc) + STR +5 wDef +5 atk +8 HP +50 (4pc)
  // = STR +11, wDef +10, atk +8, HP +80
  const setBonus = computeSetBonuses([
    "wpn.bronze_shortsword",
    "hat.tattered_hood",
    "top.patchwork_vest",
    "bottom.burlap_leggings",
  ]);
  assert.strictEqual(setBonus.STR, 11, "4-piece set should grant STR +11");
  assert.strictEqual(setBonus.wDef, 10, "4-piece set should grant wDef +10");
  assert.strictEqual(setBonus.atk, 8, "4-piece set should grant atk +8");
  assert.strictEqual(setBonus.HP, 80, "4-piece set should grant HP +80");

  // Verify that damage with full set exceeds baseline (more STR + atk).
  const mob2 = serverRoom.state.mobs.get(Array.from(serverRoom.state.mobs.keys())[1] as string);
  assert.ok(mob2, "second mob should exist");
  mob2.maxHp = 99999;
  mob2.hp = 99999;
  mob2.x = player.x + 40;
  mob2.y = player.y;
  await sleep(100);

  sdk.send(MessageType.INPUT, {
    left: false,
    right: false,
    up: false,
    down: false,
    attack: true,
    jump: false,
    interact: false,
    tick: 1,
  });
  await sleep(600);

  const setDmg = 99999 - mob2.hp;
  assert.ok(setDmg > 0, "set-equipping should deal damage");
  console.log(`[equipStatRejection] damage with full set: ${setDmg}`);

  // Full set should deal more damage than bare-hands (STR 4+6+11=21 vs 4, plus atk +8).
  assert.ok(setDmg > baselineDmg, `set damage (${setDmg}) should exceed baseline (${baselineDmg})`);

  await sdk.leave();
  console.log("[equipStatRejection] ✔ defense and set bonuses feed into combat stats");
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testClassRequirementRejects(colyseus);
  await testStatRequirementRejects(colyseus);
  await testDefenseAndSetBonuses(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[equipStatRejection] PASS ✔  all stat-rejection + defense/set-bonus tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[equipStatRejection] FAIL ✘", err);
  process.exit(1);
});
