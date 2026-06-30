import { useEffect, useRef, useState } from "react";
import { Coins, PackageOpen } from "lucide-react";
import { toast } from "sonner";

import { ShopLayout } from "@/ui/components/economy/ShopLayout";
import { ItemListRow } from "@/ui/components/economy/ItemListRow";
import { PriceTag } from "@/ui/components/economy/PriceTag";
import { QuantityStepper } from "@/ui/components/economy/QuantityStepper";
import { BuySellButtons } from "@/ui/components/economy/BuySellButtons";
import { WalletBar } from "@/ui/components/economy/WalletBar";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { EmptyState } from "@/ui/components/EmptyState";
import { Badge } from "@/ui/components/ui/badge";
import { useUIStore } from "@/ui/store";

/**
 * GeneralStorePanel — the NPC General Store overlay (mesos buy/sell).
 *
 * React migration of the legacy `GeneralStoreScene` Phaser window. Reads its
 * snapshot + action registry from the bridge store and renders entirely from the
 * shared economy kit (ShopLayout / ItemListRow / PriceTag / QuantityStepper /
 * BuySellButtons / WalletBar). All game state changes flow through
 * `shopActions.*`, which `GeneralStoreScene` wires to authoritative
 * `room.send(...)` messages.
 */

type Tab = "buy" | "sell";

interface PendingBuy {
  kind: "buy";
  itemId: string;
  name: string;
  qty: number;
  total: number;
}
interface PendingSell {
  kind: "sell";
  uid: string;
  name: string;
  price: number;
}
type Pending = PendingBuy | PendingSell;

export function GeneralStorePanel() {
  const open = useUIStore((s) => s.shopOpen);
  const shop = useUIStore((s) => s.shop);
  const actions = useUIStore((s) => s.shopActions);

  const [tab, setTab] = useState<Tab>("buy");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<Pending | null>(null);

  // Toast on every buy/sell result pushed by the scene.
  const lastFeedback = useRef<number>(0);
  useEffect(() => {
    const fb = shop.feedback;
    if (!fb || fb.id === lastFeedback.current) return;
    lastFeedback.current = fb.id;
    if (fb.ok) toast.success(fb.message);
    else toast.error(fb.message);
  }, [shop.feedback]);

  if (!open) return null;

  const close = () => actions?.close();
  const qtyOf = (itemId: string) => qty[itemId] ?? 1;
  const setItemQty = (itemId: string, n: number) => setQty((q) => ({ ...q, [itemId]: n }));

  const wallet = <WalletBar balances={[{ amount: shop.mesos, label: "mesos", icon: Coins }]} />;

  return (
    <>
      <ShopLayout
        title={shop.title}
        subtitle="General Store"
        hotkey="Esc"
        wallet={wallet}
        tabs={[
          { value: "buy", label: "Buy" },
          { value: "sell", label: "Sell" },
        ]}
        activeTab={tab}
        onTabChange={(v) => setTab(v as Tab)}
        onClose={close}
      >
        {tab === "buy" ? (
          shop.buy.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title="This shop has no items."
              description="Come back later — the merchant restocks over time."
            />
          ) : (
            shop.buy.map((slot) => {
              const q = qtyOf(slot.itemId);
              const total = slot.buyPrice * q;
              const canAfford = shop.mesos >= total;
              return (
                <ItemListRow
                  key={slot.itemId}
                  title={slot.name}
                  meta={q > 1 ? `${q} × ${slot.buyPrice} = ${total} mesos` : undefined}
                  trailing={
                    <>
                      <PriceTag amount={slot.buyPrice} affordable={canAfford} />
                      {slot.isConsumable && (
                        <QuantityStepper
                          value={q}
                          min={1}
                          max={99}
                          onChange={(n) => setItemQty(slot.itemId, n)}
                        />
                      )}
                      <BuySellButtons
                        onBuy={() =>
                          setPending({
                            kind: "buy",
                            itemId: slot.itemId,
                            name: slot.name,
                            qty: q,
                            total,
                          })
                        }
                        buyDisabled={!canAfford}
                      />
                    </>
                  }
                />
              );
            })
          )
        ) : shop.sell.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title="Nothing to sell."
            description="Items you can sell back to the shop appear here."
          />
        ) : (
          shop.sell.map((entry) => (
            <ItemListRow
              key={entry.uid}
              title={entry.name}
              badges={
                entry.count > 1 ? <Badge variant="secondary">×{entry.count}</Badge> : undefined
              }
              trailing={
                <>
                  <PriceTag amount={entry.sellPrice} />
                  <BuySellButtons
                    onSell={() =>
                      setPending({
                        kind: "sell",
                        uid: entry.uid,
                        name: entry.name,
                        price: entry.sellPrice,
                      })
                    }
                  />
                </>
              }
            />
          ))
        )}
      </ShopLayout>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === "sell" ? "Sell item?" : "Confirm purchase"}
        description={
          pending?.kind === "buy"
            ? `Buy ${pending.qty}× ${pending.name} for ${pending.total.toLocaleString()} mesos?`
            : pending?.kind === "sell"
              ? `Sell ${pending.name} for ${pending.price.toLocaleString()} mesos?`
              : undefined
        }
        confirmLabel={pending?.kind === "sell" ? "Sell" : "Buy"}
        onConfirm={() => {
          if (!pending) return;
          if (pending.kind === "buy") actions?.buy(pending.itemId, pending.qty);
          else actions?.sell(pending.uid, 1);
          setPending(null);
        }}
      />
    </>
  );
}
