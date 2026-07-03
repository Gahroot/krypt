import { StatusBars } from "@/ui/hud/StatusBars";
import { SkillBar } from "@/ui/hud/SkillBar";
import { Minimap } from "@/ui/hud/Minimap";
import { QuestTracker } from "@/ui/hud/QuestTracker";
import { GuidancePanel } from "@/ui/hud/GuidancePanel";
import { ChatBox } from "@/ui/hud/ChatBox";
import { useUIStore } from "@/ui/store";

/**
 * HUD — the always-on React overlay HUD, ported from the legacy Phaser drawing in
 * scenes/UI.ts.
 *
 * Composed of small, single-purpose pieces, each a pure renderer of the bridge
 * store snapshots (store/hud.ts + store/chat.ts):
 *   - StatusBars   — HP / MP / EXP + name/level nameplate
 *   - SkillBar     — quickslot hotbar with cooldown sweeps
 *   - Minimap      — top-left minimap frame
 *   - QuestTracker — top-right active-quest tracker
 *   - ChatBox      — scrollback + channel tabs + a real DOM input
 *
 * The HUD host is click-through (inherits the `#react-overlay` `pointer-events:
 * none`); only the genuinely interactive widgets (chat input/tabs/send, skill
 * buttons) opt back into pointer events. Hidden until the local player is bound.
 */
export function HUD() {
  const visible = useUIStore((s) => s.hud.visible);
  if (!visible) return null;

  return (
    <>
      <Minimap />
      <QuestTracker />
      <GuidancePanel />
      <ChatBox />
      <StatusBars />
      <SkillBar />
    </>
  );
}
