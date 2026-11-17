'use strict';

const path = require('path');
const { app } = require('electron');
const Database = require('better-sqlite3');

const dbPath = path.join(app.getPath('userData'), 'portal.sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'frontdesk')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS venues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dpsk_pool_id TEXT NOT NULL DEFAULT '',
    network_ssid TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Which properties a front-desk account may see/manage on a shared
  -- workstation (admins are always unrestricted, so they never have rows
  -- here). No FK constraints (this app never turns PRAGMA foreign_keys on)
  -- — lib/auth.js and lib/settingsStore.js delete matching rows directly
  -- when a user or venue is removed.
  CREATE TABLE IF NOT EXISTS user_venues (
    user_id INTEGER NOT NULL,
    venue_id TEXT NOT NULL,
    PRIMARY KEY (user_id, venue_id)
  );
`);

// Migration: `users` predates the must_change_password flag (added so an
// admin-initiated password reset can force the recipient to pick their own
// password on next login). CREATE TABLE IF NOT EXISTS above won't add it to
// an already-existing table, so add it explicitly if missing.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('must_change_password')) {
  db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

function logActivity(username, action, detail) {
  db.prepare(
    'INSERT INTO activity_log (username, action, detail) VALUES (?, ?, ?)'
  ).run(username || null, action, detail ? JSON.stringify(detail) : null);
}

// Every write action in the app already calls logActivity() above — this is
// just the missing read side, so an admin can actually see the trail rather
// than it being a write-only table. Most-recent-first, capped rather than
// paginated (this is a local single-property tool; a few hundred rows is a
// typical day) — the renderer filters/searches the loaded window client-side,
// same pattern as the Units list.
function listActivity(limit = 1000) {
  const rows = db
    .prepare('SELECT id, username, action, detail, created_at FROM activity_log ORDER BY id DESC LIMIT ?')
    .all(limit);
  return rows.map((r) => ({
    ...r,
    detail: r.detail ? (() => { try { return JSON.parse(r.detail); } catch { return r.detail; } })() : null
  }));
}

module.exports = { db, getSetting, setSetting, logActivity, listActivity, dbPath };
