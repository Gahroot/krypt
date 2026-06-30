/**
 * Shared UI fixtures — realistic, serializable panel snapshots.
 *
 * Authored once and reused by BOTH harnesses so what the unit tests render is
 * exactly what the screenshot harness captures:
 *   - Vitest + React Testing Library  (src/ui/__tests__/*.test.tsx)
 *   - the Playwright screenshot harness (scripts/ui-screenshots.ts)
 *
 * Everything here is a plain, serializable snapshot — the same "snapshot-in"
 * shape Phaser pushes through the bridge store (see ../store/inventory.ts). That
 * is what lets the screenshot harness ship these objects straight into the
 * dev-only `window.__uiStore` via `page.evaluate`.
 *
 * defIds, BaseRank and PotentialTier values are real `@maple/shared` data so the
 * panels resolve genuine item names, rarity border colors and rank label colors.
 */
import { BaseRank, PotentialTier } from "@maple/shared";

import type { InvItemSnapshot, InventorySnapshot, PlayerSnapshot } from "@/ui/store";

/** A mid-game sample player used to drive equip-requirement checks in tooltips. */
export const samplePlayer: PlayerSnapshot = {
  level: 60,
  str: 180,
  dex: 45,
  intel: 30,
  luk: 40,
  hp: 4200,
  mp: 1500,
  archetype: "WARRIOR",
};

/** Helper: build an EQUIP-tab snapshot with one rolled potential + flame line. */
function equip(
  uid: string,
  defId: string,
  baseRank: BaseRank,
  potentialTier: PotentialTier,
  stars: number,
): InvItemSnapshot {
  return {
    uid,
    defId,
    baseRank,
    potentialTier,
    lines: 2,
    potentialLines: JSON.stringify([
      { stat: "STR", percent: 9 },
      { stat: "ATK", percent: 6 },
    ]),
    bonusStats: JSON.stringify([{ stat: "STR", value: 12, tier: "EPIC" }]),
    stars,
    count: 1,
  };
}

/** Helper: build a stackable USE/ETC/CASH snapshot (no rarity rolls). */
function stack(uid: string, defId: string, count: number): InvItemSnapshot {
  return {
    uid,
    defId,
    baseRank: BaseRank.NORMAL,
    potentialTier: PotentialTier.RARE,
    lines: 0,
    potentialLines: "[]",
    bonusStats: "[]",
    stars: 0,
    count,
  };
}

/**
 * The reference inventory snapshot. Spans every tab and exercises all four
 * BaseRank name-colors and all four PotentialTier border-colors so the rendered
 * panel shows the full rarity palette.
 */
export const inventorySnapshot: InventorySnapshot = {
  buckets: {
    EQUIP: [
      // NORMAL / RARE → grey name, blue border
      equip("eq-1", "wpn.ember_wand", BaseRank.NORMAL, PotentialTier.RARE, 0),
      // ENHANCED / EPIC → blue name, purple border
      equip("eq-2", "hat.leather_cap", BaseRank.ENHANCED, PotentialTier.EPIC, 5),
      // STARFORGED / UNIQUE → purple name, amber border
      equip("eq-3", "wpn.iron_broadsword", BaseRank.STARFORGED, PotentialTier.UNIQUE, 10),
      // MYTHIC / LEGENDARY → red name, green border (the god roll)
      equip("eq-4", "wpn.bronze_shortsword", BaseRank.MYTHIC, PotentialTier.LEGENDARY, 15),
    ],
    USE: [stack("use-1", "con.hp_potion_s", 50), stack("use-2", "con.mp_potion_s", 30)],
    ETC: [stack("etc-1", "etc.snail_shell", 99), stack("etc-2", "etc.slime_jelly", 12)],
    CASH: [stack("cash-1", "cash_outfit_phoenix_robe", 1)],
  },
  mesos: 1_250_000,
  player: samplePlayer,
  equippedDefIds: ["wpn.bronze_shortsword"],
};

/**
 * A single store mutation expressed as a serializable instruction.
 * `method` is a bridge-store setter name; `args` are passed straight to it.
 * Serializable so the screenshot harness can ship it into `window.__uiStore`
 * via `page.evaluate`.
 */
export interface StoreSeed {
  method: string;
  args: unknown[];
}

/** A panel the screenshot harness can seed, render and capture. */
export interface PanelFixture {
  /** Stable id — also the PNG filename stem. */
  id: string;
  /** Human-readable label for logs. */
  label: string;
  /** Store setter calls applied (in order) before capture. */
  seed: StoreSeed[];
  /** CSS selector that must be present once the panel has rendered. */
  ready: string;
}

/**
 * The registry the screenshot harness iterates. Add a panel here (with its
 * fixture snapshot + open setter + a ready selector) and it is captured
 * automatically. Inventory is the reference entry.
 */
export const panelFixtures: PanelFixture[] = [
  {
    id: "login",
    label: "Login",
    seed: [
      { method: "setLogin", args: [{ error: "", sending: false, walletAvailable: true }] },
      { method: "setLoginOpen", args: [true] },
    ],
    ready: '[data-slot="panel"]',
  },
  {
    id: "inventory",
    label: "Inventory",
    seed: [
      { method: "setInventory", args: [inventorySnapshot] },
      { method: "setInventoryOpen", args: [true] },
    ],
    ready: '[data-slot="item-grid"]',
  },
  {
    id: "character-select",
    label: "Character Select",
    seed: [
      {
        method: "setCharacterSelect",
        args: [
          {
            characters: [
              {
                charId: "chr_1",
                name: "Aria",
                className: "Warrior",
                level: 24,
                mapName: "Meadowfield",
              },
              {
                charId: "chr_2",
                name: "Bevin",
                className: "Mage",
                level: 8,
                mapName: "Sylvanreach",
              },
              {
                charId: "chr_3",
                name: "Cy",
                className: "Beginner",
                level: 1,
                mapName: "Dawn Isle",
              },
            ],
            max: 6,
            loaded: true,
            error: "",
            busy: false,
          },
        ],
      },
      { method: "setCharacterSelectOpen", args: [true] },
    ],
    ready: '[data-slot="panel"]',
  },
  {
    id: "character-create",
    label: "Character Create",
    seed: [
      {
        method: "setCharacterCreate",
        args: [
          {
            appearance: {
              gender: "F",
              skinId: "skin_light",
              hairId: "hair_long",
              hairColorId: "color_brown",
              faceId: "face_default",
              outfitId: "outfit_mage",
            },
            error: "",
            sending: false,
          },
        ],
      },
      { method: "setCharacterCreateOpen", args: [true] },
    ],
    ready: '[data-slot="panel"]',
  },
  {
    id: "hud",
    label: "HUD",
    seed: [
      {
        method: "setHud",
        args: [
          {
            visible: true,
            name: "Aria",
            level: 42,
            hp: 3200,
            maxHp: 4200,
            mp: 1100,
            maxMp: 1500,
            expRatio: 0.673,
            expPct: "67.3",
            skills: [
              {
                index: 0,
                key: "1",
                kind: "skill",
                label: "PS",
                fullName: "Power Strike",
                usable: true,
                cooldownEndAt: 0,
                cooldownTotalMs: 4000,
              },
              {
                index: 1,
                key: "2",
                kind: "skill",
                label: "SL",
                fullName: "Slash Line",
                usable: true,
                cooldownEndAt: 0,
                cooldownTotalMs: 6000,
              },
              {
                index: 2,
                key: "3",
                kind: "consumable",
                label: "HP",
                fullName: "HP Potion",
                usable: true,
                count: 47,
                cooldownEndAt: 0,
                cooldownTotalMs: 2000,
              },
            ],
            quests: [
              {
                questId: "q_starter",
                name: "Snail Safari",
                complete: false,
                objectives: [{ description: "Defeat snails", current: 7, target: 10, done: false }],
              },
            ],
            bonusHunt: { expMultiplier: 1.5, dropMultiplier: 2 },
            minimap: {
              mapName: "Meadowfield",
              playerCount: 3,
              width: 1600,
              height: 900,
              footholds: [{ x1: 0, y1: 600, x2: 1600, y2: 600 }],
              ladders: [{ x: 400, yTop: 400, yBottom: 600 }],
              portals: [{ x: 780, y: 580 }],
              npcs: [{ x: 200, y: 580 }],
              dots: [
                { x: 800, y: 580, kind: "self" },
                { x: 500, y: 580, kind: "player" },
                { x: 1000, y: 550, kind: "mob" },
              ],
            },
          },
        ],
      },
      {
        method: "setChat",
        args: [
          {
            messages: [
              { id: 1, name: "Bevin", text: "hey, anyone want to party?", scope: "map" },
              { id: 2, name: "System", text: "Welcome to CryptoMaple!", scope: "system" },
            ],
            channels: ["map", "whisper", "party", "guild"],
          },
        ],
      },
    ],
    ready: 'input[placeholder*="Message"]',
  },
  {
    id: "general-store",
    label: "General Store",
    seed: [
      {
        method: "setShop",
        args: [
          {
            shopId: "meadowfield_store",
            title: "Meadowfield General Store",
            mesos: 84_500,
            buy: [
              {
                itemId: "con.hp_potion_s",
                name: "HP Potion (S)",
                buyPrice: 50,
                isConsumable: true,
              },
              {
                itemId: "con.mp_potion_s",
                name: "MP Potion (S)",
                buyPrice: 50,
                isConsumable: true,
              },
              {
                itemId: "con.hp_potion_m",
                name: "HP Potion (M)",
                buyPrice: 200,
                isConsumable: true,
              },
              {
                itemId: "con.mp_potion_m",
                name: "MP Potion (M)",
                buyPrice: 200,
                isConsumable: true,
              },
              {
                itemId: "wpn.bronze_shortsword",
                name: "Bronze Shortsword",
                buyPrice: 1000,
                isConsumable: false,
              },
            ],
            sell: [
              {
                uid: "use-1",
                defId: "etc.snail_shell",
                name: "Snail Shell",
                count: 32,
                sellPrice: 3,
              },
              {
                uid: "use-2",
                defId: "etc.slime_jelly",
                name: "Slime Jelly",
                count: 15,
                sellPrice: 5,
              },
            ],
            feedback: null,
          },
        ],
      },
      { method: "setShopOpen", args: [true] },
    ],
    ready: '[data-slot="shop-layout-scrim"]',
  },
  {
    id: "cash-shop",
    label: "Cash Shop",
    seed: [
      {
        method: "setCashShop",
        args: [
          {
            balance: 12_500,
            currencyLabel: "Maple Crystals",
            ticker: "MC",
            items: [
              {
                id: "cash_outfit_phoenix_robe",
                name: "Phoenix Robe",
                category: "outfit",
                categoryLabel: "Outfit",
                price: 3500,
                durationDays: 90,
                owned: false,
                equipped: false,
                hasAppearance: true,
              },
              {
                id: "cash_hair_flowing",
                name: "Flowing Hair",
                category: "hair",
                categoryLabel: "Hair",
                price: 1200,
                owned: true,
                equipped: true,
                hasAppearance: true,
              },
              {
                id: "cash_pet_dragon",
                name: "Baby Dragon",
                category: "pet",
                categoryLabel: "Pets",
                price: 5000,
                owned: false,
                equipped: false,
                hasAppearance: false,
              },
              {
                id: "cash_effect_glow",
                name: "Aura Glow",
                category: "effect",
                categoryLabel: "Effects",
                price: 2000,
                durationDays: 30,
                owned: true,
                equipped: false,
                hasAppearance: false,
              },
            ],
            feedback: null,
          },
        ],
      },
      { method: "setCashShopOpen", args: [true] },
    ],
    ready: '[data-slot="shop-layout-scrim"]',
  },
  {
    id: "market",
    label: "Free Market",
    seed: [
      {
        method: "setMarket",
        args: [
          {
            mesos: 1_250_000,
            feeBps: 250,
            connected: true,
            listings: [
              {
                listingId: "l1",
                defId: "wpn.iron_broadsword",
                name: "Iron Broadsword",
                sellerId: "acc_2",
                sellerName: "Bevin",
                potentialTier: "EPIC",
                tierLabel: "Epic",
                tierColor: "#a855f7",
                lines: 3,
                price: 450_000,
                createdAt: Date.now() - 3_600_000,
                listingType: "fixed",
                endsAt: 0,
                currentBid: 0,
                mine: false,
              },
              {
                listingId: "l2",
                defId: "hat.leather_cap",
                name: "Leather Cap",
                sellerId: "acc_3",
                sellerName: "Cy",
                potentialTier: "UNIQUE",
                tierLabel: "Unique",
                tierColor: "#f59e0b",
                lines: 3,
                price: 0,
                createdAt: Date.now() - 7_200_000,
                listingType: "auction",
                endsAt: Date.now() + 86_400_000,
                currentBid: 120_000,
                mine: false,
              },
              {
                listingId: "l3",
                defId: "wpn.bronze_shortsword",
                name: "Bronze Shortsword",
                sellerId: "acc_1",
                sellerName: "Aria",
                potentialTier: "LEGENDARY",
                tierLabel: "Legendary",
                tierColor: "#22c55e",
                lines: 4,
                price: 2_000_000,
                createdAt: Date.now() - 600_000,
                listingType: "fixed",
                endsAt: 0,
                currentBid: 0,
                mine: true,
              },
            ],
            walletItems: [
              {
                uid: "w1",
                defId: "wpn.ember_wand",
                name: "Ember Wand",
                tierLabel: "Rare",
                tierColor: "#3b82f6",
                lines: 2,
                count: 1,
              },
            ],
            feedback: null,
          },
        ],
      },
      { method: "setMarketOpen", args: [true] },
    ],
    ready: '[data-slot="shop-layout-scrim"]',
  },
  {
    id: "trade",
    label: "Trade",
    seed: [
      {
        method: "setTrade",
        args: [
          {
            partnerName: "Bevin",
            myOffer: [
              {
                uid: "o1",
                defId: "wpn.ember_wand",
                baseRank: "NORMAL",
                potentialTier: "RARE",
                count: 1,
              },
            ],
            myMesos: 50_000,
            partnerOffer: [
              {
                uid: "o2",
                defId: "hat.leather_cap",
                baseRank: "ENHANCED",
                potentialTier: "EPIC",
                count: 1,
              },
            ],
            partnerMesos: 0,
            available: [
              {
                uid: "a1",
                defId: "etc.snail_shell",
                baseRank: "NORMAL",
                potentialTier: "RARE",
                count: 32,
              },
              {
                uid: "a2",
                defId: "etc.slime_jelly",
                baseRank: "NORMAL",
                potentialTier: "RARE",
                count: 15,
              },
            ],
            myLocked: false,
            partnerLocked: false,
            myConfirmed: false,
            partnerConfirmed: false,
            feedback: null,
          },
        ],
      },
      { method: "setTradeOpen", args: [true] },
    ],
    ready: '[data-slot="trade-scrim"]',
  },
  {
    id: "storage",
    label: "Storage",
    seed: [
      {
        method: "setStorage",
        args: [
          {
            bagged: [
              {
                uid: "b1",
                defId: "etc.snail_shell",
                baseRank: "NORMAL",
                potentialTier: "RARE",
                count: 32,
              },
              {
                uid: "b2",
                defId: "wpn.ember_wand",
                baseRank: "NORMAL",
                potentialTier: "RARE",
                count: 1,
              },
            ],
            stash: [
              {
                uid: "s1",
                defId: "hat.leather_cap",
                baseRank: "ENHANCED",
                potentialTier: "EPIC",
                count: 1,
              },
              {
                uid: "s2",
                defId: "con.hp_potion_m",
                baseRank: "NORMAL",
                potentialTier: "RARE",
                count: 99,
              },
              {
                uid: "s3",
                defId: "wpn.iron_broadsword",
                baseRank: "STARFORGED",
                potentialTier: "UNIQUE",
                count: 1,
              },
            ],
            stashCapacity: 24,
            inventoryCapacity: 24,
            feedback: null,
          },
        ],
      },
      { method: "setStorageOpen", args: [true] },
    ],
    ready: '[data-slot="storage-scrim"]',
  },
  {
    id: "settings",
    label: "Settings",
    seed: [{ method: "setSettingsOpen", args: [true] }],
    ready: '[data-slot="panel"]',
  },
  {
    id: "party",
    label: "Party",
    seed: [
      {
        method: "setParty",
        args: [
          {
            members: [
              {
                charId: "chr_1",
                sessionId: "s1",
                name: "Aria",
                level: 42,
                hp: 3200,
                maxHp: 4200,
                mp: 1100,
                maxMp: 1500,
                dead: false,
                mapId: "meadowfield",
                leader: true,
              },
              {
                charId: "chr_2",
                sessionId: "s2",
                name: "Bevin",
                level: 38,
                hp: 800,
                maxHp: 2800,
                mp: 600,
                maxMp: 1200,
                dead: false,
                mapId: "meadowfield",
                leader: false,
              },
              {
                charId: "chr_3",
                sessionId: "s3",
                name: "Cy",
                level: 25,
                hp: 0,
                maxHp: 1500,
                mp: 300,
                maxMp: 800,
                dead: true,
                mapId: "meadowfield",
                leader: false,
              },
            ],
            lootRule: "ffa",
            invite: null,
            selfCharId: "chr_1",
          },
        ],
      },
      { method: "setPartyOpen", args: [true] },
    ],
    ready: '[data-slot="panel"]',
  },
  {
    id: "guild",
    label: "Guild",
    seed: [
      {
        method: "setGuild",
        args: [
          {
            guildId: "g_1",
            guildName: "MapleGuard",
            emblem: { color: "#facc15", label: "🛡" },
            members: [
              { charId: "chr_1", name: "Aria", level: 42, rank: "master", online: true },
              { charId: "chr_2", name: "Bevin", level: 38, rank: "officer", online: true },
              { charId: "chr_3", name: "Cy", level: 25, rank: "member", online: false },
              { charId: "chr_4", name: "Dee", level: 15, rank: "member", online: true },
            ],
            createdDate: Date.now() - 30 * 86_400_000,
            selfCharId: "chr_1",
          },
        ],
      },
      { method: "setGuildOpen", args: [true] },
    ],
    ready: '[data-slot="panel"]',
  },
  {
    id: "friends",
    label: "Friends",
    seed: [
      {
        method: "setFriends",
        args: [
          {
            friends: [
              { charId: "chr_2", name: "Bevin", level: 38, online: true, mapId: "sylvanreach" },
              { charId: "chr_4", name: "Dee", level: 15, online: true, mapId: "meadowfield" },
              { charId: "chr_5", name: "Eve", level: 60, online: false },
            ],
          },
        ],
      },
      { method: "setFriendsOpen", args: [true] },
    ],
    ready: '[data-slot="panel"]',
  },
];
