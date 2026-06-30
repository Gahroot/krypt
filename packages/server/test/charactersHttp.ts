/**
 * HTTP character-roster test — exercises the REST endpoints behind the Character
 * Select screen:
 *   GET    /characters            → list the authed account's characters
 *   POST   /characters            → create (name format / uniqueness / slot cap)
 *   DELETE /characters/:charId    → delete (ownership + online gates)
 *
 * Identity is always derived from the server-signed token, never the body, so
 * the key property under test is that one account can never see or mutate
 * another account's characters.
 *
 * Run: npx tsx test/charactersHttp.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { signToken, newGuestAccountId } from "../src/auth";
import { accountStore } from "../src/persistence/store";
import { MAX_CHARACTERS_PER_ACCOUNT } from "../src/characters";

const watchdog = setTimeout(() => {
  console.error("[charactersHttp] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 20_000);

interface HttpResult {
  status: number;
  data: any;
}

async function main(): Promise<void> {
  const colyseus = await boot(appConfig);

  const req = async (
    method: "get" | "post" | "delete",
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<HttpResult> => {
    const headers = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
    try {
      const res = await colyseus.http[method](path, { headers, body: opts.body });
      return { status: res.statusCode, data: res.data };
    } catch (err) {
      const e = err as { statusCode?: number; data?: any };
      return { status: e.statusCode ?? 0, data: e.data ?? {} };
    }
  };

  const uniq = () => Math.random().toString(36).slice(2, 8);

  // Two distinct guest accounts.
  const acctA = newGuestAccountId();
  const acctB = newGuestAccountId();
  accountStore.getOrCreate(acctA);
  accountStore.getOrCreate(acctB);
  const tokenA = signToken(acctA);
  const tokenB = signToken(acctB);

  // ── 1) Auth required ────────────────────────────────────────────────────────
  const noAuth = await req("get", "/characters");
  assert.strictEqual(noAuth.status, 401, "1) /characters requires a token");
  console.log("[charactersHttp] 1 PASS ✔  unauthenticated list rejected");

  // ── 2) Empty roster + slot cap reported ──────────────────────────────────────
  const empty = await req("get", "/characters", { token: tokenA });
  assert.strictEqual(empty.status, 200, "2) list ok");
  assert.deepStrictEqual(empty.data.characters, [], "2) account A starts empty");
  assert.strictEqual(empty.data.max, MAX_CHARACTERS_PER_ACCOUNT, "2) slot cap reported");
  console.log("[charactersHttp] 2 PASS ✔  empty roster + slot cap");

  // ── 3) Create returns a summary; list reflects it ────────────────────────────
  const nameA1 = `Hero${uniq()}`;
  const create = await req("post", "/characters", { token: tokenA, body: { name: nameA1 } });
  assert.strictEqual(create.status, 201, "3) create ok");
  assert.strictEqual(create.data.character.name, nameA1, "3) summary name");
  assert.strictEqual(create.data.character.className, "Beginner", "3) class name resolved");
  assert.strictEqual(create.data.character.level, 1, "3) starts level 1");
  const charA1 = create.data.character.charId as string;

  const afterCreate = await req("get", "/characters", { token: tokenA });
  assert.strictEqual(afterCreate.data.characters.length, 1, "3) roster has one char");
  console.log("[charactersHttp] 3 PASS ✔  create + list");

  // ── 4) Invalid + duplicate names rejected ────────────────────────────────────
  const bad = await req("post", "/characters", { token: tokenA, body: { name: "!!" } });
  assert.strictEqual(bad.status, 400, "4) bad name rejected");
  const dup = await req("post", "/characters", { token: tokenA, body: { name: nameA1 } });
  assert.strictEqual(dup.status, 409, "4) duplicate name rejected");
  console.log("[charactersHttp] 4 PASS ✔  name validation");

  // ── 5) Cross-account isolation: B can't see or delete A's char ────────────────
  const bList = await req("get", "/characters", { token: tokenB });
  assert.strictEqual(bList.data.characters.length, 0, "5) B sees none of A's characters");
  const bDelete = await req("delete", `/characters/${charA1}`, { token: tokenB });
  assert.strictEqual(bDelete.status, 404, "5) B cannot delete A's character (404)");
  assert.ok(accountStore.getCharacter(charA1), "5) A's character still exists");
  console.log("[charactersHttp] 5 PASS ✔  ownership isolation");

  // ── 6) Owner can delete; roster shrinks ──────────────────────────────────────
  const del = await req("delete", `/characters/${charA1}`, { token: tokenA });
  assert.strictEqual(del.status, 200, "6) owner delete ok");
  assert.ok(!accountStore.getCharacter(charA1), "6) character gone from store");
  console.log("[charactersHttp] 6 PASS ✔  owner delete");

  // ── 7) Slot cap enforced on create ───────────────────────────────────────────
  for (let i = 0; i < MAX_CHARACTERS_PER_ACCOUNT; i++) {
    const r = await req("post", "/characters", {
      token: tokenA,
      body: { name: `Cap${uniq()}${i}` },
    });
    assert.strictEqual(r.status, 201, `7) create #${i + 1} within cap`);
  }
  const over = await req("post", "/characters", { token: tokenA, body: { name: `Over${uniq()}` } });
  assert.strictEqual(over.status, 409, "7) create beyond cap rejected");
  console.log("[charactersHttp] 7 PASS ✔  slot cap enforced");

  // Cleanup the characters we created so the dev DB stays clean.
  for (const c of accountStore.listCharacters(acctA)) accountStore.deleteCharacter(c.charId);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[charactersHttp] PASS ✔  all tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[charactersHttp] FAIL ✘", err);
  process.exit(1);
});
