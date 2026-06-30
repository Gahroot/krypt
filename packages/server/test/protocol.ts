/**
 * Protocol-version gate test — a stale client is told to refresh, a current client gets in.
 *
 * During alpha the server is redeployed often; a browser tab left open on an old build must be
 * rejected with a clear "please refresh" signal instead of silently misbehaving against a newer
 * wire protocol. `AuthedRoom.onAuth` compares the client-reported `protocolVersion` against the
 * server's `PROTOCOL_VERSION` and rejects a mismatch with `PROTOCOL_MISMATCH_CODE` +
 * `PROTOCOL_MISMATCH_MESSAGE`, which the SDK surfaces as a `MatchMakeError` carrying both.
 *
 * Asserts:
 *   1. A join reporting the CURRENT protocol version succeeds.
 *   2. A join reporting an OLD/incompatible protocol version is rejected with the dedicated
 *      code + message (so the client can show a reload button).
 *   3. A join that omits the version (legacy/unversioned caller, e.g. the in-process harness) is
 *      still allowed — back-compat for callers that predate the field.
 *
 * Run: npx tsx test/protocol.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import {
  PROTOCOL_VERSION,
  PROTOCOL_MISMATCH_CODE,
  PROTOCOL_MISMATCH_MESSAGE,
  randomizeAppearance,
} from "@maple/shared";
import appConfig from "../src/app.config";
import { accountStore } from "../src/persistence/store";
import { signToken } from "../src/auth";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => {
  console.error("[protocol] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

async function main() {
  const colyseus = await boot(appConfig);

  const acctId = `proto_${Date.now()}`;
  accountStore.getOrCreate(acctId);
  const char = accountStore.createCharacter(acctId, {
    name: `Proto_${Date.now()}`,
    archetype: "WARRIOR",
    appearance: randomizeAppearance(),
  });
  const token = signToken(acctId);

  // ─── 1) Current protocol version → join succeeds ─────────────────────────────
  const okRoom = await colyseus.sdk.joinOrCreate("meadowfield", {
    token,
    charId: char.charId,
    protocolVersion: PROTOCOL_VERSION,
  });
  await sleep(150);
  const p = (okRoom.state as any).players.get(okRoom.sessionId);
  assert.ok(p, "1) a client on the current protocol version joins");
  await okRoom.leave();
  console.log("[protocol] 1 PASS ✔  current protocol version joins");

  // ─── 2) Old/incompatible version → rejected with the refresh signal ──────────
  let rejected: { code?: number; message?: string } | null = null;
  try {
    await colyseus.sdk.joinOrCreate("meadowfield", {
      token,
      charId: char.charId,
      protocolVersion: PROTOCOL_VERSION - 1, // a stale build
    });
  } catch (err) {
    rejected = err as { code?: number; message?: string };
  }
  assert.ok(rejected, "2) a stale client must be rejected");
  assert.strictEqual(
    rejected!.code,
    PROTOCOL_MISMATCH_CODE,
    "2) rejection carries the dedicated protocol-mismatch code",
  );
  assert.strictEqual(
    rejected!.message,
    PROTOCOL_MISMATCH_MESSAGE,
    "2) rejection carries the human-facing refresh message",
  );
  console.log("[protocol] 2 PASS ✔  stale client rejected with refresh signal");

  // ─── 3) Missing version (legacy caller) → still allowed ──────────────────────
  const legacyRoom = await colyseus.sdk.joinOrCreate("meadowfield", {
    token,
    charId: char.charId,
  });
  await sleep(150);
  assert.ok(
    (legacyRoom.state as any).players.get(legacyRoom.sessionId),
    "3) a caller that omits protocolVersion is treated as compatible",
  );
  await legacyRoom.leave();
  console.log("[protocol] 3 PASS ✔  unversioned legacy caller allowed");

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[protocol] PASS ✔  version gate rejects stale clients, admits current ones");
  process.exit(0);
}

main().catch((err) => {
  console.error("[protocol] FAIL ✘", err);
  process.exit(1);
});
