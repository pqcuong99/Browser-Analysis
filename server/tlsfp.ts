// Tự đo fingerprint tầng mạng khi server chạy HTTPS trực tiếp (không qua edge):
//  - JA4 từ TLS ClientHello (đọc byte đầu của kết nối TCP trước khi TLS xử lý)
//  - HTTP/2 fingerprint (SETTINGS, WINDOW_UPDATE, thứ tự pseudo-header) kiểu Akamai
import { createHash } from 'node:crypto';
import net from 'node:net';
import type { Server } from 'node:http';

export interface ClientHelloInfo {
  ja4: string;
  ja4_r: string;
  tlsVersion: string;
  sni: string | null;
  alpn: string[];
  ciphers: number;
  extensions: number;
}

const isGrease = (v: number) => (v & 0x0f0f) === 0x0a0a && ((v >> 8) & 0xff) === (v & 0xff);
const hex4 = (v: number) => v.toString(16).padStart(4, '0');
const sha12 = (s: string) => (s ? createHash('sha256').update(s).digest('hex').slice(0, 12) : '000000000000');
const VERSIONS: Record<number, string> = { 0x0304: '13', 0x0303: '12', 0x0302: '11', 0x0301: '10', 0x0300: 's3' };

/** Parse TLS record chứa ClientHello. Trả null nếu không phải ClientHello đầy đủ. */
export function parseClientHello(buf: Buffer): ClientHelloInfo | null {
  try {
    if (buf.length < 5 || buf[0] !== 0x16) return null;
    const recLen = buf.readUInt16BE(3);
    const rec = buf.subarray(5, 5 + recLen);
    if (rec[0] !== 0x01) return null;
    let o = 4; // handshake type + length(3)
    const legacyVersion = rec.readUInt16BE(o); o += 2;
    o += 32; // random
    o += 1 + rec[o]; // session id
    const csLen = rec.readUInt16BE(o); o += 2;
    const ciphers: number[] = [];
    for (let i = 0; i < csLen; i += 2) ciphers.push(rec.readUInt16BE(o + i));
    o += csLen;
    o += 1 + rec[o]; // compression
    const exts: number[] = [];
    let sni: string | null = null;
    let alpn: string[] = [];
    let sigAlgs: number[] = [];
    let versions: number[] = [];
    if (o + 2 <= rec.length) {
      const end = o + 2 + rec.readUInt16BE(o);
      o += 2;
      while (o + 4 <= end) {
        const type = rec.readUInt16BE(o), l = rec.readUInt16BE(o + 2);
        const d = rec.subarray(o + 4, o + 4 + l);
        exts.push(type);
        if (type === 0x0000 && d.length > 5) sni = d.subarray(5, 5 + d.readUInt16BE(3)).toString('ascii');
        if (type === 0x0010 && d.length > 2) {
          for (let i = 2; i < d.length;) { const n = d[i]; alpn.push(d.subarray(i + 1, i + 1 + n).toString('ascii')); i += 1 + n; }
        }
        if (type === 0x000d && d.length > 2) for (let i = 2; i + 1 < d.length; i += 2) sigAlgs.push(d.readUInt16BE(i));
        if (type === 0x002b && d.length > 1) for (let i = 1; i + 1 < d.length; i += 2) versions.push(d.readUInt16BE(i));
        o += 4 + l;
      }
    }
    const cs = ciphers.filter((c) => !isGrease(c));
    const ex = exts.filter((e) => !isGrease(e));
    versions = versions.filter((v) => !isGrease(v));
    sigAlgs = sigAlgs.filter((v) => !isGrease(v));
    const ver = VERSIONS[versions.length ? Math.max(...versions) : legacyVersion] ?? '00';
    const a = alpn[0] ?? '';
    const alpnCode = !a ? '00' : /^[\x21-\x7e]+$/.test(a) ? a[0] + a[a.length - 1] : '99';
    const n2 = (n: number) => String(Math.min(99, n)).padStart(2, '0');
    const ja4a = `t${ver}${sni ? 'd' : 'i'}${n2(cs.length)}${n2(ex.length)}${alpnCode}`;
    const csSorted = cs.map(hex4).sort().join(',');
    const exSorted = ex.filter((e) => e !== 0x0000 && e !== 0x0010).map(hex4).sort().join(',');
    const sig = sigAlgs.map(hex4).join(',');
    const cPart = sig ? `${exSorted}_${sig}` : exSorted;
    return {
      ja4: `${ja4a}_${sha12(csSorted)}_${sha12(cPart)}`,
      ja4_r: `${ja4a}_${csSorted}_${cPart}`,
      tlsVersion: ver, sni, alpn, ciphers: cs.length, extensions: ex.length,
    };
  } catch {
    return null;
  }
}

// ---------- kết nối -> ClientHello ----------
const byConn = new Map<string, ClientHelloInfo>();
const connKey = (addr?: string, port?: number) => `${addr}|${port}`;

/**
 * Mở cổng TCP, đọc ClientHello rồi chuyển socket cho server HTTPS/HTTP2 của Fastify.
 * `target` là app.server (Http2SecureServer với allowHTTP1).
 */
export function startTlsFrontend(target: Server, port: number, host: string) {
  const front = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    const key = connKey(socket.remoteAddress, socket.remotePort);
    const done = () => {
      socket.removeListener('data', onData);
      socket.pause();
      socket.unshift(buf);
      const info = parseClientHello(buf);
      if (info) byConn.set(key, info);
      socket.once('close', () => byConn.delete(key));
      // Không resume(): TLSSocket tự đọc phần đã unshift (initRead) rồi đọc tiếp trực tiếp từ handle
      target.emit('connection', socket);
    };
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      // đủ 1 TLS record (5 byte header + length) hoặc không phải TLS
      if (buf[0] !== 0x16 || (buf.length >= 5 && buf.length >= 5 + buf.readUInt16BE(3)) || buf.length > 16384) done();
    };
    socket.on('data', onData);
    socket.on('error', () => {});
  });
  return new Promise<net.Server>((resolve, reject) => {
    front.once('error', reject);
    front.listen(port, host, () => resolve(front));
  });
}

const H2_DEFAULTS: Record<string, [number, number | boolean]> = {
  headerTableSize: [1, 4096], enablePush: [2, true], maxConcurrentStreams: [3, 4294967295],
  initialWindowSize: [4, 65535], maxFrameSize: [5, 16384], maxHeaderListSize: [6, 65535],
};
const PSEUDO: Record<string, string> = { ':method': 'm', ':authority': 'a', ':scheme': 's', ':path': 'p' };

/** Fingerprint đo được cho request hiện tại (rỗng nếu request đến qua HTTP thường) */
export function measuredNet(raw: any): { ja4?: string; ja4_r?: string; h2?: string; httpVersion?: string; tlsInfo?: ClientHelloInfo } {
  const out: { ja4?: string; ja4_r?: string; h2?: string; httpVersion?: string; tlsInfo?: ClientHelloInfo } = {};
  const sock = raw?.stream?.session?.socket ?? raw?.socket;
  const info = sock ? byConn.get(connKey(sock.remoteAddress, sock.remotePort)) : undefined;
  if (!info) return out;
  out.ja4 = info.ja4;
  out.ja4_r = info.ja4_r;
  out.tlsInfo = info;
  out.httpVersion = raw.httpVersion === '2.0' ? '2' : raw.httpVersion;
  const session = raw?.stream?.session;
  if (session) {
    const rs = session.remoteSettings ?? {};
    const settings = Object.entries(H2_DEFAULTS)
      .filter(([k, [, def]]) => rs[k] !== undefined && rs[k] !== def)
      .map(([k, [id]]) => `${id}:${rs[k] === false ? 0 : rs[k] === true ? 1 : rs[k]}`)
      .join(';');
    const wu = Math.max(0, (session.state?.remoteWindowSize ?? 65535) - 65535);
    const raws: string[] = raw.rawHeaders ?? [];
    const order: string[] = [];
    for (let i = 0; i < raws.length; i += 2) if (PSEUDO[raws[i]]) order.push(PSEUDO[raws[i]]);
    out.h2 = `${settings}|${wu}|0|${order.join(',')}`;
  }
  return out;
}
