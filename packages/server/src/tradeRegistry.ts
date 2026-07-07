/**
 * TradeRegistry — global singleton that counts active two-party trades across ALL
 * room instances.
 *
 * Direct (face-to-face) trades live per-`MapRoom` in `activeTrades`, but an operator
 * glancing at `/metrics` needs a server-wide count. Each `MapRoom` registers a trade
 * id on invite and releases it on cancel / completion / leave, so this is a thin,
 * accurate aggregate — no trade *contents* are stored here (those stay room-scoped).
 */

class TradeRegistryImpl {
  /** Set of currently-open trade ids (1 entry per trade, not per participant). */
  private readonly open = new Set<string>();

  /** Record a newly-opened trade. */
  openTrade(tradeId: string): void {
    this.open.add(tradeId);
  }

  /** Record a trade that has closed (completed / cancelled / either party left). */
  closeTrade(tradeId: string): void {
    this.open.delete(tradeId);
  }

  /** Number of two-party trades currently in progress across all rooms. */
  get activeCount(): number {
    return this.open.size;
  }
}

/** Global singleton — imported by every MapRoom instance + the metrics endpoint. */
export const tradeRegistry = new TradeRegistryImpl();
