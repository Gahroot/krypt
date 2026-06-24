/**
 * Durable persistence for the off-chain economy: player accounts (Mesos + owned items) and the
 * global Free-Market order book. In-memory with debounced JSON snapshots under `.data/`.
 *
 * Both TownRoom and MarketRoom share these singletons, so the loop is real: loot an item in town →
 * it lands in your account → open the market → list it → another account buys it → Mesos move.
 *
 * This is the off-chain economy. The on-chain Premium Market ($MAPLE, NFTs) is Phase 2; this layer
 * is exactly what gets mirrored on-chain later.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Overridable so deployments (and isolated tests) can point persistence elsewhere.
const DATA_DIR = process.env.DATA_DIR || ".data";
const ACCOUNTS_FILE = `${DATA_DIR}/accounts.json`;
const LISTINGS_FILE = `${DATA_DIR}/listings.json`;

/** Mesos granted to a brand-new account so the market is immediately explorable. */
const STARTER_MESOS = 300;

export interface ItemRecord {
  uid: string;
  defId: string;
  baseRank: string;
  potentialTier: string;
  lines: number;
  minted: boolean;
}

export interface Account {
  accountId: string;
  mesos: number;
  inventory: Record<string, ItemRecord>;
}

export interface ListingRecord {
  listingId: string;
  sellerId: string;
  sellerName: string;
  item: ItemRecord;
  price: number;
  createdAt: number;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    console.warn(`[store] could not read ${file}:`, (err as Error).message);
  }
  return fallback;
}

function writeJsonAtomic(file: string, data: unknown): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

/** Debounce file writes so frequent mutations (kills, pickups) don't thrash the disk. */
function debounced(fn: () => void, ms: number): () => void {
  let t: NodeJS.Timeout | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}

class AccountStore {
  private accounts = new Map<string, Account>();
  private flush = debounced(() => this.persistNow(), 750);

  constructor() {
    const raw = readJson<Record<string, Account>>(ACCOUNTS_FILE, {});
    for (const [id, acc] of Object.entries(raw)) this.accounts.set(id, acc);
  }

  getOrCreate(accountId: string): Account {
    let acc = this.accounts.get(accountId);
    if (!acc) {
      acc = { accountId, mesos: STARTER_MESOS, inventory: {} };
      this.accounts.set(accountId, acc);
      this.flush();
    }
    return acc;
  }

  setMesos(accountId: string, mesos: number): void {
    this.getOrCreate(accountId).mesos = Math.max(0, Math.floor(mesos));
    this.flush();
  }

  addMesos(accountId: string, delta: number): number {
    const acc = this.getOrCreate(accountId);
    acc.mesos = Math.max(0, acc.mesos + Math.floor(delta));
    this.flush();
    return acc.mesos;
  }

  /** Returns true and deducts if affordable; false otherwise. */
  spendMesos(accountId: string, amount: number): boolean {
    const acc = this.getOrCreate(accountId);
    if (acc.mesos < amount) return false;
    acc.mesos -= amount;
    this.flush();
    return true;
  }

  addItem(accountId: string, item: ItemRecord): void {
    this.getOrCreate(accountId).inventory[item.uid] = item;
    this.flush();
  }

  removeItem(accountId: string, uid: string): ItemRecord | undefined {
    const acc = this.getOrCreate(accountId);
    const item = acc.inventory[uid];
    // inventory is a plain Record persisted as JSON; deleting the key is the intended removal.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    if (item) delete acc.inventory[uid];
    this.flush();
    return item;
  }

  persistNow(): void {
    writeJsonAtomic(ACCOUNTS_FILE, Object.fromEntries(this.accounts));
  }
}

class MarketStore {
  private listings = new Map<string, ListingRecord>();
  private seq = 0;
  private flush = debounced(() => this.persistNow(), 500);

  constructor() {
    const raw = readJson<ListingRecord[]>(LISTINGS_FILE, []);
    for (const l of raw) {
      this.listings.set(l.listingId, l);
      const n = Number(l.listingId.split("_")[1]);
      if (Number.isFinite(n) && n > this.seq) this.seq = n;
    }
  }

  all(): ListingRecord[] {
    return [...this.listings.values()];
  }

  get(listingId: string): ListingRecord | undefined {
    return this.listings.get(listingId);
  }

  add(rec: Omit<ListingRecord, "listingId" | "createdAt">): ListingRecord {
    const listingId = `lst_${++this.seq}`;
    const full: ListingRecord = { ...rec, listingId, createdAt: Date.now() };
    this.listings.set(listingId, full);
    this.flush();
    return full;
  }

  remove(listingId: string): ListingRecord | undefined {
    const rec = this.listings.get(listingId);
    if (rec) this.listings.delete(listingId);
    this.flush();
    return rec;
  }

  persistNow(): void {
    writeJsonAtomic(LISTINGS_FILE, this.all());
  }
}

export const accountStore = new AccountStore();
export const marketStore = new MarketStore();

// Best-effort flush on shutdown.
for (const sig of ["SIGINT", "SIGTERM", "beforeExit"] as const) {
  process.once(sig, () => {
    accountStore.persistNow();
    marketStore.persistNow();
  });
}
