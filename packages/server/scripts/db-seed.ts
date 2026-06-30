/**
 * db:seed — populate the database with a few test accounts/characters at varied
 * levels for playtesting. Idempotent: characters whose names already exist are
 * skipped, so it is safe to re-run (typically right after `db:reset`).
 *
 * Honours `DATABASE_URL` (default `sqlite://./data/maple.db`), so it seeds the
 * same file the server boots against.
 *
 * Run: pnpm --filter @maple/server run db:seed
 */
import {
  ClassArchetype,
  maxHpForLevel,
  maxMpForLevel,
  randomizeAppearance,
  totalExpToLevel,
} from "@maple/shared";
import { AccountStore } from "../src/persistence/store";

interface SeedChar {
  name: string;
  archetype: ClassArchetype;
  level: number;
}

interface SeedAccount {
  accountId: string;
  characters: SeedChar[];
}

const SEED: SeedAccount[] = [
  {
    accountId: "test_alice",
    characters: [
      { name: "AliceWarrior", archetype: ClassArchetype.WARRIOR, level: 1 },
      { name: "AliceMage", archetype: ClassArchetype.MAGE, level: 30 },
    ],
  },
  {
    accountId: "test_bob",
    characters: [
      { name: "BobArcher", archetype: ClassArchetype.ARCHER, level: 60 },
      { name: "BobThief", archetype: ClassArchetype.THIEF, level: 100 },
    ],
  },
];

function main(): void {
  // No dataDir arg → AccountStore opens DATABASE_URL (default ./data/maple.db).
  const store = new AccountStore();

  let created = 0;
  let skipped = 0;

  for (const acct of SEED) {
    store.getOrCreate(acct.accountId);

    for (const sc of acct.characters) {
      if (store.characterNameExists(sc.name)) {
        console.log(`[db:seed] skip ${sc.name} (already exists)`);
        skipped++;
        continue;
      }

      const rec = store.createCharacter(acct.accountId, {
        name: sc.name,
        archetype: sc.archetype,
        appearance: randomizeAppearance(),
      });

      // Level the character up: set exp/level, grow HP/MP, and bank AP/SP so the
      // character is immediately playable at the target level.
      const apFromLevels = (sc.level - 1) * 5;
      const spFromLevels = (sc.level - 1) * 3;
      store.updateCharacter(rec.charId, {
        level: sc.level,
        exp: totalExpToLevel(sc.level),
        maxHp: maxHpForLevel(sc.archetype, sc.level),
        maxMp: maxMpForLevel(sc.archetype, sc.level),
        ap: apFromLevels,
        sp: spFromLevels,
        jobTier: 0,
        stats: { STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0, MP: 0 },
      });

      console.log(`[db:seed] created ${rec.charId} ${sc.name} (${sc.archetype}) @ Lv ${sc.level}`);
      created++;
    }
  }

  console.log(`[db:seed] done — ${created} created, ${skipped} skipped`);
}

main();
