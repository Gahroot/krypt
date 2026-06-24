import Phaser from "phaser";

/**
 * Procedural placeholder art for CryptoMaple.
 *
 * Every texture here is generated at runtime from colored shapes via
 * `Phaser.GameObjects.Graphics` + `generateTexture` — there are **no external image files** and we
 * ship **zero MapleStory assets** (see WORLD.md). The palette targets Meadowfield's cozy, pastoral
 * "everything is okay here" vibe.
 *
 * NOTE: These are CC0 / placeholder visuals. They exist so the game is fully playable before an
 * artist is involved, and are meant to be swapped out for real art later — keep the texture keys
 * stable (scenes reference them by key) and you can replace the pixels without touching gameplay.
 */

/** Canonical texture keys. Import these instead of hard-coding strings in scenes. */
export const TextureKeys = {
  TileGrass: "tile_grass",
  TileGrassAlt: "tile_grass_alt",
  PlayerWarrior: "player_warrior",
  MobSlime: "mob_slime",
  LootGem: "loot_gem",
  LootGemLegendary: "loot_gem_legendary",
  Shadow: "shadow",
} as const;

export type TextureKey = (typeof TextureKeys)[keyof typeof TextureKeys];

/** Pixel dimensions for each generated texture — the single source of truth used when baking. */
export const TextureSize: Record<TextureKey, { w: number; h: number }> = {
  [TextureKeys.TileGrass]: { w: 32, h: 32 },
  [TextureKeys.TileGrassAlt]: { w: 32, h: 32 },
  [TextureKeys.PlayerWarrior]: { w: 28, h: 40 },
  [TextureKeys.MobSlime]: { w: 30, h: 24 },
  [TextureKeys.LootGem]: { w: 16, h: 16 },
  [TextureKeys.LootGemLegendary]: { w: 16, h: 16 },
  [TextureKeys.Shadow]: { w: 24, h: 8 },
};

/** Ground tile edge length — handy for tilemap math in Meadowfield. */
export const TILE_SIZE = TextureSize[TextureKeys.TileGrass].w;

/** Palette. Hex ints so they drop straight into Graphics fill/line styles. */
const Color = {
  grassBase: 0x86c25a,
  grassSpeckDark: 0x6ba343,
  grassSpeckLight: 0x9ad06b,
  grassAltBase: 0x77b14c,
  grassAltSpeckDark: 0x5e9a3e,
  grassAltSpeckLight: 0x8ac25e,

  skin: 0xf1c58b,
  hair: 0x6b4a2f,
  warriorBody: 0x4c63a8,
  warriorArm: 0x3f5596,
  warriorBelt: 0x2e3a57,
  warriorLegs: 0x33415f,
  ink: 0x1f2937,

  slimeBody: 0x6fcf5f,
  slimeShade: 0x4fa83f,
  slimeGloss: 0xbff0ae,

  gemBody: 0x38bdf8,
  gemFacet: 0xbae6fd,
  gemOutline: 0x0ea5e9,

  legendaryBody: 0x34d399,
  legendaryFacet: 0xa7f3d0,
  legendaryOutline: 0x059669,
  legendaryGlow: 0x22c55e, // bright green halo so legendary drops read instantly
} as const;

type DrawFn = (g: Phaser.GameObjects.Graphics, w: number, h: number) => void;

/**
 * Bake one texture from a draw callback. Idempotent: if the key already exists (e.g. across a Vite
 * HMR reload) we skip it, so textures are never double-generated.
 */
function bake(scene: Phaser.Scene, key: TextureKey, draw: DrawFn): void {
  if (scene.textures.exists(key)) return;

  const { w, h } = TextureSize[key];
  // `make.graphics` builds an off-display-list Graphics we only use as a stamp, then discard.
  const g = scene.make.graphics();
  draw(g, w, h);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Soft pastoral ground. `specks` add subtle, deterministic texture so flat fills don't look dead. */
function drawGrass(
  g: Phaser.GameObjects.Graphics,
  w: number,
  h: number,
  base: number,
  speckDark: number,
  speckLight: number,
): void {
  g.fillStyle(base, 1);
  g.fillRect(0, 0, w, h);

  // Fixed positions (not random) so adjacent tiles read as one cohesive field.
  const dark: [number, number][] = [
    [5, 7],
    [22, 4],
    [13, 18],
    [27, 23],
    [8, 27],
  ];
  const light: [number, number][] = [
    [17, 9],
    [3, 20],
    [25, 14],
    [11, 3],
    [20, 26],
  ];

  g.fillStyle(speckDark, 0.5);
  for (const [x, y] of dark) g.fillRect(x, y, 2, 2);
  g.fillStyle(speckLight, 0.5);
  for (const [x, y] of light) g.fillRect(x, y, 2, 2);
}

/** Simple humanoid block (body + head), drawn facing right. Tint/flip is applied at render time. */
function drawWarrior(g: Phaser.GameObjects.Graphics): void {
  // Legs (behind everything).
  g.fillStyle(Color.warriorLegs, 1);
  g.fillRoundedRect(8, 30, 5, 9, 2);
  g.fillRoundedRect(15, 30, 5, 9, 2);

  // Right arm drawn before the torso so only a stub peeks out on the facing side.
  g.fillStyle(Color.warriorArm, 1);
  g.fillRoundedRect(20, 18, 5, 11, 2);

  // Torso.
  g.fillStyle(Color.warriorBody, 1);
  g.fillRoundedRect(5, 16, 18, 16, 4);

  // Belt.
  g.fillStyle(Color.warriorBelt, 1);
  g.fillRect(5, 28, 18, 3);

  // Head.
  g.fillStyle(Color.skin, 1);
  g.fillCircle(14, 9, 7);

  // Hair cap sitting on top of the head.
  g.fillStyle(Color.hair, 1);
  g.fillRoundedRect(7, 2, 14, 7, { tl: 4, tr: 4, bl: 0, br: 0 });

  // Eye on the right side signals the facing-right baseline.
  g.fillStyle(Color.ink, 1);
  g.fillCircle(17, 9, 1.5);
}

/** Rounded green slime blob with a glossy highlight, eyes, and a bottom rim shade for grounding. */
function drawSlime(g: Phaser.GameObjects.Graphics, w: number, h: number): void {
  const cx = w / 2;

  // Darker base ellipse, filling the texture, so a rim of shade shows along the bottom.
  g.fillStyle(Color.slimeShade, 1);
  g.fillEllipse(cx, h - 11, w, h - 2);

  // Body, nudged up 1px to reveal the shade below it.
  g.fillStyle(Color.slimeBody, 1);
  g.fillEllipse(cx, h - 12, w - 2, h - 5);

  // Glossy highlight, upper-left.
  g.fillStyle(Color.slimeGloss, 0.85);
  g.fillEllipse(10, 8, 8, 5);

  // Eyes (pupils shifted right to match a rightward gaze).
  g.fillStyle(0xffffff, 1);
  g.fillCircle(11, 12, 2.6);
  g.fillCircle(20, 12, 2.6);
  g.fillStyle(Color.ink, 1);
  g.fillCircle(11.6, 12.4, 1.2);
  g.fillCircle(20.6, 12.4, 1.2);

  // Tiny mouth.
  g.fillRect(13, 17, 4, 1.2);
}

/** A 16x16 diamond. Shared by the common and legendary gems with different colorways. */
function drawDiamond(
  g: Phaser.GameObjects.Graphics,
  body: number,
  facet: number,
  outline: number,
): void {
  const pts = [
    { x: 8, y: 1 },
    { x: 15, y: 8 },
    { x: 8, y: 15 },
    { x: 1, y: 8 },
  ];

  g.fillStyle(body, 1);
  g.fillPoints(pts, true);

  // Upper-left facet to fake a lit edge.
  g.fillStyle(facet, 0.9);
  g.fillTriangle(8, 1, 1, 8, 8, 8);

  g.lineStyle(1, outline, 1);
  g.strokePoints(pts, true);
}

/** Generate every placeholder texture into the scene's Texture Manager. Safe to call repeatedly. */
export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  bake(scene, TextureKeys.TileGrass, (g, w, h) =>
    drawGrass(g, w, h, Color.grassBase, Color.grassSpeckDark, Color.grassSpeckLight),
  );
  bake(scene, TextureKeys.TileGrassAlt, (g, w, h) =>
    drawGrass(g, w, h, Color.grassAltBase, Color.grassAltSpeckDark, Color.grassAltSpeckLight),
  );

  bake(scene, TextureKeys.PlayerWarrior, (g) => drawWarrior(g));

  bake(scene, TextureKeys.MobSlime, (g, w, h) => drawSlime(g, w, h));

  bake(scene, TextureKeys.LootGem, (g) =>
    drawDiamond(g, Color.gemBody, Color.gemFacet, Color.gemOutline),
  );

  bake(scene, TextureKeys.LootGemLegendary, (g) => {
    // Bright green glow ring first (behind the gem): a soft halo plus a crisp inner ring.
    g.lineStyle(3, Color.legendaryGlow, 0.3);
    g.strokeCircle(8, 8, 7);
    g.lineStyle(1.5, Color.legendaryGlow, 0.95);
    g.strokeCircle(8, 8, 6);
    drawDiamond(g, Color.legendaryBody, Color.legendaryFacet, Color.legendaryOutline);
  });

  bake(scene, TextureKeys.Shadow, (g, w, h) => {
    g.fillStyle(0x000000, 0.28);
    g.fillEllipse(w / 2, h / 2, w - 2, h - 1);
  });
}
