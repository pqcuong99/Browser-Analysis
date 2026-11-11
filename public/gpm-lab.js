/*
 * GPM Lab: thí nghiệm định vị noise kiểu "noise lúc vẽ" (GPM Login) thay vì "noise lúc đọc" (Dolphin).
 * Chạy bằng: node scripts/cdp-run.ts eval public/gpm-lab.js gpm-p1=42000 gpm-p2=42001 gpm-p3=42002
 * Trả về object JSON (giá trị thô + phép thử có đáp án) để so giữa các profile.
 */
const H = (arr) => { let h = 0x811c9dc5; for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const diffBytes = (a, b) => { const o = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) o.push(i); return o; };
const out = { canvas: {}, webgl: {}, audio: {}, rects: {}, nav: {}, fonts: {} };

// ================= Canvas 2D =================
{
  const C = out.canvas;
  // C1 globalAlpha
  {
    const c = mk(4, 4), x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 4, 4);
    x.globalAlpha = 0.5; const ga = x.globalAlpha;
    x.fillStyle = '#fff'; x.fillRect(0, 0, 4, 4);
    const px = Array.from(x.getImageData(1, 1, 1, 1).data);
    const c2 = mk(4, 4), y = c2.getContext('2d');
    y.globalAlpha = 0.25; y.fillStyle = '#ff0000'; y.fillRect(0, 0, 4, 4);
    C.globalAlpha = { getter: ga, black_white50: px, transparent_red25: Array.from(y.getImageData(1, 1, 1, 1).data) };
  }
  // C2 shadow: bóng cứng (blur 0) lệch 10 px phải có biên sắc nét
  {
    const c = mk(32, 8), x = c.getContext('2d');
    x.shadowColor = 'rgb(255,0,0)'; x.shadowOffsetX = 10; x.shadowOffsetY = 0; x.shadowBlur = 0;
    const g = { offX: x.shadowOffsetX, offY: x.shadowOffsetY, blur: x.shadowBlur };
    x.fillStyle = 'rgb(0,0,255)'; x.fillRect(0, 0, 8, 8);
    const d = x.getImageData(0, 4, 32, 1).data, row = [];
    for (let i = 0; i < 32; i++) row.push(d[i * 4] ? 'R' : d[i * 4 + 2] ? 'B' : d[i * 4 + 3] ? '?' : '.');
    // bóng mờ: hash
    const c2 = mk(64, 64), y = c2.getContext('2d');
    y.shadowColor = 'rgba(0,0,0,0.8)'; y.shadowBlur = 8; y.shadowOffsetX = 4; y.shadowOffsetY = 4;
    y.fillStyle = '#3a7'; y.fillRect(16, 16, 24, 24);
    C.shadow = { getters: g, hardRow: row.join(''), blurHash: H(y.getImageData(0, 0, 64, 64).data) };
  }
  // C3 hình học không có chữ
  {
    const c = mk(64, 64), x = c.getContext('2d');
    x.fillStyle = '#c33'; x.beginPath(); x.arc(32, 32, 20.3, 0, 6.2); x.fill();
    x.strokeStyle = '#33c'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(3, 5); x.bezierCurveTo(60, 2, 2, 60, 61, 59); x.stroke();
    const gr = x.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, '#f00'); gr.addColorStop(1, '#00f');
    x.fillStyle = gr; x.fillRect(0, 50, 64, 14);
    x.fillStyle = '#0a0'; x.fillRect(10.5, 2.25, 7.5, 3.75);
    C.shapesHash = H(x.getImageData(0, 0, 64, 64).data);
    C.fracRectAlpha = Array.from(x.getImageData(10, 3, 1, 1).data);
  }
  // C4 chữ: vị trí mực, tịnh tiến, translate ↔ toạ độ
  {
    const text = 'Hxg';
    const draw = (fn) => { const c = mk(160, 60), x = c.getContext('2d'); x.font = '40px Arial'; x.fillStyle = '#000'; x.textBaseline = 'alphabetic'; fn(x); return x.getImageData(0, 0, 160, 60).data; };
    const ink = (d) => { let l = 999, r = -1, t = 999, b = -1; for (let y = 0; y < 60; y++) for (let xx = 0; xx < 160; xx++) if (d[(y * 160 + xx) * 4 + 3]) { l = Math.min(l, xx); r = Math.max(r, xx); t = Math.min(t, y); b = Math.max(b, y); } return [l, t, r, b]; };
    const colSum = (d, col) => { let s = 0; for (let y = 0; y < 60; y++) s += d[(y * 160 + col) * 4 + 3]; return s; };
    const a = draw((x) => x.fillText(text, 10, 45));
    const aT = draw((x) => { x.translate(10, 45); x.fillText(text, 0, 0); });
    const a1 = draw((x) => x.fillText(text, 11, 45));
    const a20 = draw((x) => x.fillText(text, 30, 45));
    const aTwice = draw((x) => x.fillText(text, 10, 45));
    // tịnh tiến 1 px phải ra đúng ảnh dịch 1 cột
    let shift1 = 0; for (let y = 0; y < 60; y++) for (let xx = 1; xx < 160; xx++) if (a1[(y * 160 + xx) * 4 + 3] !== a[(y * 160 + xx - 1) * 4 + 3]) shift1++;
    let shift20 = 0; for (let y = 0; y < 60; y++) for (let xx = 20; xx < 160; xx++) if (a20[(y * 160 + xx) * 4 + 3] !== a[(y * 160 + xx - 20) * 4 + 3]) shift20++;
    const cx = mk(1, 1).getContext('2d'); cx.font = '40px Arial'; const m = cx.measureText(text);
    const bb = ink(a);
    C.text = {
      hash: H(a), inkBox: bb, translateEqual: diffBytes(a, aT).length, repeatEqual: diffBytes(a, aTwice).length,
      shift1px: shift1, shift20px: shift20,
      leftColAlpha: [colSum(a, bb[0]), colSum(a, bb[0] + 1)],
      measure: { width: m.width, abl: m.actualBoundingBoxLeft, abr: m.actualBoundingBoxRight, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent },
      // mép mực dự đoán từ measureText: x - abl, y - ascent
      predicted: [10 - m.actualBoundingBoxLeft, 45 - m.actualBoundingBoxAscent, 10 + m.actualBoundingBoxRight, 45 + m.actualBoundingBoxDescent],
    };
    // strokeText & fillText + maxWidth
    C.strokeHash = H(draw((x) => { x.lineWidth = 1; x.strokeText(text, 10, 45); }));
    // 1 ký tự '|' rất mảnh ở toạ độ nguyên: chỉ nên có mực ở rất ít cột
    const bar = draw((x) => { x.font = '40px Arial'; x.fillText('|', 50, 45); });
    const cols = []; for (let xx = 40; xx < 70; xx++) { const s = colSum(bar, xx); if (s) cols.push([xx, s]); }
    C.barCols = cols;
  }
  // C5 drawImage / putImageData / sạch?
  {
    const src = mk(16, 16), s = src.getContext('2d');
    const id = s.createImageData(16, 16); for (let i = 0; i < id.data.length; i++) id.data[i] = (i * 37) & 255; for (let i = 3; i < id.data.length; i += 4) id.data[i] = 255;
    s.putImageData(id, 0, 0);
    const d = mk(16, 16), x = d.getContext('2d'); x.drawImage(src, 0, 0);
    C.drawImageExact = diffBytes(x.getImageData(0, 0, 16, 16).data, id.data).length;
  }
}

// ================= WebGL =================
{
  const W = out.webgl;
  const gl0 = (w, h) => { const c = mk(w, h); const g = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false }); return g; };
  const prog = (g, vs, fs) => {
    const sh = (t, s) => { const o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o)); return o; };
    const p = g.createProgram(); g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs)); g.linkProgram(p); g.useProgram(p); return p;
  };
  const quad = (g, p) => { const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW); const l = g.getAttribLocation(p, 'p'); g.enableVertexAttribArray(l); g.vertexAttribPointer(l, 2, g.FLOAT, false, 0, 0); g.drawArrays(g.TRIANGLE_STRIP, 0, 4); };
  const read = (g, w, h) => { const a = new Uint8Array(w * h * 4); g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, a); return a; };
  // W1 clear lớn: tìm byte bị đổi (readPixelsIndex)
  for (const [w, h] of [[16, 16], [64, 64], [128, 128], [256, 64]]) {
    const g = gl0(w, h); g.clearColor(0.2, 0.4, 0.6, 1); g.clear(g.COLOR_BUFFER_BIT);
    const a = read(g, w, h), exp = [51, 102, 153, 255], off = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== exp[i % 4]) off.push([i, a[i]]);
    // đọc 2 lần + đọc vùng con
    const sub = new Uint8Array(4 * 4 * 4); g.readPixels(1, 1, 4, 4, g.RGBA, g.UNSIGNED_BYTE, sub);
    W[`clear_${w}x${h}`] = { off: off.length, sample: off.slice(0, 6), subOff: [...sub].filter((v, i) => v !== exp[i % 4]).length };
  }
  // W2 uniform: màu từ uniform phải đúng 51/102/153
  {
    const g = gl0(8, 8);
    const p = prog(g, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}', 'precision highp float;uniform vec4 u4;uniform float u1;uniform vec2 u2;uniform vec3 u3;uniform int mode;void main(){if(mode==0)gl_FragColor=u4;else if(mode==1)gl_FragColor=vec4(u1,u1,u1,1.);else if(mode==2)gl_FragColor=vec4(u2,0.,1.);else gl_FragColor=vec4(u3,1.);}');
    const L = (n) => g.getUniformLocation(p, n);
    const res = {};
    const run = (m, set) => { g.uniform1i(L('mode'), m); set(); quad(g, p); return Array.from(read(g, 8, 8).slice(4 * 27, 4 * 27 + 4)); };
    res.uniform4f = run(0, () => g.uniform4f(L('u4'), 0.2, 0.4, 0.6, 1));
    res.uniform4fv = run(0, () => g.uniform4fv(L('u4'), [0.2, 0.4, 0.6, 1]));
    res.uniform1f = run(1, () => g.uniform1f(L('u1'), 0.6));
    res.uniform2f = run(2, () => g.uniform2f(L('u2'), 0.2, 0.4));
    res.uniform3f = run(3, () => g.uniform3f(L('u3'), 0.2, 0.4, 0.6));
    g.uniform4f(L('u4'), 0.2, 0.4, 0.6, 1); res.getUniform4 = Array.from(g.getUniform(p, L('u4')));
    g.uniform1f(L('u1'), 0.6); res.getUniform1 = g.getUniform(p, L('u1'));
    g.uniform3f(L('u3'), 0.2, 0.4, 0.6); res.getUniform3 = Array.from(g.getUniform(p, L('u3')));
    W.uniform = res;
  }
  // W3 gradient theo attribute (không uniform) và theo gl_FragCoord
  {
    const g = gl0(64, 64);
    const p = prog(g, 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}', 'precision highp float;varying vec2 v;void main(){gl_FragColor=vec4(v.x,v.y,1.-v.x,1.);}');
    quad(g, p); const a = read(g, 64, 64);
    // đáp án: v.x tại tâm pixel i = (i+0.5)/64 → round(255*v)
    let off = 0, maxd = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const i = (y * 64 + x) * 4, ex = [(x + 0.5) / 64, (y + 0.5) / 64, 1 - (x + 0.5) / 64].map((v) => v * 255); for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] - ex[k]); if (d > 1.01) { off++; maxd = Math.max(maxd, d); } } }
    W.varyingGradient = { hash: H(a), offOverTolerance: off, maxd };
    const g2 = gl0(64, 64);
    const p2 = prog(g2, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}', 'precision highp float;void main(){gl_FragColor=vec4(gl_FragCoord.x/64.,gl_FragCoord.y/64.,0.5,1.);}');
    quad(g2, p2); W.fragCoordHash = H(read(g2, 64, 64));
    // gradient có uniform scale
    const g3 = gl0(64, 64);
    const p3 = prog(g3, 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}', 'precision highp float;varying vec2 v;uniform float s;void main(){gl_FragColor=vec4(v.x*s,v.y*s,0.,1.);}');
    g3.uniform1f(g3.getUniformLocation(p3, 's'), 1.0); quad(g3, p3); W.uniformGradientHash = H(read(g3, 64, 64));
  }
  // W4 thông số + giới hạn uniform thật (biên dịch shader với N uniform vec4)
  {
    const c = mk(4, 4), g = c.getContext('webgl');
    const dbg = g.getExtension('WEBGL_debug_renderer_info');
    W.params = { renderer: g.getParameter(dbg.UNMASKED_RENDERER_WEBGL), vendor: g.getParameter(dbg.UNMASKED_VENDOR_WEBGL), mvuv: g.getParameter(g.MAX_VERTEX_UNIFORM_VECTORS), mfuv: g.getParameter(g.MAX_FRAGMENT_UNIFORM_VECTORS), exts: g.getSupportedExtensions().length };
    const tryVS = (n) => { const s = g.createShader(g.VERTEX_SHADER); g.shaderSource(s, `uniform vec4 u[${n}];attribute float i;void main(){gl_Position=u[int(i)];}`); g.compileShader(s); const vs = g.getShaderParameter(s, g.COMPILE_STATUS); if (!vs) return false; const f = g.createShader(g.FRAGMENT_SHADER); g.shaderSource(f, 'void main(){gl_FragColor=vec4(1.);}'); g.compileShader(f); const p = g.createProgram(); g.attachShader(p, s); g.attachShader(p, f); g.linkProgram(p); return !!g.getProgramParameter(p, g.LINK_STATUS); };
    const tryFS = (n) => { const s = g.createShader(g.FRAGMENT_SHADER); g.shaderSource(s, `precision mediump float;uniform vec4 u[${n}];uniform int k;void main(){gl_FragColor=u[k];}`); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) return false; const v = g.createShader(g.VERTEX_SHADER); g.shaderSource(v, 'void main(){gl_Position=vec4(0.);}'); g.compileShader(v); const p = g.createProgram(); g.attachShader(p, v); g.attachShader(p, s); g.linkProgram(p); return !!g.getProgramParameter(p, g.LINK_STATUS); };
    const bs = (f, lo, hi) => { while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f(m)) lo = m; else hi = m - 1; } return lo; };
    W.realLimits = { vertexUniformVec4: bs(tryVS, 1, 8192), fragmentUniformVec4: bs(tryFS, 1, 8192) };
  }
  // W5 WebGPU adapter
  try {
    if (navigator.gpu) { const ad = await navigator.gpu.requestAdapter(); const i = ad && (ad.info || (ad.requestAdapterInfo && await ad.requestAdapterInfo())); W.webgpu = i ? { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description } : null; }
  } catch (e) { W.webgpu = { error: String(e) }; }
}

// ================= Audio =================
{
  const A = out.audio;
  const R = 44100, N = 5000;
  const render = async (setup, len = N) => { const ctx = new OfflineAudioContext(1, len, R); setup(ctx); const b = await ctx.startRendering(); return b; };
  const sum = (d, a = 4500, b = 5000) => { let s = 0; for (let i = a; i < b; i++) s += Math.abs(d[i]); return s; };
  const osc = await render((c) => { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 10000; o.connect(c.destination); o.start(0); });
  const od = osc.getChannelData(0);
  // đáp án tam giác f = 10000 Hz không cần lấy mẫu chính xác: so với p3
  A.oscTriangle = { sum: sum(od, 0, N), first: Array.from(od.slice(0, 4)) };
  const sine = await render((c) => { const o = c.createOscillator(); o.frequency.value = R / 64; o.connect(c.destination); o.start(0); }, 256);
  A.oscSineFs64 = { sum: sum(sine.getChannelData(0), 0, 256), s16: sine.getChannelData(0)[16] };
  // compressor nuôi bằng buffer (không oscillator)
  const comp = (c, src) => { const k = c.createDynamicsCompressor(); k.threshold.value = -50; k.knee.value = 40; k.ratio.value = 12; k.attack.value = 0; k.release.value = 0.25; src.connect(k); k.connect(c.destination); };
  const viaBuf = await render((c) => { const b = c.createBuffer(1, N, R); b.copyToChannel(od, 0); const s = c.createBufferSource(); s.buffer = b; comp(c, s); s.start(0); });
  const viaOsc = await render((c) => { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 10000; comp(c, o); o.start(0); });
  const v1 = viaBuf.getChannelData(0), v2 = viaOsc.getChannelData(0);
  let dd = 0; for (let i = 0; i < N; i++) dd = Math.max(dd, Math.abs(v1[i] - v2[i]));
  A.compressor = { viaOscSum: sum(v2), viaBufferSum: sum(v1), oscVsBufferMaxDiff: dd };
  // copyFromChannel vs getChannelData trên đồ thị fingerprint
  const cp = new Float32Array(N); viaOsc.copyFromChannel(cp, 0);
  let cd = 0; for (let i = 0; i < N; i++) if (cp[i] !== v2[i]) cd++;
  A.getVsCopy = cd;
  // gain sau oscillator, và buffer tự tạo đi qua compressor
  const g = await render((c) => { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 10000; const gg = c.createGain(); gg.gain.value = 0.5; o.connect(gg); gg.connect(c.destination); o.start(0); });
  const gd = g.getChannelData(0); let gm = 0; for (let i = 0; i < N; i++) gm = Math.max(gm, Math.abs(gd[i] - 0.5 * od[i]));
  A.gainHalfMaxDiff = gm;
  // AnalyserNode trên oscillator
  const an = await (async () => { const c = new OfflineAudioContext(1, 4096, R); const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 1000; const a = c.createAnalyser(); a.fftSize = 2048; o.connect(a); a.connect(c.destination); o.start(0); let fd = null; c.suspend(2048 / R).then(() => { fd = new Float32Array(a.frequencyBinCount); a.getFloatFrequencyData(fd); c.resume(); }); await c.startRendering(); return fd; })();
  A.analyserHash = H(new Uint8Array(an.buffer));
  // buffer tĩnh đọc lại có bị đổi?
  const st = await render((c) => { const b = c.createBuffer(1, N, R); const d = b.getChannelData(0); for (let i = 0; i < N; i++) d[i] = Math.sin(i / 7) * 0.5; const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); });
  const sd = st.getChannelData(0); let so = 0; for (let i = 0; i < N; i++) if (sd[i] !== Math.fround(Math.sin(i / 7) * 0.5)) so++;
  A.bufferPassThroughOff = so;
}

// ================= ClientRects =================
{
  const Rr = out.rects;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:800px;height:400px;visibility:hidden';
  document.body.appendChild(host);
  const rows = [];
  for (const [w, h] of [[10, 10], [10.25, 5], [10.5, 5], [10.75, 5], [33.5, 12.75], [50.125, 20], [100.5, 7.5], [200.25, 1.25], [0.5, 0.5], [77.015625, 3.03125]]) {
    const e = document.createElement('div');
    e.style.cssText = `position:absolute;left:5.5px;top:7.25px;width:${w}px;height:${h}px;margin:0;padding:0;border:0`;
    host.appendChild(e);
    const b = e.getBoundingClientRect(), cr = e.getClientRects()[0], cs = getComputedStyle(e);
    rows.push({ css: [w, h], bcr: [b.x, b.y, b.width, b.height, b.right, b.bottom], dW64: (b.width - w) * 64, dH64: (b.height - h) * 64, crW: cr.width, cs: [cs.width, cs.height], off: [e.offsetWidth, e.offsetHeight] });
  }
  Rr.boxes = rows;
  // transform scale: hình học sau biến đổi
  const t = document.createElement('div'); t.style.cssText = 'position:absolute;left:0;top:0;width:40px;height:20px;transform:scale(1.5);transform-origin:0 0'; host.appendChild(t);
  const tb = t.getBoundingClientRect(); Rr.scaled = [tb.width, tb.height];
  // ResizeObserver
  const fe = host.children[4];
  Rr.resizeObserver = await new Promise((res) => { const ro = new ResizeObserver((en) => { ro.disconnect(); const e = en[0]; res({ content: [e.contentRect.width, e.contentRect.height], border: [e.borderBoxSize[0].inlineSize, e.borderBoxSize[0].blockSize], bcr: [fe.getBoundingClientRect().width, fe.getBoundingClientRect().height] }); }); ro.observe(fe); setTimeout(() => res({ na: 'timeout' }), 1500); });
  // chữ: span, range, measureText, SVG
  const texts = ['The quick brown fox jumps 0123', 'iiiii', 'WWWWW', 'Hello, world!'];
  Rr.text = [];
  for (const s of texts) {
    const sp = document.createElement('span'); sp.style.cssText = 'position:absolute;left:10px;top:150px;font:16px Arial;white-space:nowrap'; sp.textContent = s; host.appendChild(sp);
    const r = document.createRange(); r.selectNodeContents(sp.firstChild);
    const cx = mk(1, 1).getContext('2d'); cx.font = '16px Arial';
    Rr.text.push({ s, span: sp.getBoundingClientRect().width, range: r.getBoundingClientRect().width, rangeRects: r.getClientRects()[0].width, measure: cx.measureText(s).width, offsetWidth: sp.offsetWidth });
  }
  host.remove();
}

// ================= Navigator / heap / fonts =================
{
  const N = out.nav;
  N.main = { hc: navigator.hardwareConcurrency, dm: navigator.deviceMemory, heap: performance.memory && performance.memory.jsHeapSizeLimit, platform: navigator.platform };
  N.worker = await new Promise((res) => {
    const src = 'postMessage({hc:navigator.hardwareConcurrency,dm:navigator.deviceMemory,heap:self.performance&&performance.memory?performance.memory.jsHeapSizeLimit:null,ua:navigator.userAgent})';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (e) => { res(e.data); w.terminate(); }; setTimeout(() => res({ na: 'timeout' }), 3000);
  });
  N.uaData = navigator.userAgentData ? await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model', 'fullVersionList']) : null;
  N.mediaDevices = navigator.mediaDevices ? (await navigator.mediaDevices.enumerateDevices()).map((d) => d.kind) : null;
  N.bluetooth = 'bluetooth' in navigator ? typeof navigator.bluetooth : 'absent';
  N.screen = [screen.width, screen.height, screen.availWidth, screen.availHeight, devicePixelRatio, outerWidth, outerHeight, innerWidth, innerHeight];
  N.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  N.tzOffset = new Date().getTimezoneOffset();
  N.langs = navigator.languages;
}
{
  // font được GPM "thêm vào": đo bằng canvas với font dự phòng
  const F = out.fonts;
  const cand = ['AmdtSymbols', 'RomanD', 'Frank Ruehl Libre Light', 'Liberation Sans', 'WP Arabic Sihafa', 'Ceremonious Two', 'Arial', 'Segoe UI', 'Calibri', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Impact', 'Georgia', 'Verdana', 'Tahoma', 'Consolas', 'Cambria', 'Wingdings', 'Marlett', 'Gabriola', 'Ebrima', 'Helvetica', 'Monaco', 'Ubuntu', 'Roboto', 'SimSun', 'MS Gothic', 'Noto Sans', 'Fira Code'];
  const cx = mk(1, 1).getContext('2d'), probe = 'mmmmmmmmmmlli1WQ@#';
  const base = {}; for (const b of ['monospace', 'sans-serif', 'serif']) { cx.font = `72px ${b}`; base[b] = cx.measureText(probe).width; }
  const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden'; document.body.appendChild(host);
  F.list = cand.map((f) => {
    const canvas = ['monospace', 'sans-serif', 'serif'].some((b) => { cx.font = `72px "${f}", ${b}`; return cx.measureText(probe).width !== base[b]; });
    const sp = document.createElement('span'); sp.style.cssText = `font:72px "${f}", monospace;white-space:nowrap`; sp.textContent = probe; host.appendChild(sp);
    const sp0 = document.createElement('span'); sp0.style.cssText = 'font:72px monospace;white-space:nowrap'; sp0.textContent = probe; host.appendChild(sp0);
    const dom = Math.abs(sp.getBoundingClientRect().width - sp0.getBoundingClientRect().width) > 0.5;
    return { f, canvas, dom, check: document.fonts.check(`12px "${f}"`) };
  });
  host.remove();
  // font cục bộ qua @font-face local()
  F.localFace = {};
  for (const f of ['AmdtSymbols', 'RomanD', 'Arial', 'Segoe UI']) {
    try { const ff = new FontFace('probe-' + f.replace(/\W/g, ''), `local("${f}")`); await ff.load(); F.localFace[f] = 'loaded'; } catch (e) { F.localFace[f] = 'fail'; }
  }
}
return out;
