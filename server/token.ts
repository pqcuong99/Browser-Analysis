import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';

export interface TokenPayload {
  sid: string; // scan id
  ip: string;
  ua: string; // hash của User-Agent
  decision: 'ALLOW' | 'CHALLENGE' | 'BLOCK';
  /** Trust Score 0-100 (100 = an toàn) */
  score: number;
  /** Phiên đã vượt CHALLENGE bằng Proof-of-Work: được cho qua nhưng bị gắn cờ + rate-limit chặt */
  challenge?: { method: 'pow'; passedAt: number; difficulty: number; original: 'CHALLENGE' };
  iat: number;
  exp: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (data: string) => createHmac('sha256', config.secret).update(data).digest();

export const uaHash = (ua: string | undefined) =>
  createHash('sha256').update(ua ?? '').digest('base64url').slice(0, 22);

export function signToken(p: Omit<TokenPayload, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const body = b64(JSON.stringify({ ...p, iat: now, exp: now + config.tokenTtlSec }));
  return `${body}.${b64(mac(body))}`;
}

export function verifyToken(token: string | undefined | null): TokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = mac(body);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}
