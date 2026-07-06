# Alpha Art Gaps — Placeholder Art Audit

This document tracks all remaining placeholder/programmatic art in CryptoMaple's client
layer and prioritises what needs replacement before a public alpha vs what can ship
as-is.

## Summary

| Category | Total Assets | Placeholder | Real Art | Status |
|----------|-------------|-------------|----------|--------|
| Characters | 60 PNGs | 0 | 60 (5 colors × 12 frames) | ✅ Complete |
| Mob sprites | 8 PNGs | 8 (tinted variants cover 65+ mobs) | 0 unique per mob | ⚠️ Tinted placeholder |
| NPC portraits | 8 PNGs | 0 | 8 | ✅ Complete |
| Tile art | 6 PNGs | 0 | 6 (grass/dirt/ladder/rope) | ⚠️ No zone variety |
| Item icons | 0 PNGs | All (emoji placeholders) | 0 | ⚠️ Emoji placeholder |
| BG parallax | 3 PNGs | 0 | 3 | ✅ + biome palettes |

---

## Priority 1: Alpha-Critical (Ship With Placeholders)

### Mob Sprites — Tinted Placeholder (65+ mobs)

**Current state:** 8 PNG files — `slime_0-3.png` (4-frame idle) + `hopper_0-3.png` (4-frame idle).
All mobs except `mob.thornback_hopper` were rendering as identical green slimes.

**Alpha fix applied:** Runtime tinting per zone + element. Each mob now renders with a
zone-appropriate colour tint (e.g., Dawn Isle = soft green, Dusk Ward = neon purple,
Frosthold = ice blue) and element shift (Fire = red, Ice = blue, Poison = green, etc.).
Bosses get unique dramatic tints + 1.5–2.0× scale. Large mobs scale to 1.2–1.4×;
small mobs to 0.8–0.85×.

**Remaining gap:** All mobs share the same slime/hopper silhouette — only the colour changes.
A snail looks like a green slime, a crow looks like a purple slime. This is acceptable
for alpha but should be replaced with per-mob-family base sprites before open beta.

**Recommended art families (8–12 base shapes):**
| Family | Mobs | Suggested silhouette |
|--------|------|---------------------|
| Slime/blob | meadow_slime, green_puff, green_mushroom, bog_lurker, deep_swamp_thing | Round blob (current slime) |
| Insect/beetle | meadow_beetle, fossil_beetle, fang_beetle, bark_spider, neon_spider | Multi-legged, flat shell |
| Flying | crow, harbor_gull, cliff_hawk, thunder_hawk, canopy_moth | Winged, angular |
| Humanoid | shadow_thug, deckhand_specter, subway_stalker, subway_overseer, rail_sentinel | Tall, bipedal |
| Beast | dock_rat, bilge_rat, neon_rat, tunnel_bat, frost_wolf | Quadruped, tail |
| Wraith/ghost | arc_wraith, moss_wraith, snow_wraith, frost_banshee, subway_horror | Floating, ethereal |
| Golem/crystal | boulder_golem, crystal_guardian, ruins_sentinel, quarry_crab | Blocky, heavy |
| Elemental | wind_sprite, sylvan_sprite, forest_wisp, ice_elemental, spark_drone | Small, glowing |
| Serpent/dragon | sky_serpent, sea_serpent, jungle_viper, crimson_drake, shadow_wyrm | Long, sinuous |
| Aquatic | reef_jellyfish, sea_urchin, pufferfish, anglerfish, tiger_shark | Aquatic shapes |
| Shroom/plant | dawn_shroom, mushroom, root_crawler, vine_wraith, ember_turtle | Organic, rooted |
| Boss (unique) | all 9 bosses | Unique per boss |

**Estimated art effort:** 12 base shapes × 4 frames × (zone tint variants handled at runtime)
= ~48 new PNGs. A pixel artist could produce these in 1–2 weeks.

---

### Item Icons — Emoji Placeholder

**Current state:** `ItemCell` rendered text-only item names in colored border boxes. No visual
icon was shown.

**Alpha fix applied:** Emoji icons mapped from `EquipSlot` + `WeaponType` + consumable prefix.
Items now show a recognisable symbol (⚔️ swords, 🪖 hats, 🧪 potions, 📦 etcetera, etc.)
above their name label. Applied across Inventory, Equipment, Storage, Trade, and Market panels.

**Remaining gap:** Emoji are not pixel-perfect at all sizes and some platforms render them
inconsistently. For open beta, replace with proper 32×32 item icon PNGs per item.

**Recommended approach:** Create a `items/<defId>.png` icon for each item in the catalog.
The `ItemCell` component already supports an `icon` prop — swap from emoji string to an
`<img>` tag loading the PNG. Estimated ~100–150 unique item icons for the alpha catalog.

---

## Priority 2: Pre-Open-Beta

### Zone-Specific Tiles

**Current state:** 6 tile PNGs shared across all zones:
- `grass_top.png`, `grass_center.png`, `dirt.png` (terrain)
- `ladder.png`, `ladder_top.png`, `rope.png` (climbing)

The biome palette system applies different colors to procedurally drawn terrain shapes,
and `useTileOverlay` toggles the CC0 grass/dirt stamp. But all zones share the same
2 terrain tile textures.

**Recommended additions per biome:**
| Biome | New tiles needed |
|-------|-----------------|
| Rocky (Craghold) | `stone_top.png`, `stone_body.png` — grey stone texture |
| Snow (Frosthold) | `snow_top.png`, `snow_body.png` — white/blue snow texture |
| Underground | `dark_stone_top.png`, `dark_stone_body.png` — dark cave texture |
| Underwater | `coral_top.png`, `kelp.png` — aquatic vegetation |
| Jungle (Drakemoor) | `moss_top.png`, `vine.png` — tropical vegetation |
| Urban (Dusk Ward) | `metal_grate.png`, `concrete.png` — industrial texture |

**Estimated effort:** 12–16 new 32×32 tile PNGs. 2–3 days of pixel art.

---

## Priority 3: Post-Alpha

### NPC Portraits

**Current state:** 8 NPC portraits exist (guide_iris, ferrymaster_cole, storage_keep,
elder_willow, merchant_bram, sensei_tanren, crystal_keeper_luna, portrait).

**Gap:** Not all NPCs in the game have unique portraits. The generic `portrait.png`
is used as a fallback. Some quest-giving NPCs and shop keepers in later zones
may need additional portraits.

### Loot Drop Icons

**Current state:** 2 gem PNGs (`gem.png`, `gem_legendary.png`) used for all loot drops
on the ground.

**Gap:** All dropped items look like the same blue/gold gem. For a more polished
experience, ground loot should reflect the actual item type (weapon shapes, armour
shapes, etc.).

### Attack / Skill VFX

**Current state:** Melee attack is a white rectangle slash + squash tween.
No skill-specific VFX exist yet (skills are a Phase 2+ feature).

**Gap:** When skills are implemented, each will need unique visual effects.

---

## What Ships in Alpha

| Feature | Visual quality | Acceptable? |
|---------|---------------|-------------|
| Player characters | 5 distinct color sets, 12-frame animation | ✅ Yes |
| Mobs per zone | Same silhouette, zone-tinted + scaled | ✅ Yes (alpha bar) |
| Bosses | Unique tint + 1.5–2× scale | ✅ Yes |
| NPC sprites | 7 unique + 1 generic portrait | ✅ Yes |
| Terrain | Biome-colored procedural + 2 tile overlays | ✅ Yes |
| Parallax BG | 3 layers + 11 biome color palettes | ✅ Yes |
| Item icons | Emoji-based slot icons | ✅ Yes (alpha bar) |
| Loot drops | Blue/gold gem sprites | ✅ Acceptable |

**Alpha art bar met:** Shipped zones are visually distinguishable (distinct biome colours +
tile overlays). Key mobs are recognizable by zone tint + scale. Item cells render with
emoji icons. All remaining gaps are documented above with priority tiers.
