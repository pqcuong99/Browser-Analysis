/*
 * Noise Lab core: hàm dùng chung cho main thread, iframe và Web Worker.
 * Mọi phép thử ở đây đều có "đáp án đúng" tính trước được (ground truth),
 * nên không cần profile sạch để so: lệch khỏi đáp án = có noise ở đường đọc đó.
 */
(function (G) {
  'use strict';

  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  async function sha(view) {
    try { return hex(await crypto.subtle.digest('SHA-256', view)).slice(0, 16); }
    catch {
      const u = new Uint8Array(view.buffer || view, view.byteOffset || 0, view.byteLength);
      let h = 0x811c9dc5;
      for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); }
      return 'fnv' + (h >>> 0).toString(16).padStart(8, '0');
    }
  }
  const shaStr = (s) => sha(new TextEncoder().encode(s));

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function solidArr(w, h, rgba) {
    const a = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < a.length; i += 4) { a[i] = rgba[0]; a[i + 1] = rgba[1]; a[i + 2] = rgba[2]; a[i + 3] = rgba[3]; }
    return a;
  }
  /** Ảnh ngẫu nhiên, alpha = 255 (đục) để không mất dữ liệu vì premultiplied alpha */
  function randomOpaque(w, h, seed) {
    const r = rng(seed);
    const a = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < a.length; i += 4) { a[i] = (r() * 256) | 0; a[i + 1] = (r() * 256) | 0; a[i + 2] = (r() * 256) | 0; a[i + 3] = 255; }
    return a;
  }
  /** 4 ô màu đặc biên nguyên: không có anti-alias nên kết quả đúng tuyệt đối */
  const QUAD = [[220, 20, 60, 255], [30, 144, 255, 255], [50, 205, 50, 255], [255, 215, 0, 255]];
  function quadArr(w, h) {
    const a = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const q = QUAD[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)];
      a.set(q, (y * w + x) * 4);
    }
    return a;
  }
  function drawQuad(ctx, w, h) {
    QUAD.forEach((q, i) => {
      ctx.fillStyle = `rgb(${q[0]},${q[1]},${q[2]})`;
      ctx.fillRect((i % 2) * (w / 2), (i >> 1) * (h / 2), w / 2, h / 2);
    });
  }

  function topHist(h, n = 8) {
    return Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, n).map(([d, c]) => `${d > 0 ? '+' : ''}${d}:${c}`).join(' ');
  }

  /** So từng byte RGBA với đáp án: bao nhiêu pixel bị đổi, đổi bao nhiêu, kênh nào */
  function diffStats(obs, truth, w) {
    const n = Math.min(obs.length, truth.length);
    let px = 0, bytes = 0, maxDelta = 0, sum = 0;
    const ch = [0, 0, 0, 0], hist = {}, firstXY = [];
    for (let i = 0; i < n; i += 4) {
      let changed = false;
      for (let k = 0; k < 4; k++) {
        const d = obs[i + k] - truth[i + k];
        if (!d) continue;
        bytes++; ch[k]++; changed = true; sum += d;
        const ad = Math.abs(d);
        if (ad > maxDelta) maxDelta = ad;
        hist[d] = (hist[d] || 0) + 1;
      }
      if (changed) { px++; if (firstXY.length < 6) firstXY.push([(i / 4) % w, Math.floor(i / 4 / w)]); }
    }
    return {
      ok: px === 0 && obs.length === truth.length,
      totalPx: n / 4, changedPx: px, ratio: +(px / (n / 4 || 1)).toFixed(5), changedBytes: bytes, maxDelta,
      meanDelta: bytes ? +(sum / bytes).toFixed(3) : 0, channels: ch.join('/'), hist: topHist(hist), firstXY,
      lengthMismatch: obs.length !== truth.length || undefined,
    };
  }

  function flipY(px, w, h) {
    const out = new Uint8Array(px.length), row = w * 4;
    for (let y = 0; y < h; y++) out.set(px.subarray(y * row, (y + 1) * row), (h - 1 - y) * row);
    return out;
  }

  // ---------- PNG decoder tối giản: đọc thẳng pixel của toDataURL/toBlob, KHÔNG đi qua getImageData ----------
  async function inflate(parts) {
    const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function decodePNG(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let p = 8, w = 0, h = 0, depth = 0, ct = 0, il = 0;
    const idat = [];
    while (p + 8 <= u.length) {
      const len = dv.getUint32(p);
      const type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]);
      if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = u[p + 16]; ct = u[p + 17]; il = u[p + 20]; }
      else if (type === 'IDAT') idat.push(u.subarray(p + 8, p + 8 + len));
      else if (type === 'IEND') break;
      p += 12 + len;
    }
    const chans = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
    if (depth !== 8 || il !== 0 || !chans) throw new Error(`png unsupported depth=${depth} ct=${ct} il=${il}`);
    const raw = await inflate(idat);
    const stride = w * chans, out = new Uint8ClampedArray(w * h * 4);
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
      const base = y * (stride + 1), f = raw[base];
      for (let i = 0; i < stride; i++) {
        const a = i >= chans ? cur[i - chans] : 0, b = prev[i], c = i >= chans ? prev[i - chans] : 0;
        let x = raw[base + 1 + i];
        if (f === 1) x += a;
        else if (f === 2) x += b;
        else if (f === 3) x += (a + b) >> 1;
        else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        cur[i] = x & 255;
      }
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, s = x * chans;
        if (chans === 4) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
        else if (chans === 3) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
        else if (chans === 2) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
        else { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
      }
      const t = prev; prev = cur; cur = t;
    }
    return { w, h, data: out, colorType: ct };
  }
  function dataUrlBytes(url) {
    const b = atob(url.slice(url.indexOf(',') + 1));
    const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  /** Pixel của canvas qua đường mã hoá PNG (toDataURL / toBlob / convertToBlob) */
  async function encodedPixels(canvas, via) {
    if (via === 'toDataURL') return decodePNG(dataUrlBytes(canvas.toDataURL('image/png')));
    if (via === 'toBlob') {
      const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png'));
      return decodePNG(await blob.arrayBuffer());
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return decodePNG(await blob.arrayBuffer());
  }
  const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String((e && e.message) || e).slice(0, 200) }; } };

  // ---------- Canvas 2D ----------
  const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

  /**
   * Ghi pixel biết trước bằng putImageData rồi đọc lại bằng mọi đường.
   * Canvas thật: putImageData → getImageData là bản sao chính xác (ảnh đục).
   */
  async function canvasPutGet(makeCanvas, w, h, seed, encoders) {
    const truth = randomOpaque(w, h, seed);
    const c = makeCanvas(w, h), x = ctx2d(c);
    const img = x.createImageData(w, h);
    img.data.set(truth);
    x.putImageData(img, 0, 0);
    const read1 = x.getImageData(0, 0, w, h).data;
    const read2 = x.getImageData(0, 0, w, h).data;
    const out = { getImageData: diffStats(read1, truth, w), rereadSame: (await sha(read1)) === (await sha(read2)), readHash: await sha(read1) };
    // canvas thứ 2 cùng nội dung: noise theo canvas hay theo nội dung?
    const c2 = makeCanvas(w, h), x2 = ctx2d(c2);
    const img2 = x2.createImageData(w, h);
    img2.data.set(truth);
    x2.putImageData(img2, 0, 0);
    out.secondCanvasSameRead = (await sha(x2.getImageData(0, 0, w, h).data)) === out.readHash;
    // đọc vùng con: pixel phải trùng với cùng vị trí trong lần đọc toàn bộ
    if (w >= 32 && h >= 32) {
      const sx = 7, sy = 5, sw = 17, sh = 13;
      const sub = x.getImageData(sx, sy, sw, sh).data;
      let mismatch = 0, vsTruth = 0;
      for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) for (let k = 0; k < 4; k++) {
        const v = sub[(yy * sw + xx) * 4 + k], full = read1[((sy + yy) * w + sx + xx) * 4 + k];
        if (v !== full) mismatch++;
        if (v !== truth[((sy + yy) * w + sx + xx) * 4 + k]) vsTruth++;
      }
      out.subRegion = { bytesDiffVsFullRead: mismatch, bytesDiffVsTruth: vsTruth };
    }
    for (const via of encoders) {
      out[via] = await safe(async () => {
        const e = await encodedPixels(c, via);
        const d = diffStats(e.data, truth, w);
        d.colorType = e.colorType;
        d.sameAsGetImageData = (await sha(e.data)) === out.readHash;
        return d;
      });
    }
    // drawImage canvas → canvas rồi getImageData (noise có bị cộng 2 lần không)
    out.drawImageCopy = await safe(async () => {
      const c3 = makeCanvas(w, h), x3 = ctx2d(c3);
      x3.drawImage(c, 0, 0);
      return diffStats(x3.getImageData(0, 0, w, h).data, truth, w);
    });
    return out;
  }

  function canvasSolid(makeCanvas, w, h) {
    const c = makeCanvas(w, h), x = ctx2d(c);
    x.fillStyle = 'rgb(10,200,30)';
    x.fillRect(0, 0, w, h);
    return diffStats(x.getImageData(0, 0, w, h).data, solidArr(w, h, [10, 200, 30, 255]), w);
  }
  function canvasQuad(makeCanvas, w, h) {
    const c = makeCanvas(w, h), x = ctx2d(c);
    drawQuad(x, w, h);
    return diffStats(x.getImageData(0, 0, w, h).data, quadArr(w, h), w);
  }
  function canvasBlank(makeCanvas, w, h) {
    const c = makeCanvas(w, h), x = ctx2d(c);
    return diffStats(x.getImageData(0, 0, w, h).data, new Uint8ClampedArray(w * h * 4), w);
  }

  /** Cảnh có chữ + anti-alias: không có đáp án, dùng hash để so giữa các profile cùng máy */
  function drawTextScene(x, w, h) {
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgb(250,240,230)'); g.addColorStop(1, 'rgb(40,90,160)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgb(20,20,20)';
    x.font = '18px Arial, sans-serif';
    x.textBaseline = 'alphabetic';
    x.fillText('NoiseLab <canvas> 0123 ăâđ', 6, 26);
    x.font = '16px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    x.fillText('\u{1F603}\u{1F98A}\u{1F310}', 8, 56);
    x.beginPath(); x.fillStyle = 'rgba(200,30,90,0.6)'; x.arc(180, 45, 25, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgb(0,120,60)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, h); x.bezierCurveTo(60, 0, 140, h, w, 10); x.stroke();
  }
  async function canvasTextScene(makeCanvas, encoders) {
    const w = 240, h = 80;
    const a = makeCanvas(w, h), b = makeCanvas(w, h);
    const xa = ctx2d(a), xb = ctx2d(b);
    drawTextScene(xa, w, h); drawTextScene(xb, w, h);
    const da = xa.getImageData(0, 0, w, h).data, db = xb.getImageData(0, 0, w, h).data;
    const out = { hashA: await sha(da), hashB: await sha(db), hashReread: await sha(xa.getImageData(0, 0, w, h).data) };
    out.stable = out.hashA === out.hashB && out.hashA === out.hashReread;
    for (const via of encoders) {
      out[via] = await safe(async () => {
        const e = await encodedPixels(a, via);
        const d = diffStats(e.data, da, w);
        return { hash: await sha(e.data), vsGetImageData: `${d.changedPx}px` };
      });
    }
    return out;
  }

  function measureSuite(makeCanvas) {
    const x = ctx2d(makeCanvas(10, 10));
    x.font = '16px "Courier New", monospace';
    const m1 = x.measureText('m').width;
    const lin = [2, 4, 8, 16].map((n) => +(x.measureText('m'.repeat(n)).width - n * m1).toFixed(6));
    x.font = '16px Arial';
    const t = 'The quick brown fox jumps 0123';
    const tm = x.measureText(t), tm2 = x.measureText(t);
    const fields = ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent'];
    const metrics = {};
    for (const f of fields) metrics[f] = tm[f];
    return {
      monoCharWidth: m1, monoLinearityDelta: lin, monoLinear: lin.every((d) => Math.abs(d) < 1e-3),
      arial16: metrics, repeatStable: fields.every((f) => tm[f] === tm2[f]), emptyWidth: x.measureText('').width,
    };
  }

  // ---------- WebGL ----------
  const GL_PARAMS = ['VENDOR', 'RENDERER', 'VERSION', 'SHADING_LANGUAGE_VERSION', 'MAX_TEXTURE_SIZE', 'MAX_CUBE_MAP_TEXTURE_SIZE',
    'MAX_RENDERBUFFER_SIZE', 'MAX_VIEWPORT_DIMS', 'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS',
    'MAX_VARYING_VECTORS', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
    'ALIASED_LINE_WIDTH_RANGE', 'ALIASED_POINT_SIZE_RANGE', 'RED_BITS', 'GREEN_BITS', 'BLUE_BITS', 'ALPHA_BITS', 'DEPTH_BITS',
    'STENCIL_BITS', 'SUBPIXEL_BITS', 'SAMPLES', 'SAMPLE_BUFFERS'];
  const GL2_PARAMS = ['MAX_3D_TEXTURE_SIZE', 'MAX_ARRAY_TEXTURE_LAYERS', 'MAX_COLOR_ATTACHMENTS', 'MAX_DRAW_BUFFERS', 'MAX_SAMPLES',
    'MAX_UNIFORM_BUFFER_BINDINGS', 'MAX_UNIFORM_BLOCK_SIZE', 'MAX_VERTEX_OUTPUT_COMPONENTS', 'MAX_FRAGMENT_INPUT_COMPONENTS',
    'MAX_ELEMENT_INDEX', 'MAX_SERVER_WAIT_TIMEOUT', 'MAX_TEXTURE_LOD_BIAS'];

  function program(gl, vsSrc, fsSrc) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    gl.useProgram(p);
    return p;
  }
  function read(gl, w, h) { const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; }

  function drawSolidQuad(gl) {
    const p = program(gl, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}', 'precision mediump float;void main(){gl_FragColor=vec4(0.,1.,0.,1.);}');
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const l = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function drawGradient(gl) {
    const p = program(gl, 'attribute vec2 p;attribute vec3 c;varying vec3 v;void main(){v=c;gl_Position=vec4(p,0.,1.);}',
      'precision mediump float;varying vec3 v;void main(){gl_FragColor=vec4(v*0.9+0.05,1.);}');
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.9, -0.8, 1, 0.2, 0.1, 0.85, -0.6, 0.1, 0.9, 0.3, -0.1, 0.9, 0.2, 0.3, 1]), gl.STATIC_DRAW);
    const pl = gl.getAttribLocation(p, 'p'), cl = gl.getAttribLocation(p, 'c');
    gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(cl); gl.vertexAttribPointer(cl, 3, gl.FLOAT, false, 20, 8);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function glParams(gl, isGL2) {
    const P = (k) => { try { const v = gl.getParameter(gl[k]); return v && typeof v.length === 'number' && typeof v !== 'string' ? Array.from(v) : v; } catch { return null; } };
    const out = {};
    for (const k of GL_PARAMS) out[k] = P(k);
    if (isGL2) for (const k of GL2_PARAMS) out[k] = P(k);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.UNMASKED_VENDOR = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null;
    out.UNMASKED_RENDERER = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
    const prec = [];
    for (const s of ['VERTEX_SHADER', 'FRAGMENT_SHADER']) for (const t of ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT', 'LOW_INT', 'MEDIUM_INT', 'HIGH_INT']) {
      try { const f = gl.getShaderPrecisionFormat(gl[s], gl[t]); prec.push(f ? `${f.rangeMin},${f.rangeMax},${f.precision}` : null); } catch { prec.push(null); }
    }
    out.precision = prec.join('|');
    out.extensions = gl.getSupportedExtensions() || [];
    try { const a = gl.getContextAttributes(); out.contextAttributes = a ? JSON.stringify(a) : null; } catch {}
    try { const ext = gl.getExtension('EXT_texture_filter_anisotropic'); out.MAX_ANISOTROPY = ext ? gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : null; } catch {}
    return out;
  }

  /** makeCanvas(w,h) trả HTMLCanvasElement hoặc OffscreenCanvas; encoders: các đường mã hoá PNG khả dụng */
  async function glSuite(makeCanvas, kind, encoders) {
    const W = 64, H = 64;
    const c = makeCanvas(W, H);
    const gl = c.getContext(kind, { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return { supported: false };
    const out = { supported: true };
    gl.viewport(0, 0, W, H);
    // 1) clear màu biết trước: 0.2/0.4/0.6 × 255 = 51/102/153 chính xác
    gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const clearTruth = solidArr(W, H, [51, 102, 153, 255]);
    out.clearReadPixels = diffStats(read(gl, W, H), clearTruth, W);
    for (const via of encoders) out[`clear_${via}`] = await safe(async () => diffStats((await encodedPixels(c, via)).data, clearTruth, W));
    // 2) shader tô màu đặc (0,255,0)
    drawSolidQuad(gl);
    out.solidShaderReadPixels = diffStats(read(gl, W, H), solidArr(W, H, [0, 255, 0, 255]), W);
    // 3) gradient: không có đáp án, so lặp lại + so readPixels với PNG
    drawGradient(gl);
    const g1 = read(gl, W, H), g2 = read(gl, W, H);
    out.gradientHash = await sha(g1);
    out.gradientRereadSame = out.gradientHash === (await sha(g2));
    for (const via of encoders) {
      out[`gradient_${via}`] = await safe(async () => {
        const e = await encodedPixels(c, via);
        const d = diffStats(flipY(e.data, W, H), g1, W);
        return { hash: await sha(e.data), vsReadPixels: `${d.changedPx}px`, maxDelta: d.maxDelta };
      });
    }
    out.params = glParams(gl, kind === 'webgl2');
    out.paramsHash = await shaStr(JSON.stringify(out.params));
    try { const e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); } catch {}
    return out;
  }

  G.NLCore = {
    sha, shaStr, rng, solidArr, randomOpaque, quadArr, diffStats, decodePNG, encodedPixels, flipY, safe,
    canvasPutGet, canvasSolid, canvasQuad, canvasBlank, canvasTextScene, measureSuite, glSuite,
  };
})(typeof self !== 'undefined' ? self : this);
