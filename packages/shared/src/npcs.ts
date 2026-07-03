/**
 * NPCs — dialog trees and placement data for all non-player characters.
 *
 * A DialogNode supports two patterns:
 *   1. **Linear** — a sequence of text lines that advance one-by-one.
 *   2. **Branching** — the node presents choices; each choice links to another node
 *      (by index in the parent dialog array) or triggers an action.
 *
 * Actions carry a discriminated `kind` union so the server/client can switch on
 * them without stringly-typed dispatch.
 */

// ---------------------------------------------------------------------------
// Dialog system
// ---------------------------------------------------------------------------

/** A single action the server should execute when a player picks a dialog choice. */
export interface DialogAction {
  readonly kind:
    | "openShop"
    | "giveQuest"
    | "advanceJob"
    | "travel"
    | "enterPQ"
    | "openStorage"
    | "end";
  /** Meaning depends on `kind`: quest id, shop id, map id, job class key, etc. */
  readonly payload?: string;
  /** Mesos fee for travel actions; server deducts before teleporting. */
  readonly fee?: number;
}

/** A single line of NPC dialog (linear node). */
export interface DialogLine {
  readonly kind: "line";
  readonly text: string;
  /** Optional next node index; omit to end the conversation. */
  readonly next?: number;
  /** Optional action to fire after this line (e.g. open a shop). */
  readonly action?: DialogAction;
}

/** A branching node — the NPC asks the player to choose. */
export interface DialogChoice {
  /** Player-facing label on the choice button. */
  readonly label: string;
  /** Node index to jump to, or `undefined` if this choice just fires an action. */
  readonly next?: number;
  /** Optional action to fire when the player picks this choice. */
  readonly action?: DialogAction;
}

export interface DialogBranch {
  readonly kind: "branch";
  /** NPC text shown above the choices. */
  readonly text: string;
  readonly choices: readonly DialogChoice[];
}

/** A node in an NPC's dialog tree — either a text line or a branch point. */
export type DialogNode = DialogLine | DialogBranch;

// ---------------------------------------------------------------------------
// NPC definitions
// ---------------------------------------------------------------------------

export type NpcRole = "guide" | "shop" | "job" | "quest" | "storage" | "ferry" | "travel";

export interface NpcDef {
  readonly id: string;
  readonly name: string;
  /** Map where this NPC lives (must match a GameMap id). */
  readonly mapId: string;
  readonly x: number;
  readonly y: number;
  /** Client sprite key for rendering. */
  readonly spriteKey: string;
  readonly role: NpcRole;
  /** Ordered dialog tree — index into this array is the node index for branching. */
  readonly dialog: readonly DialogNode[];
}

// ---------------------------------------------------------------------------
// NPC catalog
// ---------------------------------------------------------------------------

export const NPCS: Record<string, NpcDef> = {
  // ── Dawn Isle NPCs ──────────────────────────────────────────────────────
  "npc.dawn_guide": {
    id: "npc.dawn_guide",
    name: "Guide Iris",
    mapId: "dawn_isle",
    x: 225,
    y: 120 - 40,
    spriteKey: "npc.guide_iris",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Welcome to Dawn Isle! I'm Iris, your guide.",
        next: 1,
      },
      {
        kind: "line",
        text: "Use arrow keys to move and SPACE to attack. Try it on the snails below!",
        next: 2,
      },
      {
        kind: "branch",
        text: "What would you like to know?",
        choices: [
          {
            label: "How do I fight?",
            next: 3,
          },
          {
            label: "Where do I go?",
            next: 4,
          },
          {
            label: "I'm ready to go!",
            action: { kind: "giveQuest", payload: "quest.dawn_trio" },
          },
        ],
      },
      {
        kind: "line",
        text: "Press SPACE near a mob to attack. You can jump with ALT!",
        next: 2,
      },
      {
        kind: "line",
        text: "Defeat some snails and puffs, then come back when you're stronger.",
        next: 2,
      },
    ],
  },

  "npc.dawn_ferry": {
    id: "npc.dawn_ferry",
    name: "Ferrymaster Cole",
    mapId: "dawn_isle",
    x: 1500,
    y: 500 - 40,
    spriteKey: "npc.ferrymaster_cole",
    role: "ferry",
    dialog: [
      {
        kind: "line",
        text: "Ahoy there! I'm Cole, Ferrymaster of Dawn Isle.",
        next: 1,
      },
      {
        kind: "branch",
        text: "I can take you across the bay to Tidewatch Harbor — the gateway to the Heartland. But you'll need to be at least level 10.",
        choices: [
          {
            label: "Take me to the harbor!",
            action: { kind: "travel", payload: "heartland_harbor" },
          },
          {
            label: "I'm not ready yet.",
            action: { kind: "end" },
          },
        ],
      },
    ],
  },

  "npc.dawn_storage": {
    id: "npc.dawn_storage",
    name: "Storage Keep",
    mapId: "dawn_isle",
    x: 500,
    y: 580 - 40,
    spriteKey: "npc.storage_keep",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "I can hold your extra items. Open your storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  // ── Split Road of Destiny — Job Instructor preview NPCs ──────────────

  "npc.dawn_instructor_warrior": {
    id: "npc.dawn_instructor_warrior",
    name: "Warrior Instructor",
    mapId: "dawn_isle",
    x: 340,
    y: 400 - 40,
    spriteKey: "npc.warrior_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "Halt, traveler! I am the Warrior Instructor.",
        next: 1,
      },
      {
        kind: "line",
        text: "Warriors wield heavy blades and armor. They excel in close combat, soaking hits and dishing out devastating physical damage.",
        next: 2,
      },
      {
        kind: "line",
        text: "Your primary stat is STR. At level 10, you can advance to a Squire in Craghold and learn Crushing Blow, Iron Hide, and Rally.",
        next: 3,
      },
      {
        kind: "line",
        text: "If you want to be the frontline of every battle, the warrior's path is for you!",
      },
    ],
  },

  "npc.dawn_instructor_mage": {
    id: "npc.dawn_instructor_mage",
    name: "Mage Instructor",
    mapId: "dawn_isle",
    x: 560,
    y: 320 - 40,
    spriteKey: "npc.mage_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "Ah, a curious one! I am the Mage Instructor.",
        next: 1,
      },
      {
        kind: "line",
        text: "Mages channel arcane energy to unleash devastating spells from a distance. They trade physical resilience for overwhelming magical power.",
        next: 2,
      },
      {
        kind: "line",
        text: "Your primary stat is INT. At level 10, you can advance to an Adept in Sylvanreach and learn Arcane Bolt and Arcane Mastery.",
        next: 3,
      },
      {
        kind: "line",
        text: "If you dream of raining fire and lightning on your foes, the mage's path awaits!",
      },
    ],
  },

  "npc.dawn_instructor_archer": {
    id: "npc.dawn_instructor_archer",
    name: "Archer Instructor",
    mapId: "dawn_isle",
    x: 800,
    y: 240 - 40,
    spriteKey: "npc.archer_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "Greetings, marksman-in-the-making! I am the Archer Instructor.",
        next: 1,
      },
      {
        kind: "line",
        text: "Archers strike from range with bows and crossbows, picking off enemies before they get close. Steady hands and sharp eyes are their greatest weapons.",
        next: 2,
      },
      {
        kind: "line",
        text: "Your primary stat is DEX. At level 10, you can advance to a Scout in Meadowfield and learn Twin Shot and Keen Eye.",
        next: 3,
      },
      {
        kind: "line",
        text: "If you prefer to keep your distance and rain arrows from above, the archer's path is yours!",
      },
    ],
  },

  "npc.dawn_instructor_thief": {
    id: "npc.dawn_instructor_thief",
    name: "Thief Instructor",
    mapId: "dawn_isle",
    x: 1040,
    y: 320 - 40,
    spriteKey: "npc.thief_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "Psst… over here. I am the Thief Instructor.",
        next: 1,
      },
      {
        kind: "line",
        text: "Thieves strike from the shadows with daggers and throwing blades. They rely on speed, critical hits, and elusiveness to outmaneuver foes.",
        next: 2,
      },
      {
        kind: "line",
        text: "Your primary stat is LUK. At level 10, you can advance to a Cutpurse in Dusk-Ward and learn Shadow Rush and Shadow Instinct.",
        next: 3,
      },
      {
        kind: "line",
        text: "If you thrive in the shadows and love landing critical strikes, the thief's path calls to you!",
      },
    ],
  },

  "npc.dawn_instructor_pirate": {
    id: "npc.dawn_instructor_pirate",
    name: "Pirate Instructor",
    mapId: "dawn_isle",
    x: 1260,
    y: 400 - 40,
    spriteKey: "npc.pirate_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "Arrr! I be the Pirate Instructor!",
        next: 1,
      },
      {
        kind: "line",
        text: "Pirates blast enemies with gunpowder and brute force. They combine ranged gunplay with rugged endurance — hard to put down and dangerous at any range.",
        next: 2,
      },
      {
        kind: "line",
        text: "Your primary stat is STR. At level 10, you can advance to a Deckhand in Tidewatch Harbor and learn Powder Blast and Sea Fortitude.",
        next: 3,
      },
      {
        kind: "line",
        text: "If you want to rain fire with a smile and laugh in the face of danger, the pirate's path is for you!",
      },
    ],
  },

  // ── Meadowfield NPCs ────────────────────────────────────────────────────
  "npc.meadow_guide": {
    id: "npc.meadow_guide",
    name: "Elder Willow",
    mapId: "meadowfield",
    x: 200,
    y: 750 - 40,
    spriteKey: "npc.elder_willow",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Welcome to Meadowfield, traveler. The road from the harbor is safe… for now.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Is there something you need?",
        choices: [
          {
            label: "Tell me about this town.",
            next: 2,
          },
          {
            label: "Any work available?",
            action: { kind: "giveQuest", payload: "quest.meadow_slimes" },
          },
        ],
      },
      {
        kind: "line",
        text: "Meadowfield is the heart of the pastoral lands. Slimes, mushrooms, and hoppers roam the platforms.",
      },
    ],
  },

  "npc.meadow_shop": {
    id: "npc.meadow_shop",
    name: "Merchant Bram",
    mapId: "meadowfield",
    x: 600,
    y: 750 - 40,
    spriteKey: "npc.merchant_bram",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Welcome! Browse my wares.",
        action: { kind: "openShop", payload: "shop.meadow_basic" },
      },
    ],
  },

  // ── Class hometown Job Advancement instructors ─────────────────────

  "npc.craghold_instructor_warrior": {
    id: "npc.craghold_instructor_warrior",
    name: "Ironforge Commander",
    mapId: "craghold",
    x: 350,
    y: 400 - 40,
    spriteKey: "npc.warrior_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "Halt, traveler! I am the Ironforge Commander. You seek the warrior's path?",
        next: 1,
      },
      {
        kind: "branch",
        text: "Prove your strength and I will advance you through the ranks.",
        choices: [
          {
            label: "I'm ready to advance!",
            action: { kind: "advanceJob", payload: "WARRIOR" },
          },
          {
            label: "Tell me about this place.",
            next: 2,
          },
        ],
      },
      {
        kind: "line",
        text: "Craghold is a rocky plateau where only the strong survive. The lizards and golems here will test you.",
      },
    ],
  },

  "npc.sylvanreach_instructor_mage": {
    id: "npc.sylvanreach_instructor_mage",
    name: "Archdruid Elowen",
    mapId: "sylvanreach",
    x: 400,
    y: 300 - 40,
    spriteKey: "npc.mage_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "Ah, a seeker of arcane knowledge. I am Archdruid Elowen, keeper of the forest's secrets.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The forest tests all who would wield its power. Are you ready?",
        choices: [
          {
            label: "I'm ready to advance!",
            action: { kind: "advanceJob", payload: "MAGE" },
          },
          {
            label: "Tell me about this place.",
            next: 2,
          },
        ],
      },
      {
        kind: "line",
        text: "Sylvanreach is a treetop city where magic flows like sap. Wisps, moths, and sprites guard its depths.",
      },
    ],
  },

  "npc.meadowfield_instructor_archer": {
    id: "npc.meadowfield_instructor_archer",
    name: "Ranger Captain Thornwood",
    mapId: "meadowfield",
    x: 900,
    y: 360 - 40,
    spriteKey: "npc.archer_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "A steady hand and a keen eye — I am Ranger Captain Thornwood.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The meadow is filled with targets. Show me you can handle them.",
        choices: [
          {
            label: "I'm ready to advance!",
            action: { kind: "advanceJob", payload: "ARCHER" },
          },
          {
            label: "Tell me about this place.",
            next: 2,
          },
        ],
      },
      {
        kind: "line",
        text: "Meadowfield is the heart of the pastoral lands. Slimes, mushrooms, and hoppers roam its platforms.",
      },
    ],
  },

  "npc.dusk_ward_instructor_thief": {
    id: "npc.dusk_ward_instructor_thief",
    name: "Shadowbroker Vex",
    mapId: "dusk_ward",
    x: 300,
    y: 400 - 40,
    spriteKey: "npc.thief_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "You've got nerve showing your face here. I'm Shadowbroker Vex.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The shadows only answer those who earn them. Ready to prove yourself?",
        choices: [
          {
            label: "I'm ready to advance!",
            action: { kind: "advanceJob", payload: "THIEF" },
          },
          {
            label: "Tell me about this place.",
            next: 2,
          },
        ],
      },
      {
        kind: "line",
        text: "Dusk-Ward is a neon-lit undercity. Rats, bats, and thugs infest every tunnel and backalley.",
      },
    ],
  },

  "npc.harbor_instructor_pirate": {
    id: "npc.harbor_instructor_pirate",
    name: "Admiral Ironbow",
    mapId: "heartland_harbor",
    x: 600,
    y: 500 - 40,
    spriteKey: "npc.pirate_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "Ahoy there! I be Admiral Ironbow, and I run the show around these docks.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The sea demands respect. Show me you've got what it takes to sail under my flag.",
        choices: [
          {
            label: "I'm ready to advance!",
            action: { kind: "advanceJob", payload: "PIRATE" },
          },
          {
            label: "Tell me about this place.",
            next: 2,
          },
        ],
      },
      {
        kind: "line",
        text: "Tidewatch Harbor is the gateway to the Heartland. Watch your step — the docks rats bite.",
      },
    ],
  },

  // ── Heartland Town Guide NPCs ──────────────────────────────
  "npc.harbor_guide": {
    id: "npc.harbor_guide",
    name: "Harbormaster Lyra",
    mapId: "heartland_harbor",
    x: 750,
    y: 360,
    spriteKey: "npc.harbormaster_lyra",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Ahoy, newcomer! I'm Lyra, Harbormaster of Tidewatch Harbor.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The docks are crawling with vermin. Could you lend a hand?",
        choices: [
          {
            label: "Tell me more about the harbor.",
            next: 2,
          },
          {
            label: "I'll help clear the rats!",
            action: { kind: "giveQuest", payload: "quest.harbor_welcome" },
          },
        ],
      },
      {
        kind: "line",
        text: "Tidewatch Harbor is the gateway to the Heartland. Ferries arrive from Dawn Isle, and roads lead to Meadowfield and the Crossway hub.",
      },
    ],
  },

  "npc.sylvan_guide": {
    id: "npc.sylvan_guide",
    name: "Fairy Eluna",
    mapId: "sylvanreach",
    x: 650,
    y: 380,
    spriteKey: "npc.fairy_eluna",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Flutter flutter! I'm Eluna, one of the fae wardens of Sylvanreach.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The canopy and roots are overrun with pests. Will you help restore balance?",
        choices: [
          {
            label: "Tell me about this place.",
            next: 2,
          },
          {
            label: "I'll help the forest!",
            action: { kind: "giveQuest", payload: "quest.sylvan_welcome" },
          },
        ],
      },
      {
        kind: "line",
        text: "Sylvanreach is a treetop city woven into the branches of the Great Elder Tree. Magic hums in every leaf.",
      },
    ],
  },

  "npc.crag_guide": {
    id: "npc.crag_guide",
    name: "Forge Master Korrin",
    mapId: "craghold",
    x: 700,
    y: 440,
    spriteKey: "npc.forge_master_korrin",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Hail, traveler! I keep the forge burning here in Craghold.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The cliffs and quarry are teeming with beasts. Think you can handle them?",
        choices: [
          {
            label: "Tell me about Craghold.",
            next: 2,
          },
          {
            label: "Point me to the beasts!",
            action: { kind: "giveQuest", payload: "quest.crag_welcome" },
          },
        ],
      },
      {
        kind: "line",
        text: "Craghold is a warrior's home — stone spires, ancient forges, and lizards as far as the eye can see.",
      },
    ],
  },

  "npc.dusk_guide": {
    id: "npc.dusk_guide",
    name: "Fixer Nyx",
    mapId: "dusk_ward",
    x: 700,
    y: 440,
    spriteKey: "npc.fixer_nyx",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Hey, fresh face. Name's Nyx. I fix problems in Dusk Ward.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The subway and backalleys are crawling with vermin and thugs. Need a hand?",
        choices: [
          {
            label: "Tell me about Dusk Ward.",
            next: 2,
          },
          {
            label: "I'll take care of it.",
            action: { kind: "giveQuest", payload: "quest.dusk_welcome" },
          },
        ],
      },
      {
        kind: "line",
        text: "Dusk Ward is a neon-lit undercity. Fast money, faster trouble. Watch your back.",
      },
    ],
  },

  "npc.crossway_guide": {
    id: "npc.crossway_guide",
    name: "Keeper Aldric",
    mapId: "crossway",
    x: 1000,
    y: 400,
    spriteKey: "npc.keeper_aldric",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Greetings, traveler. I am Aldric, Keeper of the World Tree at Crossway.",
        next: 1,
      },
      {
        kind: "branch",
        text: "All paths of the Heartland converge here. Will you answer the Crossway's call?",
        choices: [
          {
            label: "Tell me about Crossway.",
            next: 2,
          },
          {
            label: "I accept the challenge!",
            action: { kind: "giveQuest", payload: "quest.crossway_welcome" },
          },
        ],
      },
      {
        kind: "line",
        text: "Crossway is the crossroads of the Heartland. Every town connects through here, and the Free Market sits above.",
      },
    ],
  },

  "npc.mirefen_guide": {
    id: "npc.mirefen_guide",
    name: "Swamplight Maren",
    mapId: "mirefen",
    x: 650,
    y: 500,
    spriteKey: "npc.swamplight_maren",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Careful where you step. I'm Maren, and I know these swamps better than anyone.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The ruins beneath Mirefen hold something terrible. Are you brave enough to face it?",
        choices: [
          {
            label: "Tell me about Mirefen.",
            next: 2,
          },
          {
            label: "I'm ready to fight!",
            action: { kind: "giveQuest", payload: "quest.mirefen_welcome" },
          },
        ],
      },
      {
        kind: "line",
        text: "Mirefen is a misty swamp at the edge of ancient ruins. The Bogmaw lurks in the deepest chamber.",
      },
    ],
  },

  // ── Heartland Town Taxi NPCs (fast-travel between towns, 100 mesos flat) ─────
  "npc.harbor_taxi": {
    id: "npc.harbor_taxi",
    name: "Dock Cart Cabbie",
    mapId: "heartland_harbor",
    x: 350,
    y: 620 - 40,
    spriteKey: "npc.taxi_cabbie",
    role: "travel",
    dialog: [
      {
        kind: "line",
        text: "Hop in! The Heartland Express runs between all major towns. 100 mesos a ride.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Where are you headed?",
        choices: [
          {
            label: "🌿 Meadowfield — 100 mesos",
            action: { kind: "travel", payload: "meadowfield", fee: 100 },
          },
          {
            label: "🌲 Sylvanreach — 100 mesos",
            action: { kind: "travel", payload: "sylvanreach", fee: 100 },
          },
          {
            label: "🏔️ Craghold — 100 mesos",
            action: { kind: "travel", payload: "craghold", fee: 100 },
          },
          {
            label: "🌃 Dusk Ward — 100 mesos",
            action: { kind: "travel", payload: "dusk_ward", fee: 100 },
          },
          {
            label: "🍄 Mirefen — 100 mesos",
            action: { kind: "travel", payload: "mirefen", fee: 100 },
          },
          { label: "Never mind", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.meadow_taxi": {
    id: "npc.meadow_taxi",
    name: "Meadow Cart Driver",
    mapId: "meadowfield",
    x: 500,
    y: 750 - 40,
    spriteKey: "npc.taxi_meadow",
    role: "travel",
    dialog: [
      {
        kind: "line",
        text: "Need a ride? I run the Meadowfield express — 100 mesos anywhere in the Heartland.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Pick your destination.",
        choices: [
          {
            label: "⚓ Tidewatch Harbor — 100 mesos",
            action: { kind: "travel", payload: "heartland_harbor", fee: 100 },
          },
          {
            label: "🌲 Sylvanreach — 100 mesos",
            action: { kind: "travel", payload: "sylvanreach", fee: 100 },
          },
          {
            label: "🏔️ Craghold — 100 mesos",
            action: { kind: "travel", payload: "craghold", fee: 100 },
          },
          {
            label: "🌃 Dusk Ward — 100 mesos",
            action: { kind: "travel", payload: "dusk_ward", fee: 100 },
          },
          {
            label: "🍄 Mirefen — 100 mesos",
            action: { kind: "travel", payload: "mirefen", fee: 100 },
          },
          { label: "Never mind", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.sylvan_taxi": {
    id: "npc.sylvan_taxi",
    name: "Treetop Shuttle Guide",
    mapId: "sylvanreach",
    x: 800,
    y: 420 - 40,
    spriteKey: "npc.taxi_sylvan",
    role: "travel",
    dialog: [
      {
        kind: "line",
        text: "Flutter flutter! I shuttle travelers between the Heartland towns. 100 mesos, please.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Where shall we fly?",
        choices: [
          {
            label: "⚓ Tidewatch Harbor — 100 mesos",
            action: { kind: "travel", payload: "heartland_harbor", fee: 100 },
          },
          {
            label: "🌿 Meadowfield — 100 mesos",
            action: { kind: "travel", payload: "meadowfield", fee: 100 },
          },
          {
            label: "🏔️ Craghold — 100 mesos",
            action: { kind: "travel", payload: "craghold", fee: 100 },
          },
          {
            label: "🌃 Dusk Ward — 100 mesos",
            action: { kind: "travel", payload: "dusk_ward", fee: 100 },
          },
          {
            label: "🍄 Mirefen — 100 mesos",
            action: { kind: "travel", payload: "mirefen", fee: 100 },
          },
          { label: "Never mind", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.crag_taxi": {
    id: "npc.crag_taxi",
    name: "Plateau Lifter",
    mapId: "craghold",
    x: 900,
    y: 480 - 40,
    spriteKey: "npc.taxi_crag",
    role: "travel",
    dialog: [
      {
        kind: "line",
        text: "Heh, roads too rough? Hop on the Lifter — 100 mesos gets you anywhere in the Heartland.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Name your stop.",
        choices: [
          {
            label: "⚓ Tidewatch Harbor — 100 mesos",
            action: { kind: "travel", payload: "heartland_harbor", fee: 100 },
          },
          {
            label: "🌿 Meadowfield — 100 mesos",
            action: { kind: "travel", payload: "meadowfield", fee: 100 },
          },
          {
            label: "🌲 Sylvanreach — 100 mesos",
            action: { kind: "travel", payload: "sylvanreach", fee: 100 },
          },
          {
            label: "🌃 Dusk Ward — 100 mesos",
            action: { kind: "travel", payload: "dusk_ward", fee: 100 },
          },
          {
            label: "🍄 Mirefen — 100 mesos",
            action: { kind: "travel", payload: "mirefen", fee: 100 },
          },
          { label: "Never mind", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.dusk_taxi": {
    id: "npc.dusk_taxi",
    name: "Neon Cab Dispatcher",
    mapId: "dusk_ward",
    x: 500,
    y: 480 - 40,
    spriteKey: "npc.taxi_dusk",
    role: "travel",
    dialog: [
      {
        kind: "line",
        text: "Hey, fresh face. Need a ride? Neon Cab — 100 mesos flat to any Heartland town.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Where to?",
        choices: [
          {
            label: "⚓ Tidewatch Harbor — 100 mesos",
            action: { kind: "travel", payload: "heartland_harbor", fee: 100 },
          },
          {
            label: "🌿 Meadowfield — 100 mesos",
            action: { kind: "travel", payload: "meadowfield", fee: 100 },
          },
          {
            label: "🌲 Sylvanreach — 100 mesos",
            action: { kind: "travel", payload: "sylvanreach", fee: 100 },
          },
          {
            label: "🏔️ Craghold — 100 mesos",
            action: { kind: "travel", payload: "craghold", fee: 100 },
          },
          {
            label: "🍄 Mirefen — 100 mesos",
            action: { kind: "travel", payload: "mirefen", fee: 100 },
          },
          { label: "Never mind", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.mirefen_taxi": {
    id: "npc.mirefen_taxi",
    name: "Swamp Ferry Guide",
    mapId: "mirefen",
    x: 850,
    y: 540 - 40,
    spriteKey: "npc.taxi_mirefen",
    role: "travel",
    dialog: [
      {
        kind: "line",
        text: "The boardwalks are tricky — let me handle the travel. 100 mesos to any Heartland town.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Pick a destination.",
        choices: [
          {
            label: "⚓ Tidewatch Harbor — 100 mesos",
            action: { kind: "travel", payload: "heartland_harbor", fee: 100 },
          },
          {
            label: "🌿 Meadowfield — 100 mesos",
            action: { kind: "travel", payload: "meadowfield", fee: 100 },
          },
          {
            label: "🌲 Sylvanreach — 100 mesos",
            action: { kind: "travel", payload: "sylvanreach", fee: 100 },
          },
          {
            label: "🏔️ Craghold — 100 mesos",
            action: { kind: "travel", payload: "craghold", fee: 100 },
          },
          {
            label: "🌃 Dusk Ward — 100 mesos",
            action: { kind: "travel", payload: "dusk_ward", fee: 100 },
          },
          { label: "Never mind", action: { kind: "end" } },
        ],
      },
    ],
  },

  // ── Cash Shop NPC ────────────────────────────────────────────────
  "npc.meadow_cashshop": {
    id: "npc.meadow_cashshop",
    name: "Crystal Keeper Luna",
    mapId: "meadowfield",
    x: 400,
    y: 750 - 40,
    spriteKey: "npc.crystal_keeper_luna",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Welcome to the Cash Shop! Browse premium cosmetics and outfits.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Would you like to see what's available?",
        choices: [
          {
            label: "Open Cash Shop",
            action: { kind: "openShop", payload: "shop.cash" },
          },
          {
            label: "Not now.",
            action: { kind: "end" },
          },
        ],
      },
    ],
  },

  "npc.meadow_job": {
    id: "npc.meadow_job",
    name: "Sensei Tanren",
    mapId: "meadowfield",
    x: 800,
    y: 360 - 40,
    spriteKey: "npc.sensei_tanren",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "You show promise. Are you ready to choose your path?",
        action: { kind: "advanceJob", payload: "warrior" },
      },
    ],
  },

  // ── Tidewatch Harbor NPCs ───────────────────────────────────────────────
  "npc.harbor_ferry": {
    id: "npc.harbor_ferry",
    name: "Captain Wave",
    mapId: "heartland_harbor",
    x: 200,
    y: 620 - 40,
    spriteKey: "npc.captain_wave",
    role: "ferry",
    dialog: [
      {
        kind: "line",
        text: "Fresh off the boat from Dawn Isle? Welcome to the Heartland!",
      },
      {
        kind: "line",
        text: "Head right through town and take the road to Meadowfield when you're ready.",
      },
    ],
  },

  "npc.harbor_shop": {
    id: "npc.harbor_shop",
    name: "Dock Trader",
    mapId: "heartland_harbor",
    x: 700,
    y: 400 - 40,
    spriteKey: "npc.dock_trader",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Everything a new arrival needs!",
        action: { kind: "openShop", payload: "shop.harbor_basics" },
      },
    ],
  },

  // ── Heartland Harbor Job Instructor ─────────────────────────────────
  "npc.harbor_job": {
    id: "npc.harbor_job",
    name: "Job Instructor",
    mapId: "heartland_harbor",
    x: 450,
    y: 400 - 40,
    spriteKey: "npc.job_instructor",
    role: "job",
    dialog: [
      {
        kind: "line",
        text: "Halt, adventurer! You've proven yourself on Dawn Isle.",
        next: 1,
      },
      {
        kind: "line",
        text: "The time has come to choose your path. Which calling speaks to you?",
        next: 2,
      },
      {
        kind: "branch",
        text: "Choose your class, adventurer.",
        choices: [
          {
            label: "Warrior",
            action: { kind: "advanceJob", payload: "WARRIOR" },
          },
          {
            label: "Mage",
            action: { kind: "advanceJob", payload: "MAGE" },
          },
          {
            label: "Archer",
            action: { kind: "advanceJob", payload: "ARCHER" },
          },
          {
            label: "Thief",
            action: { kind: "advanceJob", payload: "THIEF" },
          },
          {
            label: "Pirate",
            action: { kind: "advanceJob", payload: "PIRATE" },
          },
        ],
      },
    ],
  },

  // ── Dusk Ward Subway PQ — entry NPC ──────────────────────────────────────
  "npc.dusk_subway_pq_guide": {
    id: "npc.dusk_subway_pq_guide",
    name: "Tunnel Keeper Raze",
    mapId: "dusk_ward_subway",
    x: 1300,
    y: 660 - 40,
    spriteKey: "npc.tunnel_keeper_raze",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "Halt. These tunnels run deeper than you know. I'm Raze, keeper of the old subway line.",
        next: 1,
      },
      {
        kind: "branch",
        text: "There's something lurking in the lower levels — a cursed eye that's been drawing monsters to the surface. I need a party strong enough to put it down. Interested?",
        choices: [
          {
            label: "I'll take it on!",
            action: { kind: "enterPQ", payload: "pq.dusk_subway" },
          },
          {
            label: "Tell me more first.",
            next: 2,
          },
          {
            label: "Not right now.",
            action: { kind: "end" },
          },
        ],
      },
      {
        kind: "line",
        text: "The Subway Rush is a five-stage gauntlet. Collect passes from the tunnel horrors, survive the broken rails, solve the signal puzzle, then face the Gaze of the Abyss. You'll need at least two in your party and levels 20 to 35. Twenty minutes on the clock — don't waste them.",
        next: 3,
      },
      {
        kind: "line",
        text: "The rewards? A Guardian Vest forged from the subway's own rail steel — strong, light, and unique to this run. Plus a pile of mesos and experience. Come back when your party is ready.",
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // NEW HEARTLAND TOWN NPCs — shops, storage, quest/flavor, travel
  // ══════════════════════════════════════════════════════════════════════════

  // ── Tidewatch Harbor (heartland_harbor) ──────────────────────────────────

  "npc.harbor_potion_vendor": {
    id: "npc.harbor_potion_vendor",
    name: "Harbor Apothecary",
    mapId: "heartland_harbor",
    x: 850,
    y: 360,
    spriteKey: "npc.harbor_apothecary",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Fresh off the boat? I've got everything a new arrival needs — potions, weapons, you name it.",
        next: 1,
      },
      {
        kind: "branch",
        text: "What are you looking for?",
        choices: [
          {
            label: "Browse weapons & armor",
            action: { kind: "openShop", payload: "shop.harbor_equip" },
          },
          {
            label: "Show me potions & supplies",
            action: { kind: "openShop", payload: "shop.harbor_basics" },
          },
          { label: "Just browsing.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.harbor_storage": {
    id: "npc.harbor_storage",
    name: "Vault Keeper Brann",
    mapId: "heartland_harbor",
    x: 950,
    y: 360,
    spriteKey: "npc.vault_keeper_brann",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "Welcome to the Harbor Vault. I'll keep your extra gear safe and sound. Open your storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  "npc.harbor_quest_dockhand": {
    id: "npc.harbor_quest_dockhand",
    name: "Dockhand Renn",
    mapId: "heartland_harbor",
    x: 550,
    y: 580,
    spriteKey: "npc.dockhand_renn",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "Hey there! Name's Renn. The docks are infested with giant rats — bigger than any I've seen before.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Think you could help clear them out?",
        choices: [
          {
            label: "I'll take care of the rats!",
            action: { kind: "giveQuest", payload: "quest.harbor_rat_problem" },
          },
          { label: "Tell me more.", next: 2 },
          { label: "Not right now.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "They've been gnawing through cargo crates. Clear the dock area and the Harbormaster will reward you generously.",
      },
    ],
  },

  "npc.harbor_quest_sailor": {
    id: "npc.harbor_quest_sailor",
    name: "Old Sailor Mira",
    mapId: "heartland_harbor",
    x: 150,
    y: 580,
    spriteKey: "npc.old_sailor_mira",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "Ahoy, young'un. I lost a cargo manifest somewhere near Meadowfield. Slimes picked it up, the little pests.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Could you retrieve it for an old sailor?",
        choices: [
          {
            label: "I'll find your manifest.",
            action: { kind: "giveQuest", payload: "quest.harbor_lost_manifest" },
          },
          { label: "Where exactly did you lose it?", next: 2 },
          { label: "Sorry, I'm busy.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Somewhere on the road to Meadowfield — my cart hit a bump and it flew right off. The slimes near the east gate should have it.",
      },
    ],
  },

  // ── Meadowfield (meadowfield) ───────────────────────────────────────────

  "npc.meadow_potion_vendor": {
    id: "npc.meadow_potion_vendor",
    name: "Meadow Herbalist Yara",
    mapId: "meadowfield",
    x: 700,
    y: 710,
    spriteKey: "npc.meadow_herbalist_yara",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Welcome to my stall! I brew the finest potions in the meadow — and I've got weapons too.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Take your pick.",
        choices: [
          {
            label: "Browse weapons & armor",
            action: { kind: "openShop", payload: "shop.meadow_equip" },
          },
          {
            label: "Show me potions & scrolls",
            action: { kind: "openShop", payload: "shop.meadow_basic" },
          },
          { label: "Nothing, thanks.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.meadow_storage": {
    id: "npc.meadow_storage",
    name: "Stablemaster Hod",
    mapId: "meadowfield",
    x: 300,
    y: 710,
    spriteKey: "npc.stablemaster_hod",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "The stables double as a warehouse around here. I can hold your extra gear. Open your storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  "npc.meadow_quest_farmer": {
    id: "npc.meadow_quest_farmer",
    name: "Farmer Haydock",
    mapId: "meadowfield",
    x: 150,
    y: 710,
    spriteKey: "npc.farmer_haydock",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "Blasted slimes! They've been eating my crops clean. I can't keep feeding the whole town if this keeps up.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Would you lend a hand clearing the field?",
        choices: [
          {
            label: "I'll chase off the slimes!",
            action: { kind: "giveQuest", payload: "quest.meadow_crop_munchers" },
          },
          { label: "How bad is it?", next: 2 },
          { label: "Not my problem.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "They're all over the ground floor — green puddles with attitude. Defeat enough and the crops might recover.",
      },
    ],
  },

  "npc.meadow_quest_bard": {
    id: "npc.meadow_quest_bard",
    name: "Wandering Bard Finn",
    mapId: "meadowfield",
    x: 550,
    y: 320,
    spriteKey: "npc.bard_finn",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "Greetings, traveler! I'm Finn, a bard collecting tales from across the Heartland.",
        next: 1,
      },
      {
        kind: "branch",
        text: "I'm writing a ballad about the meadow mushrooms. Could you bring me three mushroom caps as inspiration?",
        choices: [
          {
            label: "I'll gather some caps!",
            action: { kind: "giveQuest", payload: "quest.meadow_ballad" },
          },
          { label: "Tell me about your songs.", next: 2 },
          { label: "Not interested.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Every town has a song waiting to be written. The mushrooms of Meadowfield have a rhythm all their own — if you listen closely.",
      },
    ],
  },

  // ── Sylvanreach (sylvanreach) ───────────────────────────────────────────

  "npc.sylvan_shop": {
    id: "npc.sylvan_shop",
    name: "Canopy Merchant Thessaly",
    mapId: "sylvanreach",
    x: 500,
    y: 380,
    spriteKey: "npc.canopy_merchant_thessaly",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Welcome to the Canopy Provisioner. I stock supplies for those who walk among the treetops.",
        next: 1,
      },
      {
        kind: "branch",
        text: "What do you need?",
        choices: [
          {
            label: "Browse supplies",
            action: { kind: "openShop", payload: "shop.sylvan_general" },
          },
          {
            label: "Show me arcane gear",
            action: { kind: "openShop", payload: "shop.sylvan_equip" },
          },
          { label: "Nothing.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.sylvan_potion_vendor": {
    id: "npc.sylvan_potion_vendor",
    name: "Sylvan Alchemist Fern",
    mapId: "sylvanreach",
    x: 700,
    y: 380,
    spriteKey: "npc.sylvan_alchemist_fern",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "The forest provides, and I refine. Arcane reagents and enchanted gear — all harvested sustainably, of course.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Take a look at what I've brewed today.",
        choices: [
          {
            label: "Browse arcane gear",
            action: { kind: "openShop", payload: "shop.sylvan_equip" },
          },
          {
            label: "Show me potions",
            action: { kind: "openShop", payload: "shop.sylvan_general" },
          },
          { label: "Maybe later.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.sylvan_storage": {
    id: "npc.sylvan_storage",
    name: "Root Keeper Thessia",
    mapId: "sylvanreach",
    x: 400,
    y: 380,
    spriteKey: "npc.root_keeper_thessia",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "The roots of the Great Elder Tree hold many secrets — and they can hold your extra gear too. Open storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  "npc.sylvan_quest_flavor": {
    id: "npc.sylvan_quest_flavor",
    name: "Grove Whisperer Lira",
    mapId: "sylvanreach",
    x: 600,
    y: 60,
    spriteKey: "npc.grove_whisperer_lira",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "I hear the whispers of every leaf in the canopy. Lately, they cry in distress — pests have overrun the upper branches.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Will you climb to the canopy and restore balance?",
        choices: [
          {
            label: "I'll cleanse the canopy!",
            action: { kind: "giveQuest", payload: "quest.sylvan_canopy_cleanse" },
          },
          { label: "What kind of pests?", next: 2 },
          { label: "I'm not a climber.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Wisps gone feral, moths grown too bold, spiders spinning in the wrong branches. Climb the canopy path from the dock area.",
      },
    ],
  },

  // ── Craghold (craghold) ─────────────────────────────────────────────────

  "npc.crag_shop": {
    id: "npc.crag_shop",
    name: "Plateau Provisioner Gorr",
    mapId: "craghold",
    x: 550,
    y: 620,
    spriteKey: "npc.plateau_provisioner_gorr",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Hail! Gorr's got the best provisions on the plateau. Potions, scrolls, and then some.",
        next: 1,
      },
      {
        kind: "branch",
        text: "What'll it be?",
        choices: [
          { label: "Browse supplies", action: { kind: "openShop", payload: "shop.crag_general" } },
          {
            label: "Show me weapons & armor",
            action: { kind: "openShop", payload: "shop.crag_equip" },
          },
          { label: "Just passing through.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.crag_potion_vendor": {
    id: "npc.crag_potion_vendor",
    name: "Forge Alchemist Draven",
    mapId: "craghold",
    x: 650,
    y: 440,
    spriteKey: "npc.forge_alchemist_draven",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "I forge more than steel here — I brew potions that'll keep you standing when the lizards bite.",
        next: 1,
      },
      {
        kind: "branch",
        text: "What do you need?",
        choices: [
          {
            label: "Warrior gear & shields",
            action: { kind: "openShop", payload: "shop.crag_equip" },
          },
          {
            label: "Potions & supplies",
            action: { kind: "openShop", payload: "shop.crag_general" },
          },
          { label: "I'm set.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.crag_storage": {
    id: "npc.crag_storage",
    name: "Stone Vault Warden Kael",
    mapId: "craghold",
    x: 450,
    y: 620,
    spriteKey: "npc.stone_vault_kael",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "The stone vaults are carved deep into the cliff. Nothing gets stolen here. Open storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  "npc.crag_quest_flavor": {
    id: "npc.crag_quest_flavor",
    name: "Quarry Foreman Thorne",
    mapId: "craghold",
    x: 1000,
    y: 440,
    spriteKey: "npc.quarry_foreman_thorne",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "The quarry's overrun with rock lizards and fossil beetles. We can't mine a thing while those beasts roam free.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Think you're tough enough to clear them out?",
        choices: [
          {
            label: "Point me to the beasts!",
            action: { kind: "giveQuest", payload: "quest.crag_lizard_clearing" },
          },
          { label: "How dangerous is the quarry?", next: 2 },
          { label: "I'll pass.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Head right through the exit platform to reach the Cliffs and Quarry. Watch for the golems on the lower levels — they hit hard.",
      },
    ],
  },

  // ── Dusk Ward (dusk_ward) ───────────────────────────────────────────────

  "npc.dusk_shop": {
    id: "npc.dusk_shop",
    name: "Neon Peddler Vex",
    mapId: "dusk_ward",
    x: 850,
    y: 440,
    spriteKey: "npc.neon_peddler_vex",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Psst. Everything you need, nothing the cops would approve of. Welcome to the Neon Market.",
        next: 1,
      },
      {
        kind: "branch",
        text: "What are you buying today?",
        choices: [
          { label: "Browse supplies", action: { kind: "openShop", payload: "shop.dusk_general" } },
          {
            label: "Show me blades & gear",
            action: { kind: "openShop", payload: "shop.dusk_equip" },
          },
          { label: "Wrong stall.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.dusk_potion_vendor": {
    id: "npc.dusk_potion_vendor",
    name: "Shadow Chemist Kira",
    mapId: "dusk_ward",
    x: 950,
    y: 440,
    spriteKey: "npc.shadow_chemist_kira",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "I mix potions that'll keep you alive in the subway — and blades that'll make sure you don't need them.",
        next: 1,
      },
      {
        kind: "branch",
        text: "What do you need?",
        choices: [
          {
            label: "Browse blades & cloaks",
            action: { kind: "openShop", payload: "shop.dusk_equip" },
          },
          {
            label: "Potions & contraband",
            action: { kind: "openShop", payload: "shop.dusk_general" },
          },
          { label: "Not today.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.dusk_storage": {
    id: "npc.dusk_storage",
    name: "Black Vault Broker Nix",
    mapId: "dusk_ward",
    x: 400,
    y: 440,
    spriteKey: "npc.black_vault_nix",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "Nothing leaves the Black Vault without my say-so. And nothing enters without your key. Open storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  "npc.dusk_quest_informant": {
    id: "npc.dusk_quest_informant",
    name: "Informant Kiki",
    mapId: "dusk_ward",
    x: 750,
    y: 260,
    spriteKey: "npc.informant_kiki",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "Hey, you look like someone who asks questions. I need intel from the subway tunnels — the rats know things.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Hunt some tunnel rats and bring me what they drop. Interested?",
        choices: [
          {
            label: "I'll get your intel.",
            action: { kind: "giveQuest", payload: "quest.dusk_tunnel_intel" },
          },
          { label: "Rats know things?", next: 2 },
          { label: "Not my scene.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Neon rats down there carry coded tags. Someone's running an operation, and I need to know who. Descend through the subway entrance on the right.",
      },
    ],
  },

  "npc.dusk_quest_bartender": {
    id: "npc.dusk_quest_bartender",
    name: "Bartender Shade",
    mapId: "dusk_ward",
    x: 200,
    y: 640,
    spriteKey: "npc.bartender_shade",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "You look like you can handle yourself. A debt collector's been shaking down my regulars in the backalleys.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Think you could convince him to retire?",
        choices: [
          {
            label: "I'll handle it.",
            action: { kind: "giveQuest", payload: "quest.dusk_debt_collector" },
          },
          { label: "Tell me about this guy.", next: 2 },
          { label: "I don't do favors.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Goes by 'Knuckles'. He lurks in the backalley drainage channels. Give him a beating and tell him Shade sent you.",
      },
    ],
  },

  // ── Mirefen (mirefen) ───────────────────────────────────────────────────

  "npc.mirefen_shop": {
    id: "npc.mirefen_shop",
    name: "Bog Merchant Fenris",
    mapId: "mirefen",
    x: 400,
    y: 660,
    spriteKey: "npc.bog_merchant_fenris",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Careful where you step — and careful what you buy. I've got swamp-tested supplies.",
        next: 1,
      },
      {
        kind: "branch",
        text: "What do you need out here in the muck?",
        choices: [
          {
            label: "Browse supplies",
            action: { kind: "openShop", payload: "shop.mirefen_general" },
          },
          {
            label: "Show me ruin relics",
            action: { kind: "openShop", payload: "shop.mirefen_equip" },
          },
          { label: "Nothing.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.mirefen_potion_vendor": {
    id: "npc.mirefen_potion_vendor",
    name: "Swamp Apothecary Mora",
    mapId: "mirefen",
    x: 500,
    y: 500,
    spriteKey: "npc.swamp_apothecary_mora",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "The swamp has potent remedies — and potent weapons salvaged from the ruins. Browse my wares.",
        next: 1,
      },
      {
        kind: "branch",
        text: "What catches your eye?",
        choices: [
          {
            label: "Browse ruin relics",
            action: { kind: "openShop", payload: "shop.mirefen_equip" },
          },
          {
            label: "Potions & remedies",
            action: { kind: "openShop", payload: "shop.mirefen_general" },
          },
          { label: "Not now.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.mirefen_storage": {
    id: "npc.mirefen_storage",
    name: "Root Vault Keeper Bramble",
    mapId: "mirefen",
    x: 300,
    y: 660,
    spriteKey: "npc.root_vault_bramble",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "The ancient roots form natural vaults beneath the boardwalk. Safe from water, safe from thieves. Open storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  "npc.mirefen_quest_flavor": {
    id: "npc.mirefen_quest_flavor",
    name: "Swamp Sage Aldwyn",
    mapId: "mirefen",
    x: 750,
    y: 320,
    spriteKey: "npc.swamp_sage_aldwyn",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "I've been studying the ruins beneath Mirefen for decades. Strange lights have begun flickering in the deepest chamber.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Something ancient stirs down there. Will you investigate?",
        choices: [
          {
            label: "I'll investigate the ruins.",
            action: { kind: "giveQuest", payload: "quest.mirefen_ruin_lights" },
          },
          { label: "What kind of lights?", next: 2 },
          { label: "I'm not ready.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Eerie bioluminescent pulses from the boss chamber. The Bogmaw may be growing stronger. Climb to the ruins gate above and descend carefully.",
      },
    ],
  },

  // ── Crossway (crossway) ─────────────────────────────────────────────────

  "npc.crossway_shop": {
    id: "npc.crossway_shop",
    name: "Crossroads Trader Esmund",
    mapId: "crossway",
    x: 800,
    y: 400,
    spriteKey: "npc.crossroads_trader_esmund",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "All roads meet here, and so does all the trade. Esmund's got supplies from every corner of the Heartland.",
        next: 1,
      },
      {
        kind: "branch",
        text: "What are you after?",
        choices: [
          {
            label: "Browse supplies",
            action: { kind: "openShop", payload: "shop.crossway_general" },
          },
          { label: "Show me gear", action: { kind: "openShop", payload: "shop.crossway_equip" } },
          { label: "Just passing through.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.crossway_potion_vendor": {
    id: "npc.crossway_potion_vendor",
    name: "Traveling Apothecary Rune",
    mapId: "crossway",
    x: 1200,
    y: 400,
    spriteKey: "npc.traveling_apothecary_rune",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "I've traveled every road in the Heartland and gathered the best wares from each town.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Take your pick — gear from across the Heartland.",
        choices: [
          {
            label: "Browse gear from all towns",
            action: { kind: "openShop", payload: "shop.crossway_equip" },
          },
          {
            label: "Potions & scrolls",
            action: { kind: "openShop", payload: "shop.crossway_general" },
          },
          { label: "Not right now.", action: { kind: "end" } },
        ],
      },
    ],
  },

  "npc.crossway_storage": {
    id: "npc.crossway_storage",
    name: "World Tree Vault",
    mapId: "crossway",
    x: 1100,
    y: 400,
    spriteKey: "npc.world_tree_vault",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "The World Tree shelters all who gather at Crossway — even your spare gear. Open storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  "npc.crossway_quest_wanderer": {
    id: "npc.crossway_quest_wanderer",
    name: "Wanderer Elric",
    mapId: "crossway",
    x: 900,
    y: 400,
    spriteKey: "npc.wanderer_elric",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "I've walked every path in the Heartland and I'm collecting stories for a great chronicle. Each town holds a piece.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Help me gather tales from each town and I'll make sure you're remembered in the annals.",
        choices: [
          {
            label: "I'll gather the tales!",
            action: { kind: "giveQuest", payload: "quest.crossway_heartland_saga" },
          },
          { label: "What kind of stories?", next: 2 },
          { label: "I'm not a storyteller.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Speak to the folk in every Heartland town — Harbor, Meadowfield, Sylvanreach, Craghold, Dusk Ward, Mirefen. Each has a legend waiting to be told.",
      },
    ],
  },

  "npc.crossway_taxi": {
    id: "npc.crossway_taxi",
    name: "Heartland Cart Master",
    mapId: "crossway",
    x: 700,
    y: 400,
    spriteKey: "npc.cart_master_crossway",
    role: "travel",
    dialog: [
      {
        kind: "line",
        text: "Welcome to Crossway — the crossroads of the Heartland. I can take you anywhere for 100 mesos.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Where to, traveler?",
        choices: [
          {
            label: "⚓ Tidewatch Harbor — 100 mesos",
            action: { kind: "travel", payload: "heartland_harbor", fee: 100 },
          },
          {
            label: "🌿 Meadowfield — 100 mesos",
            action: { kind: "travel", payload: "meadowfield", fee: 100 },
          },
          {
            label: "🌲 Sylvanreach — 100 mesos",
            action: { kind: "travel", payload: "sylvanreach", fee: 100 },
          },
          {
            label: "🏔️ Craghold — 100 mesos",
            action: { kind: "travel", payload: "craghold", fee: 100 },
          },
          {
            label: "🌃 Dusk Ward — 100 mesos",
            action: { kind: "travel", payload: "dusk_ward", fee: 100 },
          },
          {
            label: "🍄 Mirefen — 100 mesos",
            action: { kind: "travel", payload: "mirefen", fee: 100 },
          },
          { label: "Never mind", action: { kind: "end" } },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SKYHAVEN — Far Reaches expansion town (Lv 30+)
  // ══════════════════════════════════════════════════════════════════════════

  "npc.skyhaven_guide": {
    id: "npc.skyhaven_guide",
    name: "Windkeeper Zara",
    mapId: "skyhaven",
    x: 800,
    y: 420 - 40,
    spriteKey: "npc.windkeeper_zara",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Welcome to Skyhaven — the last bastion before the open sky. I'm Zara, Windkeeper of the Driftpeaks.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The wind currents grow restless. Will you help us keep the skies safe?",
        choices: [
          { label: "Tell me about Skyhaven.", next: 2 },
          {
            label: "I'll help the sky wardens!",
            action: { kind: "giveQuest", payload: "quest.skyhaven_arrival" },
          },
        ],
      },
      {
        kind: "line",
        text: "Skyhaven floats above the clouds at the edge of the world. Wind sprites, sky serpents, and thunder hawks patrol the Driftpeaks beyond our walls.",
      },
    ],
  },

  "npc.skyhaven_shop": {
    id: "npc.skyhaven_shop",
    name: "Cloud Trader Aeron",
    mapId: "skyhaven",
    x: 600,
    y: 260 - 40,
    spriteKey: "npc.cloud_trader_aeron",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Everything I sell is carried up by the wind currents. Premium gear for sky walkers — take your pick.",
        action: { kind: "openShop", payload: "shop.skyhaven_equip" },
      },
    ],
  },

  "npc.skyhaven_storage": {
    id: "npc.skyhaven_storage",
    name: "Sky Vault Sentinel",
    mapId: "skyhaven",
    x: 900,
    y: 260 - 40,
    spriteKey: "npc.sky_vault_sentinel",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "The Sky Vault is carved into the living rock of this floating island. Your gear is safe here. Open storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  "npc.skyhaven_quest": {
    id: "npc.skyhaven_quest",
    name: "Driftpeak Scout Kael",
    mapId: "skyhaven",
    x: 150,
    y: 720 - 40,
    spriteKey: "npc.driftpeak_scout_kael",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "The Driftpeaks are wild — floating rocks, howling winds, and creatures that don't take kindly to visitors.",
        next: 1,
      },
      {
        kind: "branch",
        text: "I need scouts to thin the wind sprites and bring back crystals from the upper rocks. Interested?",
        choices: [
          {
            label: "I'll scout the Driftpeaks!",
            action: { kind: "giveQuest", payload: "quest.skyhaven_wind_sprite_hunt" },
          },
          { label: "Tell me more.", next: 2 },
          { label: "Not now.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Head left through the cloud deck to reach the Driftpeaks. Watch for the wind sprites on the lower rocks — they're the least dangerous, but don't let your guard down.",
      },
    ],
  },

  "npc.skyhaven_taxi": {
    id: "npc.skyhaven_taxi",
    name: "Sky Shuttle Pilot",
    mapId: "skyhaven",
    x: 1575,
    y: 480 - 40,
    spriteKey: "npc.sky_shuttle_pilot",
    role: "travel",
    dialog: [
      {
        kind: "line",
        text: "Need a ride between the Far Reaches? The airship runs to Frosthold and back to Crossway.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Where to?",
        choices: [
          {
            label: "❄️ Frosthold — 200 mesos",
            action: { kind: "travel", payload: "frosthold", fee: 200 },
          },
          {
            label: "✈️ Crossway — 200 mesos",
            action: { kind: "travel", payload: "crossway", fee: 200 },
          },
          { label: "Never mind", action: { kind: "end" } },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FROSTHOLD — Far Reaches expansion town (Lv 35+)
  // ══════════════════════════════════════════════════════════════════════════

  "npc.frosthold_guide": {
    id: "npc.frosthold_guide",
    name: "Frost Warden Eira",
    mapId: "frosthold",
    x: 800,
    y: 560 - 40,
    spriteKey: "npc.frost_warden_eira",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "You've reached Frosthold — the frozen edge of the world. I'm Eira, Frost Warden. The cold here tests everyone.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The slopes and icecave below are crawling with beasts drawn to the Glacial Abomination's power. Will you help?",
        choices: [
          { label: "Tell me about Frosthold.", next: 2 },
          {
            label: "I'll fight for the wardens!",
            action: { kind: "giveQuest", payload: "quest.frosthold_arrival" },
          },
        ],
      },
      {
        kind: "line",
        text: "Frosthold sits at the peak of the Frozen Spine mountains. Beyond the slopes lies the Icecave — a dungeon of living ice where the Glacial Abomination sleeps.",
      },
    ],
  },

  "npc.frosthold_shop": {
    id: "npc.frosthold_shop",
    name: "Ice Trader Bjorn",
    mapId: "frosthold",
    x: 600,
    y: 420 - 40,
    spriteKey: "npc.ice_trader_bjorn",
    role: "shop",
    dialog: [
      {
        kind: "line",
        text: "Only the hardy survive this far north — and I only sell gear for the hardy. Browse my wares.",
        action: { kind: "openShop", payload: "shop.frosthold_equip" },
      },
    ],
  },

  "npc.frosthold_storage": {
    id: "npc.frosthold_storage",
    name: "Permafrost Vault",
    mapId: "frosthold",
    x: 950,
    y: 420 - 40,
    spriteKey: "npc.permafrost_vault",
    role: "storage",
    dialog: [
      {
        kind: "line",
        text: "The Permafrost Vault never thaws. Your gear will be preserved for eternity. Open storage?",
        action: { kind: "openStorage" },
      },
    ],
  },

  "npc.frosthold_quest": {
    id: "npc.frosthold_quest",
    name: "Expedition Leader Saga",
    mapId: "frosthold",
    x: 150,
    y: 720 - 40,
    spriteKey: "npc.expedition_leader_saga",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "Our expedition to the Icecave has been halted by frost wolves and ice elementals. We can't proceed without strong fighters.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Help us clear the slopes and we'll let you join the descent into the Icecave.",
        choices: [
          {
            label: "I'll clear the wolves!",
            action: { kind: "giveQuest", payload: "quest.frosthold_wolf_patrol" },
          },
          { label: "Tell me about the Icecave.", next: 2 },
          { label: "Too cold for me.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "The Icecave stretches deep beneath the mountain. Crystal guardians, frost crawlers, and worse things lurk below. We've lost two scouts already.",
      },
    ],
  },

  "npc.frosthold_taxi": {
    id: "npc.frosthold_taxi",
    name: "Avalanche Sled Driver",
    mapId: "frosthold",
    x: 1500,
    y: 480 - 40,
    spriteKey: "npc.avalanche_sled_driver",
    role: "travel",
    dialog: [
      {
        kind: "line",
        text: "The sled runs between Frosthold and Skyhaven when the weather holds. 200 mesos for the trip.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Hop on or stay put.",
        choices: [
          {
            label: "☁️ Skyhaven — 200 mesos",
            action: { kind: "travel", payload: "skyhaven", fee: 200 },
          },
          {
            label: "✈️ Crossway — 200 mesos",
            action: { kind: "travel", payload: "crossway", fee: 200 },
          },
          { label: "Never mind", action: { kind: "end" } },
        ],
      },
    ],
  },

  // ── Tideways NPCs ───────────────────────────────────────────────────────

  "npc.tideways_guide": {
    id: "npc.tideways_guide",
    name: "Tidal Sage Nerissa",
    mapId: "tideways",
    x: 650,
    y: 420 - 40,
    spriteKey: "npc.tidal_sage_nerissa",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "Welcome to Tideways, traveller. The ocean holds ancient power — and ancient danger. Our settlement sits above a reef system that stretches for miles.",
        next: 1,
      },
      {
        kind: "branch",
        text: "The reef is crawling with hostile sea life. Can you help us keep the waters safe?",
        choices: [
          {
            label: "I'll help clear the reef!",
            action: { kind: "giveQuest", payload: "quest.tideways_arrival" },
          },
          { label: "Tell me about this place.", next: 2 },
          { label: "Not right now.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Tideways was built by divers who discovered the coral structures decades ago. The bioluminescence keeps us safe — but beyond the reef, the Abyss lurks. Few return from there.",
      },
    ],
  },

  "npc.tideways_quest": {
    id: "npc.tideways_quest",
    name: "Dive Captain Marcus",
    mapId: "tideways",
    x: 350,
    y: 560 - 40,
    spriteKey: "npc.dive_captain_marcus",
    role: "quest",
    dialog: [
      {
        kind: "line",
        text: "Our dive teams have been reporting increased aggression from the reef creatures. Jellyfish swarms, territorial urchins, and worse — anglerfish patrolling the deeper shelves.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Think you can handle a dive mission?",
        choices: [
          {
            label: "I'll clear the reef!",
            action: { kind: "giveQuest", payload: "quest.tideways_jelly_patrol" },
          },
          { label: "What's in the Abyss?", next: 2 },
          { label: "Maybe later.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "The Abyss is the deepest trench in the region. Tiger sharks, sea serpents, and they say something enormous — a Kraken — lurks in the deep trench. We've lost divers down there.",
      },
    ],
  },

  // ═════════════════════════════════════════════════════════════════════
  // DRAKEMOOR — endgame dragon settlement (Lv 90–120)
  // ═════════════════════════════════════════════════════════════════════

  // Stationed on the volcanic spire (foothold 4: y≈100, x 600–900) — the
  // endgame guide overlooking Drakemoor's jungle floor and dragon abyss.
  "npc.drakemoor_guide": {
    id: "npc.drakemoor_guide",
    name: "Sovereign Loremaster Vael",
    mapId: "drakemoor",
    x: 750,
    y: 100 - 40,
    spriteKey: "npc.sovereign_loremaster_vael",
    role: "guide",
    dialog: [
      {
        kind: "line",
        text: "So — you've climbed all the way to Drakemoor, the dragon's threshold. Few reach this spire. I am Vael, Loremaster of the Sovereign.",
        next: 1,
      },
      {
        kind: "branch",
        text: "Below us the jungle floor teems with vipers and beetles, and deeper still the Dragon Abyss hides the Sovereign, Pyroclasm. Will you take up the dragon's trial?",
        choices: [
          { label: "Tell me about Drakemoor.", next: 2 },
          {
            label: "I'll face the Sovereign!",
            action: { kind: "giveQuest", payload: "quest.drakemoor_arrival" },
          },
          { label: "Not yet.", action: { kind: "end" } },
        ],
      },
      {
        kind: "line",
        text: "Drakemoor is the pinnacle of the known world — a settlement carved into the roots of a slumbering volcano. Jungle vipers and fang beetles prowl the floor; dragon skeletons and vine wraiths haunt the canopy; and in the Abyss, drakes and wyrms guard Pyroclasm, the Dragon Sovereign. Survive it, and you'll be a legend.",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return every NPC placed on the given map. */
export function getNpcsForMap(mapId: string): NpcDef[] {
  return Object.values(NPCS).filter((npc) => npc.mapId === mapId);
}
