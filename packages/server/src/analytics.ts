/**
 * Convenience wrapper around the analytics store for room code.
 *
 * Provides a single `track` function that handles hashing and dispatching.
 * Rooms import this instead of talking to the store directly.
 *
 * Usage:
 *   import { track } from "../analytics";
 *   track("level_up", accountId, charId, { level: 15, levelsGained: 1, class: "WARRIOR" });
 */
import { analytics, hashAccountId } from "./persistence/analyticsStore";
import type { AnalyticsEventType, AnalyticsPayload } from "./analyticsEvents";

/**
 * Emit an analytics event. The raw accountId is hashed to a SHA-256 digest
 * before storage — no PII is ever written.
 */
export function track<T extends AnalyticsEventType>(
  eventType: T,
  accountId: string,
  charId: string | null,
  payload: Extract<AnalyticsPayload, { type: T }>["payload"],
): void {
  analytics.track(
    eventType,
    hashAccountId(accountId),
    charId,
    payload as unknown as Record<string, unknown>,
  );
}
