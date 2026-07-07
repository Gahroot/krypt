/**
 * Skill Effects — per-skill visual and audio metadata.
 *
 * This is the single source of truth for how each skill looks and sounds.
 * The server reads effectType to decide instant-hit vs. projectile spawning;
 * the client reads the rest to render distinct cast animations, projectiles,
 * particles, and SFX.
 */

export type EffectType =
  | "slash" // melee swing (warrior/thief/pirate close-combat)
  | "projectile" // travelling entity (arrows, bolts, blades, bullets)
  | "aoe-burst" // AoE centred on target area (ground slam, firestorm)
  | "buff-aura" // buff with a visible aura ring
  | "beam" // directed ray (holy light, arcane beam)
  | "dash" // forward lunge/dash attack
  | "circle"; // shockwave / ground circle (battle cry, tidal slam)

export type ParticleStyle =
  | "none"
  | "sparks"
  | "smoke"
  | "fire_trail"
  | "ice_shards"
  | "lightning_arcs"
  | "holy_sparkle"
  | "dark_wisps"
  | "wind_swirl"
  | "poison_bubbles"
  | "ocean_spray"
  | "blade_trail";

export interface SkillEffectDef {
  /** How the skill resolves visually/mechanically on the client. */
  readonly effectType: EffectType;
  /** Primary colour (hex) for particles, projectile fills, and glow. */
  readonly color: number;
  /** Secondary accent colour (hex) for outlines / highlights. */
  readonly colorAlt: number;
  /** Particle emitter style hint for the client. */
  readonly particleStyle: ParticleStyle;
  /** SFX key to play on cast (maps to AudioManager SFX_KEYS). */
  readonly sfxKey: string;
  /** Travel speed (px/tick) for projectiles. Only used when effectType === "projectile". */
  readonly projectileSpeed?: number;
  /** AoE radius (px) for aoe-burst / circle effects. */
  readonly aoeRadius?: number;
  /** Duration in ms for the cast animation before the skill resolves. */
  readonly castDurationMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Defaults by archetype + kind — used when a specific skill has no override.
// ═══════════════════════════════════════════════════════════════════════════════

const WARRIOR_MELEE: SkillEffectDef = {
  effectType: "slash",
  color: 0xfbbf24,
  colorAlt: 0xf59e0b,
  particleStyle: "sparks",
  sfxKey: "skill_slash",
  castDurationMs: 200,
};

const WARRIOR_AOE: SkillEffectDef = {
  effectType: "aoe-burst",
  color: 0xfbbf24,
  colorAlt: 0xd97706,
  particleStyle: "sparks",
  sfxKey: "skill_slash",
  aoeRadius: 80,
  castDurationMs: 250,
};

const WARRIOR_BUFF: SkillEffectDef = {
  effectType: "buff-aura",
  color: 0xfbbf24,
  colorAlt: 0xfef3c7,
  particleStyle: "wind_swirl",
  sfxKey: "skill_buff",
  castDurationMs: 300,
};

const MAGE_BOLT: SkillEffectDef = {
  effectType: "projectile",
  color: 0xa78bfa,
  colorAlt: 0xc4b5fd,
  particleStyle: "sparks",
  sfxKey: "skill_bolt",
  projectileSpeed: 4,
  castDurationMs: 150,
};

const MAGE_AOE: SkillEffectDef = {
  effectType: "aoe-burst",
  color: 0xf87171,
  colorAlt: 0xfca5a5,
  particleStyle: "fire_trail",
  sfxKey: "skill_fireball",
  aoeRadius: 100,
  castDurationMs: 300,
};

const MAGE_BEAM: SkillEffectDef = {
  effectType: "beam",
  color: 0xfde68a,
  colorAlt: 0xfef9c3,
  particleStyle: "holy_sparkle",
  sfxKey: "skill_beam",
  castDurationMs: 350,
};

const MAGE_BUFF: SkillEffectDef = {
  effectType: "buff-aura",
  color: 0x60a5fa,
  colorAlt: 0x93c5fd,
  particleStyle: "holy_sparkle",
  sfxKey: "skill_buff",
  castDurationMs: 300,
};

const ARCHER_ARROW: SkillEffectDef = {
  effectType: "projectile",
  color: 0x22c55e,
  colorAlt: 0x86efac,
  particleStyle: "wind_swirl",
  sfxKey: "skill_arrow",
  projectileSpeed: 5,
  castDurationMs: 120,
};

const ARCHER_BUFF: SkillEffectDef = {
  effectType: "buff-aura",
  color: 0x22c55e,
  colorAlt: 0xbbf7d0,
  particleStyle: "wind_swirl",
  sfxKey: "skill_buff",
  castDurationMs: 300,
};

const ARCHER_AOE: SkillEffectDef = {
  effectType: "aoe-burst",
  color: 0x22c55e,
  colorAlt: 0x4ade80,
  particleStyle: "wind_swirl",
  sfxKey: "skill_arrow",
  aoeRadius: 90,
  castDurationMs: 250,
};

const THIEF_MELEE: SkillEffectDef = {
  effectType: "slash",
  color: 0xa855f7,
  colorAlt: 0x7c3aed,
  particleStyle: "blade_trail",
  sfxKey: "skill_slash",
  castDurationMs: 180,
};

const THIEF_PROJECTILE: SkillEffectDef = {
  effectType: "projectile",
  color: 0xa855f7,
  colorAlt: 0xc084fc,
  particleStyle: "blade_trail",
  sfxKey: "skill_bolt",
  projectileSpeed: 4.5,
  castDurationMs: 150,
};

const THIEF_DASH: SkillEffectDef = {
  effectType: "dash",
  color: 0x6d28d9,
  colorAlt: 0x7c3aed,
  particleStyle: "dark_wisps",
  sfxKey: "skill_slash",
  castDurationMs: 200,
};

const THIEF_BUFF: SkillEffectDef = {
  effectType: "buff-aura",
  color: 0xa855f7,
  colorAlt: 0xddd6fe,
  particleStyle: "dark_wisps",
  sfxKey: "skill_buff",
  castDurationMs: 300,
};

const THIEF_AOE: SkillEffectDef = {
  effectType: "aoe-burst",
  color: 0xa855f7,
  colorAlt: 0x7c3aed,
  particleStyle: "blade_trail",
  sfxKey: "skill_slash",
  aoeRadius: 80,
  castDurationMs: 250,
};

const PIRATE_MELEE: SkillEffectDef = {
  effectType: "slash",
  color: 0xef4444,
  colorAlt: 0xfca5a5,
  particleStyle: "sparks",
  sfxKey: "skill_slash",
  castDurationMs: 200,
};

const PIRATE_DASH: SkillEffectDef = {
  effectType: "dash",
  color: 0x3b82f6,
  colorAlt: 0x93c5fd,
  particleStyle: "ocean_spray",
  sfxKey: "skill_slash",
  castDurationMs: 250,
};

const PIRATE_AOE: SkillEffectDef = {
  effectType: "circle",
  color: 0x3b82f6,
  colorAlt: 0x60a5fa,
  particleStyle: "ocean_spray",
  sfxKey: "skill_fireball",
  aoeRadius: 90,
  castDurationMs: 300,
};

const PIRATE_BUFF: SkillEffectDef = {
  effectType: "buff-aura",
  color: 0xef4444,
  colorAlt: 0xfde68a,
  particleStyle: "sparks",
  sfxKey: "skill_buff",
  castDurationMs: 300,
};

const PIRATE_GUNNER_SHOT: SkillEffectDef = {
  effectType: "projectile",
  color: 0xf97316,
  colorAlt: 0xfdba74,
  particleStyle: "fire_trail",
  sfxKey: "skill_bolt",
  projectileSpeed: 5.5,
  castDurationMs: 120,
};

const BEGINNER_MELEE: SkillEffectDef = {
  effectType: "slash",
  color: 0x9ca3af,
  colorAlt: 0xd1d5db,
  particleStyle: "sparks",
  sfxKey: "skill",
  castDurationMs: 200,
};

const BEGINNER_RANGED: SkillEffectDef = {
  effectType: "projectile",
  color: 0x9ca3af,
  colorAlt: 0xd1d5db,
  particleStyle: "sparks",
  sfxKey: "skill",
  projectileSpeed: 3.5,
  castDurationMs: 150,
};

const BEGINNER_BUFF: SkillEffectDef = {
  effectType: "buff-aura",
  color: 0x60a5fa,
  colorAlt: 0x93c5fd,
  particleStyle: "wind_swirl",
  sfxKey: "skill",
  castDurationMs: 300,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Per-skill overrides — keyed by skill id.
// Any skill NOT listed here falls back to its archetype default (getDefaultEffect).
// ═══════════════════════════════════════════════════════════════════════════════

const SKILL_EFFECTS: Record<string, SkillEffectDef> = {
  // ── BEGINNER ──────────────────────────────────────────────────────────────
  "beginner.thrown_shell": BEGINNER_RANGED,
  "beginner.nimble_strike": BEGINNER_MELEE,
  "beginner.nimble_feet": BEGINNER_BUFF,
  "beginner.recovery": BEGINNER_BUFF,

  // ── WARRIOR tier 1 ────────────────────────────────────────────────────────
  "warrior.crushing_blow": { ...WARRIOR_MELEE, sfxKey: "skill_slash" },
  "warrior.iron_hide": WARRIOR_BUFF,
  "warrior.rally": { ...WARRIOR_BUFF, color: 0xfef3c7, colorAlt: 0xfbbf24 },
  "warrior.battle_cry": {
    ...WARRIOR_AOE,
    effectType: "circle",
    aoeRadius: 70,
    sfxKey: "skill_fireball",
  },

  // Berserker
  "warrior.cleave": { ...WARRIOR_AOE, effectType: "aoe-burst", aoeRadius: 70 },
  "warrior.frenzy": WARRIOR_BUFF,
  "warrior.decimate": { ...WARRIOR_AOE, aoeRadius: 100, sfxKey: "skill_fireball" },
  "warrior.berserk": { ...WARRIOR_BUFF, color: 0xef4444, colorAlt: 0xfca5a5 },
  "warrior.annihilate": { ...WARRIOR_MELEE, castDurationMs: 300 },

  // Guardian
  "warrior.phalanx": { ...WARRIOR_MELEE, colorAlt: 0x93c5fd },
  "warrior.fortress": WARRIOR_BUFF,
  "warrior.bulwark": WARRIOR_BUFF,
  "warrior.holy_shield": {
    ...WARRIOR_BUFF,
    color: 0xfde68a,
    colorAlt: 0xfef9c3,
    particleStyle: "holy_sparkle",
  },
  "warrior.retribution": { ...WARRIOR_AOE, effectType: "circle" },
  "warrior.aegis": {
    ...WARRIOR_BUFF,
    color: 0xfde68a,
    colorAlt: 0xfef9c3,
    particleStyle: "holy_sparkle",
  },

  // Warlord
  "warrior.battle_standard": { ...WARRIOR_BUFF, aoeRadius: 80 },
  "warrior.onslaught": { ...WARRIOR_MELEE, castDurationMs: 250 },
  "warrior.hammer_smash": { ...WARRIOR_AOE, effectType: "circle", aoeRadius: 90 },
  "warrior.endurance": WARRIOR_BUFF,
  "warrior.siege_breaker": { ...WARRIOR_AOE, aoeRadius: 100, castDurationMs: 350 },

  // ── MAGE tier 1 ───────────────────────────────────────────────────────────
  "mage.arcane_bolt": { ...MAGE_BOLT, color: 0xa78bfa, sfxKey: "skill_bolt" },
  "mage.arcane_mastery": MAGE_BUFF,
  "mage.mana_surge": MAGE_BUFF,
  "mage.mending_light": { ...MAGE_BEAM, color: 0x60a5fa, sfxKey: "skill_beam" },

  // Pyromancer
  "mage.flame_lance": {
    ...MAGE_BOLT,
    color: 0xef4444,
    colorAlt: 0xfca5a5,
    particleStyle: "fire_trail",
    sfxKey: "skill_fireball",
  },
  "mage.immolate": { ...MAGE_AOE, aoeRadius: 80, sfxKey: "skill_fireball" },
  "mage.firestorm": {
    ...MAGE_AOE,
    aoeRadius: 120,
    particleStyle: "fire_trail",
    sfxKey: "skill_fireball",
  },
  "mage.inferno_aura": {
    ...MAGE_BUFF,
    color: 0xef4444,
    colorAlt: 0xfde68a,
    particleStyle: "fire_trail",
  },
  "mage.cataclysm": { ...MAGE_AOE, aoeRadius: 130, castDurationMs: 400, sfxKey: "skill_fireball" },

  // Glaciemancer
  "mage.frost_bolt": {
    ...MAGE_BOLT,
    color: 0x38bdf8,
    colorAlt: 0xbae6fd,
    particleStyle: "ice_shards",
    sfxKey: "skill_bolt",
  },
  "mage.chain_lightning": {
    ...MAGE_AOE,
    color: 0xfacc15,
    colorAlt: 0xfef08a,
    particleStyle: "lightning_arcs",
    sfxKey: "skill_beam",
    aoeRadius: 90,
  },
  "mage.blizzard": {
    ...MAGE_AOE,
    color: 0x38bdf8,
    colorAlt: 0xe0f2fe,
    particleStyle: "ice_shards",
    sfxKey: "skill_bolt",
    aoeRadius: 110,
  },
  "mage.thunder_shield": {
    ...MAGE_BUFF,
    color: 0xfacc15,
    colorAlt: 0xfef08a,
    particleStyle: "lightning_arcs",
  },
  "mage.absolute_zero": {
    ...MAGE_AOE,
    color: 0x38bdf8,
    colorAlt: 0xe0f2fe,
    particleStyle: "ice_shards",
    sfxKey: "skill_bolt",
    aoeRadius: 120,
    castDurationMs: 400,
  },

  // Luminarch
  "mage.radiance": { ...MAGE_BEAM, color: 0xfde68a, colorAlt: 0xfef9c3, sfxKey: "skill_beam" },
  "mage.sanctuary": {
    ...MAGE_BUFF,
    color: 0xfde68a,
    colorAlt: 0xfef3c7,
    particleStyle: "holy_sparkle",
  },
  "mage.divine_wrath": {
    ...MAGE_AOE,
    color: 0xfde68a,
    colorAlt: 0xfef9c3,
    particleStyle: "holy_sparkle",
    sfxKey: "skill_beam",
    aoeRadius: 100,
  },
  "mage.divine_ward": {
    ...MAGE_BUFF,
    color: 0xfde68a,
    colorAlt: 0xfef3c7,
    particleStyle: "holy_sparkle",
  },
  "mage.judgement": {
    ...MAGE_AOE,
    color: 0xfde68a,
    colorAlt: 0xfef9c3,
    particleStyle: "holy_sparkle",
    sfxKey: "skill_beam",
    aoeRadius: 110,
    castDurationMs: 400,
  },

  // ── ARCHER tier 1 ─────────────────────────────────────────────────────────
  "archer.twin_shot": { ...ARCHER_ARROW, castDurationMs: 120 },
  "archer.keen_eye": ARCHER_BUFF,
  "archer.piercing_arrow": {
    ...ARCHER_ARROW,
    color: 0x86efac,
    projectileSpeed: 6,
    castDurationMs: 200,
  },
  "archer.fleet_foot": ARCHER_BUFF,
  "archer.barbed_arrow": {
    ...ARCHER_ARROW,
    color: 0xef4444,
    colorAlt: 0xfca5a5,
    sfxKey: "skill_arrow",
  },

  // Longbow
  "archer.volley": { ...ARCHER_AOE, aoeRadius: 80, sfxKey: "skill_arrow" },
  "archer.swift_nock": ARCHER_BUFF,
  "archer.focus_spirit": ARCHER_BUFF,
  "archer.arrow_rain": {
    ...ARCHER_AOE,
    aoeRadius: 110,
    sfxKey: "skill_arrow",
    castDurationMs: 300,
  },
  "archer.wind_blessing": { ...ARCHER_BUFF, color: 0x67e8f9, colorAlt: 0xcffafe },
  "archer.tempest_flurry": {
    ...ARCHER_AOE,
    aoeRadius: 100,
    castDurationMs: 350,
    sfxKey: "skill_arrow",
  },

  // Crossbow
  "archer.aimed_shot": {
    ...ARCHER_ARROW,
    color: 0xf97316,
    projectileSpeed: 6.5,
    castDurationMs: 250,
  },
  "archer.eagle_eye": ARCHER_BUFF,
  "archer.reload_stance": { ...ARCHER_BUFF, color: 0xf97316, colorAlt: 0xfdba74 },
  "archer.puncture": { ...ARCHER_ARROW, color: 0xef4444, projectileSpeed: 7, castDurationMs: 280 },
  "archer.steady_aim": ARCHER_BUFF,
  "archer.hypervelocity": {
    ...ARCHER_ARROW,
    color: 0xef4444,
    colorAlt: 0xfde68a,
    projectileSpeed: 8,
    castDurationMs: 350,
  },

  // ── THIEF tier 1 ──────────────────────────────────────────────────────────
  "thief.shadow_rush": THIEF_DASH,
  "thief.shadow_instinct": THIEF_BUFF,
  "thief.keen_reflexes": THIEF_BUFF,
  "thief.noxious_wound": {
    ...THIEF_MELEE,
    color: 0x22c55e,
    colorAlt: 0x86efac,
    particleStyle: "poison_bubbles",
  },

  // Bladecaller
  "thief.ricochet_blade": { ...THIEF_PROJECTILE, aoeRadius: 60 },
  "thief.focused_fury": THIEF_BUFF,
  "thief.blade_storm": { ...THIEF_AOE, aoeRadius: 100, sfxKey: "skill_slash" },
  "thief.cloak_of_razors": { ...THIEF_BUFF, colorAlt: 0xc4b5fd, particleStyle: "blade_trail" },
  "thief.eclipse_barrage": { ...THIEF_AOE, aoeRadius: 110, castDurationMs: 350 },

  // Cutthroat
  "thief.vicious_slash": { ...THIEF_MELEE, castDurationMs: 180 },
  "thief.evasive_mastery": THIEF_BUFF,
  "thief.blood_fang": { ...THIEF_MELEE, color: 0xef4444, colorAlt: 0xfca5a5 },
  "thief.shadow_dance": { ...THIEF_BUFF, particleStyle: "dark_wisps" },
  "thief.flicker_assault": { ...THIEF_MELEE, castDurationMs: 250 },
  "thief.void_ripper": { ...THIEF_DASH, castDurationMs: 300 },

  // Shadowmancer
  "thief.smokescreen": { ...THIEF_BUFF, color: 0x4b5563, colorAlt: 0x6b7280 },
  "thief.phantom_strike": { ...THIEF_PROJECTILE, color: 0x6b21a8, colorAlt: 0x9333ea },
  "thief.void_cloak": { ...THIEF_BUFF, color: 0x1e1b4b, colorAlt: 0x4338ca },
  "thief.wraith_talon": { ...THIEF_PROJECTILE, color: 0x6b21a8, colorAlt: 0x9333ea, aoeRadius: 60 },
  "thief.umbra_dominion": { ...THIEF_AOE, aoeRadius: 110, castDurationMs: 350 },

  // ── PIRATE tier 1 ─────────────────────────────────────────────────────────
  "pirate.gut_punch": PIRATE_MELEE,
  "pirate.sea_fortitude": PIRATE_BUFF,
  "pirate.tidewalker_dash": PIRATE_DASH,
  "pirate.buccaneers_bellow": PIRATE_BUFF,
  "pirate.riptide_sweep": { ...PIRATE_AOE, aoeRadius: 70 },

  // Brawler
  "pirate.knuckle_crash": { ...PIRATE_MELEE, castDurationMs: 180 },
  "pirate.iron_liver": PIRATE_BUFF,
  "pirate.tidal_lunge": { ...PIRATE_DASH, castDurationMs: 250 },
  "pirate.tidal_slam": { ...PIRATE_AOE, aoeRadius: 100 },
  "pirate.brawlers_resolve": PIRATE_BUFF,
  "pirate.earthshaker": { ...PIRATE_AOE, aoeRadius: 110, castDurationMs: 350 },
  "pirate.adamantine_fury": { ...PIRATE_BUFF, color: 0xef4444, colorAlt: 0xfde68a },

  // Gunner
  "pirate.scorch_shot": {
    ...PIRATE_GUNNER_SHOT,
    color: 0xef4444,
    colorAlt: 0xfca5a5,
    particleStyle: "fire_trail",
  },
  "pirate.keen_sights": PIRATE_BUFF,
  "pirate.ricochet_round": { ...PIRATE_GUNNER_SHOT, aoeRadius: 60 },
  "pirate.grapeshot_barrage": {
    ...PIRATE_GUNNER_SHOT,
    aoeRadius: 90,
    effectType: "aoe-burst",
    particleStyle: "fire_trail",
  },
  "pirate.lock_and_load": PIRATE_BUFF,
  "pirate.broadsider": {
    ...PIRATE_GUNNER_SHOT,
    color: 0xef4444,
    colorAlt: 0xfde68a,
    projectileSpeed: 6,
    castDurationMs: 300,
  },
  "pirate.megaton_volley": {
    ...PIRATE_GUNNER_SHOT,
    aoeRadius: 100,
    effectType: "aoe-burst",
    castDurationMs: 350,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Archetype defaults (by kind) — used when no per-skill override exists.
// ═══════════════════════════════════════════════════════════════════════════════

type ArchetypeKey = "BEGINNER" | "WARRIOR" | "MAGE" | "ARCHER" | "THIEF" | "PIRATE";

const DEFAULTS: Record<ArchetypeKey, Record<string, SkillEffectDef>> = {
  BEGINNER: { active: BEGINNER_MELEE, buff: BEGINNER_BUFF, passive: BEGINNER_BUFF },
  WARRIOR: { active: WARRIOR_MELEE, buff: WARRIOR_BUFF, passive: WARRIOR_BUFF },
  MAGE: { active: MAGE_BOLT, buff: MAGE_BUFF, passive: MAGE_BUFF },
  ARCHER: { active: ARCHER_ARROW, buff: ARCHER_BUFF, passive: ARCHER_BUFF },
  THIEF: { active: THIEF_MELEE, buff: THIEF_BUFF, passive: THIEF_BUFF },
  PIRATE: { active: PIRATE_MELEE, buff: PIRATE_BUFF, passive: PIRATE_BUFF },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the full visual/audio effect definition for a skill.
 * Falls back to archetype + kind defaults when no per-skill override exists.
 */
export function getSkillEffect(
  skillId: string,
  archetype: ArchetypeKey,
  kind: "passive" | "active" | "buff" = "active",
): SkillEffectDef {
  const override = SKILL_EFFECTS[skillId];
  if (override) return override;
  const defaults = DEFAULTS[archetype] ?? DEFAULTS.BEGINNER;
  // All archetype default records have 'active', 'buff', 'passive' keys.
  return (defaults as Record<string, SkillEffectDef>)[kind] ?? BEGINNER_MELEE;
}

/**
 * Whether this skill spawns a travelling projectile (server should create one).
 */
export function isProjectileSkill(skillId: string, archetype: ArchetypeKey): boolean {
  const eff = getSkillEffect(skillId, archetype, "active");
  return eff.effectType === "projectile";
}
