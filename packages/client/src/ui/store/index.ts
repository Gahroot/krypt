import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { InventoryTab } from "@maple/shared";

import { createInventorySlice, type InventorySlice } from "./inventory";
import { createCharacterCreateSlice, type CharacterCreateSlice } from "./characterCreate";
import { createCharacterSelectSlice, type CharacterSelectSlice } from "./characterSelect";
import { createShopSlice, type ShopSlice } from "./shop";
import { createCashShopSlice, type CashShopSlice } from "./cashShop";
import { createMarketSlice, type MarketSlice } from "./market";
import { createTradeSlice, type TradeSlice } from "./trade";
import { createStorageSlice, type StorageSlice } from "./storage";
import { createSettingsSlice, type SettingsSlice } from "./settings";
import { createPartySlice, type PartySlice } from "./party";
import { createGuildSlice, type GuildSlice } from "./guild";
import { createFriendsSlice, type FriendsSlice } from "./friends";
import { createHudSlice, type HudSlice } from "./hud";
import { createChatSlice, type ChatSlice } from "./chat";
import { createDialogSlice, type DialogSlice } from "./dialog";
import { createQuestsSlice, type QuestsSlice } from "./quests";
import { createCharacterSlice, type CharacterSlice } from "./character";
import { createStatusEffectsSlice, type StatusEffectsSlice } from "./statusEffects";
import { createReportSlice, type ReportSlice } from "./report";
import { createChannelSelectSlice, type ChannelSelectSlice } from "./channelSelect";
import { createCoachMarksSlice, type CoachMarksSlice } from "./coachMarks";
import { createIntroSlice, type IntroSlice } from "./intro";
import { createLoginSlice, type LoginSlice } from "./login";
import { createHelpSlice, type HelpSlice } from "./help";
import { createEventsSlice, type EventsSlice } from "./events";
import { createTransportSlice, type TransportSlice } from "./transport";
import { createWorldMapSlice, type WorldMapSlice } from "./worldMap";

/**
 * The React-overlay bridge store (root).
 *
 * This is the single seam between the Phaser game and the React UI. The Phaser
 * `UIScene` pushes plain, serializable *snapshots* in (never live Colyseus
 * schema objects) and registers imperative `actions` that send authoritative
 * messages back to the server. React components only read snapshots and call
 * actions — they never touch Phaser or Colyseus directly.
 *
 * Built as a framework-agnostic vanilla store so `UIScene` can import and drive
 * it without pulling React into the Phaser bundle.
 *
 * ── Architecture ──────────────────────────────────────────────────────────
 * State is composed from per-feature *slices* (see ./inventory.ts, the
 * reference). Each slice owns its snapshot + open flag and a setter. This root
 * file stitches the slices together and owns the cross-cutting `actions`
 * registry (the "actions-out" half of the bridge). See ../README.md.
 */

// Re-export slice snapshot types so existing `@/ui/store` imports keep working.
export type {
  InvItemSnapshot,
  PlayerSnapshot,
  InventorySnapshot,
  InventorySlice,
} from "./inventory";
export type {
  CharacterCreateSnapshot,
  CharacterCreateActions,
  CharacterCreateSlice,
} from "./characterCreate";
export type {
  CharacterSelectEntry,
  CharacterSelectSnapshot,
  CharacterSelectActions,
  CharacterSelectSlice,
} from "./characterSelect";
export type {
  ShopBuySlot,
  ShopSellEntry,
  ShopFeedback,
  ShopSnapshot,
  ShopActions,
  ShopSlice,
} from "./shop";
export type {
  CashShopItem,
  CashShopFeedback,
  CashShopSnapshot,
  CashShopActions,
  CashShopSlice,
} from "./cashShop";
export type {
  MarketListing,
  MarketWalletItem,
  MarketFeedback,
  MarketSnapshot,
  MarketActions,
  MarketSlice,
} from "./market";
export type {
  TradeItemSnapshot,
  TradeFeedback,
  TradeSnapshot,
  TradeActions,
  TradeSlice,
} from "./trade";
export type {
  StorageItemSnapshot,
  StorageFeedback,
  StorageSnapshot,
  StorageActions,
  StorageSlice,
} from "./storage";
export type {
  KeyDisplayMap,
  SettingsToggleKey,
  SettingsSnapshot,
  SettingsActions,
  SettingsSlice,
} from "./settings";
export type {
  PartyLootRule,
  PartyMemberSnapshot,
  PartyInviteSnapshot,
  PartySnapshot,
  PartyActions,
  PartySlice,
} from "./party";
export type {
  GuildRank,
  GuildMemberSnapshot,
  GuildSnapshot,
  GuildActions,
  GuildSlice,
} from "./guild";
export type { FriendSnapshot, FriendsSnapshot, FriendsActions, FriendsSlice } from "./friends";
export type {
  HudSkillSlot,
  HudQuestObjective,
  HudQuest,
  HudBonusHunt,
  HudMinimap,
  HudToggles,
  HudSnapshot,
  HudActions,
  HudSlice,
} from "./hud";
export type {
  ChatChannel,
  ChatMessageSnapshot,
  ChatSnapshot,
  ChatActions,
  ChatSlice,
} from "./chat";
export type { DialogChoiceSnapshot, DialogSnapshot, DialogActions, DialogSlice } from "./dialog";
export type {
  QuestObjectiveSnapshot,
  QuestEntrySnapshot,
  QuestLogSnapshot,
  QuestRewardSnapshot,
  QuestOfferSnapshot,
  QuestTurninSnapshot,
  QuestActions,
  QuestsSlice,
} from "./quests";
export type {
  StatKey,
  EquipBonus,
  CharacterSnapshot,
  EquipSlotSnapshot,
  CharacterActions,
  CharacterSlice,
} from "./character";
export type { StatusEffectSnapshot, StatusEffectsSlice } from "./statusEffects";
export type { ReportActions, ReportSlice } from "./report";
export type {
  ChannelEntry,
  ChannelSelectSnapshot,
  ChannelSelectActions,
  ChannelSelectSlice,
} from "./channelSelect";
export type { CoachMarkPosition, CoachMarkSnapshot, CoachMarksSlice } from "./coachMarks";
export type { IntroLineSnapshot, IntroSnapshot, IntroActions, IntroSlice } from "./intro";
export type { LoginSnapshot, LoginActions, LoginSlice } from "./login";
export type { HelpSlice } from "./help";
export type { EventSnapshot, EventsSlice } from "./events";
export type { TransportSnapshot, TransportSlice } from "./transport";
export type {
  WorldMapNode,
  WorldMapLink,
  WorldMapRegion,
  WorldMapSnapshot,
  WorldMapActions,
  WorldMapSlice,
} from "./worldMap";

/**
 * Imperative actions the Phaser scene wires up so React can drive the game.
 * Grows as panels are added; each new action is fired via `room.send` inside
 * `UIScene.registerUIActions`.
 */
export interface UIActions {
  /** Equip an EQUIP-tab item by uid. */
  equip(uid: string): void;
  /** Use a USE-tab consumable by defId. */
  use(defId: string): void;
  /** Reorder within a tab by swapping two item uids (persisted client-side). */
  reorder(tab: InventoryTab, fromUid: string, toUid: string): void;
  /** Server-authoritative sort of a tab (sends INVENTORY_SORT message). */
  sort(tab: InventoryTab): void;
  /** Close the inventory (keeps Phaser's own open-flag in sync). */
  close(): void;
}

/** Cross-cutting bridge slice: the imperative action registry. */
export interface ActionsSlice {
  actions: UIActions | null;
  setActions: (actions: UIActions) => void;
}

/** The full overlay store state: every feature slice plus the action registry. */
export type UIState = InventorySlice &
  CharacterCreateSlice &
  CharacterSelectSlice &
  ShopSlice &
  CashShopSlice &
  MarketSlice &
  TradeSlice &
  StorageSlice &
  SettingsSlice &
  PartySlice &
  GuildSlice &
  FriendsSlice &
  HudSlice &
  ChatSlice &
  DialogSlice &
  QuestsSlice &
  CharacterSlice &
  StatusEffectsSlice &
  ReportSlice &
  ChannelSelectSlice &
  CoachMarksSlice &
  IntroSlice &
  LoginSlice &
  HelpSlice &
  EventsSlice &
  TransportSlice &
  WorldMapSlice &
  ActionsSlice;

export const uiStore = createStore<UIState>((...args) => {
  const [set] = args;
  return {
    ...createInventorySlice(...args),
    ...createCharacterCreateSlice(...args),
    ...createCharacterSelectSlice(...args),
    ...createShopSlice(...args),
    ...createCashShopSlice(...args),
    ...createMarketSlice(...args),
    ...createTradeSlice(...args),
    ...createStorageSlice(...args),
    ...createSettingsSlice(...args),
    ...createPartySlice(...args),
    ...createGuildSlice(...args),
    ...createFriendsSlice(...args),
    ...createHudSlice(...args),
    ...createChatSlice(...args),
    ...createDialogSlice(...args),
    ...createQuestsSlice(...args),
    ...createCharacterSlice(...args),
    ...createStatusEffectsSlice(...args),
    ...createReportSlice(...args),
    ...createChannelSelectSlice(...args),
    ...createCoachMarksSlice(...args),
    ...createIntroSlice(...args),
    ...createLoginSlice(...args),
    ...createHelpSlice(...args),
    ...createEventsSlice(...args),
    ...createTransportSlice(...args),
    ...createWorldMapSlice(...args),

    // ── Actions registry (cross-cutting) ──
    actions: null,
    setActions: (actions) => set({ actions }),
  };
});

/** React hook selector over the bridge store. */
export function useUIStore<T>(selector: (state: UIState) => T): T {
  return useStore(uiStore, selector);
}
