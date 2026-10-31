-- Optional: the Worker creates these tables by itself the first time they are needed.
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT, created_at INTEGER NOT NULL, last_login INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS progress (user_id TEXT NOT NULL, ns TEXT NOT NULL, data TEXT NOT NULL, rev INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, ns));
CREATE TABLE IF NOT EXISTS pins (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, name TEXT NOT NULL, note TEXT, color TEXT, icon TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS pins_user ON pins (user_id);
