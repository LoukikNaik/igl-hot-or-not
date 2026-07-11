CREATE TABLE IF NOT EXISTS players (
  person_id TEXT PRIMARY KEY,
  rating    REAL NOT NULL DEFAULT 1000,
  wins      INTEGER NOT NULL DEFAULT 0,
  losses    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS faceoffs (
  pair_key   TEXT PRIMARY KEY,
  voter_id   TEXT NOT NULL,
  winner_id  TEXT NOT NULL,
  loser_id   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ratings (
  person_id  TEXT NOT NULL,
  voter_id   TEXT NOT NULL,
  score      INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (person_id, voter_id)
);
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  voter_id   TEXT NOT NULL,
  event      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- per-IP rate limiting: one row per (ip, minute-bucket), incremented per vote
CREATE TABLE IF NOT EXISTS rate (
  ip     TEXT NOT NULL,
  bucket INTEGER NOT NULL,          -- unix-minute (epoch seconds / 60)
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, bucket)
);
CREATE INDEX IF NOT EXISTS idx_faceoffs_voter ON faceoffs(voter_id);
CREATE INDEX IF NOT EXISTS idx_ratings_person ON ratings(person_id);
CREATE INDEX IF NOT EXISTS idx_events_evt ON events(event);
