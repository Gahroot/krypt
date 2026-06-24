import Phaser from "phaser";
import { getStateCallbacks, type Room } from "@colyseus/sdk";
import { getItemDef, getPotentialTierInfo, type PotentialTier } from "@maple/shared";

import type { TownStateView, PlayerView, InventoryItemView } from "../state-views";

/**
 * UIScene — the parallel HUD overlay rendered on top of {@link MeadowfieldScene}.
 *
 * Launched via `this.scene.launch("ui")` so it runs *alongside* the gameplay scene rather than
 * replacing it. Because this is its own scene, its camera never scrolls — every GameObject here is
 * effectively screen-fixed without needing `setScrollFactor(0)`.
 *
 * It reuses the SAME Colyseus connection as Meadowfield: that scene publishes the joined room on the
 * shared scene registry under "room" (see `this.registry.set("room", room)`). We may boot a frame or
 * two before the socket connects, so we poll the registry until the handle appears, then bind.
 *
 * Everything on screen is REACTIVE: we attach schema callbacks (the verified 0.17 SDK API via
 * `getStateCallbacks`) to the LOCAL player and its inventory, and only ever redraw in response to an
 * authoritative state patch — never by polling field values per frame.
 */

// ─── Registry / curve constants (mirror MeadowfieldScene + TownRoom — keep in sync) ──────────────
/** Registry key MeadowfieldScene publishes the live room under. */
const ROOM_REGISTRY_KEY = "room";
/** How often (ms) we re-check the registry for the room handle before it's connected. */
const ROOM_POLL_MS = 80;

/**
 * Mirror of the server's exp curve (`TownRoom.expToNext`) — keep in sync. The synced `exp` field is
 * the *residual* progress toward the next level (the server subtracts each level's cost on level-up),
 * so the EXP bar ratio is simply `exp / expToNext(level)`.
 */
function expToNext(level: number): number {
  return Math.floor(15 * Math.pow(level, 1.5)) + 10;
}

// ─── Visual design tokens ────────────────────────────────────────────────────────────────────────
const FONT = "ui-monospace, Menlo, monospace";

/** Fill/stroke colors as hex ints for Graphics. */
const PALETTE = {
  panelFill: 0x131a27,
  panelStroke: 0x2a3852,
  barTrack: 0x0c1019,
  hp: 0xef4444, // red
  mp: 0x3b82f6, // blue (also the RARE rarity blue — intentionally cohesive)
  exp: 0x9ad06b, // the game's signature level-up green
  coinBody: 0xfacc15,
  coinRim: 0xb7791f,
  coinShine: 0xfff3c4,
  apBadge: 0xb45309,
  spBadge: 0x0e7490,
} as const;

/** Text colors as CSS strings for Text styles. */
const TEXT = {
  name: "#f8fafc",
  level: "#9ad06b",
  bright: "#e5e7eb",
  dim: "#94a3b8",
  mesos: "#ffe08a",
  badge: "#fdf3d8",
  hint: "#aeb9c7",
  stroke: "#0a0e16",
} as const;

// Top-left vitals panel geometry.
const PANEL_X = 12;
const PANEL_Y = 12;
const PANEL_W = 252;
const PANEL_H = 96;
const PANEL_PAD = 14;
const BAR_X = PANEL_X + PANEL_PAD;
const BAR_W = PANEL_W - PANEL_PAD * 2;

const MESOS_Y = 28;
const BADGE_Y = PANEL_Y + PANEL_H + 8;

// Inventory panel geometry (anchored to the top-right, below the mesos counter).
const INV_W = 300;
const INV_Y = 52;
const INV_PAD = 14;
const INV_HEADER_H = 38;
const INV_ROW_H = 26;
const INV_MAX_ROWS = 12;

/** A drawable stat bar: a static rounded track plus a fill Graphics we redraw as the ratio changes. */
interface BarParts {
  readonly fill: Phaser.GameObjects.Graphics;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: number;
}

/** A small rounded "AP 5" / "SP 3" pill that only shows when its value is > 0. */
interface Badge {
  readonly container: Phaser.GameObjects.Container;
  readonly bg: Phaser.GameObjects.Graphics;
  readonly text: Phaser.GameObjects.Text;
  readonly color: number;
}

export class UIScene extends Phaser.Scene {
  /** The LOCAL player's synced view. Undefined until it appears in `room.state.players`. */
  private localPlayer?: PlayerView;
  /** Guards against binding the local player's callbacks more than once. */
  private localBound = false;
  /** Polls the registry for the room handle before the socket has connected. */
  private roomPoll?: Phaser.Time.TimerEvent;
  /** Schema-callback detach fns, invoked on shutdown so we never leak listeners onto the room. */
  private readonly unsubscribers: (() => void)[] = [];

  // Top-left vitals.
  private nameText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private hpBar!: BarParts;
  private mpBar!: BarParts;
  private expBar!: BarParts;
  private hpText!: Phaser.GameObjects.Text;
  private mpText!: Phaser.GameObjects.Text;

  // Top-right mesos counter.
  private mesosBg!: Phaser.GameObjects.Graphics;
  private coin!: Phaser.GameObjects.Image;
  private mesosText!: Phaser.GameObjects.Text;

  // AP / SP badges.
  private apBadge!: Badge;
  private spBadge!: Badge;

  // Inventory panel.
  private inventoryOpen = false;
  private invPanel!: Phaser.GameObjects.Container;
  private invBg!: Phaser.GameObjects.Graphics;
  private invHeader!: Phaser.GameObjects.Text;
  private readonly invRows: Phaser.GameObjects.GameObject[] = [];

  // Bottom hint line.
  private hintText!: Phaser.GameObjects.Text;

  constructor() {
    super("ui");
  }

  create(): void {
    this.ensureCoinTexture();

    this.buildVitalsPanel();
    this.buildMesosCounter();
    this.buildBadges();
    this.buildInventoryPanel();
    this.buildHint();

    this.setupInventoryToggle();

    // Re-anchor the right/bottom-aligned pieces whenever the window (RESIZE scale mode) changes.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.layout();

    // Tidy up timers + schema listeners if this scene is ever stopped/restarted.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);

    this.resolveRoom();
  }

  // ─── Room acquisition + reactive binding ─────────────────────────────────────────────────────
  /** Grab the room from the registry, or poll until MeadowfieldScene publishes it post-connect. */
  private resolveRoom(): void {
    const existing = this.registry.get(ROOM_REGISTRY_KEY) as
      | Room<unknown, TownStateView>
      | undefined;
    if (existing) {
      this.bindRoom(existing);
      return;
    }
    this.roomPoll = this.time.addEvent({
      delay: ROOM_POLL_MS,
      loop: true,
      callback: () => {
        const room = this.registry.get(ROOM_REGISTRY_KEY) as
          | Room<unknown, TownStateView>
          | undefined;
        if (!room) return;
        this.roomPoll?.remove();
        this.roomPoll = undefined;
        this.bindRoom(room);
      },
    });
  }

  /** Attach schema callbacks once we have the room. Finds (or waits for) the local player. */
  private bindRoom(room: Room<unknown, TownStateView>): void {
    const $ = getStateCallbacks(room);

    // Wire the HUD to the local player's schema exactly once, reacting to every field + inventory
    // change. `$` is captured here so we never have to name its (internal) proxy type.
    const bindLocal = (player: PlayerView, sessionId: string): void => {
      if (this.localBound || sessionId !== room.sessionId) return;
      this.localBound = true;
      this.localPlayer = player;

      // Any field change (hp, mp, level, exp, ap, sp, mesos, name, …) refreshes the top HUD.
      // `onChange` fires once per applied state patch, so a level-up's many field writes coalesce
      // into a single redraw rather than one per field.
      this.unsubscribers.push($(player).onChange(() => this.updateHud()));

      // The inventory is a nested MapSchema — its add/remove drives the item panel. `onAdd` replays
      // already-owned items immediately, so this also covers the initial fill.
      this.unsubscribers.push($(player).inventory.onAdd(() => this.renderInventory()));
      this.unsubscribers.push($(player).inventory.onRemove(() => this.renderInventory()));

      this.updateHud();
      this.renderInventory();
    };

    // The local player may already be in state, or may arrive a beat later — handle both.
    const existing = room.state.players.get(room.sessionId);
    if (existing) bindLocal(existing, room.sessionId);
    this.unsubscribers.push(
      $(room.state).players.onAdd((player: PlayerView, sessionId: string) =>
        bindLocal(player, sessionId),
      ),
    );
  }

  // ─── Top HUD updates (reactive) ──────────────────────────────────────────────────────────────
  /** Push the local player's vitals/progression/mesos into the HUD. Called only on state change. */
  private updateHud(): void {
    const p = this.localPlayer;
    if (!p) return;

    this.nameText.setText(p.name || "Adventurer");
    this.levelText.setText(`Lv.${p.level}`);

    const hp = Math.max(0, p.hp);
    const mp = Math.max(0, p.mp);
    this.drawBarFill(this.hpBar, p.maxHp > 0 ? hp / p.maxHp : 0);
    this.drawBarFill(this.mpBar, p.maxMp > 0 ? mp / p.maxMp : 0);
    this.hpText.setText(`${hp} / ${p.maxHp}`);
    this.mpText.setText(`${mp} / ${p.maxMp}`);

    const expNeed = expToNext(p.level);
    this.drawBarFill(this.expBar, expNeed > 0 ? p.exp / expNeed : 0);

    this.mesosText.setText(p.mesos.toLocaleString());
    this.positionMesos();

    // AP / SP only matter once they've accrued from a level-up — hide them otherwise.
    let x = PANEL_X;
    x = this.layoutBadge(this.apBadge, p.ap > 0, `AP ${p.ap}`, x);
    this.layoutBadge(this.spBadge, p.sp > 0, `SP ${p.sp}`, x);
  }

  // ─── Inventory panel (reactive) ──────────────────────────────────────────────────────────────
  /** Rebuild the inventory rows from the current MapSchema. Called on item add/remove + toggle. */
  private renderInventory(): void {
    for (const row of this.invRows) row.destroy();
    this.invRows.length = 0;

    const items: InventoryItemView[] = [];
    this.localPlayer?.inventory.forEach((item) => items.push(item));

    this.invHeader.setText(`Inventory · ${items.length}`);

    let rows: number;
    if (items.length === 0) {
      this.addInventoryNote("No items yet — go hunt!", 0, "12px");
      rows = 1;
    } else {
      const shown = items.slice(0, INV_MAX_ROWS);
      shown.forEach((item, i) => this.addInventoryRow(item, i));
      rows = shown.length;

      const overflow = items.length - shown.length;
      if (overflow > 0) {
        this.addInventoryNote(`+${overflow} more…`, rows, "11px");
        rows += 1;
      }
    }

    // Grow the backing to fit: header + N rows + bottom padding.
    this.drawInventoryBackground(INV_HEADER_H + rows * INV_ROW_H + INV_PAD);
  }

  /** Add a dim full-width note row (empty state / overflow) at the given row index. */
  private addInventoryNote(message: string, index: number, fontSize: string): void {
    const note = this.add
      .text(INV_PAD, INV_HEADER_H + index * INV_ROW_H + INV_ROW_H / 2, message, {
        fontFamily: FONT,
        fontSize,
        color: TEXT.dim,
      })
      .setOrigin(0, 0.5);
    this.invPanel.add(note);
    this.invRows.push(note);
  }

  /** Render one item row: tier swatch + tier-colored name + tier label & line count. */
  private addInventoryRow(item: InventoryItemView, index: number): void {
    const info = getPotentialTierInfo(item.potentialTier as PotentialTier);
    const color = info?.color ?? TEXT.bright;
    const label = info?.label ?? item.potentialTier;
    const name = getItemDef(item.defId)?.name ?? item.defId;

    const rowY = INV_HEADER_H + index * INV_ROW_H;
    const midY = rowY + INV_ROW_H / 2;

    // Tier color swatch.
    const swatch = this.add.graphics();
    swatch
      .fillStyle(this.cssInt(color), 1)
      .fillRoundedRect(INV_PAD, midY - 6, 12, 12, 3)
      .lineStyle(1, 0x000000, 0.35)
      .strokeRoundedRect(INV_PAD, midY - 6, 12, 12, 3);

    const nameText = this.add
      .text(INV_PAD + 22, midY, name, {
        fontFamily: FONT,
        fontSize: "13px",
        color,
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5);

    const lines = `${item.lines} line${item.lines === 1 ? "" : "s"}`;
    const meta = this.add
      .text(INV_W - INV_PAD, midY, `${label} · ${lines}`, {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.dim,
      })
      .setOrigin(1, 0.5);

    this.invPanel.add([swatch, nameText, meta]);
    this.invRows.push(swatch, nameText, meta);
  }

  private setupInventoryToggle(): void {
    this.input.keyboard?.on("keydown-I", () => {
      this.inventoryOpen = !this.inventoryOpen;
      this.invPanel.setVisible(this.inventoryOpen);
      if (this.inventoryOpen) this.renderInventory();
    });
  }

  // ─── Static HUD construction ─────────────────────────────────────────────────────────────────
  private buildVitalsPanel(): void {
    const g = this.add.graphics();
    g.fillStyle(PALETTE.panelFill, 0.82)
      .fillRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 10)
      .lineStyle(1, PALETTE.panelStroke, 0.9)
      .strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 10);

    this.nameText = this.add.text(BAR_X, PANEL_Y + 12, "Adventurer", {
      fontFamily: FONT,
      fontSize: "15px",
      color: TEXT.name,
      fontStyle: "bold",
    });

    this.levelText = this.add
      .text(PANEL_X + PANEL_W - PANEL_PAD, PANEL_Y + 13, "Lv.1", {
        fontFamily: FONT,
        fontSize: "13px",
        color: TEXT.level,
        fontStyle: "bold",
      })
      .setOrigin(1, 0);

    this.hpBar = this.addBar(BAR_X, PANEL_Y + 40, BAR_W, 13, PALETTE.hp);
    this.mpBar = this.addBar(BAR_X, PANEL_Y + 58, BAR_W, 12, PALETTE.mp);
    this.expBar = this.addBar(BAR_X, PANEL_Y + 80, BAR_W, 5, PALETTE.exp);

    this.hpText = this.barNumber(this.hpBar);
    this.mpText = this.barNumber(this.mpBar);
  }

  private buildMesosCounter(): void {
    this.mesosBg = this.add.graphics();
    this.coin = this.add.image(0, MESOS_Y, "ui_coin").setOrigin(0.5, 0.5);
    this.mesosText = this.add
      .text(0, MESOS_Y, "0", {
        fontFamily: FONT,
        fontSize: "15px",
        color: TEXT.mesos,
        fontStyle: "bold",
      })
      .setOrigin(1, 0.5);
  }

  private buildBadges(): void {
    this.apBadge = this.makeBadge(PALETTE.apBadge);
    this.spBadge = this.makeBadge(PALETTE.spBadge);
  }

  private buildInventoryPanel(): void {
    this.invBg = this.add.graphics();
    this.invHeader = this.add.text(INV_PAD, INV_PAD, "Inventory · 0", {
      fontFamily: FONT,
      fontSize: "14px",
      color: TEXT.bright,
      fontStyle: "bold",
    });
    const hint = this.add
      .text(INV_W - INV_PAD, INV_PAD + 2, "[ I ]", {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.dim,
      })
      .setOrigin(1, 0);

    this.invPanel = this.add.container(0, INV_Y, [this.invBg, this.invHeader, hint]);
    this.invPanel.setDepth(1000).setVisible(false);
    this.drawInventoryBackground(INV_HEADER_H + INV_ROW_H + INV_PAD);
  }

  private buildHint(): void {
    this.hintText = this.add
      .text(14, 0, "Arrows/WASD move · SPACE attack · I inventory · M market", {
        fontFamily: FONT,
        fontSize: "12px",
        color: TEXT.hint,
        stroke: TEXT.stroke,
        strokeThickness: 3,
      })
      .setOrigin(0, 1);
  }

  // ─── Layout (right/bottom anchoring on resize) ───────────────────────────────────────────────
  private layout(): void {
    this.positionMesos();
    this.invPanel.setPosition(this.scale.width - 12 - INV_W, INV_Y);
    this.hintText.setPosition(14, this.scale.height - 12);
  }

  /** Right-align the mesos counter to the screen edge and fit its backing pill around coin + text. */
  private positionMesos(): void {
    const right = this.scale.width - 12;
    this.mesosText.setPosition(right - 6, MESOS_Y);
    const coinX = this.mesosText.x - this.mesosText.width - 12;
    this.coin.setPosition(coinX, MESOS_Y);

    const leftX = coinX - 12;
    const w = right + 2 - leftX;
    this.mesosBg
      .clear()
      .fillStyle(PALETTE.panelFill, 0.82)
      .fillRoundedRect(leftX, MESOS_Y - 16, w, 32, 9)
      .lineStyle(1, PALETTE.panelStroke, 0.9)
      .strokeRoundedRect(leftX, MESOS_Y - 16, w, 32, 9);
  }

  /** Show/position a badge (returns the next free x) or hide it when its value is 0. */
  private layoutBadge(badge: Badge, visible: boolean, label: string, x: number): number {
    badge.container.setVisible(visible);
    if (!visible) return x;

    badge.text.setText(label);
    const w = badge.text.width + 18;
    badge.bg
      .clear()
      .fillStyle(badge.color, 0.92)
      .fillRoundedRect(0, 0, w, 22, 7)
      .lineStyle(1, 0x000000, 0.25)
      .strokeRoundedRect(0, 0, w, 22, 7);
    badge.text.setPosition(9, 11);
    badge.container.setPosition(x, BADGE_Y);
    return x + w + 8;
  }

  // ─── Low-level builders ──────────────────────────────────────────────────────────────────────
  /** A static rounded track + an (initially empty) fill Graphics layered on top. */
  private addBar(x: number, y: number, w: number, h: number, color: number): BarParts {
    const radius = Math.min(4, h / 2);
    const track = this.add.graphics();
    track
      .fillStyle(PALETTE.barTrack, 1)
      .fillRoundedRect(x, y, w, h, radius)
      .lineStyle(1, 0x000000, 0.3)
      .strokeRoundedRect(x, y, w, h, radius);
    const fill = this.add.graphics();
    return { fill, x, y, w, h, color };
  }

  /** Redraw a bar's fill for the given [0,1] ratio (guards the rounded-rect min-width case). */
  private drawBarFill(parts: BarParts, ratio: number): void {
    const r = Phaser.Math.Clamp(ratio, 0, 1);
    parts.fill.clear();
    if (r <= 0) return;
    const radius = Math.min(4, parts.h / 2);
    const w = Math.max(parts.w * r, 1);
    parts.fill.fillStyle(parts.color, 1);
    if (w >= radius * 2) parts.fill.fillRoundedRect(parts.x, parts.y, w, parts.h, radius);
    else parts.fill.fillRect(parts.x, parts.y, w, parts.h);
  }

  /** A small "cur / max" label centered over a bar, stroked so it reads over any fill color. */
  private barNumber(parts: BarParts): Phaser.GameObjects.Text {
    return this.add
      .text(parts.x + parts.w / 2, parts.y + parts.h / 2, "— / —", {
        fontFamily: FONT,
        fontSize: "11px",
        color: TEXT.bright,
        stroke: TEXT.stroke,
        strokeThickness: 3,
      })
      .setOrigin(0.5);
  }

  private makeBadge(color: number): Badge {
    const bg = this.add.graphics();
    const text = this.add
      .text(0, 0, "", { fontFamily: FONT, fontSize: "12px", color: TEXT.badge, fontStyle: "bold" })
      .setOrigin(0, 0.5);
    const container = this.add.container(0, 0, [bg, text]).setVisible(false);
    return { container, bg, text, color };
  }

  /** Redraw the inventory panel background + header underline at the given total height. */
  private drawInventoryBackground(height: number): void {
    const h = Math.max(height, INV_HEADER_H + INV_ROW_H);
    this.invBg
      .clear()
      .fillStyle(PALETTE.panelFill, 0.9)
      .fillRoundedRect(0, 0, INV_W, h, 12)
      .lineStyle(1, PALETTE.panelStroke, 1)
      .strokeRoundedRect(0, 0, INV_W, h, 12)
      // Header underline.
      .lineStyle(1, PALETTE.panelStroke, 0.6)
      .lineBetween(INV_PAD, INV_HEADER_H - 8, INV_W - INV_PAD, INV_HEADER_H - 8);
  }

  /** Bake a small gold coin glyph used by the mesos counter (idempotent across HMR reloads). */
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

  /** Convert a "#rrggbb" CSS color to the integer Graphics fills want. */
  private cssInt(css: string): number {
    return Phaser.Display.Color.HexStringToColor(css).color;
  }

  private teardown(): void {
    this.roomPoll?.remove();
    this.roomPoll = undefined;
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
  }
}
