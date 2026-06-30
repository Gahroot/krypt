/**
 * CashShopScene — thin Phaser controller for the premium cosmetic shop.
 *
 * The window is rendered by the React overlay (`ui/CashShopPanel.tsx`) from the
 * shared economy component kit. This scene is a thin bridge: it reuses the
 * shared town room, requests cash info, publishes a plain {@link CashShopSnapshot}
 * into the zustand bridge store, registers buy/equip/close actions that send the
 * existing Colyseus messages, and tears everything down on close.
 *
 * Uses the premium currency (Maple Crystals), not mesos. Launched via
 * `this.scene.launch("cashshop")`, which pauses the gameplay scene.
 */
import Phaser from "phaser";
import { type Room } from "@colyseus/sdk";
import {
  getCashItem,
  cashItemsByCategory,
  PREMIUM_CURRENCY,
  PREMIUM_TICKER,
  type CashCategory,
  MessageType,
  type BuyCashItemResultPayload,
  type EquipCashItemResultPayload,
  type CashInfoPayload,
} from "@maple/shared";

import { getAccountId, getCharId } from "../backend";
import { uiStore } from "../ui/store";
import type { CashShopSnapshot, CashShopItem, CashShopFeedback } from "../ui/store";

/** Ignore close keys for a beat after opening so the same key press can't close us. */
const KEY_ARM_MS = 200;

/** Catalog display order (classic Cash Shop grouping). */
const CATEGORY_ORDER: CashCategory[] = [
  "hair",
  "face",
  "outfit",
  "weapon-skin",
  "pet",
  "effect",
  "consumable",
];

const CATEGORY_LABELS: Record<CashCategory, string> = {
  hair: "Hair",
  face: "Face",
  outfit: "Outfit",
  "weapon-skin": "Weapon Skins",
  pet: "Pets",
  effect: "Effects",
  consumable: "Consumables",
};

export class CashShopScene extends Phaser.Scene {
  private room?: Room;
  private charId = "";

  private balance = 0;
  private owned = new Set<string>();
  /** Map<category, itemId> of currently equipped cash items. */
  private equipped = new Map<string, string>();
  private feedback: CashShopFeedback | null = null;
  private feedbackSeq = 0;

  private armed = false;
  private destroyed = false;
  private readonly unsubscribers: (() => void)[] = [];

  constructor() {
    super("cashshop");
  }

  create(): void {
    this.resetState();
    void getAccountId(); // ensure account exists
    this.charId = getCharId() ?? "";

    uiStore.getState().setCashShopActions({
      buy: (itemId: string) => this.buyItem(itemId),
      equip: (itemId: string) => this.equipItem(itemId),
      close: () => this.close(),
    });
    this.publishCashShop();
    uiStore.getState().setCashShopOpen(true);

    this.input.keyboard?.on("keydown", this.onKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    this.time.delayedCall(KEY_ARM_MS, () => {
      this.armed = true;
    });

    this.requestCashInfo();
  }

  private resetState(): void {
    this.destroyed = false;
    this.armed = false;
    this.room = undefined;
    this.balance = 0;
    this.owned = new Set();
    this.equipped = new Map();
    this.feedback = null;
    this.unsubscribers.length = 0;
  }

  // ─── Connection via the shared town room ────────────────────────────────────

  private requestCashInfo(): void {
    const poll = this.time.addEvent({
      delay: 60,
      repeat: 30,
      callback: () => {
        const room = this.registry.get("room") as Room | undefined;
        if (!room || this.destroyed) {
          if (this.destroyed) poll.remove();
          return;
        }
        poll.remove();
        this.room = room;
        this.bind(room);
        room.send(MessageType.CASH_INFO, {});
      },
    });
  }

  private bind(room: Room): void {
    this.unsubscribers.push(
      room.onMessage(MessageType.CASH_INFO, (payload: CashInfoPayload) => {
        if (this.destroyed) return;
        this.balance = payload.balance;
        this.owned = new Set(payload.owned);
        this.equipped = new Map(Object.entries(payload.equipped));
        this.charId = payload.charId;
        this.publishCashShop();
      }),
    );

    this.unsubscribers.push(
      room.onMessage(MessageType.BUY_CASH_ITEM, (payload: BuyCashItemResultPayload) => {
        if (this.destroyed) return;
        if (payload.success) {
          if (payload.itemId) this.owned.add(payload.itemId);
          if (payload.balance !== undefined) this.balance = payload.balance;
        }
        this.pushFeedback(payload.message, payload.success);
        this.publishCashShop();
      }),
    );

    this.unsubscribers.push(
      room.onMessage(MessageType.EQUIP_CASH_ITEM, (payload: EquipCashItemResultPayload) => {
        if (this.destroyed) return;
        if (payload.success && payload.itemId && payload.category) {
          if (payload.equipped) this.equipped.set(payload.category, payload.itemId);
          else this.equipped.delete(payload.category);
        }
        this.pushFeedback(payload.message, payload.success);
        this.publishCashShop();
      }),
    );
  }

  // ─── Snapshot publishing ────────────────────────────────────────────────────

  private publishCashShop(): void {
    const items: CashShopItem[] = [];
    for (const category of CATEGORY_ORDER) {
      for (const def of cashItemsByCategory(category)) {
        items.push({
          id: def.id,
          name: def.name,
          category: def.category,
          categoryLabel: CATEGORY_LABELS[def.category],
          price: def.price,
          durationDays: def.durationDays,
          owned: this.owned.has(def.id),
          equipped: this.equipped.get(def.category) === def.id,
          hasAppearance: def.appearanceOverride !== undefined,
        });
      }
    }

    const snapshot: CashShopSnapshot = {
      balance: this.balance,
      currencyLabel: PREMIUM_CURRENCY,
      ticker: PREMIUM_TICKER,
      items,
      feedback: this.feedback,
    };
    uiStore.getState().setCashShop(snapshot);
  }

  private pushFeedback(message: string, ok: boolean): void {
    this.feedback = { id: ++this.feedbackSeq, message, ok };
  }

  // ─── Actions (React → server) ───────────────────────────────────────────────

  private buyItem(itemId: string): void {
    if (!getCashItem(itemId)) return;
    this.room?.send(MessageType.BUY_CASH_ITEM, { itemId });
  }

  private equipItem(itemId: string): void {
    if (!this.charId) {
      this.pushFeedback("No character selected.", false);
      this.publishCashShop();
      return;
    }
    this.room?.send(MessageType.EQUIP_CASH_ITEM, { itemId, charId: this.charId });
  }

  // ─── Close / teardown ────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.armed) return;
    const key = event.key;
    if (key === "Escape" || key === "p" || key === "P") this.close();
  }

  private close(): void {
    this.scene.stop();
    if (this.scene.get("map")) this.scene.resume("map");
  }

  private teardown(): void {
    this.destroyed = true;
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    this.input.keyboard?.off("keydown", this.onKeyDown, this);
    uiStore.getState().setCashShopOpen(false);
    uiStore.getState().setCashShopActions(null);
  }
}
