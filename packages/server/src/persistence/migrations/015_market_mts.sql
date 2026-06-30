-- MTS-style market features: buy orders, auction fields, listing expiry, price history.

-- Extend listings with auction/expiry columns.
ALTER TABLE listings ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE listings ADD COLUMN ends_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN current_bid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN high_bidder_char_id TEXT NOT NULL DEFAULT '';

-- Buy orders (want-to-buy): players post bids by item filter.
CREATE TABLE IF NOT EXISTS buy_orders (
  buy_order_id TEXT PRIMARY KEY,
  buyer_char_id TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  def_id TEXT NOT NULL,
  filter_json TEXT NOT NULL DEFAULT '{}',
  max_price INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  mesos_escrowed INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_buy_orders_def ON buy_orders(def_id);

-- Price history: records every completed sale for market analytics.
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  def_id TEXT NOT NULL,
  sale_price INTEGER NOT NULL,
  sold_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_price_history_def ON price_history(def_id);
