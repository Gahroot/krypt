/**
 * Skill icons for the quickslot hotbar and buff/debuff status strip.
 *
 * Resolves a skill ID or consumable defId to a visual icon — an inline SVG data
 * URI for skills, or delegates to `slotItemIcon()` for consumables. Every icon
 * is a simple colored glyph (archetype hue × skill kind shape) so no external
 * art is needed; real PNGs can replace these later via the same lookup path.
 *
 * Returns a URL string (data: URI or PNG path) that callers render as `<img>`.
 */

import { slotItemIcon } from "./item-icon";

// ── Archetype → hue ─────────────────────────────────────────────────────────

const ARCHETYPE_HUE: Record<string, string> = {
  warrior: "#dc2626", // red-600
  mage: "#7c3aed", // violet-600
  archer: "#059669", // emerald-600
  thief: "#9333ea", // purple-600
  pirate: "#d97706", // amber-600
  beginner: "#ca8a04", // yellow-600
};

// Fallback hue when prefix doesn't match any known archetype.
const DEFAULT_HUE = "#6b7280"; // gray-500

// ── Skill kind → SVG glyph ──────────────────────────────────────────────────

/**
 * Generate an inline SVG data URI for a skill icon.
 * The shape varies by `kind` (active / buff / passive) and the colour is
 * determined by `hue`.
 */
function skillSvgDataUri(hue: string, kind: string): string {
  const bg = `${hue}22`; // 13% opacity fill
  let shape: string;

  switch (kind) {
    case "active":
      // Sharp diagonal slash — represents an attack.
      shape = `<polygon points="8,24 24,8 28,12 12,28" fill="${hue}"/>
               <polygon points="10,22 22,10 24,12 12,24" fill="${hue}" opacity="0.6"/>`;
      break;
    case "buff":
      // Radiant circle — represents an aura / enhancement.
      shape = `<circle cx="16" cy="16" r="10" fill="none" stroke="${hue}" stroke-width="2.5"/>
               <circle cx="16" cy="16" r="5" fill="${hue}" opacity="0.7"/>
               <line x1="16" y1="3" x2="16" y2="7" stroke="${hue}" stroke-width="1.5" stroke-linecap="round"/>
               <line x1="16" y1="25" x2="16" y2="29" stroke="${hue}" stroke-width="1.5" stroke-linecap="round"/>
               <line x1="3" y1="16" x2="7" y2="16" stroke="${hue}" stroke-width="1.5" stroke-linecap="round"/>
               <line x1="25" y1="16" x2="29" y2="16" stroke="${hue}" stroke-width="1.5" stroke-linecap="round"/>`;
      break;
    case "passive":
      // Diamond — represents a permanent enchantment.
      shape = `<polygon points="16,4 28,16 16,28 4,16" fill="none" stroke="${hue}" stroke-width="2"/>
               <polygon points="16,9 23,16 16,23 9,16" fill="${hue}" opacity="0.5"/>`;
      break;
    default:
      // Generic sparkle for unknown kinds.
      shape = `<circle cx="16" cy="16" r="8" fill="${hue}" opacity="0.6"/>
               <circle cx="16" cy="16" r="4" fill="white" opacity="0.4"/>`;
      break;
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">`,
    `<rect width="32" height="32" rx="4" fill="${bg}"/>`,
    shape,
    `</svg>`,
  ].join("");

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve a skill/item identifier to an icon URL (SVG data URI or PNG path).
 *
 *  • `kind === "skill"` → parse the prefix for the archetype hue, look up the
 *    skill kind, and generate an SVG glyph.
 *  • `kind === "consumable"` → delegate to the existing `slotItemIcon()` which
 *    already handles potions / scrolls / etc.
 *  • `kind === null` → returns undefined (empty slot).
 */
export function slotIconUrl(
  id: string,
  kind: "skill" | "consumable" | null,
  skillKind?: "active" | "buff" | "passive",
): string | undefined {
  if (kind === null || !id) return undefined;

  if (kind === "consumable") {
    // Re-use the existing consumable/etc icon resolution.
    return slotItemIcon(id);
  }

  // ── Skill ────────────────────────────────────────────────────────────────
  const dotIdx = id.indexOf(".");
  const prefix = dotIdx > 0 ? id.slice(0, dotIdx).toLowerCase() : "";
  const hue = ARCHETYPE_HUE[prefix] ?? DEFAULT_HUE;
  return skillSvgDataUri(hue, skillKind ?? "active");
}

/**
 * Resolve a status-effect icon. Uses the effect's `id` (which is a skill ID
 * like "warrior.rally") and `kind` to pick the right hue and shape.
 */
export function resolveEffectIcon(effectId: string, effectKind: string): string {
  const dotIdx = effectId.indexOf(".");
  const prefix = dotIdx > 0 ? effectId.slice(0, dotIdx).toLowerCase() : "";
  const hue = ARCHETYPE_HUE[prefix] ?? DEFAULT_HUE;

  // Map status-effect kinds to our shape categories.
  const shapeKind =
    effectKind === "stun"
      ? "active" // sharp
      : effectKind === "buff" || effectKind === "hot"
        ? "buff" // radiant
        : effectKind === "debuff" || effectKind === "dot"
          ? "active" // sharp
          : "passive"; // diamond fallback

  return skillSvgDataUri(hue, shapeKind);
}
