import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";
import { Player } from "./Player";

/**
 * PQStageProgressSchema — synced progress for a single stage.
 */
export class PQStageProgressSchema extends Schema {
  @type("uint8") ordinal = 0;
  @type("string") label = "";
  @type("string") objectiveKind = "";
  @type("uint16") current = 0;
  @type("uint16") target = 0;
  @type("boolean") completed = false;
}

/**
 * PQState — the synced state of a Party Quest room instance.
 *
 * Tracks the active PQ definition, stage machine position, countdown timer,
 * and shared objective progress for all connected players.
 */
export class PQState extends Schema {
  /** PQ definition id (key in PARTY_QUESTS). */
  @type("string") pqId = "";
  /** Human-readable name. */
  @type("string") pqName = "";

  /** "waiting" | "countdown" | "active" | "success" | "failed" */
  @type("string") status: "waiting" | "countdown" | "active" | "success" | "failed" = "waiting";

  /** Remaining time in milliseconds (server-only precision; client sees seconds). */
  @type("number") timeRemainingMs = 0;

  /** 0-based index of the currently active stage. */
  @type("uint8") activeStage = 0;

  /** Number of stages fully cleared. */
  @type("uint8") stagesCleared = 0;

  /** Total number of stages in the PQ. */
  @type("uint8") totalStages = 0;

  /** Per-stage progress snapshots (synced so clients can render a stage tracker). */
  @type([PQStageProgressSchema]) stages = new ArraySchema<PQStageProgressSchema>();

  /** Players currently in the PQ instance. */
  @type({ map: Player }) players = new MapSchema<Player>();
}
