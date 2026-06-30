/**
 * Auth test — identity-spoofing defence PLUS the persistence/recovery flow.
 *
 * Part A (spoofing, unchanged):
 *   1. A join WITHOUT a valid token is rejected (no anonymous identity).
 *   2. A client authenticated as account A cannot load account B's character by
 *      passing B's `charId` in options — the ownership gate ignores it.
 *   3. Passing someone else's `accountId` in options has NO effect: identity is
 *      derived from the signed token, not from client-supplied options.
 *   4. `/auth/guest` + `/auth/login` issue/refresh server-bound tokens.
 *
 * Part B (credential recovery — the acceptance criteria):
 *   6. Register (email+password) → "log out" / clear localStorage → log back in →
 *      recover the SAME character + mesos + items.
 *   7. Wrong password and duplicate email are rejected; the recovered token still
 *      loads the character end-to-end through a room join.
 *   8. A guest "claims"/upgrades their account, keeping the same accountId (and all
 *      progress), then recovers it from a fresh browser via email+password.
 *   9. "Sign in with wallet": an EIP-191 signed nonce verifies via viem; the same
 *      wallet recovers the same account; replayed/forged signatures are rejected.
 *  10. Login is rate-limited.
 *
 * Run: npx tsx test/auth.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import appConfig from "../src/app.config";
import { accountStore } from "../src/persistence/store";
import { signToken, verifyToken, newGuestAccountId } from "../src/auth";
import { randomizeAppearance } from "@maple/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => {
  console.error("[auth] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

async function main() {
  const colyseus = await boot(appConfig);

  // ─── Setup: two distinct accounts, each with its own character. ───────────────
  const victimAcct = `auth_victim_${Date.now()}`;
  const attackerAcct = `auth_attacker_${Date.now()}`;
  accountStore.getOrCreate(victimAcct);
  accountStore.getOrCreate(attackerAcct);

  const victimChar = accountStore.createCharacter(victimAcct, {
    name: `Victim_${Date.now()}`,
    archetype: "WARRIOR",
    appearance: randomizeAppearance(),
  });
  const attackerChar = accountStore.createCharacter(attackerAcct, {
    name: `Attacker_${Date.now()}`,
    archetype: "MAGE",
    appearance: randomizeAppearance(),
  });
  // Give the victim a distinctive amount of mesos so we can prove identity.
  accountStore.setMesos(victimChar.charId, 999_999);

  // ─── 1) No token → join rejected ─────────────────────────────────────────────
  let rejected = false;
  try {
    await colyseus.sdk.joinOrCreate("meadowfield", { charId: victimChar.charId });
  } catch {
    rejected = true;
  }
  assert.ok(rejected, "1) join without a valid token must be rejected");
  console.log("[auth] 1 PASS ✔  anonymous join rejected");

  // ─── 2) Garbage token → join rejected ────────────────────────────────────────
  let rejected2 = false;
  try {
    await colyseus.sdk.joinOrCreate("meadowfield", {
      charId: victimChar.charId,
      token: "not.a.realtoken",
    });
  } catch {
    rejected2 = true;
  }
  assert.ok(rejected2, "2) join with a forged token must be rejected");
  console.log("[auth] 2 PASS ✔  forged token rejected");

  // ─── 3) Attacker (own valid token) tries to load victim's character ──────────
  // The attacker authenticates legitimately as their own account, but passes the
  // victim's charId AND the victim's accountId in options — the classic exploit.
  const attackerToken = signToken(attackerAcct);
  const room = await colyseus.sdk.joinOrCreate("meadowfield", {
    token: attackerToken,
    charId: victimChar.charId, // someone else's character
    accountId: victimAcct, // someone else's account id (must be ignored)
  });
  await sleep(200);

  const me = () => (room.state as any).players.get(room.sessionId);
  const p = me();
  assert.ok(p, "3) attacker should still join (as themselves)");
  assert.notStrictEqual(
    p.charId,
    victimChar.charId,
    "3) attacker must NOT load the victim's character via charId",
  );
  // Identity comes from the token: the attacker loads their OWN character, despite
  // passing the victim's accountId/charId in options.
  assert.strictEqual(
    p.charId,
    attackerChar.charId,
    "3) identity must come from the token, not options.accountId/charId",
  );
  assert.notStrictEqual(p.mesos, 999_999, "3) attacker must not inherit victim's mesos");
  console.log(`[auth] 3 PASS ✔  spoof blocked (loaded char=${p.charId}, not victim)`);
  await room.leave();

  // ─── 4) Attacker CAN load their own character with their own token ───────────
  const ownRoom = await colyseus.sdk.joinOrCreate("meadowfield", {
    token: attackerToken,
    charId: attackerChar.charId,
  });
  await sleep(200);
  const op = (ownRoom.state as any).players.get(ownRoom.sessionId);
  assert.strictEqual(op.charId, attackerChar.charId, "4) own character loads with a valid token");
  console.log("[auth] 4 PASS ✔  legitimate self-load works");
  await ownRoom.leave();

  // ─── 5) Token plumbing: guest / login round-trip + tamper detection ──────────
  const guestId = newGuestAccountId();
  const guestToken = signToken(guestId);
  assert.deepStrictEqual(
    verifyToken(guestToken),
    { accountId: guestId },
    "5) a freshly signed token verifies to its account",
  );
  assert.strictEqual(verifyToken(guestToken + "x"), null, "5) tampered token fails verification");
  assert.strictEqual(verifyToken(""), null, "5) empty token fails verification");
  assert.strictEqual(verifyToken(undefined), null, "5) missing token fails verification");
  // Expired token.
  const expired = signToken(guestId, -1000);
  assert.strictEqual(verifyToken(expired), null, "5) expired token fails verification");
  console.log("[auth] 5 PASS ✔  token sign/verify/expiry correct");

  // ─── HTTP helper: never throw on 4xx/5xx — return { status, data }. ───────────
  interface HttpResult {
    status: number;
    data: { token?: string; accountId?: string; message?: string; error?: string };
  }
  const http = async (path: string, body: Record<string, unknown>): Promise<HttpResult> => {
    try {
      const res = await colyseus.http.post(path, { body });
      return { status: res.statusCode, data: res.data };
    } catch (err) {
      const e = err as { statusCode?: number; data?: HttpResult["data"] };
      return { status: e.statusCode ?? 0, data: e.data ?? {} };
    }
  };

  const uniq = () => Math.random().toString(36).slice(2, 8);

  // ─── 6) Register → log out → log back in → recover character + mesos + items ──
  const email = `tester_${Date.now()}_${uniq()}@example.com`;
  const password = "s3cret-passw0rd";

  const reg = await http("/auth/register", { email, password });
  assert.strictEqual(reg.status, 200, "6) register succeeds");
  const acctId = reg.data.accountId!;
  assert.ok(acctId, "6) register returns a server-issued accountId");
  assert.ok(reg.data.token, "6) register returns a session token");

  // Simulate gameplay on the registered account: a character with distinctive
  // mesos and an item that must survive a logout.
  const recChar = accountStore.createCharacter(acctId, {
    name: `Recover_${uniq()}`,
    archetype: "WARRIOR",
    appearance: randomizeAppearance(),
  });
  accountStore.setMesos(recChar.charId, 4242);
  const itemUid = `it_${Date.now()}`;
  accountStore.addItem(recChar.charId, {
    uid: itemUid,
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "COMMON",
    lines: 0,
    minted: false,
  });

  // "Log out / clear localStorage / use another browser" → discard the token, then
  // log back in with ONLY the email + password.
  const login = await http("/auth/login", { email, password });
  assert.strictEqual(login.status, 200, "6) email+password login succeeds");
  assert.strictEqual(login.data.accountId, acctId, "6) login recovers the same accountId");

  const recovered = accountStore.listCharacters(login.data.accountId!);
  assert.strictEqual(recovered.length, 1, "6) the character is recovered");
  assert.strictEqual(recovered[0].charId, recChar.charId, "6) same character id");
  assert.strictEqual(recovered[0].mesos, 4242, "6) mesos recovered");
  assert.ok(recovered[0].inventory[itemUid], "6) item recovered");
  console.log("[auth] 6 PASS ✔  register → logout → login recovers character + mesos + items");

  // ─── 7) Wrong password / duplicate email rejected; recovered token loads char ─
  const wrong = await http("/auth/login", { email, password: "not-the-password" });
  assert.strictEqual(wrong.status, 401, "7) wrong password rejected");
  const dup = await http("/auth/register", { email, password });
  assert.strictEqual(dup.status, 409, "7) duplicate email rejected");

  const recRoom = await colyseus.sdk.joinOrCreate("meadowfield", {
    token: login.data.token,
    charId: recChar.charId,
  });
  await sleep(200);
  const recPlayer = (recRoom.state as any).players.get(recRoom.sessionId);
  assert.strictEqual(recPlayer.charId, recChar.charId, "7) recovered token loads the character");
  assert.strictEqual(recPlayer.mesos, 4242, "7) recovered character keeps its mesos in-game");
  await recRoom.leave();
  console.log("[auth] 7 PASS ✔  bad creds rejected; recovered token loads char end-to-end");

  // ─── 8) Guest claim/upgrade keeps the same accountId + progress ───────────────
  const guest = await http("/auth/guest", {});
  assert.strictEqual(guest.status, 200, "8) guest sign-in succeeds");
  const guestAccountId = guest.data.accountId!;
  const guestChar = accountStore.createCharacter(guestAccountId, {
    name: `Guest_${uniq()}`,
    archetype: "MAGE",
    appearance: randomizeAppearance(),
  });
  accountStore.setMesos(guestChar.charId, 777);

  const claimEmail = `claim_${Date.now()}_${uniq()}@example.com`;
  const claimPw = "claim-passw0rd";
  const claim = await http("/auth/claim", {
    token: guest.data.token,
    email: claimEmail,
    password: claimPw,
  });
  assert.strictEqual(claim.status, 200, "8) claim succeeds");
  assert.strictEqual(
    claim.data.accountId,
    guestAccountId,
    "8) claim preserves the guest accountId",
  );

  // Fresh browser: recover the upgraded account by its new credential.
  const claimLogin = await http("/auth/login", { email: claimEmail, password: claimPw });
  assert.strictEqual(claimLogin.status, 200, "8) claimed account logs in");
  assert.strictEqual(claimLogin.data.accountId, guestAccountId, "8) same accountId after claim");
  const claimChars = accountStore.listCharacters(claimLogin.data.accountId!);
  assert.ok(
    claimChars.some((c) => c.charId === guestChar.charId && c.mesos === 777),
    "8) claimed account keeps the guest's character + mesos",
  );
  console.log("[auth] 8 PASS ✔  guest claim keeps accountId + progress and recovers");

  // ─── 9) Sign in with wallet (EIP-191 nonce) ──────────────────────────────────
  const walletAcct = privateKeyToAccount(generatePrivateKey());
  const address = walletAcct.address;

  const nonce1 = await http("/auth/wallet/nonce", { address });
  assert.strictEqual(nonce1.status, 200, "9) nonce issued");
  assert.ok(nonce1.data.message, "9) nonce returns a message to sign");
  const sig1 = await walletAcct.signMessage({ message: nonce1.data.message! });
  const verify1 = await http("/auth/wallet/verify", { address, signature: sig1 });
  assert.strictEqual(verify1.status, 200, "9) valid signature authenticates");
  const walletAccountId = verify1.data.accountId!;
  assert.ok(walletAccountId, "9) wallet sign-in mints/links an account");

  // Same wallet again → same account (recovery).
  const nonce2 = await http("/auth/wallet/nonce", { address });
  const sig2 = await walletAcct.signMessage({ message: nonce2.data.message! });
  const verify2 = await http("/auth/wallet/verify", { address, signature: sig2 });
  assert.strictEqual(verify2.data.accountId, walletAccountId, "9) same wallet → same account");

  // Replay / mismatched signature against a fresh nonce is rejected.
  await http("/auth/wallet/nonce", { address });
  const replay = await http("/auth/wallet/verify", { address, signature: sig2 });
  assert.strictEqual(replay.status, 401, "9) stale/replayed signature rejected");
  console.log("[auth] 9 PASS ✔  wallet nonce sign-in verifies, recovers, blocks replay");

  // ─── 10) Login rate limiting ─────────────────────────────────────────────────
  const rlEmail = `ratelimit_${Date.now()}_${uniq()}@example.com`;
  let got429 = false;
  for (let i = 0; i < 13; i++) {
    const r = await http("/auth/login", { email: rlEmail, password: "definitely-wrong" });
    if (r.status === 429) {
      got429 = true;
      break;
    }
  }
  assert.ok(got429, "10) repeated failed logins are rate-limited");
  console.log("[auth] 10 PASS ✔  login is rate limited");

  // ─── 11) POST /auth/refresh — renew a valid token, reject an expired/invalid one ─
  // A still-valid token refreshes to a NEW token (later expiry, same accountId) so a
  // long play session is never kicked.
  const refreshGuest = await http("/auth/guest", {});
  const refreshAcct = refreshGuest.data.accountId!;
  const oldToken = refreshGuest.data.token!;
  await sleep(1100); // ensure a strictly later `iat`/`exp` (seconds-resolution safety)
  const refreshed = await http("/auth/refresh", { token: oldToken });
  assert.strictEqual(refreshed.status, 200, "11) a valid token refreshes");
  assert.strictEqual(refreshed.data.accountId, refreshAcct, "11) refresh keeps the same accountId");
  assert.ok(refreshed.data.token, "11) refresh returns a fresh token");
  assert.notStrictEqual(refreshed.data.token, oldToken, "11) refreshed token is a new token");
  // The refreshed token still verifies and authenticates a room join end-to-end.
  assert.deepStrictEqual(
    verifyToken(refreshed.data.token),
    { accountId: refreshAcct },
    "11) refreshed token verifies to the same account",
  );
  // An expired/invalid token is cleanly rejected with 401 (forces a re-login).
  const expiredTok = signToken(refreshAcct, -1000);
  const refExpired = await http("/auth/refresh", { token: expiredTok });
  assert.strictEqual(refExpired.status, 401, "11) an expired token is rejected with 401");
  const refGarbage = await http("/auth/refresh", { token: "not.a.token" });
  assert.strictEqual(refGarbage.status, 401, "11) a malformed token is rejected with 401");
  const refMissing = await http("/auth/refresh", {});
  assert.strictEqual(refMissing.status, 401, "11) a missing token is rejected with 401");
  console.log("[auth] 11 PASS ✔  /auth/refresh renews valid tokens, rejects expired/invalid");

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[auth] PASS ✔  spoofing closed + credential recovery works");
  process.exit(0);
}

main().catch((err) => {
  console.error("[auth] FAIL ✘", err);
  process.exit(1);
});
