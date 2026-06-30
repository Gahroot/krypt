/**
 * Gear equip/unequip test — proves that equipping a weapon increases computed damage,
 * that level-gating is enforced, and that equip/unequip cycle works correctly.
 *
 * Uses the same colyseus/testing pattern as rangedCombat.ts.
 *
 * Run: npx tsx test/equip.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype, EquipSlot } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore, type ItemRecord } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[equip] FAIL ✘ watchdog timeout");
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

/**
 * Sustain attacks against a single high-HP mob and return the total damage dealt.
 *
 * Per-hit damage carries a ±20% random spread (see MapRoom.playerDamage), so a
 * single swing is a noisy sample — a low weapon roll can tie a high bare-hands
 * roll. Accumulating damage across many swings averages out that variance so the
 * weapon-vs-bare-hands comparison is stable rather than flaky.
 */
async function accumulateMeleeDamage(
  sdk: { send: (type: number, data: unknown) => void },
  mob: { hp: number },
  swings = 12,
): Promise<number> {
  const startHp = mob.hp;
  for (let i = 0; i < swings; i++) {
    sdk.send(MessageType.INPUT, {
      left: false,
      right: false,
      up: false,
      down: false,
      attack: true,
      jump: false,
      interact: false,
      tick: i,
    });
    await sleep(120);
  }
  await sleep(200);
  return startHp - mob.hp;
}

// ─── Test 1: Equipping a weapon increases damage ────────────────────────────

async function testEquipWeaponIncreasesDamage(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[equip] ── equip weapon increases damage ──");

  const acct = `equip_dmg_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "EquipDmg",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  // Give the character a Bronze Shortsword (levelReq: 1, baseAttack: 14).
  const swordRecord: ItemRecord = {
    uid: "item_sword_001",
    defId: "wpn.bronze_shortsword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  };
  accountStore.addItem(rec.charId, swordRecord);

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
  assert.ok(player.inventory.has("item_sword_001"), "sword should be in inventory");
  assert.strictEqual(player.equipped.size, 0, "nothing should be equipped initially");

  // ── Verify equip state ──
  sdk.send(MessageType.EQUIP_ITEM, { uid: "item_sword_001" });
  await sleep(200);

  assert.strictEqual(
    player.equipped.get(EquipSlot.WEAPON),
    "item_sword_001",
    "sword should be equipped",
  );
  assert.strictEqual(player.attackType, "MELEE", "warrior with sword should be MELEE");
  console.log("[equip] sword equipped, attackType=" + player.attackType);

  // ── Verify damage WITH weapon by hitting a mob ──
  // Give a mob massive HP so it survives many hits, then sustain attacks and
  // accumulate the total damage (averages out the ±20% per-hit spread).
  const mobId = Array.from(serverRoom.state.mobs.keys())[0] as string;
  const mob = serverRoom.state.mobs.get(mobId);
  assert.ok(mob, "mob should exist");
  mob.maxHp = 999999;
  mob.hp = 999999;
  mob.x = player.x + 40;
  mob.y = player.y;
  player.x = mob.x - 30;
  player.facing = 1;
  await sleep(100);

  const dmgWithWeapon = await accumulateMeleeDamage(sdk, mob);
  assert.ok(dmgWithWeapon > 0, "weapon hit should deal damage");
  console.log(`[equip] accumulated damage with weapon equipped: ${dmgWithWeapon}`);

  // ── Verify damage WITHOUT weapon — unequip and hit a fresh mob ──
  sdk.send(MessageType.UNEQUIP_ITEM, { slot: EquipSlot.WEAPON });
  await sleep(200);
  assert.ok(!player.equipped.has(EquipSlot.WEAPON), "sword should be unequipped");
  assert.strictEqual(player.attackType, "MELEE", "warrior without weapon should be MELEE");

  // Fresh mob for the bare-hands hits — same sustained-attack accumulation.
  const mob2Id = Array.from(serverRoom.state.mobs.keys())[1] as string;
  const mob2 = serverRoom.state.mobs.get(mob2Id);
  assert.ok(mob2, "second mob should exist");
  mob2.maxHp = 999999;
  mob2.hp = 999999;
  mob2.x = player.x + 40;
  mob2.y = player.y;
  await sleep(100);

  const dmgWithoutWeapon = await accumulateMeleeDamage(sdk, mob2);
  assert.ok(dmgWithoutWeapon > 0, "bare-hands hit should deal damage");
  console.log(`[equip] accumulated damage without weapon: ${dmgWithoutWeapon}`);

  // The key assertion: equipping a weapon should increase accumulated damage.
  assert.ok(
    dmgWithWeapon > dmgWithoutWeapon,
    `accumulated weapon damage (${dmgWithWeapon}) should exceed bare-hands (${dmgWithoutWeapon})`,
  );

  await sdk.leave();
  console.log("[equip] ✔ equip weapon increases damage");
}

// ─── Test 2: Level gating prevents equipping high-level items ───────────────

async function testLevelGateRejects(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[equip] ── level gate rejects high-level item ──");

  const acct = `equip_gate_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "EquipGate",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  // Give the character an Iron Broadsword (levelReq: 10).
  const swordRecord: ItemRecord = {
    uid: "item_iron_001",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  };
  accountStore.addItem(rec.charId, swordRecord);

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
  assert.strictEqual(player.level, 1, "character should be level 1");

  // Try to equip the level-10 sword — should be rejected.
  let rejected = false;
  sdk.onMessage("equip_result", (msg: { success: boolean; message: string }) => {
    if (!msg.success) rejected = true;
  });

  sdk.send(MessageType.EQUIP_ITEM, { uid: "item_iron_001" });
  await sleep(300);

  assert.ok(rejected, "equipping level-10 item at level 1 should be rejected");
  assert.ok(!player.equipped.has(EquipSlot.WEAPON), "iron sword should NOT be equipped");

  await sdk.leave();
  console.log("[equip] ✔ level gate rejects high-level item");
}

// ─── Test 3: Equip/unequip cycle and slot swap ──────────────────────────────

async function testEquipUnequipCycle(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[equip] ── equip/unequip cycle ──");

  const acct = `equip_cycle_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "EquipCycle",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  // Give two level-1 weapons.
  accountStore.addItem(rec.charId, {
    uid: "item_sword_a",
    defId: "wpn.bronze_shortsword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });
  accountStore.addItem(rec.charId, {
    uid: "item_sword_b",
    defId: "wpn.bronze_shortsword",
    baseRank: "ENHANCED",
    potentialTier: "EPIC",
    lines: 2,
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

  // Equip first weapon.
  sdk.send(MessageType.EQUIP_ITEM, { uid: "item_sword_a" });
  await sleep(200);
  assert.strictEqual(player.equipped.get(EquipSlot.WEAPON), "item_sword_a");

  // Equip second weapon (should swap).
  sdk.send(MessageType.EQUIP_ITEM, { uid: "item_sword_b" });
  await sleep(200);
  assert.strictEqual(
    player.equipped.get(EquipSlot.WEAPON),
    "item_sword_b",
    "should swap to second weapon",
  );

  // Unequip.
  sdk.send(MessageType.UNEQUIP_ITEM, { slot: EquipSlot.WEAPON });
  await sleep(200);
  assert.ok(!player.equipped.has(EquipSlot.WEAPON), "weapon slot should be empty after unequip");

  // Both weapons should still be in inventory.
  assert.ok(player.inventory.has("item_sword_a"), "first weapon still in inventory");
  assert.ok(player.inventory.has("item_sword_b"), "second weapon still in inventory");

  await sdk.leave();
  console.log("[equip] ✔ equip/unequip cycle works");
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testEquipWeaponIncreasesDamage(colyseus);
  await testLevelGateRejects(colyseus);
  await testEquipUnequipCycle(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[equip] PASS ✔  all equip/unequip tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[equip] FAIL ✘", err);
  process.exit(1);
});
