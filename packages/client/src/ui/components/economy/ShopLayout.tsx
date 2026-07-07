import * as React from "react";

import { Panel } from "@/ui/components/Panel";
import { Tabs, TabsList, TabsTrigger } from "@/ui/components/ui/tabs";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { cn } from "@/ui/lib/utils";
import { focusPanelForEsc } from "@/ui/panelEsc";

/**
 * ShopLayout — the standard centered buy/sell window shared by every economy
 * panel (General Store, Cash Shop, …).
 *
 * Renders a click-blocking scrim, the shared {@link Panel} chrome (title +
 * close), a header with a `wallet` slot, an optional shadcn `Tabs` bar, and a
 * scrolling content body. It is fully generic and props-driven — panels pass
 * their tab list, the active tab's content, and a wallet readout. Never
 * re-implement the shop window chrome.
 */
export interface ShopTab {
  value: string;
  label: React.ReactNode;
}

export interface ShopLayoutProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  hotkey?: string;
  /** WalletBar (or any balance readout) rendered at the top-right of the header. */
  wallet?: React.ReactNode;
  tabs?: ShopTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  onClose: () => void;
  /** Body for the active tab. Rendered inside a fixed-height scroll area. */
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Panel width. Default `w-[720px]`. */
  widthClassName?: string;
  /** Scroll body height. Default `h-[380px]`. */
  bodyHeightClassName?: string;
}

export function ShopLayout({
  title,
  subtitle,
  hotkey,
  wallet,
  tabs,
  activeTab,
  onTabChange,
  onClose,
  children,
  footer,
  widthClassName = "w-[720px]",
  bodyHeightClassName = "h-[380px]",
}: ShopLayoutProps) {
  return (
    <div
      data-slot="shop-layout-scrim"
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onPointerDown={() => focusPanelForEsc(onClose)}
    >
      <Panel
        title={
          <span className="flex flex-col">
            <span className="text-base font-bold tracking-wide">{title}</span>
            {subtitle && (
              <span className="text-[11px] font-normal text-muted-foreground">{subtitle}</span>
            )}
          </span>
        }
        hotkey={hotkey}
        onClose={onClose}
        headerExtra={wallet}
        className={cn("max-w-[min(92vw,calc(100vw-2rem))]", widthClassName)}
      >
        {tabs && tabs.length > 0 && (
          <Tabs value={activeTab} onValueChange={onTabChange} className="mb-3">
            <TabsList>
              {tabs.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <ScrollArea className={cn("pr-3", bodyHeightClassName)}>
          <div className="flex flex-col gap-1.5">{children}</div>
        </ScrollArea>

        {footer && (
          <div className="mt-3 border-t border-border pt-2.5 text-center text-[11px] text-muted-foreground">
            {footer}
          </div>
        )}
      </Panel>
    </div>
  );
}
