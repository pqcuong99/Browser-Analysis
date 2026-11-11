/*!
 * SentinelFP probe v1.1.0
 * Thu thập tín hiệu fingerprint + phép thử ổn định / đa ngữ cảnh (window · iframe · Web Worker),
 * gửi về server để chấm điểm. Client không tự kết luận.
 */
(() => {
  'use strict';

  const VERSION = '1.3.0';
  const NATIVE_RE = /\{\s*\[native code\]\s*\}\s*$/;

  // ---------- tiện ích ----------
  function fnv1a(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }
  const hashStr = (s) => fnv1a(new TextEncoder().encode(String(s)));

  /** SHA-256 (16 hex đầu) khi có WebCrypto, ngược lại FNV-1a */
  async function digest(bytes) {
    try {
      if (crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch {}
    return fnv1a(bytes);
  }

  // PRNG mulberry32: server gửi seed để client không phát lại được kết quả cũ
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);
  const errMsg = (e) => String((e && e.message) || e);

  // ---------- navigator ----------
  function collectNavigator() {
    const n = navigator;
    return {
      userAgent: n.userAgent,
      appVersion: n.appVersion,
      platform: n.platform,
      vendor: n.vendor,
      language: n.language,
      languages: Array.from(n.languages || []),
      hardwareConcurrency: n.hardwareConcurrency,
      deviceMemory: n.deviceMemory === undefined ? null : n.deviceMemory,
      maxTouchPoints: n.maxTouchPoints,
      webdriver: n.webdriver,
      webdriverInNavigator: 'webdriver' in n,
      cookieEnabled: n.cookieEnabled,
      pdfViewerEnabled: n.pdfViewerEnabled === undefined ? null : n.pdfViewerEnabled,
      pluginsLength: n.plugins ? n.plugins.length : null,
      hasChrome: typeof window.chrome === 'object' && window.chrome !== null,
      isBrave: !!(n.brave && typeof n.brave.isBrave === 'function'),
      hasUserAgentData: 'userAgentData' in n,
      hasDeviceMemory: 'deviceMemory' in n,
    };
  }

  async function collectUAData() {
    const d = navigator.userAgentData;
    if (!d) return { supported: false };
    const out = { supported: true, brands: (d.brands || []).map((b) => ({ brand: b.brand, version: b.version })), mobile: d.mobile, platform: d.platform };
    try {
      out.high = await withTimeout(
        d.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64']),
        1500, null);
    } catch (e) {
      out.highError = errMsg(e);
    }
    return out;
  }

  // ---------- engine thật (không dựa vào UA) ----------
  function collectEngine() {
    const css = (p, v) => { try { return CSS.supports(p, v); } catch { return false; } };
    let stack = '';
    try { throw new Error('sfp'); } catch (e) { stack = String(e.stack || ''); }
    const v8Stack = /\n\s+at /.test(stack);
    const mozCss = css('-moz-appearance', 'none');
    const jsEngine = v8Stack ? 'v8' : mozCss ? 'spidermonkey' : 'jsc';
    const engine = jsEngine === 'v8' ? 'blink' : jsEngine === 'spidermonkey' ? 'gecko' : 'webkit';
    const t = (x) => typeof x === 'function';
    return {
      engine, jsEngine, mozCss,
      features: {
        findLast: t(Array.prototype.findLast), structuredClone: typeof structuredClone === 'function',
        toSorted: t(Array.prototype.toSorted), groupBy: t(Object.groupBy), withResolvers: t(Promise.withResolvers),
        fromAsync: t(Array.fromAsync), setUnion: t(Set.prototype.union), urlParse: t(URL.parse), promiseTry: t(Promise.try),
        float16Array: typeof Float16Array === 'function', regexpEscape: t(RegExp.escape),
      },
    };
  }

  // ---------- screen / hardware ----------
  function collectScreen() {
    const mm = (q) => { try { return matchMedia(q).matches; } catch { return null; } };
    return {
      width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight,
      colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth, dpr: window.devicePixelRatio,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight,
      orientation: screen.orientation ? screen.orientation.type : null,
      touch: { maxTouchPoints: navigator.maxTouchPoints, ontouchstart: 'ontouchstart' in window, coarse: mm('(pointer: coarse)'), hoverNone: mm('(hover: none)') },
    };
  }

  // ---------- timezone / locale ----------
  function intlOffset(tz, date) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(date);
    const v = (parts.find((p) => p.type === 'timeZoneName') || {}).value;
    if (!v) return null;
    if (v === 'GMT' || v === 'UTC') return 0;
    const m = v.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : null;
  }

  function collectLocale() {
    const ro = Intl.DateTimeFormat().resolvedOptions();
    const tz = ro.timeZone;
    const y = new Date().getFullYear();
    const samples = [new Date(), new Date(y, 0, 15, 12), new Date(y, 6, 15, 12)].map((d) => {
      const m = d.toString().match(/GMT([+-])(\d{2})(\d{2})/);
      return {
        at: d.toISOString(),
        intl: (() => { try { return intlOffset(tz, d); } catch { return null; } })(),
        date: -d.getTimezoneOffset(),
        toString: m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null,
      };
    });
    let numberLocale = null;
    try { numberLocale = new Intl.NumberFormat().resolvedOptions().locale; } catch {}
    return {
      timeZone: tz, intlLocale: ro.locale, numberLocale, calendar: ro.calendar, numberingSystem: ro.numberingSystem,
      language: navigator.language, languages: Array.from(navigator.languages || []), samples,
    };
  }

  // ---------- canvas ----------
  function drawScene(ctx, seed, w, h) {
    const r = rng(seed);
    const col = () => `rgba(${(r() * 255) | 0},${(r() * 255) | 0},${(r() * 255) | 0},${(0.4 + r() * 0.6).toFixed(2)})`;
    const opaque = () => `rgb(${(r() * 255) | 0},${(r() * 255) | 0},${(r() * 255) | 0})`;
    // Nền đục 100%: tránh sai số premultiplied alpha khi Chromium chuyển canvas giữa GPU và CPU
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, opaque());
    g.addColorStop(1, opaque());
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = col();
    ctx.font = `${14 + ((r() * 10) | 0)}px Arial, sans-serif`;
    ctx.fillText('SentinelFP <canvas> ' + seed.toString(36), 4 + r() * 10, 30);
    ctx.font = '18px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.fillText('\u{1F603}\u{1F98A}\u{1F310}✨\u{1F468}‍\u{1F469}‍\u{1F467}', 8, 62);
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.fillStyle = col();
      ctx.arc(120 + r() * 100, 20 + r() * 50, 12 + r() * 20, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = col();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.bezierCurveTo(w * r(), 0, w * r(), h, w, 0);
    ctx.stroke();
  }

  // Cảnh hình học + gradient không phụ thuộc font: dùng chung cho main thread và Worker.
  // Viết dạng chuỗi để nhúng nguyên văn vào Worker.
  const GEO_SRC = `function drawGeo(ctx, seed, w, h) {
    let a = seed >>> 0;
    const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const c = () => 'rgb(' + ((r() * 255) | 0) + ',' + ((r() * 255) | 0) + ',' + ((r() * 255) | 0) + ')';
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, c()); g.addColorStop(0.5, c()); g.addColorStop(1, c());
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = c(); ctx.fillRect((r() * w) | 0, (r() * h) | 0, 10 + ((r() * 40) | 0), 10 + ((r() * 20) | 0)); }
    ctx.beginPath(); ctx.fillStyle = c(); ctx.arc(w / 2, h / 2, h / 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = c(); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(w * r(), h, w, h * r()); ctx.stroke();
  }`;
  // eslint-disable-next-line no-new-func
  const drawGeo = new Function(GEO_SRC + '; return drawGeo;')();

  const CW = 240, CH = 80;
  const make = (w = CW, h = CH) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const RF = { willReadFrequently: true };

  async function decodeDiff(canvas, reference) {
    const url = canvas.toDataURL('image/png');
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = make(canvas.width, canvas.height);
    const cx = c.getContext('2d', RF);
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    let diff = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] !== reference[i] || d[i + 1] !== reference[i + 1] || d[i + 2] !== reference[i + 2] || d[i + 3] !== reference[i + 3]) diff++;
    }
    return { diff, total: d.length / 4 };
  }

  /**
   * Ghi pixel ngẫu nhiên đục (alpha 255) bằng putImageData rồi đọc lại bằng getImageData.
   * Với ảnh đục, trình duyệt thật trả lại chính xác từng byte (không có premultiply làm tròn),
   * nên mọi byte lệch là noise chèn vào đường đọc. Noise "tĩnh" (cùng seed mỗi lần) vẫn bị bắt.
   */
  function canvasRoundTrip(seed) {
    const w = 64, h = 32, r = rng((seed ^ 0x9e3779b9) >>> 0);
    const c = make(w, h), x = c.getContext('2d', RF);
    const img = x.createImageData(w, h), t = img.data;
    for (let i = 0; i < t.length; i += 4) { t[i] = (r() * 256) | 0; t[i + 1] = (r() * 256) | 0; t[i + 2] = (r() * 256) | 0; t[i + 3] = 255; }
    const truth = Uint8ClampedArray.from(t);
    x.putImageData(img, 0, 0);
    const d = x.getImageData(0, 0, w, h).data;
    let px = 0, bytes = 0, maxDelta = 0, alphaBad = 0;
    const ch = [0, 0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      let bad = false;
      for (let k = 0; k < 4; k++) {
        const dd = Math.abs(d[i + k] - truth[i + k]);
        if (!dd) continue;
        bad = true; bytes++; ch[k]++;
        if (dd > maxDelta) maxDelta = dd;
      }
      if (d[i + 3] !== 255) alphaBad++;
      if (bad) px++;
    }
    // 4 ô màu đặc biên nguyên: không anti-alias nên cũng phải chính xác tuyệt đối
    const q = make(32, 32), qx = q.getContext('2d', RF);
    const Q = [[220, 20, 60], [30, 144, 255], [50, 205, 50], [255, 215, 0]];
    Q.forEach((c3, i) => { qx.fillStyle = `rgb(${c3.join(',')})`; qx.fillRect((i % 2) * 16, (i >> 1) * 16, 16, 16); });
    const qd = qx.getImageData(0, 0, 32, 32).data;
    let quadBad = 0;
    for (let y = 0; y < 32; y++) for (let xx = 0; xx < 32; xx++) {
      const e = Q[(y < 16 ? 0 : 2) + (xx < 16 ? 0 : 1)], o = (y * 32 + xx) * 4;
      if (qd[o] !== e[0] || qd[o + 1] !== e[1] || qd[o + 2] !== e[2] || qd[o + 3] !== 255) quadBad++;
    }
    return { total: w * h, changedPx: px, changedBytes: bytes, maxDelta, alphaBad, channels: ch, quadBad, quadTotal: 1024 };
  }

  /**
   * Glyph run: fillText('HH') và fillText('H') ở cùng toạ độ phải giống hệt nhau ở mọi cột trước glyph thứ 2
   * (glyph đầu rasterize độc lập, không phụ thuộc ký tự theo sau). Antidetect chèn noise lúc vẽ (GPM Login:
   * cộng độ lệch vào vị trí chuỗi ≥ 2 ký tự, ký tự đơn để nguyên) làm glyph đầu dịch đi, dù getImageData sạch.
   */
  function canvasGlyphRun(seed) {
    const r = rng((seed ^ 0x2545f491) >>> 0);
    const glyphs = ['H', 'W', 'm', 'E', 'A', 'N'], fonts = ['Arial', 'Verdana', 'Times New Roman', 'Georgia', 'Courier New'];
    const W = 160, H = 64, cases = [];
    let bad = 0, diffBytes = 0;
    for (let i = 0; i < 4; i++) {
      const g = glyphs[(r() * glyphs.length) | 0], font = `${28 + ((r() * 13) | 0)}px "${fonts[(r() * fonts.length) | 0]}"`;
      const x0 = 5 + ((r() * 8) | 0), stroke = i % 2 === 1;
      const draw = (t) => {
        const c = make(W, H), x = c.getContext('2d', RF);
        x.font = font; x.textBaseline = 'alphabetic';
        if (stroke) { x.lineWidth = 1; x.strokeText(t, x0, 46); } else x.fillText(t, x0, 46);
        return { d: x.getImageData(0, 0, W, H).data, adv: x.measureText(g).width };
      };
      const one = draw(g), two = draw(g + g);
      const limit = Math.min(W, Math.floor(x0 + one.adv - 1));
      let diff = 0, ink = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < limit; x++) { const k = (y * W + x) * 4 + 3; if (one.d[k] !== two.d[k]) diff++; if (one.d[k]) ink++; }
      if (diff) bad++;
      diffBytes += diff;
      cases.push({ g, font, stroke, x0, cols: limit, ink, diff });
    }
    return { checked: cases.length, bad, diffBytes, cases };
  }

  async function canvasProbe(seed) {
    const a = make(), b = make();
    const ca = a.getContext('2d', RF), cb = b.getContext('2d', RF);
    if (!ca || !cb) return { supported: false, error: 'no 2d context' };
    drawScene(ca, seed, CW, CH);
    drawScene(cb, seed, CW, CH);
    // Đọc đối xứng (cùng số lần, cùng thứ tự) để đường đọc của 2 canvas giống nhau
    const da = ca.getImageData(0, 0, CW, CH).data;
    const db = cb.getImageData(0, 0, CW, CH).data;
    const daAgain = ca.getImageData(0, 0, CW, CH).data;
    const dbAgain = cb.getImageData(0, 0, CW, CH).data;
    let diffBytes = 0, blank = true, uniform = true;
    for (let i = 0; i < da.length; i++) {
      if (da[i] !== db[i]) diffBytes++;
      if (da[i] !== 0) blank = false;
    }
    for (let i = 4; i < da.length; i += 4) {
      if (da[i] !== da[0] || da[i + 1] !== da[1] || da[i + 2] !== da[2] || da[i + 3] !== da[3]) { uniform = false; break; }
    }
    const out = {
      supported: true, blank, uniform, diffBytes,
      hashA: await digest(da), hashB: await digest(db), hashReread: await digest(daAgain), hashRereadB: await digest(dbAgain),
      solidTotal: 256,
    };
    try { out.dataUrlHashA = hashStr(a.toDataURL()); out.dataUrlHashB = hashStr(b.toDataURL()); } catch (e) { out.dataUrlError = errMsg(e); }
    try {
      const r = await withTimeout(decodeDiff(a, da), 1500, null);
      if (r) { out.decodedDiffPixels = r.diff; out.decodedTotal = r.total; }
    } catch (e) { out.decodeError = errMsg(e); }

    // Ô màu đặc: kết quả đúng phải chính xác tuyệt đối trên mọi máy
    const s = make(16, 16);
    const sc = s.getContext('2d', RF);
    sc.fillStyle = 'rgb(10,200,30)';
    sc.fillRect(0, 0, 16, 16);
    const sd = sc.getImageData(0, 0, 16, 16).data;
    let solidBad = 0;
    for (let i = 0; i < sd.length; i += 4) if (sd[i] !== 10 || sd[i + 1] !== 200 || sd[i + 2] !== 30 || sd[i + 3] !== 255) solidBad++;
    out.solidBadPixels = solidBad;
    out.roundTrip = canvasRoundTrip(seed);
    try { out.glyphRun = canvasGlyphRun(seed); } catch (e) { out.glyphRun = { error: errMsg(e) }; }

    // Cảnh hình học để so với OffscreenCanvas trong Worker
    const g = make();
    const gc = g.getContext('2d', RF);
    drawGeo(gc, seed, CW, CH);
    out.geoHash = await digest(gc.getImageData(0, 0, CW, CH).data);

    // Hash cố định (không theo seed) chỉ để QA so sánh giữa các phiên, không dùng làm bằng chứng
    const f = make();
    const fc = f.getContext('2d', RF);
    drawScene(fc, 0x5eed, CW, CH);
    out.fixedHash = await digest(fc.getImageData(0, 0, CW, CH).data);
    out.fingerprint = out.fixedHash;
    return out;
  }

  // ---------- WebGL ----------
  function renderGL(gl) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, 'attribute vec2 p;attribute vec3 c;varying vec3 v;void main(){v=c;gl_Position=vec4(p,0.,1.);}');
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, 'precision mediump float;varying vec3 v;void main(){gl_FragColor=vec4(v*0.9+0.05,1.);}');
    gl.compileShader(fs);
    const pr = gl.createProgram();
    gl.attachShader(pr, vs);
    gl.attachShader(pr, fs);
    gl.linkProgram(pr);
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.9, -0.8, 1, 0.2, 0.1, 0.85, -0.6, 0.1, 0.9, 0.3, -0.1, 0.9, 0.2, 0.3, 1]), gl.STATIC_DRAW);
    const pl = gl.getAttribLocation(pr, 'p');
    const cl = gl.getAttribLocation(pr, 'c');
    gl.enableVertexAttribArray(pl);
    gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(cl);
    gl.vertexAttribPointer(cl, 3, gl.FLOAT, false, 20, 8);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return digest(px);
  }

  function newGL(kind = 'webgl') {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    return c.getContext(kind, { preserveDrawingBuffer: true }) || (kind === 'webgl' ? c.getContext('experimental-webgl') : null);
  }
  const loseGL = (gl) => { try { const e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); } catch {} };
  const arr = (v) => (v && typeof v.length === 'number' ? Array.from(v) : v);

  function glInfo(gl) {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const P = (k) => { try { return gl.getParameter(k); } catch { return null; } };
    return {
      debugInfo: !!dbg,
      vendor: P(gl.VENDOR), renderer: P(gl.RENDERER),
      unmaskedVendor: dbg ? P(dbg.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: dbg ? P(dbg.UNMASKED_RENDERER_WEBGL) : null,
      version: P(gl.VERSION), shadingLanguage: P(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: P(gl.MAX_TEXTURE_SIZE), maxViewportDims: arr(P(gl.MAX_VIEWPORT_DIMS)),
    };
  }

  /**
   * Đáp án WebGL tuyệt đối: clearColor(0.2,0.4,0.6) phải đọc ra đúng 51/102/153 và shader tô (0,1,0)
   * phải ra 0/255/0. Noise chèn sau readPixels làm lệch ±1–2, và hay tràn số uint8 (0 → 255, 255 → 0).
   */
  function glTruth() {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return { supported: false };
    const N = 16 * 16;
    const check = (px, e) => {
      let bad = 0, maxDelta = 0, wrap = 0, alphaBad = 0;
      for (let i = 0; i < px.length; i += 4) {
        let b = false;
        for (let k = 0; k < 4; k++) {
          const d = Math.abs(px[i + k] - e[k]);
          if (!d) continue;
          b = true;
          if (d > maxDelta) maxDelta = d;
          if (d >= 128) wrap++;
          if (k === 3) alphaBad++;
        }
        if (b) bad++;
      }
      return { bad, maxDelta, wrap, alphaBad };
    };
    const read = () => { const px = new Uint8Array(N * 4); gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    gl.viewport(0, 0, 16, 16);
    gl.clearColor(0.2, 0.4, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const clear = check(read(), [51, 102, 153, 255]);
    const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float;void main(){gl_FragColor=vec4(0.,1.,0.,1.);}'));
    gl.linkProgram(pr);
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const l = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const solid = check(read(), [0, 255, 0, 255]);
    loseGL(gl);
    return { supported: true, total: N, clear, solid };
  }

  /**
   * Varying ↔ gl_FragCoord: quad toàn màn hình với v = p·0.5 + 0.5 thì tại tâm pixel v.x = gl_FragCoord.x / N
   * (cùng giá trị (i + 0.5)/N, 255·(2i+1)/2N không bao giờ rơi đúng .5 nên làm tròn không mơ hồ).
   * Ghi R = v.x, G = fragCoord.x/N (B, A cho trục y) ⇒ R = G, B = A ở mọi pixel. Antidetect làm nhiễu
   * gl_Position lúc link (GPM Login) làm lệch phép nội suy nhưng không chạm gl_FragCoord.
   */
  function glVarying() {
    const out = { cases: [] };
    for (const [kind, n] of [['webgl', 64], ['webgl', 100], ['webgl2', 32]]) {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const gl = c.getContext(kind, { preserveDrawingBuffer: true, antialias: false });
      if (!gl) continue;
      const v2 = kind === 'webgl2';
      const vs = v2 ? '#version 300 es\nin vec2 p;out vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}' : 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
      const fs = v2 ? `#version 300 es\nprecision highp float;in vec2 v;out vec4 o;void main(){o=vec4(v.x,gl_FragCoord.x/${n}.,v.y,gl_FragCoord.y/${n}.);}`
        : `precision highp float;varying vec2 v;void main(){gl_FragColor=vec4(v.x,gl_FragCoord.x/${n}.,v.y,gl_FragCoord.y/${n}.);}`;
      const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); return o; };
      const vso = sh(gl.VERTEX_SHADER, vs);
      const pr = gl.createProgram();
      gl.attachShader(pr, vso); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { loseGL(gl); continue; }
      gl.useProgram(pr);
      gl.viewport(0, 0, n, n);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const l = gl.getAttribLocation(pr, 'p');
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const px = new Uint8Array(n * n * 4);
      gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let off = 0, maxDelta = 0;
      for (let i = 0; i < px.length; i += 4) {
        const d = Math.max(Math.abs(px[i] - px[i + 1]), Math.abs(px[i + 2] - px[i + 3]));
        if (d) { off++; if (d > maxDelta) maxDelta = d; }
      }
      // ANGLE D3D: sau khi link + vẽ, shader gốc có thêm phần "COMPILER INPUT"; thiếu ⇒ chương trình thật là bản khác
      let compilerInput = null;
      try { const dbg = gl.getExtension('WEBGL_debug_shaders'); if (dbg) { const t = dbg.getTranslatedShaderSource(vso); if (/INITIAL HLSL/.test(t)) compilerInput = /COMPILER INPUT/.test(t); } } catch {}
      out.cases.push({ kind, n, off, of: n * n, maxDelta, compilerInput });
      loseGL(gl);
    }
    out.off = out.cases.reduce((s, c) => s + c.off, 0);
    out.of = out.cases.reduce((s, c) => s + c.of, 0);
    return out;
  }

  /**
   * Giới hạn uniform khai báo phải đúng là giới hạn thật: ANGLE từ chối link shader dùng nhiều hơn
   * MAX_VERTEX_UNIFORM_VECTORS / MAX_FRAGMENT_UNIFORM_VECTORS. Khai báo giả (GPM: 4095 cho GTX 960) vẫn link được 4096.
   */
  function glUniformLimit() {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const gl = c.getContext('webgl');
    if (!gl) return { supported: false };
    const link = (vsN, fsN) => {
      const v = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(v, vsN ? `uniform vec4 u[${vsN}];void main(){vec4 s=vec4(0.);for(int i=0;i<${vsN};i++)s+=u[i];gl_Position=s;}` : 'void main(){gl_Position=vec4(0.);}');
      gl.compileShader(v);
      const f = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(f, fsN ? `precision mediump float;uniform vec4 u[${fsN}];void main(){vec4 s=vec4(0.);for(int i=0;i<${fsN};i++)s+=u[i];gl_FragColor=s;}` : 'void main(){gl_FragColor=vec4(1.);}');
      gl.compileShader(f);
      if (!gl.getShaderParameter(v, gl.COMPILE_STATUS) || !gl.getShaderParameter(f, gl.COMPILE_STATUS)) return false;
      const p = gl.createProgram();
      gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
      return !!gl.getProgramParameter(p, gl.LINK_STATUS);
    };
    const mv = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS), mf = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
    const out = { supported: true, declaredVS: mv, declaredFS: mf };
    if (mv > 0 && mv <= 8192) { out.vsAtDeclared = link(mv, 0); out.vsAbove = link(mv + 1, 0); }
    if (mf > 0 && mf <= 8192) { out.fsAtDeclared = link(0, mf); out.fsAbove = link(0, mf + 1); }
    loseGL(gl);
    return out;
  }

  // ---------- WebGPU: subgroup size là thuộc tính phần cứng, antidetect đổi tên GPU nhưng không đổi được ----------
  async function webgpuProbe() {
    if (!navigator.gpu) return { supported: false };
    const ad = await withTimeout(navigator.gpu.requestAdapter(), 2000, null);
    if (!ad) return { supported: false, error: 'no adapter' };
    const i = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : {});
    return {
      supported: true, vendor: i.vendor || '', architecture: i.architecture || '', device: i.device || '', description: i.description || '',
      subgroupMinSize: i.subgroupMinSize ?? null, subgroupMaxSize: i.subgroupMaxSize ?? null, isFallback: !!(i.isFallbackAdapter || ad.isFallbackAdapter),
    };
  }

  async function webglProbe() {
    const gl = newGL();
    if (!gl) return { supported: false, error: 'no webgl context' };
    const P = (k) => { try { return gl.getParameter(k); } catch { return null; } };
    const out = {
      supported: true, ...glInfo(gl),
      maxRenderbufferSize: P(gl.MAX_RENDERBUFFER_SIZE), maxVertexAttribs: P(gl.MAX_VERTEX_ATTRIBS),
      maxVertexUniformVectors: P(gl.MAX_VERTEX_UNIFORM_VECTORS), maxFragmentUniformVectors: P(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      maxTextureImageUnits: P(gl.MAX_TEXTURE_IMAGE_UNITS), aliasedLineWidthRange: arr(P(gl.ALIASED_LINE_WIDTH_RANGE)),
      extensions: gl.getSupportedExtensions() || [],
    };
    try {
      const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      out.fragmentHighFloat = hp ? [hp.rangeMin, hp.rangeMax, hp.precision] : null;
    } catch {}
    out.extensionCount = out.extensions.length;
    try { out.truth = glTruth(); } catch (e) { out.truth = { error: errMsg(e) }; }
    try { out.varying = glVarying(); } catch (e) { out.varying = { error: errMsg(e) }; }
    try { out.uniformLimit = glUniformLimit(); } catch (e) { out.uniformLimit = { error: errMsg(e) }; }
    out.renderHashA = await renderGL(gl);
    loseGL(gl);
    const gl2 = newGL();
    out.renderHashB = gl2 ? await renderGL(gl2) : null;
    if (gl2) loseGL(gl2);
    try {
      const g2 = newGL('webgl2');
      out.webgl2 = g2 ? { supported: true, ...glInfo(g2) } : { supported: false };
      if (g2) loseGL(g2);
    } catch (e) { out.webgl2 = { supported: false, error: errMsg(e) }; }
    return out;
  }

  // ---------- Audio ----------
  async function audioProbe() {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return { supported: false, error: 'no OfflineAudioContext' };
    const render = async () => {
      const ctx = new OAC(1, 5000, 44100);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12; comp.attack.value = 0; comp.release.value = 0.25;
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      return ctx.startRendering();
    };
    const sum = (buf) => { const d = buf.getChannelData(0); let s = 0; for (let i = 4500; i < 5000; i++) s += Math.abs(d[i]); return s; };
    const bufA = await withTimeout(render(), 2500, null);
    const bufB = await withTimeout(render(), 2500, null);
    const out = { supported: true, sumA: bufA ? sum(bufA) : null, sumB: bufB ? sum(bufB) : null };
    if (bufA) {
      const viaGet = Float32Array.from(bufA.getChannelData(0));
      let allZero = true;
      for (let i = 0; i < viaGet.length; i++) if (viaGet[i] !== 0) { allZero = false; break; }
      out.allZero = allZero;
      if (bufA.copyFromChannel) {
        const viaCopy = new Float32Array(bufA.length);
        bufA.copyFromChannel(viaCopy, 0);
        let d = 0;
        for (let i = 0; i < viaCopy.length; i++) if (viaCopy[i] !== viaGet[i]) d++;
        out.channelCopyDiff = d;
      }
    }
    // Ghi dữ liệu biết trước vào AudioBuffer rồi đọc lại: phải giống hệt
    const ctx = new OAC(1, 128, 44100);
    const buf = ctx.createBuffer(1, 128, 44100);
    const src = new Float32Array(128);
    for (let i = 0; i < 128; i++) src[i] = Math.sin(i / 7) * 0.5;
    if (buf.copyToChannel) buf.copyToChannel(src, 0); else buf.getChannelData(0).set(src);
    const back = buf.getChannelData(0);
    let copyDiff = 0;
    for (let i = 0; i < 128; i++) if (back[i] !== src[i]) copyDiff++;
    out.copyDiff = copyDiff;
    out.fingerprint = out.sumA == null ? null : out.sumA.toFixed(8);
    try { out.invariants = await withTimeout(audioInvariants(OAC), 4000, { error: 'timeout' }); } catch (e) { out.invariants = { error: errMsg(e) }; }
    return out;
  }

  /**
   * Phép bất biến của Web Audio (đúng tuyệt đối trên engine thật, không cần baseline):
   * - gain 0.5 là phép nhân chính xác: osc→gain(0.5) = 0.5 × osc
   * - 2 oscillator giống hệt cộng lại = 2 × osc
   * - render dài gấp đôi: N mẫu đầu trùng nhau (xử lý theo khối 128 mẫu, tất định)
   * - AnalyserNode / AudioWorklet thấy đúng tín hiệu đi qua graph = buffer đầu ra
   */
  async function audioInvariants(OAC) {
    const R = 44100, N = 4096;
    const render = (len, setup) => { const c = new OAC(1, len, R); setup(c); return withTimeout(c.startRendering(), 2500, null); };
    const osc = (c) => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 1000; o.start(0); return o; };
    const diff = (a, b, f) => { if (!a || !b) return null; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== f(b[i])) n++; return n; };
    const ch = (b) => (b ? b.getChannelData(0) : null);
    const id = (x) => x;
    const A = ch(await render(N, (c) => osc(c).connect(c.destination)));
    if (!A) return { error: 'render timeout' };
    const out = { samples: N };
    out.gainHalf = diff(ch(await render(N, (c) => { const g = c.createGain(); g.gain.value = 0.5; osc(c).connect(g); g.connect(c.destination); })), A, (x) => Math.fround(x * 0.5));
    out.twoOscSum = diff(ch(await render(N, (c) => { osc(c).connect(c.destination); osc(c).connect(c.destination); })), A, (x) => Math.fround(x * 2));
    const L2 = ch(await render(N * 2, (c) => osc(c).connect(c.destination)));
    out.prefix = L2 ? diff(L2.subarray(0, N), A, id) : null;
    // f = sampleRate/64: bước pha là số nhị phân chính xác nên oscillator thật tuần hoàn tuyệt đối (mẫu n = mẫu n+64).
    // Noise cộng theo từng mẫu bên trong OscillatorNode (Dolphin Anty) giữ được các phép tuyến tính ở trên nhưng phá tính tuần hoàn.
    for (const [k, type] of [['periodicSine', 'sine'], ['periodicTriangle', 'triangle']]) {
      const P = ch(await render(N, (c) => { const o = c.createOscillator(); o.type = type; o.frequency.value = R / 64; o.start(0); o.connect(c.destination); }));
      if (P) { let n = 0; for (let i = 0; i + 64 < N; i++) if (P[i] !== P[i + 64]) n++; out[k] = n; }
    }
    // Bảng sóng (wavetable) của OscillatorNode: phản đối xứng tuyệt đối (mẫu n = −mẫu n+32 khi chu kỳ 64)
    // và đỉnh chuẩn hoá đúng 1.0 ở 1/4 chu kỳ. Antidetect làm nhiễu sẵn wavetable thì vẫn tuần hoàn/tuyến tính
    // nhưng mất đối xứng này.
    for (const [k, type] of [['waveAntiSine', 'sine'], ['waveAntiTriangle', 'triangle'], ['waveAntiSquare', 'square']]) {
      const P = ch(await render(256, (c) => { const o = c.createOscillator(); o.type = type; o.frequency.value = R / 64; o.start(0); o.connect(c.destination); }));
      if (!P) continue;
      let n = 0;
      for (let i = 0; i < 64; i++) if (P[i] !== -P[i + 32]) n++;
      out[k] = n;
      if (type === 'sine') out.wavePeak = P[16];
    }
    try {
      const c = new OAC(1, N, R), an = c.createAnalyser();
      an.fftSize = 2048;
      osc(c).connect(an); an.connect(c.destination);
      const td = new Float32Array(2048);
      c.suspend(2048 / R).then(() => { an.getFloatTimeDomainData(td); c.resume(); });
      const buf = ch(await withTimeout(c.startRendering(), 2500, null));
      out.analyser = buf ? diff(td, buf.subarray(0, 2048), id) : null;
    } catch (e) { out.analyserError = errMsg(e); }
    try {
      const c = new OAC(1, N, R);
      if (c.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        const src = `class Cap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(${N});this.n=0}process(i,o){const x=i[0]&&i[0][0];if(x){o[0][0].set(x);if(this.n<${N}){this.b.set(x.subarray(0,Math.min(x.length,${N}-this.n)),this.n);this.n+=x.length;if(this.n>=${N})this.port.postMessage(this.b)}}return true}}registerProcessor('sfp-cap',Cap);`;
        const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        await withTimeout(c.audioWorklet.addModule(url), 1500, null);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(c, 'sfp-cap');
        const got = new Promise((res) => { node.port.onmessage = (e) => res(e.data); });
        osc(c).connect(node); node.connect(c.destination);
        const buf = ch(await withTimeout(c.startRendering(), 2500, null));
        const cap = await withTimeout(got, 1000, null);
        if (buf && cap) { out.workletIn = diff(cap, A, id); out.workletOut = diff(buf, cap, id); }
      }
    } catch (e) { out.workletError = errMsg(e); }
    return out;
  }

  // ---------- Fonts ----------
  const FONT_SETS = {
    windows: ['Segoe UI', 'Calibri', 'Consolas', 'Tahoma', 'Cambria'],
    mac: ['Helvetica Neue', 'Menlo', 'Avenir', 'Geneva', 'Apple Chancery'],
    linux: ['DejaVu Sans', 'Liberation Sans', 'Ubuntu', 'Cantarell'],
  };
  const EMOJI_FONTS = ['Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji'];
  const BASES = ['monospace', 'serif', 'sans-serif'];
  const TEXT = 'mmmmmmmmmlli1WQ@#';
  const EMOJI_TEXT = '0123456789#*';

  function fontsProbe() {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (!ctx) return { supported: false };
    const cw = (font, text) => { ctx.font = font; return ctx.measureText(text).width; };
    const detectCanvas = (f, text = TEXT) => BASES.some((b) => cw(`72px "${f}", ${b}`, text) !== cw(`72px ${b}`, text));

    // Đường đo thứ 2: <span> DOM
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap';
    document.body.appendChild(host);
    const span = document.createElement('span');
    span.style.fontSize = '72px';
    span.textContent = TEXT;
    host.appendChild(span);
    const baseDom = BASES.map((b) => { span.style.fontFamily = b; return [span.offsetWidth, span.offsetHeight]; });
    const detectDom = (f) => BASES.some((b, i) => {
      span.style.fontFamily = `"${f}", ${b}`;
      return span.offsetWidth !== baseDom[i][0] || span.offsetHeight !== baseDom[i][1];
    });

    const found = {}, foundDom = {};
    for (const [os, list] of Object.entries(FONT_SETS)) {
      found[os] = list.filter((f) => detectCanvas(f));
      foundDom[os] = list.filter((f) => detectDom(f));
    }
    const emoji = EMOJI_FONTS.filter((f) => detectCanvas(f, EMOJI_TEXT));

    // Đo lặp lại cùng chuỗi: phải ra cùng số
    const mtext = 'The quick brown fox \u{1F98A} jumps 0123';
    span.style.fontFamily = 'sans-serif';
    span.style.fontSize = '20px';
    span.textContent = mtext;
    const dom = [span.getBoundingClientRect().width, span.getBoundingClientRect().width];
    ctx.font = '20px sans-serif';
    const canvas = [ctx.measureText(mtext).width, ctx.measureText(mtext).width];
    host.remove();

    const checkApi = {};
    try { for (const f of ['Segoe UI', 'Helvetica Neue', 'DejaVu Sans']) checkApi[f] = document.fonts.check(`16px "${f}"`); } catch {}
    return { supported: true, found, foundDom, emoji, metrics: { dom, canvas }, checkApi };
  }

  // ---------- ClientRects ----------
  /**
   * Hộp có toạ độ/kích thước là bội số 0.25 px: Blink lưu layout theo LayoutUnit 1/64 px nên
   * getBoundingClientRect phải trả đúng số đã đặt (kể cả khi DPR = 1.25/1.5/1.75/2).
   * Noise ClientRects cộng sai số nhỏ (thường dạng float32 như 100.25499725…) vào một số giá trị.
   */
  function rectsProbe(seed) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;margin:0;padding:0;border:0;visibility:hidden;pointer-events:none;overflow:hidden;transform:none';
    document.body.appendChild(host);
    const r = rng((seed ^ 0x7f4a7c15) >>> 0);
    const q = (max) => Math.round(r() * max * 4) / 4;
    const props = ['x', 'y', 'width', 'height', 'right', 'bottom'];
    const byProp = { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };
    const samples = [];
    let checked = 0, off = 0, maxDelta = 0;
    const boxes = [];
    for (let i = 0; i < 32; i++) {
      const L = q(600), T = q(500), W = 5 + q(150), H = 3 + q(80);
      const e = document.createElement('div');
      e.style.cssText = `position:absolute;margin:0;padding:0;border:0;box-sizing:border-box;left:${L}px;top:${T}px;width:${W}px;height:${H}px`;
      host.appendChild(e);
      boxes.push([e, { x: L, y: T, width: W, height: H, right: L + W, bottom: T + H }]);
    }
    for (const [e, exp] of boxes) {
      const b = e.getBoundingClientRect();
      for (const p of props) {
        checked++;
        if (b[p] === exp[p]) continue;
        off++; byProp[p]++;
        const d = Math.abs(b[p] - exp[p]);
        if (d > maxDelta) maxDelta = d;
        if (samples.length < 6) samples.push([p, exp[p], b[p]]);
      }
    }
    host.remove();
    const dpr = window.devicePixelRatio, vv = window.visualViewport ? window.visualViewport.scale : 1;
    return { supported: true, checked, off, maxDelta, byProp, samples, dpr, vvScale: vv };
  }

  // ---------- WebRTC ----------
  const parseCandidate = (c) => {
    const p = String(c).split(' ');
    const out = { protocol: p[2], address: p[4], port: p[5], type: p[7], raw: c };
    const ri = p.indexOf('raddr');
    if (ri > 0) out.raddr = p[ri + 1];
    const rp = p.indexOf('rport');
    if (rp > 0) out.rport = p[rp + 1];
    const ui = p.indexOf('ufrag');
    if (ui > 0) out.ufrag = p[ui + 1];
    return out;
  };

  // Một lần gather ICE trên constructor PC (window chính hoặc iframe realm sạch)
  async function gatherIce(PC, iceServers, timeoutMs) {
    const t0 = performance.now();
    const pc = new PC({ iceServers });
    const cands = [], fields = [], states = [];
    let tFirst = null, tSrflx = null;
    const done = new Promise((res) => {
      pc.onicecandidate = (e) => {
        if (!e.candidate) return res('complete');
        const c = e.candidate;
        if (!c.candidate) return;
        const t = Math.round(performance.now() - t0);
        if (tFirst === null) tFirst = t;
        cands.push(c.candidate);
        // Field của RTCIceCandidate do trình duyệt parse native: antidetect sửa chuỗi candidate hay quên đồng bộ
        try { fields.push({ address: c.address ?? null, port: c.port ?? null, type: c.type ?? null, relatedAddress: c.relatedAddress ?? null, protocol: c.protocol ?? null }); } catch { fields.push(null); }
        if (/ typ srflx /.test(c.candidate) && tSrflx === null) tSrflx = t;
      };
      pc.onicegatheringstatechange = () => {
        states.push(pc.iceGatheringState);
        if (pc.iceGatheringState === 'complete') res('complete');
      };
    });
    pc.createDataChannel('sfp');
    await pc.setLocalDescription(await pc.createOffer());
    let ufrag = null;
    try { const m = /a=ice-ufrag:(\S+)/.exec(pc.localDescription.sdp); ufrag = m && m[1]; } catch {}
    const state = await withTimeout(done, timeoutMs, 'timeout');
    // Chờ thêm một nhịp cho candidate cuối kịp ghi vào localDescription
    await new Promise((r) => setTimeout(r, 50));
    let sdpCandidates = null;
    try {
      sdpCandidates = (pc.localDescription && pc.localDescription.sdp || '').split(/\r?\n/)
        .filter((l) => l.startsWith('a=candidate:')).map((l) => l.slice(2));
    } catch {}
    const gatheringState = (() => { try { return pc.iceGatheringState; } catch { return null; } })();
    try { pc.close(); } catch {}
    return {
      state, gatheringState, gatheringEvents: states, ufrag, ms: Math.round(performance.now() - t0), tFirst, tSrflx,
      candidates: cands.map((c, i) => ({ ...parseCandidate(c), fields: fields[i] })),
      sdpCandidates,
    };
  }

  async function webrtcProbe(stun, ground) {
    const PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!PC) return { supported: false, error: 'no RTCPeerConnection' };
    // Mỗi STUN server là một URL riêng: NAT thật trả cùng IP public cho mọi server
    const stunServers = stun && stun.length ? stun.map((u) => ({ urls: u })) : [];
    // STUN/TURN của chính site (VPS): server thấy IP nguồn thật của gói UDP, không phụ thuộc candidate JS báo
    const iceServers = stunServers.concat(Array.isArray(ground) ? ground : []);
    const TIMEOUT = 6000;

    // Lượt 2 trong iframe about:blank: antidetect hook ở tầng JS thường chỉ vá window chính
    let frame = null, framePC = null;
    try {
      frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.setAttribute('aria-hidden', 'true');
      document.body.appendChild(frame);
      framePC = frame.contentWindow.RTCPeerConnection || null;
    } catch {}

    const [main, realm] = await Promise.all([
      gatherIce(PC, iceServers, TIMEOUT),
      framePC ? gatherIce(framePC, iceServers, TIMEOUT).catch((e) => ({ error: errMsg(e) })) : Promise.resolve(null),
    ]);
    try { frame && frame.remove(); } catch {}

    let camera = null;
    try { camera = (await withTimeout(navigator.permissions.query({ name: 'camera' }), 500, { state: null })).state; } catch {}

    const { candidates, state, ...rest } = main;
    return {
      supported: true, state, candidates, ...rest,
      stunServers: stunServers.length, groundServers: Array.isArray(ground) ? ground.length : 0, timeoutMs: TIMEOUT, cameraPermission: camera,
      iframe: realm && (realm.error ? realm : {
        state: realm.state, gatheringState: realm.gatheringState, ms: realm.ms, ufrag: realm.ufrag,
        candidates: realm.candidates.map(({ fields, ...c }) => c),
      }),
    };
  }

  // IP đi ra Internet thật sự (qua proxy của trình duyệt). Chỉ chạy khi server thấy IP nội bộ, ví dụ scan ở localhost.
  async function egressProbe(urls) {
    if (!urls || !urls.length) return { skipped: true };
    const one = async (url) => {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctl && ctl.abort(), 4000);
      try {
        const r = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl && ctl.signal });
        const text = (await r.text()).trim();
        let ip = text;
        try { const j = JSON.parse(text); ip = j.ip || j.query || j.address || ''; } catch {}
        ip = String(ip).trim();
        if (!/^[0-9a-f:.]{3,45}$/i.test(ip)) return { url, error: 'không parse được IP' };
        return { url, ip };
      } catch (e) {
        return { url, error: errMsg(e) };
      } finally { clearTimeout(timer); }
    };
    const results = await Promise.all(urls.slice(0, 4).map(one));
    return { results, ips: [...new Set(results.filter((r) => r.ip).map((r) => r.ip))] };
  }

  // ---------- Worker (antidetect hay bỏ sót) ----------
  const WORKER_SRC = `${GEO_SRC}
async function digest(bytes){try{const b=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(b).slice(0,8),x=>x.toString(16).padStart(2,'0')).join('');}catch(e){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193);}return (h>>>0).toString(16).padStart(8,'0');}}
self.onmessage=async(ev)=>{const {seed,w,h}=ev.data;const n=self.navigator;const o={userAgent:n.userAgent,platform:n.platform,
hardwareConcurrency:n.hardwareConcurrency,deviceMemory:n.deviceMemory===undefined?null:n.deviceMemory,language:n.language,
languages:Array.from(n.languages||[]),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,tzOffset:-new Date().getTimezoneOffset()};
try{if(n.userAgentData){o.uaBrands=n.userAgentData.brands.map(b=>b.brand+'/'+b.version);o.uaPlatform=n.userAgentData.platform;o.uaMobile=n.userAgentData.mobile;}}catch(e){}
if(typeof OffscreenCanvas!=='undefined'){
try{const c=new OffscreenCanvas(w,h).getContext('2d',{willReadFrequently:true});if(c){drawGeo(c,seed,w,h);o.canvas2d=await digest(c.getImageData(0,0,w,h).data);}}catch(e){o.canvasError=String(e)}
try{const gl=new OffscreenCanvas(16,16).getContext('webgl');if(gl){const d=gl.getExtension('WEBGL_debug_renderer_info');
o.webglVendor=d?gl.getParameter(d.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR);o.webglRenderer=d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);}}catch(e){o.webglError=String(e)}}
self.postMessage(o);};`;

  function workerProbe(seed) {
    if (typeof Worker === 'undefined') return Promise.resolve({ supported: false, error: 'no Worker' });
    return new Promise((resolve) => {
      let url, w, settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        try { w && w.terminate(); } catch {}
        try { url && URL.revokeObjectURL(url); } catch {}
        resolve(v);
      };
      try {
        url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
        w = new Worker(url);
        w.onmessage = (e) => finish({ supported: true, ...e.data });
        w.onerror = (e) => finish({ supported: false, error: errMsg(e.message || e) });
        w.postMessage({ seed, w: CW, h: CH });
        setTimeout(() => finish({ supported: false, error: 'timeout' }), 3000);
      } catch (e) {
        finish({ supported: false, error: errMsg(e) });
      }
    });
  }

  // ---------- iframe about:blank (realm sạch) ----------
  function iframeProbe() {
    const f = document.createElement('iframe');
    f.style.display = 'none';
    f.setAttribute('aria-hidden', 'true');
    document.body.appendChild(f);
    const w = f.contentWindow;
    const n = w.navigator;
    const data = {
      userAgent: n.userAgent, platform: n.platform, hardwareConcurrency: n.hardwareConcurrency,
      deviceMemory: n.deviceMemory === undefined ? null : n.deviceMemory, languages: Array.from(n.languages || []),
      webdriver: n.webdriver, screenWidth: w.screen.width, screenHeight: w.screen.height,
      timeZone: new w.Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    return { data, realm: w, cleanup: () => f.remove() };
  }

  // ---------- phát hiện override API bằng JS ----------
  const TARGETS = [
    ['Navigator.prototype', 'userAgent', 'get'], ['Navigator.prototype', 'platform', 'get'],
    ['Navigator.prototype', 'hardwareConcurrency', 'get'], ['Navigator.prototype', 'deviceMemory', 'get'],
    ['Navigator.prototype', 'languages', 'get'], ['Navigator.prototype', 'language', 'get'],
    ['Navigator.prototype', 'webdriver', 'get'], ['Navigator.prototype', 'maxTouchPoints', 'get'],
    ['Navigator.prototype', 'vendor', 'get'], ['Navigator.prototype', 'plugins', 'get'],
    ['Navigator.prototype', 'userAgentData', 'get'],
    ['Screen.prototype', 'width', 'get'], ['Screen.prototype', 'height', 'get'],
    ['Screen.prototype', 'colorDepth', 'get'], ['Screen.prototype', 'availWidth', 'get'],
    ['HTMLCanvasElement.prototype', 'toDataURL', 'value'], ['HTMLCanvasElement.prototype', 'toBlob', 'value'],
    ['HTMLCanvasElement.prototype', 'getContext', 'value'],
    ['CanvasRenderingContext2D.prototype', 'getImageData', 'value'], ['CanvasRenderingContext2D.prototype', 'measureText', 'value'],
    ['CanvasRenderingContext2D.prototype', 'fillText', 'value'],
    ['OffscreenCanvasRenderingContext2D.prototype', 'getImageData', 'value'],
    ['WebGLRenderingContext.prototype', 'getParameter', 'value'], ['WebGLRenderingContext.prototype', 'readPixels', 'value'],
    ['WebGLRenderingContext.prototype', 'getExtension', 'value'], ['WebGLRenderingContext.prototype', 'getSupportedExtensions', 'value'],
    ['WebGL2RenderingContext.prototype', 'getParameter', 'value'],
    ['Date.prototype', 'getTimezoneOffset', 'value'], ['Intl.DateTimeFormat.prototype', 'resolvedOptions', 'value'],
    ['AudioBuffer.prototype', 'getChannelData', 'value'], ['AudioBuffer.prototype', 'copyFromChannel', 'value'],
    ['AnalyserNode.prototype', 'getFloatFrequencyData', 'value'], ['OfflineAudioContext.prototype', 'startRendering', 'value'],
    ['Element.prototype', 'getBoundingClientRect', 'value'],
    ['RTCPeerConnection.prototype', 'createOffer', 'value'], ['RTCPeerConnection.prototype', 'setLocalDescription', 'value'],
    ['RTCPeerConnection.prototype', 'createDataChannel', 'value'],
  ];
  const CTORS = ['RTCPeerConnection'];
  const resolvePath = (path, root) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), root);

  // Gọi hàm với `this` sai bên trong một frame có tên cố định để đếm frame wrapper chèn giữa
  function sfpInvokeMarker(fn) {
    return fn.call(Object.create(null));
  }
  function framesAbove(stack) {
    const lines = String(stack || '').split('\n').filter((l) => /^\s*at\s|@/.test(l));
    const i = lines.findIndex((l) => l.includes('sfpInvokeMarker'));
    if (i < 0) return null;
    // Builtin ECMAScript của V8 hiện frame "at Date.getTimezoneOffset (<anonymous>)" không có dòng:cột,
    // SpiderMonkey có "self-hosted": chỉ đếm frame có vị trí mã nguồn thật (wrapper JS)
    return lines.slice(0, i).filter((l) => /:\d+:\d+\)?\s*$/.test(l) && !/self-hosted/.test(l)).length;
  }

  function inspectFn(fn, name, kind, mainToString, crossToString) {
    let mainStr = '', crossStr = null;
    try { mainStr = mainToString.call(fn); } catch (e) { mainStr = 'ERR:' + errMsg(e); }
    if (crossToString) { try { crossStr = crossToString.call(fn); } catch (e) { crossStr = 'ERR:' + errMsg(e); } }
    const r = {
      name, kind,
      nativeMain: NATIVE_RE.test(mainStr),
      nativeCross: crossStr == null ? null : NATIVE_RE.test(crossStr),
      toStringHasName: !!fn.name && mainStr.includes('function ' + fn.name + '('),
      hasPrototype: Object.prototype.hasOwnProperty.call(fn, 'prototype'),
      ownArguments: Object.prototype.hasOwnProperty.call(fn, 'arguments') || Object.prototype.hasOwnProperty.call(fn, 'caller'),
      length: fn.length,
      fnName: fn.name,
    };
    if (kind !== 'ctor') {
      try {
        const ret = sfpInvokeMarker(fn);
        if (ret && typeof ret.then === 'function') { ret.then(null, () => {}); r.illegalInvocation = null; }
        else r.illegalInvocation = false;
      } catch (e) {
        r.illegalInvocation = !!e && e.name === 'TypeError';
        r.extraFrames = framesAbove(e && e.stack);
      }
    }
    if (!r.nativeMain || r.nativeCross === false || !r.toStringHasName) r.source = (crossStr || mainStr).slice(0, 160);
    return r;
  }

  function tamperProbe(realm) {
    const mainToString = Function.prototype.toString;
    const crossToString = realm ? realm.Function.prototype.toString : null;
    const targets = [];
    for (const [objPath, prop, kind] of TARGETS) {
      const proto = resolvePath(objPath, window);
      if (!proto) continue;
      const name = objPath.replace('.prototype', '') + '.' + prop;
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc) continue;
      const fn = kind === 'get' ? desc.get : desc.value;
      if (typeof fn !== 'function') { targets.push({ name, kind, notFunction: true }); continue; }
      targets.push(inspectFn(fn, name, kind, mainToString, crossToString));
    }
    for (const c of CTORS) {
      const fn = window[c];
      if (typeof fn === 'function') targets.push(inspectFn(fn, c, 'ctor', mainToString, crossToString));
    }
    let toStringCross = null;
    if (crossToString) { try { toStringCross = NATIVE_RE.test(crossToString.call(mainToString)); } catch { toStringCross = false; } }
    const selfStr = (() => { try { return mainToString.call(mainToString); } catch { return ''; } })();
    return {
      targets,
      toStringNative: NATIVE_RE.test(selfStr),
      toStringProxy: !selfStr.includes('function toString('),
      toStringCross,
      navigatorOwnProps: Object.getOwnPropertyNames(navigator),
      screenOwnProps: Object.getOwnPropertyNames(screen),
    };
  }

  // ---------- automation ----------
  async function automationProbe() {
    const re = /^(\$?cdc_|__webdriver|__selenium|__driver|__fxdriver|_selenium|calledSelenium|_Selenium_IDE|__playwright|__pw|__puppeteer|_phantom|callPhantom|__nightmare|domAutomation)/;
    let globals = [], docKeys = [];
    try { globals = Object.getOwnPropertyNames(window).filter((k) => re.test(k)); } catch {}
    try { docKeys = Object.getOwnPropertyNames(document).filter((k) => re.test(k)); } catch {}

    // CDP: khi Runtime.enable bật, console.debug tuần tự hóa Error và gọi getter `stack`
    let cdpLeak = null;
    try {
      let touched = false;
      const e = new Error('sfp');
      Object.defineProperty(e, 'stack', { configurable: true, get() { touched = true; return ''; } });
      console.debug(e);
      await new Promise((r) => setTimeout(r, 0));
      cdpLeak = touched;
    } catch {}

    const notification = {};
    try { notification.permission = typeof Notification !== 'undefined' ? Notification.permission : null; } catch {}
    try { notification.query = (await withTimeout(navigator.permissions.query({ name: 'notifications' }), 800, { state: null })).state; } catch {}

    return {
      webdriver: navigator.webdriver, suspiciousGlobals: globals.concat(docKeys),
      headlessUA: /HeadlessChrome/.test(navigator.userAgent),
      outerZero: window.outerWidth === 0 && window.outerHeight === 0,
      cdpLeak, notification,
    };
  }

  // ---------- chạy toàn bộ ----------
  async function run(challenge, onStep) {
    const t0 = performance.now();
    const errors = [];
    const timings = {};
    const step = async (name, fn) => {
      const s = performance.now();
      if (onStep) try { onStep(name); } catch {}
      try {
        return await fn();
      } catch (e) {
        errors.push({ module: name, message: errMsg(e) });
        return { supported: false, error: errMsg(e) };
      } finally {
        timings[name] = Math.round(performance.now() - s);
      }
    };

    // Phép thử bất đồng bộ chạy song song
    const pWebrtc = step('webrtc', () => webrtcProbe(challenge.stun, challenge.ground));
    const pEgress = step('egress', () => egressProbe(challenge.ipEcho));
    const pWorker = step('worker', () => workerProbe(challenge.seed));
    const pUAData = step('uaData', () => collectUAData());
    const pAudio = step('audio', () => audioProbe());
    const pWebgpu = step('webgpu', () => webgpuProbe());

    let frame = null;
    const iframe = await step('iframe', () => { frame = iframeProbe(); return frame.data; });
    const data = {
      probeVersion: VERSION,
      nonce: challenge.nonce,
      navigator: await step('navigator', collectNavigator),
      engine: await step('engine', collectEngine),
      screen: await step('screen', collectScreen),
      locale: await step('locale', collectLocale),
      canvas: await step('canvas', () => canvasProbe(challenge.seed)),
      webgl: await step('webgl', webglProbe),
      fonts: await step('fonts', fontsProbe),
      rects: await step('rects', () => rectsProbe(challenge.seed)),
      tamper: await step('tamper', () => tamperProbe(frame && frame.realm)),
      automation: await step('automation', automationProbe),
      iframe,
    };
    if (frame) frame.cleanup();
    data.uaData = await pUAData;
    data.audio = await pAudio;
    data.webgpu = await pWebgpu;
    data.worker = await pWorker;
    data.webrtc = await pWebrtc;
    data.egress = await pEgress;
    data.timings = timings;
    data.errors = errors;
    data.durationMs = Math.round(performance.now() - t0);
    data.clientTime = Date.now();
    return data;
  }

  async function verify(opts = {}) {
    const base = opts.endpoint || '';
    const chRes = await fetch(base + '/api/challenge', { credentials: 'include', cache: 'no-store' });
    if (!chRes.ok) throw new Error('Không lấy được challenge (' + chRes.status + ')');
    const challenge = await chRes.json();
    const data = await run(challenge, opts.onStep);
    const res = await fetch(base + '/api/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce: challenge.nonce, label: opts.label || null, data }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || 'Verify thất bại (' + res.status + ')');
    return body;
  }

  window.SentinelFP = { version: VERSION, run, verify };
  window.BrowserGuard = window.SentinelFP; // tương thích tích hợp cũ
})();
