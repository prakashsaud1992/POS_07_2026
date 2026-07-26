const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const dataDir = path.join(__dirname, '..', 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const dbPath = path.join(dataDir, 'app.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  gmail TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  drive_database_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  data_owner_user_id TEXT NOT NULL,
  drive_database_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (data_owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS store_members (
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (store_id, user_id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  barcode TEXT,
  photo_url TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_items_owner ON inventory_items(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_items_owner_barcode ON inventory_items(owner_user_id, barcode);
CREATE INDEX IF NOT EXISTS idx_store_members_user ON store_members(user_id);

CREATE TABLE IF NOT EXISTS sales_transactions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sold_price REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  FOREIGN KEY (item_id) REFERENCES inventory_items(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_owner_time ON sales_transactions(owner_user_id, created_at DESC);
`)

module.exports = db
