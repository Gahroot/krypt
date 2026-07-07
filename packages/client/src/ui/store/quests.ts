import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Quests slice — bridge state for the React quest overlays.
 *
 * Covers three windows, each a plain serializable snapshot pushed in from
 * Phaser (`UIScene.publishQuestLog` / `setQuestOffer` / `setQuestTurnin`):
 *   - the quest log/journal (`questLogOpen` flag + `questLog` snapshot),
 *   - the quest offer panel (`questOffer`, accept/decline), and
 *   - the quest turn-in panel (`questTurnin`, rewards display).
 *
 * The per-feature action registry is wired by the scene to the authoritative
 * `QUEST_ACCEPT` / `QUEST_DECLINE` / `QUEST_TURNIN_ACCEPT` / `QUEST_TURNIN_DECLINE`
 * messages. React reads snapshots and calls actions — never Phaser/Colyseus.
 *
 * NB: the always-on quest TRACKER HUD is a separate HUD widget (see
 * `src/ui/hud/QuestTracker.tsx`) and is not owned by this slice.
 */

/** Progress on one quest objective (mirror of QuestUpdatePayload objective). */
export interface QuestObjectiveSnapshot {
  kind: string;
  description: string;
  current: number;
  target: number;
}

/** One quest in the journal (mirror of QuestUpdatePayload quest entry). */
export interface QuestEntrySnapshot {
  questId: string;
  name: string;
  /** "available" | "active" | "complete" | "turnedIn". */
  status: string;
  /** True when this quest resets daily (shown as a "Daily" badge). */
  isRepeatable: boolean;
  objectiveProgress: QuestObjectiveSnapshot[];
}

/** The full quest journal snapshot. */
export interface QuestLogSnapshot {
  quests: QuestEntrySnapshot[];
}

/** Reward bundle previewed on the offer / turn-in panels. */
export interface QuestRewardSnapshot {
  mesos?: number;
  exp?: number;
  items?: string[];
}

/** A pending quest offer (accept/decline overlay). */
export interface QuestOfferSnapshot {
  questId: string;
  questName: string;
  giverNpcId: string;
  giverNpcName: string;
  objectives: { kind: string; description: string; target: number }[];
  rewards: QuestRewardSnapshot;
  requiredLevel?: number;
}

/** A pending quest turn-in (rewards display overlay). */
export interface QuestTurninSnapshot {
  questId: string;
  questName: string;
  giverNpcId: string;
  giverNpcName: string;
  rewards: QuestRewardSnapshot;
}

/** Imperative actions the scene wires so React can drive quest flow. */
export interface QuestActions {
  /** Accept the pending quest offer. */
  acceptOffer(questId: string): void;
  /** Decline the pending quest offer. */
  declineOffer(questId: string): void;
  /** Confirm the pending quest turn-in (claim rewards). */
  acceptTurnin(questId: string): void;
  /** Dismiss the pending quest turn-in (not yet). */
  declineTurnin(questId: string): void;
  /** Abandon an active quest. */
  abandonQuest(questId: string): void;
  /** Close the quest log. */
  closeLog(): void;
}

const EMPTY_LOG: QuestLogSnapshot = { quests: [] };

export interface QuestsSlice {
  questLogOpen: boolean;
  questLog: QuestLogSnapshot;
  questOffer: QuestOfferSnapshot | null;
  questTurnin: QuestTurninSnapshot | null;
  questActions: QuestActions | null;

  setQuestLogOpen: (open: boolean) => void;
  setQuestLog: (snapshot: QuestLogSnapshot) => void;
  setQuestOffer: (offer: QuestOfferSnapshot | null) => void;
  setQuestTurnin: (turnin: QuestTurninSnapshot | null) => void;
  setQuestActions: (actions: QuestActions | null) => void;
}

export const createQuestsSlice: StateCreator<UIState, [], [], QuestsSlice> = (set) => ({
  questLogOpen: false,
  questLog: EMPTY_LOG,
  questOffer: null,
  questTurnin: null,
  questActions: null,

  setQuestLogOpen: (open) => set({ questLogOpen: open }),
  setQuestLog: (snapshot) => set({ questLog: snapshot }),
  setQuestOffer: (offer) => set({ questOffer: offer }),
  setQuestTurnin: (turnin) => set({ questTurnin: turnin }),
  setQuestActions: (actions) => set({ questActions: actions }),
});
