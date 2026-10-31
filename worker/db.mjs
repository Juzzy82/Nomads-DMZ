// NOMADS DMZ HUB accounts: the database (Cloudflare D1) tables. Created automatically the first time they are needed.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, created_at INTEGER NOT NULL, last_login INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS progress (user_id TEXT NOT NULL, ns TEXT NOT NULL, data TEXT NOT NULL, rev INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, ns))`,
  `CREATE TABLE IF NOT EXISTS pins (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, name TEXT NOT NULL, note TEXT, color TEXT, icon TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS pins_user ON pins (user_id)`
];
const ready = new WeakSet();
export async function ensureSchema(db) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}
export const nowSec = () => Math.floor(Date.now() / 1000);
export const SCHEMA_SQL = SCHEMA.join(';\n') + ';\n';
