import { randomBytes, randomInt } from 'node:crypto';
import { config } from './config.ts';

// ---------- nonce dùng một lần, gắn với IP + UA ----------
interface NonceEntry { ip: string; ua: string; seed: number; exp: number }
const nonces = new Map<string, NonceEntry>();

export function issueNonce(ip: string, ua: string) {
  const nonce = randomBytes(18).toString('base64url');
  const seed = randomInt(1, 2 ** 31 - 1);
  nonces.set(nonce, { ip, ua, seed, exp: Date.now() + config.nonceTtlSec * 1000 });
  return { nonce, seed };
}

export type NonceCheck = { ok: true; seed: number } | { ok: false; reason: string };

export function consumeNonce(nonce: unknown, ip: string, ua: string): NonceCheck {
  if (typeof nonce !== 'string') return { ok: false, reason: 'missing_nonce' };
  const e = nonces.get(nonce);
  nonces.delete(nonce);
  if (!e) return { ok: false, reason: 'unknown_or_used_nonce' };
  if (e.exp < Date.now()) return { ok: false, reason: 'expired_nonce' };
  if (e.ip !== ip || e.ua !== ua) return { ok: false, reason: 'nonce_context_mismatch' };
  return { ok: true, seed: e.seed };
}

// ---------- rate limit cửa sổ cố định ----------
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of nonces) if (v.exp < now) nonces.delete(k);
  for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}, 30_000).unref();
