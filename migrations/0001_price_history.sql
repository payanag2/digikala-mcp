CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  title TEXT,
  url TEXT,
  price_toman INTEGER NOT NULL,
  discount_percent REAL,
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_history_product_time ON price_history(product_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_time ON price_history(captured_at DESC);
CREATE TABLE IF NOT EXISTS tracker_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
