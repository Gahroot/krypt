import { useEffect, useRef, useState } from "react";
import { Gem, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { CashCategory } from "@maple/shared";

import { ShopLayout } from "@/ui/components/economy/ShopLayout";
import { ItemListRow } from "@/ui/components/economy/ItemListRow";
import { PriceTag } from "@/ui/components/economy/PriceTag";
import { BuySellButtons } from "@/ui/components/economy/BuySellButtons";
import { WalletBar } from "@/ui/components/economy/WalletBar";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { EmptyState } from "@/ui/components/EmptyState";
import { Button } from "@/ui/components/ui/button";
import { Badge } from "@/ui/components/ui/badge";
import { useUIStore, type CashShopItem } from "@/ui/store";

/**
 * CashShopPanel — the premium cosmetic shop overlay (Maple Crystals, not mesos).
 *
 * React migration of the legacy `CashShopScene`. Reads its snapshot + action
 * registry from the bridge store and renders entirely from the shared economy
 * kit. Purchases flow through `cashShopActions.buy`; equip/unequip through
 * `cashShopActions.equip` — both wired by `CashShopScene` to authoritative
 * `room.send(...)` messages.
 */

type Tab = "browse" | "owned";

/** Display order for the browse tab (classic Cash Shop grouping). */
const CATEGORY_ORDER: CashCategory[] = [
  "hair",
  "face",
  "outfit",
  "weapon-skin",
  "pet",
  "effect",
  "consumable",
];

/** Per-category swatch color (Tailwind classes) for quick visual scanning. */
const CATEGORY_SWATCH: Record<CashCategory, string> = {
  hair: "bg-pink-400",
  face: "bg-amber-400",
  outfit: "bg-blue-400",
  "weapon-skin": "bg-red-400",
  pet: "bg-emerald-400",
  effect: "bg-purple-400",
  consumable: "bg-orange-400",
};

function Swatch({ category }: { category: CashCategory }) {
  return <span className={`size-3 rounded-sm ${CATEGORY_SWATCH[category]}`} aria-hidden />;
}

export function CashShopPanel() {
  const open = useUIStore((s) => s.cashShopOpen);
  const cash = useUIStore((s) => s.cashShop);
  const actions = useUIStore((s) => s.cashShopActions);

  const [tab, setTab] = useState<Tab>("browse");
  const [pending, setPending] = useState<CashShopItem | null>(null);

  const lastFeedback = useRef<number>(0);
  useEffect(() => {
    const fb = cash.feedback;
    if (!fb || fb.id === lastFeedback.current) return;
    lastFeedback.current = fb.id;
    if (fb.ok) toast.success(fb.message);
    else toast.error(fb.message);
  }, [cash.feedback]);

  if (!open) return null;

  const close = () => actions?.close();

  const wallet = (
    <WalletBar
      balances={[
        {
          amount: cash.balance,
          label: cash.ticker,
          icon: Gem,
          colorClassName: "text-violet-300",
        },
      ]}
    />
  );

  const ownedItems = cash.items.filter((it) => it.owned);

  return (
    <>
      <ShopLayout
        title="Cash Shop"
        subtitle={
          <>
            Premium · {cash.currencyLabel} ·{" "}
            <span className="text-amber-400 font-semibold">ALPHA — Test Currency</span>
          </>
        }
        hotkey="P"
        wallet={wallet}
        tabs={[
          { value: "browse", label: "Browse" },
          { value: "owned", label: "My Cosmetics" },
        ]}
        activeTab={tab}
        onTabChange={(v) => setTab(v as Tab)}
        onClose={close}
        widthClassName="w-[760px]"
        footer="Maple Crystals are test currency during alpha. No real money is involved."
      >
        {tab === "browse" ? (
          cash.items.length === 0 ? (
            <EmptyState icon={Sparkles} title="No items in the catalog." />
          ) : (
            CATEGORY_ORDER.map((category) => {
              const items = cash.items.filter((it) => it.category === category);
              if (items.length === 0) return null;
              return (
                <div key={category} className="flex flex-col gap-1.5">
                  <h3 className="mt-1.5 px-1 text-xs font-bold text-sky-300">
                    {items[0]!.categoryLabel}
                  </h3>
                  {items.map((item) => (
                    <ItemListRow
                      key={item.id}
                      leading={<Swatch category={item.category} />}
                      title={item.name}
                      badges={
                        item.durationDays ? (
                          <Badge variant="outline">{item.durationDays}d</Badge>
                        ) : undefined
                      }
                      trailing={
                        item.owned ? (
                          <Badge className="bg-emerald-600 text-white">Owned</Badge>
                        ) : (
                          <>
                            <PriceTag
                              amount={item.price}
                              ticker={cash.ticker}
                              icon={Gem}
                              colorClassName="text-violet-300"
                              affordable={cash.balance >= item.price}
                            />
                            <BuySellButtons
                              onBuy={() => setPending(item)}
                              buyDisabled={cash.balance < item.price}
                            />
                          </>
                        )
                      }
                    />
                  ))}
                </div>
              );
            })
          )
        ) : ownedItems.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No cosmetics owned yet."
            description="Browse the shop to buy some!"
          />
        ) : (
          ownedItems.map((item) => {
            const meta = [item.categoryLabel];
            if (item.durationDays) meta.push(`${item.durationDays}d`);
            return (
              <ItemListRow
                key={item.id}
                leading={<Swatch category={item.category} />}
                title={item.name}
                meta={meta.join(" · ")}
                highlighted={item.equipped}
                trailing={
                  item.hasAppearance ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={item.equipped ? "destructive" : "default"}
                      onClick={() => actions?.equip(item.id)}
                    >
                      {item.equipped ? "Unequip" : "Equip"}
                    </Button>
                  ) : (
                    <Badge variant="outline">{item.category === "consumable" ? "Use" : "—"}</Badge>
                  )
                }
              />
            );
          })
        )}
      </ShopLayout>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title="Confirm purchase"
        description={
          pending
            ? `Purchase ${pending.name} for ${pending.price.toLocaleString()} ${cash.ticker}?`
            : undefined
        }
        confirmLabel="Buy"
        onConfirm={() => {
          if (pending) actions?.buy(pending.id);
          setPending(null);
        }}
      />
    </>
  );
}
