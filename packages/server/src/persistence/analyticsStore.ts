/**
 * Durable append-only analytics store.
 *
 * Every event is written to the `analytics_events` SQLite table (migration 008).
 * The accountId is SHA-256 hashed before storage — no PII is ever persisted.
 *
 * Usage:
 *   import { analytics } from "./analyticsStore";
 *   analytics.track("level_up", accountHash, charId, { level: 15, levelsGained: 1, class: "WARRIOR" });
 */
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { openDb } from "./db";
import type { AnalyticsEventType } from "../analyticsEvents";

// ─── Account hashing ────────────────────────────────────────────────────────

/** SHA-256 hex digest of a raw accountId. Deterministic, privacy-safe. */
export function hashAccountId(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ─── Store ──────────────────────────────────────────────────────────────────

export class AnalyticsStore {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor() {
    this.db = openDb();
    this.insertStmt = this.db.prepare(
      "INSERT INTO analytics_events (event_type, account_id, char_id, payload) VALUES (?, ?, ?, ?)",
    );
  }

  /** Append a structured event. Non-blocking call — errors are logged, not thrown. */
  track(
    eventType: AnalyticsEventType,
    accountHash: string,
    charId: string | null,
    payload: Record<string, unknown>,
  ): void {
    try {
      this.insertStmt.run(eventType, accountHash, charId, JSON.stringify(payload));
    } catch (err) {
      // Never crash the game loop over analytics. Log and move on.
      console.error("[analytics] failed to write event:", eventType, err);
    }
  }

  /** Read all events (for aggregation scripts). */
  all(): {
    id: number;
    eventType: string;
    accountId: string;
    charId: string | null;
    payload: Record<string, unknown>;
    createdAt: number;
  }[] {
    const rows = this.db.prepare("SELECT * FROM analytics_events ORDER BY id ASC").all() as {
      id: number;
      event_type: string;
      account_id: string;
      char_id: string | null;
      payload: string;
      created_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      accountId: r.account_id,
      charId: r.char_id,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  }

  /** Read events within a time window. */
  eventsInRange(
    startMs: number,
    endMs: number,
  ): {
    id: number;
    eventType: string;
    accountId: string;
    charId: string | null;
    payload: Record<string, unknown>;
    createdAt: number;
  }[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM analytics_events WHERE created_at >= ? AND created_at <= ? ORDER BY id ASC",
      )
      .all(startMs, endMs) as {
      id: number;
      event_type: string;
      account_id: string;
      char_id: string | null;
      payload: string;
      created_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      accountId: r.account_id,
      charId: r.char_id,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  }
}

/** Singleton — imported by rooms. */
export const analytics = new AnalyticsStore();
