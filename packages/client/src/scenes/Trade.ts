/**
 * TradeScene — thin Phaser controller for the player-to-player direct trade.
 *
 * The window itself is rendered by the React overlay (`ui/TradePanel.tsx`) from
 * the shared component kit. This scene is now a thin bridge: it reuses the shared
 * town room, publishes a plain {@link TradeSnapshot} into the zustand bridge
 * store, registers add/remove/setMesos/ready/confirm/cancel actions that send the
 * existing Colyseus trade messages, and tears everything down on close.
 *
 * The two-phase safety flow is unchanged and server-authoritative:
 *   1. offering — either side adds/removes items + mesos (TRADE_OFFER)
 *   2. ready    — each side locks (TRADE_LOCK); both must lock before confirm
 *   3. confirm  — each side confirms (TRADE_CONFIRM); executes when both confirm
 *
 * Opens when another player sends a TRADE_INVITE and the local player accepts;
 * launched alongside the gameplay scene, which is paused until the trade closes.
 */
import Phaser from "phaser";
import { type Room } from "@colyseus/sdk";
import { MessageType, type TradeUpdatePayload, type TradeResultPayload } from "@maple/shared";
import type { TownStateView, InventoryItemView } from "../state-views";

import { uiStore } from "../ui/store";
import type { TradeSnapshot, TradeItemSnapshot, TradeFeedback } from "../ui/store";

/** Ignore close keys for a beat after opening so the same key press can't close us. */
const KEY_ARM_MS = 200;

export class TradeScene extends Phaser.Scene {
  private room?: Room;
  private destroyed = false;
  private armed = false;
  private readonly unsubscribers: (() => void)[] = [];

  // Trade state from server.
  private partnerName = "";
  private partnerSessionId = "";
  private myOffer: string[] = [];
  private myMesos = 0;
  private partnerOffer: string[] = [];
  private partnerMesos = 0;
  private myLocked = false;
  private partnerLocked = false;
  private myConfirmed = false;
  private partnerConfirmed = false;

  private feedback: TradeFeedback | null = null;
  private feedbackSeq = 0;

  constructor() {
    super("trade");
  }

  create(): void {
    this.resetState();

    uiStore.getState().setTradeActions({
      add: (uid: string) => this.room?.send(MessageType.TRADE_OFFER, { itemUid: uid, add: true }),
      remove: (uid: string) =>
        this.room?.send(MessageType.TRADE_OFFER, { itemUid: uid, add: false }),
      setMesos: (mesos: number) => this.room?.send(MessageType.TRADE_OFFER, { mesos }),
      ready: () => this.room?.send(MessageType.TRADE_LOCK),
      confirm: () => this.room?.send(MessageType.TRADE_CONFIRM),
      cancel: () => this.cancelTrade(),
      close: () => this.close(),
    });
    this.publishTrade();
    uiStore.getState().setTradeOpen(true);

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
    this.partnerName = "";
    this.partnerSessionId = "";
    this.myOffer = [];
    this.myMesos = 0;
    this.partnerOffer = [];
    this.partnerMesos = 0;
    this.myLocked = false;
    this.partnerLocked = false;
    this.myConfirmed = false;
    this.partnerConfirmed = false;
    this.feedback = null;
    this.unsubscribers.length = 0;
  }

  // ─── Connection via the shared town room ──────────────────────────────────────

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
        this.publishTrade();
      },
    });
  }

  private bind(room: Room): void {
    // Trade state updates (full sync on every change).
    this.unsubscribers.push(
      room.onMessage(MessageType.TRADE_UPDATE, (payload: TradeUpdatePayload) => {
        if (this.destroyed) return;
        this.partnerSessionId = payload.partnerSessionId;
        this.partnerName = payload.partnerName;
        this.myOffer = payload.myOffer;
        this.myMesos = payload.myMesos;
        this.partnerOffer = payload.partnerOffer;
        this.partnerMesos = payload.partnerMesos;
        this.myLocked = payload.myLocked;
        this.partnerLocked = payload.partnerLocked;
        this.myConfirmed = payload.myConfirmed;
        this.partnerConfirmed = payload.partnerConfirmed;
        this.publishTrade();
      }),
    );

    // Trade result (success or failure) — toast then auto-close.
    this.unsubscribers.push(
      room.onMessage(MessageType.TRADE_RESULT, (payload: TradeResultPayload) => {
        if (this.destroyed) return;
        this.pushFeedback(payload.message, payload.success);
        this.publishTrade();
        this.time.delayedCall(1800, () => this.close());
      }),
    );

    // Trade cancelled by partner.
    this.unsubscribers.push(
      room.onMessage(MessageType.TRADE_CANCEL, () => {
        if (this.destroyed) return;
        this.pushFeedback("Trade cancelled.", false);
        this.publishTrade();
        this.time.delayedCall(1200, () => this.close());
      }),
    );
  }

  // ─── Snapshot publishing ──────────────────────────────────────────────────────

  private publishTrade(): void {
    const room = this.room;
    const localPlayer = room
      ? (room.state as TownStateView).players.get(room.sessionId)
      : undefined;
    const partnerPlayer =
      room && this.partnerSessionId
        ? (room.state as TownStateView).players.get(this.partnerSessionId)
        : undefined;

    const offeredSet = new Set(this.myOffer);

    const myOffer: TradeItemSnapshot[] = [];
    for (const uid of this.myOffer) {
      const item = localPlayer?.inventory.get(uid);
      if (item) myOffer.push(this.toItem(item));
    }

    const partnerOffer: TradeItemSnapshot[] = [];
    for (const uid of this.partnerOffer) {
      const item = partnerPlayer?.inventory.get(uid);
      if (item) partnerOffer.push(this.toItem(item));
    }

    const available: TradeItemSnapshot[] = [];
    if (localPlayer && !this.myLocked) {
      const equippedUids = new Set<string>();
      localPlayer.equipped.forEach((uid) => equippedUids.add(uid));
      localPlayer.inventory.forEach((item) => {
        if (!equippedUids.has(item.uid) && !offeredSet.has(item.uid)) {
          available.push(this.toItem(item));
        }
      });
    }

    const snapshot: TradeSnapshot = {
      partnerName: this.partnerName,
      myOffer,
      myMesos: this.myMesos,
      partnerOffer,
      partnerMesos: this.partnerMesos,
      available,
      myLocked: this.myLocked,
      partnerLocked: this.partnerLocked,
      myConfirmed: this.myConfirmed,
      partnerConfirmed: this.partnerConfirmed,
      feedback: this.feedback,
    };
    uiStore.getState().setTrade(snapshot);
  }

  private toItem(item: InventoryItemView): TradeItemSnapshot {
    return {
      uid: item.uid,
      defId: item.defId,
      baseRank: item.baseRank,
      potentialTier: item.potentialTier,
      count: item.count,
    };
  }

  private pushFeedback(message: string, ok: boolean): void {
    this.feedback = { id: ++this.feedbackSeq, message, ok };
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.armed) return;
    const key = event.key;
    if (key === "Escape" || key === "x" || key === "X") this.cancelTrade();
  }

  // ─── Actions ────────────────────────────────────────────────────────────────────

  private cancelTrade(): void {
    this.room?.send(MessageType.TRADE_CANCEL);
    this.close();
  }

  private close(): void {
    this.scene.resume("map");
    this.scene.stop();
  }

  private teardown(): void {
    this.destroyed = true;
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers.length = 0;
    this.input.keyboard?.off("keydown", this.onKeyDown, this);
    uiStore.getState().setTradeOpen(false);
    uiStore.getState().setTradeActions(null);
  }
}
