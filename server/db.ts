import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS scans (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  label       TEXT,
  score       INTEGER,
  decision    TEXT,
  report      TEXT NOT NULL,
  raw         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_created ON scans(created_at DESC);
CREATE INDEX IF NOT EXISTS scans_label ON scans(label);
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  scan_id     TEXT,
  ip          TEXT,
  kind        TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS events_scan ON events(scan_id);
`);
// Cột ghi kết quả bước CHALLENGE (thêm sau v1.0, nên ALTER cho DB cũ)
try { db.exec('ALTER TABLE scans ADD COLUMN challenge TEXT'); } catch {}

const insert = db.prepare(
  'INSERT INTO scans (id, created_at, ip, user_agent, label, score, decision, report, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const byId = db.prepare('SELECT * FROM scans WHERE id = ?');
const recent = db.prepare(
  'SELECT id, created_at, ip, user_agent, label, score, decision FROM scans ORDER BY created_at DESC LIMIT ?',
);
const recentByLabel = db.prepare(
  'SELECT id, created_at, ip, user_agent, label, score, decision FROM scans WHERE label = ? ORDER BY created_at DESC LIMIT ?',
);
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const putSetting = db.prepare(
  'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
);
const delSetting = db.prepare('DELETE FROM settings WHERE key = ?');
const setChallenge = db.prepare('UPDATE scans SET challenge = ? WHERE id = ?');
const insertEvent = db.prepare('INSERT INTO events (created_at, scan_id, ip, kind, detail) VALUES (?, ?, ?, ?, ?)');
const eventsByScan = db.prepare('SELECT created_at, ip, kind, detail FROM events WHERE scan_id = ? ORDER BY id DESC LIMIT 50');

export interface ScanRow {
  id: string; createdAt: number; ip: string; userAgent: string; label: string | null;
  score: number; decision: string; report: any; raw: any;
}

export function saveScan(s: ScanRow) {
  insert.run(s.id, s.createdAt, s.ip, s.userAgent, s.label, s.score, s.decision, JSON.stringify(s.report), JSON.stringify(s.raw));
}

export function getScan(id: string) {
  const r = byId.get(id) as any;
  if (!r) return null;
  return {
    id: r.id, createdAt: r.created_at, ip: r.ip, userAgent: r.user_agent, label: r.label,
    score: r.score, decision: r.decision, report: JSON.parse(r.report), raw: JSON.parse(r.raw),
    challenge: r.challenge ? JSON.parse(r.challenge) : null,
  };
}

export function recordChallenge(scanId: string, result: unknown) {
  setChallenge.run(JSON.stringify(result), scanId);
}

/** Nhật ký hành vi của phiên bị gắn cờ (vượt challenge, bị rate-limit, bị chặn...) */
export function logEvent(scanId: string | null, ip: string, kind: string, detail?: unknown) {
  insertEvent.run(Date.now(), scanId, ip, kind, detail === undefined ? null : JSON.stringify(detail));
}

export function listEvents(scanId: string) {
  return (eventsByScan.all(scanId) as any[]).map((e) => ({ createdAt: e.created_at, ip: e.ip, kind: e.kind, detail: e.detail ? JSON.parse(e.detail) : null }));
}

export function listScans(limit = 50, label?: string) {
  const n = Math.min(Math.max(1, limit), 500);
  return ((label ? recentByLabel.all(label, n) : recent.all(n)) as any[]).map((r) => ({
    id: r.id, createdAt: r.created_at, ip: r.ip, userAgent: r.user_agent, label: r.label, score: r.score, decision: r.decision,
  }));
}

export function loadSetting<T>(key: string): T | null {
  const r = getSetting.get(key) as any;
  if (!r) return null;
  try { return JSON.parse(r.value) as T; } catch { return null; }
}

export function storeSetting(key: string, value: unknown) {
  putSetting.run(key, JSON.stringify(value), Date.now());
}

export function deleteSetting(key: string) {
  delSetting.run(key);
}
