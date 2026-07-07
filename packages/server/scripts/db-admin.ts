/**
 * db:admin — provision a single GM/admin playtest account, fully geared, at a high
 * level, so a human can log in and visually exercise the whole game: mobs, platforms,
 * the new art-style item icons, shops, the market, skills, and every GM command.
 *
 * What it creates (idempotent — safe to re-run):
 *   • An email+password credential you log in with (default admin@maple.gg / admin1234).
 *   • role = "admin"  → unlocks the in-game GM console (/tp, /spawn, /boss, /give, …).
 *   • A high-level character (default Lv 200 WARRIOR) with maxed stats, HP/MP, AP/SP.
 *   • A full best-in-slot equipped set, so the character looks geared on screen.
 *   • A curated spread of spare gear in the EQUIP tab (one of every weapon type +
 *     every armour/accessory slot) so you can eyeball the icon art. Tabs cap at 24
 *     visible slots, so we intentionally showcase a spread rather than all 400+ items.
 *   • Every potion / buff / scroll stacked in the USE/ETC tabs.
 *   • A big pile of mesos + premium cash so the shops and cash shop are testable.
 *
 * Honours DATABASE_URL (default sqlite://./data/maple.db) — the same file the server
 * boots against. RUN THIS WHILE THE SERVER IS STOPPED, then start it, because the
 * server hydrates its account cache once at boot.
 *
 * Env overrides: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_LEVEL, ADMIN_CLASS.
 *
 * Run: pnpm --filter @maple/server run db:admin
 */
import {
  ClassArchetype,
  EquipSlot,
  WeaponType,
  ITEMS,
  CONSUMABLES,
  SCROLLS,
  ETC_ITEMS,
  UPGRADE_SHARD_DEF_ID,
  canEquip,
  getClass,
  allSkillsForClass,
  getBranchesForArchetype,
  allBranchSkills,
  unlockedJobTier,
  maxHpForLevel,
  maxMpForLevel,
  totalExpToLevel,
  randomizeAppearance,
  type ItemDef,
  type CharacterStats,
} from "@maple/shared";
import { AccountStore, type ItemRecord } from "../src/persistence/store";

// ─── Config (env-overridable) ──────────────────────────────────────────────

const EMAIL = process.env.ADMIN_EMAIL ?? "admin@maple.gg";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin1234";
const CHAR_NAME = process.env.ADMIN_NAME ?? "GameMaster";
const LEVEL = clampInt(process.env.ADMIN_LEVEL, 200, 1, 250);
const ARCHETYPE = (process.env.ADMIN_CLASS as ClassArchetype) || ClassArchetype.WARRIOR;

// Stats high enough that every stat requirement on every item is satisfiable.
const GODLY_STAT = 9999;
const START_MESOS = 1_000_000_000;
const START_CASH = 1_000_000;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw !== undefined ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// ─── Item helpers ───────────────────────────────────────────────────────────

/** Wrap an item defId into a plain (NORMAL) durable ItemRecord. */
function mkItem(uid: string, defId: string, count = 1): ItemRecord {
  return {
    uid,
    defId,
    baseRank: "NORMAL",
    potentialTier: "NONE",
    lines: 0,
    minted: false,
    count,
  };
}

/** The equip context used for canEquip() checks — a fully-statted high-level char. */
const EQUIP_CTX: { level: number; stats: CharacterStats; archetype: ClassArchetype } = {
  level: LEVEL,
  archetype: ARCHETYPE,
  stats: {
    STR: GODLY_STAT,
    DEX: GODLY_STAT,
    INT: GODLY_STAT,
    LUK: GODLY_STAT,
    HP: 0,
    MP: 0,
  },
};

const equippable = (def: ItemDef): boolean => canEquip(def, EQUIP_CTX).ok;

/** Highest-level equippable item for a given armour/accessory slot, or undefined. */
function bestForSlot(slot: EquipSlot): ItemDef | undefined {
  return Object.values(ITEMS)
    .filter((d) => d.slot === slot && equippable(d))
    .sort((a, b) => b.levelReq - a.levelReq || b.baseStatBonus - a.baseStatBonus)[0];
}

/** Highest-attack equippable weapon (any type) — the character's main hand. */
function bestWeapon(): ItemDef | undefined {
  return Object.values(ITEMS)
    .filter((d) => d.slot === EquipSlot.WEAPON && equippable(d))
    .sort((a, b) => b.baseAttack - a.baseAttack || b.levelReq - a.levelReq)[0];
}

/**
 * One representative (highest-level) weapon per weapon type — for icon variety.
 * NOT class-filtered: these spares exist so you can eyeball the icon art for every
 * weapon family (sword, wand, bow, claw, …), even ones this class can't wield.
 */
function weaponShowcase(): ItemDef[] {
  const out: ItemDef[] = [];
  for (const wt of Object.values(WeaponType)) {
    const best = Object.values(ITEMS)
      .filter((d) => d.slot === EquipSlot.WEAPON && d.weaponType === wt)
      .sort((a, b) => b.levelReq - a.levelReq)[0];
    if (best) out.push(best);
  }
  return out;
}

/** Highest-level item for a slot, ignoring class/stat requirements (icon showcase). */
function anyBestForSlot(slot: EquipSlot): ItemDef | undefined {
  return Object.values(ITEMS)
    .filter((d) => d.slot === slot)
    .sort((a, b) => b.levelReq - a.levelReq || b.baseStatBonus - a.baseStatBonus)[0];
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const store = new AccountStore();

  // 1) Account + credential (reuse if the email already exists so re-runs are safe).
  let accountId: string;
  const existing = store.findByEmail(EMAIL);
  if (existing) {
    accountId = existing.accountId;
    console.log(`[db:admin] reusing account ${accountId} for ${EMAIL}`);
  } else {
    const res = await store.createAuthAccount({ email: EMAIL, password: PASSWORD });
    if (!res.ok || !res.accountId) {
      throw new Error(`could not create account: ${res.reason ?? "unknown error"}`);
    }
    accountId = res.accountId;
    console.log(`[db:admin] created account ${accountId} for ${EMAIL}`);
  }

  // 2) Admin role + currency.
  store.setRole(accountId, "admin");
  store.setCash(accountId, START_CASH);

  // 3) Character (reuse if the name already belongs to this account).
  let char = store.getCharacterByName(CHAR_NAME);
  if (char && char.accountId !== accountId) {
    throw new Error(`character name "${CHAR_NAME}" is taken by another account`);
  }
  if (!char) {
    char = store.createCharacter(accountId, {
      name: CHAR_NAME,
      archetype: ARCHETYPE,
      appearance: randomizeAppearance(),
    });
    console.log(`[db:admin] created character ${char.charId} (${CHAR_NAME})`);
  } else {
    console.log(`[db:admin] reusing character ${char.charId} (${CHAR_NAME})`);
  }

  // 4) Build inventory + equipped set.
  const inventory: Record<string, ItemRecord> = {};
  const equipped: Record<string, string> = {};
  let seq = 0;
  const uid = (defId: string) => `adm_${++seq}_${defId.replace(/[^a-z0-9]/gi, "")}`;

  const equip = (slot: string, def: ItemDef): void => {
    const u = uid(def.id);
    inventory[u] = mkItem(u, def.id);
    equipped[slot] = u;
  };

  // 4a) Full best-in-slot worn set.
  const wornSlots: EquipSlot[] = [
    EquipSlot.HAT,
    EquipSlot.TOP,
    EquipSlot.BOTTOM,
    EquipSlot.SHOES,
    EquipSlot.GLOVES,
    EquipSlot.CAPE,
    EquipSlot.SHIELD,
    EquipSlot.EARRING,
    EquipSlot.PENDANT,
    EquipSlot.BELT,
    EquipSlot.FACE_ACCESSORY,
    EquipSlot.EYE_ACCESSORY,
    EquipSlot.SHOULDER,
    EquipSlot.MEDAL,
    EquipSlot.BADGE,
    EquipSlot.POCKET,
  ];
  for (const slot of wornSlots) {
    const def = bestForSlot(slot);
    if (def) equip(slot, def);
  }
  const weapon = bestWeapon();
  if (weapon) equip(EquipSlot.WEAPON, weapon);

  // Rings — fill all four finger slots with the four highest-level rings.
  const rings = Object.values(ITEMS)
    .filter((d) => d.slot === EquipSlot.RING && equippable(d))
    .sort((a, b) => b.levelReq - a.levelReq)
    .slice(0, 4);
  const ringSlots = [EquipSlot.RING, EquipSlot.RING_2, EquipSlot.RING_3, EquipSlot.RING_4];
  rings.forEach((def, i) => equip(ringSlots[i]!, def));

  // 4b) Showcase spare gear in the EQUIP tab so the icon art is browsable. The client
  //      hides *equipped* uids from the inventory tab, so these are deliberately
  //      un-worn duplicates. Not class-filtered (goal is to see every icon). The
  //      EQUIP tab shows 24 slots, so we fill up to that with a diverse spread:
  //      one of every weapon type first, then one of every armour/accessory slot.
  const wornDefIds = new Set(Object.values(inventory).map((r) => r.defId));
  const showcaseSlots: EquipSlot[] = [
    EquipSlot.HAT,
    EquipSlot.TOP,
    EquipSlot.BOTTOM,
    EquipSlot.SHOES,
    EquipSlot.GLOVES,
    EquipSlot.CAPE,
    EquipSlot.SHIELD,
    EquipSlot.RING,
    EquipSlot.EARRING,
    EquipSlot.PENDANT,
    EquipSlot.BELT,
    EquipSlot.FACE_ACCESSORY,
    EquipSlot.EYE_ACCESSORY,
    EquipSlot.SHOULDER,
    EquipSlot.MEDAL,
    EquipSlot.BADGE,
    EquipSlot.POCKET,
  ];
  const showcase: ItemDef[] = [...weaponShowcase()];
  for (const slot of showcaseSlots) {
    const def = anyBestForSlot(slot);
    if (def) showcase.push(def);
  }
  let equipTabUsed = 0;
  for (const def of showcase) {
    if (equipTabUsed >= 24) break;
    if (wornDefIds.has(def.id)) continue;
    const u = uid(def.id);
    inventory[u] = mkItem(u, def.id);
    wornDefIds.add(def.id);
    equipTabUsed++;
  }

  // 4c) USE tab — every consumable (potions / buffs / scrolls), stacked.
  for (const c of Object.values(CONSUMABLES)) {
    const u = uid(c.id);
    inventory[u] = mkItem(u, c.id, 100);
  }

  // 4d) ETC tab — enhancement scrolls + upgrade shards + a spread of craft materials.
  for (const s of Object.values(SCROLLS)) {
    const u = uid(s.id);
    inventory[u] = mkItem(u, s.id, 50);
  }
  {
    const u = uid(UPGRADE_SHARD_DEF_ID);
    inventory[u] = mkItem(u, UPGRADE_SHARD_DEF_ID, 200);
  }
  for (const e of Object.values(ETC_ITEMS).slice(0, 20)) {
    const u = uid(e.id);
    inventory[u] = mkItem(u, e.id, 100);
  }

  // 5) Skills — advance to the highest unlocked tier of the first branch and learn
  //    every skill in that branch (plus shared tier-1) at max level.
  const jobTier = unlockedJobTier(ARCHETYPE, LEVEL);
  const branches = getBranchesForArchetype(ARCHETYPE);
  const branch = branches[0];
  const branchId = jobTier >= 2 && branch ? branch.id : "";

  const learnedSkills: string[] = [];
  const skillBook: Record<string, number> = {};
  const learn = (id: string, maxLevel: number): void => {
    if (!learnedSkills.includes(id)) learnedSkills.push(id);
    skillBook[id] = maxLevel;
  };
  // Shared (tier-1) skills.
  for (const s of allSkillsForClass(ARCHETYPE)) {
    if (s.jobTier === 1 && s.jobTier <= jobTier) learn(s.id, s.maxLevel);
  }
  // Chosen-branch skills up to the unlocked tier.
  if (branch) {
    for (const s of allBranchSkills(branch)) {
      if (s.jobTier <= jobTier) learn(s.id, s.maxLevel);
    }
  }

  // 6) Persist everything as one update.
  const def = getClass(ARCHETYPE);
  store.updateCharacter(char.charId, {
    level: LEVEL,
    exp: totalExpToLevel(LEVEL),
    maxHp: maxHpForLevel(ARCHETYPE, LEVEL),
    maxMp: maxMpForLevel(ARCHETYPE, LEVEL),
    ap: 0,
    sp: 0,
    jobTier,
    branchId,
    stats: { STR: GODLY_STAT, DEX: GODLY_STAT, INT: GODLY_STAT, LUK: GODLY_STAT, HP: 0, MP: 0 },
    mesos: START_MESOS,
    inventory,
    equipped,
    learnedSkills,
    skillBook,
  });

  store.checkpoint();

  const invCount = Object.keys(inventory).length;
  const equipCount = Object.keys(equipped).length;
  console.log("[db:admin] done ✔");
  console.log(`  login    : ${EMAIL} / ${PASSWORD}`);
  console.log(`  role     : admin (GM console enabled)`);
  console.log(`  character: ${CHAR_NAME}  ${def.name} Lv ${LEVEL}`);
  console.log(`  gear     : ${equipCount} slots equipped, ${invCount} inventory items`);
  console.log(
    `  wallet   : ${START_MESOS.toLocaleString()} mesos, ${START_CASH.toLocaleString()} cash`,
  );
  console.log(
    `  skills   : ${learnedSkills.length} learned (tier ${jobTier}${branchId ? `, ${branchId}` : ""})`,
  );
}

main().catch((err) => {
  console.error("[db:admin] failed:", err);
  process.exit(1);
});
