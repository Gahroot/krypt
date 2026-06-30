import Phaser from "phaser";

/**
 * Art registry for CryptoMaple.
 *
 * The visuals are **real, open-licensed (CC0) 2D platformer art** sourced from Kenney
 * ("Platformer Pack Redux" + "Background Elements Redux"). The raw packs are cropped/resized into
 * small, game-ready frames under `src/assets/` by `scripts/build-assets.py`; at runtime those files
 * are loaded as plain images and registered under the stable texture keys below. See
 * `src/assets/CREDITS.md` for the full source + license list. Zero Nexon/MapleStory assets ship.
 *
 * Contract: scenes reference textures **by key** (the `TextureKeys` map and the per-appearance /
 * mob animation keys). Those keys are stable — you can swap the underlying art (regenerate
 * `src/assets`) without touching any scene. `queueTextureLoads()` is called from PreloadScene's
 * `preload()`; `generatePlaceholderTextures()` then bakes the single remaining procedural primitive
 * (the soft drop shadow) during `create()`.
 */

/** Canonical texture keys. Import these instead of hard-coding strings in scenes. */
export const TextureKeys = {
  TileGrass: "tile_grass",
  TileGrassAlt: "tile_grass_alt",
  PlayerWarrior: "player_warrior",
  WarriorIdle0: "warrior_idle_0",
  WarriorIdle1: "warrior_idle_1",
  WarriorWalk0: "warrior_walk_0",
  WarriorWalk1: "warrior_walk_1",
  WarriorWalk2: "warrior_walk_2",
  WarriorWalk3: "warrior_walk_3",
  WarriorJump: "warrior_jump",
  WarriorFall: "warrior_fall",
  WarriorClimb0: "warrior_climb_0",
  WarriorClimb1: "warrior_climb_1",
  WarriorAttack0: "warrior_attack_0",
  WarriorAttack1: "warrior_attack_1",
  MobSlime0: "mob_slime_0",
  MobSlime1: "mob_slime_1",
  MobSlime2: "mob_slime_2",
  MobSlime3: "mob_slime_3",
  MobHopper0: "mob_hopper_0",
  MobHopper1: "mob_hopper_1",
  MobHopper2: "mob_hopper_2",
  MobHopper3: "mob_hopper_3",
  LootGem: "loot_gem",
  LootGemLegendary: "loot_gem_legendary",
  Shadow: "shadow",
  TerrainGrassTop: "terrain_grass_top",
  TerrainDirt: "terrain_dirt",
  LadderWood: "ladder_wood",
  LadderRope: "ladder_rope",
  ParallaxSky: "parallax_sky",
  ParallaxHills: "parallax_hills",
  ParallaxTrees: "parallax_trees",
  NpcGuideIris: "npc_guide_iris",
  NpcFerryCole: "npc_ferry_cole",
  NpcStorageKeep: "npc_storage_keep",
  NpcElderWillow: "npc_elder_willow",
  NpcMerchantBram: "npc_merchant_bram",
  NpcSenseiTanren: "npc_sensei_tanren",
  NpcCrystalKeeperLuna: "npc_crystal_keeper_luna",
  NpcPortrait: "npc_portrait",
} as const;

export type TextureKey = (typeof TextureKeys)[keyof typeof TextureKeys];

/** Ground tile edge length — handy for tilemap math. The grass/dirt tiles are square 32px. */
export const TILE_SIZE = 32;

// ─── Asset URL resolution (Vite) ──────────────────────────────────────────────
// Eagerly import every PNG under src/assets as a hashed, bundled URL. Keyed by the path relative
// to this module, e.g. "../assets/characters/green_idle_0.png".
const ASSET_URLS = import.meta.glob("../assets/**/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Resolve an asset path (relative to src/assets) to its bundled URL, or throw if missing. */
function assetUrl(rel: string): string {
  const u = ASSET_URLS[`../assets/${rel}`];
  if (!u) throw new Error(`[textures] missing asset: src/assets/${rel}`);
  return u;
}

// ─── Player colours / appearance ──────────────────────────────────────────────

/** The five Kenney alien colourways used as player/NPC skins. */
const PLAYER_COLORS = ["green", "blue", "pink", "beige", "yellow"] as const;
type PlayerColor = (typeof PLAYER_COLORS)[number];

/** Canonical per-character frame names (one PNG each, per colour). */
const PLAYER_FRAMES = [
  "idle_0",
  "idle_1",
  "walk_0",
  "walk_1",
  "walk_2",
  "walk_3",
  "jump",
  "fall",
  "climb_0",
  "climb_1",
  "attack_0",
  "attack_1",
] as const;

/** Minimal appearance shape — the 5 fields the renderer reads. */
export interface AppearanceParams {
  skinId: string;
  hairId: string;
  hairColorId: string;
  faceId: string;
  outfitId: string;
}

/** Outfit → alien colourway. Different outfits read as visibly different characters. */
const OUTFIT_COLOR: Record<string, PlayerColor> = {
  outfit_tunic: "blue",
  outfit_robe: "pink",
  outfit_vest: "green",
  outfit_dress: "yellow",
};

function colorForAppearance(a: AppearanceParams): PlayerColor {
  return OUTFIT_COLOR[a.outfitId] ?? "beige";
}

/** Unique prefix for texture/animation keys of a given appearance (one per colourway). */
export function appearancePrefix(a: AppearanceParams): string {
  return `pc_${colorForAppearance(a)}`;
}

/** Animation key for a specific animation type of a given appearance. */
export function appearanceAnimKey(a: AppearanceParams, animType: string): string {
  return `${appearancePrefix(a)}_${animType}`;
}

/** Texture key for a specific frame of a given appearance. */
export function appearanceTextureKey(a: AppearanceParams, frameName: string): string {
  return `${appearancePrefix(a)}_${frameName}`;
}

// ─── Static texture-key → asset-file map ───────────────────────────────────────
// Everything except the procedural Shadow and the per-colour player frames.
const FILE_TEXTURES: Record<string, string> = {
  [TextureKeys.TileGrass]: "tiles/grass_top.png",
  [TextureKeys.TileGrassAlt]: "tiles/grass_center.png",
  [TextureKeys.TerrainGrassTop]: "tiles/grass_top.png",
  [TextureKeys.TerrainDirt]: "tiles/dirt.png",
  [TextureKeys.LadderWood]: "tiles/ladder.png",
  [TextureKeys.LadderRope]: "tiles/rope.png",

  // Legacy single-frame "warrior" keys (used as fallbacks + by WarriorAnimDefs) → green alien.
  [TextureKeys.PlayerWarrior]: "characters/green_idle_0.png",
  [TextureKeys.WarriorIdle0]: "characters/green_idle_0.png",
  [TextureKeys.WarriorIdle1]: "characters/green_idle_1.png",
  [TextureKeys.WarriorWalk0]: "characters/green_walk_0.png",
  [TextureKeys.WarriorWalk1]: "characters/green_walk_1.png",
  [TextureKeys.WarriorWalk2]: "characters/green_walk_2.png",
  [TextureKeys.WarriorWalk3]: "characters/green_walk_3.png",
  [TextureKeys.WarriorJump]: "characters/green_jump.png",
  [TextureKeys.WarriorFall]: "characters/green_fall.png",
  [TextureKeys.WarriorClimb0]: "characters/green_climb_0.png",
  [TextureKeys.WarriorClimb1]: "characters/green_climb_1.png",
  [TextureKeys.WarriorAttack0]: "characters/green_attack_0.png",
  [TextureKeys.WarriorAttack1]: "characters/green_attack_1.png",

  [TextureKeys.MobSlime0]: "mobs/slime_0.png",
  [TextureKeys.MobSlime1]: "mobs/slime_1.png",
  [TextureKeys.MobSlime2]: "mobs/slime_2.png",
  [TextureKeys.MobSlime3]: "mobs/slime_3.png",
  [TextureKeys.MobHopper0]: "mobs/hopper_0.png",
  [TextureKeys.MobHopper1]: "mobs/hopper_1.png",
  [TextureKeys.MobHopper2]: "mobs/hopper_2.png",
  [TextureKeys.MobHopper3]: "mobs/hopper_3.png",

  [TextureKeys.LootGem]: "items/gem.png",
  [TextureKeys.LootGemLegendary]: "items/gem_legendary.png",

  [TextureKeys.ParallaxSky]: "bg/sky.png",
  [TextureKeys.ParallaxHills]: "bg/hills.png",
  [TextureKeys.ParallaxTrees]: "bg/trees.png",

  [TextureKeys.NpcGuideIris]: "npc/guide_iris.png",
  [TextureKeys.NpcFerryCole]: "npc/ferrymaster_cole.png",
  [TextureKeys.NpcStorageKeep]: "npc/storage_keep.png",
  [TextureKeys.NpcElderWillow]: "npc/elder_willow.png",
  [TextureKeys.NpcMerchantBram]: "npc/merchant_bram.png",
  [TextureKeys.NpcSenseiTanren]: "npc/sensei_tanren.png",
  [TextureKeys.NpcCrystalKeeperLuna]: "npc/crystal_keeper_luna.png",
  [TextureKeys.NpcPortrait]: "npc/portrait.png",
};

/**
 * Queue every image load for the game. Call from PreloadScene.preload() so Phaser's loader handles
 * progress + completion before the first scene starts.
 */
export function queueTextureLoads(scene: Phaser.Scene): void {
  for (const [key, rel] of Object.entries(FILE_TEXTURES)) {
    if (!scene.textures.exists(key)) scene.load.image(key, assetUrl(rel));
  }
  // Per-colour player frames (drive ensureAppearanceTextures animations).
  for (const color of PLAYER_COLORS) {
    for (const frame of PLAYER_FRAMES) {
      const key = `pc_${color}_${frame}`;
      if (!scene.textures.exists(key)) {
        scene.load.image(key, assetUrl(`characters/${color}_${frame}.png`));
      }
    }
  }
}

// ─── Warrior animation definitions ───────────────────────────────────────────

/** A single animation definition: key, frame texture keys, frame-rate, and repeat count. */
export interface WarriorAnimDef {
  key: string;
  frames: readonly string[];
  frameRate: number;
  repeat: number;
}

/** All warrior animations. Feed these into `Phaser.Animations.create()` once at scene boot. */
export const WarriorAnimDefs: readonly WarriorAnimDef[] = [
  {
    key: "warrior_idle",
    frames: [TextureKeys.WarriorIdle0, TextureKeys.WarriorIdle1],
    frameRate: 1.5,
    repeat: -1,
  },
  {
    key: "warrior_walk",
    frames: [
      TextureKeys.WarriorWalk0,
      TextureKeys.WarriorWalk1,
      TextureKeys.WarriorWalk2,
      TextureKeys.WarriorWalk3,
    ],
    frameRate: 8,
    repeat: -1,
  },
  { key: "warrior_jump", frames: [TextureKeys.WarriorJump], frameRate: 1, repeat: 0 },
  { key: "warrior_fall", frames: [TextureKeys.WarriorFall], frameRate: 1, repeat: 0 },
  {
    key: "warrior_climb",
    frames: [TextureKeys.WarriorClimb0, TextureKeys.WarriorClimb1],
    frameRate: 3,
    repeat: -1,
  },
  {
    key: "warrior_attack",
    frames: [TextureKeys.WarriorAttack0, TextureKeys.WarriorAttack1],
    frameRate: 10,
    repeat: 0,
  },
];

// ─── Mob animation definitions ───────────────────────────────────────────────

export interface MobAnimDef {
  key: string;
  frames: readonly string[];
  frameRate: number;
  repeat: number;
}

export const MobAnimDefs: readonly MobAnimDef[] = [
  {
    key: "mob_slime_idle",
    frames: [
      TextureKeys.MobSlime0,
      TextureKeys.MobSlime1,
      TextureKeys.MobSlime2,
      TextureKeys.MobSlime3,
    ],
    frameRate: 4,
    repeat: -1,
  },
  {
    key: "mob_hopper_idle",
    frames: [
      TextureKeys.MobHopper0,
      TextureKeys.MobHopper1,
      TextureKeys.MobHopper2,
      TextureKeys.MobHopper3,
    ],
    frameRate: 5,
    repeat: -1,
  },
];

/** Map from server mobId → mob animation key. Falls back to `mob_slime_idle` for unknowns. */
export function mobAnimKey(mobId: string): string {
  if (mobId === "mob.thornback_hopper") return "mob_hopper_idle";
  return "mob_slime_idle";
}

/** Map from server mobId → first-frame texture key for the sprite constructor. */
export function mobTextureKey(mobId: string): TextureKey {
  if (mobId === "mob.thornback_hopper") return TextureKeys.MobHopper0;
  return TextureKeys.MobSlime0;
}

// ─── Per-appearance player animations ──────────────────────────────────────────

/**
 * Register the six player animations for a given appearance. The frame textures themselves are
 * loaded up-front in PreloadScene (one set per colourway), so this only needs to wire up the
 * Animations the first time a given colourway is seen. Idempotent.
 */
export function ensureAppearanceTextures(scene: Phaser.Scene, a: AppearanceParams): void {
  const prefix = appearancePrefix(a);
  if (scene.anims.exists(`${prefix}_idle`)) return;

  const defs: { key: string; frames: string[]; frameRate: number; repeat: number }[] = [
    {
      key: `${prefix}_idle`,
      frames: [`${prefix}_idle_0`, `${prefix}_idle_1`],
      frameRate: 1.5,
      repeat: -1,
    },
    {
      key: `${prefix}_walk`,
      frames: [`${prefix}_walk_0`, `${prefix}_walk_1`, `${prefix}_walk_2`, `${prefix}_walk_3`],
      frameRate: 8,
      repeat: -1,
    },
    { key: `${prefix}_jump`, frames: [`${prefix}_jump`], frameRate: 1, repeat: 0 },
    { key: `${prefix}_fall`, frames: [`${prefix}_fall`], frameRate: 1, repeat: 0 },
    {
      key: `${prefix}_climb`,
      frames: [`${prefix}_climb_0`, `${prefix}_climb_1`],
      frameRate: 3,
      repeat: -1,
    },
    {
      key: `${prefix}_attack`,
      frames: [`${prefix}_attack_0`, `${prefix}_attack_1`],
      frameRate: 10,
      repeat: 0,
    },
  ];

  for (const def of defs) {
    if (scene.anims.exists(def.key)) continue;
    // Only include frames whose textures actually loaded (defensive — they always should).
    const frames = def.frames.filter((f) => scene.textures.exists(f)).map((f) => ({ key: f }));
    if (frames.length === 0) continue;
    scene.anims.create({ key: def.key, frames, frameRate: def.frameRate, repeat: def.repeat });
  }
}

// ─── Remaining procedural primitive: the soft drop shadow ──────────────────────

/**
 * Bake the one texture that has no art asset: a soft elliptical drop shadow drawn under sprites.
 * Idempotent. Called from PreloadScene.create() after the image loads complete.
 */
export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  const key = TextureKeys.Shadow;
  if (scene.textures.exists(key)) return;
  const w = 24;
  const h = 8;
  const g = scene.make.graphics();
  g.fillStyle(0x000000, 0.28);
  g.fillEllipse(w / 2, h / 2, w - 2, h - 1);
  g.generateTexture(key, w, h);
  g.destroy();
}
