'use strict';
/**
 * SentinelFP ground-truth STUN/TURN listener (WRTC_09)
 *
 * Chạy trên VPS có IP public. Ghi lại IP:port NGUỒN THẬT của gói STUN/TURN mà trình duyệt gửi tới,
 * để server SentinelFP so với ICE candidate mà JavaScript báo về. Antidetect sửa được chuỗi candidate,
 * nhưng không sửa được địa chỉ nguồn của gói UDP đến VPS.
 *
 *  - UDP + TCP :3478  STUN Binding (trả XOR-MAPPED-ADDRESS) và TURN Allocate (chỉ đọc USERNAME rồi từ chối,
 *                     KHÔNG cấp relay nên không ai mượn VPS để chuyển tiếp băng thông được)
 *  - TCP :8478        API tra cứu cho server SentinelFP, bắt buộc header x-ground-key
 *
 * Chỉ dùng module có sẵn của Node (chạy được từ Node 16), không cần npm install.
 * Dữ liệu chỉ giữ trong RAM 10 phút, không ghi ra đĩa.
 *
 *   set GROUND_KEY=<chuỗi bí mật ≥ 16 ký tự, giống GROUND_KEY ở server SentinelFP>
 *   node stun-listener.cjs
 */
const dgram = require('dgram');
const net = require('net');
const http = require('http');
const crypto = require('crypto');

const STUN_PORT = Number(process.env.STUN_PORT || 3478);
const API_PORT = Number(process.env.API_PORT || 8478);
const KEY = process.env.GROUND_KEY || '';
const REALM = 'sentinelfp';
const TTL_MS = 10 * 60 * 1000;
const MAGIC = 0x2112a442;
const MAX_PKT_PER_MIN = 300;

if (KEY.length < 16) {
  console.error('[stun] Thiếu GROUND_KEY (>= 16 ký tự). Ví dụ: set GROUND_KEY=chuoi-bi-mat-dai');
  process.exit(1);
}

// ---------- lưu trữ trong RAM ----------
/** tag phiên quét -> các nguồn đã thấy */
const sessions = new Map();
/** mọi STUN Binding gần đây (để khớp theo port khi không có TURN) */
let bindings = [];
const rate = new Map();

const log = (...a) => console.log(new Date().toISOString(), ...a);
const norm = (ip) => String(ip || '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

function allow(ip) {
  const now = Date.now();
  let b = rate.get(ip);
  if (!b || b.reset < now) { b = { n: 0, reset: now + 60_000 }; rate.set(ip, b); }
  return ++b.n <= MAX_PKT_PER_MIN;
}

function remember(tag, ip, port, proto, kind) {
  const now = Date.now();
  let s = sessions.get(tag);
  if (!s) { s = { created: now, sources: new Map() }; sessions.set(tag, s); }
  const k = `${proto}|${ip}|${port}`;
  const e = s.sources.get(k) || { ip, port, proto, kinds: [], first: now, last: now, count: 0 };
  if (!e.kinds.includes(kind)) e.kinds.push(kind);
  e.last = now; e.count++;
  s.sources.set(k, e);
}

setInterval(() => {
  const cut = Date.now() - TTL_MS;
  for (const [k, s] of sessions) if (s.created < cut) sessions.delete(k);
  bindings = bindings.filter((b) => b.t >= cut);
  const now = Date.now();
  for (const [k, b] of rate) if (b.reset < now) rate.delete(k);
}, 30_000).unref();

// ---------- STUN codec (RFC 5389 / 5766) ----------
const T = { BINDING: 0x0001, BINDING_OK: 0x0101, ALLOCATE: 0x0003, ALLOCATE_ERR: 0x0113 };
const A = { USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, REALM: 0x0014, NONCE: 0x0015, XOR_MAPPED: 0x0020, SOFTWARE: 0x8022 };

function parse(buf) {
  if (buf.length < 20) return null;
  const type = buf.readUInt16BE(0), len = buf.readUInt16BE(2);
  if ((type & 0xc000) !== 0 || buf.readUInt32BE(4) !== MAGIC || len % 4 !== 0 || 20 + len > buf.length) return null;
  const attrs = new Map();
  let off = 20;
  while (off + 4 <= 20 + len) {
    const t = buf.readUInt16BE(off), l = buf.readUInt16BE(off + 2);
    if (off + 4 + l > 20 + len) break;
    if (!attrs.has(t)) attrs.set(t, buf.slice(off + 4, off + 4 + l));
    off += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { type, tid: buf.slice(8, 20), attrs, size: 20 + len };
}

function encodeAttrs(list) {
  const parts = [];
  for (const [t, v] of list) {
    const h = Buffer.alloc(4);
    h.writeUInt16BE(t, 0); h.writeUInt16BE(v.length, 2);
    parts.push(h, v, Buffer.alloc((4 - (v.length % 4)) % 4));
  }
  return Buffer.concat(parts);
}

function header(type, tid, bodyLen) {
  const h = Buffer.alloc(20);
  h.writeUInt16BE(type, 0); h.writeUInt16BE(bodyLen, 2); h.writeUInt32BE(MAGIC, 4); tid.copy(h, 8);
  return h;
}

/** Tạo message; nếu có integrityKey thì thêm MESSAGE-INTEGRITY (HMAC-SHA1) ở cuối */
function build(type, tid, list, integrityKey) {
  const body = encodeAttrs(list);
  if (!integrityKey) return Buffer.concat([header(type, tid, body.length), body]);
  const pre = Buffer.concat([header(type, tid, body.length + 24), body]);
  const mac = crypto.createHmac('sha1', integrityKey).update(pre).digest();
  return Buffer.concat([pre, encodeAttrs([[A.MESSAGE_INTEGRITY, mac]])]);
}

function ipv6Bytes(ip) {
  const [head, tail] = ip.split('%')[0].split('::');
  const hp = head ? head.split(':') : [];
  const tp = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? hp : hp.concat(Array(8 - hp.length - tp.length).fill('0'), tp);
  const b = Buffer.alloc(16);
  groups.slice(0, 8).forEach((g, i) => b.writeUInt16BE(parseInt(g || '0', 16) & 0xffff, i * 2));
  return b;
}

function xorMapped(ip, port, tid) {
  const xport = port ^ (MAGIC >>> 16);
  if (net.isIPv4(ip)) {
    const b = Buffer.alloc(8);
    b[1] = 0x01; b.writeUInt16BE(xport, 2);
    const m = Buffer.alloc(4); m.writeUInt32BE(MAGIC);
    ip.split('.').forEach((x, i) => { b[4 + i] = Number(x) ^ m[i]; });
    return b;
  }
  const b = Buffer.alloc(20);
  b[1] = 0x02; b.writeUInt16BE(xport, 2);
  const raw = ipv6Bytes(ip), x = Buffer.concat([Buffer.from([0x21, 0x12, 0xa4, 0x42]), tid]);
  for (let i = 0; i < 16; i++) b[4 + i] = raw[i] ^ x[i];
  return b;
}

function errorCode(code, reason) {
  const r = Buffer.from(reason, 'utf8');
  const b = Buffer.alloc(4 + r.length);
  b[2] = Math.floor(code / 100); b[3] = code % 100; r.copy(b, 4);
  return b;
}

const SOFTWARE = Buffer.from('sentinelfp-ground');
const TAG_RE = /^\d{9,11}:([A-Za-z0-9_-]{8,64})$/;

/** Mật khẩu TURN theo chuẩn TURN REST API: base64(HMAC-SHA1(KEY, username)) */
const turnPassword = (username) => crypto.createHmac('sha1', KEY).update(username).digest('base64');

/** Xử lý một message STUN, trả về buffer phản hồi (hoặc null) */
function handle(msg, ip, port, proto) {
  if (msg.type === T.BINDING) {
    bindings.push({ ip, port, proto, t: Date.now() });
    if (bindings.length > 20000) bindings = bindings.slice(-10000);
    return build(T.BINDING_OK, msg.tid, [[A.XOR_MAPPED, xorMapped(ip, port, msg.tid)], [A.SOFTWARE, SOFTWARE]]);
  }
  if (msg.type === T.ALLOCATE) {
    const user = msg.attrs.get(A.USERNAME);
    if (!user) {
      // Lượt đầu chưa xác thực: yêu cầu trình duyệt gửi lại kèm USERNAME
      const nonce = crypto.randomBytes(12).toString('hex');
      return build(T.ALLOCATE_ERR, msg.tid, [
        [A.ERROR_CODE, errorCode(401, 'Unauthorized')], [A.REALM, Buffer.from(REALM)], [A.NONCE, Buffer.from(nonce)], [A.SOFTWARE, SOFTWARE],
      ]);
    }
    const username = user.toString('utf8');
    const m = TAG_RE.exec(username);
    if (m) {
      remember(m[1], ip, port, proto, 'turn-allocate');
      log(`[turn] ${proto} ${ip}:${port} tag=${m[1]}`);
    }
    // Không cấp relay. Ký MESSAGE-INTEGRITY để Chrome chấp nhận lỗi ngay thay vì gửi lại tới khi timeout.
    const key = crypto.createHash('md5').update(`${username}:${REALM}:${turnPassword(username)}`).digest();
    return build(T.ALLOCATE_ERR, msg.tid, [[A.ERROR_CODE, errorCode(403, 'Forbidden')], [A.SOFTWARE, SOFTWARE]], key);
  }
  return null;
}

// ---------- UDP ----------
function startUdp(type) {
  const sock = dgram.createSocket({ type, ipv6Only: type === 'udp6' });
  sock.on('message', (buf, rinfo) => {
    const ip = norm(rinfo.address);
    if (!allow(ip)) return;
    const msg = parse(buf);
    if (!msg) return;
    const res = handle(msg, ip, rinfo.port, 'udp');
    if (res) sock.send(res, rinfo.port, rinfo.address);
  });
  sock.on('error', (e) => { log(`[stun] ${type} lỗi: ${e.message}`); try { sock.close(); } catch (_) { /* noop */ } });
  sock.bind(STUN_PORT, type === 'udp6' ? '::' : '0.0.0.0', () => log(`[stun] ${type} lắng nghe :${STUN_PORT}`));
}
startUdp('udp4');
startUdp('udp6');

// ---------- TCP (TURN qua TCP đi xuyên proxy của trình duyệt => thấy IP proxy) ----------
net.createServer((s) => {
  const ip = norm(s.remoteAddress), port = s.remotePort;
  let buf = Buffer.alloc(0);
  s.setTimeout(15000, () => s.destroy());
  s.on('error', () => {});
  s.on('data', (chunk) => {
    if (!allow(ip)) return s.destroy();
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 65536) return s.destroy();
    while (buf.length >= 20) {
      const len = buf.readUInt16BE(2);
      if (buf.length < 20 + len) break;
      const msg = parse(buf.slice(0, 20 + len));
      buf = buf.slice(20 + len);
      if (!msg) return s.destroy();
      const res = handle(msg, ip, port, 'tcp');
      if (res) s.write(res);
    }
  });
}).on('error', (e) => log(`[stun] tcp lỗi: ${e.message}`))
  .listen(STUN_PORT, () => log(`[stun] tcp lắng nghe :${STUN_PORT}`));

// ---------- API tra cứu ----------
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (u.pathname === '/health') return send(200, { ok: true, sessions: sessions.size, bindings: bindings.length });
  if (u.pathname !== '/lookup') return send(404, { error: 'not_found' });
  if (!safeEq(req.headers['x-ground-key'] || '', KEY)) return send(401, { error: 'unauthorized' });
  const tag = u.searchParams.get('tag') || '';
  const s = sessions.get(tag);
  const ports = new Set((u.searchParams.get('ports') || '').split(',').map(Number).filter((p) => p > 0 && p < 65536));
  const since = Number(u.searchParams.get('since')) || Date.now() - 120_000;
  send(200, {
    ok: true, now: Date.now(), tag,
    sources: s ? [...s.sources.values()] : [],
    bindings: bindings.filter((b) => b.t >= since && ports.has(b.port)).slice(-50),
  });
}).listen(API_PORT, () => log(`[api] lắng nghe :${API_PORT}`));
