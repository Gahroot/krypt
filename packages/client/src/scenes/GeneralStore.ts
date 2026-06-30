/**
 * GeneralStoreScene — thin Phaser controller for the NPC General Store.
 *
 * The window itself is rendered by the React overlay (`ui/GeneralStorePanel.tsx`)
 * from the shared economy component kit. This scene is now a thin bridge: it
 * reuses the shared town room, publishes a plain {@link ShopSnapshot} into the
 * zustand bridge store, registers buy/sell/close actions that send the existing
 * Colyseus messages, and tears everything down on close.
 *
 * Launched via `this.scene.launch("generalstore", { shopId })`, which pauses the
 * gameplay scene. Closing resumes it.
 */
import Phaser from "phaser";
import { type Room, getStateCallbacks } from "@colyseus/sdk";
import {
  getShopDef,
  getShopItemName,
  getItemSellPrice,
  isConsumable,
  MessageType,
  type BuyFromShopResultPayload,
  type SellToShopResultPayload,
} from "@maple/shared";

import { uiStore } from "../ui/store";
import type { ShopSnapshot, ShopBuySlot, ShopSellEntry, ShopFeedback } from "../ui/store";

/** Ignore close keys for a beat after opening so the same key press can't close us. */
const KEY_ARM_MS = 200;

export class GeneralStoreScene extends Phaser.Scene {
  private room?: Room;
  private shopId = "";
  private mesos = 0;
  private sellable: ShopSellEntry[] = [];
  private feedback: ShopFeedback | null = null;
  private feedbackSeq = 0;

  private armed = false;
  private destroyed = false;
  private readonly unsubscribers: (() => void)[] = [];

  constructor() {
    super("generalstore");
  }

  init(data: { shopId?: string }): void {
    this.shopId = data.shopId ?? "";
  }

  create(): void {
    this.resetState();

    // Register the React-overlay bridge actions for the shop.
    uiStore.getState().setShopActions({
      buy: (itemId: string, qty: number) => this.doBuy(itemId, qty),
      sell: (uid: string, qty: number) => this.doSell(uid, qty),
      close: () => this.close(),
    });
    this.publishShop();
    uiStore.getState().setShopOpen(true);

    this.input.keyboard?.on("keydown", this.onKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    this.time.delayedCall(KEY_ARM_MS, () => {
      this.armed = true;
    });

    this.connectToRoom();
  }

  private resetState(): void {
    this.destroyed = false;
    this.armed = false;
    this.room = undefined;
    this.mesos = 0;
    this.sellable = [];
    this.feedback = null;
    this.unsubscribers.length = 0;
  }

  // ─── Connection via the shared town room ────────────────────────────────────

  private connectToRoom(): void {
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

        // Seed mesos + sellable from synced player state.
        const sessionId = room.sessionId;
        const localPlayer = (room.state as { players?: { get(id: string): unknown } }).players?.get(
          sessionId,
        );
        if (localPlayer) {
          this.mesos = (localPlayer as { mesos?: number }).mesos ?? 0;
          this.refreshSellable();
          this.publishShop();

          // Keep mesos in sync with authoritative state changes.
          const $ = getStateCallbacks(room);
          this.unsubscribers.push(
            $(localPlayer as Parameters<typeof $>[0]).onChange(() => {
              if (this.destroyed) return;
              this.mesos = (localPlayer as { mesos?: number }).mesos ?? 0;
              this.refreshSellable();
              this.publishShop();
            }),
          );
        }
      },
    });
  }

  private bind(room: Room): void {
    this.unsubscribers.push(
      room.onMessage(MessageType.BUY_FROM_SHOP, (payload: BuyFromShopResultPayload) => {
        if (this.destroyed) return;
        if (payload.success && payload.mesos !== undefined) this.mesos = payload.mesos;
        this.pushFeedback(payload.message, payload.success);
        this.refreshSellable();
        this.publishShop();
      }),
    );

    this.unsubscribers.push(
      room.onMessage(MessageType.SELL_TO_SHOP, (payload: SellToShopResultPayload) => {
        if (this.destroyed) return;
        if (payload.success && payload.mesos !== undefined) this.mesos = payload.mesos;
        this.pushFeedback(payload.message, payload.success);
        this.refreshSellable();
        this.publishShop();
      }),
    );
  }

  private refreshSellable(): void {
    const room = this.room;
    if (!room) {
      this.sellable = [];
      return;
    }
    const me = (room.state as { players?: { get(id: string): unknown } }).players?.get(
      room.sessionId,
    ) as
      | {
          equipped?: { values(): IterableIterator<unknown> };
          inventory?: {
            forEach(cb: (item: { defId: string; count?: number }, uid: string) => void): void;
          };
        }
      | undefined;
    if (!me) {
      this.sellable = [];
      return;
    }

    const entries: ShopSellEntry[] = [];
    const equippedUids = new Set<string>();
    for (const eqUid of me.equipped?.values() ?? []) equippedUids.add(eqUid as string);

    me.inventory?.forEach((item, uid) => {
      if (equippedUids.has(uid)) return;
      const sellPrice = getItemSellPrice(item.defId);
      if (sellPrice === undefined) return;
      entries.push({
        uid,
        defId: item.defId,
        name: getShopItemName(item.defId),
        count: item.count ?? 1,
        sellPrice,
      });
    });
    this.sellable = entries;
  }

  // ─── Snapshot publishing ────────────────────────────────────────────────────

  private publishShop(): void {
    const shop = getShopDef(this.shopId);
    const buy: ShopBuySlot[] = (shop?.slots ?? []).map((slot) => ({
      itemId: slot.itemId,
      name: getShopItemName(slot.itemId),
      buyPrice: slot.buyPrice,
      isConsumable: isConsumable(slot.itemId),
    }));

    const snapshot: ShopSnapshot = {
      shopId: this.shopId,
      title: shop?.name ?? "Shop",
      mesos: this.mesos,
      buy,
      sell: this.sellable,
      feedback: this.feedback,
    };
    uiStore.getState().setShop(snapshot);
  }

  private pushFeedback(message: string, ok: boolean): void {
    this.feedback = { id: ++this.feedbackSeq, message, ok };
  }

  // ─── Actions (React → server) ───────────────────────────────────────────────

  private doBuy(itemId: string, qty: number): void {
    this.room?.send(MessageType.BUY_FROM_SHOP, { shopId: this.shopId, itemId, qty });
  }

  private doSell(uid: string, qty: number): void {
    this.room?.send(MessageType.SELL_TO_SHOP, { uid, qty });
  }

  // ─── Close / teardown ────────────────────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.armed) return;
    if (e.code === "Escape" || e.code === "KeyX") this.close();
  }

  private close(): void {
    if (!this.armed) return;
    this.scene.stop();
    if (this.scene.get("map")) this.scene.resume("map");
  }

  private teardown(): void {
    this.destroyed = true;
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
    this.input.keyboard?.off("keydown", this.onKeyDown, this);
    uiStore.getState().setShopOpen(false);
    uiStore.getState().setShopActions(null);
  }
}
