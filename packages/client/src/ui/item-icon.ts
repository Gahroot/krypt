/**
 * Item icons for inventory / equipment / market item cells.
 *
 * Resolves an item defId to a real CC0 icon PNG (Kenney-style art, sliced from
 * the generated icon sheets under `src/assets/items/`). Weapons pick a rarity
 * tier by level requirement; armour/accessories map by EquipSlot; consumables
 * and etcetera items map by defId prefix. When no PNG matches, a short emoji is
 * returned as a graceful fallback so every cell still shows *something*.
 *
 * `ItemCell` renders the result as an `<img>` when it looks like a URL/path and
 * as text otherwise — so this function may return either an image URL or emoji.
 */

import { getItemDef, type WeaponType } from "@maple/shared";

// ── Bundled item-icon URLs (Vite) ─────────────────────────────────────────
// Eagerly import every icon PNG as a hashed URL, keyed by filename (no ext).
const ICON_URLS = import.meta.glob("../assets/items/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Resolve an icon file stem (e.g. "slot_hat") to its bundled URL, or undefined. */
function iconUrl(stem: string): string | undefined {
  return ICON_URLS[`../assets/items/${stem}.png`];
}

// ── Weapon rarity tier (by level requirement) ─────────────────────────────

const WEAPON_TIER_ORDER = ["common", "uncommon", "rare", "epic", "legendary"] as const;
type WeaponTier = (typeof WEAPON_TIER_ORDER)[number];

/** Pick a visual rarity tier for a weapon icon from its level requirement. */
function weaponTier(levelReq: number): WeaponTier {
  if (levelReq >= 90) return "legendary";
  if (levelReq >= 60) return "epic";
  if (levelReq >= 35) return "rare";
  if (levelReq >= 15) return "uncommon";
  return "common";
}

/** Weapon subtype → icon file stem prefix. */
const WEAPON_STEM: Partial<Record<WeaponType, string>> = {
  SWORD: "sword",
  BLUNT: "blunt",
  WAND: "wand",
  STAFF: "staff",
  BOW: "bow",
  CROSSBOW: "crossbow",
  DAGGER: "dagger",
  CLAW: "claw",
  GUN: "gun",
  KNUCKLE: "knuckle",
};

// ── EquipSlot → icon file stem ────────────────────────────────────────────

const SLOT_STEM: Record<string, string> = {
  HAT: "slot_hat",
  TOP: "slot_top",
  OVERALL: "slot_overall",
  BOTTOM: "slot_bottom",
  SHOES: "slot_shoes",
  GLOVES: "slot_gloves",
  CAPE: "slot_cape",
  SHIELD: "slot_shield",
  SHOULDER: "slot_shoulder",
  BELT: "slot_belt",
  RING: "slot_ring",
  RING_2: "slot_ring",
  RING_3: "slot_ring",
  RING_4: "slot_ring",
  EARRING: "slot_earring",
  PENDANT: "slot_pendant",
  EYE_ACCESSORY: "slot_eye",
  FACE_ACCESSORY: "slot_face",
  MEDAL: "slot_medal",
  BADGE: "slot_badge",
  POCKET: "slot_pocket",
};

// ── Emoji fallbacks (used only when no PNG matches) ────────────────────────

const SLOT_EMOJI: Record<string, string> = {
  WEAPON: "⚔️",
  HAT: "🪖",
  TOP: "👕",
  BOTTOM: "👖",
  SHOES: "👟",
  GLOVES: "🧤",
  CAPE: "🧣",
  SHIELD: "🛡️",
  OVERALL: "👔",
  RING: "💍",
  RING_2: "💍",
  RING_3: "💍",
  RING_4: "💍",
  EARRING: "✨",
  PENDANT: "📿",
  BELT: "🔗",
  FACE_ACCESSORY: "🎭",
  EYE_ACCESSORY: "👓",
  SHOULDER: "🦺",
  MEDAL: "🏅",
  BADGE: "🏷️",
  POCKET: "🪙",
};

// ── Consumable / etc prefix → icon (PNG stem, then emoji fallback) ─────────

/** Resolve a consumable/etcetera defId to an icon URL, or undefined. */
function prefixIconUrl(defId: string): string | undefined {
  const id = defId.toLowerCase();
  // Consumables live under both `con.` and `pot.` prefixes (e.g. con.hp_potion_s,
  // con.return_scroll, pot.*). Match potions/scrolls by keyword before slot logic.
  if (id.startsWith("con.") || id.startsWith("pot.") || id.startsWith("item.potion")) {
    if (id.includes("return") || id.includes("teleport")) return iconUrl("use_scroll_return");
    if (id.includes("scroll")) return iconUrl("use_scroll");
    if (id.includes("mp") || id.includes("mana")) return iconUrl("use_potion_mp");
    if (id.includes("antidote") || id.includes("stamina") || id.includes("cure"))
      return iconUrl("use_potion_green");
    return iconUrl("use_potion_hp");
  }
  if (id.startsWith("scroll.")) {
    if (id.includes("return") || id.includes("teleport")) return iconUrl("use_scroll_return");
    return iconUrl("use_scroll");
  }
  if (id.startsWith("etc.")) {
    if (id.includes("meso") || id.includes("coin") || id.includes("gold"))
      return iconUrl("etc_coins");
    if (id.includes("arrow")) return iconUrl("etc_arrows");
    if (id.includes("star") || id.includes("throw")) return iconUrl("etc_star");
    if (id.includes("bread") || id.includes("food") || id.includes("meat"))
      return iconUrl("etc_food_bread");
    if (id.includes("gem") || id.includes("crystal") || id.includes("jewel"))
      return iconUrl("etc_gem");
    return iconUrl("etc_ore");
  }
  return undefined;
}

/** Emoji fallback for consumable/etc prefixes. */
function prefixEmoji(defId: string): string | undefined {
  if (defId.includes("scroll")) return "📜";
  if (defId.startsWith("con.") || defId.startsWith("pot.") || defId.startsWith("item.potion"))
    return "🧪";
  if (defId.startsWith("etc.")) return "📦";
  if (defId.startsWith("item.")) return "📋";
  return undefined;
}

/**
 * Resolve an item defId to an icon — a bundled PNG URL when available, else a
 * short emoji, else `undefined` (caller hides the icon area). `ItemCell`
 * renders URLs as `<img>` and everything else as text.
 */
export function slotItemIcon(defId: string): string | undefined {
  // Consumables / etcetera — match by prefix.
  const prefixUrl = prefixIconUrl(defId);
  if (prefixUrl) return prefixUrl;

  const def = getItemDef(defId);
  if (!def) return prefixEmoji(defId);

  // Weapons — real icon by subtype + rarity tier.
  if (def.slot === "WEAPON" && def.weaponType) {
    const stem = WEAPON_STEM[def.weaponType];
    if (stem) {
      const url = iconUrl(`weapon_${stem}_${weaponTier(def.levelReq)}`);
      if (url) return url;
    }
    return SLOT_EMOJI.WEAPON;
  }

  // Armour / accessories — real icon by slot.
  const stem = SLOT_STEM[def.slot];
  if (stem) {
    const url = iconUrl(stem);
    if (url) return url;
  }
  return SLOT_EMOJI[def.slot];
}

/** True when an icon value is an image URL/path (vs an emoji glyph). */
export function isImageIcon(icon: string | undefined): boolean {
  if (!icon) return false;
  return (
    icon.startsWith("/") ||
    icon.startsWith("http") ||
    icon.startsWith("data:") ||
    icon.startsWith("blob:") ||
    icon.includes(".png") ||
    icon.includes(".webp") ||
    icon.includes(".jpg")
  );
}
