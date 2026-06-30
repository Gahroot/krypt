/**
 * GM Commands test — verifies:
 *   1. Non-admin accounts are rejected with "Access denied"
 *   2. Admin accounts can execute commands that mutate state correctly
 *   3. Command parsing handles edge cases
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

// ─── Unit tests: handleGmCommand directly (no Colyseus) ─────────────────────

async function testNonAdminRejected(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── non-admin rejected ──");

  const room = await colyseus.sdk.joinOrCreate("meadowfield", { name: "GMTest_Normal" });
  await sleep(200);

  const me = () => (room.state as any).players.get(room.sessionId);
  assert.ok(me(), "player should exist in state after join");

  // Ensure the account is NOT admin (default is "player").
  const acc = accountStore.getAccount("gm_acc_normal");
  // The account is auto-created by getOrCreate on join; default role is "player".
  // We haven't set it to admin, so it should be "player".
  if (acc) {
    assert.notStrictEqual(acc.role, "admin", "default role should not be admin");
  }

  // Send a GM command — should be rejected.
  let receivedResult = false;
  room.onMessage(MessageType.GM_RESULT, (payload: { success: boolean; message: string }) => {
    assert.strictEqual(payload.success, false, "non-admin should get success=false");
    assert.ok(
      payload.message.includes("Access denied"),
      `expected "Access denied", got: ${payload.message}`,
    );
    receivedResult = true;
  });

  room.send(MessageType.GM_COMMAND, { command: "/help" });
  await sleep(300);

  assert.ok(receivedResult, "should have received GM_RESULT with rejection");
  console.log("[gmCommands] ✔ non-admin correctly rejected");

  await room.leave();
}

async function testAdminGiveMesos(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[gmCommands] ── admin give mesos ──");

  // Bootstrap this account as admin via the store directly.
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

  // Send a GM command — should succeed.
  let receivedResult = false;
  let resultPayload: { success: boolean; message: string } | null = null;
  room.onMessage(MessageType.GM_RESULT, (payload: { success: boolean; message: string }) => {
    resultPayload = payload;
    receivedResult = true;
  });

  room.send(MessageType.GM_COMMAND, { command: "/give mesos 500" });
  await sleep(300);

  assert.ok(receivedResult, "should have received GM_RESULT");
  assert.ok(resultPayload!.success, `command should succeed, got: ${resultPayload!.message}`);
  assert.ok(
    resultPayload!.message.includes("500"),
    `result should mention amount: ${resultPayload!.message}`,
  );
  assert.strictEqual(me().mesos, startMesos + 500, "mesos should increase by 500");
  console.log(`[gmCommands] ✔ mesos ${startMesos}→${me().mesos}`);

  await room.leave();
}

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

  let resultPayload: { success: boolean; message: string } | null = null;
  room.onMessage(MessageType.GM_RESULT, (payload: { success: boolean; message: string }) => {
    resultPayload = payload;
  });

  room.send(MessageType.GM_COMMAND, { command: "/killall" });
  await sleep(300);

  assert.ok(resultPayload!.success, `/killall should succeed: ${resultPayload!.message}`);
  assert.strictEqual((room.state as any).mobs.size, 0, "all mobs should be cleared");
  console.log("[gmCommands] ✔ killall cleared all mobs");

  await room.leave();
}

// ─── Unit tests: handleGmCommand parser (no Colyseus needed) ────────────────

function testCommandParsing() {
  console.log("[gmCommands] ── command parsing ──");

  // Minimal mock context for unit testing the parser.
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

  // Missing args.
  const r4 = handleGmCommand(mockCtx, "/spawn");
  assert.ok(!r4.success, "/spawn with no args should fail");
  assert.ok(r4.message.includes("Usage"), r4.message);

  console.log("[gmCommands] ✔ command parsing verified");
}

// ─── Audit log ──────────────────────────────────────────────────────────────

function testAuditLog() {
  console.log("[gmCommands] ── audit log ──");

  const entry = logGmAction("acc1", "AdminChar", "/give mesos 100", "", "Gave 100 mesos.");
  assert.strictEqual(entry.accountId, "acc1");
  assert.strictEqual(entry.command, "/give mesos 100");
  assert.strictEqual(entry.result, "Gave 100 mesos.");
  assert.ok(entry.id > 0, "audit entry should have an id");
  assert.ok(entry.createdAt > 0, "audit entry should have a timestamp");

  const log = getAuditLog(10);
  assert.ok(log.length > 0, "audit log should have entries");
  assert.strictEqual(log[log.length - 1]!.command, "/give mesos 100");

  console.log("[gmCommands] ✔ audit log verified");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  // Unit tests (no Colyseus).
  testCommandParsing();
  testAuditLog();

  // Integration tests (with Colyseus).
  await testNonAdminRejected(colyseus);
  await testAdminGiveMesos(colyseus);
  await testAdminKillAll(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[gmCommands] PASS ✔  all GM command tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[gmCommands] FAIL ✘", err);
  process.exit(1);
});
