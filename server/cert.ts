// Tạo chứng chỉ X.509 tự ký (ECDSA P-256) cho localhost bằng Node thuần, không cần openssl.
// Chỉ dùng cho môi trường phát triển để server tự đo JA4 / HTTP/2 fingerprint.
import { X509Certificate, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const ctx = (n: number, body: Buffer) => tlv(0xa0 + n, body); // [n] EXPLICIT, constructed
const octet = (b: Buffer) => tlv(0x04, b);
const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
function int(b: Buffer) {
  let x = b;
  while (x.length > 1 && x[0] === 0 && !(x[1] & 0x80)) x = x.subarray(1);
  if (x[0] & 0x80) x = Buffer.concat([Buffer.from([0]), x]);
  return tlv(0x02, x);
}
function oid(s: string) {
  const p = s.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const stack = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) stack.unshift((x & 0x7f) | 0x80);
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}
function utcTime(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, 'ascii'));
}

export function createSelfSignedCert(hosts = ['localhost'], ips = ['127.0.0.1', '::1']) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const name = seq(set(seq(oid('2.5.4.3'), utf8('SentinelFP local dev'))));
  const now = Date.now();
  const san = seq(
    ...hosts.map((h) => tlv(0x82, Buffer.from(h, 'ascii'))),
    ...ips.map((ip) => tlv(0x87, ip.includes(':') ? Buffer.alloc(16, 0).fill(1, 15) : Buffer.from(ip.split('.').map(Number)))),
  );
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(
    ctx(0, int(Buffer.from([2]))),
    int(serial),
    ecdsaSha256,
    name,
    seq(utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + 397 * 86_400_000))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    ctx(3, seq(
      seq(oid('2.5.29.17'), octet(san)),
      seq(oid('2.5.29.19'), bool(true), octet(seq())),
      seq(oid('2.5.29.37'), octet(seq(oid('1.3.6.1.5.5.7.3.1')))),
    )),
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = seq(tbs, ecdsaSha256, bitString(signature));
  const b64 = der.toString('base64').match(/.{1,64}/g)!.join('\n');
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

/** Đọc chứng chỉ trong thư mục, tạo mới nếu chưa có hoặc đã hết hạn */
export function loadOrCreateCert(dir: string) {
  const certPath = join(dir, 'cert.pem'), keyPath = join(dir, 'key.pem');
  if (existsSync(certPath) && existsSync(keyPath)) {
    const cert = readFileSync(certPath, 'utf8');
    try {
      if (new Date(new X509Certificate(cert).validTo).getTime() > Date.now() + 86_400_000) return { cert, key: readFileSync(keyPath, 'utf8'), created: false };
    } catch {}
  }
  mkdirSync(dir, { recursive: true });
  const c = createSelfSignedCert();
  writeFileSync(certPath, c.cert);
  writeFileSync(keyPath, c.key, { mode: 0o600 });
  return { ...c, created: true };
}
