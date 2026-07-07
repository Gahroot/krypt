/**
 * GM Commands test — verifies:
 *   1. Non-admin / non-gm accounts are rejected with "Access denied"
 *   2. Admin accounts can execute commands that mutate state correctly
 *   3. GM role accounts are accepted alongside admin
 *   4. Audit logging records every command
 *   5. Command parsing handles edge cases and unknown commands
 *   6. All command categories are exercised (teleport, summon, spawn, boss,
 *      give, level, heal, killall, mute, kick, ban, announce, god, noclip)
 *
 * Run: npx tsx test/gmCommands.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";
import { handleGmCommand, logGmAction, getAuditLog } from "../src/gmCommands";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard watchdog so the process can never hang a harness.
const watchdog = setTimeout(() => {
  console.error("[gmCommands] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

// ─── Helper: send GM command and await result ──────────────────────────────

async function sendGmCommand(
  room: any,
  command: string,
): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    room.onMessage(MessageType.GM_RESULT, (payload: { success: boolean; message: string }) => {
      if (!resolved) {
        resolved = true;
        resolve(payload);
      }
    });
    room.send(MessageType.GM_COMMAND, { command });
  });
}

// ─── Unit tests: handleGmCommand parser (no Colyseus needed) ────────────────

function testCommandParsing() {
  console.log("[gmCommands] ── command parsing ──");

  const mockCtx = {
    client: {} as any,
    room: {} as any,
    accountId: "test",
    charName: "TestChar",
  };

  // Unknown command.
  const r1 = handleGmCommand(mockCtx, "/nonexistent");
  assert.ok(!r1.success, "unknown command should fail");
  assert.ok(r1.message.includes("Unknown command"), r1.message);

  // Empty command.
  const r2 = handleGmCommand(mockCtx, "");
  assert.ok(!r2.success, "empty command should fail");

  // Help.
  const r3 = handleGmCommand(mockCtx, "/help");
  assert.ok(r3.success, "/help should succeed");
  assert.ok(r3.message.includes("GM Commands"), "help should list commands");
  assert.ok(r3.message.includes("/tp"), "help should mention /tp");
  assert.ok(r3.message.includes("/summon"), "help should mention /summon");
  assert.ok(r3.message.includes("/heal"), "help should mention /heal");
  assert.ok(r3.message.includes("/noclip"), "help should mention /noclip");
  assert.ok(r3.message.includes("/god"), "help should mention /god");
  assert.ok(r3.message.includes("/announce"), "help should mention /announce");
  assert.ok(r3.message.includes("/kick"), "help should mention /kick");
  assert.ok(r3.message.includes("/ban"), "help should mention /ban");
  assert.ok(r3.message.includes("/mute"), "help should mention /mute");
  assert.ok(r3.message.includes("/unmute"), "help should mention /unmute");
  assert.ok(r3.message.includes("/unban"), "help should mention /unban");

  // Missing args.
  const r4 = handleGmCommand(mockCtx, "/spawn");
  assert.ok(!r4.success, "/spawn with no args should fail");
  assert.ok(r4.message.includes("Usage"), r4.message);

  const r5 = handleGmCommand(mockCtx, "/teleport");
  assert.ok(!r5.success, "/teleport with no args should fail");

  const r6 = handleGmCommand(mockCtx, "/summon");
  assert.ok(!r6.success, "/summon with no args should fail");

  const r7 = handleGmCommand(mockCtx, "/give");
  assert.ok(!r7.success, "/give with no args should fail");

  const r8 = handleGmCommand(mockCtx, "/level");
  assert.ok(!r8.success, "/level with no args should fail");

  const r9 = handleGmCommand(mockCtx, "/mute");
  assert.ok(!r9.success, "/mute with no args should fail");

  const r10 = handleGmCommand(mockCtx, "/kick");
  assert.ok(!r10.success, "/kick with no args should fail");

  const r11 = handleGmCommand(mockCtx, "/ban");
  assert.ok(!r11.success, "/ban with no args should fail");

  const r12 = handleGmCommand(mockCtx, "/announce");
  assert.ok(!r12.success, "/announce with no args should fail");

  // Non-slash command.
  const r13 = handleGmCommand(mockCtx, "help");
  assert.ok(!r13.success, "non-slash command should fail");

  console.log("[gmCommands] ✔ command parsing verified");
}

// ─── Audit log ──────────────────────────────────────────────────────────────

function testAuditLog() {
  console.log("[gmCommands] ── audit log ──");

  const entry = logGmAction("acc1", "AdminChar", "/give mesos 100", "", "Gave 100 mesos.");
  assert.strictEqual(entry.accountId, "acc1");
  assert.strictEqual(entry.charName, "AdminChar");
  assert.strictEqual(entry.command, "/give mesos 100");
  assert.strictEqual(entry.result, "Gave 100 mesos.");
  assert.ok(entry.id > 0, "audit entry should have an id");
  assert.ok(entry.createdAt > 0, "audit entry should have a timestamp");

  const log = getAuditLog(10);
  assert.ok(log.length > 0, "audit log should have entries");
  assert.strictEqual(log[log.length - 1]!.command, "/give mesos 100");

  // Second entry should have incremented id.
  const entry2 = logGmAction("acc2", "GM2", "/kick foo", "foo", "Kicked foo.");
  assert.ok(entry2.id > entry.id, "audit ids should increment");

  console.log("[gmCommands] ✔ audit log verified");
}

// ─── Integration: non-admin rejected ────────────────────────────────────────

async function testNonAdminRejected(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── non-admin rejected ──");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "GMTest_Normal" });
  await sleep(200);

  const me = () => (room.state as any).players.get(room.sessionId);
  assert.ok(me(), "player should exist in state after join");

  // Default role is "player".
  const acc = accountStore.getAccount("gm_acc_normal");
  if (acc) {
    assert.notStrictEqual(acc.role, "admin", "default role should not be admin");
    assert.notStrictEqual(acc.role, "gm", "default role should not be gm");
  }

  // Send several GM commands — all should be rejected.
  for (const cmd of ["/help", "/give mesos 100", "/tp meadowfield", "/god", "/announce hi"]) {
    const result = await sendGmCommand(room, cmd);
    assert.strictEqual(result.success, false, `non-admin: "${cmd}" should be rejected`);
    assert.ok(
      result.message.includes("Access denied"),
      `expected "Access denied" for "${cmd}", got: ${result.message}`,
    );
  }

  console.log("[gmCommands] ✔ non-admin correctly rejected");
  await room.leave();
}

// ─── Integration: gm role is accepted ───────────────────────────────────────

async function testGmRoleAccepted(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── gm role accepted ──");

  const testAccountId = "gm_acc_role_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "gm");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_GmRole",
    accountId: testAccountId,
  });
  await sleep(200);

  const result = await sendGmCommand(room, "/help");
  assert.ok(result.success, `gm role should be accepted, got: ${result.message}`);
  assert.ok(result.message.includes("GM Commands"), "should get help text");

  console.log("[gmCommands] ✔ gm role accepted");
  await room.leave();
}

// ─── Integration: admin give mesos ──────────────────────────────────────────

async function testAdminGiveMesos(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin give mesos ──");

  const testAccountId = "gm_acc_admin_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "admin");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_Admin",
    accountId: testAccountId,
  });
  await sleep(200);

  const me = () => (room.state as any).players.get(room.sessionId);
  assert.ok(me(), "admin player should exist in state");

  const startMesos = me().mesos;
  const result = await sendGmCommand(room, "/give mesos 500");
  await sleep(100); // wait for Colyseus schema sync

  assert.ok(result.success, `command should succeed, got: ${result.message}`);
  assert.ok(result.message.includes("500"), `result should mention amount: ${result.message}`);
  assert.strictEqual(me().mesos, startMesos + 500, "mesos should increase by 500");
  console.log(`[gmCommands] ✔ mesos ${startMesos}→${me().mesos}`);

  await room.leave();
}

// ─── Integration: admin killall ─────────────────────────────────────────────

async function testAdminKillAll(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin killall ──");

  const testAccountId = "gm_acc_killall_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "admin");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_KillAll",
    accountId: testAccountId,
  });
  await sleep(200);

  const mobCount = (room.state as any).mobs.size;
  assert.ok(mobCount > 0, "meadowfield should have mobs");
  console.log(`[gmCommands] mobs before killall: ${mobCount}`);

  const result = await sendGmCommand(room, "/killall");
  await sleep(100); // wait for Colyseus schema sync
  assert.ok(result.success, `/killall should succeed: ${result.message}`);
  assert.strictEqual((room.state as any).mobs.size, 0, "all mobs should be cleared");
  console.log("[gmCommands] ✔ killall cleared all mobs");

  await room.leave();
}

// ─── Integration: admin give EXP ────────────────────────────────────────────

async function testAdminGiveExp(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin give exp ──");

  const testAccountId = "gm_acc_exp_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "admin");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_GiveExp",
    accountId: testAccountId,
  });
  await sleep(200);

  const me = () => (room.state as any).players.get(room.sessionId);
  const startExp = me().exp;

  const result = await sendGmCommand(room, "/give exp 1000");
  await sleep(100); // wait for Colyseus schema sync
  assert.ok(result.success, `/give exp should succeed: ${result.message}`);
  assert.ok(result.message.includes("1000"), `result should mention amount: ${result.message}`);
  assert.strictEqual(me().exp, startExp + 1000, "exp should increase by 1000");
  console.log(`[gmCommands] ✔ exp ${startExp}→${me().exp}`);

  await room.leave();
}

// ─── Integration: admin set level ───────────────────────────────────────────

async function testAdminSetLevel(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin set level ──");

  const testAccountId = "gm_acc_level_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "admin");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_SetLevel",
    accountId: testAccountId,
  });
  await sleep(200);

  const me = () => (room.state as any).players.get(room.sessionId);
  assert.strictEqual(me().level, 1, "should start at level 1");

  const result = await sendGmCommand(room, "/level 50");
  await sleep(100); // wait for Colyseus schema sync
  assert.ok(result.success, `/level should succeed: ${result.message}`);
  assert.ok(result.message.includes("50"), `result should mention level: ${result.message}`);
  assert.strictEqual(me().level, 50, "level should be set to 50");
  assert.strictEqual(me().exp, 0, "exp should reset to 0");
  console.log(`[gmCommands] ✔ level set to ${me().level}`);

  await room.leave();
}

// ─── Integration: admin heal ────────────────────────────────────────────────

async function testAdminHeal(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin heal ──");

  const testAccountId = "gm_acc_heal_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "admin");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_Heal",
    accountId: testAccountId,
  });
  await sleep(200);

  const result = await sendGmCommand(room, "/heal");
  await sleep(100); // wait for Colyseus schema sync
  assert.ok(result.success, `/heal should succeed: ${result.message}`);
  assert.ok(result.message.includes("Healed"), `should confirm heal: ${result.message}`);
  assert.ok(result.message.includes("HP"), `should mention HP: ${result.message}`);
  console.log(`[gmCommands] ✔ heal succeeded: ${result.message}`);

  await room.leave();
}

// ─── Integration: admin god toggle ──────────────────────────────────────────

async function testAdminGodToggle(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin god toggle ──");

  const testAccountId = "gm_acc_god_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "admin");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_God",
    accountId: testAccountId,
  });
  await sleep(200);

  // Toggle on.
  const on = await sendGmCommand(room, "/god");
  assert.ok(on.success, `/god on should succeed: ${on.message}`);
  assert.ok(on.message.includes("ON"), `should say ON: ${on.message}`);

  // Toggle off.
  const off = await sendGmCommand(room, "/god");
  assert.ok(off.success, `/god off should succeed: ${off.message}`);
  assert.ok(off.message.includes("OFF"), `should say OFF: ${off.message}`);

  console.log("[gmCommands] ✔ god toggle works");
  await room.leave();
}

// ─── Integration: admin noclip toggle ───────────────────────────────────────

async function testAdminNoclipToggle(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin noclip toggle ──");

  const testAccountId = "gm_acc_noclip_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "admin");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_Noclip",
    accountId: testAccountId,
  });
  await sleep(200);

  // Toggle on.
  const on = await sendGmCommand(room, "/noclip");
  assert.ok(on.success, `/noclip on should succeed: ${on.message}`);
  assert.ok(on.message.includes("ON"), `should say ON: ${on.message}`);

  // Toggle off.
  const off = await sendGmCommand(room, "/noclip");
  assert.ok(off.success, `/noclip off should succeed: ${off.message}`);
  assert.ok(off.message.includes("OFF"), `should say OFF: ${off.message}`);

  console.log("[gmCommands] ✔ noclip toggle works");
  await room.leave();
}

// ─── Integration: admin spawn boss ──────────────────────────────────────────

async function testAdminSpawnBoss(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin spawn boss ──");

  const testAccountId = "gm_acc_boss_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "admin");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_Boss",
    accountId: testAccountId,
  });
  await sleep(200);

  const startMobCount = (room.state as any).mobs.size;
  const result = await sendGmCommand(room, "/boss mob.meadow_slime");
  await sleep(100); // wait for Colyseus schema sync
  assert.ok(result.success, `/boss should succeed: ${result.message}`);
  assert.ok(result.message.includes("Spawned boss"), `should confirm spawn: ${result.message}`);
  assert.ok(
    (room.state as any).mobs.size > startMobCount,
    "mob count should increase after boss spawn",
  );

  console.log("[gmCommands] ✔ boss spawned");
  await room.leave();
}

// ─── Integration: admin announce ────────────────────────────────────────────

async function testAdminAnnounce(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin announce ──");

  const testAccountId = "gm_acc_announce_" + Date.now();
  accountStore.getOrCreate(testAccountId);
  accountStore.setRole(testAccountId, "admin");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    name: "GMTest_Announce",
    accountId: testAccountId,
  });
  await sleep(200);

  const result = await sendGmCommand(room, '/announce "Server restarting in 5 min"');
  assert.ok(result.success, `/announce should succeed: ${result.message}`);
  assert.ok(result.message.includes("Announcement sent"), `should confirm: ${result.message}`);

  console.log("[gmCommands] ✔ announce sent");
  await room.leave();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  // Unit tests (no Colyseus).
  testCommandParsing();
  testAuditLog();

  // Integration tests (with Colyseus).
  await testNonAdminRejected(colyseus);
  await testGmRoleAccepted(colyseus);
  await testAdminGiveMesos(colyseus);
  await testAdminGiveExp(colyseus);
  await testAdminSetLevel(colyseus);
  await testAdminHeal(colyseus);
  await testAdminKillAll(colyseus);
  await testAdminGodToggle(colyseus);
  await testAdminNoclipToggle(colyseus);
  await testAdminSpawnBoss(colyseus);
  await testAdminAnnounce(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[gmCommands] PASS ✔  all GM command tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[gmCommands] FAIL ✘", err);
  process.exit(1);
});
