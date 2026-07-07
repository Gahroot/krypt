import { StatusBars } from "@/ui/hud/StatusBars";
import { SkillBar } from "@/ui/hud/SkillBar";
import { Minimap } from "@/ui/hud/Minimap";
import { QuestTracker } from "@/ui/hud/QuestTracker";
import { GuidancePanel } from "@/ui/hud/GuidancePanel";
import { ChatBox } from "@/ui/hud/ChatBox";
import { DeathOverlay } from "@/ui/hud/DeathOverlay";
import { DamageVignette } from "@/ui/hud/DamageVignette";
import { LowHpOverlay } from "@/ui/hud/LowHpOverlay";
import { HudToggleBar } from "@/ui/hud/HudToggleBar";
import { FeedbackButton } from "@/ui/hud/FeedbackButton";
import { HelpButton } from "@/ui/hud/HelpButton";
import { AlphaBanner } from "@/ui/hud/AlphaBanner";
import { EventsNotice } from "@/ui/hud/EventsNotice";
import { TransportCountdown } from "@/ui/hud/TransportCountdown";
import { useUIStore } from "@/ui/store";

/**
 * HUD — the always-on React overlay HUD, ported from the legacy Phaser drawing in
 * scenes/UI.ts.
 *
 * Composed of small, single-purpose pieces, each a pure renderer of the bridge
 * store snapshots (store/hud.ts + store/chat.ts):
 *   - StatusBars     — HP / MP / EXP + name/level/class/mesos nameplate
 *   - SkillBar       — quickslot hotbar with cooldown sweeps
 *   - Minimap        — top-left minimap frame
 *   - QuestTracker   — top-right active-quest tracker
 *   - ChatBox        — scrollback + channel tabs + a real DOM input
 *   - DamageVignette — damage-taken red flash overlay
 *   - LowHpOverlay   — pulsing screen-edge vignette when HP < 25 %
 *   - HudToggleBar   — keybind-driven panel toggle bar (H key)
 *
 * The HUD host is click-through (inherits the `#react-overlay` `pointer-events:
 * none`); only the genuinely interactive widgets (chat input/tabs/send, skill
 * buttons, toggle bar) opt back into pointer events. Hidden until the local
 * player is bound.
 */
export function HUD() {
  const visible = useUIStore((s) => s.hud.visible);
  const death = useUIStore((s) => s.hud.dead);
  if (!visible) return null;

  return (
    <>
      <Minimap />
      <QuestTracker />
      <GuidancePanel />
      <ChatBox />
      <StatusBars />
      <SkillBar />
      <DamageVignette />
      <LowHpOverlay />
      <HudToggleBar />
      <AlphaBanner />
      <EventsNotice />
      <TransportCountdown />
      <HelpButton />
      <FeedbackButton />
      {death && <DeathOverlay />}
    </>
  );
}
