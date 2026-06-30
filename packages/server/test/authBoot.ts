/**
 * Test harness helper — boots the Colyseus test server with authentication wired in.
 *
 * Real clients authenticate over HTTP (`/auth/guest` | `/auth/login`) and present a
 * signed token on every join. In tests we boot in-process, so we wrap the SDK's join
 * methods to mint a valid token bound to the `accountId` the test passes in `options`
 * (or a fresh guest accountId when none is given). The token rides along as
 * `options.token`, which the static `onAuth` accepts.
 *
 * This keeps existing tests almost unchanged: swap `boot(appConfig)` →
 * `bootAuthed(appConfig)` and identity stays exactly as the test intends — but now it
 * flows through the same verification path a real client must pass.
 */
import { boot } from "@colyseus/testing";
import { signToken, newGuestAccountId } from "../src/auth";
import { accountStore } from "../src/persistence/store";

type AnyOptions = Record<string, unknown> & {
  accountId?: string;
  charId?: string;
  token?: string;
};

/**
 * Attach a valid token to the join options, modelling the real authenticated user:
 *   1. an explicit `accountId` wins (the test is asserting on that account);
 *   2. otherwise, if a `charId` is given, bind to the character's owning account so
 *      the ownership gate in onJoin passes (mirrors a real client loading its own
 *      character);
 *   3. otherwise mint a fresh guest account.
 */
function withToken(options: AnyOptions = {}): AnyOptions {
  if (options.token) return options;
  let accountId: string | undefined =
    typeof options.accountId === "string" ? options.accountId : undefined;
  if (!accountId && typeof options.charId === "string") {
    accountId = accountStore.getCharacter(options.charId)?.accountId;
  }
  if (!accountId) accountId = newGuestAccountId();
  return { ...options, token: signToken(accountId) };
}

export async function bootAuthed(
  appConfig: Parameters<typeof boot>[0],
): Promise<Awaited<ReturnType<typeof boot>>> {
  const colyseus = await boot(appConfig);
  const sdk = colyseus.sdk as {
    joinOrCreate: (name: string, options?: AnyOptions) => unknown;
    joinById: (roomId: string, options?: AnyOptions) => unknown;
    join: (name: string, options?: AnyOptions) => unknown;
    create: (name: string, options?: AnyOptions) => unknown;
  };

  const origJoinOrCreate = sdk.joinOrCreate.bind(sdk);
  sdk.joinOrCreate = (name: string, options: AnyOptions = {}) =>
    origJoinOrCreate(name, withToken(options));

  const origJoinById = sdk.joinById.bind(sdk);
  sdk.joinById = (roomId: string, options: AnyOptions = {}) =>
    origJoinById(roomId, withToken(options));

  const origJoin = sdk.join.bind(sdk);
  sdk.join = (name: string, options: AnyOptions = {}) => origJoin(name, withToken(options));

  const origCreate = sdk.create.bind(sdk);
  sdk.create = (name: string, options: AnyOptions = {}) => origCreate(name, withToken(options));

  const origConnectTo = colyseus.connectTo.bind(colyseus);
  (colyseus as { connectTo: (room: unknown, options?: AnyOptions) => unknown }).connectTo = (
    room: unknown,
    options: AnyOptions = {},
  ) => origConnectTo(room as Parameters<typeof origConnectTo>[0], withToken(options));

  return colyseus;
}
