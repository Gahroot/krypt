import Phaser from "phaser";
import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import { getItemDef, getPotentialTierInfo, type PotentialTier } from "@maple/shared";

import { BACKEND_URL, getAccountId } from "../backend";
import type { MarketStateView, ListingView, WalletItemView, WalletMessage } from "../state-views";

/**
 * MarketScene — the Free Market overlay, wired to the authoritative Colyseus `market_room`.
 *
 * Opened on demand from {@link MeadowfieldScene} (press `M`), which pauses itself so the world freezes
 * behind the panel; this scene closes again on `M` / `ESC` and resumes Meadowfield.
 *
 * Connection model (IMPORTANT): the market is its OWN room, so we open a SEPARATE Colyseus socket here
 * via `joinOrCreate("market_room")` rather than reusing the town connection. We pass the SAME
 * `getAccountId()` the town uses, so the server resolves us to the same off-chain account — our Mesos
 * and looted items carry straight over (see packages/server/src/persistence/store.ts).
 *
 * Two reactive data sources drive the UI:
 *   - the PRIVATE `wallet` message (mesos + decorated inventory), pushed on join and after every action
 *     — this is the left column and the header balance.
 *   - the PUBLIC synced `state.listings` order book (verified 0.17 `getStateCallbacks` API) — the right
 *     column. `feeBps` (default 250 = 2.5%) is shown in the header.
 *
 * The server is authoritative: we only ever SEND intents (`list` / `buy` / `cancel`) and re-render from
 * what comes back. Rejections arrive as `market_error` and surface as a transient toast.
 */

// ─── Visual design tokens (cohesive with UIScene) ────────────────────────────────────────────────
const FONT = "ui-monospace, Menlo, monospace";

/** Fill/stroke colors as hex ints for Graphics / Rectangles. */
const PALETTE = {
  scrim: 0x05070d,
  panelFill: 0x131a27,
  panelStroke: 0x2a3852,
  columnFill: 0x0c1019,
  rowFill: 0x1b2435,
  rowHover: 0x243149,
  cardFill: 0x161f30,
  inputTrack: 0x0a0e16,
  buy: 0x15803d, // green
  buyHover: 0x1ba34f,
  cancel: 0x9f1239, // rose
  cancelHover: 0xc01a48,
  coinBody: 0xfacc15,
  coinRim: 0xb7791f,
  coinShine: 0xfff3c4,
} as const;

/** Text colors as CSS strings for Text styles. */
const TEXT = {
  title: "#f8fafc",
  bright: "#e5e7eb",
  dim: "#94a3b8",
  mesos: "#ffe08a",
  hint: "#aeb9c7",
  error: "#fca5a5",
  stroke: "#0a0e16",
} as const;

// ─── Panel geometry ──────────────────────────────────────────────────────────────────────────────
const PANEL_W = 900;
const PANEL_H = 560;
const PAD = 22;
const HEADER_H = 66;
const COL_GAP = 18;
const LEFT_W = 350;
const COL_HEADER_H = 34;
const FOOTER_H = 30;

const WALLET_ROW_H = 34;
const LIST_ROW_H = 48;
const WALLET_MAX_ROWS = 11;
const LIST_MAX_ROWS = 8;

/** Hardest cap on a typed price (9 digits stays inside the server's uint32 price field). */
const PRICE_MAX_DIGITS = 9;
/** Ignore close keys for a beat after opening, so the same `M` press that opened us can't close us. */
const KEY_ARM_MS = 200;

// ─── Depth layers (no container — top-level objects so input z-order is the plain depth sort) ──────
const DEPTH = {
  scrim: 0,
  panel: 1,
  rows: 2,
  buttons: 3,
  overlay: 100,
  overlayCard: 101,
  overlayText: 102,
  toast: 200,
} as const;

type GO = Phaser.GameObjects.GameObject;

export class MarketScene extends Phaser.Scene {
  /** Our own market connection (separate from the town socket). Undefined until `connect()` resolves. */
  private room?: Room<unknown, MarketStateView>;
  /** The shared off-chain account id — identical to the town's, so the wallet carries over. */
  private accountId = "";
  /** Set on shutdown so a late-resolving `connect()` bails instead of binding to a dead scene. */
  private destroyed = false;
  /** Schema-callback + onMessage detach fns, invoked on shutdown so we never leak listeners. */
  private readonly unsubscribers: (() => void)[] = [];

  // Live wallet (from the private `wallet` push) + fee (from synced state).
  private mesos = 0;
  private feeBps = 250;
  private walletItems: WalletItemView[] = [];

  // Tracked object buckets, destroyed + rebuilt on data change / resize.
  private readonly staticObjs: GO[] = [];
  private readonly walletObjs: GO[] = [];
  private readonly listingObjs: GO[] = [];
  private readonly priceObjs: GO[] = [];

  // Header refs (recreated by buildStatic, updated by renderHeader).
  private mesosText?: Phaser.GameObjects.Text;
  private feeText?: Phaser.GameObjects.Text;
  private coinImg?: Phaser.GameObjects.Image;
  private walletHeader?: Phaser.GameObjects.Text;
  private listHeader?: Phaser.GameObjects.Text;

  // Computed layout (recomputed on resize).
  private panelX = 0;
  private panelY = 0;
  private listColX = 0;
  private listColW = 0;
  private rowsTop = 0;
  private colHeaderY = 0;

  // Price-entry modal state + active toast.
  private pricing?: { item: WalletItemView; value: string };
  private activeToast?: Phaser.GameObjects.Text;
  /** Gates close keys (see KEY_ARM_MS). */
  private armed = false;

  constructor() {
    super("market");
  }

  async create(): Promise<void> {
    // Phaser reuses the SAME scene instance across stop/launch cycles, so wipe any state left over
    // from a previous market session before we rebuild (most importantly `destroyed`, which would
    // otherwise make this session's connect() bail). Last session's GameObjects were already
    // destroyed on shutdown, so we just drop the now-stale references.
    this.resetState();

    this.accountId = getAccountId();
    this.ensureCoinTexture();

    this.computeLayout();
    this.buildScene();

    this.input.keyboard?.on("keydown", this.onKeyDown, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.relayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    this.time.delayedCall(KEY_ARM_MS, () => {
      this.armed = true;
    });

    try {
      await this.connect();
    } catch (err) {
      console.error("[market] failed to join market_room", err);
      if (!this.destroyed) this.toast("Couldn't reach the market. Is the server running?");
    }
  }

  /** Wipe per-session state so a reused scene instance starts clean on every open. */
  private resetState(): void {
    this.destroyed = false;
    this.armed = false;
    this.room = undefined;
    this.pricing = undefined;
    this.activeToast = undefined;
    this.mesos = 0;
    this.feeBps = 250;
    this.walletItems = [];
    this.unsubscribers.length = 0;
    // The previous session's objects are gone (destroyed on shutdown) — just clear the references.
    this.staticObjs.length = 0;
    this.walletObjs.length = 0;
    this.listingObjs.length = 0;
    this.priceObjs.length = 0;
  }

  // ─── Connection + reactive binding ───────────────────────────────────────────────────────────
  private async connect(): Promise<void> {
    const client = new Client(BACKEND_URL);
    const room = await client.joinOrCreate<MarketStateView>("market_room", {
      accountId: this.accountId,
    });

    // The scene may have closed while the socket was connecting — don't bind to a dead scene.
    if (this.destroyed) {
      void room.leave();
      return;
    }

    this.room = room;
    this.bind(room);
  }

  private bind(room: Room<unknown, MarketStateView>): void {
    const $ = getStateCallbacks(room);

    // Public order book → right column. onAdd replays existing listings, covering the initial fill.
    this.unsubscribers.push($(room.state).listings.onAdd(() => this.renderListings()));
    this.unsubscribers.push($(room.state).listings.onRemove(() => this.renderListings()));
    // Fee is effectively static, but listen so the header is always correct (immediate = seed now).
    this.unsubscribers.push(
      $(room.state).listen(
        "feeBps",
        (value: number) => {
          this.feeBps = value;
          this.renderHeader();
        },
        true,
      ),
    );

    // Private wallet push → header balance + left column. Fires on join and after every action.
    this.unsubscribers.push(
      room.onMessage("wallet", (msg: WalletMessage) => {
        this.mesos = msg.mesos;
        this.walletItems = msg.items ?? [];
        this.renderHeader();
        this.renderWallet();
      }),
    );

    // Server-side rejections (bad price, can't afford, not your listing, …) → transient toast.
    this.unsubscribers.push(
      room.onMessage("market_error", (msg: { reason: string }) => this.toast(msg.reason)),
    );

    room.onError((code, message) => console.error(`[market] room error ${code}: ${message ?? ""}`));
    room.onLeave((code) => console.warn(`[market] left market_room (code ${code})`));

    // First paint with whatever already arrived in the joined state.
    this.feeBps = room.state?.feeBps ?? this.feeBps;
    this.renderHeader();
    this.renderListings();
  }

  // ─── Layout ──────────────────────────────────────────────────────────────────────────────────
  private computeLayout(): void {
    this.panelX = Math.round((this.scale.width - PANEL_W) / 2);
    this.panelY = Math.round((this.scale.height - PANEL_H) / 2);

    const innerX = this.panelX + PAD;
    const contentTop = this.panelY + HEADER_H;
    this.listColX = innerX + LEFT_W + COL_GAP;
    this.listColW = PANEL_W - PAD * 2 - LEFT_W - COL_GAP;
    this.colHeaderY = contentTop + 6;
    this.rowsTop = contentTop + COL_HEADER_H;
  }

  private get walletColX(): number {
    return this.panelX + PAD;
  }

  private relayout(): void {
    this.computeLayout();
    this.buildScene();
    if (this.pricing) this.renderPricing();
  }

  // ─── Static chrome ─────────────────────────────────────────────────────────────────────────────
  private buildScene(): void {
    this.clearBucket(this.staticObjs);
    this.clearBucket(this.walletObjs);
    this.clearBucket(this.listingObjs);
    this.buildStatic();
    this.renderHeader();
    this.renderWallet();
    this.renderListings();
  }

  private buildStatic(): void {
    // Full-screen scrim — dims the frozen town and swallows stray clicks behind the panel.
    const scrim = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, PALETTE.scrim, 0.62)
      .setOrigin(0, 0)
      .setDepth(DEPTH.scrim)
      .setInteractive();
    this.staticObjs.push(scrim);

    const px = this.panelX;
    const py = this.panelY;
    const contentTop = py + HEADER_H;
    const colBgTop = contentTop;
    const colBgH = py + PANEL_H - FOOTER_H - colBgTop;

    // Panel + column backings drawn into one Graphics for cheapness.
    const g = this.add.graphics().setDepth(DEPTH.panel);
    g.fillStyle(PALETTE.panelFill, 0.98)
      .fillRoundedRect(px, py, PANEL_W, PANEL_H, 14)
      .lineStyle(1, PALETTE.panelStroke, 1)
      .strokeRoundedRect(px, py, PANEL_W, PANEL_H, 14)
      // header underline
      .lineStyle(1, PALETTE.panelStroke, 0.7)
      .lineBetween(px + PAD, contentTop - 2, px + PANEL_W - PAD, contentTop - 2)
      // column backings
      .fillStyle(PALETTE.columnFill, 0.6)
      .fillRoundedRect(this.walletColX - 10, colBgTop, LEFT_W + 16, colBgH, 10)
      .fillRoundedRect(this.listColX - 8, colBgTop, this.listColW + 16, colBgH, 10);
    this.staticObjs.push(g);

    const title = this.add
      .text(px + PAD, py + 18, "Free Market", {
        fontFamily: FONT,
        fontSize: "20px",
        color: TEXT.title,
        fontStyle: "bold",
      })
      .setDepth(DEPTH.panel);
    const subtitle = this.add
      .text(px + PAD, py + 44, "Off-chain · Mesos", {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.dim,
      })
      .setDepth(DEPTH.panel);
    this.staticObjs.push(title, subtitle);

    // Header right side: live mesos balance (with coin) + fee.
    this.coinImg = this.add
      .image(0, py + 28, "ui_coin")
      .setOrigin(0.5)
      .setDepth(DEPTH.panel);
    this.mesosText = this.add
      .text(0, py + 28, "0", {
        fontFamily: FONT,
        fontSize: "17px",
        color: TEXT.mesos,
        fontStyle: "bold",
      })
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.panel);
    this.feeText = this.add
      .text(px + PANEL_W - PAD, py + 48, "", {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.dim,
      })
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.panel);
    this.staticObjs.push(this.coinImg, this.mesosText, this.feeText);

    // Column headers.
    this.walletHeader = this.add
      .text(this.walletColX, this.colHeaderY, "Your Wallet", {
        fontFamily: FONT,
        fontSize: "14px",
        color: TEXT.bright,
        fontStyle: "bold",
      })
      .setDepth(DEPTH.panel);
    const walletHint = this.add
      .text(this.walletColX + LEFT_W, this.colHeaderY + 2, "click to list", {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.dim,
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH.panel);
    this.listHeader = this.add
      .text(this.listColX, this.colHeaderY, "Market Listings", {
        fontFamily: FONT,
        fontSize: "14px",
        color: TEXT.bright,
        fontStyle: "bold",
      })
      .setDepth(DEPTH.panel);
    this.staticObjs.push(this.walletHeader, walletHint, this.listHeader);

    const footer = this.add
      .text(
        px + PANEL_W / 2,
        py + PANEL_H - 16,
        "Click a wallet item to list it  ·  Press  M  or  Esc  to close",
        { fontFamily: FONT, fontSize: "12px", color: TEXT.hint },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.panel);
    this.staticObjs.push(footer);
  }

  // ─── Header (reactive) ─────────────────────────────────────────────────────────────────────────
  private renderHeader(): void {
    const rightX = this.panelX + PANEL_W - PAD;

    this.mesosText?.setText(this.mesos.toLocaleString());
    this.mesosText?.setPosition(rightX, this.panelY + 28);
    if (this.coinImg && this.mesosText) {
      this.coinImg.setPosition(this.mesosText.x - this.mesosText.width - 10, this.panelY + 28);
    }

    this.feeText?.setText(`Market fee  ${this.feeBps / 100}%`);
    this.feeText?.setPosition(rightX, this.panelY + 48);
  }

  // ─── Wallet column (reactive — from the private `wallet` push) ────────────────────────────────
  private renderWallet(): void {
    this.clearBucket(this.walletObjs);
    this.walletHeader?.setText(`Your Wallet · ${this.walletItems.length}`);

    if (this.walletItems.length === 0) {
      this.addColumnNote(
        "No items yet — loot some in Meadowfield, then list them here.",
        this.walletColX,
        this.rowsTop,
        LEFT_W,
        this.walletObjs,
      );
      return;
    }

    const shown = this.walletItems.slice(0, WALLET_MAX_ROWS);
    shown.forEach((item, i) => this.addWalletRow(item, i));

    const overflow = this.walletItems.length - shown.length;
    if (overflow > 0) {
      this.addColumnNote(
        `+${overflow} more…`,
        this.walletColX,
        this.rowsTop + shown.length * WALLET_ROW_H,
        LEFT_W,
        this.walletObjs,
      );
    }
  }

  /** One clickable wallet row. The server already decorated the item with name/tier color/label. */
  private addWalletRow(item: WalletItemView, index: number): void {
    const rowY = this.rowsTop + index * WALLET_ROW_H;
    const h = WALLET_ROW_H - 6;
    const midY = rowY + h / 2;

    const rect = this.add
      .rectangle(this.walletColX, rowY, LEFT_W, h, PALETTE.rowFill)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PALETTE.panelStroke, 0.5)
      .setDepth(DEPTH.rows)
      .setInteractive({ useHandCursor: true });
    rect.on("pointerover", () => rect.setFillStyle(PALETTE.rowHover));
    rect.on("pointerout", () => rect.setFillStyle(PALETTE.rowFill));
    rect.on("pointerdown", () => this.openPricing(item));

    const swatch = this.add
      .rectangle(this.walletColX + 14, midY, 12, 12, this.cssInt(item.tierColor))
      .setStrokeStyle(1, 0x000000, 0.35)
      .setDepth(DEPTH.rows);
    const name = this.add
      .text(this.walletColX + 30, midY, item.name, {
        fontFamily: FONT,
        fontSize: "13px",
        color: item.tierColor,
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.rows);
    const meta = this.add
      .text(
        this.walletColX + LEFT_W - 12,
        midY,
        `${item.tierLabel} · ${this.lineLabel(item.lines)}`,
        { fontFamily: FONT, fontSize: "11px", color: TEXT.dim },
      )
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.rows);

    this.walletObjs.push(rect, swatch, name, meta);
  }

  // ─── Listings column (reactive — from synced state.listings) ──────────────────────────────────
  private renderListings(): void {
    this.clearBucket(this.listingObjs);

    const listings: ListingView[] = [];
    this.room?.state.listings.forEach((l) => listings.push(l));
    listings.sort((a, b) => b.createdAt - a.createdAt); // newest first

    this.listHeader?.setText(`Market Listings · ${listings.length}`);

    if (listings.length === 0) {
      this.addColumnNote(
        "No listings yet. Be the first to sell!",
        this.listColX,
        this.rowsTop,
        this.listColW,
        this.listingObjs,
      );
      return;
    }

    const shown = listings.slice(0, LIST_MAX_ROWS);
    shown.forEach((l, i) => this.addListingRow(l, i));

    const overflow = listings.length - shown.length;
    if (overflow > 0) {
      this.addColumnNote(
        `+${overflow} more listings…`,
        this.listColX,
        this.rowsTop + shown.length * LIST_ROW_H,
        this.listColW,
        this.listingObjs,
      );
    }
  }

  /**
   * One listing row. The synced Listing carries only ids/ranks, so we resolve the display name via
   * `getItemDef(defId)` and the tier color/label via `getPotentialTierInfo(tier)` (both @maple/shared).
   */
  private addListingRow(listing: ListingView, index: number): void {
    const rowY = this.rowsTop + index * LIST_ROW_H;
    const h = LIST_ROW_H - 6;
    const line1 = rowY + 15;
    const line2 = rowY + 31;

    const info = getPotentialTierInfo(listing.potentialTier as PotentialTier);
    const color = info?.color ?? TEXT.bright;
    const label = info?.label ?? listing.potentialTier;
    const name = getItemDef(listing.defId)?.name ?? listing.defId;
    const isMine = listing.sellerId === this.accountId;

    const rect = this.add
      .rectangle(this.listColX, rowY, this.listColW, h, PALETTE.rowFill)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PALETTE.panelStroke, 0.5)
      .setDepth(DEPTH.rows);
    this.listingObjs.push(rect);

    const swatch = this.add
      .rectangle(this.listColX + 14, line1, 12, 12, this.cssInt(color))
      .setStrokeStyle(1, 0x000000, 0.35)
      .setDepth(DEPTH.rows);
    const nameText = this.add
      .text(this.listColX + 30, line1, name, {
        fontFamily: FONT,
        fontSize: "13px",
        color,
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.rows);
    const seller = isMine ? "you" : listing.sellerName || "seller";
    const meta = this.add
      .text(this.listColX + 30, line2, `${label} · ${this.lineLabel(listing.lines)} · ${seller}`, {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.dim,
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.rows);
    this.listingObjs.push(swatch, nameText, meta);

    // Right side: action button + price just left of it.
    const btnW = 78;
    const btnH = 30;
    const btnX = this.listColX + this.listColW - 12 - btnW;
    const btnCenterX = btnX + btnW / 2;
    const btnY = rowY + h / 2;
    const priceX = btnX - 14;

    const price = this.add
      .text(priceX, line1, listing.price.toLocaleString(), {
        fontFamily: FONT,
        fontSize: "14px",
        color: TEXT.mesos,
        fontStyle: "bold",
      })
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.rows);
    const priceTag = this.add
      .text(priceX, line2, "Mesos", { fontFamily: FONT, fontSize: "10px", color: TEXT.dim })
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.rows);
    this.listingObjs.push(price, priceTag);

    if (isMine) {
      this.addButton(
        btnCenterX,
        btnY,
        btnW,
        btnH,
        "Cancel",
        PALETTE.cancel,
        PALETTE.cancelHover,
        () => this.room?.send("cancel", { listingId: listing.listingId }),
      );
    } else {
      this.addButton(btnCenterX, btnY, btnW, btnH, "Buy", PALETTE.buy, PALETTE.buyHover, () =>
        this.room?.send("buy", { listingId: listing.listingId }),
      );
    }
  }

  /** A small pill button, tracked in `listingObjs` (rebuilt with the listing rows). */
  private addButton(
    cx: number,
    cy: number,
    w: number,
    h: number,
    label: string,
    base: number,
    hover: number,
    onClick: () => void,
  ): void {
    const rect = this.add
      .rectangle(cx, cy, w, h, base)
      .setStrokeStyle(1, 0x000000, 0.3)
      .setDepth(DEPTH.buttons)
      .setInteractive({ useHandCursor: true });
    rect.on("pointerover", () => rect.setFillStyle(hover));
    rect.on("pointerout", () => rect.setFillStyle(base));
    rect.on("pointerdown", onClick);

    const text = this.add
      .text(cx, cy, label, {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.title,
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.buttons);

    this.listingObjs.push(rect, text);
  }

  /** A dim, word-wrapped note (empty-state / overflow) at a column position. */
  private addColumnNote(message: string, x: number, y: number, w: number, bucket: GO[]): void {
    const note = this.add
      .text(x + 12, y + 14, message, {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.dim,
        wordWrap: { width: w - 24 },
      })
      .setOrigin(0, 0)
      .setDepth(DEPTH.rows);
    bucket.push(note);
  }

  // ─── Price-entry modal (keyboard number entry) ────────────────────────────────────────────────
  private openPricing(item: WalletItemView): void {
    this.pricing = { item, value: "" };
    this.renderPricing();
  }

  private renderPricing(): void {
    this.clearBucket(this.priceObjs);
    const pricing = this.pricing;
    if (!pricing) return;

    const cw = 400;
    const ch = 214;
    const cx = Math.round(this.scale.width / 2);
    const cy = Math.round(this.scale.height / 2);
    const x = cx - cw / 2;
    const y = cy - ch / 2;

    const scrim = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, PALETTE.scrim, 0.5)
      .setOrigin(0, 0)
      .setDepth(DEPTH.overlay)
      .setInteractive();

    const g = this.add.graphics().setDepth(DEPTH.overlayCard);
    g.fillStyle(PALETTE.cardFill, 1)
      .fillRoundedRect(x, y, cw, ch, 14)
      .lineStyle(1, PALETTE.panelStroke, 1)
      .strokeRoundedRect(x, y, cw, ch, 14);

    const title = this.add
      .text(cx, y + 24, "List for sale", {
        fontFamily: FONT,
        fontSize: "15px",
        color: TEXT.bright,
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlayText);
    const itemName = this.add
      .text(cx, y + 48, pricing.item.name, {
        fontFamily: FONT,
        fontSize: "14px",
        color: pricing.item.tierColor,
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlayText);

    const label = this.add
      .text(x + 24, y + 80, "Price (Mesos)", {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.dim,
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.overlayText);

    const boxX = x + 24;
    const boxY = y + 92;
    const boxW = cw - 48;
    const boxH = 40;
    g.fillStyle(PALETTE.inputTrack, 1)
      .fillRoundedRect(boxX, boxY, boxW, boxH, 8)
      .lineStyle(1, PALETTE.panelStroke, 1)
      .strokeRoundedRect(boxX, boxY, boxW, boxH, 8);

    const empty = pricing.value === "";
    const value = this.add
      .text(boxX + 14, boxY + boxH / 2, empty ? "0" : pricing.value, {
        fontFamily: FONT,
        fontSize: "18px",
        color: empty ? TEXT.dim : TEXT.mesos,
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.overlayText);

    const price = Number.parseInt(pricing.value || "0", 10);
    const fee = Math.floor((price * this.feeBps) / 10_000);
    const net = Math.max(0, price - fee);
    const netLine = this.add
      .text(
        cx,
        y + 156,
        price > 0
          ? `You receive ≈ ${net.toLocaleString()} Mesos  (after ${this.feeBps / 100}% fee)`
          : "Type a price, then press Enter",
        { fontFamily: FONT, fontSize: "11px", color: TEXT.dim },
      )
      .setOrigin(0.5)
      .setDepth(DEPTH.overlayText);

    const hint = this.add
      .text(cx, y + 186, "[ Enter ] List      [ Esc ] Cancel", {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.hint,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlayText);

    this.priceObjs.push(scrim, g, title, itemName, label, value, netLine, hint);
  }

  private confirmPricing(): void {
    const pricing = this.pricing;
    if (!pricing) return;

    const price = Number.parseInt(pricing.value || "0", 10);
    if (!Number.isFinite(price) || price <= 0) {
      this.toast("Enter a price above 0.");
      return;
    }
    this.room?.send("list", { itemUid: pricing.item.uid, price });
    this.cancelPricing();
  }

  private cancelPricing(): void {
    this.pricing = undefined;
    this.clearBucket(this.priceObjs);
  }

  // ─── Transient toast (market_error reasons + local validation) ────────────────────────────────
  private toast(message: string, color: string = TEXT.error): void {
    this.activeToast?.destroy();

    const y = this.panelY + HEADER_H + 14;
    const t = this.add
      .text(this.panelX + PANEL_W / 2, y, message, {
        fontFamily: FONT,
        fontSize: "13px",
        color,
        fontStyle: "bold",
        backgroundColor: "rgba(10,14,22,0.9)",
        padding: { x: 12, y: 7 },
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.toast);
    this.activeToast = t;

    this.tweens.add({
      targets: t,
      alpha: { from: 1, to: 0 },
      y: y + 12,
      delay: 1700,
      duration: 700,
      ease: "Quad.easeIn",
      onComplete: () => {
        t.destroy();
        if (this.activeToast === t) this.activeToast = undefined;
      },
    });
  }

  // ─── Keyboard (single handler — close keys + price digits, mode-switched) ─────────────────────
  private onKeyDown(event: KeyboardEvent): void {
    const key = event.key;

    // Price-entry mode captures everything until Enter/Esc.
    if (this.pricing) {
      if (key === "Enter") {
        this.confirmPricing();
      } else if (key === "Escape") {
        this.cancelPricing();
      } else if (key === "Backspace") {
        event.preventDefault();
        this.pricing.value = this.pricing.value.slice(0, -1);
        this.renderPricing();
      } else if (key.length === 1 && key >= "0" && key <= "9") {
        if (this.pricing.value.length < PRICE_MAX_DIGITS) {
          this.pricing.value += key;
          this.renderPricing();
        }
      }
      return;
    }

    // Browse mode: close on M / Esc (armed so the opening press can't immediately close us).
    if (!this.armed) return;
    if (key === "Escape" || key === "m" || key === "M") this.close();
  }

  private close(): void {
    this.scene.resume("meadowfield");
    this.scene.stop(); // → SHUTDOWN → teardown()
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────────────────────────
  private lineLabel(lines: number): string {
    return `${lines} line${lines === 1 ? "" : "s"}`;
  }

  private clearBucket(bucket: GO[]): void {
    for (const o of bucket) o.destroy();
    bucket.length = 0;
  }

  /** Convert a "#rrggbb" CSS color to the integer Rectangle/Graphics fills want. */
  private cssInt(css: string): number {
    return Phaser.Display.Color.HexStringToColor(css).color;
  }

  /** Bake a small gold coin glyph for the header (shared key with UIScene; idempotent). */
  private ensureCoinTexture(): void {
    const key = "ui_coin";
    if (this.textures.exists(key)) return;
    const d = 16;
    const g = this.make.graphics();
    g.fillStyle(PALETTE.coinRim, 1).fillCircle(d / 2, d / 2, d / 2 - 1);
    g.fillStyle(PALETTE.coinBody, 1).fillCircle(d / 2, d / 2, d / 2 - 2.5);
    g.fillStyle(PALETTE.coinShine, 0.9).fillCircle(d / 2 - 2, d / 2 - 2, 2);
    g.lineStyle(1, PALETTE.coinRim, 0.8).strokeCircle(d / 2, d / 2, d / 2 - 4);
    g.generateTexture(key, d, d);
    g.destroy();
  }

  private teardown(): void {
    this.destroyed = true;
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;

    this.scale.off(Phaser.Scale.Events.RESIZE, this.relayout, this);
    this.input.keyboard?.off("keydown", this.onKeyDown, this);

    const room = this.room;
    this.room = undefined;
    if (room) void room.leave();
  }
}
