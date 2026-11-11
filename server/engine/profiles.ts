// Kịch bản dữ liệu mẫu cho "Simulate Antidetect Profile" và unit test.
// Mỗi profile là payload probe + HTTP context + dữ liệu edge, chạy qua đúng engine thật.
// IP dùng dải tài liệu (RFC 5737) và ASN dải private (RFC 5398).
import type { NetIntel } from './types.ts';

export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const RENDERER = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const brands = [
  { brand: 'Chromium', version: '142' },
  { brand: 'Google Chrome', version: '142' },
  { brand: 'Not_A Brand', version: '99' },
];

const TARGET_SPECS: [string, 'get' | 'value' | 'ctor', number?][] = [
  ['Navigator.userAgent', 'get'], ['Navigator.platform', 'get'], ['Navigator.hardwareConcurrency', 'get'],
  ['Navigator.deviceMemory', 'get'], ['Navigator.languages', 'get'], ['Navigator.webdriver', 'get'],
  ['Screen.width', 'get'], ['Screen.height', 'get'],
  ['HTMLCanvasElement.toDataURL', 'value', 0], ['HTMLCanvasElement.toBlob', 'value', 1],
  ['CanvasRenderingContext2D.getImageData', 'value', 4], ['CanvasRenderingContext2D.measureText', 'value', 1],
  ['WebGLRenderingContext.getParameter', 'value', 1], ['WebGLRenderingContext.readPixels', 'value', 7],
  ['Date.getTimezoneOffset', 'value', 0], ['Intl.DateTimeFormat.resolvedOptions', 'value', 0],
  ['AudioBuffer.getChannelData', 'value', 1], ['AudioBuffer.copyFromChannel', 'value', 2],
  ['Element.getBoundingClientRect', 'value', 0],
  ['RTCPeerConnection', 'ctor', 0], ['RTCPeerConnection.createOffer', 'value', 0],
  ['RTCPeerConnection.setLocalDescription', 'value', 0], ['RTCPeerConnection.createDataChannel', 'value', 1],
];

const nativeTarget = ([name, kind, length]: (typeof TARGET_SPECS)[number]) => {
  const short = name.split('.').pop()!;
  return {
    name, kind, nativeMain: true, nativeCross: true, hasPrototype: kind === 'ctor', ownArguments: false,
    toStringHasName: true, length: kind === 'get' ? 0 : length, extraFrames: 0,
    fnName: kind === 'get' ? `get ${short}` : short,
    ...(kind !== 'ctor' ? { illegalInvocation: true } : {}),
  };
};
const hookedTarget = (name: string, extra: Record<string, unknown> = {}) => ({
  ...nativeTarget(TARGET_SPECS.find((t) => t[0] === name)!),
  nativeMain: true, nativeCross: false, hasPrototype: true, toStringHasName: false, extraFrames: 1,
  source: 'function () { [native code] }', ...extra,
});

export interface Scenario { data: any; http: { ip: string; headers: Record<string, string | undefined> }; net: NetIntel }

export function cleanChrome(now = Date.now()): Scenario {
  const nav = {
    userAgent: CHROME_UA, appVersion: CHROME_UA.replace('Mozilla/', ''), platform: 'Win32', vendor: 'Google Inc.',
    language: 'vi-VN', languages: ['vi-VN', 'vi', 'en-US', 'en'], hardwareConcurrency: 16, deviceMemory: 8,
    maxTouchPoints: 0, webdriver: false, webdriverInNavigator: true, cookieEnabled: true, pdfViewerEnabled: true,
    pluginsLength: 5, hasChrome: true, isBrave: false, hasUserAgentData: true, hasDeviceMemory: true,
  };
  const samples = [0, 1, 2].map(() => ({ intl: 420, date: 420, toString: 420 }));
  const candidates = [
    { protocol: 'udp', address: '6f1d3c2a-58b4-4e1f-9c1a-2b7e6d9a0c11.local', port: '54321', type: 'host',
      raw: 'candidate:3684919514 1 udp 2113937151 6f1d3c2a-58b4-4e1f-9c1a-2b7e6d9a0c11.local 54321 typ host generation 0 ufrag p5c4 network-cost 999' },
    { protocol: 'udp', address: '203.0.113.10', port: '54321', type: 'srflx',
      raw: 'candidate:2165329941 1 udp 1677729535 203.0.113.10 54321 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag p5c4 network-cost 999' },
  ];
  const data = {
    probeVersion: '1.0.0', nonce: 'sim', clientTime: now,
    navigator: nav,
    uaData: {
      supported: true, brands, mobile: false, platform: 'Windows',
      high: { architecture: 'x86', bitness: '64', platformVersion: '15.0.0', fullVersionList: [{ brand: 'Chromium', version: '142.0.7444.60' }, { brand: 'Google Chrome', version: '142.0.7444.60' }, { brand: 'Not_A Brand', version: '99.0.0.0' }] },
    },
    engine: {
      engine: 'blink', jsEngine: 'v8',
      features: { findLast: true, structuredClone: true, toSorted: true, groupBy: true, withResolvers: true, fromAsync: true, setUnion: true, urlParse: true, promiseTry: true, float16Array: true, regexpEscape: true },
    },
    screen: {
      width: 2560, height: 1440, availWidth: 2560, availHeight: 1392, colorDepth: 24, pixelDepth: 24, dpr: 1,
      innerWidth: 2560, innerHeight: 1270, outerWidth: 2560, outerHeight: 1392, orientation: 'landscape-primary',
      touch: { maxTouchPoints: 0, ontouchstart: false, coarse: false, hoverNone: false },
    },
    locale: {
      timeZone: 'Asia/Ho_Chi_Minh', intlLocale: 'vi-VN', numberLocale: 'vi-VN', calendar: 'gregory',
      language: 'vi-VN', languages: nav.languages, samples,
    },
    canvas: {
      supported: true, blank: false, uniform: false, hashA: '5e0c41a9d2b7f3c8', hashB: '5e0c41a9d2b7f3c8',
      hashReread: '5e0c41a9d2b7f3c8', hashRereadB: '5e0c41a9d2b7f3c8', diffBytes: 0, dataUrlHashA: '8abda2aa', dataUrlHashB: '8abda2aa',
      solidBadPixels: 0, solidTotal: 256, decodedDiffPixels: 0, decodedTotal: 19200, geoHash: 'b1c2d3e4f5a69788', fixedHash: '9a06d5661f2e4b70',
      roundTrip: { total: 2048, changedPx: 0, changedBytes: 0, maxDelta: 0, alphaBad: 0, channels: [0, 0, 0, 0], quadBad: 0, quadTotal: 1024 },
      glyphRun: {
        checked: 4, bad: 0, diffBytes: 0,
        cases: [
          { g: 'H', font: '40px "Arial"', stroke: false, x0: 7, cols: 34, ink: 1716, diff: 0 }, { g: 'W', font: '32px "Verdana"', stroke: true, x0: 9, cols: 39, ink: 1210, diff: 0 },
          { g: 'm', font: '36px "Times New Roman"', stroke: false, x0: 6, cols: 33, ink: 1100, diff: 0 }, { g: 'E', font: '30px "Georgia"', stroke: true, x0: 8, cols: 26, ink: 640, diff: 0 },
        ],
      },
    },
    webgl: {
      supported: true, vendor: 'WebKit', renderer: 'WebKit WebGL', unmaskedVendor: 'Google Inc. (NVIDIA)', unmaskedRenderer: RENDERER,
      version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)', maxTextureSize: 16384, maxViewportDims: [32767, 32767],
      maxVertexUniformVectors: 4096, maxFragmentUniformVectors: 1024, extensionCount: 36, renderHashA: 'c0ffee12ab34cd56', renderHashB: 'c0ffee12ab34cd56',
      webgl2: { supported: true, unmaskedVendor: 'Google Inc. (NVIDIA)', unmaskedRenderer: RENDERER, maxTextureSize: 16384, maxViewportDims: [32767, 32767] },
      truth: {
        supported: true, total: 256,
        clear: { bad: 0, maxDelta: 0, wrap: 0, alphaBad: 0 }, solid: { bad: 0, maxDelta: 0, wrap: 0, alphaBad: 0 },
      },
      varying: {
        off: 0, of: 15120,
        cases: [{ kind: 'webgl', n: 64, off: 0, of: 4096, maxDelta: 0, compilerInput: true }, { kind: 'webgl', n: 100, off: 0, of: 10000, maxDelta: 0, compilerInput: true }, { kind: 'webgl2', n: 32, off: 0, of: 1024, maxDelta: 0, compilerInput: null }],
      },
      uniformLimit: { supported: true, declaredVS: 4096, declaredFS: 1024, vsAtDeclared: true, vsAbove: false, fsAtDeclared: true, fsAbove: false },
    },
    webgpu: { supported: true, vendor: 'nvidia', architecture: 'ampere', device: '', description: '', subgroupMinSize: 32, subgroupMaxSize: 32, isFallback: false },
    audio: {
      supported: true, sumA: 124.04347527516074, sumB: 124.04347527516074, channelCopyDiff: 0, copyDiff: 0, allZero: false,
      invariants: { samples: 4096, periodicSine: 0, periodicTriangle: 0, waveAntiSine: 0, waveAntiTriangle: 0, waveAntiSquare: 0, wavePeak: 1, gainHalf: 0, twoOscSum: 0, prefix: 0, analyser: 0, workletIn: 0, workletOut: 0 },
    },
    rects: {
      supported: true, checked: 192, off: 0, maxDelta: 0, byProp: { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 }, samples: [], dpr: 1, vvScale: 1,
    },
    fonts: {
      supported: true,
      found: { windows: ['Segoe UI', 'Calibri', 'Consolas', 'Tahoma', 'Cambria'], mac: [], linux: [] },
      foundDom: { windows: ['Segoe UI', 'Calibri', 'Consolas', 'Tahoma', 'Cambria'], mac: [], linux: [] },
      emoji: ['Segoe UI Emoji'], metrics: { dom: [512.34375, 512.34375], canvas: [498.1875, 498.1875] },
      checkApi: { 'Segoe UI': true, 'Helvetica Neue': true },
    },
    tamper: { targets: TARGET_SPECS.map(nativeTarget), toStringNative: true, toStringCross: true, toStringProxy: false, navigatorOwnProps: [], screenOwnProps: [] },
    automation: { webdriver: false, suspiciousGlobals: [], headlessUA: false, outerZero: false, cdpLeak: false, notification: { permission: 'default', query: 'prompt' } },
    iframe: {
      userAgent: CHROME_UA, platform: 'Win32', hardwareConcurrency: 16, deviceMemory: 8, languages: nav.languages,
      webdriver: false, screenWidth: 2560, screenHeight: 1440, timeZone: 'Asia/Ho_Chi_Minh',
    },
    worker: {
      supported: true, userAgent: CHROME_UA, platform: 'Win32', hardwareConcurrency: 16, deviceMemory: 8,
      language: 'vi-VN', languages: nav.languages, timeZone: 'Asia/Ho_Chi_Minh', tzOffset: 420,
      uaBrands: brands.map((b) => `${b.brand}/${b.version}`), uaPlatform: 'Windows', webglRenderer: RENDERER, canvas2d: 'b1c2d3e4f5a69788',
    },
    webrtc: {
      supported: true, state: 'complete', gatheringState: 'complete', gatheringEvents: ['gathering', 'complete'], ufrag: 'p5c4',
      ms: 182, tFirst: 4, tSrflx: 61, stunServers: 2, timeoutMs: 6000, cameraPermission: 'prompt',
      candidates: candidates.map((c) => ({
        ...c, ufrag: 'p5c4', ...(c.type === 'srflx' ? { raddr: '0.0.0.0', rport: '0' } : {}),
        fields: { address: c.address, port: Number(c.port), type: c.type, relatedAddress: c.type === 'srflx' ? '0.0.0.0' : null, protocol: c.protocol },
      })),
      sdpCandidates: candidates.map((c) => c.raw),
      iframe: { state: 'complete', gatheringState: 'complete', ms: 190, ufrag: 'Q8xz', candidates: candidates.map((c) => ({ ...c, address: c.type === 'host' ? 'a3e5c2d1-0b7f-4c6e-8d9a-1f2e3b4c5d6e.local' : c.address })) },
    },
    egress: { skipped: true },
    errors: [],
  };
  return {
    data,
    http: {
      ip: '203.0.113.10',
      headers: {
        'user-agent': CHROME_UA, 'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
      },
    },
    net: {
      ja4: 't13d1516h2_8daaf6152771_02713d6af862', h2: '1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p', httpVersion: '2',
      tcpOs: 'Windows', asn: 'AS64500', asnOrg: 'Example Residential Broadband', asnType: 'residential', country: 'VN',
      ipTimezone: 'Asia/Ho_Chi_Minh', ipFlags: [],
      webrtcIp: { ip: '203.0.113.10', asn: 'AS64500', asnOrg: 'Example Residential Broadband', asnType: 'residential', country: 'VN' },
    },
  };
}

const setUA = (s: Scenario, ua: string) => {
  s.data.navigator.userAgent = ua;
  s.data.navigator.appVersion = ua.replace('Mozilla/', '');
  s.data.iframe.userAgent = ua;
  s.data.worker.userAgent = ua;
  s.http.headers['user-agent'] = ua;
};

export interface Profile { id: string; title: string; description: string; expected: 'ALLOW' | 'CHALLENGE' | 'BLOCK'; build(now?: number): Scenario }

export const PROFILES: Profile[] = [
  {
    id: 'real-chrome-windows', title: 'Real Chrome Windows', expected: 'ALLOW',
    description: 'Chrome 142 nguyên bản trên Windows 11, IP dân cư, mọi tín hiệu nhất quán.',
    build: (now) => cleanChrome(now),
  },
  {
    id: 'privacy-shield-vpn', title: 'Privacy Shield + VPN (Brave Strict)', expected: 'ALLOW',
    description: 'Brave Shields Strict chặn Canvas/Audio/WebRTC, ẩn GPU; đi qua VPN datacenter nên lệch timezone IP. Phải ra WARNING/UNAVAILABLE, không bị chặn.',
    build: (now) => {
      const s = cleanChrome(now);
      const d = s.data;
      d.navigator.isBrave = true;
      d.uaData.brands = [{ brand: 'Brave', version: '142' }, { brand: 'Chromium', version: '142' }, { brand: 'Not_A Brand', version: '99' }];
      d.uaData.high.fullVersionList = [{ brand: 'Brave', version: '142.1.84.132' }, { brand: 'Chromium', version: '142.0.7444.60' }, { brand: 'Not_A Brand', version: '99.0.0.0' }];
      d.worker.uaBrands = d.uaData.brands.map((b: any) => `${b.brand}/${b.version}`);
      s.http.headers['sec-ch-ua'] = '"Brave";v="142", "Chromium";v="142", "Not_A Brand";v="99"';
      d.canvas = { supported: true, blank: true, uniform: true, hashA: '0000000000000000', hashB: '0000000000000000', diffBytes: 0, solidBadPixels: 0, solidTotal: 256 };
      d.worker.canvas2d = null;
      d.webgl.unmaskedRenderer = null; d.webgl.unmaskedVendor = null;
      d.webgl.webgl2 = { supported: true, unmaskedRenderer: null, renderer: 'WebKit WebGL', maxTextureSize: 16384, maxViewportDims: [32767, 32767] };
      d.worker.webglRenderer = 'WebKit WebGL';
      d.audio = { supported: true, sumA: 0, sumB: 0, channelCopyDiff: 0, copyDiff: 0, allZero: true };
      d.webrtc = { supported: true, state: 'timeout', candidates: [] };
      d.navigator.pluginsLength = 5;
      s.http.ip = '198.51.100.24';
      Object.assign(s.net, {
        asn: 'AS64510', asnOrg: 'Example Cloud VPN Hosting', asnType: 'hosting', country: 'SG', ipTimezone: 'Asia/Singapore',
        tcpOs: 'Linux', webrtcIp: undefined,
      });
      return s;
    },
  },
  {
    id: 'mismatched-macos-gpu', title: 'Mismatched macOS GPU on Windows', expected: 'CHALLENGE',
    description: 'Profile khai báo Chrome Windows nhưng chạy trên MacBook M2: GPU Apple, bộ font macOS và emoji Apple.',
    build: (now) => {
      const s = cleanChrome(now);
      const d = s.data;
      const r = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';
      d.webgl.unmaskedVendor = 'Google Inc. (Apple)'; d.webgl.unmaskedRenderer = r;
      d.webgl.maxVertexUniformVectors = 1024; d.webgl.maxFragmentUniformVectors = 1024;
      d.webgl.webgl2.unmaskedRenderer = r; d.worker.webglRenderer = r;
      d.navigator.hardwareConcurrency = 8; d.iframe.hardwareConcurrency = 8; d.worker.hardwareConcurrency = 8;
      d.fonts.found = { windows: [], mac: ['Helvetica Neue', 'Menlo', 'Avenir', 'Geneva', 'Apple Chancery'], linux: [] };
      d.fonts.foundDom = structuredClone(d.fonts.found);
      d.fonts.emoji = ['Apple Color Emoji'];
      d.audio.sumA = d.audio.sumB = 124.04344968475198;
      d.screen = { ...d.screen, width: 1512, height: 982, availWidth: 1512, availHeight: 944, outerWidth: 1512, outerHeight: 944, dpr: 2, colorDepth: 30, pixelDepth: 30 };
      d.iframe.screenWidth = 1512; d.iframe.screenHeight = 982;
      return s;
    },
  },
  {
    id: 'antidetect-canvas-noise', title: 'Spoofed Antidetect Canvas Noise', expected: 'BLOCK',
    description: 'Antidetect tầng JS: chèn nhiễu Canvas/Audio/WebGL, đổi UA xuống Chrome 120 trên core 142, ghi đè Navigator bằng Proxy nhưng quên Worker/iframe, proxy datacenter lộ IP thật qua WebRTC.',
    build: (now) => {
      const s = cleanChrome(now);
      const d = s.data;
      const ua = CHROME_UA.replace('Chrome/142', 'Chrome/120');
      d.navigator.userAgent = ua; d.navigator.appVersion = ua.replace('Mozilla/', ''); s.http.headers['user-agent'] = ua;
      d.navigator.hardwareConcurrency = 4; d.navigator.deviceMemory = 12; d.navigator.languages = ['en-US', 'en']; d.navigator.language = 'en-US';
      d.uaData.brands = d.uaData.brands.map((b: any) => (/Not/.test(b.brand) ? b : { ...b, version: '120' }));
      s.http.headers['sec-ch-ua'] = '"Chromium";v="120", "Google Chrome";v="120", "Not_A Brand";v="99"';
      // Worker và iframe vẫn trả giá trị thật của máy
      d.iframe.userAgent = CHROME_UA;
      d.locale.timeZone = 'America/New_York'; d.locale.samples = [{ intl: -300, date: 420, toString: 420 }, { intl: -300, date: 420, toString: 420 }, { intl: -240, date: 420, toString: 420 }];
      d.locale.language = 'en-US'; d.locale.languages = ['en-US', 'en']; d.locale.intlLocale = 'vi-VN'; d.locale.numberLocale = 'en-US';
      Object.assign(d.canvas, { hashB: '5e0c41a9d2b7f3d1', hashRereadB: '77aa1b0c9e8d2f31', diffBytes: 812, dataUrlHashB: '1f2e3d4c', solidBadPixels: 9, decodedDiffPixels: 143 });
      d.worker.canvas2d = 'aa00bb11cc22dd33';
      d.webgl.renderHashB = 'c0ffee12ab34cd99';
      d.webgl.webgl2.unmaskedRenderer = 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)';
      d.audio.sumB = 124.04347527516891; d.audio.channelCopyDiff = 37;
      d.tamper.targets = d.tamper.targets.map((t: any) =>
        /^(Navigator\.(userAgent|hardwareConcurrency|deviceMemory|languages)|HTMLCanvasElement\.toDataURL|CanvasRenderingContext2D\.getImageData|AudioBuffer\.getChannelData|RTCPeerConnection\.createOffer)$/.test(t.name)
          ? hookedTarget(t.name) : t);
      d.tamper.navigatorOwnProps = ['hardwareConcurrency'];
      s.http.headers['accept-language'] = 'vi-VN,vi;q=0.9';
      s.http.ip = '198.51.100.77';
      d.webrtc.candidates[1].address = '203.0.113.10';
      Object.assign(s.net, {
        asn: 'AS64511', asnOrg: 'Example Datacenter Proxy Ltd', asnType: 'hosting', country: 'US', ipTimezone: 'America/New_York',
        webrtcIp: { ip: '203.0.113.10', asn: 'AS64500', asnOrg: 'Example Residential Broadband', asnType: 'residential', country: 'VN' },
      });
      return s;
    },
  },
  {
    id: 'dolphin-static-noise', title: 'Dolphin Anty (static noise)', expected: 'BLOCK',
    description: 'Số đo thật từ Dolphin Anty bật noise Canvas/WebGL/ClientRects/Audio: noise native, cố định theo profile, giống nhau ở main/iframe/Worker và mọi đường đọc, nên qua hết các phép so ổn định. Chỉ lộ khi so với đáp án tuyệt đối.',
    build: (now) => {
      const s = cleanChrome(now);
      const d = s.data;
      const gpu = 'ANGLE (AMD, AMD Radeon (TM) R5 M330 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      d.webgl.unmaskedVendor = 'Google Inc. (AMD)'; d.webgl.unmaskedRenderer = gpu; d.webgl.webgl2.unmaskedRenderer = gpu; d.worker.webglRenderer = gpu;
      // Canvas: ô màu đặc và ảnh putImageData lệch ±1–3 ở mọi kênh, kể cả alpha (Noise Lab, profile 903940070)
      d.canvas.solidBadPixels = 256;
      d.canvas.roundTrip = { total: 2048, changedPx: 2043, changedBytes: 7580, maxDelta: 3, alphaBad: 1524, channels: [1750, 1756, 1765, 1524], quadBad: 1024, quadTotal: 1024 };
      // WebGL: readPixels lệch ±1–2 và tràn số uint8 ở kênh 0/255
      d.webgl.truth = {
        supported: true, total: 256,
        clear: { bad: 252, maxDelta: 2, wrap: 0, alphaBad: 0 }, solid: { bad: 252, maxDelta: 255, wrap: 380, alphaBad: 0 },
      };
      // ClientRects: 100.25 → 100.25499725341797 (float32), số nguyên giữ nguyên
      d.rects = { ...d.rects, off: 7, maxDelta: 0.00499725341796875, byProp: { x: 0, y: 4, width: 0, height: 0, right: 0, bottom: 3 }, samples: [['y', 100.25, 100.25499725341797]] };
      // Audio: tổng biên độ lệch giá trị thật 124.04347776696522 nhưng ổn định giữa 2 lần render
      d.audio.sumA = 124.04347091798263; d.audio.sumB = 124.04347091798263;
      // noise làm sẵn trên wavetable: vẫn tuần hoàn và tuyến tính, nhưng mất phản đối xứng và đỉnh ≠ 1.0
      Object.assign(d.audio.invariants, { waveAntiSine: 56, waveAntiTriangle: 58, waveAntiSquare: 56, wavePeak: 0.9999991059303284 });
      return s;
    },
  },
  {
    id: 'gpm-draw-noise', title: 'GPM Login (draw-time noise)', expected: 'BLOCK',
    description: 'Số đo thật từ GPM Login 156 bật noise Canvas/WebGL/ClientRects/Audio: noise chèn lúc vẽ (vị trí chữ, gl_Position, DynamicsCompressor, width/height của layout) nên mọi phép đọc pixel và so ổn định đều sạch, CANV_06/WBGL_07/AUDI_05 PASS. Lộ ở glyph run, varying ↔ gl_FragCoord, baseline compressor, ClientRects, và GPU giả (subgroup WebGPU, giới hạn uniform).',
    build: (now) => {
      const s = cleanChrome(now);
      const d = s.data;
      const gpu = 'ANGLE (NVIDIA, NVIDIA GeForce GTX 960 (0x00001401) Direct3D11 vs_5_0 ps_5_0, D3D11)';
      d.webgl.unmaskedVendor = 'Google Inc. (NVIDIA)'; d.webgl.unmaskedRenderer = gpu; d.webgl.webgl2.unmaskedRenderer = gpu; d.worker.webglRenderer = gpu;
      d.navigator.hardwareConcurrency = 6; d.iframe.hardwareConcurrency = 6; d.worker.hardwareConcurrency = 6;
      // Canvas: chuỗi ≥ 2 ký tự bị dịch ≈ +0.5 px ngang, +1 px dọc; ký tự đơn và putImageData sạch
      d.canvas.glyphRun = {
        checked: 4, bad: 4, diffBytes: 1672,
        cases: [
          { g: 'H', font: '40px "Arial"', stroke: false, x0: 7, cols: 34, ink: 1716, diff: 327 }, { g: 'W', font: '32px "Verdana"', stroke: true, x0: 9, cols: 39, ink: 1210, diff: 569 },
          { g: 'm', font: '36px "Times New Roman"', stroke: false, x0: 6, cols: 33, ink: 1100, diff: 288 }, { g: 'E', font: '30px "Georgia"', stroke: true, x0: 8, cols: 26, ink: 640, diff: 356 },
        ],
      };
      // WebGL: clear/uniform/readPixels đúng đáp án, nhưng gl_Position bị lệch lúc link; giới hạn uniform giả 4095
      d.webgl.maxVertexUniformVectors = 4095;
      d.webgl.varying = {
        off: 3955, of: 15120,
        cases: [{ kind: 'webgl', n: 64, off: 960, of: 4096, maxDelta: 1, compilerInput: false }, { kind: 'webgl', n: 100, off: 2371, of: 10000, maxDelta: 1, compilerInput: false }, { kind: 'webgl2', n: 32, off: 624, of: 1024, maxDelta: 1, compilerInput: null }],
      };
      d.webgl.uniformLimit = { supported: true, declaredVS: 4095, declaredFS: 1024, vsAtDeclared: true, vsAbove: true, fsAtDeclared: true, fsAbove: false };
      // WebGPU đổi vendor/architecture theo GPU giả nhưng subgroup vẫn là của GPU thật (AMD GCN)
      d.webgpu = { supported: true, vendor: 'nvidia', architecture: 'maxwell', device: '', description: '', subgroupMinSize: 64, subgroupMaxSize: 64, isFallback: false };
      // ClientRects: width/height không nguyên ± k/64 px (vẫn trên lưới LayoutUnit), x/y nguyên vẹn
      d.rects = { ...d.rects, off: 94, maxDelta: 0.125, byProp: { x: 0, y: 0, width: 31, height: 16, right: 31, bottom: 16 }, samples: [['width', 33.5, 33.4375], ['height', 12.75, 12.8125]] };
      // Audio: oscillator sạch, DynamicsCompressor lệch 3.8e-3 (ổn định giữa 2 lần render)
      d.audio.sumA = 124.03965004976635; d.audio.sumB = 124.03965004976635;
      return s;
    },
  },
  {
    id: 'headless-bot', title: 'Headless Automation Bot', expected: 'BLOCK',
    description: 'Puppeteer headless trên VPS Linux đổi UA sang Chrome Windows: lộ webdriver, CDP, Worker vẫn báo HeadlessChrome/Linux, GPU SwiftShader, không plugin.',
    build: (now) => {
      const s = cleanChrome(now);
      const d = s.data;
      const headless = CHROME_UA.replace('Chrome/', 'HeadlessChrome/').replace('Windows NT 10.0; Win64; x64', 'X11; Linux x86_64');
      d.navigator.webdriver = true; d.iframe.webdriver = true;
      d.navigator.platform = 'Linux x86_64'; d.iframe.platform = 'Linux x86_64';
      d.navigator.pluginsLength = 0; d.navigator.hasChrome = false; d.navigator.hardwareConcurrency = 2; d.iframe.hardwareConcurrency = 2;
      d.navigator.languages = ['en-US']; d.navigator.language = 'en-US'; d.iframe.languages = ['en-US'];
      d.worker = { ...d.worker, userAgent: headless, platform: 'Linux x86_64', hardwareConcurrency: 2, languages: ['en-US'], language: 'en-US', timeZone: 'UTC', uaPlatform: 'Linux', webglRenderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' };
      d.automation = { webdriver: true, suspiciousGlobals: ['cdc_adoQpoasnfa76pfcZLmcfl_Array', '__puppeteer_evaluation_script__'], headlessUA: false, outerZero: true, cdpLeak: true, notification: { permission: 'denied', query: 'prompt' } };
      const sw = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
      d.webgl.unmaskedVendor = 'Google Inc. (Google)'; d.webgl.unmaskedRenderer = sw; d.webgl.webgl2.unmaskedRenderer = sw; d.webgl.maxTextureSize = 8192;
      d.webgl.webgl2.maxTextureSize = 8192; d.webgl.extensionCount = 28;
      d.fonts.found = { windows: [], mac: [], linux: ['DejaVu Sans', 'Liberation Sans'] };
      d.fonts.foundDom = structuredClone(d.fonts.found);
      d.fonts.emoji = ['Noto Color Emoji'];
      d.locale.timeZone = 'UTC'; d.locale.samples = [0, 1, 2].map(() => ({ intl: 0, date: 0, toString: 0 })); d.iframe.timeZone = 'UTC';
      d.locale.language = 'en-US'; d.locale.languages = ['en-US']; d.locale.intlLocale = 'en-US'; d.locale.numberLocale = 'en-US';
      d.screen = { ...d.screen, width: 800, height: 600, availWidth: 800, availHeight: 600, outerWidth: 0, outerHeight: 0, innerWidth: 800, innerHeight: 600 };
      d.iframe.screenWidth = 800; d.iframe.screenHeight = 600;
      d.clientTime = (now ?? Date.now()) - 1_840_000;
      s.http.headers['accept-language'] = 'en-US,en;q=0.9';
      d.webrtc = { supported: true, state: 'complete', candidates: [{ protocol: 'udp', address: '192.0.2.50', port: '40000', type: 'host', raw: 'candidate:1 1 udp 2113937151 192.0.2.50 40000 typ host generation 0' }] };
      s.http.ip = '192.0.2.50';
      Object.assign(s.net, {
        asn: 'AS64496', asnOrg: 'Example VPS Hosting', asnType: 'hosting', country: 'DE', ipTimezone: 'Europe/Berlin', tcpOs: 'Linux',
        ipFlags: ['abuse'], webrtcIp: undefined,
      });
      return s;
    },
  },
  {
    id: 'scripted-replay-bot', title: 'Scripted Replay Bot (Python/curl)', expected: 'BLOCK',
    description: 'Script Python lấy nonce mới rồi gửi lại payload đã ghi từ một Chrome thật: JS sạch nhưng TLS, HTTP/2, header và đồng hồ lộ bản chất.',
    build: (now) => {
      const s = cleanChrome(now);
      s.data.clientTime = (now ?? Date.now()) - 86_400_000 * 3;
      s.http.headers = { 'user-agent': CHROME_UA, 'accept-language': 'en-US,en;q=0.5', accept: '*/*' };
      Object.assign(s.net, {
        ja4: 't13d4907h1_0d8feac7bc37_7395dae3b2f3', tlsClient: 'python-requests', h2: undefined, httpVersion: '1.1',
        tcpOs: 'Linux', asn: 'AS64497', asnOrg: 'Example Cloud Compute', asnType: 'hosting', country: 'NL', ipTimezone: 'Europe/Amsterdam', ipFlags: ['proxy', 'tor'],
      });
      s.http.ip = '192.0.2.99';
      return s;
    },
  },
];

export const PROFILE_BY_ID = new Map(PROFILES.map((p) => [p.id, p]));
