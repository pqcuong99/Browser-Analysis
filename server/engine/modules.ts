import { hookReasons, isPrivateIp, type Ctx } from './rules.ts';
import type { ModuleDiagnosticReport, ModuleId } from './types.ts';

type Metric = { label: string; value: string; is_anomalous?: boolean };
const s = (v: unknown, max = 60) => {
  const t = v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};
const yes = (b: boolean | null | undefined, ok = 'match', bad = 'MISMATCH') => (b == null ? '—' : b ? ok : bad);

export interface ModuleView {
  metrics(ctx: Ctx): Metric[];
  observed(ctx: Ctx): Record<string, unknown>;
  stability?(ctx: Ctx): ModuleDiagnosticReport['stability_check'] | undefined;
}

/** Phân loại hành vi WebRTC để so các Antidetect với nhau (cùng proxy nhưng mỗi bên xử lý WebRTC một kiểu) */
function webrtcMode(w: any): string {
  if (!w) return '—';
  if (!w.supported) return 'Tắt hẳn (không có RTCPeerConnection)';
  const c: any[] = w.candidates ?? [];
  if (!c.length) return w.state === 'timeout' ? 'Treo: 0 candidate, gather không kết thúc' : 'Chặn UDP không qua proxy (0 candidate)';
  const host = c.filter((x) => x.type === 'host');
  const rawHost = host.some((x) => !String(x.address).endsWith('.local'));
  const srflx = c.some((x) => x.type === 'srflx'), relay = c.some((x) => x.type === 'relay');
  if (rawHost) return srflx ? 'Lộ IP local thô + srflx' : 'Lộ IP local thô, không có srflx';
  if (srflx && !host.length) return 'Chỉ interface công khai (ẩn host, có srflx)';
  if (srflx) return 'Mặc định: host mDNS + srflx';
  if (relay) return 'Chỉ relay (TURN)';
  return 'Chỉ host mDNS (STUN không tới được)';
}

/** IP nguồn UDP thật mà VPS thấy, so với srflx JS báo */
function groundMetric(g: NonNullable<Ctx['net']['ground']>, srflx: string[]): Metric {
  if (g.error) return { label: 'UDP thật (VPS)', value: s(`lỗi: ${g.error}`) };
  const udp = [...new Set((g.sources ?? []).filter((x) => x.proto === 'udp').map((x) => String(x.ip).replace(/^::ffff:/, '')))];
  const tcp = [...new Set((g.sources ?? []).filter((x) => x.proto === 'tcp').map((x) => String(x.ip).replace(/^::ffff:/, '')))];
  const value = udp.length ? udp.join(', ') : tcp.length ? `chỉ TCP: ${tcp.join(', ')}` : 'không nhận được gói';
  return { label: 'UDP thật (VPS)', value: s(value), is_anomalous: udp.length > 0 && srflx.length > 0 && udp.some((ip) => !srflx.includes(ip)) };
}

const hashTuple = (o: any) => {
  if (!o) return '—';
  const str = JSON.stringify([o.userAgent, o.platform, o.hardwareConcurrency, o.deviceMemory, o.languages, o.timeZone]);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export const MODULE_VIEWS: Record<ModuleId, ModuleView> = {
  canvas: {
    metrics: ({ data }) => {
      const c = data.canvas ?? {}, w = data.worker ?? {};
      return [
        { label: 'Render hash', value: s(c.fixedHash ?? c.hashA) },
        { label: 'Run 1 = Run 2', value: c.supported ? yes(c.hashA === c.hashB && c.hashReread === c.hashRereadB) : '—', is_anomalous: c.supported && c.hashA !== c.hashB },
        { label: 'Main ↔ Worker', value: w.canvas2d ? yes(w.canvas2d === c.geoHash) : 'n/a', is_anomalous: !!w.canvas2d && w.canvas2d !== c.geoHash },
        { label: 'getImageData ↔ toDataURL', value: typeof c.decodedDiffPixels === 'number' ? (c.decodedDiffPixels ? `${c.decodedDiffPixels} px diff` : 'identical') : '—', is_anomalous: c.decodedDiffPixels > 0 },
      ];
    },
    observed: ({ data }) => ({ ...data.canvas, worker_canvas2d: data.worker?.canvas2d }),
    stability: ({ data }) => {
      const c = data.canvas;
      if (!c?.supported) return undefined;
      return {
        run_1_hash: s(c.hashA), run_2_hash: s(c.hashB), main_context_hash: s(c.geoHash),
        worker_or_iframe_hash: data.worker?.canvas2d ? s(data.worker.canvas2d) : undefined,
        is_deterministic: c.hashA === c.hashB && (!data.worker?.canvas2d || data.worker.canvas2d === c.geoHash),
        note: 'Run 1/2: cảnh đầy đủ (text + emoji + gradient). Main/Worker: cảnh hình học không phụ thuộc font.',
      };
    },
  },
  webrtc: {
    metrics: ({ data, http, net }) => {
      const w = data.webrtc ?? {};
      const c = w.candidates ?? [];
      const srflx = [...new Set(c.filter((x: any) => x.type === 'srflx').map((x: any) => x.address))] as string[];
      const httpIp = http.ip.replace(/^::ffff:/, '');
      const egress: string[] = isPrivateIp(httpIp) ? (data.egress?.ips ?? []) : [httpIp];
      const leak = srflx.length && egress.length ? srflx.some((a) => !egress.includes(a)) : null;
      return [
        { label: 'Chế độ', value: webrtcMode(w) },
        { label: 'srflx IP', value: s(srflx.join(', ') || (w.supported ? 'none' : 'disabled')), is_anomalous: !!leak },
        { label: isPrivateIp(httpIp) ? 'Egress IP (qua proxy)' : 'HTTP IP', value: s(egress.join(', ') || `${httpIp} (nội bộ, không có egress)`) },
        { label: 'Candidates', value: `${c.length} (${c.filter((x: any) => String(x.address).endsWith('.local')).length} mDNS) · ${w.state ?? '—'}${w.ms != null ? ` ${w.ms} ms` : ''}` },
        ...(net.ground ? [groundMetric(net.ground, srflx)] : []),
      ];
    },
    observed: ({ data, net, http }) => {
      const { candidates, sdpCandidates, iframe, ...rest } = data.webrtc ?? {};
      return {
        mode: webrtcMode(data.webrtc),
        ...rest,
        egress: isPrivateIp(http.ip.replace(/^::ffff:/, '')) ? data.egress : { source: 'IP kết nối HTTP', ip: http.ip },
        candidates: (candidates ?? []).map(({ fields, ...c }: any) => c),
        sdp_candidates: sdpCandidates,
        iframe_realm: iframe,
        webrtc_ip_intel: net.webrtcIp,
      };
    },
  },
  browser_info: {
    metrics: ({ ua, data }) => {
      const d = data.uaData ?? {};
      const w = data.worker ?? {};
      return [
        { label: 'Declared', value: `${ua.browser} ${ua.version ?? ''} / ${ua.os}` },
        { label: 'Client Hints', value: d.supported ? s((d.brands ?? []).filter((b: any) => !/not.?a.?brand/i.test(b.brand)).map((b: any) => `${b.brand} ${b.version}`).join(', ')) : 'n/a' },
        { label: 'Platform', value: s(data.navigator?.platform) },
        { label: 'Worker UA', value: w.supported ? yes(w.userAgent === data.navigator?.userAgent) : 'n/a', is_anomalous: w.supported && w.userAgent !== data.navigator?.userAgent },
      ];
    },
    observed: ({ data, http }) => ({
      navigator: data.navigator, userAgentData: data.uaData, engine: data.engine, worker_navigator: data.worker,
      http_headers: {
        'user-agent': http.headers['user-agent'], 'sec-ch-ua': http.headers['sec-ch-ua'],
        'sec-ch-ua-platform': http.headers['sec-ch-ua-platform'], 'sec-ch-ua-mobile': http.headers['sec-ch-ua-mobile'],
      },
    }),
    stability: ({ data }) => {
      const main = { ...data.navigator, timeZone: data.locale?.timeZone };
      const hm = hashTuple(main), hi = data.iframe ? hashTuple(data.iframe) : undefined, hw = data.worker?.supported ? hashTuple(data.worker) : undefined;
      return {
        run_1_hash: hm, run_2_hash: hi ?? '—', worker_or_iframe_hash: hw,
        is_deterministic: (!hi || hi === hm) && (!hw || hw === hm),
        note: 'Hash của (userAgent, platform, hardwareConcurrency, deviceMemory, languages, timeZone): window · iframe · Worker.',
      };
    },
  },
  webgl: {
    metrics: ({ data }) => {
      const g = data.webgl ?? {};
      return [
        { label: 'Renderer', value: s(g.unmaskedRenderer || g.renderer, 48) },
        { label: 'Vendor', value: s(g.unmaskedVendor || g.vendor) },
        { label: 'readPixels stable', value: g.renderHashB ? yes(g.renderHashA === g.renderHashB, 'yes', 'NO') : '—', is_anomalous: !!g.renderHashB && g.renderHashA !== g.renderHashB },
        { label: 'WebGL2 renderer', value: g.webgl2?.supported ? yes((g.webgl2.unmaskedRenderer || g.webgl2.renderer) === (g.unmaskedRenderer || g.renderer)) : 'n/a' },
      ];
    },
    observed: ({ data }) => ({ ...data.webgl, worker_webgl_renderer: data.worker?.webglRenderer }),
    stability: ({ data }) => {
      const g = data.webgl;
      if (!g?.supported) return undefined;
      return {
        run_1_hash: s(g.renderHashA), run_2_hash: s(g.renderHashB),
        main_context_hash: s(g.unmaskedRenderer || g.renderer, 80),
        worker_or_iframe_hash: data.worker?.webglRenderer ? s(data.worker.webglRenderer, 80) : undefined,
        is_deterministic: g.renderHashA === g.renderHashB && (!data.worker?.webglRenderer || data.worker.webglRenderer === (g.unmaskedRenderer || g.renderer)),
        note: 'Run 1/2: hash readPixels của cùng cảnh 3D. Main/Worker: chuỗi UNMASKED_RENDERER.',
      };
    },
  },
  hardware: {
    metrics: ({ data }) => {
      const n = data.navigator ?? {}, sc = data.screen ?? {};
      return [
        { label: 'CPU threads', value: s(n.hardwareConcurrency) },
        { label: 'deviceMemory', value: n.deviceMemory == null ? 'n/a' : `${n.deviceMemory} GB` },
        { label: 'Screen', value: `${sc.width}×${sc.height} @${sc.dpr}x` },
        { label: 'Touch points', value: s(sc.touch?.maxTouchPoints) },
      ];
    },
    observed: ({ data }) => ({
      hardwareConcurrency: data.navigator?.hardwareConcurrency, deviceMemory: data.navigator?.deviceMemory,
      maxTouchPoints: data.navigator?.maxTouchPoints, screen: data.screen,
    }),
  },
  locale: {
    metrics: ({ data, net }) => {
      const l = data.locale ?? {};
      const off = l.samples?.[0]?.date;
      return [
        { label: 'Timezone', value: s(l.timeZone) },
        { label: 'UTC offset', value: off == null ? '—' : `UTC${off >= 0 ? '+' : ''}${off / 60}` },
        { label: 'Language', value: s((l.languages ?? []).slice(0, 3).join(', ')) },
        { label: 'IP timezone', value: s(net.ipTimezone ?? 'n/a') },
      ];
    },
    observed: ({ data, http, net, serverNow }) => ({
      ...data.locale, accept_language: http.headers['accept-language'], ip_timezone: net.ipTimezone,
      client_time: data.clientTime, server_time: serverNow,
    }),
  },
  audio: {
    metrics: ({ data }) => {
      const a = data.audio ?? {};
      return [
        { label: 'Sample sum', value: a.sumA == null ? '—' : Number(a.sumA).toFixed(8) },
        { label: 'Run 1 = Run 2', value: a.sumB == null ? '—' : yes(a.sumA === a.sumB, 'yes', 'NO'), is_anomalous: a.sumB != null && a.sumA !== a.sumB },
        { label: 'getChannelData ≡ copy', value: a.channelCopyDiff == null ? '—' : yes(a.channelCopyDiff === 0, 'yes', `${a.channelCopyDiff} diff`), is_anomalous: a.channelCopyDiff > 0 },
      ];
    },
    observed: ({ data }) => ({ ...data.audio }),
    stability: ({ data }) => {
      const a = data.audio;
      if (!a?.supported || a.sumA == null) return undefined;
      return {
        run_1_hash: String(a.sumA), run_2_hash: String(a.sumB),
        is_deterministic: a.sumA === a.sumB && !(a.channelCopyDiff > 0),
        note: 'Tổng |sample| 4500..5000 của OfflineAudioContext(1, 5000, 44100), triangle 10 kHz + DynamicsCompressor.',
      };
    },
  },
  fonts: {
    metrics: ({ data }) => {
      const f = data.fonts?.found ?? { windows: [], mac: [], linux: [] };
      const m = data.fonts?.metrics;
      return [
        { label: 'Win / Mac / Linux', value: `${f.windows.length} / ${f.mac.length} / ${f.linux.length}` },
        { label: 'Emoji font', value: s((data.fonts?.emoji ?? []).join(', ') || 'none') },
        { label: 'Metrics stable', value: m ? yes(m.dom?.[0] === m.dom?.[1] && m.canvas?.[0] === m.canvas?.[1], 'yes', 'NO') : '—' },
      ];
    },
    observed: ({ data }) => ({ ...data.fonts }),
    stability: ({ data }) => {
      const m = data.fonts?.metrics;
      if (!m) return undefined;
      return {
        run_1_hash: `dom=${m.dom?.[0]} canvas=${m.canvas?.[0]}`, run_2_hash: `dom=${m.dom?.[1]} canvas=${m.canvas?.[1]}`,
        is_deterministic: m.dom?.[0] === m.dom?.[1] && m.canvas?.[0] === m.canvas?.[1],
        note: 'Độ rộng của cùng một chuỗi đo 2 lần bằng getBoundingClientRect và measureText.',
      };
    },
  },
  automation: {
    metrics: ({ data }) => {
      const t = data.tamper?.targets ?? [];
      const hooked = t.filter((x: any) => hookReasons(x).length || x.nativeCross === false).length;
      return [
        { label: 'webdriver', value: s(data.navigator?.webdriver), is_anomalous: data.navigator?.webdriver === true },
        { label: 'Hooked APIs', value: `${hooked}/${t.length}`, is_anomalous: hooked > 0 },
        { label: 'Plugins', value: s(data.navigator?.pluginsLength) },
        { label: 'CDP leak', value: s(data.automation?.cdpLeak) },
      ];
    },
    observed: ({ data }) => ({ automation: data.automation, tamper: data.tamper, iframe: data.iframe }),
    stability: ({ data }) => {
      if (!data.iframe) return undefined;
      const hm = hashTuple({ ...data.navigator, timeZone: data.locale?.timeZone });
      const hi = hashTuple(data.iframe);
      return { run_1_hash: hm, run_2_hash: hi, is_deterministic: hm === hi, note: 'Hash navigator của window chính và iframe about:blank sạch.' };
    },
  },
  network: {
    metrics: ({ net }) => [
      { label: 'JA4', value: s(net.ja4 ?? net.tlsClient ?? 'n/a', 40) },
      { label: 'HTTP/2 order', value: s(net.h2?.split('|').pop() ?? 'n/a') },
      { label: 'ASN', value: s(net.asnOrg ?? net.asn ?? 'n/a') },
      { label: 'TCP OS', value: s(net.tcpOs ?? 'n/a') },
    ],
    observed: ({ net, http }) => ({ ...net, client_ip: http.ip }),
  },
};

/** Suy luận OS thật từ bằng chứng khó giả (GPU, font, TCP), độc lập với UA */
export function inferRealOS(ctx: Ctx): string {
  const r = String(ctx.data.webgl?.unmaskedRenderer || ctx.data.worker?.webglRenderer || '');
  if (/direct3d|d3d1\d/i.test(r)) return 'Windows';
  if (/apple m\d|apple gpu|metal/i.test(r)) return ctx.ua.mobile ? 'iOS' : 'macOS';
  if (/adreno|mali|powervr|xclipse/i.test(r)) return 'Android';
  const f = ctx.data.fonts?.found;
  if (f) {
    const w = f.windows.length, m = f.mac.length, l = f.linux.length;
    if (w >= 3 && w >= m) return 'Windows';
    if (m >= 3) return 'macOS';
    if (l >= 2 && w === 0 && m === 0) return 'Linux';
  }
  if (ctx.net.tcpOs) return ctx.net.tcpOs;
  const p = ctx.data.worker?.platform || ctx.data.navigator?.platform || '';
  if (/^Win/.test(p)) return 'Windows';
  if (/^Mac/.test(p)) return 'macOS';
  if (/Linux/.test(p)) return 'Linux';
  return 'Unknown';
}

export function engineLabel(engine: string, jsEngine?: string) {
  const map: Record<string, string> = { blink: 'Blink / V8', gecko: 'Gecko / SpiderMonkey', webkit: 'WebKit / JavaScriptCore' };
  return map[engine] ?? (jsEngine ? `${engine} / ${jsEngine}` : 'Unknown');
}
