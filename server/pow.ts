// Proof-of-Work cho quyết định CHALLENGE: trình duyệt phải tìm nonce sao cho
// SHA-256(prefix + ":" + nonce) có `difficulty` bit 0 đầu tiên. Không cần dịch vụ CAPTCHA ngoài.
import { createHash, randomBytes } from 'node:crypto';

interface PowEntry { sid: string; ip: string; ua: string; prefix: string; difficulty: number; exp: number; issuedAt: number }
const pending = new Map<string, PowEntry>();
const TTL_MS = 120_000;

/** Độ khó tăng khi Trust Score giảm: sát ngưỡng Safe ≈ 2^16 phép băm, sát ngưỡng High Risk ≈ 2^20 */
export function difficultyFor(trust: number, t: { safe: number; suspicious: number }) {
  const f = Math.min(1, Math.max(0, (t.safe - 1 - trust) / Math.max(1, t.safe - 1 - t.suspicious)));
  return 16 + Math.round(f * 4);
}

export function issuePow(sid: string, ip: string, ua: string, difficulty: number) {
  const id = randomBytes(12).toString('base64url');
  const prefix = randomBytes(16).toString('hex');
  pending.set(id, { sid, ip, ua, prefix, difficulty, exp: Date.now() + TTL_MS, issuedAt: Date.now() });
  return { id, prefix, difficulty, expiresIn: TTL_MS / 1000 };
}

export function leadingZeroBits(buf: Buffer) {
  let n = 0;
  for (const b of buf) {
    if (b === 0) { n += 8; continue; }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

export type PowResult =
  | { ok: true; sid: string; difficulty: number; solveMs: number }
  | { ok: false; reason: string };

export function verifyPow(id: unknown, nonce: unknown, ip: string, ua: string): PowResult {
  if (typeof id !== 'string' || typeof nonce !== 'string' || nonce.length > 32) return { ok: false, reason: 'bad_request' };
  const e = pending.get(id);
  pending.delete(id); // dùng một lần
  if (!e) return { ok: false, reason: 'unknown_or_used_challenge' };
  if (e.exp < Date.now()) return { ok: false, reason: 'expired' };
  if (e.ip !== ip || e.ua !== ua) return { ok: false, reason: 'context_mismatch' };
  const h = createHash('sha256').update(`${e.prefix}:${nonce}`).digest();
  if (leadingZeroBits(h) < e.difficulty) return { ok: false, reason: 'invalid_solution' };
  return { ok: true, sid: e.sid, difficulty: e.difficulty, solveMs: Date.now() - e.issuedAt };
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
}, 30_000).unref();
