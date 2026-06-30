import { useEffect, useRef } from "react";
import { Vault, PackageOpen, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
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
import { EmptyState } from "@/ui/components/EmptyState";
import { Button } from "@/ui/components/ui/button";
import { Badge } from "@/ui/components/ui/badge";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { useUIStore, type StorageItemSnapshot } from "@/ui/store";

/**
 * StoragePanel — the account-wide stash (bank) overlay.
 *
 * React migration of the legacy `StorageScene` Phaser window. Reads its snapshot
 * + action registry from the bridge store and renders entirely from the shared
 * kit (Panel / ItemListRow / EmptyState / Button / …). All game state changes
 * flow through `storageActions.*`, which `StorageScene` wires to authoritative
 * `room.send(...)` messages.
 *
 * Capacity rules are preserved exactly: Deposit is disabled when the stash is
 * full (`stash.length >= stashCapacity`); Withdraw is disabled when the bag is
 * full (`bagged.length >= inventoryCapacity`).
 */

function StorageRow({
  item,
  trailing,
  dimmed,
}: {
  item: StorageItemSnapshot;
  trailing: React.ReactNode;
  dimmed: boolean;
}) {
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
      title={
        <span style={{ color: dimmed ? undefined : rank.color }}>{def?.name ?? item.defId}</span>
      }
      badges={item.count > 1 ? <Badge variant="secondary">×{item.count}</Badge> : undefined}
      trailing={trailing}
    />
  );
}

export function StoragePanel() {
  const open = useUIStore((s) => s.storageOpen);
  const storage = useUIStore((s) => s.storage);
  const actions = useUIStore((s) => s.storageActions);

  // Toast on every deposit/withdraw result pushed by the scene.
  const lastFeedback = useRef<number>(0);
  useEffect(() => {
    const fb = storage.feedback;
    if (!fb || fb.id === lastFeedback.current) return;
    lastFeedback.current = fb.id;
    if (fb.ok) toast.success(fb.message);
    else toast.error(fb.message);
  }, [storage.feedback]);

  if (!open) return null;

  const { bagged, stash, stashCapacity, inventoryCapacity } = storage;
  const stashFull = stash.length >= stashCapacity;
  const bagFull = bagged.length >= inventoryCapacity;

  return (
    <div
      data-slot="storage-scrim"
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
    >
      <Panel
        title={
          <span className="flex items-center gap-2">
            <Vault className="size-4 text-amber-400" /> Storage Vault
          </span>
        }
        hotkey="B"
        onClose={() => actions?.close()}
        className="w-[720px] max-w-[92vw]"
        headerExtra={
          <Badge variant={stashFull ? "destructive" : "secondary"}>
            {stash.length} / {stashCapacity}
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {/* ── Your items (deposit) ── */}
          <section className="flex flex-col rounded-lg border border-border bg-card/40 p-2.5">
            <h3 className="mb-2 text-xs font-bold tracking-wide">
              Your Items{" "}
              <span className="font-normal text-muted-foreground">· {bagged.length}</span>
            </h3>
            <ScrollArea className="h-[320px] pr-2">
              <div className="flex flex-col gap-1.5">
                {bagged.length === 0 ? (
                  <EmptyState
                    icon={PackageOpen}
                    title="No items to deposit."
                    description="Go hunt for loot!"
                  />
                ) : (
                  bagged.map((item) => (
                    <StorageRow
                      key={item.uid}
                      item={item}
                      dimmed={stashFull}
                      trailing={
                        <Button
                          type="button"
                          size="sm"
                          disabled={stashFull}
                          onClick={() => actions?.deposit(item.uid)}
                          className="bg-blue-600 text-white hover:bg-blue-500"
                        >
                          <ArrowDownToLine className="size-3.5" /> Deposit
                        </Button>
                      }
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </section>

          {/* ── Stash (withdraw) ── */}
          <section className="flex flex-col rounded-lg border border-border bg-card/40 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wide">
                Stash <span className="font-normal text-muted-foreground">· {stash.length}</span>
              </h3>
              <span className="text-[11px] text-muted-foreground">click to withdraw</span>
            </div>
            <ScrollArea className="h-[320px] pr-2">
              <div className="flex flex-col gap-1.5">
                {stash.length === 0 ? (
                  <EmptyState
                    icon={ArrowRightLeft}
                    title="Stash is empty."
                    description="Deposit items to store them across characters."
                  />
                ) : (
                  stash.map((item) => (
                    <StorageRow
                      key={item.uid}
                      item={item}
                      dimmed={bagFull}
                      trailing={
                        <Button
                          type="button"
                          size="sm"
                          disabled={bagFull}
                          onClick={() => actions?.withdraw(item.uid)}
                          className="bg-amber-600 text-white hover:bg-amber-500"
                        >
                          <ArrowUpFromLine className="size-3.5" /> Withdraw
                        </Button>
                      }
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </section>
        </div>

        <div className="mt-3 border-t border-border pt-2.5 text-center text-[11px] text-muted-foreground">
          {bagFull
            ? "Your bag is full — withdrawals are blocked."
            : stashFull
              ? "Stash is full — deposits are blocked."
              : "Press B or Esc to close"}
        </div>
      </Panel>
    </div>
  );
}
