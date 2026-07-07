import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { toast } from "sonner";

import { installPanelEscHandler } from "@/ui/panelEsc";
import { slotItemIcon, isImageIcon } from "@/ui/item-icon";

import { InventoryPanel } from "@/ui/InventoryPanel";
import { CharacterCreatePanel } from "@/ui/CharacterCreatePanel";
import { CharacterSelectPanel } from "@/ui/CharacterSelectPanel";
import { DialogPanel } from "@/ui/DialogPanel";
import { QuestOfferPanel } from "@/ui/QuestOfferPanel";
import { QuestLogPanel } from "@/ui/QuestLogPanel";
import { StatusEffects } from "@/ui/StatusEffects";
import { ReportDialog } from "@/ui/ReportDialog";
import { ChannelSelectPanel } from "@/ui/ChannelSelectPanel";
import { CoachMarks } from "@/ui/CoachMarks";
import { IntroPanel } from "@/ui/IntroPanel";
import { LoginPanel } from "@/ui/LoginPanel";
import { MinimumResolutionNotice } from "@/ui/MinimumResolutionNotice";
import { HUD } from "@/ui/HUD";
import { Toaster } from "@/ui/components/ui/sonner";
import { useUIStore, type UIState } from "@/ui/store";

/**
 * Root of the React UI overlay. Renders all DOM-based HUD panels on top of the
 * Phaser canvas.
 *
 * The host element (#react-overlay) is click-through; each panel re-enables
 * pointer events on itself via `pointer-events-auto`.
 *
 * PERFORMANCE: the boot-critical / always-mounted UI (HUD, status effects,
 * inventory, dialogs, quest flow, intro/character-create) is imported eagerly.
 * Heavy panels that aren't needed for first paint (market, cash shop, settings,
 * guild, trade, storage, party, friends, store, skills, stats, equipment) are
 * `React.lazy`-loaded and only fetched the first time the player opens them —
 * each lands in its own Rollup chunk and stays out of the initial bundle. See
 * `LazyPanel` below: it subscribes to the panel's `*Open` flag and mounts the
 * lazy component only while open, so the chunk download is deferred until use.
 */

// ─── Lazy heavy panels (one chunk each, fetched on first open) ───────────────
const MarketPanel = lazy(() =>
  import("@/ui/MarketPanel").then((m) => ({ default: m.MarketPanel })),
);
const CashShopPanel = lazy(() =>
  import("@/ui/CashShopPanel").then((m) => ({ default: m.CashShopPanel })),
);
const GeneralStorePanel = lazy(() =>
  import("@/ui/GeneralStorePanel").then((m) => ({ default: m.GeneralStorePanel })),
);
const SettingsPanel = lazy(() =>
  import("@/ui/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);
const GuildPanel = lazy(() => import("@/ui/GuildPanel").then((m) => ({ default: m.GuildPanel })));
const TradePanel = lazy(() => import("@/ui/TradePanel").then((m) => ({ default: m.TradePanel })));
const StoragePanel = lazy(() =>
  import("@/ui/StoragePanel").then((m) => ({ default: m.StoragePanel })),
);
const PartyPanel = lazy(() => import("@/ui/PartyPanel").then((m) => ({ default: m.PartyPanel })));
const FriendsPanel = lazy(() =>
  import("@/ui/FriendsPanel").then((m) => ({ default: m.FriendsPanel })),
);
const SkillTreePanel = lazy(() =>
  import("@/ui/SkillTreePanel").then((m) => ({ default: m.SkillTreePanel })),
);
const StatsPanel = lazy(() => import("@/ui/StatsPanel").then((m) => ({ default: m.StatsPanel })));
const EquipmentPanel = lazy(() =>
  import("@/ui/EquipmentPanel").then((m) => ({ default: m.EquipmentPanel })),
);
const HelpPanel = lazy(() => import("@/ui/HelpPanel").then((m) => ({ default: m.HelpPanel })));
const WorldMapPanel = lazy(() =>
  import("@/ui/WorldMapPanel").then((m) => ({ default: m.WorldMapPanel })),
);

/**
 * Mounts a lazy panel only while its `*Open` store flag is true. Because the
 * `lazy()` import isn't referenced until `open` flips, Rollup keeps the panel in
 * its own chunk and the browser only fetches it on first open. The panel itself
 * still does its own `if (!open) return null`, so behaviour is unchanged.
 */
function LazyPanel({
  open,
  component: Component,
}: {
  open: (s: UIState) => boolean;
  component: ComponentType;
}) {
  const isOpen = useUIStore(open);
  if (!isOpen) return null;
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  );
}

export function OverlayRoot() {
  // Install the global Esc-to-close handler (panelEsc.ts). Safe to call
  // multiple times — the installer is idempotent.
  useEffect(() => installPanelEscHandler(), []);

  // Bridge Phaser game events to React toasts.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let disposed = false;
    import("@/main").then(({ game }) => {
      if (disposed || !game?.events) return;
      const handler = (payload: {
        id: string;
        name: string;
        description: string;
        rewards: { mesos?: number; exp?: number; title?: string };
      }) => {
        const parts: string[] = [payload.description];
        if (payload.rewards.mesos) parts.push(`+${payload.rewards.mesos} mesos`);
        if (payload.rewards.exp) parts.push(`+${payload.rewards.exp} EXP`);
        if (payload.rewards.title) parts.push(`Title: ${payload.rewards.title}`);
        toast.success(`🏆 ${payload.name}`, { description: parts.join(" · ") });
      };
      game.events.on("achievement-unlock", handler);

      // MapleStory-style item-get toast when loot is picked up.
      const itemHandler = (payload: { defId: string; name: string; legendary: boolean }) => {
        const icon = slotItemIcon(payload.defId);
        const iconEl = icon
          ? isImageIcon(icon)
            ? `<img src="${icon}" width="24" height="24" style="vertical-align:middle;margin-right:6px;border-radius:3px" />`
            : `<span style="font-size:18px;margin-right:4px">${icon}</span>`
          : "";
        const tier = payload.legendary ? "Legendary" : "";
        toast.success(`${iconEl} Acquired: ${payload.name}`, {
          description: tier ? `${tier} item` : undefined,
          duration: 2500,
          style: payload.legendary
            ? { borderColor: "#ffc847", background: "rgba(255,200,71,0.08)" }
            : undefined,
        });
      };
      game.events.on("item-acquired", itemHandler);

      unsub = () => {
        game.events.off("achievement-unlock", handler);
        game.events.off("item-acquired", itemHandler);
      };
    });
    return () => {
      disposed = true;
      unsub?.();
    };
  }, []);
  return (
    <>
      <MinimumResolutionNotice />
      <HUD />
      <CharacterSelectPanel />
      <CharacterCreatePanel />
      <InventoryPanel />
      <DialogPanel />
      <QuestOfferPanel />
      <QuestLogPanel />
      <StatusEffects />
      <ReportDialog />
      <ChannelSelectPanel />
      <CoachMarks />
      <IntroPanel />
      <LoginPanel />

      {/* Heavy, on-demand panels — code-split, fetched on first open. */}
      <LazyPanel open={(s) => s.marketOpen} component={MarketPanel} />
      <LazyPanel open={(s) => s.cashShopOpen} component={CashShopPanel} />
      <LazyPanel open={(s) => s.shopOpen} component={GeneralStorePanel} />
      <LazyPanel open={(s) => s.settingsOpen} component={SettingsPanel} />
      <LazyPanel open={(s) => s.guildOpen} component={GuildPanel} />
      <LazyPanel open={(s) => s.tradeOpen} component={TradePanel} />
      <LazyPanel open={(s) => s.storageOpen} component={StoragePanel} />
      <LazyPanel open={(s) => s.partyOpen} component={PartyPanel} />
      <LazyPanel open={(s) => s.friendsOpen} component={FriendsPanel} />
      <LazyPanel open={(s) => s.skillTreeOpen} component={SkillTreePanel} />
      <LazyPanel open={(s) => s.statPanelOpen} component={StatsPanel} />
      <LazyPanel open={(s) => s.equipmentOpen} component={EquipmentPanel} />
      <LazyPanel open={(s) => s.helpOpen} component={HelpPanel} />
      <LazyPanel open={(s) => s.worldMap.open} component={WorldMapPanel} />

      <Toaster position="top-center" />
    </>
  );
}
