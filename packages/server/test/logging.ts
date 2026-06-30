/**
 * Observability test — proves the hardened logging + error-handling layer:
 *
 *   1. Structured logs are single-line JSON with level + context (greppable).
 *   2. Secrets/PII (token, password, email, dsn, …) are redacted; safe ids kept.
 *   3. Errors serialise with name/message/stack (not `{}`); child context merges.
 *   4. The error tracker is gated behind a DSN env and captures via an injected sink.
 *   5. A thrown error inside a room message handler is CAUGHT (not fatal): it is
 *      logged with room/session context, shipped to the tracker, and the room keeps
 *      serving the still-connected client.
 *
 * Run: SENTRY_DSN=test://logging npx tsx test/logging.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import appConfig from "../src/app.config";
import { accountStore } from "../src/persistence/store";
import { randomizeAppearance } from "@maple/shared";
import { log, redact } from "../src/logger";
import {
  captureException,
  errorTrackingEnabled,
  initErrorTracker,
  setErrorSink,
  type ErrorSink,
} from "../src/errorTracker";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => {
  console.error("[logging] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

// ─── Console capture helper ───────────────────────────────────────────────────
// The logger emits via console.log (info/debug) and console.error (warn/error).
// Tee both into a buffer so we can assert on the exact emitted lines while keeping
// real output flowing for debugging.
const realLog = console.log.bind(console);
const realErr = console.error.bind(console);
let buffer: string[] = [];
function startCapture(): void {
  buffer = [];
  console.log = (...a: unknown[]) => {
    buffer.push(a.map(String).join(" "));
  };
  console.error = (...a: unknown[]) => {
    buffer.push(a.map(String).join(" "));
  };
}
function stopCapture(): string[] {
  console.log = realLog;
  console.error = realErr;
  return buffer;
}

/** Parse only the lines that are valid JSON log records. */
function jsonLines(lines: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object") out.push(obj as Record<string, unknown>);
    } catch {
      /* not a JSON line */
    }
  }
  return out;
}

// ─── Test 1: structured JSON, levels, redaction, error serialisation ──────────
function testLoggerUnit(): void {
  realLog("[logging] Test 1: structured JSON + redaction + error serialisation");

  startCapture();
  log.info("hello", {
    accountId: "acct_123",
    token: "super-secret-token",
    password: "hunter2",
    email: "player@example.com",
    nested: { authorization: "Bearer xyz", keep: 7 },
  });
  log.error("kaboom", { err: new Error("boom-msg") });
  log.debug("should appear in dev (LOG_LEVEL=debug)");
  const lines = stopCapture();

  const records = jsonLines(lines);
  const info = records.find((r) => r.msg === "hello");
  assert.ok(info, "info line should be valid JSON");
  assert.strictEqual(info.level, "info", "level field present");
  assert.ok(typeof info.t === "string", "timestamp field present");
  assert.strictEqual(info.accountId, "acct_123", "non-sensitive accountId preserved");
  assert.strictEqual(info.token, "[redacted]", "token redacted");
  assert.strictEqual(info.password, "[redacted]", "password redacted");
  assert.strictEqual(info.email, "[redacted]", "email (PII) redacted");
  assert.strictEqual(
    (info.nested as Record<string, unknown>).authorization,
    "[redacted]",
    "nested authorization redacted",
  );
  assert.strictEqual(
    (info.nested as Record<string, unknown>).keep,
    7,
    "nested non-sensitive value preserved",
  );

  const errRec = records.find((r) => r.msg === "kaboom");
  assert.ok(errRec, "error line should be valid JSON");
  assert.strictEqual(errRec.level, "error", "error level");
  const serialised = errRec.err as Record<string, unknown>;
  assert.strictEqual(serialised.message, "boom-msg", "error message serialised");
  assert.ok(
    typeof serialised.stack === "string" && serialised.stack.length > 0,
    "error stack serialised (not empty object)",
  );

  // redact() is pure and reusable.
  const safe = redact({ secret: "x", ok: 1 }) as Record<string, unknown>;
  assert.strictEqual(safe.secret, "[redacted]");
  assert.strictEqual(safe.ok, 1);

  realLog("[logging] ✔ structured JSON, levels, redaction, error serialisation");
}

// ─── Test 2: child context ────────────────────────────────────────────────────
function testChildContext(): void {
  realLog("[logging] Test 2: child logger context");
  const child = log.child({ room: "market_room", roomId: "abc" });
  startCapture();
  child.info("scoped", { extra: 1 });
  const records = jsonLines(stopCapture());
  const rec = records.find((r) => r.msg === "scoped");
  assert.ok(rec, "child line emitted");
  assert.strictEqual(rec.room, "market_room", "child context room bound");
  assert.strictEqual(rec.roomId, "abc", "child context roomId bound");
  assert.strictEqual(rec.extra, 1, "per-call meta merged");
  realLog("[logging] ✔ child context binds + merges");
}

// ─── Test 3: error tracker gated behind DSN ──────────────────────────────────
async function testErrorTracker(): Promise<void> {
  realLog("[logging] Test 3: error tracker gated behind DSN env");
  assert.ok(
    errorTrackingEnabled(),
    "SENTRY_DSN must be set for this test (run via the test:suite script)",
  );

  const captured: { error: Error; context?: Record<string, unknown> }[] = [];
  const sink: ErrorSink = (error, context) => captured.push({ error, context });
  setErrorSink(sink);
  await initErrorTracker(); // injected sink wins over the Sentry loader

  captureException(new Error("tracked"), { accountId: "acct_xyz", token: "leak-me" });
  assert.strictEqual(captured.length, 1, "captureException routed to the sink");
  assert.strictEqual(captured[0]!.error.message, "tracked", "original error forwarded");
  assert.strictEqual(captured[0]!.context?.accountId, "acct_xyz", "context forwarded");
  realLog("[logging] ✔ DSN-gated tracker captures via sink");
  return;
}

// ─── Test 4: thrown handler error is caught, logged, captured; room survives ──
async function testRoomHandlerThrow(
  colyseus: Awaited<ReturnType<typeof bootAuthed>>,
): Promise<void> {
  realLog("[logging] Test 4: thrown handler error is caught + logged + captured");

  const captured: { error: Error; context?: Record<string, unknown> }[] = [];
  setErrorSink((error, context) => captured.push({ error, context }));

  const acct = `log_e2e_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: `LogE2E${Date.now() % 100000}`,
    archetype: "BEGINNER",
    appearance: randomizeAppearance(() => 0.5),
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  // Register a handler that throws. Because the room defines onUncaughtException
  // (inherited from AuthedRoom), Colyseus wraps this handler in try/catch.
  serverRoom.onMessage("crash_test", () => {
    throw new Error("handler exploded");
  });

  const sdk = await colyseus.connectTo(serverRoom, { charId: rec.charId, accountId: acct });
  sdk.onMessage("*", () => {
    /* suppress unhandled message warnings */
  });
  await sleep(300);

  startCapture();
  sdk.send("crash_test", { hello: "world" });
  await sleep(300);
  const records = jsonLines(stopCapture());

  // The room logged the handler error with context, and did NOT crash.
  const errLine = records.find((r) => r.msg === "room handler error");
  assert.ok(errLine, "handler error should be logged as structured JSON");
  assert.strictEqual(errLine.method, "onMessage", "method context present");
  assert.strictEqual(errLine.messageType, "crash_test", "message type context present");
  assert.strictEqual(errLine.room, "meadowfield", "room context present");
  const loggedErr = errLine.err as Record<string, unknown>;
  assert.strictEqual(loggedErr.message, "handler exploded", "original throw logged");

  // The exception reached the tracker with room context.
  assert.ok(captured.length >= 1, "thrown handler error captured by tracker");
  const hit = captured.find((c) => c.error.message === "handler exploded");
  assert.ok(hit, "captured error is the original throw");
  assert.strictEqual(hit!.context?.room, "meadowfield", "tracker context carries room");

  // The room survived: still registered and the client still connected.
  assert.ok(colyseus.getRoomById(serverRoom.roomId), "room still alive after handler throw");
  assert.ok(sdk.connection.isOpen, "client still connected after handler throw");

  // And it still processes subsequent messages (no wedged state).
  sdk.send("crash_test", {});
  await sleep(150);
  assert.ok(captured.length >= 2, "room keeps handling messages after a throw");

  await sdk.leave();
  realLog("[logging] ✔ handler throw caught, logged with context, room survived, captured");
}

async function main(): Promise<void> {
  testLoggerUnit();
  testChildContext();
  await testErrorTracker();

  const colyseus = await bootAuthed(appConfig);
  await testRoomHandlerThrow(colyseus);

  setErrorSink(null);
  await colyseus.shutdown();
  clearTimeout(watchdog);
  realLog("[logging] PASS ✔  observability layer verified");
  process.exit(0);
}

main().catch((err) => {
  console.error = realErr;
  console.log = realLog;
  console.error("[logging] FAIL ✘", err);
  process.exit(1);
});
