import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadOrCreateCert } from './cert.ts';
import { config } from './config.ts';
import { deleteSetting, getScan, listEvents, listScans, loadSetting, logEvent, recordChallenge, saveScan, storeSetting } from './db.ts';
import { analyze, MODULES, RULEBOOK, RULESET_VERSION } from './engine/index.ts';
import { isPrivateIp } from './engine/rules.ts';
import { groundIceServers, groundLookup } from './ground.ts';
import { defaultPolicy, sanitizePolicy, type Policy } from './engine/policy.ts';
import { PROFILE_BY_ID, PROFILES } from './engine/profiles.ts';
import type { NetIntel } from './engine/types.ts';
import { browserGuard, readGuardToken } from './guard.ts';
import { esc, page } from './pages.ts';
import { difficultyFor, issuePow, verifyPow } from './pow.ts';
import { consumeNonce, issueNonce, rateLimit } from './store.ts';
import { measuredNet, startTlsFrontend } from './tlsfp.ts';
import { signToken, uaHash, verifyToken, type TokenPayload } from './token.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- policy (lưu trong SQLite, sửa ở tab Admin) — dùng chung cho HTTP và HTTPS ----------
const basePolicy = () => defaultPolicy(config.thresholds);
let policy: Policy = (() => {
  const saved = loadSetting<Policy>('policy');
  return saved ? sanitizePolicy(saved, basePolicy()) : basePolicy();
})();

const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
function isAdmin(req: FastifyRequest) {
  if (config.adminKey) return req.headers['x-admin-key'] === config.adminKey;
  return isLoopback(req.ip);
}

// Header HTTP được giữ lại để đối chiếu với JavaScript (không lưu cookie/authorization)
const KEEP_HEADERS = ['user-agent', 'accept-language', 'accept', 'accept-encoding', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-fetch-site', 'sec-fetch-mode', 'via', 'forwarded', 'x-forwarded-for'];
function httpContext(req: FastifyRequest) {
  const headers: Record<string, string | undefined> = {};
  for (const k of KEEP_HEADERS) {
    const v = req.headers[k];
    if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return { ip: req.ip, headers };
}

/**
 * Dữ liệu tầng mạng: JA4 + HTTP/2 do chính server đo (khi chạy HTTPS trực tiếp),
 * cộng thêm dữ liệu từ Edge (ASN, GeoIP, p0f...) nếu chạy sau proxy tin cậy.
 */
function netIntel(req: FastifyRequest): NetIntel & { source?: Record<string, string> } {
  const out: NetIntel & { source?: Record<string, string> } = {};
  const source: Record<string, string> = {};
  if (config.edge.trusted) {
    const g = (k: keyof typeof config.edge.headers) => {
      const v = req.headers[config.edge.headers[k]];
      const s = Array.isArray(v) ? v[0] : v;
      return s ? String(s).slice(0, 300) : undefined;
    };
    const flags = g('ipFlags');
    const edge: NetIntel = {
      ja4: g('ja4'), ja3: g('ja3'), tlsClient: g('tlsClient'), h2: g('h2'), httpVersion: g('httpVersion'), tcpOs: g('tcpOs'),
      asn: g('asn'), asnOrg: g('asnOrg'), asnType: g('asnType')?.toLowerCase(), country: g('country')?.toUpperCase(), ipTimezone: g('ipTimezone'),
      ipFlags: flags ? flags.toLowerCase().split(/[\s,]+/).filter(Boolean) : undefined,
    };
    for (const [k, v] of Object.entries(edge)) if (v !== undefined) { (out as any)[k] = v; source[k] = 'edge'; }
  }
  const m = measuredNet(req.raw);
  for (const k of ['ja4', 'h2', 'httpVersion'] as const) if (m[k]) { out[k] = m[k]; source[k] = 'server'; }
  if (Object.keys(source).length) out.source = source;
  return out;
}

function setTokenCookie(req: FastifyRequest, reply: FastifyReply, payload: Omit<TokenPayload, 'iat' | 'exp'>) {
  const token = signToken(payload);
  reply.header(
    'set-cookie',
    `${config.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.tokenTtlSec}${req.protocol === 'https' ? '; Secure' : ''}`,
  );
  return token;
}

function routes(app: FastifyInstance) {
  // ---------- quét ----------
  app.get('/api/challenge', async (req, reply) => {
    if (!rateLimit(`ch:${req.ip}`, 30)) return reply.code(429).send({ error: 'rate_limited' });
    const { nonce, seed } = issueNonce(req.ip, uaHash(req.headers['user-agent']));
    reply.header('cache-control', 'no-store');
    // Server chỉ thấy IP nội bộ (scan ở localhost, proxy bỏ qua 127.0.0.1): nhờ probe tự hỏi IP egress
    const ipEcho = isPrivateIp(req.ip) ? config.ipEcho : [];
    return { nonce, seed, stun: config.stun, ground: groundIceServers(nonce), ipEcho, expiresIn: config.nonceTtlSec };
  });

  app.post('/api/verify', async (req, reply) => {
    if (!rateLimit(`vf:${req.ip}`, 20)) return reply.code(429).send({ error: 'rate_limited' });
    const body = req.body as any;
    if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
      return reply.code(400).send({ error: 'bad_request', message: 'Thiếu data' });
    }
    const ua = req.headers['user-agent'] ?? '';
    const n = consumeNonce(body.nonce, req.ip, uaHash(ua));
    if (!n.ok) return reply.code(400).send({ error: n.reason, message: 'Challenge không hợp lệ hoặc đã hết hạn, hãy tải lại trang' });
    if (body.data.nonce !== body.nonce) return reply.code(400).send({ error: 'nonce_mismatch' });

    const http = httpContext(req);
    const net = netIntel(req);
    // IP:port nguồn thật mà VPS thấy cho phiên này (WRTC_09)
    const srflxPorts = (Array.isArray(body.data.webrtc?.candidates) ? body.data.webrtc.candidates : [])
      .filter((c: any) => c?.type === 'srflx').map((c: any) => Number(c.port)).filter((p: number) => p > 0 && p < 65536);
    net.ground = await groundLookup(body.nonce, srflxPorts);
    const id = randomUUID();
    const report = analyze(body.data, http, { policy, net, scanId: id });
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : null;
    const sb = report.scoring_breakdown;
    saveScan({
      id, createdAt: Date.now(), ip: req.ip, userAgent: ua, label,
      score: sb.trust_score, decision: sb.enforcement_action, report, raw: { payload: body.data, http, net },
    });
    const token = setTokenCookie(req, reply, { sid: id, ip: req.ip, ua: uaHash(ua), decision: sb.enforcement_action, score: sb.trust_score });
    req.log.info({ scan: id, trust: sb.trust_score, action: sb.enforcement_action, label }, 'scan');
    return { scanId: id, mode: config.mode, label, token, report };
  });

  // ---------- CHALLENGE: Proof-of-Work ----------
  app.get('/api/pow/challenge', async (req, reply) => {
    if (!rateLimit(`pow:${req.ip}`, 10)) return reply.code(429).send({ error: 'rate_limited' });
    const t = readGuardToken(req);
    if (!t) return reply.code(401).send({ error: 'verification_required', message: 'Cần quét trình duyệt trước' });
    if (t.decision === 'BLOCK') return reply.code(403).send({ error: 'blocked', message: 'Phiên bị BLOCK không thể vượt qua bằng Proof-of-Work' });
    if (t.decision === 'ALLOW') return reply.code(409).send({ error: 'not_required', message: t.challenge ? 'Phiên đã vượt challenge' : 'Phiên được ALLOW, không cần challenge' });
    const difficulty = difficultyFor(t.score, policy.thresholds);
    logEvent(t.sid, req.ip, 'challenge_issued', { difficulty });
    reply.header('cache-control', 'no-store');
    return issuePow(t.sid, req.ip, uaHash(req.headers['user-agent']), difficulty);
  });

  app.post('/api/pow/verify', async (req, reply) => {
    if (!rateLimit(`powv:${req.ip}`, 10)) return reply.code(429).send({ error: 'rate_limited' });
    const t = readGuardToken(req);
    if (!t || t.decision !== 'CHALLENGE') return reply.code(409).send({ error: 'no_pending_challenge' });
    const b = (req.body ?? {}) as any;
    const r = verifyPow(b.id, b.nonce, req.ip, uaHash(req.headers['user-agent']));
    if (!r.ok || r.sid !== t.sid) {
      const reason = r.ok ? 'session_mismatch' : r.reason;
      logEvent(t.sid, req.ip, 'challenge_failed', { reason });
      return reply.code(400).send({ error: reason, message: 'Lời giải không hợp lệ hoặc đã hết hạn' });
    }
    const passed = { method: 'pow' as const, passedAt: Date.now(), difficulty: r.difficulty, original: 'CHALLENGE' as const };
    setTokenCookie(req, reply, { sid: t.sid, ip: t.ip, ua: t.ua, decision: 'ALLOW', score: t.score, challenge: passed });
    recordChallenge(t.sid, { ...passed, solveMs: r.solveMs, clientMs: Number(b.elapsedMs) || null, hashes: Number(b.hashes) || null });
    logEvent(t.sid, req.ip, 'challenge_passed', { difficulty: r.difficulty, solveMs: r.solveMs });
    return { ok: true, decision: 'ALLOW', flagged: true, difficulty: r.difficulty, rateLimitPerMinute: config.flaggedRateLimit };
  });

  // ---------- báo cáo ----------
  app.get('/api/scans/:id', async (req, reply) => {
    const s = getScan((req.params as any).id);
    if (!s) return reply.code(404).send({ error: 'not_found' });
    if (!s.report?.scoring_breakdown) return reply.code(410).send({ error: 'legacy_report', message: 'Scan được tạo bởi ruleset cũ (v0.1), hãy quét lại.' });
    return {
      scanId: s.id, createdAt: s.createdAt, label: s.label, mode: config.mode, report: s.report, raw: s.raw?.payload ?? s.raw,
      challenge: s.challenge, events: isAdmin(req) ? listEvents(s.id) : undefined,
    };
  });

  app.get('/api/scans', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
    const q = req.query as any;
    return listScans(Number(q.limit ?? 50), q.label || undefined);
  });

  /** Bộ rule (metadata, không gồm policy) để giao diện dựng bảng */
  app.get('/api/rules', async () => ({ version: RULESET_VERSION, modules: MODULES, rules: RULEBOOK }));

  /** Thông tin để giao diện biết có cổng HTTPS đo JA4/HTTP2 hay không */
  app.get('/api/server-info', async (req) => ({
    mode: config.mode, https: httpsReady ? { port: config.httpsPort, url: `https://localhost:${config.httpsPort}/` } : null,
    edgeTrusted: config.edge.trusted, protocol: req.protocol, httpVersion: req.raw.httpVersion,
    network: netIntel(req),
  }));

  // ---------- policy ----------
  app.get('/api/policy', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
    return { policy, defaults: basePolicy(), mode: config.mode };
  });

  app.put('/api/policy', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
    policy = sanitizePolicy(req.body, basePolicy());
    storeSetting('policy', policy);
    req.log.warn({ policy }, 'blocking policy updated');
    return { policy };
  });

  app.delete('/api/policy', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
    deleteSetting('policy');
    policy = basePolicy();
    return { policy };
  });

  /** Xem trước ảnh hưởng của policy nháp lên các scan gần đây và các profile mô phỏng */
  app.post('/api/policy/preview', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
    const draft = sanitizePolicy(req.body, basePolicy());
    const rows: any[] = [];
    for (const p of PROFILES) {
      const s = p.build();
      const before = analyze(s.data, s.http, { policy, net: s.net }).scoring_breakdown;
      const after = analyze(s.data, s.http, { policy: draft, net: s.net }).scoring_breakdown;
      rows.push({ id: `sim:${p.id}`, label: p.title, before: [before.trust_score, before.enforcement_action], after: [after.trust_score, after.enforcement_action] });
    }
    for (const sc of listScans(100)) {
      const full = getScan(sc.id);
      const raw = full?.raw;
      if (!raw?.payload || !raw.http) continue;
      const before = full!.report?.scoring_breakdown;
      const after = analyze(raw.payload, raw.http, { policy: draft, net: raw.net ?? {} }).scoring_breakdown;
      rows.push({ id: sc.id, label: sc.label ?? sc.userAgent?.slice(0, 60), before: [before?.trust_score ?? (before ? 100 - before.total_risk_score : undefined), before?.enforcement_action], after: [after.trust_score, after.enforcement_action] });
    }
    return { rows };
  });

  // ---------- mô phỏng ----------
  app.get('/api/profiles', async () => PROFILES.map(({ id, title, description, expected }) => ({ id, title, description, expected })));

  app.get('/api/simulate/:id', async (req, reply) => {
    if (!rateLimit(`sim:${req.ip}`, 60)) return reply.code(429).send({ error: 'rate_limited' });
    const p = PROFILE_BY_ID.get((req.params as any).id);
    if (!p) return reply.code(404).send({ error: 'unknown_profile' });
    const s = p.build();
    const id = randomUUID();
    const report = analyze(s.data, s.http, { policy, net: s.net, scanId: id, simulatedProfile: p.id });
    const sb = report.scoring_breakdown;
    saveScan({
      id, createdAt: Date.now(), ip: s.http.ip, userAgent: s.http.headers['user-agent'] ?? '', label: `sim:${p.id}`,
      score: sb.trust_score, decision: sb.enforcement_action, report, raw: { payload: s.data, http: s.http, net: s.net },
    });
    return { scanId: id, mode: config.mode, label: `sim:${p.id}`, profile: { id: p.id, title: p.title, description: p.description, expected: p.expected }, report, raw: s.data };
  });

  /** Cho backend khác (PHP, Python, Go...) kiểm tra token server-to-server */
  app.post('/api/token/introspect', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
    const b = (req.body ?? {}) as any;
    const p = verifyToken(b.token);
    if (!p) return { valid: false, reason: 'invalid_or_expired' };
    if (b.ip && b.ip !== p.ip) return { valid: false, reason: 'ip_mismatch' };
    if (b.userAgent && uaHash(b.userAgent) !== p.ua) return { valid: false, reason: 'ua_mismatch' };
    return { valid: true, mode: config.mode, flagged: !!p.challenge, ...p };
  });

  app.get('/api/me', async (req) => {
    const p = readGuardToken(req);
    return p ? { verified: true, flagged: !!p.challenge, ...p } : { verified: false };
  });

  // ---------- Noise Lab: định vị noise Canvas/WebGL/ClientRects/Audio (chỉ admin/loopback) ----------
  const labDir = join(root, 'data', 'noise-lab');
  app.post('/api/noise-lab', { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
    const b = req.body as any;
    if (!b || typeof b !== 'object' || !b.findings) return reply.code(400).send({ error: 'bad_request' });
    const label = String(b.label ?? 'unlabeled').replace(/[^\w.-]/g, '').slice(0, 40) || 'unlabeled';
    mkdirSync(labDir, { recursive: true });
    const file = `${label}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(join(labDir, file), JSON.stringify({ ...b, label, receivedAt: Date.now(), ip: req.ip, headers: httpContext(req).headers }, null, 2));
    return { ok: true, file };
  });
  app.get('/api/noise-lab', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
    if (!existsSync(labDir)) return [];
    return readdirSync(labDir).filter((f) => f.endsWith('.json')).sort();
  });
  app.get('/api/noise-lab/:file', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: 'forbidden' });
    const f = String((req.params as any).file);
    if (!/^[\w.-]+\.json$/.test(f) || !existsSync(join(labDir, f))) return reply.code(404).send({ error: 'not_found' });
    return reply.type('application/json').send(readFileSync(join(labDir, f), 'utf8'));
  });

  // ---------- pages ----------
  app.get('/gate', async (_req, reply) => reply.sendFile('gate.html'));

  // Khu vực demo được bảo vệ: thay bằng các route thật (login, register, checkout...)
  app.get('/protected', { preHandler: browserGuard }, async (req, reply) => {
    const p = req.browserGuard!;
    const flagged = p.challenge
      ? `<p class="muted">Phiên đã vượt CHALLENGE bằng Proof-of-Work (độ khó ${p.challenge.difficulty} bit): bị gắn cờ theo dõi, giới hạn ${config.flaggedRateLimit} request/phút.</p>`
      : '';
    return reply.type('text/html; charset=utf-8').send(
      page('Protected area', `
        <div class="gate-card is-allow">
          <div class="gate-icon pass"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg></div>
          <div class="gate-code">HTTP 200 · ACCESS GRANTED${p.challenge ? ' · FLAGGED' : ''}</div>
          <h1>Đã qua kiểm tra</h1>
          <p>Đây là trang demo được bảo vệ bởi <code>browserGuard</code>.</p>
          <p class="muted">Quyết định: <b>${esc(p.decision)}</b> · Trust Score: <b>${p.score}/100</b> · Chế độ: <b>${config.mode}</b></p>
          ${flagged}
          <p><a class="btn" href="/?scan=${esc(p.sid)}">Xem báo cáo</a></p>
        </div>`),
    );
  });
  app.post('/protected/api/action', { preHandler: browserGuard }, async (req) => ({ ok: true, scan: req.browserGuard!.sid, flagged: !!req.browserGuard!.challenge }));
}

async function buildApp(opts: Record<string, unknown> = {}) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: config.trustProxy,
    bodyLimit: 512 * 1024,
    ...opts,
  });
  // dist/: giao diện React đã build (npm run build). public/: probe.js, pow.js, gate.html, style.css
  const roots = [join(root, 'dist'), join(root, 'public')].filter((d) => existsSync(d));
  await app.register(fastifyStatic, {
    root: roots,
    prefix: '/',
    cacheControl: false,
    // File có hash trong tên (Vite) cache lâu; HTML/probe luôn kiểm tra lại để không dùng bản cũ
    // @fastify/static v10 truyền FastifyReply vào setHeaders
    setHeaders: (reply: FastifyReply, path: string) => {
      reply.header('cache-control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  routes(app);
  return app;
}

let httpsReady = false;

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.warn('[sentinelfp] Chưa có dist/: chạy `npm run build` để tạo giao diện React (hoặc `npm run dev:web` khi phát triển).');
}

// HTTP thường
const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
app.log.info(`SentinelFP chạy tại http://${config.host}:${config.port} (mode=${config.mode}, edge headers ${config.edge.trusted ? 'ON' : 'OFF'})`);

// HTTPS + HTTP/2: server tự đo JA4 từ ClientHello và HTTP/2 fingerprint
if (config.httpsPort > 0) {
  try {
    const tls = loadOrCreateCert(config.tlsDir);
    const secure = await buildApp({ http2: true, https: { allowHTTP1: true, key: tls.key, cert: tls.cert } });
    await secure.ready();
    await startTlsFrontend(secure.server as any, config.httpsPort, config.host);
    httpsReady = true;
    secure.log.info(`HTTPS + HTTP/2 (đo JA4 / HTTP2 fingerprint) tại https://localhost:${config.httpsPort}${tls.created ? ' — đã tạo chứng chỉ tự ký trong ' + config.tlsDir : ''}`);
  } catch (e: any) {
    app.log.warn(`Không bật được HTTPS trên cổng ${config.httpsPort}: ${e?.message ?? e}. Đặt HTTPS_PORT=0 để tắt.`);
  }
}
