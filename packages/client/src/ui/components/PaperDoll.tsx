import * as React from "react";
import { SKIN_TONES, HAIR_COLORS, type CharacterAppearance } from "@maple/shared";

import { cn } from "@/ui/lib/utils";

/**
 * PaperDoll — a live procedural preview of a {@link CharacterAppearance}.
 *
 * Ports the hand-drawn Phaser `Graphics` preview from the old CharacterCreate
 * scene to a self-contained `<canvas>` so the React overlay owns its own
 * paper-doll render (no Phaser round-trip). Pure function of `appearance`:
 * redraws whenever it changes.
 */

const INK = "#1f2937";

/** Preview outfit body colours (CSS hex), mirroring the legacy scene table. */
const OUTFIT_BODY: Record<string, string> = {
  outfit_tunic: "#4c63a8", // warrior blue
  outfit_robe: "#7c5cbf", // purple
  outfit_vest: "#4caf50", // green
  outfit_dress: "#d4607a", // rose
};

function darken(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, ((n >> 16) & 0xff) - amount);
  const g = Math.max(0, ((n >> 8) & 0xff) - amount);
  const b = Math.max(0, (n & 0xff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function deg(d: number): number {
  return (d * Math.PI) / 180;
}

/** Filled rounded rect; `r` is a uniform radius or per-corner {tl,tr,br,bl}. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | { tl: number; tr: number; br: number; bl: number },
): void {
  const c = typeof r === "number" ? { tl: r, tr: r, br: r, bl: r } : r;
  ctx.beginPath();
  ctx.moveTo(x + c.tl, y);
  ctx.lineTo(x + w - c.tr, y);
  ctx.arcTo(x + w, y, x + w, y + c.tr, c.tr);
  ctx.lineTo(x + w, y + h - c.br);
  ctx.arcTo(x + w, y + h, x + w - c.br, y + h, c.br);
  ctx.lineTo(x + c.bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - c.bl, c.bl);
  ctx.lineTo(x, y + c.tl);
  ctx.arcTo(x, y, x + c.tl, y, c.tl);
  ctx.closePath();
}

function triangle(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fill();
}

function drawHair(
  ctx: CanvasRenderingContext2D,
  cx: number,
  hy: number,
  color: string,
  styleId: string,
): void {
  ctx.fillStyle = color;
  switch (styleId) {
    case "hair_short":
      roundRect(ctx, cx - 22, hy - 26, 44, 14, { tl: 6, tr: 6, bl: 0, br: 0 });
      ctx.fill();
      break;
    case "hair_medium":
      roundRect(ctx, cx - 22, hy - 28, 44, 18, { tl: 6, tr: 6, bl: 0, br: 0 });
      ctx.fill();
      break;
    case "hair_long":
      roundRect(ctx, cx - 22, hy - 28, 44, 18, { tl: 6, tr: 6, bl: 0, br: 0 });
      ctx.fill();
      roundRect(ctx, cx - 24, hy - 14, 12, 42, 4);
      ctx.fill();
      roundRect(ctx, cx + 12, hy - 14, 12, 42, 4);
      ctx.fill();
      break;
    case "hair_ponytail":
      roundRect(ctx, cx - 22, hy - 26, 44, 14, { tl: 6, tr: 6, bl: 0, br: 0 });
      ctx.fill();
      roundRect(ctx, cx + 16, hy - 22, 10, 34, 4);
      ctx.fill();
      break;
    case "hair_spiky":
      roundRect(ctx, cx - 22, hy - 28, 44, 16, { tl: 4, tr: 4, bl: 0, br: 0 });
      ctx.fill();
      triangle(ctx, cx - 16, hy - 28, cx - 8, hy - 42, cx, hy - 28);
      triangle(ctx, cx - 2, hy - 28, cx + 6, hy - 46, cx + 14, hy - 28);
      triangle(ctx, cx + 10, hy - 28, cx + 18, hy - 40, cx + 24, hy - 28);
      break;
    case "hair_bob":
      roundRect(ctx, cx - 24, hy - 26, 48, 24, { tl: 8, tr: 8, bl: 4, br: 4 });
      ctx.fill();
      break;
    default:
      roundRect(ctx, cx - 22, hy - 26, 44, 14, { tl: 6, tr: 6, bl: 0, br: 0 });
      ctx.fill();
  }
}

function drawEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, faceId: string): void {
  switch (faceId) {
    case "face_happy":
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy - 1, 4, deg(200), deg(340), false);
      ctx.stroke();
      break;
    case "face_determined":
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx + 2, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy - 7);
      ctx.lineTo(cx + 8, cy - 4);
      ctx.stroke();
      break;
    case "face_stoic":
      ctx.fillStyle = INK;
      ctx.fillRect(cx - 2, cy - 1, 8, 2.5);
      break;
    case "face_wonder":
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx + 2, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx + 3.5, cy - 1.5, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx + 2, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
  }
}

function drawPaperDoll(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  appearance: CharacterAppearance,
): void {
  const skinColor = SKIN_TONES.find((s) => s.id === appearance.skinId)?.hex ?? "#FDDCB5";
  const hairColor = HAIR_COLORS.find((s) => s.id === appearance.hairColorId)?.hex ?? "#1A1A1A";
  const bodyColor = OUTFIT_BODY[appearance.outfitId] ?? "#4c63a8";
  const armColor = darken(bodyColor, 20);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 64, 26, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.fillStyle = "#33415f";
  roundRect(ctx, cx - 16, cy + 28, 12, 28, 4);
  ctx.fill();
  roundRect(ctx, cx + 4, cy + 28, 12, 28, 4);
  ctx.fill();

  // Body
  ctx.fillStyle = bodyColor;
  roundRect(ctx, cx - 22, cy - 8, 44, 38, 8);
  ctx.fill();

  // Belt
  ctx.fillStyle = "#2e3a57";
  ctx.fillRect(cx - 22, cy + 26, 44, 4);

  // Arms
  ctx.fillStyle = armColor;
  roundRect(ctx, cx - 30, cy - 4, 10, 26, 4);
  ctx.fill();
  roundRect(ctx, cx + 20, cy - 4, 10, 26, 4);
  ctx.fill();

  // Head
  ctx.fillStyle = skinColor;
  ctx.beginPath();
  ctx.arc(cx, cy - 28, 20, 0, Math.PI * 2);
  ctx.fill();

  // Hair + eye (vary by style/face)
  drawHair(ctx, cx, cy - 28, hairColor, appearance.hairId);
  drawEye(ctx, cx, cy - 28, appearance.faceId);

  // Subtle mouth
  ctx.strokeStyle = "rgba(31,41,55,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx + 2, cy - 20, 3, deg(10), deg(170), false);
  ctx.stroke();
}

export interface PaperDollProps {
  appearance: CharacterAppearance;
  className?: string;
}

const WIDTH = 180;
const HEIGHT = 220;

export function PaperDoll({ appearance, className }: PaperDollProps) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    drawPaperDoll(ctx, WIDTH / 2, HEIGHT / 2 - 8, appearance);
  }, [appearance]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="Character preview"
      style={{ width: WIDTH, height: HEIGHT }}
      className={cn("block", className)}
    />
  );
}
