import Phaser from "phaser";
import type { BiomeVisualSet, Element } from "@maple/shared";

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
  // Per-family mob frames (distinct silhouettes per mob family).
  for (const [family, frameCount] of Object.entries(MOB_FAMILY_FRAMES)) {
    for (let i = 0; i < frameCount; i++) {
      const key = mobFrameKey(family, i);
      if (!scene.textures.exists(key)) {
        scene.load.image(key, assetUrl(`mobs/fam_${family}_${i}.png`));
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

// ── Per-family mob sprites ────────────────────────────────────────────────
// Each mob family has a distinct silhouette (blob, beetle, bat, beast, golem,
// serpent, jelly, fish, elemental, wraith, humanoid, shroom, snail, crab, …).
// Frames live at `src/assets/mobs/fam_<family>_<i>.png`; the count per family:
const MOB_FAMILY_FRAMES: Record<string, number> = {
  blob: 3,
  beetle: 3,
  beetle_blue: 2,
  bat: 3,
  beast: 2,
  elemental: 3,
  shroom: 2,
  golem: 1,
  wraith: 1,
  serpent: 1,
  jelly: 1,
  fish: 1,
  humanoid: 1,
  eyeball: 1,
  crab: 1,
  wisp: 1,
  snail: 1,
  knight: 1,
  plant: 1,
} as const;

/** Texture key for a family frame. */
function mobFrameKey(family: string, i: number): string {
  return `fam_${family}_${i}`;
}

/** Animation key for a family idle loop. */
function mobFamilyAnimKey(family: string): string {
  return `mob_${family}_idle`;
}

/** Idle-loop anim def for every family (single-frame families become a 1-frame anim). */
const FAMILY_ANIM_DEFS: readonly MobAnimDef[] = Object.entries(MOB_FAMILY_FRAMES).map(
  ([family, count]) => ({
    key: mobFamilyAnimKey(family),
    frames: Array.from({ length: count }, (_, i) => mobFrameKey(family, i)),
    frameRate: count > 2 ? 4 : 3,
    repeat: -1,
  }),
);

export const MobAnimDefs: readonly MobAnimDef[] = [
  // Legacy slime/hopper (kept as ultimate fallbacks).
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
  ...FAMILY_ANIM_DEFS,
];

/**
 * Explicit mobId → family overrides where keyword inference would pick wrong,
 * or to add variety (e.g. neon insects → the blue beetle variant).
 */
const MOB_FAMILY_OVERRIDE: Record<string, string> = {
  "mob.neon_spider": "beetle_blue",
  "mob.fang_beetle": "beetle_blue",
  "mob.tempest_lord": "elemental",
  "mob.pyroclasm": "elemental",
  "mob.kraken": "serpent",
  "mob.thornback_hopper": "beetle",
};

/** Resolve a server mobId to its sprite family via overrides → keyword → blob. */
export function mobFamily(mobId: string): string {
  const override = MOB_FAMILY_OVERRIDE[mobId];
  if (override) return override;
  const id = mobId.replace(/^mob\./, "");
  const has = (...ks: string[]) => ks.some((k) => id.includes(k));
  if (has("snail")) return "snail";
  if (has("crab")) return "crab";
  if (has("jelly")) return "jelly";
  if (has("eye")) return "eyeball";
  if (has("fish", "shark", "angler", "puffer", "urchin")) return "fish";
  if (has("bat", "moth", "gull", "hawk", "crow")) return "bat";
  if (has("serpent", "wyrm", "drake", "viper", "dragon")) return "serpent";
  if (has("sentinel")) return "knight";
  if (has("wraith", "banshee", "ghost", "specter", "revenant", "horror")) return "wraith";
  if (has("golem", "guardian", "boulder", "turtle", "shard", "crystal")) return "golem";
  if (has("wisp", "sprite", "elemental", "drone", "spark")) return "elemental";
  if (has("beetle", "spider", "bug")) return "beetle";
  if (has("shroom", "mushroom", "root", "vine", "bark", "lasher", "plant")) return "shroom";
  if (has("thug", "stalker", "overseer", "skeleton", "knight")) return "humanoid";
  if (has("rat", "wolf", "lizard", "bunny", "crawler")) return "beast";
  return "blob";
}

/** True when a mob resolves to a distinct, pre-coloured family sprite. */
function hasFamilySprite(mobId: string): boolean {
  return MOB_FAMILY_FRAMES[mobFamily(mobId)] !== undefined;
}

/** Map from server mobId → mob animation key. */
export function mobAnimKey(mobId: string): string {
  return mobFamilyAnimKey(mobFamily(mobId));
}

/** Map from server mobId → first-frame texture key for the sprite constructor. */
export function mobTextureKey(mobId: string): string {
  return mobFrameKey(mobFamily(mobId), 0);
}

// ─── Per-mob tint + scale (zone-based visual differentiation) ─────────────────

/**
 * Per-zone base tints so mobs in different regions are visually distinct.
 * Mobs within a zone share a color family; elemental variants shift the hue.
 * Boss mobs get unique dramatic tints via MOB_BOSS_TINTS.
 */
const ZONE_TINT: Record<BiomeVisualSet, number> = {
  pastoral: 0xb8e080, // soft green (Dawn Isle / Harbor / Meadowfield)
  forest: 0x408840, // deep forest green (Sylvanreach)
  rocky: 0xc4a070, // stone brown (Craghold)
  urban: 0x9070b0, // neon purple (Dusk Ward)
  swamp: 0x708050, // murky green (Mirefen)
  sky: 0x80b8e0, // sky blue (Skyhaven)
  snow: 0xb0d0e8, // ice blue (Frosthold)
  underground: 0x605080, // deep purple (subway / icecave)
  underwater: 0x5080a0, // ocean teal (Tideways)
  jungle: 0xc06030, // fire orange (Drakemoor)
  market: 0xb89a5a, // golden sand (Free Market)
};

/** Elemental hue-shifts applied on top of the zone base tint. */
const ELEMENT_TINT: Partial<Record<Element, number>> = {
  FIRE: 0xff6040,
  ICE: 0x80c8f0,
  LIGHTNING: 0xf0d040,
  POISON: 0x80cc44,
  HOLY: 0xfff0c0,
  DARK: 0x8060a0,
};

/** Explicit per-mob tint overrides for key mobs that need special treatment. */
const MOB_TINT_OVERRIDES: Partial<Record<string, number>> = {
  // Dawn Isle — keep snails/puffs naturally green
  "mob.friendly_snail": 0xa8d878,
  "mob.green_puff": 0x88cc44,
  "mob.dawn_shroom": 0xd4a040,
  // Harbor — sandy/brown tones
  "mob.dock_rat": 0xb89070,
  "mob.barnacle_crab": 0xc8a080,
  "mob.harbor_gull": 0xd0c8b8,
  "mob.deckhand_specter": 0x8878a0,
  "mob.bilge_rat": 0xa08060,
  // Meadowfield — meadow greens + autumn tones
  "mob.meadow_slime": 0x90cc60,
  "mob.green_mushroom": 0x60a840,
  "mob.meadow_beetle": 0xb09840,
  "mob.crow": 0x505060,
  "mob.feral_bunny": 0xc8a888,
  "mob.mushroom": 0xc88840,
  // Craghold — stone/earth
  "mob.rock_lizard": 0xb89060,
  "mob.fossil_beetle": 0xa89878,
  "mob.cliff_hawk": 0xc8b898,
  "mob.quarry_crab": 0xb09060,
  "mob.boulder_golem": 0x907858,
  // Sylvanreach — forest greens
  "mob.forest_wisp": 0x70c890,
  "mob.canopy_moth": 0x80a060,
  "mob.bark_spider": 0x607040,
  "mob.root_crawler": 0x705830,
  "mob.sylvan_sprite": 0x88d0a0,
  // Dusk Ward — neon/cyber
  "mob.neon_rat": 0xb060c0,
  "mob.tunnel_bat": 0x7060a0,
  "mob.spark_drone": 0xe0c040,
  "mob.rail_sentinel": 0x808090,
  "mob.shadow_thug": 0x604880,
  "mob.neon_spider": 0xc040a0,
  "mob.arc_wraith": 0x9070d0,
  // Subway PQ — deep underground
  "mob.subway_horror": 0x704878,
  "mob.subway_stalker": 0x605070,
  "mob.subway_overseer": 0x8060a0,
  // Mirefen — swamp murk
  "mob.bog_lurker": 0x607840,
  "mob.mire_toad": 0x708050,
  "mob.ruins_sentinel": 0x887860,
  "mob.moss_wraith": 0x508030,
  "mob.ruins_horror": 0x605848,
  "mob.deep_swamp_thing": 0x506830,
  // Skyhaven — sky/air
  "mob.wind_sprite": 0xa0d0f0,
  "mob.sky_serpent": 0x70b0d8,
  "mob.thunder_hawk": 0xc8b870,
  // Frosthold Slopes — ice/snow
  "mob.frost_wolf": 0xa0c8e0,
  "mob.ice_elemental": 0x88b8d8,
  "mob.snow_wraith": 0xc0d8f0,
  // Frosthold Icecave — deep ice
  "mob.frost_crawler": 0x7098b8,
  "mob.crystal_guardian": 0x90b0d0,
  "mob.glacial_shard": 0xb0d0e8,
  "mob.permafrost_revenant": 0x8098b0,
  "mob.frost_banshee": 0xa0c0e0,
  // Tideways — underwater
  "mob.reef_jellyfish": 0x60a0c0,
  "mob.sea_urchin": 0x507888,
  "mob.pufferfish": 0x80b8a0,
  "mob.anglerfish": 0x406878,
  "mob.tiger_shark": 0x608898,
  "mob.sea_serpent": 0x4878a0,
  // Drakemoor — fire/jungle
  "mob.jungle_viper": 0x80a030,
  "mob.fang_beetle": 0xa08830,
  "mob.dragon_skeleton": 0xd04020,
  "mob.vine_wraith": 0x608830,
  "mob.crimson_drake": 0xe03020,
  "mob.ember_turtle": 0xc05020,
  "mob.shadow_wyrm": 0x604080,
  "mob.firedrake_broodling": 0xd04820,
};

/** Boss-specific tints — dramatic and unmistakable. */
const MOB_BOSS_TINTS: Partial<Record<string, number>> = {
  "mob.subway_curse_eye": 0xa040c0,
  "mob.bogmaw": 0x608030,
  "mob.tempest_lord": 0xe0d060,
  "mob.glacius_prime": 0xd0e8ff,
  "mob.glacial_abomination": 0x90b8d8,
  "mob.kraken": 0x4070a0,
  "mob.pyroclasm": 0xe03010,
};

/** Per-mob scale overrides. Bosses are larger; wisps/drones are smaller. */
const MOB_SCALE_OVERRIDES: Partial<Record<string, number>> = {
  // Bosses — dramatic scale
  "mob.subway_curse_eye": 1.6,
  "mob.bogmaw": 1.6,
  "mob.tempest_lord": 1.8,
  "mob.glacius_prime": 1.8,
  "mob.glacial_abomination": 1.8,
  "mob.kraken": 1.8,
  "mob.pyroclasm": 2.0,
  // Large mobs
  "mob.boulder_golem": 1.3,
  "mob.quarry_crab": 1.2,
  "mob.ruins_sentinel": 1.2,
  "mob.subway_overseer": 1.2,
  "mob.deep_swamp_thing": 1.3,
  "mob.glacial_shard": 1.2,
  "mob.crystal_guardian": 1.3,
  "mob.permafrost_revenant": 1.2,
  "mob.tiger_shark": 1.3,
  "mob.sea_serpent": 1.4,
  "mob.fang_beetle": 1.2,
  "mob.crimson_drake": 1.4,
  "mob.ember_turtle": 1.3,
  "mob.shadow_wyrm": 1.4,
  // Small mobs
  "mob.forest_wisp": 0.85,
  "mob.sylvan_sprite": 0.85,
  "mob.wind_sprite": 0.85,
  "mob.spark_drone": 0.85,
  "mob.friendly_snail": 0.8,
  "mob.green_puff": 0.85,
};

/** No-op tint (Phaser multiply identity) — lets a sprite's own colours show through. */
const NO_TINT = 0xffffff;

/** Resolve the tint colour for a mob based on its zone + element + overrides. */
export function mobTint(mobId: string, biome?: BiomeVisualSet, element?: Element): number {
  // Boss override takes priority — dramatic recolour is intentional for bosses.
  if (MOB_BOSS_TINTS[mobId] !== undefined) return MOB_BOSS_TINTS[mobId]!;
  // Distinct family sprites are already coloured; don't multiply-tint them into mud.
  if (hasFamilySprite(mobId)) return NO_TINT;
  // Explicit mob override takes priority over zone/element.
  if (MOB_TINT_OVERRIDES[mobId] !== undefined) return MOB_TINT_OVERRIDES[mobId]!;
  // Zone base tint + element shift.
  const base = ZONE_TINT[biome ?? "pastoral"];
  if (element && ELEMENT_TINT[element] !== undefined) {
    // Blend 60% zone base + 40% element tint for recognisable zone colour.
    return blendTints(base, ELEMENT_TINT[element]!, 0.6, 0.4);
  }
  return base;
}

/** Resolve the display scale for a mob (1.0 = default). */
export function mobScale(mobId: string): number {
  return MOB_SCALE_OVERRIDES[mobId] ?? 1.0;
}

/** Simple additive colour blend (no alpha — Phaser tint is opaque). */
function blendTints(a: number, b: number, aWeight: number, bWeight: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar * aWeight + br * bWeight);
  const g = Math.round(ag * aWeight + bg * bWeight);
  const blue = Math.round(ab * aWeight + bb * bWeight);
  return (r << 16) | (g << 8) | blue;
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

// ─── Biome visual palettes ──────────────────────────────────────────────────

/** Per-biome color palette for parallax backgrounds and terrain rendering. */
export interface BiomePalette {
  skyTop: number;
  skyBottom: number;
  hillColor: number;
  treeColor: number;
  surfaceColor: number;
  bodyColor: number;
  bandColor: number;
  speckleColor: number;
  bladeColor: number;
  outlineColor: number;
  /** Whether to stamp the CC0 grass/dirt tile overlay on terrain. */
  useTileOverlay: boolean;
}

const BIOME_PALETTES: Record<BiomeVisualSet, BiomePalette> = {
  pastoral: {
    skyTop: 0x4a90d9,
    skyBottom: 0x87ceeb,
    hillColor: 0x3a6b3a,
    treeColor: 0x2d5a2d,
    surfaceColor: 0x72b540,
    bodyColor: 0x9b7642,
    bandColor: 0x7a5c30,
    speckleColor: 0x6b5230,
    bladeColor: 0x5ea035,
    outlineColor: 0x5a3d1e,
    useTileOverlay: true,
  },
  forest: {
    skyTop: 0x2a5a2a,
    skyBottom: 0x3d7a3d,
    hillColor: 0x1a3a1a,
    treeColor: 0x0f2a0f,
    surfaceColor: 0x4a8a2a,
    bodyColor: 0x6b4a2a,
    bandColor: 0x5a3a20,
    speckleColor: 0x4a3018,
    bladeColor: 0x3a7020,
    outlineColor: 0x2a1a0a,
    useTileOverlay: true,
  },
  rocky: {
    skyTop: 0xc4a06a,
    skyBottom: 0xd4b88a,
    hillColor: 0x8a6a4a,
    treeColor: 0x6a5040,
    surfaceColor: 0xb89a6a,
    bodyColor: 0x8a7050,
    bandColor: 0x7a6040,
    speckleColor: 0x6a5030,
    bladeColor: 0xa88a5a,
    outlineColor: 0x5a4028,
    useTileOverlay: false,
  },
  urban: {
    skyTop: 0x1a1a2e,
    skyBottom: 0x2a2a3e,
    hillColor: 0x15152a,
    treeColor: 0x101020,
    surfaceColor: 0x3a3a4a,
    bodyColor: 0x2a2a3a,
    bandColor: 0x1a1a2a,
    speckleColor: 0x4a4a5a,
    bladeColor: 0x00ccff,
    outlineColor: 0x0a0a1a,
    useTileOverlay: false,
  },
  swamp: {
    skyTop: 0x3a4a2a,
    skyBottom: 0x5a6a4a,
    hillColor: 0x2a3a1a,
    treeColor: 0x1a2a0f,
    surfaceColor: 0x5a6a3a,
    bodyColor: 0x4a3a2a,
    bandColor: 0x3a2a1a,
    speckleColor: 0x3a2a10,
    bladeColor: 0x4a5a2a,
    outlineColor: 0x2a1a0a,
    useTileOverlay: false,
  },
  market: {
    skyTop: 0x6a4a2a,
    skyBottom: 0x8a6a4a,
    hillColor: 0x4a3a2a,
    treeColor: 0x3a2a1a,
    surfaceColor: 0xb89a5a,
    bodyColor: 0x8a7040,
    bandColor: 0x7a6030,
    speckleColor: 0x6a5028,
    bladeColor: 0xa88a4a,
    outlineColor: 0x4a3018,
    useTileOverlay: false,
  },
  sky: {
    skyTop: 0x2080d0,
    skyBottom: 0x80c0f0,
    hillColor: 0xb0d0e8,
    treeColor: 0xe0e8f0,
    surfaceColor: 0xd0dce8,
    bodyColor: 0xa0b0c8,
    bandColor: 0x8090a8,
    speckleColor: 0x708090,
    bladeColor: 0xc0d0e0,
    outlineColor: 0x607080,
    useTileOverlay: false,
  },
  snow: {
    skyTop: 0x4070a0,
    skyBottom: 0x80a8c8,
    hillColor: 0xd8e4f0,
    treeColor: 0xb0c8e0,
    surfaceColor: 0xe8f0f8,
    bodyColor: 0xb8c8d8,
    bandColor: 0x98a8b8,
    speckleColor: 0x8898a8,
    bladeColor: 0xd0e0f0,
    outlineColor: 0x7888a0,
    useTileOverlay: false,
  },
  underground: {
    skyTop: 0x0a0a14,
    skyBottom: 0x1a1a28,
    hillColor: 0x141420,
    treeColor: 0x0e0e1a,
    surfaceColor: 0x383848,
    bodyColor: 0x282838,
    bandColor: 0x181828,
    speckleColor: 0x101020,
    bladeColor: 0x2a2a3a,
    outlineColor: 0x08080f,
    useTileOverlay: false,
  },
  underwater: {
    skyTop: 0x0a2040,
    skyBottom: 0x1a4060,
    hillColor: 0x0a3050,
    treeColor: 0x082840,
    surfaceColor: 0x2a6080,
    bodyColor: 0x1a4060,
    bandColor: 0x0a3050,
    speckleColor: 0x082840,
    bladeColor: 0x2a5a70,
    outlineColor: 0x061828,
    useTileOverlay: false,
  },
  jungle: {
    skyTop: 0x1a4a1a,
    skyBottom: 0x2a6a2a,
    hillColor: 0x153515,
    treeColor: 0x0a2a0a,
    surfaceColor: 0x3a7a2a,
    bodyColor: 0x2a3a1a,
    bandColor: 0x1a2a10,
    speckleColor: 0x1a2010,
    bladeColor: 0x2a6a1a,
    outlineColor: 0x0a1a08,
    useTileOverlay: false,
  },
};

/** Resolve a biome visual set to its color palette. Defaults to pastoral. */
export function resolveBiomePalette(bgSet?: BiomeVisualSet): BiomePalette {
  return BIOME_PALETTES[bgSet ?? "pastoral"];
}

/** Centralized map-ID → biome-visual-set lookup. Covers all shipped maps. */
const BIOME_MAP: Record<string, BiomeVisualSet> = {
  dawn_isle: "pastoral",
  heartland_harbor: "pastoral",
  harbor_docks: "pastoral",
  crossway: "pastoral",
  meadowfield: "pastoral",
  sylvanreach: "forest",
  sylvanreach_canopy: "forest",
  sylvanreach_roots: "forest",
  craghold: "rocky",
  craghold_cliffs: "rocky",
  craghold_quarry: "rocky",
  dusk_ward: "urban",
  dusk_ward_subway: "underground",
  dusk_ward_backalley: "urban",
  mirefen: "swamp",
  mirefen_ruins: "swamp",
  free_market: "market",
  skyhaven: "sky",
  skyhaven_driftpeaks: "sky",
  frosthold: "snow",
  frosthold_slopes: "snow",
  frosthold_icecave: "underground",
  dusk_subway_pq_staging: "underground",
  dusk_subway_pq_stage1: "underground",
  dusk_subway_pq_stage2: "underground",
  dusk_subway_pq_stage3: "underground",
  dusk_subway_pq_stage4: "underground",
  tideways: "underwater",
  tideways_reef: "underwater",
  tideways_abyss: "underwater",
  drakemoor: "jungle",
  drakemoor_jungle_floor: "jungle",
  drakemoor_dragon_abyss: "jungle",
};

/** Resolve the biome visual set for a map, checking the explicit bgSet first. */
export function resolveBiomeSet(mapId: string, bgSet?: BiomeVisualSet): BiomeVisualSet {
  return bgSet ?? BIOME_MAP[mapId] ?? "pastoral";
}
