/*
 * Noise Lab: định vị noise Canvas / WebGL / ClientRects / Audio của trình duyệt antidetect.
 * Mỗi phép thử có đáp án đúng tính trước, chạy ở 3 ngữ cảnh: main thread, iframe about:blank, Web Worker.
 * Mở: /noise-lab.html?label=p1  (kết quả được POST về /api/noise-lab và lưu ở data/noise-lab/)
 */
(async () => {
  'use strict';
  const C = window.NLCore;
  const $ = (s) => document.querySelector(s);
  const qs = new URLSearchParams(location.search);
  const label = (qs.get('label') || '').replace(/[^\w.-]/g, '').slice(0, 40) || 'unlabeled';
  const status = (t) => { $('#status').textContent = t; };
  const t0 = performance.now();

  const withTimeout = (p, ms, fb) => Promise.race([p, new Promise((r) => setTimeout(() => r(fb), ms))]);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const on64 = (v) => Math.abs(v * 64 - Math.round(v * 64)) < 1e-6;

  // ---------- Canvas trong 1 realm (main hoặc iframe) ----------
  async function canvasRealm(doc) {
    const mk = (w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
    const enc = ['toDataURL', 'toBlob'];
    const out = {
      solid_16: C.canvasSolid(mk, 16, 16),
      solid_256x128: C.canvasSolid(mk, 256, 128),
      quad_64: C.canvasQuad(mk, 64, 64),
      blank_64: C.canvasBlank(mk, 64, 64),
      textScene: await C.safe(() => C.canvasTextScene(mk, enc)),
      measure: await C.safe(() => C.measureSuite(mk)),
    };
    for (const [w, h, s] of [[1, 1, 11], [8, 8, 12], [16, 16, 13], [64, 64, 0x1234], [128, 64, 0xbeef], [300, 150, 15]]) {
      out[`putGet_${w}x${h}`] = await C.safe(() => C.canvasPutGet(mk, w, h, s, w >= 64 ? enc : []));
    }
    // OffscreenCanvas ngay trên main thread
    if (doc === document && typeof OffscreenCanvas !== 'undefined') {
      const mko = (w, h) => new OffscreenCanvas(w, h);
      out.offscreenMain_putGet_128x64 = await C.safe(() => C.canvasPutGet(mko, 128, 64, 0xbeef, ['convertToBlob']));
      out.offscreenMain_textScene = await C.safe(() => C.canvasTextScene(mko, ['convertToBlob']));
    }
    return out;
  }

  // ---------- ClientRects ----------
  async function rectRealm(doc) {
    const win = doc.defaultView;
    const host = doc.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:320px;margin:0;padding:0;border:0;visibility:hidden;pointer-events:none;transform:none;overflow:hidden';
    doc.body.appendChild(host);
    const box = (css) => {
      const e = doc.createElement('div');
      e.style.cssText = 'position:absolute;margin:0;padding:0;border:0;box-sizing:border-box;' + css;
      host.appendChild(e);
      return e;
    };
    const rr = (r) => [r.x, r.y, r.width, r.height];
    const A = box('left:10px;top:20px;width:100px;height:50px');
    const A2 = box('left:200px;top:20px;width:100px;height:50px');
    const B = box('left:10.5px;top:100.25px;width:33.5px;height:12.75px');
    const mkSpan = (left) => {
      const s = doc.createElement('span');
      s.style.cssText = `position:absolute;left:${left}px;top:150px;font:16px Arial;white-space:nowrap;line-height:20px;margin:0;padding:0`;
      s.textContent = 'The quick brown fox jumps 0123';
      host.appendChild(s);
      return s;
    };
    const S = mkSpan(10), S2 = mkSpan(320);
    const out = {};
    const a = rr(A.getBoundingClientRect()), a2 = rr(A2.getBoundingClientRect()), b = rr(B.getBoundingClientRect());
    out.intBox = { expected: [10, 20, 100, 50], observed: a, ok: eq(a, [10, 20, 100, 50]) };
    out.fracBox = { expected: [10.5, 100.25, 33.5, 12.75], observed: b, ok: eq(b, [10.5, 100.25, 33.5, 12.75]) };
    out.twinBoxSize = { a: a.slice(2), a2: a2.slice(2), ok: eq(a.slice(2), a2.slice(2)) && a2[0] === 200 };
    const cr = rr(A.getClientRects()[0]);
    out.clientRectsVsBCR = { bcr: a, clientRects: cr, ok: eq(a, cr) };
    out.offsetVsBCR = { offsetWidth: A.offsetWidth, offsetHeight: A.offsetHeight, clientWidth: A.clientWidth, ok: A.offsetWidth === a[2] && A.offsetHeight === a[3] };
    // chữ: không có đáp án tuyệt đối, nhưng 2 span giống hệt phải cùng kích thước, đo lặp phải giống nhau
    const s = rr(S.getBoundingClientRect()), s2 = rr(S2.getBoundingClientRect());
    const reps = Array.from({ length: 5 }, () => S.getBoundingClientRect().width);
    out.textSpan = { observed: s, twin: s2, ok: s[2] === s2[2] && s[3] === s2[3] && s2[0] === 320 };
    out.textRepeat = { widths: reps, ok: reps.every((v) => v === reps[0]) };
    const range = doc.createRange();
    range.selectNodeContents(S.firstChild);
    const rg = rr(range.getBoundingClientRect());
    out.rangeVsElement = { range: rg, element: s, deltaWidth: +(rg[2] - s[2]).toFixed(6), ok: Math.abs(rg[2] - s[2]) < 1e-3 };
    // canvas measureText cùng font: Chromium dùng chung HarfBuzz shaping nên phải rất sát DOM
    const cx = doc.createElement('canvas').getContext('2d');
    cx.font = '16px Arial';
    const mt = cx.measureText(S.textContent).width;
    out.domVsMeasureText = { dom: s[2], canvas: mt, delta: +(s[2] - mt).toFixed(6), ok: Math.abs(s[2] - mt) < 0.02 };
    // LayoutUnit của Blink = 1/64 px: không zoom thì mọi toạ độ phải là bội số của 1/64
    const all = [...a, ...a2, ...b, ...s, ...s2, ...rg];
    const off = all.filter((v) => !on64(v));
    out.layoutUnitGrid = { values: all.length, offGrid: off.length, samples: off.slice(0, 6), dpr: win.devicePixelRatio, vvScale: win.visualViewport ? win.visualViewport.scale : null, ok: off.length === 0 };
    // ResizeObserver / IntersectionObserver lấy hình học từ đường khác getBoundingClientRect
    out.resizeObserver = await withTimeout(new Promise((res) => {
      const ro = new win.ResizeObserver((entries) => {
        ro.disconnect();
        const e = entries[0], bb = e.borderBoxSize && e.borderBoxSize[0];
        const v = [e.contentRect.width, e.contentRect.height, bb ? bb.inlineSize : null, bb ? bb.blockSize : null];
        res({ observed: v, bcr: [a[2], a[3]], ok: v[0] === 100 && v[1] === 50 && v[0] === a[2] && v[1] === a[3] });
      });
      ro.observe(A);
    }), 1500, { na: doc.hidden ? 'tab đang ẩn, observer không chạy' : 'timeout' });
    out.intersectionObserver = await withTimeout(new Promise((res) => {
      const io = new win.IntersectionObserver((entries) => {
        io.disconnect();
        const v = rr(entries[0].boundingClientRect);
        res({ observed: v, bcr: a, ok: eq(v, a) });
      });
      io.observe(A);
    }), 1500, { na: doc.hidden ? 'tab đang ẩn, observer không chạy' : 'timeout' });
    // SVG
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('width', '300'); svg.setAttribute('height', '100');
    svg.style.cssText = 'position:absolute;left:0;top:200px';
    const rect = doc.createElementNS(NS, 'rect');
    for (const [k, v] of [['x', 5], ['y', 6], ['width', 100], ['height', 40]]) rect.setAttribute(k, v);
    const text = doc.createElementNS(NS, 'text');
    text.setAttribute('x', 10); text.setAttribute('y', 80); text.setAttribute('font-family', 'Arial'); text.setAttribute('font-size', '16');
    text.textContent = S.textContent;
    svg.append(rect, text);
    host.appendChild(svg);
    const bb = rect.getBBox();
    const sb = rr(rect.getBoundingClientRect());
    out.svgBBox = { observed: [bb.x, bb.y, bb.width, bb.height], ok: eq([bb.x, bb.y, bb.width, bb.height], [5, 6, 100, 40]) };
    out.svgRectBCR = { observed: sb, expected: [5, 206, 100, 40], ok: eq(sb, [5, 206, 100, 40]) };
    const ctl = text.getComputedTextLength(), tb = text.getBBox().width;
    out.svgTextLength = { computedTextLength: ctl, bboxWidth: tb, domSpanWidth: s[2], delta: +(ctl - s[2]).toFixed(4) };
    host.remove();
    return out;
  }

  // ---------- Audio ----------
  async function audioRealm(win) {
    const OAC = win.OfflineAudioContext || win.webkitOfflineAudioContext;
    if (!OAC) return { supported: false };
    const R = 44100;
    const render = (setup, len) => { const ctx = new OAC(1, len, R); setup(ctx); return withTimeout(ctx.startRendering(), 3000, null); };
    const countOff = (arr, fn) => {
      let n = 0, max = 0, first = -1;
      for (let i = 0; i < arr.length; i++) { const d = Math.abs(arr[i] - fn(i)); if (d !== 0) { n++; if (first < 0) first = i; if (d > max) max = d; } }
      return { changed: n, of: arr.length, maxAbsDelta: max, firstIndex: first, ok: n === 0 };
    };
    const both = (buf, fn) => {
      const viaGet = buf.getChannelData(0);
      const viaCopy = new Float32Array(buf.length);
      buf.copyFromChannel(viaCopy, 0);
      return { getChannelData: countOff(viaGet, fn), copyFromChannel: countOff(viaCopy, fn) };
    };
    const out = { supported: true };
    // 1) ConstantSource 0.5 → mọi mẫu đúng 0.5
    const bc = await render((ctx) => { const s = ctx.createConstantSource(); s.offset.value = 0.5; s.connect(ctx.destination); s.start(0); }, 2048);
    out.constant = bc ? both(bc, () => 0.5) : { error: 'timeout' };
    // 2) Im lặng → toàn 0
    const bs = await render(() => {}, 2048);
    out.silence = bs ? both(bs, () => 0) : { error: 'timeout' };
    // 3) BufferSource phát lại mảng biết trước → ra đúng mảng đó
    const known = new Float32Array(2048);
    for (let i = 0; i < known.length; i++) known[i] = Math.fround(Math.sin(i / 7) * 0.5);
    const bp = await render((ctx) => {
      const b = ctx.createBuffer(1, 2048, R); b.copyToChannel(known, 0);
      const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
    }, 2048);
    out.passthrough = bp ? both(bp, (i) => known[i]) : { error: 'timeout' };
    // 4) Gain 0.25 × ConstantSource 1 → 0.25
    const bg = await render((ctx) => {
      const s = ctx.createConstantSource(); s.offset.value = 1; const g = ctx.createGain(); g.gain.value = 0.25;
      s.connect(g); g.connect(ctx.destination); s.start(0);
    }, 2048);
    out.gain = bg ? both(bg, () => 0.25) : { error: 'timeout' };
    // 5) AudioBuffer ghi rồi đọc (không render)
    const ctx0 = new OAC(1, 128, R);
    const wb = ctx0.createBuffer(1, 2048, R);
    wb.copyToChannel(known, 0);
    out.bufferWriteRead = both(wb, (i) => known[i]);
    // 6) Fingerprint kiểu FingerprintJS: oscillator triangle + compressor
    const fp = () => render((ctx) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 10000;
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = -50; c.knee.value = 40; c.ratio.value = 12; c.attack.value = 0; c.release.value = 0.25;
      o.connect(c); c.connect(ctx.destination); o.start(0);
    }, 5000);
    const f1 = await fp(), f2 = await fp();
    if (f1 && f2) {
      const sum = (d) => { let s = 0; for (let i = 4500; i < 5000; i++) s += Math.abs(d[i]); return s; };
      const g1 = f1.getChannelData(0), g1b = f1.getChannelData(0), g2 = f2.getChannelData(0);
      const cp = new Float32Array(f1.length); f1.copyFromChannel(cp, 0);
      let getVsCopy = 0, firstVsSecondCall = 0;
      for (let i = 0; i < g1.length; i++) { if (g1[i] !== cp[i]) getVsCopy++; if (g1[i] !== g1b[i]) firstVsSecondCall++; }
      out.dynamicsFP = {
        sumA: sum(g1), sumB: sum(g2), hashA: await C.sha(g1), hashB: await C.sha(g2), hashCopy: await C.sha(cp),
        renderStable: (await C.sha(g1)) === (await C.sha(g2)), getVsCopyDiff: getVsCopy, firstVsSecondCallDiff: firstVsSecondCall,
        samples4500: Array.from(g1.subarray(4500, 4504)),
      };
    }
    // 7) AnalyserNode (đường đọc tần số, không qua AudioBuffer)
    const an = async () => {
      const ctx = new OAC(1, 44100, R);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1000;
      const a = ctx.createAnalyser(); a.fftSize = 2048;
      o.connect(a); a.connect(ctx.destination); o.start(0);
      const fd = new Float32Array(a.frequencyBinCount), td = new Float32Array(a.fftSize);
      ctx.suspend(0.5).then(() => { a.getFloatFrequencyData(fd); a.getFloatTimeDomainData(td); ctx.resume(); });
      await withTimeout(ctx.startRendering(), 3000, null);
      return { freq: await C.sha(fd), time: await C.sha(td), peakBin: fd.indexOf(Math.max(...fd)) };
    };
    const a1 = await C.safe(an), a2 = await C.safe(an);
    out.analyser = { a: a1, b: a2, stable: eq(a1, a2) };
    // 8) AudioContext realtime (chỉ đọc thuộc tính)
    try {
      const AC = win.AudioContext || win.webkitAudioContext;
      const ac = new AC();
      out.realtime = { sampleRate: ac.sampleRate, baseLatency: ac.baseLatency, outputLatency: ac.outputLatency, maxChannelCount: ac.destination.maxChannelCount, state: ac.state };
      ac.close();
    } catch (e) { out.realtime = { error: String(e.message || e) }; }
    return out;
  }

  // ---------- Audio deep-dive: noise nằm ở node nào, phép bất biến nào bị phá ----------
  async function audioDeep(win) {
    const OAC = win.OfflineAudioContext;
    const R = 44100, N = 4096;
    const render = (len, setup) => { const ctx = new OAC(1, len, R); setup(ctx); return withTimeout(ctx.startRendering(), 3000, null); };
    const osc = (ctx, type = 'sine', f = 1000) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(0); return o; };
    const cmp = (a, b, fn = (x) => x) => {
      let n = 0, max = 0, first = -1;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - fn(b[i], i)); if (d !== 0) { n++; if (first < 0) first = i; if (d > max) max = d; } }
      return { changed: n, of: a.length, maxAbsDelta: max, firstIndex: first, ok: n === 0 };
    };
    const ch = (b) => (b ? b.getChannelData(0) : null);
    const out = {};
    const A = ch(await render(N, (c) => osc(c).connect(c.destination)));
    out.oscSine = { hash: await C.sha(A), head: Array.from(A.subarray(0, 4)) };
    // sai số so với Math.sin (wavetable của Chromium có sai số nhỏ, cố định)
    let maxErr = 0;
    for (let i = 0; i < N; i++) maxErr = Math.max(maxErr, Math.abs(A[i] - Math.sin(2 * Math.PI * 1000 * i / R)));
    out.oscSineVsMath = { maxErr };
    for (const t of ['square', 'sawtooth', 'triangle']) out[`osc_${t}`] = await C.sha(ch(await render(N, (c) => osc(c, t).connect(c.destination))));
    const B = ch(await render(N, (c) => { const s = c.createConstantSource(); s.offset.value = 0.5; s.start(0); const k = c.createDynamicsCompressor(); s.connect(k); k.connect(c.destination); }));
    out.constCompressor = { hash: await C.sha(B), tail: Array.from(B.subarray(N - 3)) };
    // gain 0.5 là phép nhân chính xác trong float: osc→gain(0.5) phải đúng bằng 0.5 × osc
    const G5 = ch(await render(N, (c) => { const g = c.createGain(); g.gain.value = 0.5; osc(c).connect(g); g.connect(c.destination); }));
    out.gainHalf = cmp(G5, A, (x) => Math.fround(x * 0.5));
    // 2 oscillator giống hệt cộng lại phải đúng bằng 2 × osc
    const D2 = ch(await render(N, (c) => { osc(c).connect(c.destination); osc(c).connect(c.destination); }));
    out.twoOscSum = cmp(D2, A, (x) => Math.fround(x * 2));
    // render dài gấp đôi: N mẫu đầu phải trùng
    const L2 = ch(await render(N * 2, (c) => osc(c).connect(c.destination)));
    out.prefixInvariance = cmp(L2.subarray(0, N), A);
    // tần số 0 → sin(0) = 0 mọi mẫu
    out.oscFreqZero = cmp(ch(await render(N, (c) => osc(c, 'sine', 0).connect(c.destination))), new Float32Array(N));
    // f = fs/64: bước pha chính xác → oscillator thật tuần hoàn tuyệt đối, mẫu n = mẫu n+64
    for (const t of ['sine', 'triangle', 'square', 'sawtooth']) {
      const P = ch(await render(N, (c) => osc(c, t, R / 64).connect(c.destination)));
      out[`periodic_${t}`] = cmp(P.subarray(64), P.subarray(0, N - 64));
      // phản đối xứng nửa chu kỳ (sawtooth không có tính chất này)
      if (t !== 'sawtooth') out[`antisym_${t}`] = cmp(P.subarray(0, 64), P.subarray(32, 96), (x) => -x);
      if (t === 'sine') out.wavePeak = { value: P[16], ok: P[16] === 1 && P[0] === 0 && P[32] === 0 };
    }
    // PeriodicWave tự định nghĩa = sine dựng sẵn
    const PW = ch(await render(N, (c) => { const o = c.createOscillator(); o.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, 0]), new Float32Array([0, 1]))); o.frequency.value = 1000; o.start(0); o.connect(c.destination); }));
    out.periodicWaveVsSine = cmp(PW, A);
    // AnalyserNode thấy tín hiệu bên trong graph: so với buffer đầu ra cùng cửa sổ thời gian
    out.analyserVsBuffer = await C.safe(async () => {
      const c = new OAC(1, N, R), a = c.createAnalyser(); a.fftSize = 2048;
      osc(c).connect(a); a.connect(c.destination);
      const td = new Float32Array(2048);
      c.suspend(2048 / R).then(() => { a.getFloatTimeDomainData(td); c.resume(); });
      const buf = ch(await withTimeout(c.startRendering(), 3000, null));
      return cmp(td, buf.subarray(0, 2048));
    });
    // AudioWorklet nhận đúng mẫu đi qua graph: so với buffer đầu ra
    out.workletVsBuffer = await C.safe(async () => {
      const c = new OAC(1, N, R);
      if (!c.audioWorklet) return { na: 'không có audioWorklet' };
      const src = `class Cap extends AudioWorkletProcessor{constructor(){super();this.b=[];this.n=0}process(i,o){const x=i[0]&&i[0][0];if(x){o[0][0].set(x);if(this.n<${N}){this.b.push(Float32Array.from(x));this.n+=x.length;if(this.n>=${N})this.port.postMessage(this.b)}}return true}}registerProcessor('cap',Cap);`;
      const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      await c.audioWorklet.addModule(url);
      const node = new win.AudioWorkletNode(c, 'cap');
      const got = new Promise((res) => { node.port.onmessage = (e) => res(e.data); });
      osc(c).connect(node); node.connect(c.destination);
      const buf = ch(await withTimeout(c.startRendering(), 3000, null));
      const parts = await withTimeout(got, 1500, null);
      if (!parts) return { na: 'worklet không gửi dữ liệu' };
      const cap = new Float32Array(N); let o = 0;
      for (const p of parts) { cap.set(p.subarray(0, Math.min(p.length, N - o)), o); o += p.length; if (o >= N) break; }
      return { insideGraphVsOsc: cmp(cap, A), outputVsInside: cmp(buf, cap) };
    });
    return out;
  }

  // ---------- ClientRects deep-dive: thuộc tính nào bị nhiễu ----------
  function rectDeep(doc) {
    const host = doc.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;margin:0;padding:0;border:0;visibility:hidden;pointer-events:none;overflow:hidden';
    doc.body.appendChild(host);
    const r = C.rng(0x5ec7);
    const q = (max) => Math.round(r() * max * 4) / 4; // bội số 0.25 px
    const props = ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'];
    const hits = Object.fromEntries(props.map((p) => [p, 0]));
    const deltas = [];
    let checked = 0, offEls = 0;
    const els = [];
    for (let i = 0; i < 48; i++) {
      // xen kẽ số nguyên và số lẻ 0.25/0.5/0.75 để biết noise có chọn giá trị lẻ không
      const L = i % 4 === 0 ? Math.round(q(600)) : q(600), T = i % 4 === 1 ? Math.round(q(500)) : q(500);
      const W = 5 + q(150), H = 3 + q(80);
      const e = doc.createElement('div');
      e.style.cssText = `position:absolute;margin:0;padding:0;border:0;box-sizing:border-box;left:${L}px;top:${T}px;width:${W}px;height:${H}px`;
      host.appendChild(e);
      els.push([e, { x: L, y: T, width: W, height: H, left: L, top: T, right: L + W, bottom: T + H }]);
    }
    for (const [e, exp] of els) {
      const b = e.getBoundingClientRect();
      let off = false;
      for (const p of props) {
        checked++;
        if (b[p] !== exp[p]) { hits[p]++; off = true; if (deltas.length < 12) deltas.push(`${p} ${exp[p]}→${b[p]}`); }
      }
      if (off) offEls++;
    }
    // các đường đọc khác trên cùng phần tử lẻ
    const [e0, x0] = els.find(([, x]) => x.y % 1 !== 0) || els[0];
    const cr = e0.getClientRects()[0];
    const range = doc.createRange(); range.selectNode(e0);
    const rg = range.getBoundingClientRect();
    const by = e0.getBoundingClientRect().y;
    host.remove();
    return {
      boxes: els.length, valuesChecked: checked, offValues: Object.values(hits).reduce((a, b) => a + b, 0), offElements: offEls,
      byProp: hits, samples: deltas,
      sameElementOtherPaths: { expectedY: x0.y, bcrY: by, clientRectsY: cr && cr.y, rangeY: rg.y },
      ok: Object.values(hits).every((v) => v === 0),
    };
  }

  // ---------- WebGL realm ----------
  async function webglRealm(doc) {
    const mk = (w, h) => { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; };
    return { webgl: await C.safe(() => C.glSuite(mk, 'webgl', ['toDataURL'])), webgl2: await C.safe(() => C.glSuite(mk, 'webgl2', ['toDataURL'])) };
  }

  // ---------- toàn vẹn hàm (noise native thì vẫn [native code]) ----------
  function integrity() {
    const T = [
      [CanvasRenderingContext2D.prototype, 'getImageData'], [CanvasRenderingContext2D.prototype, 'measureText'],
      [HTMLCanvasElement.prototype, 'toDataURL'], [HTMLCanvasElement.prototype, 'toBlob'],
      [WebGLRenderingContext.prototype, 'readPixels'], [WebGLRenderingContext.prototype, 'getParameter'],
      [Element.prototype, 'getBoundingClientRect'], [Element.prototype, 'getClientRects'], [Range.prototype, 'getBoundingClientRect'],
      [AudioBuffer.prototype, 'getChannelData'], [AudioBuffer.prototype, 'copyFromChannel'], [AnalyserNode.prototype, 'getFloatFrequencyData'],
    ];
    const bad = [];
    for (const [p, k] of T) {
      const f = p[k];
      let s = '';
      try { s = Function.prototype.toString.call(f); } catch (e) { s = 'throw'; }
      if (!/\{\s*\[native code\]\s*\}\s*$/.test(s) || f.name !== k || Object.prototype.hasOwnProperty.call(f, 'prototype')) bad.push(k);
    }
    return { checked: T.length, nonNative: bad, ok: bad.length === 0 };
  }

  function worker() {
    return withTimeout(new Promise((res) => {
      try {
        const w = new Worker('/noise-lab-worker.js');
        w.onmessage = (e) => { res(e.data); w.terminate(); };
        w.onerror = (e) => res({ error: String(e.message || e) });
        w.postMessage({});
      } catch (e) { res({ error: String(e.message || e) }); }
    }), 15000, { error: 'timeout' });
  }

  // ---------- chạy ----------
  status('Đang chạy Canvas (main)…');
  const result = {
    label, createdAt: new Date().toISOString(), href: location.href,
    env: {
      userAgent: navigator.userAgent, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null, languages: Array.from(navigator.languages || []),
      screen: [screen.width, screen.height, screen.availWidth, screen.availHeight, screen.colorDepth], dpr: devicePixelRatio,
      inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight], timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    main: {}, iframe: {}, worker: null,
  };
  result.main.integrity = integrity();
  result.main.canvas = await canvasRealm(document);
  status('Đang chạy WebGL (main)…');
  Object.assign(result.main, await webglRealm(document));
  status('Đang chạy ClientRects (main)…');
  result.main.rects = await rectRealm(document);
  status('Đang chạy Audio (main)…');
  result.main.audio = await audioRealm(window);
  status('Đang chạy Audio/ClientRects deep-dive…');
  result.main.audioDeep = await C.safe(() => audioDeep(window));
  result.main.rectDeep = rectDeep(document);

  status('Đang chạy iframe about:blank…');
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:340px;border:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(fr);
  const fdoc = fr.contentDocument;
  fdoc.open(); fdoc.write('<!doctype html><html><body style="margin:0"></body></html>'); fdoc.close();
  result.iframe.canvas = await canvasRealm(fdoc);
  Object.assign(result.iframe, await webglRealm(fdoc));
  result.iframe.rects = await rectRealm(fdoc);
  result.iframe.audio = await audioRealm(fr.contentWindow);
  fr.remove();

  status('Đang chạy Web Worker…');
  result.worker = await worker();
  result.elapsedMs = Math.round(performance.now() - t0);
  result.findings = summarize(result);

  render(result);
  status(`Xong sau ${result.elapsedMs} ms. Đang lưu…`);
  try {
    const r = await fetch('/api/noise-lab', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) });
    const j = await r.json();
    status(r.ok ? `Đã lưu: data/noise-lab/${j.file} (${result.elapsedMs} ms)` : `Lưu thất bại: ${j.error || r.status}`);
  } catch (e) { status('Không gửi được kết quả về server: ' + e.message); }
  window.__noiseLab = result;

  // ---------- tổng hợp: noise nằm ở đâu ----------
  function summarize(r) {
    const F = [];
    const add = (area, ctx, test, v, detail) => {
      if (v == null) return;
      if (v.na) { F.push({ area, ctx, test, status: 'N/A', detail: v.na }); return; }
      if (v.error) { F.push({ area, ctx, test, status: 'ERROR', detail: v.error }); return; }
      F.push({ area, ctx, test, status: v.ok === false ? 'NOISE' : 'OK', detail: detail ? detail(v) : '' });
    };
    const px = (v) => (v && v.changedPx !== undefined ? `${v.changedPx}/${v.totalPx}px (${(v.ratio * 100).toFixed(2)}%) max±${v.maxDelta} kênh ${v.channels} [${v.hist}]` : '');
    const ctxs = [['main', r.main], ['iframe', r.iframe], ['worker', r.worker || {}]];
    for (const [name, c] of ctxs) {
      const cv = c.canvas || {};
      for (const k of ['solid_16', 'solid_256x128', 'quad_64', 'blank_64']) add('Canvas', name, `${k} getImageData`, cv[k], px);
      for (const k of Object.keys(cv).filter((k) => /putGet/.test(k))) {
        const v = cv[k];
        if (!v || v.error) { add('Canvas', name, k, v); continue; }
        add('Canvas', name, `${k} getImageData`, v.getImageData, px);
        for (const via of ['toDataURL', 'toBlob', 'convertToBlob']) if (v[via]) add('Canvas', name, `${k} ${via}`, v[via], px);
        add('Canvas', name, `${k} drawImage→getImageData`, v.drawImageCopy, px);
        if (v.subRegion) add('Canvas', name, `${k} đọc vùng con = đọc toàn bộ`, { ok: v.subRegion.bytesDiffVsFullRead === 0 }, () => `${v.subRegion.bytesDiffVsFullRead} byte lệch`);
        add('Canvas', name, `${k} 2 canvas cùng nội dung đọc ra giống nhau`, { ok: v.secondCanvasSameRead }, () => '');
      }
      const ts = cv.textScene;
      if (ts && !ts.error) add('Canvas', name, 'textScene lặp lại ổn định', { ok: ts.stable }, () => ts.hashA);
      const m = cv.measure;
      if (m && !m.error) {
        add('TextMetrics', name, 'measureText monospace tuyến tính', { ok: m.monoLinear }, () => `Δ ${m.monoLinearityDelta.join(', ')}`);
        add('TextMetrics', name, 'measureText đo lặp ổn định', { ok: m.repeatStable }, () => `width ${m.arial16.width}`);
      }
      for (const kind of ['webgl', 'webgl2']) {
        const g = c[kind];
        if (!g || g.supported === false) continue;
        if (g.error) { add('WebGL', name, kind, g); continue; }
        add('WebGL', name, `${kind} clear readPixels`, g.clearReadPixels, px);
        for (const via of ['toDataURL', 'convertToBlob']) if (g[`clear_${via}`]) add('WebGL', name, `${kind} clear ${via}`, g[`clear_${via}`], px);
        add('WebGL', name, `${kind} shader màu đặc readPixels`, g.solidShaderReadPixels, px);
        add('WebGL', name, `${kind} readPixels lặp lại`, { ok: g.gradientRereadSame }, () => g.gradientHash);
        for (const via of ['toDataURL', 'convertToBlob']) {
          const v = g[`gradient_${via}`];
          if (v && !v.error) add('WebGL', name, `${kind} readPixels = ${via}`, { ok: v.vsReadPixels === '0px' }, () => `${v.vsReadPixels} lệch, max±${v.maxDelta}`);
        }
      }
      const rc = c.rects;
      if (rc) for (const [k, v] of Object.entries(rc)) if (v && ('ok' in v || v.error || v.na)) add('ClientRects', name, k, v, (x) => JSON.stringify(x.observed ?? x.samples ?? x.delta ?? '').slice(0, 90));
      const au = c.audio;
      if (au && au.supported) {
        for (const k of ['constant', 'silence', 'passthrough', 'gain', 'bufferWriteRead']) {
          const v = au[k];
          if (!v || v.error) { add('Audio', name, k, v); continue; }
          add('Audio', name, `${k} getChannelData`, v.getChannelData, (x) => `${x.changed}/${x.of} mẫu, max ${x.maxAbsDelta.toExponential(2)}`);
          add('Audio', name, `${k} copyFromChannel`, v.copyFromChannel, (x) => `${x.changed}/${x.of} mẫu, max ${x.maxAbsDelta.toExponential(2)}`);
        }
        const d = au.dynamicsFP;
        if (d) {
          add('Audio', name, 'dynamicsFP render 2 lần giống nhau', { ok: d.renderStable }, () => `${d.sumA} / ${d.sumB}`);
          add('Audio', name, 'dynamicsFP getChannelData = copyFromChannel', { ok: d.getVsCopyDiff === 0 }, () => `${d.getVsCopyDiff} mẫu lệch`);
        }
        if (au.analyser) add('Audio', name, 'AnalyserNode ổn định', { ok: au.analyser.stable }, () => JSON.stringify(au.analyser.a).slice(0, 80));
      }
    }
    // chéo ngữ cảnh: cùng phép đo phải ra cùng hash ở main / iframe / worker
    const cross = (test, get) => {
      const vals = ctxs.map(([n, c]) => [n, get(c)]).filter(([, v]) => v != null);
      if (vals.length < 2) return;
      const ok = vals.every(([, v]) => v === vals[0][1]);
      F.push({ area: 'Cross-context', ctx: vals.map(([n]) => n).join('/'), test, status: ok ? 'OK' : 'NOISE', detail: vals.map(([n, v]) => `${n}=${String(v).slice(0, 18)}`).join(' ') });
    };
    cross('Canvas putGet 128x64 hash', (c) => c.canvas && c.canvas.putGet_128x64 && c.canvas.putGet_128x64.readHash);
    cross('Canvas textScene hash', (c) => c.canvas && c.canvas.textScene && c.canvas.textScene.hashA);
    cross('WebGL gradient readPixels hash', (c) => c.webgl && c.webgl.gradientHash);
    cross('WebGL params hash', (c) => c.webgl && c.webgl.paramsHash);
    cross('WebGL UNMASKED_RENDERER', (c) => c.webgl && c.webgl.params && c.webgl.params.UNMASKED_RENDERER);
    cross('measureText Arial 16 width', (c) => c.canvas && c.canvas.measure && c.canvas.measure.arial16 && c.canvas.measure.arial16.width);
    cross('Span text width (DOM)', (c) => c.rects && c.rects.textSpan && c.rects.textSpan.observed[2]);
    cross('Audio dynamicsFP hash', (c) => c.audio && c.audio.dynamicsFP && c.audio.dynamicsFP.hashA);
    const ad = r.main.audioDeep || {};
    if (ad.wavePeak) add('AudioDeep', 'main', 'wavetable đỉnh = 1.0', ad.wavePeak, (x) => String(x.value));
    for (const k of ['antisym_sine', 'antisym_triangle', 'antisym_square', 'periodic_sine', 'periodic_triangle', 'periodic_square', 'periodic_sawtooth', 'gainHalf', 'twoOscSum', 'prefixInvariance', 'oscFreqZero', 'periodicWaveVsSine', 'analyserVsBuffer']) add('AudioDeep', 'main', k, ad[k], (x) => `${x.changed}/${x.of} mẫu, max ${x.maxAbsDelta}`);
    if (ad.workletVsBuffer && !ad.workletVsBuffer.error && !ad.workletVsBuffer.na) {
      add('AudioDeep', 'main', 'worklet thấy = osc buffer', ad.workletVsBuffer.insideGraphVsOsc, (x) => `${x.changed}/${x.of} mẫu, max ${x.maxAbsDelta}`);
      add('AudioDeep', 'main', 'buffer đầu ra = worklet thấy', ad.workletVsBuffer.outputVsInside, (x) => `${x.changed}/${x.of} mẫu, max ${x.maxAbsDelta}`);
    } else add('AudioDeep', 'main', 'workletVsBuffer', ad.workletVsBuffer);
    if (r.main.rectDeep) add('ClientRects', 'main', 'rectDeep 48 hộp toạ độ 0.25px', r.main.rectDeep, (x) => `${x.offValues}/${x.valuesChecked} giá trị lệch, ${x.offElements} hộp; ${JSON.stringify(x.byProp)}`);
    F.push({ area: 'Integrity', ctx: 'main', test: 'Hàm native (toString/name/prototype)', status: r.main.integrity.ok ? 'OK' : 'NOISE', detail: r.main.integrity.nonNative.join(', ') });
    return F;
  }

  function render(r) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const noise = r.findings.filter((f) => f.status === 'NOISE');
    const byArea = {};
    for (const f of noise) byArea[f.area] = (byArea[f.area] || 0) + 1;
    $('#summary').innerHTML = `<div class="kpis">${['Canvas', 'WebGL', 'ClientRects', 'TextMetrics', 'Audio', 'AudioDeep', 'Cross-context'].map((a) =>
      `<div class="kpi ${byArea[a] ? 'bad' : 'good'}"><b>${byArea[a] || 0}</b><span>${a}</span></div>`).join('')}</div>
      <p class="muted">label <code>${esc(r.label)}</code> · ${r.findings.length} phép thử · ${noise.length} lệch đáp án · ${esc(r.env.userAgent)}</p>`;
    const rows = r.findings
      .sort((a, b) => (a.status === 'NOISE' ? 0 : 1) - (b.status === 'NOISE' ? 0 : 1))
      .map((f) => `<tr class="${f.status.toLowerCase()}"><td><span class="pill">${f.status}</span></td><td>${esc(f.area)}</td><td>${esc(f.ctx)}</td><td>${esc(f.test)}</td><td><code>${esc(f.detail || '')}</code></td></tr>`).join('');
    $('#table').innerHTML = `<table><thead><tr><th>Kết quả</th><th>Nhóm</th><th>Ngữ cảnh</th><th>Phép thử</th><th>Chi tiết</th></tr></thead><tbody>${rows}</tbody></table>`;
    $('#raw').textContent = JSON.stringify(r, null, 2);
  }
})();
