import { useEffect, useRef, useState } from "react";
import { Coins, Lock, Check, Plus, X, Handshake, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import {
  getItemDef,
  getBaseRankInfo,
  getPotentialTierInfo,
  type BaseRank,
  type PotentialTier,
} from "@maple/shared";

import { Panel } from "@/ui/components/Panel";
import { ItemListRow } from "@/ui/components/economy/ItemListRow";
import { CurrencyDisplay } from "@/ui/components/CurrencyDisplay";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { EmptyState } from "@/ui/components/EmptyState";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Badge } from "@/ui/components/ui/badge";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { Separator } from "@/ui/components/ui/separator";
import { useUIStore, type TradeItemSnapshot } from "@/ui/store";

/**
 * TradePanel — the player-to-player direct trade overlay.
 *
 * React migration of the legacy `TradeScene` Phaser window. Reads its snapshot +
 * action registry from the bridge store and renders entirely from the shared
 * kit (Panel / ItemListRow / CurrencyDisplay / ConfirmDialog / Button / …). All
 * game state changes flow through `tradeActions.*`, which `TradeScene` wires to
 * authoritative `room.send(...)` messages.
 *
 * The two-phase safety flow is preserved exactly and is server-authoritative:
 *   1. offering — either side adds/removes items + mesos
 *   2. ready    — each side LOCKs; both must lock before confirm is allowed
 *   3. confirm  — each side CONFIRMs; the trade executes only when both have
 * A final ConfirmDialog guards the irreversible Confirm click.
 */

/** A rarity-colored item row shared by both offer columns. */
function TradeRow({ item, trailing }: { item: TradeItemSnapshot; trailing?: React.ReactNode }) {
  const def = getItemDef(item.defId);
  const tier = getPotentialTierInfo(item.potentialTier as PotentialTier);
  const rank = getBaseRankInfo(item.baseRank as BaseRank);
  return (
    <ItemListRow
      leading={
        <span
          className="size-3 rounded-[3px] border border-black/40"
          style={{ backgroundColor: tier.color }}
        />
      }
      title={<span style={{ color: rank.color }}>{def?.name ?? item.defId}</span>}
      badges={item.count > 1 ? <Badge variant="secondary">×{item.count}</Badge> : undefined}
      meta={tier.label}
      trailing={trailing}
    />
  );
}

export function TradePanel() {
  const open = useUIStore((s) => s.tradeOpen);
  const trade = useUIStore((s) => s.trade);
  const actions = useUIStore((s) => s.tradeActions);

  const [mesosDraft, setMesosDraft] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmFinal, setConfirmFinal] = useState(false);

  // Toast on every trade result/cancel pushed by the scene.
  const lastFeedback = useRef<number>(0);
  useEffect(() => {
    const fb = trade.feedback;
    if (!fb || fb.id === lastFeedback.current) return;
    lastFeedback.current = fb.id;
    if (fb.ok) toast.success(fb.message);
    else toast.error(fb.message);
  }, [trade.feedback]);

  if (!open) return null;

  const {
    partnerName,
    myOffer,
    myMesos,
    partnerOffer,
    partnerMesos,
    available,
    myLocked,
    partnerLocked,
    myConfirmed,
    partnerConfirmed,
  } = trade;

  const canLock = !myLocked && !myConfirmed;
  const canConfirm = myLocked && partnerLocked && !myConfirmed;

  let status: string;
  if (myConfirmed && partnerConfirmed) status = "Trade complete!";
  else if (myLocked && partnerLocked) status = "Both ready — confirm to finalize.";
  else if (myLocked) status = "You're ready. Waiting for partner…";
  else if (partnerLocked) status = "Partner is ready. Lock when ready.";
  else status = "Offer items and mesos, then lock when ready.";

  const submitMesos = () => {
    const val = Number.parseInt(mesosDraft || "0", 10);
    if (Number.isFinite(val) && val >= 0) actions?.setMesos(val);
    setMesosDraft("");
  };

  return (
    <div
      data-slot="trade-scrim"
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
    >
      <Panel
        title={partnerName ? `Trade with ${partnerName}` : "Trade"}
        onClose={() => setConfirmCancel(true)}
        className="w-[720px] max-w-[92vw]"
        headerExtra={
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Handshake className="size-3.5" /> direct trade
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {/* ── Your offer ── */}
          <section className="flex flex-col rounded-lg border border-border bg-card/40 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wide">Your Offer</h3>
              {myLocked && (
                <Badge className="gap-1 bg-amber-600 text-white">
                  <Lock className="size-3" /> Locked
                </Badge>
              )}
            </div>

            <ScrollArea className="h-[150px] pr-2">
              <div className="flex flex-col gap-1.5">
                {myOffer.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                    Nothing offered yet.
                  </p>
                ) : (
                  myOffer.map((item) => (
                    <TradeRow
                      key={item.uid}
                      item={item}
                      trailing={
                        !myLocked && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            onClick={() => actions?.remove(item.uid)}
                            aria-label="Remove from offer"
                          >
                            <X className="size-3.5" />
                          </Button>
                        )
                      }
                    />
                  ))
                )}
              </div>
            </ScrollArea>

            <div className="mt-2 flex items-center gap-2">
              <CurrencyDisplay amount={myMesos} label="mesos" />
              {!myLocked && (
                <form
                  className="ml-auto flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitMesos();
                  }}
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="mesos"
                    value={mesosDraft}
                    onChange={(e) => setMesosDraft(e.target.value)}
                    className="h-7 w-24 px-2 text-right text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label="Mesos to offer"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    <Coins className="size-3.5" /> Set
                  </Button>
                </form>
              )}
            </div>

            {!myLocked && (
              <>
                <Separator className="my-2.5" />
                <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
                  Available — click to offer
                </p>
                <ScrollArea className="h-[130px] pr-2">
                  <div className="flex flex-col gap-1.5">
                    {available.length === 0 ? (
                      <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                        No more items.
                      </p>
                    ) : (
                      available.map((item) => (
                        <TradeRow
                          key={item.uid}
                          item={item}
                          trailing={
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="size-7"
                              onClick={() => actions?.add(item.uid)}
                              aria-label="Add to offer"
                            >
                              <Plus className="size-3.5" />
                            </Button>
                          }
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </>
            )}
          </section>

          {/* ── Partner's offer (read-only) ── */}
          <section className="flex flex-col rounded-lg border border-border bg-card/40 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wide">
                {partnerName ? `${partnerName}'s Offer` : "Partner's Offer"}
              </h3>
              <div className="flex items-center gap-1.5">
                {partnerLocked && (
                  <Badge className="gap-1 bg-amber-600 text-white">
                    <Lock className="size-3" /> Locked
                  </Badge>
                )}
                {partnerConfirmed && (
                  <Badge className="gap-1 bg-emerald-600 text-white">
                    <CircleCheck className="size-3" /> Confirmed
                  </Badge>
                )}
              </div>
            </div>

            <ScrollArea className="h-[150px] pr-2">
              <div className="flex flex-col gap-1.5">
                {partnerOffer.length === 0 && partnerMesos === 0 ? (
                  <EmptyState
                    icon={Handshake}
                    title="Waiting for partner…"
                    description="Their offered items appear here."
                  />
                ) : (
                  partnerOffer.map((item) => <TradeRow key={item.uid} item={item} />)
                )}
              </div>
            </ScrollArea>

            <div className="mt-2 flex items-center">
              <CurrencyDisplay amount={partnerMesos} label="mesos" />
            </div>
          </section>
        </div>

        {/* ── Footer: status + safety-flow controls ── */}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <p
            className={
              "text-[11px] " +
              (myConfirmed && partnerConfirmed
                ? "font-semibold text-emerald-400"
                : "text-muted-foreground")
            }
          >
            {status}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={myLocked ? "secondary" : "default"}
              disabled={!canLock}
              onClick={() => actions?.ready()}
            >
              <Lock className="size-4" />
              {myLocked ? "Ready" : "Lock"}
            </Button>
            <Button
              type="button"
              disabled={!canConfirm}
              onClick={() => setConfirmFinal(true)}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              <Check className="size-4" />
              {myConfirmed ? "Confirmed" : "Confirm"}
            </Button>
            <Button type="button" variant="destructive" onClick={() => setConfirmCancel(true)}>
              <X className="size-4" /> Cancel
            </Button>
          </div>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel trade?"
        description="The trade will be called off for both players."
        confirmLabel="Cancel trade"
        cancelLabel="Keep trading"
        destructive
        onConfirm={() => {
          setConfirmCancel(false);
          actions?.cancel();
        }}
      />

      <ConfirmDialog
        open={confirmFinal}
        onOpenChange={setConfirmFinal}
        title="Confirm this trade?"
        description="Both sides are ready. Confirming commits the exchange."
        confirmLabel="Confirm trade"
        onConfirm={() => {
          setConfirmFinal(false);
          actions?.confirm();
        }}
      />
    </div>
  );
}
