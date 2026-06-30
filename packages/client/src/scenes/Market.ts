import Phaser from "phaser";
import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import {
  getItemDef,
  getPotentialTierInfo,
  type PotentialTier,
  PROTOCOL_VERSION,
} from "@maple/shared";

import { BACKEND_URL, authenticate, getAccountId } from "../backend";
import type { MarketStateView, ListingView, WalletMessage } from "../state-views";
import { uiStore } from "../ui/store";
import type { MarketSnapshot, MarketListing, MarketWalletItem, MarketFeedback } from "../ui/store";

/**
 * MarketScene — thin Phaser controller for the player-driven Free Market.
 *
 * The window itself is rendered by the React overlay (`ui/MarketPanel.tsx`) from
 * the shared kit + economy component library. This scene is now a thin bridge:
 * it opens the market's OWN Colyseus socket (`market_room` — separate from the
 * town connection, see below), publishes a plain {@link MarketSnapshot} into the
 * zustand bridge store, registers buy/bid/createListing/cancelListing/close
 * actions that send the existing authoritative messages, and tears everything
 * down on close.
 *
 * Connection model (IMPORTANT): the market is its OWN room, so we open a SEPARATE
 * Colyseus socket via `joinOrCreate("market_room")` rather than reusing the town
 * connection. We pass the SAME `getAccountId()` the town uses, so the server
 * resolves us to the same off-chain account — our Mesos and looted items carry
 * straight over.
 *
 * Two reactive data sources drive the snapshot:
 *   - the PRIVATE `wallet` message (mesos + decorated inventory), pushed on join
 *     and after every action;
 *   - the PUBLIC synced `state.listings` order book + `feeBps`.
 *
 * The server is authoritative: React only ever fires intents through the action
 * registry; rejections arrive as `market_error` and surface as a toast.
 *
 * Launched via `this.scene.launch("market")`, which pauses the gameplay scene.
 * Closing resumes it.
 */

/** Ignore close keys for a beat after opening so the same `M` press can't close us. */
const KEY_ARM_MS = 200;

export class MarketScene extends Phaser.Scene {
  /** Our own market connection (separate from the town socket). */
  private room?: Room<unknown, MarketStateView>;
  /** The shared off-chain account id — identical to the town's. */
  private accountId = "";
  /** Set on shutdown so a late-resolving `connect()` bails. */
  private destroyed = false;
  /** Schema-callback + onMessage detach fns, invoked on shutdown. */
  private readonly unsubscribers: (() => void)[] = [];

  // Live data folded into the published snapshot.
  private mesos = 0;
  private feeBps = 250;
  private connected = false;
  private walletItems: MarketWalletItem[] = [];
  private feedback: MarketFeedback | null = null;
  private feedbackSeq = 0;

  private armed = false;

  constructor() {
    super("market");
  }

  create(): void {
    // Phaser reuses the SAME scene instance across stop/launch cycles — wipe
    // per-session state before rebuilding.
    this.resetState();
    this.accountId = getAccountId();

    // Register the React-overlay bridge actions for the market.
    uiStore.getState().setMarketActions({
      buy: (listingId: string) => this.room?.send("buy", { listingId }),
      bid: (listingId: string, amount: number) => this.room?.send("bid", { listingId, amount }),
      createListing: (itemUid: string, price: number) =>
        this.room?.send("list", { itemUid, price }),
      cancelListing: (listingId: string) => this.room?.send("cancel", { listingId }),
      close: () => this.close(),
    });
    this.publish();
    uiStore.getState().setMarketOpen(true);

    this.input.keyboard?.on("keydown", this.onKeyDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    this.time.delayedCall(KEY_ARM_MS, () => {
      this.armed = true;
    });

    void this.connect().catch((err) => {
      console.error("[market] failed to join market_room", err);
      if (!this.destroyed) {
        this.pushFeedback("Couldn't reach the market. Is the server running?", false);
        this.publish();
      }
    });
  }

  private resetState(): void {
    this.destroyed = false;
    this.armed = false;
    this.room = undefined;
    this.mesos = 0;
    this.feeBps = 250;
    this.connected = false;
    this.walletItems = [];
    this.feedback = null;
    this.unsubscribers.length = 0;
  }

  // ─── Connection + reactive binding ───────────────────────────────────────────
  private async connect(): Promise<void> {
    const client = new Client(BACKEND_URL);
    // Authenticate and present the server-issued token; identity is derived server-side.
    const { token, accountId } = await authenticate();
    client.auth.token = token;
    this.accountId = accountId;
    const room = await client.joinOrCreate<MarketStateView>("market_room", {
      protocolVersion: PROTOCOL_VERSION,
    });

    // The scene may have closed while connecting — don't bind to a dead scene.
    if (this.destroyed) {
      void room.leave();
      return;
    }

    this.room = room;
    this.connected = true;
    this.bind(room);
    this.feeBps = room.state?.feeBps ?? this.feeBps;
    this.publish();
  }

  private bind(room: Room<unknown, MarketStateView>): void {
    const $ = getStateCallbacks(room);

    // Public order book → snapshot. onAdd replays existing listings.
    this.unsubscribers.push($(room.state).listings.onAdd(() => this.publish()));
    this.unsubscribers.push($(room.state).listings.onRemove(() => this.publish()));

    // Fee (effectively static, but keep the header correct; immediate = seed now).
    this.unsubscribers.push(
      $(room.state).listen(
        "feeBps",
        (value: number) => {
          this.feeBps = value;
          this.publish();
        },
        true,
      ),
    );

    // Private wallet push → balance + listable inventory.
    this.unsubscribers.push(
      room.onMessage("wallet", (msg: WalletMessage) => {
        this.mesos = msg.mesos;
        this.walletItems = (msg.items ?? []).map((item) => ({
          uid: item.uid,
          defId: item.defId,
          name: item.name,
          tierLabel: item.tierLabel,
          tierColor: item.tierColor,
          lines: item.lines,
          count: item.count ?? 1,
        }));
        this.publish();
      }),
    );

    // Server-side rejections → toast feedback.
    this.unsubscribers.push(
      room.onMessage("market_error", (msg: { reason: string }) => {
        this.pushFeedback(msg.reason, false);
        this.publish();
      }),
    );

    room.onError((code, message) => console.error(`[market] room error ${code}: ${message ?? ""}`));
    room.onLeave((code) => console.warn(`[market] left market_room (code ${code})`));
  }

  // ─── Snapshot publishing ─────────────────────────────────────────────────────
  private publish(): void {
    const listings: MarketListing[] = [];
    this.room?.state.listings.forEach((l: ListingView) => {
      const info = getPotentialTierInfo(l.potentialTier as PotentialTier);
      listings.push({
        listingId: l.listingId,
        defId: l.defId,
        name: getItemDef(l.defId)?.name ?? l.defId,
        sellerId: l.sellerId,
        sellerName: l.sellerName,
        potentialTier: l.potentialTier,
        tierLabel: info?.label ?? l.potentialTier,
        tierColor: info?.color ?? "#e5e7eb",
        lines: l.lines,
        price: l.price,
        createdAt: l.createdAt,
        listingType: l.listingType,
        endsAt: l.endsAt ?? 0,
        currentBid: l.currentBid ?? 0,
        mine: l.sellerId === this.accountId,
      });
    });

    const snapshot: MarketSnapshot = {
      mesos: this.mesos,
      feeBps: this.feeBps,
      connected: this.connected,
      listings,
      walletItems: this.walletItems,
      feedback: this.feedback,
    };
    uiStore.getState().setMarket(snapshot);
  }

  private pushFeedback(message: string, ok: boolean): void {
    this.feedback = { id: ++this.feedbackSeq, message, ok };
  }

  // ─── Close / teardown ────────────────────────────────────────────────────────
  private onKeyDown(event: KeyboardEvent): void {
    if (!this.armed) return;
    // Don't steal keys while the player is typing into a React input/dialog.
    const ae = document.activeElement;
    if (
      ae &&
      (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae as HTMLElement).isContentEditable)
    ) {
      return;
    }
    if (event.key === "Escape" || event.key === "m" || event.key === "M") {
      this.close();
    }
  }

  private close(): void {
    this.scene.stop(); // → SHUTDOWN → teardown()
    if (this.scene.get("map")) this.scene.resume("map");
  }

  private teardown(): void {
    this.destroyed = true;
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
    this.input.keyboard?.off("keydown", this.onKeyDown, this);

    uiStore.getState().setMarketOpen(false);
    uiStore.getState().setMarketActions(null);

    const room = this.room;
    this.room = undefined;
    if (room) void room.leave();
  }
}
