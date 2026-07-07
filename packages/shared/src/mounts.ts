/**
 * Mounts — rideable companions that give a speed boost and are a cosmetic/status pillar.
 *
 * Pure data + pure functions. No runtime deps.
 * Mounts are NOT equipment-slot items — they are a separate catalog of rideable
 * companions the player owns and can summon via the MOUNT_RIDE message.
 */

// ---------------------------------------------------------------------------
// Mount definition
// ---------------------------------------------------------------------------

export interface MountDef {
  readonly id: string;
  readonly name: string;
  /** Speed multiplier applied while riding (1.0 = no change, 1.4 = +40% speed). */
  readonly speedMultiplier: number;
  /** Texture key used by the client to render the mount sprite. */
  readonly textureKey: string;
  /** Mount description for UI tooltips. */
  readonly description: string;
  /** Level requirement to ride (0 = no requirement). */
  readonly levelReq: number;
}

// ---------------------------------------------------------------------------
// Mount catalog
// ---------------------------------------------------------------------------

export const MOUNTS: Record<string, MountDef> = {
  "mount.red_snail": {
    id: "mount.red_snail",
    name: "Red Snail",
    speedMultiplier: 1.3,
    textureKey: "mount_red_snail",
    description: "A trusty red snail. Slow but steady wins the race.",
    levelReq: 1,
  },
  "mount.blue_mushroom": {
    id: "mount.blue_mushroom",
    name: "Blue Mushroom",
    speedMultiplier: 1.4,
    textureKey: "mount_blue_mushroom",
    description: "A bouncy blue mushroom that propels you forward.",
    levelReq: 10,
  },
  "mount.stone_golem": {
    id: "mount.stone_golem",
    name: "Stone Golem",
    speedMultiplier: 1.5,
    textureKey: "mount_stone_golem",
    description: "An ancient golem that lumbers at surprising speed.",
    levelReq: 30,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a mount by id. Returns `undefined` when not found. */
export function getMountDef(id: string): MountDef | undefined {
  return MOUNTS[id];
}

/** Check if a string is a valid mount def id. */
export function isMountId(id: string): boolean {
  return id in MOUNTS;
}

/** Return all mount ids. */
export function allMountIds(): string[] {
  return Object.keys(MOUNTS);
}
