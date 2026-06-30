/**
 * StorageScene — thin Phaser controller for the account-wide stash (bank).
 *
 * The window itself is rendered by the React overlay (`ui/StoragePanel.tsx`) from
 * the shared component kit. This scene is now a thin bridge: it reuses the shared
 * town room, publishes a plain {@link StorageSnapshot} into the zustand bridge
 * store, registers deposit/withdraw/close actions that send the existing Colyseus
 * messages, and tears everything down on close.
 *
 * Capacity rules are unchanged and server-authoritative; the snapshot carries the
 * stash capacity and the bag capacity so the panel can gate Deposit/Withdraw:
 *   - Deposit blocked when `stash.length >= stashCapacity` (stash full).
 *   - Withdraw blocked when `bagged.length >= inventoryCapacity` (bag full).
 *
 * Launched alongside the gameplay scene, which is paused until storage closes.
 */
import Phaser from "phaser";
import { getStateCallbacks, type Room } from "@colyseus/sdk";
import { MessageType, type StorageSyncPayload, type StorageResultPayload } from "@maple/shared";
import type { TownStateView, InventoryItemView } from "../state-views";

import { uiStore } from "../ui/store";
import type { StorageSnapshot, StorageFeedback } from "../ui/store";

/** Bag capacity used to gate withdrawals when the inventory is full. */
const INVENTORY_CAPACITY = 24;
const KEY_ARM_MS = 200;

/** A stash item as received from STORAGE_SYNC. */
interface StashItem {
  uid: string;
  defId: string;
  baseRank: string;
  potentialTier: string;
  lines: number;
  count: number;
}

export class StorageScene extends Phaser.Scene {
  private room?: Room;
  private destroyed = false;
  private armed = false;
  private readonly unsubscribers: (() => void)[] = [];

  // Storage state from server.
  private stashItems: StashItem[] = [];
  private stashCapacity = 24;

  // Player inventory snapshot (bagged only).
  private baggedItems: InventoryItemView[] = [];

  private feedback: StorageFeedback | null = null;
  private feedbackSeq = 0;

  constructor() {
    super("storage");
  }

  create(): void {
    this.resetState();

    uiStore.getState().setStorageActions({
      deposit: (uid: string) => this.room?.send(MessageType.STORAGE_DEPOSIT, { uid }),
      withdraw: (uid: string) => this.room?.send(MessageType.STORAGE_WITHDRAW, { uid }),
      close: () => this.close(),
    });
    this.publishStorage();
    uiStore.getState().setStorageOpen(true);

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
    this.stashItems = [];
    this.stashCapacity = 24;
    this.baggedItems = [];
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
        this.refreshBagged();

        // Request initial stash sync.
        room.send(MessageType.STORAGE_SYNC);
      },
    });
  }

  private bind(room: Room): void {
    // Full stash sync from server.
    this.unsubscribers.push(
      room.onMessage(MessageType.STORAGE_SYNC, (payload: StorageSyncPayload) => {
        if (this.destroyed) return;
        this.stashItems = payload.items;
        this.stashCapacity = payload.capacity;
        this.publishStorage();
      }),
    );

    // Deposit/withdraw result.
    this.unsubscribers.push(
      room.onMessage(MessageType.STORAGE_DEPOSIT, (payload: StorageResultPayload) => {
        if (this.destroyed) return;
        this.pushFeedback(payload.message, payload.success);
        if (payload.success) this.refreshBagged();
        this.publishStorage();
      }),
    );

    this.unsubscribers.push(
      room.onMessage(MessageType.STORAGE_WITHDRAW, (payload: StorageResultPayload) => {
        if (this.destroyed) return;
        this.pushFeedback(payload.message, payload.success);
        if (payload.success) this.refreshBagged();
        this.publishStorage();
      }),
    );

    // Listen for inventory changes to refresh bagged items.
    const $ = getStateCallbacks(room);
    const localPlayer = (room.state as TownStateView).players.get(room.sessionId);
    if (localPlayer) {
      this.unsubscribers.push(
        $(localPlayer).inventory.onAdd(() => {
          if (!this.destroyed) this.refreshBagged();
        }),
      );
      this.unsubscribers.push(
        $(localPlayer).inventory.onRemove(() => {
          if (!this.destroyed) this.refreshBagged();
        }),
      );
      this.unsubscribers.push(
        $(localPlayer).equipped.onAdd(() => {
          if (!this.destroyed) this.refreshBagged();
        }),
      );
      this.unsubscribers.push(
        $(localPlayer).equipped.onRemove(() => {
          if (!this.destroyed) this.refreshBagged();
        }),
      );
    }
  }

  /** Build the list of bagged (unequipped) items from the local player's inventory. */
  private refreshBagged(): void {
    const room = this.room;
    if (!room) return;
    const localPlayer = (room.state as TownStateView).players.get(room.sessionId);
    if (!localPlayer) return;

    const equippedUids = new Set<string>();
    localPlayer.equipped.forEach((uid) => equippedUids.add(uid));

    this.baggedItems = [];
    localPlayer.inventory.forEach((item) => {
      if (!equippedUids.has(item.uid)) this.baggedItems.push(item);
    });

    this.publishStorage();
  }

  // ─── Snapshot publishing ──────────────────────────────────────────────────────

  private publishStorage(): void {
    const snapshot: StorageSnapshot = {
      bagged: this.baggedItems.map((item) => ({
        uid: item.uid,
        defId: item.defId,
        baseRank: item.baseRank,
        potentialTier: item.potentialTier,
        count: item.count,
      })),
      stash: this.stashItems.map((item) => ({
        uid: item.uid,
        defId: item.defId,
        baseRank: item.baseRank,
        potentialTier: item.potentialTier,
        count: item.count,
      })),
      stashCapacity: this.stashCapacity,
      inventoryCapacity: INVENTORY_CAPACITY,
      feedback: this.feedback,
    };
    uiStore.getState().setStorage(snapshot);
  }

  private pushFeedback(message: string, ok: boolean): void {
    this.feedback = { id: ++this.feedbackSeq, message, ok };
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.armed) return;
    if (event.code === "Escape" || event.code === "KeyB") this.close();
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
    uiStore.getState().setStorageOpen(false);
    uiStore.getState().setStorageActions(null);
  }
}
