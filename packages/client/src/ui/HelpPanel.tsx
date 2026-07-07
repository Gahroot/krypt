import { useMemo, useState } from "react";
import { Keyboard, Gamepad2, RotateCcw, Search } from "lucide-react";
import { type ActionId, ACTION_LABELS, ALL_ACTION_IDS } from "@maple/shared";

import { keybindings } from "@/keybindings";
import { getCharId, clearSeenCoachMarks } from "@/backend";
import { DraggableWindow } from "@/ui/components/DraggableWindow";
import { Button } from "@/ui/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/components/ui/tabs";
import { Input } from "@/ui/components/ui/input";
import { Separator } from "@/ui/components/ui/separator";
import { useUIStore } from "@/ui/store";

/**
 * HelpPanel — always-available in-game help (F1 or HUD button).
 *
 * Shows:
 *   1. **Controls** — live keybindings (reads from the player's actual rebinds).
 *   2. **How to Play** — concise quick-reference for every core system.
 *   3. **Replay Tutorial** — re-trigger coach-mark hints and the intro cinematic.
 *
 * Pure client-side: no Phaser scene needed. Keybindings are read directly from
 * the `keybindings` service (single source of truth).
 */

// ─── Controls grouping ─────────────────────────────────────────────────────

interface ControlSection {
  label: string;
  actions: ActionId[];
}

const CONTROL_SECTIONS: ControlSection[] = [
  { label: "Movement", actions: ["moveLeft", "moveRight", "moveUp", "moveDown"] },
  { label: "Combat", actions: ["attack", "jump", "jumpAlt", "interact", "npcInteract"] },
  {
    label: "Quick Slots",
    actions: [
      "quickslot1",
      "quickslot2",
      "quickslot3",
      "quickslot4",
      "quickslot5",
      "quickslot6",
      "quickslot7",
      "quickslot8",
      "quickslot9",
      "quickslot10",
    ],
  },
  {
    label: "UI Panels",
    actions: [
      "openInventory",
      "openSkills",
      "openStats",
      "openQuests",
      "openMap",
      "openChat",
      "openMarket",
      "openCashShop",
      "openGuild",
      "openParty",
      "openFriends",
      "openCube",
      "openUpgrade",
    ],
  },
  {
    label: "Combat QoL",
    actions: ["lootAll", "macro1", "macro2", "macro3", "macro4", "macro5"],
  },
];

// ─── How-to-play entries ───────────────────────────────────────────────────

interface HowToEntry {
  icon: string;
  title: string;
  lines: string[];
}

const HOW_TO_ENTRIES: HowToEntry[] = [
  {
    icon: "🏃",
    title: "Movement",
    lines: ["← → arrow keys or A/D to walk left/right.", "↑ to climb ladders and ropes."],
  },
  {
    icon: "🦘",
    title: "Jump & Climb",
    lines: ["Alt or C to jump.", "Jump toward a ladder then ↑ to grab it."],
  },
  {
    icon: "⚔️",
    title: "Attack",
    lines: [
      "Space or left-click to swing your weapon.",
      "Stand near a mob and press attack repeatedly.",
    ],
  },
  {
    icon: "🎯",
    title: "Skills",
    lines: [
      "Assign skills to the quickslot bar (number keys 1-0).",
      "Open Skill Tree with K to learn new skills.",
      "Drag skills from the tree to a quickslot.",
    ],
  },
  {
    icon: "💰",
    title: "Loot",
    lines: ["Walk over items to pick them up.", "Press Z to loot all items on the ground at once."],
  },
  {
    icon: "📜",
    title: "Quests",
    lines: [
      "Talk to NPCs with a ⚡ icon to get quests.",
      "Press Q to open the quest log.",
      "Completed objectives auto-update in the tracker.",
    ],
  },
  {
    icon: "🏪",
    title: "Free Market",
    lines: [
      "Press M to open the Free Market board.",
      "List items for sale or browse other players' shops.",
    ],
  },
  {
    icon: "👥",
    title: "Party & Social",
    lines: [
      "Press O to open the Party panel.",
      "Right-click another player to whisper, invite, or trade.",
      "Press F for your Friends list, G for Guild.",
    ],
  },
];

// ─── Coach-mark definitions (for replay reference) ─────────────────────────

interface CoachMarkPreview {
  icon: string;
  title: string;
  detail: string;
}

const COACH_MARK_PREVIEWS: CoachMarkPreview[] = [
  { icon: "🏃", title: "Movement", detail: "Use ← → arrow keys or W A S D to move." },
  { icon: "⚔️", title: "Attack", detail: "Press Space or left-click to swing your weapon." },
  { icon: "🦘", title: "Jump & Climb", detail: "Alt to jump · ↑ to climb ladders." },
  { icon: "🎒", title: "Inventory", detail: "Press I to open your inventory." },
  { icon: "💬", title: "Talk to NPCs", detail: "Press Enter near an NPC to start a conversation." },
  {
    icon: "🎯",
    title: "Your First Quest",
    detail: "Talk to Guide Iris — she's nearby with a ⚡ over her head!",
  },
];

// ─── Sub-components ────────────────────────────────────────────────────────

/** A single keybinding row: label + key badge. */
function KeybindRow({ action, display }: { action: ActionId; display: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-foreground">{ACTION_LABELS[action]}</span>
      <kbd className="min-w-[36px] rounded border border-border bg-muted/50 px-1.5 py-0.5 text-center font-mono text-xs text-primary">
        {display || "—"}
      </kbd>
    </div>
  );
}

/** A how-to-play card. */
function HowToCard({ entry }: { entry: HowToEntry }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-lg" aria-hidden>
          {entry.icon}
        </span>
        <span className="text-sm font-semibold">{entry.title}</span>
      </div>
      <ul className="space-y-0.5 pl-7 text-xs leading-relaxed text-muted-foreground">
        {entry.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── Main panel ────────────────────────────────────────────────────────────

export function HelpPanel() {
  const open = useUIStore((s) => s.helpOpen);
  const setHelpOpen = useUIStore((s) => s.setHelpOpen);
  const [search, setSearch] = useState("");

  // Read current bindings at render time (re-read each open).
  const keyDisplays = useMemo(() => {
    const map = {} as Record<ActionId, string>;
    for (const action of ALL_ACTION_IDS) {
      map[action] = keybindings.getDisplayKey(action);
    }
    return map;
  }, []);

  if (!open) return null;

  const close = () => setHelpOpen(false);

  // Filter keybindings by search query.
  const query = search.trim().toLowerCase();
  const filteredSections = query
    ? CONTROL_SECTIONS.map((section) => ({
        ...section,
        actions: section.actions.filter(
          (a) =>
            ACTION_LABELS[a].toLowerCase().includes(query) ||
            keyDisplays[a].toLowerCase().includes(query),
        ),
      })).filter((section) => section.actions.length > 0)
    : CONTROL_SECTIONS;

  // Replay coach marks: clear seen set, then dispatch event for UIScene.
  const replayCoachMarks = (): void => {
    const charId = getCharId();
    if (charId) clearSeenCoachMarks(charId);
    window.dispatchEvent(new CustomEvent("replay-coachmarks"));
    setHelpOpen(false);
  };

  // Replay intro cinematic.
  const replayIntro = (): void => {
    window.dispatchEvent(new CustomEvent("replay-intro"));
    setHelpOpen(false);
  };

  return (
    <DraggableWindow
      title="❓ Help"
      hotkey="F1"
      onClose={close}
      defaultPosition={{ x: 200, y: 80 }}
      className="w-[400px]"
    >
      <Tabs defaultValue="controls">
        <TabsList>
          <TabsTrigger value="controls">
            <Keyboard className="mr-1 size-3" /> Controls
          </TabsTrigger>
          <TabsTrigger value="howto">
            <Gamepad2 className="mr-1 size-3" /> How to Play
          </TabsTrigger>
          <TabsTrigger value="tutorial">
            <RotateCcw className="mr-1 size-3" /> Replay
          </TabsTrigger>
        </TabsList>

        <div className="mt-3 max-h-[55vh] overflow-y-auto pr-1">
          {/* ── Controls ── */}
          <TabsContent value="controls">
            <div className="relative mb-3">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search controls…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
            {filteredSections.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No controls match &quot;{search.trim()}&quot;
              </p>
            )}
            {filteredSections.map((section) => (
              <div key={section.label}>
                <h3 className="mt-2 mb-0.5 text-[11px] font-bold tracking-wide text-primary uppercase first:mt-0">
                  {section.label}
                </h3>
                {section.actions.map((action) => (
                  <KeybindRow key={action} action={action} display={keyDisplays[action]} />
                ))}
              </div>
            ))}
          </TabsContent>

          {/* ── How to Play ── */}
          <TabsContent value="howto">
            <div className="space-y-2.5">
              {HOW_TO_ENTRIES.map((entry) => (
                <HowToCard key={entry.title} entry={entry} />
              ))}
            </div>
          </TabsContent>

          {/* ── Replay Tutorial ── */}
          <TabsContent value="tutorial">
            <div className="space-y-4">
              <div>
                <h3 className="mb-2 text-[11px] font-bold tracking-wide text-primary uppercase">
                  Quick Hints (Coach Marks)
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  Review the onboarding hints, or replay them in-game.
                </p>
                <div className="space-y-1.5">
                  {COACH_MARK_PREVIEWS.map((cm) => (
                    <div
                      key={cm.title}
                      className="flex items-center gap-2.5 rounded-md border border-border bg-muted/20 px-2.5 py-1.5"
                    >
                      <span className="text-base" aria-hidden>
                        {cm.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold">{cm.title}</span>
                        <span className="block text-[11px] text-muted-foreground">{cm.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="mb-2 text-[11px] font-bold tracking-wide text-primary uppercase">
                  Replay Onboarding
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  Re-trigger the tutorial hints in-game so you can see them again.
                </p>
                <Button variant="outline" size="sm" className="w-full" onClick={replayCoachMarks}>
                  <RotateCcw className="mr-1.5 size-3.5" />
                  Replay Tutorial Hints
                </Button>
              </div>

              <Separator />

              <div>
                <h3 className="mb-2 text-[11px] font-bold tracking-wide text-primary uppercase">
                  Intro Cinematic
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  Watch the Dawn Isle intro cinematic again.
                </p>
                <Button variant="outline" size="sm" className="w-full" onClick={replayIntro}>
                  <RotateCcw className="mr-1.5 size-3.5" />
                  Replay Intro
                </Button>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </DraggableWindow>
  );
}
