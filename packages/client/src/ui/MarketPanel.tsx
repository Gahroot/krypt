import { useEffect, useMemo, useRef, useState } from "react";
import {
  Coins,
  Search,
  Gavel,
  Store,
  PackageOpen,
  Tag,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { ShopLayout } from "@/ui/components/economy/ShopLayout";
import { ItemListRow } from "@/ui/components/economy/ItemListRow";
import { PriceTag } from "@/ui/components/economy/PriceTag";
import { BuySellButtons } from "@/ui/components/economy/BuySellButtons";
import { WalletBar } from "@/ui/components/economy/WalletBar";
import { EmptyState } from "@/ui/components/EmptyState";
import { Badge } from "@/ui/components/ui/badge";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/ui/select";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/components/ui/dialog";
import { Label } from "@/ui/components/ui/label";
import { useUIStore, type MarketListing, type MarketWalletItem } from "@/ui/store";

/**
 * MarketPanel — the player-driven Free Market (auction house) overlay.
 *
 * React migration of the legacy ~52KB `MarketScene` Phaser window. Reads its
 * snapshot + action registry from the bridge store and renders entirely from the
 * shared kit + economy components (ShopLayout / ItemListRow / PriceTag /
 * BuySellButtons / WalletBar) plus shadcn table / scroll-area / select / input /
 * dialog / badge. All game state changes flow through `marketActions.*`, which
 * `MarketScene` wires to the authoritative Colyseus `list` / `buy` / `bid` /
 * `cancel` messages.
 *
 * Search, tier filter, sort, and pagination are pure client-side view state over
 * the snapshot's `listings`, exactly as the legacy scene filtered its order book.
 */

type Tab = "browse" | "sell" | "my";

const TIER_FILTERS = [
  { value: "all", label: "All rarities" },
  { value: "RARE", label: "Rare" },
  { value: "EPIC", label: "Epic" },
  { value: "UNIQUE", label: "Unique" },
  { value: "LEGENDARY", label: "Legendary" },
] as const;

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low → High" },
  { value: "price_desc", label: "Price: High → Low" },
] as const;

const PAGE_SIZE = 8;
/** 9 digits stays inside the server's uint32 price field. */
const PRICE_MAX = 999_999_999;

function RarityBadge({ label, color }: { label: string; color: string }) {
  return (
    <Badge variant="outline" style={{ color, borderColor: color }}>
      {label}
    </Badge>
  );
}

function lineLabel(lines: number): string {
  return `${lines} line${lines === 1 ? "" : "s"}`;
}

function endsLabel(endsAt: number): string | null {
  if (!endsAt) return null;
  const ms = endsAt - Date.now();
  if (ms <= 0) return "ended";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m left`;
  return `${Math.floor(m / 60)}h left`;
}

export function MarketPanel() {
  const open = useUIStore((s) => s.marketOpen);
  const market = useUIStore((s) => s.market);
  const actions = useUIStore((s) => s.marketActions);

  const [tab, setTab] = useState<Tab>("browse");
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<string>("all");
  const [sort, setSort] = useState<string>("newest");
  const [page, setPage] = useState(0);

  // Dialogs.
  const [buyTarget, setBuyTarget] = useState<MarketListing | null>(null);
  const [bidTarget, setBidTarget] = useState<MarketListing | null>(null);
  const [bidValue, setBidValue] = useState("");
  const [listItem, setListItem] = useState<MarketWalletItem | null>(null);
  const [listPrice, setListPrice] = useState("");

  // Toast on every market result pushed by the scene (buy/sell/cancel/errors).
  const lastFeedback = useRef<number>(0);
  useEffect(() => {
    const fb = market.feedback;
    if (!fb || fb.id === lastFeedback.current) return;
    lastFeedback.current = fb.id;
    if (fb.ok) toast.success(fb.message);
    else toast.error(fb.message);
  }, [market.feedback]);

  // Reset pagination when the filter inputs or tab change.
  useEffect(() => {
    setPage(0);
  }, [query, tier, sort, tab]);

  const mine = useMemo(() => market.listings.filter((l) => l.mine), [market.listings]);

  const browseRows = useMemo(() => {
    let rows = market.listings.filter((l) => !l.mine);
    if (tier !== "all") rows = rows.filter((l) => l.potentialTier === tier);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (l) => l.name.toLowerCase().includes(q) || l.defId.toLowerCase().includes(q),
      );
    }
    const priceOf = (l: MarketListing) =>
      l.listingType === "auction" && l.currentBid > 0 ? l.currentBid : l.price;
    rows = [...rows].sort((a, b) => {
      if (sort === "price_asc") return priceOf(a) - priceOf(b);
      if (sort === "price_desc") return priceOf(b) - priceOf(a);
      return b.createdAt - a.createdAt;
    });
    return rows;
  }, [market.listings, tier, query, sort]);

  if (!open) return null;

  const close = () => actions?.close();

  const wallet = <WalletBar balances={[{ amount: market.mesos, label: "mesos", icon: Coins }]} />;

  // ── Pagination over the active list (browse / my) ──
  const pagedSource = tab === "my" ? mine : browseRows;
  const pageCount = Math.max(1, Math.ceil(pagedSource.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = pagedSource.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const footer =
    tab === "sell" ? (
      `Market fee ${(market.feeBps / 100).toFixed(market.feeBps % 100 === 0 ? 0 : 2)}% on every sale`
    ) : pagedSource.length > PAGE_SIZE ? (
      <div className="flex items-center justify-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={safePage <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="tabular-nums">
          Page {safePage + 1} / {pageCount} · {pagedSource.length} listings
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    ) : (
      `${pagedSource.length} listing${pagedSource.length === 1 ? "" : "s"}`
    );

  const renderListingsTable = (rows: MarketListing[], owned: boolean) => {
    if (pagedSource.length === 0) {
      return (
        <EmptyState
          icon={owned ? Tag : Store}
          title={
            owned
              ? "You have no active listings."
              : query || tier !== "all"
                ? "No matching listings."
                : "No listings yet."
          }
          description={
            owned
              ? "List an item from the Sell tab to get started."
              : query || tier !== "all"
                ? "Try a different search or rarity filter."
                : "Be the first to sell something on the market!"
          }
        />
      );
    }
    return (
      <ScrollArea className="h-[300px] pr-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Rarity</TableHead>
              <TableHead>{owned ? "Type" : "Seller"}</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => {
              const isAuction = l.listingType === "auction";
              const showPrice = isAuction && l.currentBid > 0 ? l.currentBid : l.price;
              const ends = endsLabel(l.endsAt);
              return (
                <TableRow key={l.listingId}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-semibold" style={{ color: l.tierColor }}>
                        {l.name}
                        {isAuction && " ⚡"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {lineLabel(l.lines)}
                        {ends ? ` · ${ends}` : ""}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RarityBadge label={l.tierLabel} color={l.tierColor} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {owned ? (isAuction ? "Auction" : "Fixed") : l.sellerName || "seller"}
                  </TableCell>
                  <TableCell className="text-right">
                    <PriceTag
                      amount={showPrice}
                      ticker={isAuction && l.currentBid > 0 ? "bid" : undefined}
                      className="justify-end"
                      affordable={owned || market.mesos >= showPrice}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {owned ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => actions?.cancelListing(l.listingId)}
                      >
                        Cancel
                      </Button>
                    ) : isAuction ? (
                      <Button
                        type="button"
                        size="sm"
                        className="bg-blue-600 text-white hover:bg-blue-500"
                        onClick={() => {
                          setBidValue("");
                          setBidTarget(l);
                        }}
                      >
                        <Gavel />
                        Bid
                      </Button>
                    ) : (
                      <BuySellButtons
                        onBuy={() => setBuyTarget(l)}
                        buyDisabled={market.mesos < l.price}
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    );
  };

  // ── Create-listing dialog math ──
  const listPriceNum = Number.parseInt(listPrice || "0", 10);
  const listFee = Math.floor((listPriceNum * market.feeBps) / 10_000);
  const listNet = Math.max(0, listPriceNum - listFee);
  const listValid = Number.isFinite(listPriceNum) && listPriceNum > 0 && listPriceNum <= PRICE_MAX;

  const bidNum = Number.parseInt(bidValue || "0", 10);
  const bidValid =
    Number.isFinite(bidNum) &&
    bidNum > 0 &&
    bidNum <= PRICE_MAX &&
    (!bidTarget || bidNum > bidTarget.currentBid);

  return (
    <>
      <ShopLayout
        title="Free Market"
        subtitle={market.connected ? "Off-chain · Mesos" : "Connecting to market…"}
        hotkey="M"
        wallet={wallet}
        widthClassName="w-[900px]"
        bodyHeightClassName="min-h-[360px]"
        tabs={[
          { value: "browse", label: "Browse" },
          { value: "sell", label: "Sell" },
          {
            value: "my",
            label: mine.length ? `My Listings (${mine.length})` : "My Listings",
          },
        ]}
        activeTab={tab}
        onTabChange={(v) => setTab(v as Tab)}
        onClose={close}
        footer={footer}
      >
        {tab === "browse" && (
          <>
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search items…"
                  className="pl-8"
                  aria-label="Search listings"
                />
              </div>
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger className="w-[150px]" aria-label="Filter by rarity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_FILTERS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-[170px]" aria-label="Sort listings">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {renderListingsTable(pageRows, false)}
          </>
        )}

        {tab === "sell" &&
          (market.walletItems.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title="No items to sell."
              description="Loot some gear in the field, then list it here for mesos."
            />
          ) : (
            <ScrollArea className="h-[330px] pr-3">
              <div className="flex flex-col gap-1.5">
                {market.walletItems.map((item) => (
                  <ItemListRow
                    key={item.uid}
                    leading={
                      <span
                        className="size-3 rounded-sm"
                        style={{ backgroundColor: item.tierColor }}
                      />
                    }
                    title={<span style={{ color: item.tierColor }}>{item.name}</span>}
                    meta={`${item.tierLabel} · ${lineLabel(item.lines)}`}
                    badges={
                      item.count > 1 ? <Badge variant="secondary">×{item.count}</Badge> : undefined
                    }
                    trailing={
                      <BuySellButtons
                        onSell={() => {
                          setListPrice("");
                          setListItem(item);
                        }}
                        sellLabel="List"
                      />
                    }
                  />
                ))}
              </div>
            </ScrollArea>
          ))}

        {tab === "my" && renderListingsTable(pageRows, true)}
      </ShopLayout>

      {/* ── Purchase confirm ── */}
      <Dialog open={buyTarget !== null} onOpenChange={(o) => !o && setBuyTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm purchase</DialogTitle>
            <DialogDescription>
              {buyTarget && <span style={{ color: buyTarget.tierColor }}>{buyTarget.name}</span>}
              {buyTarget && ` · ${buyTarget.tierLabel} · from ${buyTarget.sellerName || "seller"}`}
            </DialogDescription>
          </DialogHeader>
          {buyTarget && (
            <div className="flex items-center justify-between rounded-md border border-border bg-card/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">You pay</span>
              <PriceTag amount={buyTarget.price} />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBuyTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-500"
              disabled={!buyTarget || market.mesos < buyTarget.price}
              onClick={() => {
                if (buyTarget) actions?.buy(buyTarget.listingId);
                setBuyTarget(null);
              }}
            >
              Buy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Place bid ── */}
      <Dialog open={bidTarget !== null} onOpenChange={(o) => !o && setBidTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Place bid</DialogTitle>
            <DialogDescription>
              {bidTarget && <span style={{ color: bidTarget.tierColor }}>{bidTarget.name}</span>}
              {bidTarget && ` · current bid ${bidTarget.currentBid.toLocaleString()} mesos`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bid-amount">Your bid (mesos)</Label>
            <Input
              id="bid-amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={PRICE_MAX}
              value={bidValue}
              onChange={(e) => setBidValue(e.target.value)}
              placeholder="0"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBidTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-blue-600 text-white hover:bg-blue-500"
              disabled={!bidValid}
              onClick={() => {
                if (bidTarget && bidValid) actions?.bid(bidTarget.listingId, bidNum);
                setBidTarget(null);
              }}
            >
              <Gavel />
              Bid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create listing ── */}
      <Dialog open={listItem !== null} onOpenChange={(o) => !o && setListItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>List for sale</DialogTitle>
            <DialogDescription>
              {listItem && <span style={{ color: listItem.tierColor }}>{listItem.name}</span>}
              {listItem && ` · ${listItem.tierLabel} · ${lineLabel(listItem.lines)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="list-price">Price (mesos)</Label>
            <Input
              id="list-price"
              type="number"
              inputMode="numeric"
              min={1}
              max={PRICE_MAX}
              value={listPrice}
              onChange={(e) => setListPrice(e.target.value)}
              placeholder="0"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
            <span>
              After {(market.feeBps / 100).toFixed(market.feeBps % 100 === 0 ? 0 : 2)}% fee
            </span>
            <span className="tabular-nums">
              You receive ≈{" "}
              <span className="font-semibold text-yellow-400">{listNet.toLocaleString()}</span>{" "}
              mesos
            </span>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setListItem(null)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 text-white hover:bg-amber-500"
              disabled={!listValid}
              onClick={() => {
                if (listItem && listValid) actions?.createListing(listItem.uid, listPriceNum);
                setListItem(null);
              }}
            >
              <Tag />
              List item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
