import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { logEvent } from './db.ts';
import { blockPage } from './pages.ts';
import { rateLimit } from './store.ts';
import { uaHash, verifyToken, type TokenPayload } from './token.ts';

declare module 'fastify' {
  interface FastifyRequest { browserGuard?: TokenPayload }
}

export function getCookie(req: FastifyRequest, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Token hợp lệ, chưa hết hạn và gắn đúng IP + User-Agent của request hiện tại */
export function readGuardToken(req: FastifyRequest): TokenPayload | null {
  const raw = getCookie(req, config.cookieName) ?? (req.headers['x-bg-token'] as string | undefined) ?? null;
  const p = verifyToken(raw);
  if (!p) return null;
  if (p.ip !== req.ip || p.ua !== uaHash(req.headers['user-agent'])) return null;
  return p;
}

const wantsHtml = (req: FastifyRequest) => req.method === 'GET' && /text\/html/.test(req.headers.accept ?? '');
const gateUrl = (req: FastifyRequest) => `/gate?next=${encodeURIComponent(req.url)}`;

/**
 * preHandler cho route cần bảo vệ.
 *   app.get('/checkout', { preHandler: browserGuard }, handler)
 *
 * ALLOW                 → cho qua
 * ALLOW + đã vượt PoW   → cho qua, phiên bị gắn cờ: rate-limit chặt + ghi nhật ký hành vi
 * CHALLENGE             → chuyển sang /gate để giải Proof-of-Work (API: 403 challenge_required)
 * BLOCK                 → 403, không tiết lộ rule
 */
export async function browserGuard(req: FastifyRequest, reply: FastifyReply) {
  const p = readGuardToken(req);
  if (!p) {
    if (wantsHtml(req)) return reply.redirect(gateUrl(req));
    return reply.code(401).send({ error: 'verification_required', gate: '/gate' });
  }
  req.browserGuard = p;

  if (p.decision === 'ALLOW') {
    if (p.challenge && config.mode === 'enforce' && !rateLimit(`flag:${p.sid}`, config.flaggedRateLimit)) {
      logEvent(p.sid, req.ip, 'rate_limited', { url: req.url, limit: config.flaggedRateLimit });
      reply.header('retry-after', '60');
      return reply.code(429).send({ error: 'rate_limited', reference: p.sid });
    }
    if (p.challenge) logEvent(p.sid, req.ip, 'flagged_access', { method: req.method, url: req.url.slice(0, 200) });
    return;
  }
  if (config.mode === 'monitor') {
    req.log.warn({ scan: p.sid, decision: p.decision, trust: p.score }, 'sentinelfp (monitor): sẽ bị chặn ở chế độ enforce');
    logEvent(p.sid, req.ip, 'monitor_pass', { decision: p.decision, url: req.url.slice(0, 200) });
    return;
  }
  if (p.decision === 'CHALLENGE') {
    if (wantsHtml(req)) return reply.redirect(gateUrl(req));
    return reply.code(403).send({ error: 'challenge_required', reference: p.sid, pow: '/api/pow/challenge' });
  }
  logEvent(p.sid, req.ip, 'blocked', { url: req.url.slice(0, 200) });
  // Production: không trả chi tiết rule cho client
  if (!wantsHtml(req)) return reply.code(403).send({ error: 'blocked', reference: p.sid });
  return reply.code(403).type('text/html; charset=utf-8').send(blockPage('BLOCK', p.sid));
}
