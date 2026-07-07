/**
 * Quest engine — pure-ish logic for quest lifecycle.
 *
 * Operates on a QuestState[] array (server-only, lives on Player.questState).
 * The Colyseus room calls these functions at hook points (kill, pickup, talk, level-up)
 * and sends quest_update messages to the owning client.
 *
 * All mutations are synchronous and happen on the server tick — no concurrency concerns.
 */
import {
  QUESTS,
  getRecommendedMilestone,
  isDailyResettable,
  canClaimDailyLoginGift,
  getDailyLoginReward,
  getTodayBonusMap,
  BONUS_HUNT_EXP_MULT,
  BONUS_HUNT_DROP_MULT,
  ClassArchetype,
  getClass,
  maxHpForLevel,
  maxMpForLevel,
  type QuestState,
  type QuestStatus,
  type ObjectiveProgress,
  type Objective,
} from "@maple/shared";
import { MessageType, type QuestUpdatePayload } from "./types";
import type { Client } from "colyseus";
import type { Player } from "./rooms/schema/Player";
import { InventoryItem } from "./rooms/schema/InventoryItem";
import { accountStore } from "./persistence/store";
import { getItemDef, isMountId } from "@maple/shared";

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/** Ensure every known quest has a QuestState entry, preserving existing state. */
export function ensureQuestStates(existing: QuestState[]): QuestState[] {
  const map = new Map<string, QuestState>();
  for (const qs of existing) map.set(qs.questId, qs);

  for (const def of Object.values(QUESTS)) {
    if (!map.has(def.id)) {
      map.set(def.id, createQuestState(def.id, "available"));
    }
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Daily reset
// ---------------------------------------------------------------------------

/**
 * Reset all expired daily quests for a character.
 * Called on player join / room assignment so dailies refresh at UTC midnight.
 * Returns the updated quest list (mutated in place).
 */
export function resetDailyQuests(quests: QuestState[], nowMs: number = Date.now()): QuestState[] {
  for (let i = 0; i < quests.length; i++) {
    const qs = quests[i];
    if (!isDailyResettable(qs, nowMs)) continue;

    // This quest was turned in on a prior UTC day — make it available again.
    quests[i] = {
      ...qs,
      status: "available",
      objectiveProgress: [],
      lastTurnedInAt: undefined,
    };
  }

  return quests;
}

// ---------------------------------------------------------------------------
// Daily Login Gift
// ---------------------------------------------------------------------------

/**
 * Grant the daily login gift if eligible.
 * Returns the reward if granted, null if already claimed today.
 * The caller must persist lastDailyLoginGiftAt after this returns a reward.
 */
export function grantDailyLoginGift(
  playerLevel: number,
  lastClaimedAt: number | undefined,
  nowMs: number,
): { mesos: number; exp: number } | null {
  if (!canClaimDailyLoginGift(lastClaimedAt, nowMs)) return null;
  return getDailyLoginReward(playerLevel);
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

/**
 * Attempt to accept a quest. Returns the updated state or an error string.
 * Blocks: already active, already turnedIn, level requirement not met, quest not found.
 */
export function acceptQuest(
  quests: QuestState[],
  questId: string,
  playerLevel: number,
): QuestState[] | string {
  const def = QUESTS[questId];
  if (!def) return "Unknown quest.";

  const idx = quests.findIndex((q) => q.questId === questId);
  if (idx === -1) return "Quest not available.";

  const qs = quests[idx];
  if (qs.status === "active") return "Quest already in progress.";
  if (qs.status === "complete") return "Quest ready for turn-in — talk to the quest giver.";
  if (qs.status === "turnedIn") return "Quest already completed.";

  if (def.requiredLevel !== undefined && playerLevel < def.requiredLevel) {
    return `Requires level ${def.requiredLevel}.`;
  }

  // Transition to active with fresh objective progress.
  quests[idx] = {
    ...qs,
    status: "active",
    objectiveProgress: def.objectives.map((obj) => ({
      kind: obj.kind,
      current: 0,
      target: getObjectiveTarget(obj),
    })),
  };
  return quests;
}

// ---------------------------------------------------------------------------
// Turn-in
// ---------------------------------------------------------------------------

/**
 * Attempt to turn in a quest. All objectives must be complete.
 * Grants rewards (mesos, exp, items) and marks as turnedIn.
 * For repeatable (daily) quests, records lastTurnedInAt for reset tracking.
 * Returns an error string on failure.
 */
export function turnInQuest(quests: QuestState[], questId: string, player: Player): string {
  const def = QUESTS[questId];
  if (!def) return "Unknown quest.";

  const idx = quests.findIndex((q) => q.questId === questId);
  if (idx === -1) return "Quest not active.";

  const qs = quests[idx];
  if (qs.status !== "complete") {
    if (qs.status === "turnedIn") return "Quest already turned in.";
    if (qs.status === "available") return "Quest not accepted yet.";
    // active — check if objectives are actually all complete
    if (!areObjectivesComplete(qs.objectiveProgress)) {
      return "Objectives not yet complete.";
    }
  }

  // Mark turnedIn (with timestamp for daily reset tracking).
  const isRepeatable = def.repeatable?.kind === "daily";
  quests[idx] = {
    ...qs,
    status: "turnedIn",
    ...(isRepeatable ? { lastTurnedInAt: Date.now() } : {}),
  };

  // Grant rewards.
  if (def.rewards.mesos) {
    player.mesos += def.rewards.mesos;
    accountStore.setMesos(player.charId, player.mesos);
  }

  // ── Job advancement via quest reward ────────────────────────────────────
  const targetTier = def.rewards.jobAdvanceToTier;
  if (targetTier !== undefined) {
    applyJobAdvancementFromQuest(player, questId, targetTier);
  }

  // Collect all item ids to grant: flat items + class-conditional items.
  const itemsToGrant: string[] = [...(def.rewards.items ?? [])];
  if (def.rewards.classRewards) {
    const classItems = def.rewards.classRewards[player.archetype];
    if (classItems) itemsToGrant.push(...classItems);
  }

  for (const itemId of itemsToGrant) {
    // Grant as a mount if it's a known mount id; otherwise grant as an inventory item.
    if (isMountId(itemId)) {
      if (!player.ownedMounts.includes(itemId)) {
        player.ownedMounts.push(itemId);
      }
      continue;
    }
    if (!getItemDef(itemId)) continue;
    const uid = `quest_${questId}_${itemId}_${Date.now()}`;
    // Add to both in-memory inventory (for live player) and durable store.
    const schemaItem = new InventoryItem();
    schemaItem.uid = uid;
    schemaItem.defId = itemId;
    schemaItem.baseRank = "NORMAL";
    schemaItem.potentialTier = "COMMON";
    schemaItem.lines = 0;
    player.inventory.set(uid, schemaItem);
    accountStore.addItem(player.charId, {
      uid,
      defId: itemId,
      baseRank: "NORMAL",
      potentialTier: "COMMON",
      lines: 0,
      minted: false,
    });
  }

  return "";
}

// ---------------------------------------------------------------------------
// Abandon
// ---------------------------------------------------------------------------

/**
 * Abandon an active quest, resetting it to available.
 * Returns the updated state or an error string.
 */
export function abandonQuest(quests: QuestState[], questId: string): QuestState[] | string {
  const def = QUESTS[questId];
  if (!def) return "Unknown quest.";

  const idx = quests.findIndex((q) => q.questId === questId);
  if (idx === -1) return "Quest not found.";

  const qs = quests[idx];
  if (qs.status !== "active") return "Can only abandon active quests.";

  quests[idx] = {
    questId,
    status: "available",
    objectiveProgress: [],
  };
  return quests;
}

// ---------------------------------------------------------------------------
// Objective progress
// ---------------------------------------------------------------------------

/**
 * Progress matching objectives across all active quests.
 * Returns true if any quest state changed.
 */
export function progressObjectives(
  quests: QuestState[],
  kind: string,
  matchKey: string,
  amount: number,
): boolean {
  let changed = false;
  for (let i = 0; i < quests.length; i++) {
    const qs = quests[i];
    if (qs.status !== "active") continue;

    const def = QUESTS[qs.questId];
    if (!def) continue;

    let objChanged = false;
    const newProgress = qs.objectiveProgress.map((op, objIdx) => {
      const objDef = def.objectives[objIdx];
      if (!objDef || objDef.kind !== kind) return op;

      // Check the match field.
      if (!objectiveMatchesKey(objDef, matchKey)) return op;

      if (op.current >= op.target) return op; // already complete
      const newCurrent = Math.min(op.current + amount, op.target);
      if (newCurrent !== op.current) objChanged = true;
      return { ...op, current: newCurrent };
    });

    if (objChanged) {
      const allDone = areObjectivesComplete(newProgress);
      quests[i] = {
        ...qs,
        status: allDone ? "complete" : "active",
        objectiveProgress: newProgress,
      };
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Bonus Hunting — rotating daily map
// ---------------------------------------------------------------------------

/** Return today's bonus map id. */
export function getCurrentBonusMap(nowMs: number = Date.now()): string {
  return getTodayBonusMap(nowMs);
}

/** Check if a map is today's bonus hunting map. */
export function isBonusHuntingMap(mapId: string, nowMs: number = Date.now()): boolean {
  return getCurrentBonusMap(nowMs) === mapId;
}

/** Get the EXP multiplier for the bonus hunting map (1.0 if not bonus). */
export function getExpMultiplierForMap(mapId: string, nowMs: number = Date.now()): number {
  return isBonusHuntingMap(mapId, nowMs) ? BONUS_HUNT_EXP_MULT : 1;
}

/** Get the drop rate multiplier for the bonus hunting map (1.0 if not bonus). */
export function getDropMultiplierForMap(mapId: string, nowMs: number = Date.now()): number {
  return isBonusHuntingMap(mapId, nowMs) ? BONUS_HUNT_DROP_MULT : 1;
}

// ---------------------------------------------------------------------------
// Client sync
// ---------------------------------------------------------------------------

/** Send the full quest log snapshot to the owning client. */
export function sendQuestUpdate(client: Client, quests: QuestState[]): void {
  const payload: QuestUpdatePayload = {
    quests: quests.map((qs) => {
      const def = QUESTS[qs.questId];
      return {
        questId: qs.questId,
        name: def?.name ?? qs.questId,
        status: qs.status,
        isRepeatable: def?.repeatable?.kind === "daily",
        objectiveProgress: qs.objectiveProgress.map((op) => ({
          kind: op.kind,
          description: describeObjective(op.kind, qs.questId, op),
          current: op.current,
          target: op.target,
        })),
      };
    }),
  };
  client.send(MessageType.QUEST_UPDATE, payload);
}

/** Send the bonus hunting map info to the owning client. */
export function sendBonusHuntSync(
  client: Client,
  playerMapId: string,
  nowMs: number = Date.now(),
): void {
  const bonusMap = getCurrentBonusMap(nowMs);
  const isActive = playerMapId === bonusMap;
  client.send(MessageType.BONUS_HUNT_SYNC, {
    bonusMapId: bonusMap,
    isActive,
    expMultiplier: isActive ? BONUS_HUNT_EXP_MULT : 1,
    dropMultiplier: isActive ? BONUS_HUNT_DROP_MULT : 1,
    endsAtUtcMidnight: getUtcMidnightMs(nowMs),
  });
}

/** Calculate the UTC midnight timestamp in ms for the given day. */
function getUtcMidnightMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

// ---------------------------------------------------------------------------
// Guidance sync
// ---------------------------------------------------------------------------

/** Send the current guidance milestone to the owning client. */
export function sendGuidanceSync(client: Client, quests: QuestState[], playerLevel: number): void {
  const questMap = new Map<string, string>();
  for (const qs of quests) questMap.set(qs.questId, qs.status);

  const result = getRecommendedMilestone(playerLevel, questMap);
  if (!result) return;

  client.send(MessageType.GUIDANCE_SYNC, {
    milestoneId: result.milestone.id,
    title: result.milestone.title,
    description: result.milestone.description,
    mapId: result.milestone.mapId,
    teleportMapId: result.milestone.teleportMapId,
    targetNpcId: result.milestone.targetNpcId,
    steps: result.steps.map((s) => ({
      label: s.label,
      completed: s.completed,
      active: s.active,
      questId: s.questId,
      npcId: s.npcId,
    })),
    activeStepIndex: result.activeStepIndex,
    allComplete: result.allComplete,
  } satisfies import("@maple/shared").GuidanceSyncPayload);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createQuestState(questId: string, status: QuestStatus): QuestState {
  const def = QUESTS[questId];
  return {
    questId,
    status,
    objectiveProgress: def
      ? def.objectives.map((obj) => ({
          kind: obj.kind,
          current: 0,
          target: getObjectiveTarget(obj),
        }))
      : [],
  };
}

function getObjectiveTarget(obj: Objective): number {
  switch (obj.kind) {
    case "kill":
      return obj.count;
    case "collect":
      return obj.count;
    case "talk":
      return 1;
    case "level":
      return 1; // Binary: reached target level or not
    case "break":
      return obj.count;
    case "interact":
      return obj.count;
    default:
      return 1;
  }
}

function objectiveMatchesKey(objDef: Objective, matchKey: string): boolean {
  switch (objDef.kind) {
    case "kill":
      return objDef.mobId === matchKey;
    case "collect":
      return objDef.itemId === matchKey;
    case "talk":
      return objDef.npcId === matchKey;
    case "level":
      // For level objectives, matchKey is the player's level as a string.
      return Number(matchKey) >= objDef.level;
    case "break":
      // Match by reactorKind if specified, otherwise match any break objective.
      return !objDef.reactorKind || objDef.reactorKind === matchKey;
    case "interact":
      return !objDef.reactorKind || objDef.reactorKind === matchKey;
    default:
      return false;
  }
}

function areObjectivesComplete(progress: ObjectiveProgress[]): boolean {
  return progress.every((op) => op.current >= op.target);
}

function describeObjective(kind: string, questId: string, op: ObjectiveProgress): string {
  const def = QUESTS[questId];
  if (!def) return `${kind} objective`;

  const objDef = def.objectives.find((o) => o.kind === kind);
  if (!objDef) return `${kind} objective`;

  switch (kind) {
    case "kill": {
      const killDef = objDef as { kind: "kill"; mobId: string; count: number };
      const mobName = killDef.mobId.split(".").pop() ?? killDef.mobId;
      return `Defeat ${mobName} (${op.current}/${op.target})`;
    }
    case "collect": {
      const itemDef = objDef as { kind: "collect"; itemId: string; count: number };
      const itemName = itemDef.itemId.split(".").pop() ?? itemDef.itemId;
      return `Collect ${itemName} (${op.current}/${op.target})`;
    }
    case "talk": {
      const talkDef = objDef as { kind: "talk"; npcId: string };
      const npcName = talkDef.npcId.split(".").pop() ?? talkDef.npcId;
      return op.current >= op.target ? `Talk to ${npcName} — done` : `Talk to ${npcName}`;
    }
    case "level": {
      const levelDef = objDef as { kind: "level"; level: number };
      return `Reach level ${levelDef.level}`;
    }
    case "break": {
      const breakDef = objDef as { kind: "break"; reactorKind?: string; count: number };
      const typeName = breakDef.reactorKind?.replace(/-/g, " ") ?? "object";
      return `Break ${typeName} (${op.current}/${op.target})`;
    }
    case "interact": {
      const interactDef = objDef as { kind: "interact"; reactorKind?: string; count: number };
      const typeName = interactDef.reactorKind?.replace(/-/g, " ") ?? "object";
      return `Use ${typeName} (${op.current}/${op.target})`;
    }
    default:
      return `${kind} objective`;
  }
}

// ---------------------------------------------------------------------------
// Job advancement from quest rewards
// ---------------------------------------------------------------------------

/**
 * Parse the class archetype from a job-advancement quest id.
 * Quest ids follow the pattern `quest.<archetype>_job_<tier>`.
 * Returns undefined if the id doesn't match.
 */
function parseArchetypeFromQuestId(questId: string): ClassArchetype | undefined {
  const parts = questId.split(".");
  const slug = parts[1]; // e.g. "warrior_job_1"
  if (!slug) return undefined;
  const archetypeStr = slug.split("_")[0]?.toUpperCase(); // "warrior" → "WARRIOR"
  if (!archetypeStr) return undefined;
  return ClassArchetype[archetypeStr as keyof typeof ClassArchetype];
}

/**
 * Apply job advancement when a quest with `jobAdvanceToTier` is turned in.
 *
 * Tier 1: Beginner → class archetype (mirrors executeAdvanceJob's 1st-job path).
 * Tier 2+: Bump jobTier and recompute HP/MP (skill granting requires branch
 *          selection, which is handled by the NPC dialog system).
 */
function applyJobAdvancementFromQuest(player: Player, questId: string, targetTier: number): void {
  const archetype = parseArchetypeFromQuestId(questId);
  if (!archetype || archetype === ClassArchetype.BEGINNER) return;

  // ── Tier 1: Beginner → class ──
  if (targetTier === 1 && player.archetype === ClassArchetype.BEGINNER) {
    player.archetype = archetype;
    player.jobTier = 1;

    // Recompute maxHp/maxMp for the new class at the current level.
    player.maxHp = maxHpForLevel(archetype, player.level);
    player.hp = player.maxHp;
    player.maxMp = maxMpForLevel(archetype, player.level);
    player.mp = player.maxMp;

    // Grant the new class's tier-1 skills.
    const newClass = getClass(archetype);
    const tier1 = newClass.jobTiers.find((t) => t.tier === 1);
    if (tier1) {
      const existing = new Set(player.learnedSkills);
      for (const skill of tier1.skills) {
        if (!existing.has(skill.id)) player.learnedSkills.push(skill.id);
      }
    }

    accountStore.updateCharacter(player.charId, {
      archetype,
      jobTier: 1,
      maxHp: player.maxHp,
      maxMp: player.maxMp,
      stats: {
        STR: player.str,
        DEX: player.dex,
        INT: player.intel,
        LUK: player.luk,
        HP: player.hp,
        MP: player.mp,
      },
      learnedSkills: [...player.learnedSkills],
    });
    return;
  }

  // ── Tier 2+: Bump jobTier, recompute HP/MP ──
  // Skill granting for tier 2+ requires branch selection (handled by NPC dialog).
  if (targetTier > player.jobTier && player.archetype === archetype) {
    player.jobTier = targetTier;
    player.maxHp = maxHpForLevel(archetype, player.level);
    player.hp = player.maxHp;
    player.maxMp = maxMpForLevel(archetype, player.level);
    player.mp = player.maxMp;

    accountStore.updateCharacter(player.charId, {
      jobTier: targetTier,
      maxHp: player.maxHp,
      maxMp: player.maxMp,
      stats: {
        STR: player.str,
        DEX: player.dex,
        INT: player.intel,
        LUK: player.luk,
        HP: player.hp,
        MP: player.mp,
      },
    });
  }
}
