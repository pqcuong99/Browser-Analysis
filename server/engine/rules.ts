import { brandMajor, chPlatformMatchesOS, parseSecChUa, platformMatchesOS, realBrands, type OS, type ParsedUA } from './ua.ts';
import type { NetIntel } from './types.ts';

export interface Ctx {
  data: any;
  http: { ip: string; headers: Record<string, string | undefined> };
  net: NetIntel;
  ua: ParsedUA;          // parse từ navigator.userAgent
  engine: string;        // engine thật đo bằng JS (blink | gecko | webkit)
  /** Brave/Firefox/Safari có tính năng chống fingerprint tích hợp: noise là hợp lệ */
  privacyBrowser: boolean;
  privacyReason: string | null;
  serverNow: number;
}

/**
 * hit  = điều kiện kích hoạt của rule thỏa (status lấy từ rulebook, có thể hạ cấp)
 * pass = kiểm tra xong, hợp lệ
 * na   = không đủ dữ liệu để kết luận
 */
export interface Outcome {
  result: 'hit' | 'pass' | 'na';
  message: string;
  observed?: unknown;
  /** Hạ cấp FAIL -> WARNING khi có ngoại lệ hợp lệ (ví dụ privacy browser) */
  downgrade?: boolean;
  /** Độ tin cậy riêng cho lần đánh giá này (ghi đè c_i mặc định) */
  confidence?: number;
}

const pass = (message: string, observed?: unknown): Outcome => ({ result: 'pass', message, observed });
const na = (message: string, observed?: unknown): Outcome => ({ result: 'na', message, observed });
const hit = (message: string, observed?: unknown, extra: Partial<Outcome> = {}): Outcome => ({ result: 'hit', message, observed, ...extra });

/** Brave/Firefox/Safari: noise canvas/audio/webgl là tính năng privacy, chỉ WARNING với độ tin cậy thấp */
const privacyHit = (ctx: Ctx, message: string, observed?: unknown): Outcome =>
  ctx.privacyBrowser
    ? hit(`${message} (hợp lệ với ${ctx.privacyReason})`, observed, { downgrade: true, confidence: 0.2 })
    : hit(message, observed);

// ---------------- tiện ích mạng ----------------
const stripV4Mapped = (ip: string) => ip.replace(/^::ffff:/i, '');
const isV4 = (ip: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
export const isPrivateIp = (ip: string) =>
  /^(127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|fe80:|f[cd][0-9a-f]{2}:)/i.test(stripV4Mapped(ip)) ||
  ip === 'localhost';
function sameSubnet(a: string, b: string) {
  if (isV4(a) && isV4(b)) return a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.');
  if (!isV4(a) && !isV4(b)) return a.toLowerCase().split(':').slice(0, 3).join(':') === b.toLowerCase().split(':').slice(0, 3).join(':');
  return false;
}

/** IP public mà WebRTC để lộ: srflx, host IP thô public, raddr public (window chính + iframe) */
function webrtcPublicIps(w: any): { ip: string; via: string }[] {
  const out: { ip: string; via: string }[] = [];
  const seen = new Set<string>();
  const add = (ip: unknown, via: string) => {
    const a = stripV4Mapped(String(ip ?? ''));
    if (!a || a.endsWith('.local') || a === '0.0.0.0' || a === '::' || isPrivateIp(a) || !/^[0-9a-f:.]+$/i.test(a) || seen.has(a)) return;
    seen.add(a); out.push({ ip: a, via });
  };
  for (const [cs, realm] of [[w.candidates ?? [], ''], [w.iframe?.candidates ?? [], ' (iframe)']] as [any[], string][]) {
    for (const c of cs) {
      if (c.type === 'srflx') add(c.address, `srflx${realm}`);
      if (c.type === 'host') add(c.address, `host${realm}`);
      if (c.type === 'srflx' && c.raddr) add(c.raddr, `raddr${realm}`);
    }
  }
  return out;
}

/** IP egress để so với WebRTC: IP HTTP nếu là IP public, nếu không thì IP probe tự hỏi qua proxy của trình duyệt */
function egressIps(ctx: Ctx): { ips: string[]; source: 'http' | 'client' } | null {
  const ip = stripV4Mapped(ctx.http.ip);
  if (!isPrivateIp(ip)) return { ips: [ip], source: 'http' };
  const list = (ctx.data.egress?.ips ?? []).map((x: unknown) => stripV4Mapped(String(x))).filter((x: string) => /^[0-9a-f:.]+$/i.test(x) && !isPrivateIp(x));
  return list.length ? { ips: [...new Set<string>(list)], source: 'client' } : null;
}

/** Type preference hợp lệ của libwebrtc theo loại candidate (priority >>> 24) */
const TYPE_PREF: Record<string, number[]> = {
  'host/udp': [126], 'host/tcp': [90], host: [126, 90],
  srflx: [100], 'prflx/udp': [110], 'prflx/tcp': [80], prflx: [110, 80], relay: [0, 1, 2],
};

// ---------------- tiện ích engine/tính năng ----------------
// Tính năng JS và phiên bản đầu tiên hỗ trợ (biên sai số ±1)
const CHROME_FEATURES: [string, number][] = [
  ['findLast', 97], ['structuredClone', 98], ['toSorted', 110], ['groupBy', 117],
  ['withResolvers', 119], ['fromAsync', 121], ['setUnion', 122], ['urlParse', 126],
  ['promiseTry', 128], ['float16Array', 135], ['regexpEscape', 136],
];
const FIREFOX_FEATURES: [string, number][] = [
  ['structuredClone', 94], ['findLast', 104], ['toSorted', 115], ['fromAsync', 115],
  ['groupBy', 119], ['withResolvers', 121], ['urlParse', 126], ['setUnion', 127], ['promiseTry', 134],
];

const EXPECTED_LENGTH: Record<string, number> = {
  'HTMLCanvasElement.toDataURL': 0, 'HTMLCanvasElement.toBlob': 1, 'HTMLCanvasElement.getContext': 1,
  'CanvasRenderingContext2D.getImageData': 4, 'CanvasRenderingContext2D.measureText': 1,
  'CanvasRenderingContext2D.fillText': 3, 'WebGLRenderingContext.getParameter': 1,
  'WebGLRenderingContext.readPixels': 7, 'WebGLRenderingContext.getExtension': 1,
  'WebGLRenderingContext.getSupportedExtensions': 0, 'WebGL2RenderingContext.getParameter': 1,
  'Date.getTimezoneOffset': 0, 'Intl.DateTimeFormat.resolvedOptions': 0, 'AudioBuffer.getChannelData': 1,
  'AudioBuffer.copyFromChannel': 2, 'AnalyserNode.getFloatFrequencyData': 1, 'OfflineAudioContext.startRendering': 0,
  'Element.getBoundingClientRect': 0, 'RTCPeerConnection.createOffer': 0, 'RTCPeerConnection.setLocalDescription': 0,
  'RTCPeerConnection.createDataChannel': 1,
};

/** Lý do một hàm native bị coi là đã bị thay bằng JavaScript (chỉ xét realm chính) */
export function hookReasons(x: any): string[] {
  const reasons: string[] = [];
  if (x.notFunction) return ['getter bị thay bằng giá trị tĩnh'];
  if (x.nativeMain === false) reasons.push('toString không phải [native code]');
  if (x.toStringHasName === false) reasons.push('toString mất tên hàm (dấu hiệu Proxy)');
  // Constructor native luôn có prototype, chỉ method/getter mới không có
  if (x.hasPrototype && x.kind !== 'ctor') reasons.push('có thuộc tính prototype (hàm JS thường)');
  if (x.ownArguments) reasons.push('có own property arguments/caller (hàm JS non-strict)');
  if (x.illegalInvocation === false) reasons.push('không ném TypeError khi gọi sai this');
  if (typeof x.extraFrames === 'number' && x.extraFrames > 0) reasons.push(`stack trace có ${x.extraFrames} frame wrapper`);
  const short = String(x.name).split('.').pop();
  if (x.kind === 'ctor') {
    if (x.fnName !== undefined && x.fnName !== short) reasons.push(`name = "${x.fnName}"`);
  } else {
    const expName = x.kind === 'get' ? `get ${short}` : short;
    if (x.fnName !== undefined && x.fnName !== expName) reasons.push(`name = "${x.fnName}"`);
    const expLen = x.kind === 'get' ? 0 : EXPECTED_LENGTH[x.name];
    if (expLen !== undefined && typeof x.length === 'number' && x.length !== expLen) reasons.push(`length = ${x.length}, mong đợi ${expLen}`);
  }
  return reasons;
}

function hookedTargets(ctx: Ctx, filter: (name: string) => boolean) {
  const t = ctx.data.tamper?.targets;
  if (!Array.isArray(t)) return null;
  const sel = t.filter((x: any) => filter(String(x.name)));
  const bad = sel
    .map((x: any) => ({ api: x.name, reasons: hookReasons(x), source: x.source }))
    .filter((x: any) => x.reasons.length);
  return { checked: sel.length, bad };
}

// ---------------- GPU ----------------
const SOFT_GPU = /swiftshader|llvmpipe|softpipe|microsoft basic render|software rasterizer|mesa offscreen|vmware svga|svga3d|parallels|virtualbox|virgl/i;
const isAppleGpu = (r: string) => /apple (m\d|gpu)|metal renderer: apple|\bapple\b/i.test(r);
const isD3D = (r: string) => /direct3d|\bd3d(9|11|12)\b/i.test(r);

function gpuOsReason(os: OS, renderer: string): string | null {
  const r = renderer.toLowerCase();
  const mobileGpu = /adreno|mali-|powervr|xclipse|immortalis/.test(r);
  const desktopGpu = /geforce|radeon|quadro|\brtx\b|\bgtx\b|iris|uhd graphics|hd graphics/.test(r);
  switch (os) {
    case 'Windows': return isAppleGpu(r) ? 'GPU Apple trên Windows' : null;
    case 'macOS': return isD3D(r) ? 'Renderer Direct3D trên macOS' : mobileGpu ? 'GPU di động Android trên macOS' : null;
    case 'Linux': case 'ChromeOS': return isD3D(r) ? 'Renderer Direct3D trên Linux' : isAppleGpu(r) ? 'GPU Apple trên Linux' : null;
    case 'Android':
      if (isD3D(r)) return 'Renderer Direct3D trên Android';
      if (isAppleGpu(r)) return 'GPU Apple trên Android';
      return desktopGpu && !/intel/.test(r) ? 'GPU desktop rời trên Android' : null;
    case 'iOS': return isD3D(r) ? 'Renderer Direct3D trên iOS' : !isAppleGpu(r) && renderer ? 'iOS nhưng GPU không phải Apple' : null;
    default: return null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function diffFields(main: Record<string, any>, other: Record<string, any>, keys: string[]) {
  const out: Record<string, { main: unknown; other: unknown }> = {};
  for (const k of keys) {
    if (other[k] === undefined) continue;
    if (!same(main[k], other[k])) out[k] = { main: main[k], other: other[k] };
  }
  return out;
}

const baseLang = (l: string) => String(l || '').split('-')[0].toLowerCase();

/** Offset (phút, dương = đông UTC) của một IANA timezone tại thời điểm cho trước */
export function tzOffset(tz: string, at = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at);
    const v = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (v === 'GMT' || v === 'UTC') return 0;
    const m = v.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : null;
  } catch {
    return null;
  }
}

// ---------------- TLS / HTTP2 ----------------
type ClientFamily = 'chromium' | 'firefox' | 'safari' | 'library' | 'unknown';
export function tlsFamily(net: NetIntel): { family: ClientFamily; basis: string } {
  if (net.tlsClient) {
    const c = net.tlsClient.toLowerCase();
    if (/chrom|edge|opera|brave/.test(c)) return { family: 'chromium', basis: `edge: ${net.tlsClient}` };
    if (/firefox|gecko/.test(c)) return { family: 'firefox', basis: `edge: ${net.tlsClient}` };
    if (/safari|webkit/.test(c)) return { family: 'safari', basis: `edge: ${net.tlsClient}` };
    if (/curl|python|requests|go|node|java|okhttp|wget|axios|httpx|aiohttp/.test(c)) return { family: 'library', basis: `edge: ${net.tlsClient}` };
  }
  const m = net.ja4?.match(/^([tq])(\d\d)([di])(\d\d)(\d\d)([0-9a-z]{2})_/i);
  if (!m) return { family: 'unknown', basis: 'không có JA4' };
  const [, , ver, , ciphers, , alpn] = m;
  const nc = Number(ciphers);
  if (alpn === '00' || alpn === 'h1' || ver !== '13') return { family: 'library', basis: `JA4 ALPN=${alpn}, TLS=${ver}` };
  if (nc >= 15 && nc <= 16) return { family: 'chromium', basis: `JA4 ${nc} cipher` };
  if (nc >= 17 && nc <= 18) return { family: 'firefox', basis: `JA4 ${nc} cipher` };
  if (nc >= 19 && nc <= 22) return { family: 'safari', basis: `JA4 ${nc} cipher` };
  return { family: 'library', basis: `JA4 ${nc} cipher (không thuộc trình duyệt phổ biến)` };
}

const uaFamily = (ua: ParsedUA): ClientFamily =>
  ua.os === 'iOS' || ua.browser === 'Safari' ? 'safari' : ua.engine === 'blink' ? 'chromium' : ua.engine === 'gecko' ? 'firefox' : 'unknown';

const H2_ORDER: Record<string, string> = { chromium: 'm,a,s,p', firefox: 'm,p,a,s', safari: 'm,s,p,a' };

// ---------------- AUDIO baseline ----------------
// Tổng biên độ (mẫu 4500..5000) quan sát trên Chromium Windows (các GPU/CPU khác nhau)
const AUDIO_WINDOWS_CHROMIUM = [124.04347527516074, 124.04347776696522, 124.04362149687222];
const audioFamily = (s: number) => (s > 120 && s < 128 ? 'blink' : s > 35.5 && s < 36 ? 'gecko' : s > 34.5 && s < 35.5 ? 'webkit' : 'unknown');

// =====================================================================
export const EVALUATORS: Record<string, (ctx: Ctx) => Outcome> = {
  // ---------------- CANVAS ----------------
  CANV_01: (ctx) => {
    const c = ctx.data.canvas;
    if (!c?.supported) return na('Canvas không khả dụng', c?.error);
    if (c.blank || c.uniform) return na('Canvas bị chặn đọc (xem CANV_05)');
    const signs: string[] = [];
    if (c.hashA !== c.hashB) signs.push(`2 lần vẽ giống hệt khác nhau ${c.diffBytes ?? '?'} byte`);
    if (c.hashRereadB !== undefined && c.hashReread !== c.hashRereadB) signs.push('lần đọc lại của 2 canvas giống nhau lại khác nhau');
    if (c.dataUrlHashA && c.dataUrlHashB && c.dataUrlHashA !== c.dataUrlHashB) signs.push('toDataURL của 2 canvas giống nhau khác nhau');
    if (c.solidBadPixels > 0) signs.push(`ô màu đặc sai ${c.solidBadPixels}/${c.solidTotal} pixel`);
    const obs = { run_1: c.hashA, run_2: c.hashB, reread_a: c.hashReread, reread_b: c.hashRereadB, solid_bad_pixels: c.solidBadPixels };
    return signs.length ? privacyHit(ctx, `Canvas không tất định: ${signs.join('; ')}`, obs) : pass('2 lần dựng hình cho cùng hash', obs);
  },
  CANV_02: (ctx) => {
    const c = ctx.data.canvas, w = ctx.data.worker;
    if (!c?.supported || c.blank || c.uniform) return na('Canvas không khả dụng');
    if (!w?.supported || !w.canvas2d) return na('Worker không có OffscreenCanvas 2D', w?.canvasError ?? w?.error);
    const obs = { main: c.geoHash, worker: w.canvas2d };
    return c.geoHash === w.canvas2d ? pass('Main thread và Worker cho cùng hash', obs)
      : privacyHit(ctx, 'Hash Canvas ở main thread khác OffscreenCanvas trong Worker', obs);
  },
  CANV_03: (ctx) => {
    const c = ctx.data.canvas;
    if (!c?.supported || c.blank || c.uniform) return na('Canvas không khả dụng');
    if (typeof c.decodedDiffPixels !== 'number') return na('Không giải mã được toDataURL', c.decodeError);
    const obs = { differing_pixels: c.decodedDiffPixels, total_pixels: c.decodedTotal };
    return c.decodedDiffPixels === 0 ? pass('getImageData và toDataURL trả cùng pixel', obs)
      : privacyHit(ctx, `${c.decodedDiffPixels}/${c.decodedTotal} pixel khác nhau giữa getImageData và toDataURL`, obs);
  },
  CANV_04: (ctx) => {
    const r = hookedTargets(ctx, (n) => /^(HTMLCanvasElement|CanvasRenderingContext2D|OffscreenCanvas)/.test(n));
    if (!r) return na('Thiếu dữ liệu tampering');
    return r.bad.length ? hit(`${r.bad.length} hàm Canvas bị ghi đè bằng JavaScript`, r.bad) : pass(`${r.checked} hàm Canvas đều native`);
  },
  CANV_05: (ctx) => {
    const c = ctx.data.canvas;
    if (!c) return na('Thiếu dữ liệu');
    if (!c.supported) return hit('Canvas ném lỗi hoặc không tạo được context', c.error);
    if (c.blank || c.uniform) return hit('Canvas trả ảnh trống/đồng màu: bị chặn bởi cài đặt quyền riêng tư', { blank: c.blank, uniform: c.uniform });
    return pass('Canvas đọc được');
  },

  CANV_06: (ctx) => {
    const c = ctx.data.canvas;
    if (!c?.supported || c.blank || c.uniform) return na('Canvas không khả dụng');
    const t = c.roundTrip;
    if (!t || typeof t.changedPx !== 'number') return na('Probe cũ, không có phép thử round-trip');
    const obs = {
      round_trip_changed_px: t.changedPx, total_px: t.total, max_delta: t.maxDelta, opaque_alpha_changed: t.alphaBad,
      changed_bytes_rgba: t.channels, quad_bad_px: t.quadBad, solid_bad_px: c.solidBadPixels,
    };
    if (!t.changedPx && !t.quadBad && !(c.solidBadPixels > 0)) return pass('Pixel ghi vào đọc ra chính xác', obs);
    const parts = [`${t.changedPx}/${t.total} pixel putImageData→getImageData bị đổi (max ±${t.maxDelta})`];
    if (t.alphaBad) parts.push(`${t.alphaBad} pixel đục có alpha ≠ 255`);
    if (t.quadBad) parts.push(`${t.quadBad}/${t.quadTotal} pixel ô màu đặc sai`);
    return privacyHit(ctx, `Canvas bị chèn noise: ${parts.join('; ')}`, obs);
  },

  CANV_07: (ctx) => {
    const c = ctx.data.canvas;
    if (!c?.supported || c.blank || c.uniform) return na('Canvas không khả dụng');
    const g = c.glyphRun;
    if (!g) return na('Probe cũ, không có phép thử glyph run');
    if (g.error || !g.checked) return na('Không chạy được phép thử glyph run', g.error);
    if (ctx.engine !== 'blink') return na('Phép thử glyph run mới hiệu chỉnh trên Blink', g);
    const obs = { cases_checked: g.checked, cases_bad: g.bad, diff_bytes: g.diffBytes, cases: g.cases };
    if (g.cases.every((x: any) => !x.ink)) return na('Không có mực chữ trong vùng so sánh (font không vẽ được)', obs);
    if (!g.bad) return pass(`${g.checked} cặp glyph: glyph đầu của "XX" giống hệt "X"`, obs);
    return privacyHit(ctx, `${g.bad}/${g.checked} cặp glyph: glyph đầu của chuỗi 2 ký tự lệch ${g.diffBytes} byte so với chính nó khi vẽ đơn lẻ (noise vị trí chữ lúc vẽ)`, obs);
  },

  // ---------------- WEBRTC ----------------
  WRTC_01: (ctx) => {
    const w = ctx.data.webrtc;
    if (!w?.supported) return na('WebRTC không khả dụng');
    const exposed = webrtcPublicIps(w);
    if (!exposed.length) return na('WebRTC không lộ IP public nào (không có srflx/host public)');
    const eg = egressIps(ctx);
    const httpIp = stripV4Mapped(ctx.http.ip);
    if (!eg) return na(`IP HTTP là IP nội bộ (${httpIp}) và probe không lấy được IP egress để so`, { webrtc_public_ips: exposed, egress_probe: ctx.data.egress });
    const obs = {
      egress_ip: eg.ips, egress_source: eg.source === 'http' ? 'IP kết nối HTTP' : 'Probe hỏi IP echo qua proxy của trình duyệt',
      webrtc_public_ips: exposed,
    };
    const fam = (v4: boolean) => eg.ips.filter((a) => isV4(a) === v4);
    const sameAsn = !!(ctx.net.asn && ctx.net.webrtcIp?.asn && ctx.net.asn === ctx.net.webrtcIp.asn);
    const leaks: typeof exposed = [];
    let crossFamily = false;
    for (const x of exposed) {
      if (eg.ips.includes(x.ip)) continue;
      const same = fam(isV4(x.ip));
      if (same.length) {
        if (same.some((a) => sameSubnet(a, x.ip)) || (eg.source === 'http' && sameAsn)) continue;
        leaks.push(x);
      } else if (eg.source === 'client' && !isV4(x.ip)) {
        // Đã hỏi endpoint dual-stack mà egress chỉ có IPv4, nhưng WebRTC vẫn ra được IPv6: UDP đi thẳng, không qua proxy
        leaks.push(x); crossFamily = true;
      }
    }
    if (!leaks.length) return pass(`IP public lộ qua WebRTC trùng IP egress (${eg.ips.join(', ')})`, obs);
    const list = leaks.map((x) => `${x.ip} (${x.via})`).join(', ');
    const confidence = crossFamily && leaks.every((x) => !isV4(x.ip)) ? 0.6 : eg.source === 'client' ? 0.8 : undefined;
    return hit(`WebRTC lộ IP ${list} khác IP egress ${eg.ips.join(', ')}: UDP/STUN không đi qua proxy`, obs, confidence ? { confidence } : {});
  },
  WRTC_02: (ctx) => {
    const { asnType, country, webrtcIp } = ctx.net;
    if (!asnType || !webrtcIp?.asnType) return na('Chưa có dữ liệu ASN cho IP HTTP và IP WebRTC (cần GeoIP/ASN ở edge)');
    const obs = { http: { asn: ctx.net.asnOrg, type: asnType, country }, webrtc: webrtcIp };
    const dc = /hosting|datacenter|proxy|vpn/.test(asnType);
    const res = /residential|mobile|isp/.test(webrtcIp.asnType);
    if (dc && res && country && webrtcIp.country && country !== webrtcIp.country)
      return hit(`HTTP đi qua datacenter (${country}) nhưng WebRTC lộ IP dân cư (${webrtcIp.country})`, obs);
    return pass('Không có rò rỉ IP dân cư sau proxy', obs);
  },
  WRTC_03: (ctx) => {
    const w = ctx.data.webrtc;
    if (!w?.supported || !(w.candidates ?? []).length) return na('Không có ICE candidate');
    const re = /^candidate:(\S+) (\d) (udp|tcp) (\d+) (\S+) (\d+) typ (host|srflx|prflx|relay)( |$)/i;
    const blink = ctx.engine === 'blink';
    const bad: { candidate: string; issue: string }[] = [];
    for (const c of w.candidates) {
      const raw = String(c.raw ?? '');
      const m = raw.match(re);
      if (!m) { bad.push({ candidate: raw.slice(0, 120), issue: 'sai cú pháp candidate' }); continue; }
      const [, , comp, proto, prio, addr, port, type] = m;
      const p = Number(port);
      const push = (issue: string) => bad.push({ candidate: raw.slice(0, 120), issue });
      if (!(p >= 0 && p <= 65535) || (proto.toLowerCase() === 'udp' && p === 0)) push(`port ${port} không hợp lệ`);
      if (type === 'srflx' && (isPrivateIp(addr) || addr === '0.0.0.0')) push(`srflx là IP không định tuyến được (${addr})`);
      if (type === 'host' && addr.endsWith('.local') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i.test(addr))
        push('tên mDNS không phải UUID');
      if (w.ufrag && c.ufrag && c.ufrag !== w.ufrag) push(`ufrag "${c.ufrag}" ≠ a=ice-ufrag "${w.ufrag}" trong SDP (candidate không do ICE agent này sinh ra)`);
      if (blink) {
        // libwebrtc: priority = typePref << 24 | localPref << 8 | (256 - component)
        const typePref = Number(prio) >>> 24;
        const allowed = TYPE_PREF[`${type}/${proto.toLowerCase()}`] ?? TYPE_PREF[type];
        if (allowed && !allowed.includes(typePref)) push(`priority ${prio} có type preference ${typePref}, không khớp "typ ${type}" (${allowed.join('/')})`);
        if (comp !== '1') push(`component ${comp} (Chromium dùng rtcp-mux + bundle, luôn = 1)`);
      }
    }
    return bad.length ? hit(`${bad.length} candidate sai chuẩn`, bad) : pass(`${w.candidates.length} candidate đúng cú pháp`);
  },
  WRTC_04: (ctx) => {
    const r = hookedTargets(ctx, (n) => /^RTCPeerConnection/.test(n));
    if (!r) return na('Thiếu dữ liệu tampering');
    if (!r.checked) return na('Không có RTCPeerConnection để kiểm tra');
    return r.bad.length ? hit('RTCPeerConnection bị ghi đè bằng JavaScript', r.bad) : pass(`${r.checked} API WebRTC đều native`);
  },
  WRTC_05: (ctx) => {
    const w = ctx.data.webrtc;
    if (!w) return na('Thiếu dữ liệu');
    if (!w.supported) return hit('RTCPeerConnection không tồn tại hoặc bị chặn', w.error);
    const c = w.candidates ?? [];
    if (!c.length) return w.state === 'timeout' ? na('Gather bị treo, không phải tắt WebRTC hợp lệ (xem WRTC_06)') : hit('ICE gather kết thúc với 0 candidate (chặn UDP không qua proxy)');
    if (!c.some((x: any) => x.type === 'srflx' || x.type === 'relay')) return hit('Chỉ có host candidate, không truy vấn được STUN', c.map((x: any) => x.address));
    return pass(`${c.length} candidate (${w.state})`);
  },
  WRTC_06: (ctx) => {
    const w = ctx.data.webrtc;
    if (!w?.supported) return na('WebRTC không khả dụng');
    const c = w.candidates ?? [];
    const obs = {
      state: w.state, ice_gathering_state: w.gatheringState, gathering_events: w.gatheringEvents, candidates: c.length,
      elapsed_ms: w.ms, timeout_ms: w.timeoutMs ?? 3000, first_candidate_ms: w.tFirst, srflx_ms: w.tSrflx,
      iframe_realm: w.iframe ? { state: w.iframe.state, candidates: w.iframe.candidates?.length ?? null, error: w.iframe.error } : undefined,
    };
    if (w.state !== 'timeout') return pass(`ICE gather kết thúc (${w.state})${w.ms != null ? ` sau ${w.ms} ms` : ''}`, obs);
    if (w.gatheringState === 'new')
      return hit('setLocalDescription xong nhưng ICE không hề bắt đầu gather (iceGatheringState vẫn "new")', obs, { confidence: 0.9 });
    if (c.length) return pass(`Có ${c.length} candidate, chỉ STUN phản hồi chậm`, obs);
    const conf = ctx.privacyBrowser ? 0.3 : w.timeoutMs >= 5000 ? 0.75 : 0.5;
    return hit(`Không sinh candidate nào sau ${obs.timeout_ms} ms mà gather vẫn chưa kết thúc. Trình duyệt tắt WebRTC hợp lệ thì gather kết thúc ngay với 0 candidate`, obs, { confidence: conf });
  },
  WRTC_07: (ctx) => {
    const w = ctx.data.webrtc;
    if (!w?.supported || !(w.candidates ?? []).length) return na('Không có ICE candidate');
    if (ctx.engine !== 'blink') return na('Chỉ đối chiếu trên Blink (mặc định thay IP local bằng <uuid>.local)');
    const seen = new Set<string>();
    const exposed: { ip: string; via: string; private: boolean }[] = [];
    const add = (ip: string, via: string) => {
      if (!ip || seen.has(ip) || ip.endsWith('.local') || ip === '0.0.0.0' || ip === '::') return;
      seen.add(ip); exposed.push({ ip, via, private: isPrivateIp(ip) });
    };
    for (const c of [...w.candidates, ...(w.iframe?.candidates ?? [])]) {
      if (c.type === 'host') add(String(c.address ?? ''), 'host candidate');
      if (c.type === 'srflx' && c.raddr) add(String(c.raddr), 'raddr của srflx');
    }
    const obs = { exposed, camera_permission: w.cameraPermission ?? null };
    if (!exposed.length) return pass('IP local được che bằng mDNS / raddr 0.0.0.0', obs);
    if (w.cameraPermission === 'granted') return pass('Trang đã có quyền camera: Chrome được phép lộ IP local', obs);
    const pub = exposed.filter((x) => !x.private);
    return hit(`${exposed.length} IP local lộ thẳng trong ICE (${exposed.map((x) => x.ip).join(', ')}) dù Chrome mặc định thay bằng <uuid>.local${pub.length ? `; ${pub.length} là IP public của interface` : ''}`, obs);
  },
  WRTC_08: (ctx) => {
    const w = ctx.data.webrtc;
    if (!w?.supported || !(w.candidates ?? []).length) return na('Không có ICE candidate');
    const issues: { check: string; detail: unknown; confidence: number }[] = [];
    let checks = 0;
    const key = (c: any) => `${c.address} ${c.port} ${c.type}`;
    // 1) chuỗi candidate ↔ field của RTCIceCandidate (trình duyệt tự parse)
    const withFields = w.candidates.filter((c: any) => c.fields);
    if (withFields.length) {
      checks++;
      const diff = withFields.filter((c: any) =>
        (c.fields.address != null && c.fields.address !== c.address) ||
        (c.fields.port != null && String(c.fields.port) !== String(c.port)) ||
        (c.fields.type != null && c.fields.type !== c.type));
      if (diff.length) issues.push({
        check: 'candidate string ≠ RTCIceCandidate.address/port/type', confidence: 0.95,
        detail: diff.map((c: any) => ({ string: key(c), fields: `${c.fields.address} ${c.fields.port} ${c.fields.type}` })),
      });
    }
    // 2) onicecandidate ↔ localDescription.sdp
    if (Array.isArray(w.sdpCandidates)) {
      checks++;
      const ev = new Set(w.candidates.map(key));
      const sdp = new Set(w.sdpCandidates.map((r: string) => { const p = r.split(' '); return `${p[4]} ${p[5]} ${p[7]}`; }));
      const onlyEv = [...ev].filter((k) => !sdp.has(k)), onlySdp = [...sdp].filter((k) => !ev.has(k));
      if (onlyEv.length || onlySdp.length) issues.push({
        check: 'onicecandidate ≠ a=candidate trong localDescription', confidence: 0.9,
        detail: { only_in_event: onlyEv, only_in_sdp: onlySdp },
      });
    }
    // 3) window chính ↔ iframe realm sạch
    const fr = w.iframe;
    if (fr && !fr.error && Array.isArray(fr.candidates)) {
      checks++;
      const srflxOf = (cs: any[]) => [...new Set(cs.filter((c) => c.type === 'srflx').map((c) => c.address))].sort();
      const a = srflxOf(w.candidates), b = srflxOf(fr.candidates);
      const mdns = (cs: any[]) => cs.some((c) => c.type === 'host' && String(c.address).endsWith('.local'));
      const raw = (cs: any[]) => cs.some((c) => c.type === 'host' && !String(c.address).endsWith('.local'));
      if (a.length && b.length && a.join() !== b.join())
        issues.push({ check: 'srflx IP ở window ≠ iframe', confidence: 0.9, detail: { main: a, iframe: b } });
      else if (w.state === 'complete' && fr.state === 'complete' && !a.length !== !b.length)
        issues.push({ check: 'chỉ một realm có srflx', confidence: 0.7, detail: { main: a, iframe: b } });
      if (fr.candidates.length && (mdns(w.candidates) !== mdns(fr.candidates) || raw(w.candidates) !== raw(fr.candidates)))
        issues.push({ check: 'kiểu host candidate (mDNS / IP thô) khác giữa window và iframe', confidence: 0.85, detail: { main: w.candidates.map(key), iframe: fr.candidates.map(key) } });
    }
    // 4) nhiều STUN server: NAT thật trả cùng một IP public cho mọi server
    if ((w.stunServers ?? 1) > 1) {
      checks++;
      const v4 = [...new Set(w.candidates.filter((c: any) => c.type === 'srflx' && isV4(String(c.address))).map((c: any) => c.address))];
      if (v4.length > 1) issues.push({ check: 'nhiều IPv4 srflx khác nhau giữa các STUN server', confidence: 0.6, detail: v4 });
    }
    if (!checks) return na('Probe cũ, thiếu dữ liệu đối chiếu (SDP / field / iframe)');
    const obs = { checks, issues };
    if (!issues.length) return pass(`${checks} phép đối chiếu candidate đều khớp (string/field, event/SDP, window/iframe, STUN)`, obs);
    return hit(issues.map((i) => i.check).join('; '), obs, { confidence: Math.max(...issues.map((i) => i.confidence)) });
  },

  WRTC_09: (ctx) => {
    const g = ctx.net.ground;
    if (!g) return na('Chưa cấu hình STUN/TURN đối chiếu trên VPS (GROUND_HOST, GROUND_KEY)');
    if (g.error) return na(`Không hỏi được VPS ${g.vps ?? ''}: ${g.error}`);
    const w = ctx.data.webrtc;
    if (!w?.supported) return na('WebRTC không khả dụng');
    const uniq = (a: string[]) => [...new Set(a)];
    const pub = (ip: string) => !!ip && !isPrivateIp(ip);
    const tagged = (g.sources ?? []).map((s) => ({ ...s, ip: stripV4Mapped(String(s.ip)) })).filter((s) => pub(s.ip));
    const udp = uniq(tagged.filter((s) => s.proto === 'udp').map((s) => s.ip));
    const tcp = uniq(tagged.filter((s) => s.proto === 'tcp').map((s) => s.ip));
    // Không có gói TURN mang tag: dùng STUN Binding đến VPS trùng port với srflx mà JS báo
    const srflxPorts = new Set((w.candidates ?? []).filter((c: any) => c.type === 'srflx').map((c: any) => Number(c.port)));
    const byPort = (g.bindings ?? []).map((b) => ({ ...b, ip: stripV4Mapped(String(b.ip)) }))
      .filter((b) => b.proto === 'udp' && pub(b.ip) && srflxPorts.has(Number(b.port)));
    const real = udp.length ? udp : uniq(byPort.map((b) => b.ip));
    const viaPort = !udp.length && real.length > 0;
    const exposed = webrtcPublicIps(w);
    const shown = exposed.map((x) => x.ip);
    const eg = egressIps(ctx)?.ips ?? [];
    const obs = {
      vps: g.vps, udp_seen_by_vps: tagged.filter((s) => s.proto === 'udp'), tcp_seen_by_vps: tagged.filter((s) => s.proto === 'tcp'),
      stun_bindings_matched_by_port: byPort, webrtc_public_ips_from_js: exposed, egress_ip: eg,
    };
    const match = (a: string, list: string[]) => list.some((b) => b === a || sameSubnet(a, b));
    if (!real.length) {
      if (tcp.length) return pass(`VPS chỉ nhận TURN qua TCP từ ${tcp.join(', ')}: UDP không ra ngoài, WebRTC chỉ đi qua proxy`, obs);
      return na(`VPS không nhận được gói nào của phiên này${shown.length ? ` dù JS báo IP ${shown.join(', ')}` : ''} (UDP bị chặn, hoặc cổng chưa mở trên VPS)`, obs);
    }
    // IP UDP thật mà JS giấu đi, và cũng không phải IP proxy
    const hidden = real.filter((ip) => !match(ip, shown) && !match(ip, eg) && !match(ip, tcp));
    if (hidden.length)
      return hit(`Gói UDP thật đến VPS từ ${hidden.join(', ')} nhưng ICE candidate JS chỉ báo ${shown.join(', ') || '(không có IP public)'}: IP trong WebRTC bị làm giả để che IP thật`,
        obs, viaPort ? { confidence: 0.75 } : {});
    // Candidate báo IP mà VPS không hề thấy gói nào từ đó (cùng họ địa chỉ), cũng không phải IP proxy
    const fams = new Set(real.map(isV4));
    const invented = shown.filter((ip) => fams.has(isV4(ip)) && !match(ip, real) && !match(ip, eg));
    if (invented.length)
      return hit(`Candidate báo IP ${invented.join(', ')} nhưng VPS chỉ thấy gói UDP từ ${real.join(', ')}: candidate bị bịa`, obs, { confidence: 0.85 });
    if (real.every((ip) => match(ip, eg))) return pass(`UDP thật đi qua proxy (${real.join(', ')}) và candidate báo đúng`, obs);
    return pass(`Candidate khớp IP UDP thật VPS thấy (${real.join(', ')}); IP này khác IP proxy nên là lộ IP thật, không phải làm giả (xem WRTC_01)`, obs);
  },

  // ---------------- BROWSER INFO ----------------
  BINF_01: ({ ua, engine, data }) => {
    const d = data.uaData;
    if (engine !== 'blink' || ua.engine !== 'blink') return na('Client Hints chỉ có trên Chromium');
    if (!d?.supported) return (ua.chromeMajor ?? 0) >= 90 ? hit('Chromium ≥ 90 nhưng không có navigator.userAgentData', null, { confidence: 0.6 }) : na('Không có userAgentData');
    const issues: string[] = [];
    const bm = brandMajor(d.brands, ['Chromium', 'Google Chrome', 'Microsoft Edge', 'Opera', 'Brave']);
    const full = d.high?.fullVersionList as { brand: string; version: string }[] | undefined;
    const fm = full ? brandMajor(full, ['Chromium', 'Google Chrome', 'Microsoft Edge']) : null;
    if (bm !== null && bm !== ua.chromeMajor) issues.push(`brands v${bm} ≠ UA v${ua.chromeMajor}`);
    if (fm !== null && fm !== ua.chromeMajor) issues.push(`fullVersionList v${fm} ≠ UA v${ua.chromeMajor}`);
    const brands = realBrands(d.brands);
    if (brands.includes('Microsoft Edge') !== /Edg(A|iOS)?\//.test(ua.raw)) issues.push('brand Edge không khớp UA');
    if (brands.includes('Opera') !== /OPR\//.test(ua.raw)) issues.push('brand Opera không khớp UA');
    if (!chPlatformMatchesOS(ua.os, d.platform)) issues.push(`platform "${d.platform}" ≠ UA ${ua.os}`);
    if (d.mobile !== ua.mobile) issues.push(`mobile ${d.mobile} ≠ UA ${ua.mobile}`);
    const obs = { ua_major: ua.chromeMajor, brands: d.brands, platform: d.platform, mobile: d.mobile, full_version_major: fm };
    return issues.length ? hit(issues.join('; '), obs) : pass('Client Hints khớp User-Agent', obs);
  },
  BINF_02: ({ ua, data }) => {
    const p = data.navigator?.platform;
    if (typeof p !== 'string') return na('Không có navigator.platform');
    return platformMatchesOS(ua.os, p) ? pass(`platform = "${p}"`, p) : hit(`UA khai báo ${ua.os} nhưng navigator.platform = "${p}"`, { declared_os: ua.os, platform: p });
  },
  BINF_03: ({ data, http }) => {
    const issues: string[] = [];
    const hUA = http.headers['user-agent'], jUA = data.navigator?.userAgent;
    if (!hUA || !jUA) return na('Thiếu User-Agent');
    if (hUA !== jUA) issues.push('User-Agent');
    const d = data.uaData;
    const hb = parseSecChUa(http.headers['sec-ch-ua']);
    if (d?.supported) {
      if (!hb) issues.push('thiếu header Sec-CH-UA dù JS có userAgentData');
      else {
        const norm = (l: { brand: string; version: string }[]) => realBrands(l).map((b) => `${b}/${l.find((x) => x.brand === b)?.version}`).sort();
        if (!same(norm(hb), norm(d.brands))) issues.push('Sec-CH-UA brands');
      }
      const hp = http.headers['sec-ch-ua-platform']?.replace(/"/g, '');
      if (hp && hp !== d.platform) issues.push('Sec-CH-UA-Platform');
      const hm = http.headers['sec-ch-ua-mobile'];
      if (hm && (hm === '?1') !== d.mobile) issues.push('Sec-CH-UA-Mobile');
    }
    const obs = { http: { ua: hUA, sec_ch_ua: http.headers['sec-ch-ua'], platform: http.headers['sec-ch-ua-platform'], mobile: http.headers['sec-ch-ua-mobile'] }, js: { ua: jUA, brands: d?.brands, platform: d?.platform, mobile: d?.mobile } };
    return issues.length ? hit(`Header HTTP khác JavaScript: ${issues.join(', ')}`, obs) : pass('Header HTTP và JavaScript nhất quán');
  },
  BINF_04: ({ ua, engine, data }) => {
    const n = data.navigator ?? {};
    const f = data.engine?.features;
    if (ua.engine === 'unknown') return na('Không nhận diện được engine từ UA');
    if (ua.engine !== engine)
      return hit(`UA khai báo ${ua.browser} (${ua.engine}) nhưng JS engine thực tế là ${engine}`, { claimed: ua.engine, actual: engine, js_engine: data.engine?.jsEngine });
    const odd: string[] = [];
    if (engine !== 'blink') {
      if (n.hasUserAgentData) odd.push('navigator.userAgentData');
      if (n.hasDeviceMemory) odd.push('navigator.deviceMemory');
      if (n.hasChrome && ua.os !== 'iOS') odd.push('window.chrome');
    }
    if (odd.length) return hit(`Engine ${engine} không có ${odd.join(', ')} nhưng API vẫn tồn tại`, odd);
    let table: [string, number][] | null = null, claimed: number | null = null;
    if (engine === 'blink') { table = CHROME_FEATURES; claimed = ua.chromeMajor; }
    else if (engine === 'gecko') { table = FIREFOX_FEATURES; claimed = ua.firefoxMajor; }
    if (!table || !claimed || !f) return pass(`Engine ${engine} khớp UA`);
    const tooOld: string[] = [], tooNew: string[] = [];
    for (const [feat, min] of table) {
      if (f[feat] === undefined) continue;
      if (!f[feat] && claimed >= min + 1) tooOld.push(`${feat} (có từ v${min})`);
      if (f[feat] && claimed <= min - 2) tooNew.push(`${feat} (chỉ có từ v${min})`);
    }
    if (tooNew.length) return hit(`UA khai báo v${claimed} nhưng engine có tính năng của bản mới hơn`, { claimed, features: tooNew });
    if (tooOld.length) return hit(`UA khai báo v${claimed} nhưng engine thiếu tính năng lẽ ra phải có`, { claimed, missing: tooOld });
    return pass(`Engine ${engine} và bộ tính năng JS khớp v${claimed}`);
  },
  BINF_05: (ctx) => {
    const t = ctx.data.tamper;
    if (!t) return na('Thiếu dữ liệu tampering');
    const own: string[] = t.navigatorOwnProps ?? [];
    const r = hookedTargets(ctx, (n) => /^Navigator\./.test(n));
    const bad = r?.bad ?? [];
    if (own.length || bad.length) return hit(`${own.length ? `navigator có own property: ${own.join(', ')}` : ''}${own.length && bad.length ? '; ' : ''}${bad.length ? `${bad.length} getter Navigator bị ghi đè` : ''}`, { own_properties: own, hooked_getters: bad });
    return pass(`${r?.checked ?? 0} getter Navigator đều native, không có own property`);
  },
  BINF_06: ({ data }) => {
    const w = data.worker, n = data.navigator, l = data.locale;
    if (!w?.supported) return na('Không chạy được Web Worker', w?.error);
    const main = {
      userAgent: n?.userAgent, platform: n?.platform, hardwareConcurrency: n?.hardwareConcurrency,
      deviceMemory: n?.deviceMemory, languages: n?.languages, timeZone: l?.timeZone,
      uaBrands: data.uaData?.brands?.map((b: any) => `${b.brand}/${b.version}`), uaPlatform: data.uaData?.platform,
    };
    const diff = diffFields(main, w, Object.keys(main));
    return Object.keys(diff).length ? hit(`Worker khác window ở: ${Object.keys(diff).join(', ')}`, diff) : pass('Worker trả cùng giá trị navigator với window');
  },

  // ---------------- WEBGL ----------------
  WBGL_01: ({ ua, data }) => {
    const g = data.webgl;
    if (!g?.supported) return na('WebGL không khả dụng');
    const r = g.unmaskedRenderer || g.renderer || '';
    if (!r || /^(webkit webgl|generic renderer)$/i.test(r)) return na('Renderer bị ẩn');
    const reason = gpuOsReason(ua.os, r);
    return reason ? hit(reason, { declared_os: ua.os, renderer: r }) : pass(`${r} hợp với ${ua.os}`, r);
  },
  WBGL_02: ({ data }) => {
    const g = data.webgl, g2 = g?.webgl2, w = data.worker;
    if (!g?.supported) return na('WebGL không khả dụng');
    const issues: string[] = [];
    const r1 = g.unmaskedRenderer || g.renderer;
    if (g2?.supported) {
      const r2 = g2.unmaskedRenderer || g2.renderer;
      if (r1 && r2 && r1 !== r2) issues.push('renderer WebGL1 ≠ WebGL2');
      if (g2.maxTextureSize && g.maxTextureSize && g2.maxTextureSize !== g.maxTextureSize) issues.push('MAX_TEXTURE_SIZE khác nhau');
      if (g2.maxViewportDims && g.maxViewportDims && !same(g2.maxViewportDims, g.maxViewportDims)) issues.push('MAX_VIEWPORT_DIMS khác nhau');
    }
    if (w?.supported && w.webglRenderer && r1 && w.webglRenderer !== r1) issues.push('renderer Worker ≠ main');
    const obs = { webgl1: r1, webgl2: g2?.unmaskedRenderer ?? g2?.renderer, worker: w?.webglRenderer, max_texture: [g.maxTextureSize, g2?.maxTextureSize] };
    if (!g2?.supported && !w?.webglRenderer) return na('Không có WebGL2/Worker để đối chiếu');
    return issues.length ? hit(issues.join('; '), obs) : pass('WebGL1, WebGL2 và Worker nhất quán', obs);
  },
  WBGL_03: ({ data }) => {
    const g = data.webgl;
    if (!g?.supported) return na('WebGL không khả dụng');
    const r = String(g.unmaskedRenderer || '');
    if (!r) return na('Renderer bị ẩn');
    const extCount = Array.isArray(g.extensions) ? g.extensions.length : g.extensionCount;
    const discrete = /\b(rtx|gtx|rx\s?\d{3,4}|radeon pro|arc a\d)/i.test(r);
    const issues: string[] = [];
    if (discrete && g.maxTextureSize && g.maxTextureSize < 16384) issues.push(`GPU rời nhưng MAX_TEXTURE_SIZE = ${g.maxTextureSize}`);
    if (isD3D(r) && g.maxVertexUniformVectors && g.maxVertexUniformVectors !== 4096) issues.push(`ANGLE Direct3D nhưng MAX_VERTEX_UNIFORM_VECTORS = ${g.maxVertexUniformVectors} (giá trị của Metal/OpenGL)`);
    if (!SOFT_GPU.test(r) && typeof extCount === 'number' && extCount < 15) issues.push(`chỉ có ${extCount} extension`);
    const obs = { renderer: r, max_texture_size: g.maxTextureSize, max_vertex_uniform_vectors: g.maxVertexUniformVectors, extensions: extCount };
    return issues.length ? hit(issues.join('; '), obs) : pass('Tham số WebGL hợp với GPU khai báo', obs);
  },
  WBGL_04: (ctx) => {
    const g = ctx.data.webgl;
    if (!g?.supported) return na('WebGL không khả dụng');
    if (!g.renderHashB) return na('Không tạo được context thứ 2');
    const obs = { run_1: g.renderHashA, run_2: g.renderHashB };
    return g.renderHashA === g.renderHashB ? pass('readPixels tất định', obs) : privacyHit(ctx, 'Cùng cảnh WebGL render 2 lần cho 2 hash khác nhau', obs);
  },
  WBGL_05: ({ data }) => {
    const g = data.webgl;
    if (!g?.supported) return na('WebGL không khả dụng');
    const r = g.unmaskedRenderer || g.renderer || '';
    return SOFT_GPU.test(r) ? hit(`Renderer phần mềm/ảo hóa: ${r}`, r) : pass('GPU phần cứng');
  },
  WBGL_06: ({ data }) => {
    const g = data.webgl;
    if (!g) return na('Thiếu dữ liệu');
    if (!g.supported) return hit('WebGL bị tắt', g.error);
    if (!g.unmaskedRenderer || /^generic|^webkit webgl$/i.test(g.unmaskedRenderer)) return hit('WEBGL_debug_renderer_info bị ẩn hoặc chuẩn hóa', { renderer: g.renderer, unmasked: g.unmaskedRenderer });
    return pass('WEBGL_debug_renderer_info khả dụng');
  },

  WBGL_07: (ctx) => {
    const g = ctx.data.webgl;
    if (!g?.supported) return na('WebGL không khả dụng');
    const t = g.truth;
    if (!t) return na('Probe cũ, không có phép thử đáp án WebGL');
    if (t.error || !t.supported) return na('Không chạy được phép thử đáp án WebGL', t.error);
    const obs = { clear_bad_px: t.clear.bad, solid_bad_px: t.solid.bad, total_px: t.total, max_delta: Math.max(t.clear.maxDelta, t.solid.maxDelta), uint8_wrap_bytes: t.clear.wrap + t.solid.wrap };
    if (!t.clear.bad && !t.solid.bad) return pass('readPixels trả đúng màu đã vẽ', obs);
    const msg = `readPixels lệch đáp án: màu xoá sai ${t.clear.bad}/${t.total} px, shader màu đặc sai ${t.solid.bad}/${t.total} px`;
    // tràn số 0↔255 không phải hành vi của tính năng privacy nào: không hạ cấp
    if (obs.uint8_wrap_bytes > 0) return hit(`${msg}; ${obs.uint8_wrap_bytes} byte tràn số uint8 (0↔255) của bộ chèn noise`, obs, { confidence: 0.99 });
    return privacyHit(ctx, msg, obs);
  },

  WBGL_08: (ctx) => {
    const g = ctx.data.webgl;
    if (!g?.supported) return na('WebGL không khả dụng');
    const v = g.varying;
    if (!v) return na('Probe cũ, không có phép thử varying');
    if (v.error || !v.cases?.length) return na('Không chạy được phép thử varying', v.error);
    const obs = { off_px: v.off, total_px: v.of, cases: v.cases, shader_swapped_hint: v.cases.filter((x: any) => x.compilerInput === false).length };
    if (!v.off) return pass(`${v.of} pixel: varying nội suy khớp gl_FragCoord tuyệt đối`, obs);
    // lệch lẻ tẻ < 1%: có thể là độ chính xác nội suy của GPU lạ, chỉ cảnh báo
    if (v.off / v.of < 0.01) return hit(`${v.off}/${v.of} pixel varying ≠ gl_FragCoord (lệch ít, có thể do độ chính xác GPU)`, obs, { downgrade: true, confidence: 0.5 });
    return privacyHit(ctx, `${v.off}/${v.of} pixel (${((v.off / v.of) * 100).toFixed(1)}%) varying nội suy ≠ gl_FragCoord: gl_Position bị làm nhiễu`, obs);
  },
  WBGL_09: ({ data }) => {
    const g = data.webgl;
    if (!g?.supported) return na('WebGL không khả dụng');
    const u = g.uniformLimit;
    if (!u) return na('Probe cũ, không có phép thử giới hạn uniform');
    if (!u.supported || u.error) return na('Không chạy được phép thử giới hạn uniform', u.error);
    const r = String(g.unmaskedRenderer || '');
    if (!r.startsWith('ANGLE (')) return na('Chỉ ANGLE cưỡng chế đúng giới hạn uniform khi link', { renderer: r });
    const obs = { renderer: r, declared_vs: u.declaredVS, vs_links_declared: u.vsAtDeclared, vs_links_declared_plus_1: u.vsAbove, declared_fs: u.declaredFS, fs_links_declared: u.fsAtDeclared, fs_links_declared_plus_1: u.fsAbove };
    const bad: string[] = [];
    if (u.vsAbove === true) bad.push(`link được ${u.declaredVS + 1} vec4 uniform ở vertex shader dù MAX_VERTEX_UNIFORM_VECTORS = ${u.declaredVS}`);
    if (u.fsAbove === true) bad.push(`link được ${u.declaredFS + 1} vec4 uniform ở fragment shader dù MAX_FRAGMENT_UNIFORM_VECTORS = ${u.declaredFS}`);
    return bad.length ? hit(`Giới hạn uniform khai báo là giả: ${bad.join('; ')}`, obs) : pass('Giới hạn uniform khai báo khớp shader linker', obs);
  },
  WBGL_10: ({ data }) => {
    const w = data.webgpu;
    if (!w) return na('Probe cũ, không có dữ liệu WebGPU');
    if (!w.supported) return na('WebGPU không khả dụng', w.error);
    if (w.isFallback) return na('Adapter phần mềm (fallback)');
    const min = w.subgroupMinSize, max = w.subgroupMaxSize;
    if (typeof min !== 'number' || typeof max !== 'number' || !min) return na('Trình duyệt chưa báo subgroup size', w);
    const v = String(w.vendor).toLowerCase(), a = String(w.architecture).toLowerCase();
    const exp = v === 'nvidia' ? { min: 32, max: 32, fam: 'NVIDIA (warp 32)' }
      : v === 'amd' && /^rdna/.test(a) ? { min: 32, max: 64, fam: 'AMD RDNA (wave32/64)' }
      : v === 'amd' && /^gcn/.test(a) ? { min: 64, max: 64, fam: 'AMD GCN (wave64)' }
      : v === 'apple' ? { min: 32, max: 32, fam: 'Apple GPU (SIMD 32)' } : null;
    const obs = { vendor: w.vendor, architecture: w.architecture, subgroup: [min, max], webgl_renderer: data.webgl?.unmaskedRenderer };
    if (!exp) return pass(`Chưa có bảng subgroup cho ${w.vendor || '?'} ${w.architecture || ''}`.trim(), obs);
    if (min === exp.min && max === exp.max) return pass(`Subgroup ${min}/${max} khớp ${exp.fam}`, obs);
    const real = min === 64 && max === 64 ? 'AMD GCN' : min === 32 && max === 32 ? 'NVIDIA/Apple' : min === 32 && max === 64 ? 'AMD RDNA' : min <= 16 ? 'Intel/ARM' : 'khác';
    return hit(`WebGPU khai ${w.vendor} ${w.architecture} (phải là subgroup ${exp.min}/${exp.max}) nhưng phần cứng báo ${min}/${max}, của ${real}`, obs);
  },

  // ---------------- HARDWARE ----------------
  HRDW_01: ({ engine, data }) => {
    const v = data.navigator?.deviceMemory;
    if (v == null) return na('deviceMemory không có (xem HRDW_05)');
    if (engine !== 'blink') return na('Không phải Chromium (xem BINF_04)');
    if ([0.25, 0.5, 1, 2, 4, 8, 16, 32].includes(v)) return pass(`deviceMemory = ${v} GB`, v);
    return hit(`deviceMemory = ${v} không phải giá trị Chromium có thể trả về`, v);
  },
  HRDW_02: ({ data }) => {
    const v = data.navigator?.hardwareConcurrency;
    if (v == null) return na('Không có hardwareConcurrency');
    if (!Number.isInteger(v) || v < 1 || v > 128) return hit(`hardwareConcurrency = ${v} không hợp lệ`, v);
    const r = String(data.webgl?.unmaskedRenderer || '');
    if (/apple m\d/i.test(r) && (v < 8 || v > 32 || (v % 2 === 1 && v !== 11)))
      return hit(`GPU ${r} (Apple Silicon) nhưng hardwareConcurrency = ${v}`, { hardwareConcurrency: v, renderer: r });
    return pass(`${v} luồng CPU`, v);
  },
  HRDW_03: ({ data }) => {
    const s = data.screen;
    if (!s) return na('Không có dữ liệu màn hình');
    const issues: string[] = [];
    if (!(s.width > 0 && s.height > 0)) issues.push('kích thước màn hình ≤ 0');
    if (s.availWidth > s.width || s.availHeight > s.height) issues.push('availWidth/availHeight lớn hơn màn hình');
    if (s.outerWidth > 0 && s.width > 0 && s.outerWidth > s.width * 2 + 50) issues.push(`outerWidth ${s.outerWidth} lớn hơn nhiều so với màn hình ${s.width}`);
    if (!(s.dpr > 0)) issues.push('devicePixelRatio không hợp lệ');
    if (![16, 24, 30, 32, 48].includes(s.colorDepth)) issues.push(`colorDepth = ${s.colorDepth}`);
    const obs = { screen: `${s.width}×${s.height}`, avail: `${s.availWidth}×${s.availHeight}`, outer: `${s.outerWidth}×${s.outerHeight}`, dpr: s.dpr, colorDepth: s.colorDepth };
    return issues.length ? hit(issues.join('; '), obs) : pass(`${s.width}×${s.height} @${s.dpr}x`, obs);
  },
  HRDW_04: ({ ua, engine, data }) => {
    const s = data.screen;
    if (!s) return na('Không có dữ liệu màn hình');
    const tp = s.touch?.maxTouchPoints ?? 0;
    const obs = { declared_os: ua.os, mobile: ua.mobile, maxTouchPoints: tp, ontouchstart: s.touch?.ontouchstart };
    if ((ua.os === 'Android' || ua.os === 'iOS') && tp === 0 && !s.touch?.ontouchstart) return hit(`UA ${ua.os} nhưng không có cảm ứng: desktop giả mobile`, obs);
    if (ua.os === 'macOS' && engine === 'blink' && tp >= 5) return hit(`macOS desktop (Chromium) nhưng maxTouchPoints = ${tp}`, obs);
    return pass(`maxTouchPoints = ${tp}`, obs);
  },
  HRDW_05: ({ engine, data }) => {
    const n = data.navigator;
    if (!n) return na('Thiếu dữ liệu');
    if (n.deviceMemory == null) return hit(engine === 'blink' ? 'deviceMemory bị khóa (không phải secure context hoặc chế độ privacy)' : `deviceMemory không có trên ${engine}`);
    return pass('deviceMemory khả dụng');
  },

  // ---------------- LOCALE ----------------
  LOCL_01: ({ data }) => {
    const l = data.locale;
    if (!l?.samples?.length) return na('Không có dữ liệu thời gian');
    const bad = l.samples.filter((s: any) => (s.intl !== null && s.intl !== s.date) || (s.toString !== null && s.toString !== s.date));
    const off = l.samples[0].date;
    return bad.length ? hit(`Timezone "${l.timeZone}" không khớp getTimezoneOffset/Date.toString`, bad)
      : pass(`${l.timeZone} (UTC${off >= 0 ? '+' : ''}${off / 60})`, { timeZone: l.timeZone, offset_min: off });
  },
  LOCL_02: ({ data, http }) => {
    const h = http.headers['accept-language'];
    const langs: string[] = data.navigator?.languages ?? [];
    if (!h || !langs.length) return na('Thiếu Accept-Language hoặc navigator.languages');
    const first = h.split(',')[0].split(';')[0].trim();
    const obs = { accept_language: h, navigator_languages: langs };
    return baseLang(first) === baseLang(langs[0]) ? pass(`Ngôn ngữ chính: ${langs[0]}`, obs) : hit(`Accept-Language (${first}) khác navigator.languages[0] (${langs[0]})`, obs);
  },
  LOCL_03: ({ data }) => {
    const l = data.locale;
    if (!l?.intlLocale) return na('Thiếu dữ liệu Intl');
    const issues: string[] = [];
    if (l.numberLocale && baseLang(l.numberLocale) !== baseLang(l.intlLocale)) issues.push(`NumberFormat "${l.numberLocale}" ≠ DateTimeFormat "${l.intlLocale}"`);
    const langs = [l.language, ...(l.languages ?? [])].filter(Boolean).map(baseLang);
    if (langs.length && !langs.includes(baseLang(l.intlLocale))) issues.push(`Intl locale "${l.intlLocale}" không có trong ngôn ngữ trình duyệt (${langs.join(', ')})`);
    const obs = { intl_datetime: l.intlLocale, intl_number: l.numberLocale, language: l.language, languages: l.languages };
    return issues.length ? hit(issues.join('; '), obs) : pass(`Intl locale ${l.intlLocale}`, obs);
  },
  LOCL_04: ({ data, net }) => {
    const tz = data.locale?.timeZone;
    if (!net.ipTimezone) return na('Chưa có GeoIP timezone (cần MaxMind/IPinfo ở edge)');
    if (!tz) return na('Thiếu timezone trình duyệt');
    const a = tzOffset(tz), b = tzOffset(net.ipTimezone);
    const obs = { browser_tz: tz, ip_tz: net.ipTimezone, browser_offset: a, ip_offset: b };
    return a !== null && a === b ? pass('Timezone khớp vị trí IP', obs) : hit(`Timezone ${tz} khác vị trí IP (${net.ipTimezone})`, obs);
  },
  LOCL_05: ({ data, serverNow }) => {
    const t = data.clientTime;
    if (typeof t !== 'number') return na('Payload không có clientTime');
    const skew = Math.round((t - serverNow) / 1000);
    const obs = { skew_seconds: skew };
    return Math.abs(skew) > 300 ? hit(`Đồng hồ lệch ${skew} giây so với server`, obs) : pass(`Lệch ${skew} giây`, obs);
  },

  // ---------------- AUDIO ----------------
  AUDI_01: (ctx) => {
    const a = ctx.data.audio;
    if (!a?.supported || a.allZero) return na('Audio không khả dụng (xem AUDI_04)');
    if (a.sumA == null || a.sumB == null) return na('Render audio timeout');
    const obs = { run_1: a.sumA, run_2: a.sumB };
    return a.sumA === a.sumB ? pass('2 lần render cho cùng tổng biên độ', obs) : privacyHit(ctx, '2 lần render giống hệt cho tổng biên độ khác nhau', obs);
  },
  AUDI_02: (ctx) => {
    const a = ctx.data.audio;
    if (!a?.supported || a.allZero) return na('Audio không khả dụng');
    if (a.channelCopyDiff == null && a.copyDiff == null) return na('Thiếu dữ liệu so sánh');
    const obs = { getChannelData_vs_copyFromChannel: a.channelCopyDiff, write_read_diff: a.copyDiff };
    return (a.channelCopyDiff ?? 0) > 0 || (a.copyDiff ?? 0) > 0
      ? privacyHit(ctx, `Dữ liệu AudioBuffer không nhất quán (${a.channelCopyDiff ?? 0} mẫu khác getChannelData/copyFromChannel, ${a.copyDiff ?? 0} mẫu ghi-đọc sai)`, obs)
      : pass('getChannelData và copyFromChannel giống hệt', obs);
  },
  AUDI_03: ({ ua, engine, data }) => {
    const a = data.audio;
    if (!a?.supported || a.sumA == null || a.allZero) return na('Audio không khả dụng');
    const fam = audioFamily(a.sumA);
    const obs = { sample_sum: a.sumA, family: fam, engine, declared_os: ua.os };
    if (fam === 'unknown') return pass('Không thuộc họ baseline đã biết (chưa đủ dữ liệu để kết luận)', obs);
    if (fam !== engine) return hit(`Giá trị audio thuộc engine ${fam} nhưng engine thực tế là ${engine}`, obs);
    if ((ua.os === 'macOS' || ua.os === 'iOS') && AUDIO_WINDOWS_CHROMIUM.includes(a.sumA)) return hit(`Khai báo ${ua.os} nhưng trùng hằng số Chromium trên Windows`, obs);
    return pass(`Thuộc họ ${fam}`, obs);
  },
  AUDI_04: ({ data }) => {
    const a = data.audio;
    if (!a) return na('Thiếu dữ liệu');
    if (!a.supported) return hit('OfflineAudioContext không khả dụng hoặc ném lỗi', a.error);
    if (a.allZero) return hit('AudioBuffer toàn số 0: bị tắt tiếng bởi privacy shield');
    return pass('OfflineAudioContext hoạt động');
  },

  AUDI_05: (ctx) => {
    const a = ctx.data.audio;
    if (!a?.supported || a.allZero) return na('Audio không khả dụng');
    const v = a.invariants;
    if (!v) return na('Probe cũ, không có phép bất biến audio');
    if (v.error) return na('Không chạy được phép bất biến audio', v.error);
    const checks: [string, string][] = [
      ['periodicSine', 'oscillator sine f = fs/64 không tuần hoàn'], ['periodicTriangle', 'oscillator triangle f = fs/64 không tuần hoàn'],
      ['gainHalf', 'osc→gain(0.5) ≠ 0.5 × osc'], ['twoOscSum', '2 oscillator ≠ 2 × osc'], ['prefix', 'render dài gấp đôi khác phần đầu'],
      ['analyser', 'AnalyserNode ≠ buffer đầu ra'], ['workletIn', 'AudioWorklet ≠ oscillator'], ['workletOut', 'buffer đầu ra ≠ AudioWorklet'],
    ];
    const obs: Record<string, unknown> = { samples: v.samples };
    const bad: string[] = [];
    let ran = 0;
    for (const [k, label] of checks) {
      if (typeof v[k] !== 'number') continue;
      ran++;
      obs[k] = v[k];
      if (v[k] > 0) bad.push(`${label} (${v[k]} mẫu)`);
    }
    // Tính chất wavetable (phản đối xứng, đỉnh = 1.0) mới kiểm chứng trên Chromium Windows: chỉ dùng khi khai báo Windows + Blink
    const waveRun = ctx.engine === 'blink' && ctx.ua.os === 'Windows';
    if (waveRun) {
      for (const [k, label] of [['waveAntiSine', 'wavetable sine mất phản đối xứng'], ['waveAntiTriangle', 'wavetable triangle mất phản đối xứng'], ['waveAntiSquare', 'wavetable square mất phản đối xứng']] as const) {
        if (typeof v[k] !== 'number') continue;
        ran++;
        obs[k] = v[k];
        if (v[k] > 0) bad.push(`${label} (${v[k]}/64 mẫu)`);
      }
      if (typeof v.wavePeak === 'number') {
        ran++;
        obs.wavePeak = v.wavePeak;
        if (v.wavePeak !== 1) bad.push(`đỉnh wavetable sine = ${v.wavePeak} (đúng phải là 1)`);
      }
    }
    if (!ran) return na('Không phép bất biến nào chạy xong', v);
    return bad.length ? privacyHit(ctx, `Audio bị chèn noise: ${bad.join('; ')}`, obs) : pass(`${ran} phép bất biến audio đều đúng`, obs);
  },

  AUDI_06: (ctx) => {
    const a = ctx.data.audio;
    if (!a?.supported || a.sumA == null || a.allZero) return na('Audio không khả dụng');
    if (ctx.engine !== 'blink' || ctx.ua.os !== 'Windows') return na('Baseline compressor mới có cho Chromium Windows');
    const s = a.sumA;
    if (s < 124 || s > 124.1) return na('Ngoài cụm giá trị Chromium (xem AUDI_03)', { sample_sum: s });
    const nearest = Math.min(...AUDIO_WINDOWS_CHROMIUM.map((v) => Math.abs(s - v)));
    const obs = { sample_sum: s, nearest_baseline_delta: nearest, baseline: AUDIO_WINDOWS_CHROMIUM };
    if (nearest === 0) return pass('Trùng giá trị Chromium Windows đã biết', obs);
    if (nearest < 5e-4) return pass(`Lệch baseline ${nearest.toExponential(2)}, trong biên dao động giữa CPU/build`, obs);
    return privacyHit(ctx, `Tổng biên độ ${s} lệch ${nearest.toExponential(2)} khỏi mọi giá trị Chromium Windows thật (dao động thật < 2e-4): DynamicsCompressor bị làm nhiễu`, obs);
  },

  // ---------------- FONTS ----------------
  FONT_01: ({ ua, data }) => {
    const f = data.fonts?.found;
    if (!f) return na('Không đo được font');
    const w = f.windows.length, m = f.mac.length, l = f.linux.length;
    const obs = f;
    if (ua.os === 'Windows' && w === 0 && (m >= 2 || l >= 2)) return hit(`UA Windows nhưng không có font Windows, lại có font ${m >= 2 ? 'macOS' : 'Linux'}`, obs);
    if (ua.os === 'macOS' && m === 0 && (w >= 2 || l >= 2)) return hit(`UA macOS nhưng không có font macOS, lại có font ${w >= 2 ? 'Windows' : 'Linux'}`, obs);
    if (ua.os === 'Linux' && l === 0 && w >= 3) return hit('UA Linux nhưng bộ font giống Windows', obs, { confidence: 0.7 });
    return pass(`Windows ${w} · macOS ${m} · Linux ${l}`, obs);
  },
  FONT_02: ({ data }) => {
    const f = data.fonts;
    if (!f?.found || !f.foundDom) return na('Không đo được font bằng 2 phương pháp');
    const all = (o: any) => new Set<string>([...o.windows, ...o.mac, ...o.linux]);
    const a = all(f.found), b = all(f.foundDom);
    const onlyCanvas = [...a].filter((x) => !b.has(x)), onlyDom = [...b].filter((x) => !a.has(x));
    const obs = { only_canvas: onlyCanvas, only_dom: onlyDom, fonts_check_api: f.checkApi };
    return onlyCanvas.length || onlyDom.length ? hit('Canvas và DOM cho danh sách font khác nhau', obs) : pass('Canvas và DOM thống nhất về font', obs);
  },
  FONT_03: (ctx) => {
    const m = ctx.data.fonts?.metrics;
    if (!m) return na('Không có dữ liệu đo lặp');
    const diffs: string[] = [];
    if (m.dom && m.dom[0] !== m.dom[1]) diffs.push(`DOMRect ${m.dom[0]} ≠ ${m.dom[1]}`);
    if (m.canvas && m.canvas[0] !== m.canvas[1]) diffs.push(`measureText ${m.canvas[0]} ≠ ${m.canvas[1]}`);
    return diffs.length ? privacyHit(ctx, `Số đo văn bản thay đổi giữa 2 lần: ${diffs.join('; ')}`, m) : pass('Số đo văn bản ổn định', m);
  },
  FONT_04: ({ ua, data }) => {
    const e: string[] | undefined = data.fonts?.emoji;
    if (!e) return na('Không đo được font emoji');
    const has = (n: string) => e.includes(n);
    const obs = { emoji_fonts: e, declared_os: ua.os };
    if (ua.os === 'Windows' && !has('Segoe UI Emoji') && (has('Apple Color Emoji') || has('Noto Color Emoji'))) return hit(`Windows nhưng font emoji là ${e.join(', ')}`, obs);
    if ((ua.os === 'macOS' || ua.os === 'iOS') && !has('Apple Color Emoji') && e.length) return hit(`${ua.os} nhưng không có Apple Color Emoji`, obs);
    if ((ua.os === 'Linux' || ua.os === 'Android') && has('Apple Color Emoji') && !has('Noto Color Emoji')) return hit(`${ua.os} nhưng có Apple Color Emoji`, obs);
    return pass(e.length ? `Font emoji: ${e.join(', ')}` : 'Không phát hiện font emoji riêng', obs);
  },

  FONT_05: (ctx) => {
    const r = ctx.data.rects;
    if (!r?.supported) return na('Probe cũ, không có phép thử ClientRects');
    const obs = { values_checked: r.checked, off_values: r.off, max_delta: r.maxDelta, by_property: r.byProp, samples: r.samples, dpr: r.dpr, pinch_zoom: r.vvScale };
    // DPR không phải bội số 0.25 (zoom 110%, 90%...) hoặc đang pinch-zoom: toạ độ CSS có thể lệch hợp lệ
    if (Math.abs(r.dpr * 4 - Math.round(r.dpr * 4)) > 1e-9 || r.vvScale !== 1) return na(`DPR ${r.dpr}, pinch-zoom ${r.vvScale}: không so được với lưới LayoutUnit`, obs);
    if (!r.off) return pass(`${r.checked} giá trị getBoundingClientRect đúng tuyệt đối`, obs);
    // lệch lớn hơn 1 px là layout khác (font, CSS bị ghi đè), không phải noise
    if (r.maxDelta > 1) return na(`Giá trị lệch tới ${r.maxDelta}px: layout bị can thiệp khác, không kết luận`, obs);
    return privacyHit(ctx, `${r.off}/${r.checked} giá trị getBoundingClientRect lệch tối đa ${+r.maxDelta.toFixed(6)}px khỏi giá trị CSS`, obs);
  },

  // ---------------- AUTOMATION ----------------
  AUTO_01: ({ ua, engine, data }) => {
    const n = data.navigator ?? {}, a = data.automation ?? {};
    const signs: string[] = [];
    if (n.webdriver === true || data.iframe?.webdriver === true) signs.push('navigator.webdriver = true');
    if (engine === 'blink' && (ua.chromeMajor ?? 0) >= 89 && n.webdriverInNavigator === false) signs.push('thuộc tính webdriver bị xóa khỏi Navigator');
    const g: string[] = a.suspiciousGlobals ?? [];
    if (g.length) signs.push(`biến toàn cục: ${g.slice(0, 5).join(', ')}`);
    return signs.length ? hit(signs.join('; '), { webdriver: n.webdriver, globals: g }) : pass(`webdriver = ${n.webdriver}`);
  },
  AUTO_02: (ctx) => {
    const t = ctx.data.tamper;
    if (!t) return na('Thiếu dữ liệu tampering');
    const r = hookedTargets(ctx, () => true)!;
    const signs: string[] = [];
    if (t.toStringNative === false) signs.push('Function.prototype.toString bị thay');
    if (t.toStringProxy) signs.push('Function.prototype.toString bị bọc Proxy');
    if (r.bad.length) signs.push(`${r.bad.length}/${r.checked} API bị ghi đè`);
    return signs.length ? hit(signs.join('; '), { hooked: r.bad, toString_native: t.toStringNative }) : pass(`${r.checked} API native, toString nguyên bản`);
  },
  AUTO_03: ({ data }) => {
    const f = data.iframe, n = data.navigator, s = data.screen, t = data.tamper;
    if (!f || f.error) return na('Không đọc được iframe');
    const main = {
      userAgent: n?.userAgent, platform: n?.platform, hardwareConcurrency: n?.hardwareConcurrency,
      deviceMemory: n?.deviceMemory, languages: n?.languages, webdriver: n?.webdriver,
      screenWidth: s?.width, screenHeight: s?.height, timeZone: data.locale?.timeZone,
    };
    const diff = diffFields(main, f, Object.keys(main));
    const crossLeaks = (t?.targets ?? []).filter((x: any) => x.nativeCross === false).map((x: any) => x.name);
    if (t?.toStringCross === false) crossLeaks.unshift('Function.prototype.toString');
    const issues: string[] = [];
    if (Object.keys(diff).length) issues.push(`iframe khác window ở: ${Object.keys(diff).join(', ')}`);
    if (crossLeaks.length) issues.push(`toString của realm iframe lộ mã JS: ${crossLeaks.slice(0, 4).join(', ')}${crossLeaks.length > 4 ? '…' : ''}`);
    return issues.length ? hit(issues.join('; '), { diff, cross_realm_leaks: crossLeaks }) : pass('iframe sạch nhất quán với window');
  },
  AUTO_04: ({ data }) => {
    const a = data.automation;
    if (!a || a.cdpLeak == null) return na('Không chạy được phép thử CDP');
    return a.cdpLeak ? hit('Đối tượng Error bị tuần tự hóa qua console: CDP Runtime đang bật (automation hoặc DevTools đang mở)') : pass('Không phát hiện CDP');
  },
  AUTO_05: ({ ua, engine, data, http }) => {
    const n = data.navigator ?? {}, a = data.automation ?? {};
    const strong: string[] = [], weak: string[] = [];
    if (/HeadlessChrome/.test(http.headers['user-agent'] ?? '') || a.headlessUA || /HeadlessChrome/.test(data.worker?.userAgent ?? '')) strong.push('User-Agent chứa HeadlessChrome');
    if (engine === 'blink' && !ua.mobile) {
      if (n.pluginsLength === 0 && n.pdfViewerEnabled !== false) strong.push('navigator.plugins rỗng');
      if (!n.hasChrome) weak.push('thiếu window.chrome');
      if (a.outerZero) weak.push('outerWidth/outerHeight = 0');
    }
    if (a.notification?.permission === 'denied' && a.notification?.query === 'prompt') strong.push('Notification.permission = denied nhưng permissions.query = prompt');
    const signs = [...strong, ...weak];
    if (!signs.length) return pass('Không có đặc điểm headless');
    // Một dấu hiệu yếu đơn lẻ (vd webview nhúng có outerWidth = 0) chỉ tính độ tin cậy thấp
    if (!strong.length && weak.length === 1) return hit(signs.join('; '), signs, { downgrade: true, confidence: 0.4 });
    return hit(signs.join('; '), signs);
  },

  // ---------------- NETWORK ----------------
  NETW_01: ({ ua, net }) => {
    if (!net.ja4 && !net.tlsClient) return na('Edge chưa chuyển JA4/JA3 (cấu hình TLS_HEADER)');
    const t = tlsFamily(net), u = uaFamily(ua);
    const obs = { ja4: net.ja4, ja3: net.ja3, tls_family: t.family, basis: t.basis, ua_family: u };
    if (t.family === 'unknown' || u === 'unknown') return pass(`Không phân loại được (${t.basis})`, obs);
    return t.family === u ? pass(`TLS khớp ${u}`, obs) : hit(`TLS ClientHello thuộc ${t.family} nhưng UA khai báo ${ua.browser}`, obs);
  },
  NETW_02: ({ ua, net }) => {
    if (!net.h2) return na(net.httpVersion && net.httpVersion !== '2' ? `Kết nối HTTP/${net.httpVersion}, không có HTTP/2 fingerprint` : 'Edge chưa chuyển HTTP/2 fingerprint');
    const order = net.h2.split('|').pop()?.trim() ?? '';
    const exp = H2_ORDER[uaFamily(ua)];
    const obs = { h2_fingerprint: net.h2, pseudo_header_order: order, expected: exp };
    if (!exp) return pass('Không có baseline cho trình duyệt này', obs);
    return order === exp ? pass(`Thứ tự pseudo-header ${order}`, obs) : hit(`Thứ tự pseudo-header ${order}, ${ua.browser} phải là ${exp}`, obs);
  },
  NETW_03: ({ ua, net }) => {
    if (!net.tcpOs) return na('Edge chưa có TCP/IP fingerprint (p0f)');
    const norm = (s: string) => s.toLowerCase().replace(/mac ?os( x)?/, 'macos');
    const tcp = norm(net.tcpOs), os = norm(ua.os);
    const ok = tcp.includes(os) || (os === 'android' && tcp.includes('linux')) || (os === 'ios' && tcp.includes('macos')) || (os === 'chromeos' && tcp.includes('linux'));
    const obs = { tcp_os: net.tcpOs, declared_os: ua.os };
    return ok ? pass(`TCP stack: ${net.tcpOs}`, obs) : hit(`TCP stack là ${net.tcpOs} nhưng UA khai báo ${ua.os}`, obs);
  },
  NETW_04: ({ net }) => {
    if (!net.asnType) return na('Chưa có dữ liệu ASN (cần MaxMind/IPinfo ở edge)');
    const obs = { asn: net.asn, org: net.asnOrg, type: net.asnType };
    return /hosting|datacenter|cloud/.test(net.asnType) ? hit(`IP thuộc hosting/cloud: ${net.asnOrg ?? net.asn}`, obs) : pass(`ASN ${net.asnType}: ${net.asnOrg ?? net.asn}`, obs);
  },
  NETW_05: ({ net }) => {
    if (!net.ipFlags) return na('Chưa có dữ liệu IP reputation');
    const bad = net.ipFlags.filter((f) => /tor|open.?proxy|abuse|botnet/.test(f));
    return bad.length ? hit(`IP bị gắn cờ: ${bad.join(', ')}`, net.ipFlags) : pass('IP không có trong danh sách xấu', net.ipFlags);
  },
};
