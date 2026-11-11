import { randomBytes } from 'node:crypto';

// Đọc .env nếu có (Node >= 21.7), biến môi trường đặt sẵn vẫn được ưu tiên
try { (process as any).loadEnvFile?.(); } catch { /* không có .env */ }

const env = process.env;

let secret = env.BG_SECRET ?? '';
if (!secret) {
  secret = randomBytes(32).toString('hex');
  console.warn('[sentinelfp] BG_SECRET chưa được đặt: dùng secret ngẫu nhiên, token sẽ mất hiệu lực khi restart.');
}

const h = (name: string, fallback: string) => (env[name] ?? fallback).toLowerCase();

export const config = {
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '127.0.0.1',
  secret,
  /** enforce: chặn thật; monitor: chỉ ghi log, luôn cho qua */
  mode: (env.BG_MODE === 'monitor' ? 'monitor' : 'enforce') as 'monitor' | 'enforce',
  trustProxy: env.TRUST_PROXY === '1',
  /**
   * Header do Edge/Reverse proxy gắn vào (JA4, HTTP/2, p0f, ASN, GeoIP).
   * Chỉ được tin khi chạy sau proxy tin cậy (TRUST_PROXY=1 hoặc TRUST_EDGE=1), nếu không client tự đặt được.
   */
  edge: {
    trusted: env.TRUST_PROXY === '1' || env.TRUST_EDGE === '1',
    headers: {
      ja4: h('TLS_HEADER', 'x-ja4'),
      ja3: h('JA3_HEADER', 'x-ja3'),
      tlsClient: h('TLS_CLIENT_HEADER', 'x-tls-client'),
      h2: h('H2_HEADER', 'x-h2-fingerprint'),
      httpVersion: h('HTTP_VERSION_HEADER', 'x-http-version'),
      tcpOs: h('TCP_OS_HEADER', 'x-tcp-os'),
      asn: h('ASN_HEADER', 'x-asn'),
      asnOrg: h('ASN_ORG_HEADER', 'x-asn-org'),
      asnType: h('ASN_TYPE_HEADER', 'x-asn-type'),
      country: h('COUNTRY_HEADER', 'x-geo-country'),
      ipTimezone: h('IP_TZ_HEADER', 'x-geo-timezone'),
      ipFlags: h('IP_FLAGS_HEADER', 'x-ip-flags'),
    },
  },
  tokenTtlSec: Number(env.TOKEN_TTL ?? 1800),
  /** Số request/phút cho phiên đã vượt CHALLENGE bằng Proof-of-Work (bị gắn cờ) */
  flaggedRateLimit: Number(env.FLAGGED_RATE_LIMIT ?? 30),
  /** HTTPS cục bộ để server tự đo JA4 + HTTP/2 fingerprint. 0 = tắt */
  httpsPort: Number(env.HTTPS_PORT ?? 3443),
  tlsDir: env.TLS_DIR ?? 'data/tls',
  nonceTtlSec: 120,
  stun: (env.STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478').split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * Dịch vụ trả IP public của trình duyệt (đi qua proxy của nó). Chỉ gửi cho probe khi server thấy IP nội bộ
   * (scan ở localhost), để WRTC_01 có IP egress mà so với srflx. Đặt rỗng để tắt.
   */
  ipEcho: (env.IP_ECHO_URLS ?? 'https://api.ipify.org?format=json,https://api64.ipify.org?format=json').split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * STUN/TURN đối chiếu chạy trên VPS (vps/stun-listener.cjs): ghi IP:port nguồn thật của gói UDP để so với candidate (WRTC_09).
   * Bật khi có GROUND_HOST + GROUND_KEY.
   */
  ground: {
    host: env.GROUND_HOST ?? '',
    stunPort: Number(env.GROUND_STUN_PORT ?? 3478),
    api: env.GROUND_API ?? (env.GROUND_HOST ? `http://${env.GROUND_HOST}:8478` : ''),
    key: env.GROUND_KEY ?? '',
    get enabled() { return !!(this.host && this.key.length >= 16); },
  },
  adminKey: env.ADMIN_KEY ?? '',
  dbPath: env.DB_PATH ?? 'data/scans.db',
  cookieName: 'bg_token',
  /** Ngưỡng Trust Score mặc định: ≥ SAFE_SCORE → ALLOW, ≥ SUSPICIOUS_SCORE → CHALLENGE, còn lại BLOCK */
  thresholds: {
    safe: Number(env.SAFE_SCORE ?? 80),
    suspicious: Number(env.SUSPICIOUS_SCORE ?? 50),
  },
};
