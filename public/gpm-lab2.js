/* GPM Lab vòng 2: tách cơ chế noise Canvas text / shapes, WebGL attribute, Audio compressor, giới hạn uniform. */
const H = (arr) => { let h = 0x811c9dc5; for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const out = { text: [], shapes: {}, webgl: {}, audio: {} };

// ---------- Text: mép mực so với measureText ----------
const inkOf = (d, W, Hh) => { let l = 1e9, r = -1, t = 1e9, b = -1; for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; } return [l, t, r, b]; };
const centroid = (d, W, Hh) => { let sx = 0, sy = 0, s = 0; for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const a = d[(y * W + x) * 4 + 3]; sx += a * x; sy += a * y; s += a; } return [+(sx / s).toFixed(4), +(sy / s).toFixed(4), s]; };
for (const [txt, font, x0, y0] of [['H', '40px Arial', 10, 45], ['|', '40px Arial', 10, 45], ['Hx', '40px Arial', 10, 45], ['Hxg', '40px Arial', 10, 45], ['Hxg', '40px Arial', 10.5, 45.5], ['Hxg', '20px Times New Roman', 10, 45], ['WWW', '30px Verdana', 10, 45], ['iii', '40px Arial', 10, 45], ['■', '40px Arial', 10, 45]]) {
  const W = 200, Hh = 64, c = mk(W, Hh), x = c.getContext('2d');
  x.font = font; x.fillStyle = '#000'; x.fillText(txt, x0, y0);
  const d = x.getImageData(0, 0, W, Hh).data, m = x.measureText(txt);
  // strokeText cùng chữ
  const c2 = mk(W, Hh), y = c2.getContext('2d'); y.font = font; y.strokeStyle = '#000'; y.lineWidth = 1; y.strokeText(txt, x0, y0);
  const c3 = mk(W, Hh), z = c3.getContext('2d'); z.font = font; z.fillStyle = '#000'; z.fillText(txt, x0, y0, 5000); // maxWidth lớn: không co
  out.text.push({ txt, font, at: [x0, y0], hash: H(d), ink: inkOf(d, W, Hh), centroid: centroid(d, W, Hh), stroke: centroid(y.getImageData(0, 0, W, Hh).data, W, Hh), maxWidthSame: H(z.getImageData(0, 0, W, Hh).data) === H(d),
    pred: [x0 - m.actualBoundingBoxLeft, y0 - m.actualBoundingBoxAscent, x0 + m.actualBoundingBoxRight, y0 + m.actualBoundingBoxDescent] });
}
// text trong OffscreenCanvas và textAlign/baseline khác
{
  const o = new OffscreenCanvas(200, 64), x = o.getContext('2d'); x.font = '40px Arial'; x.fillText('Hxg', 10, 45);
  out.textOffscreen = centroid(x.getImageData(0, 0, 200, 64).data, 200, 64);
  const c = mk(200, 64), y = c.getContext('2d'); y.font = '40px Arial'; y.textAlign = 'center'; y.textBaseline = 'top'; y.fillText('Hxg', 100, 10);
  out.textCenterTop = centroid(y.getImageData(0, 0, 200, 64).data, 200, 64);
}

// ---------- Shapes: tách từng loại ----------
{
  const S = out.shapes;
  const one = (fn) => { const c = mk(64, 64), x = c.getContext('2d'); fn(x); return H(x.getImageData(0, 0, 64, 64).data); };
  S.arc = one((x) => { x.fillStyle = '#c33'; x.beginPath(); x.arc(32, 32, 20.3, 0, 6.2); x.fill(); });
  S.arcInt = one((x) => { x.fillStyle = '#c33'; x.beginPath(); x.arc(32, 32, 20, 0, Math.PI * 2); x.fill(); });
  S.bezier = one((x) => { x.strokeStyle = '#33c'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(3, 5); x.bezierCurveTo(60, 2, 2, 60, 61, 59); x.stroke(); });
  S.gradient = one((x) => { const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, '#f00'); g.addColorStop(1, '#00f'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  S.radial = one((x) => { const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, '#ff0'); g.addColorStop(1, '#00f'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  S.fracRect = one((x) => { x.fillStyle = '#0a0'; x.fillRect(10.5, 2.25, 7.5, 3.75); });
  S.lineInt = one((x) => { x.strokeStyle = '#000'; x.lineWidth = 2; x.beginPath(); x.moveTo(4, 4); x.lineTo(60, 4); x.stroke(); });
  S.composite = one((x) => { x.fillStyle = '#f00'; x.fillRect(0, 0, 40, 40); x.globalCompositeOperation = 'multiply'; x.fillStyle = '#0f0'; x.fillRect(20, 20, 40, 40); });
  S.combo1 = one((x) => { x.fillStyle = '#c33'; x.beginPath(); x.arc(32, 32, 20.3, 0, 6.2); x.fill(); x.strokeStyle = '#33c'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(3, 5); x.bezierCurveTo(60, 2, 2, 60, 61, 59); x.stroke(); });
  // lặp 5 lần: noise có ngẫu nhiên theo lần gọi?
  S.arcRepeat = new Set(Array.from({ length: 5 }, () => one((x) => { x.fillStyle = '#c33'; x.beginPath(); x.arc(32, 32, 20.3, 0, 6.2); x.fill(); }))).size;
}

// ---------- WebGL ----------
{
  const W = out.webgl;
  const prog = (g, vs, fs) => { const sh = (t, s) => { const o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o)); return o; }; const p = g.createProgram(); g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs)); g.linkProgram(p); g.useProgram(p); return p; };
  const read = (g, w, h) => { const a = new Uint8Array(w * h * 4); g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, a); return a; };
  // A) varying v.x so với gl_FragCoord.x/64 ở cùng pixel: R = v.x, G = fragCoord.x/64, B = v.y, A=1 … phải R==G
  {
    const c = mk(64, 64), g = c.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
    const p = prog(g, 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}', 'precision highp float;varying vec2 v;void main(){gl_FragColor=vec4(v.x,gl_FragCoord.x/64.,v.y,gl_FragCoord.y/64.);}');
    const data = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    const l = g.getAttribLocation(p, 'p'); g.enableVertexAttribArray(l); g.vertexAttribPointer(l, 2, g.FLOAT, false, 0, 0); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    const a = read(g, 64, 64); let offX = 0, offY = 0, mx = 0;
    for (let i = 0; i < a.length; i += 4) { if (a[i] !== a[i + 1]) offX++; if (a[i + 2] !== a[i + 3]) offY++; mx = Math.max(mx, Math.abs(a[i] - a[i + 1]), Math.abs(a[i + 2] - a[i + 3])); }
    W.varyingVsFragCoord = { offX, offY, maxDelta: mx, of: 4096 };
    W.bufferDataArgUntouched = Array.from(data).join(',');
  }
  // B) cùng phép thử nhưng toạ độ đi qua uniform thay vì attribute (vị trí từ gl_VertexID không có ở WebGL1 → dùng attribute index)
  {
    const c = mk(64, 64), g = c.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
    const p = prog(g, 'attribute float i;uniform vec2 P[4];varying vec2 v;void main(){vec2 q=P[int(i)];v=q*.5+.5;gl_Position=vec4(q,0.,1.);}', 'precision highp float;varying vec2 v;void main(){gl_FragColor=vec4(v.x,gl_FragCoord.x/64.,v.y,gl_FragCoord.y/64.);}');
    g.uniform2fv(g.getUniformLocation(p, 'P'), [-1, -1, 1, -1, -1, 1, 1, 1]);
    const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 1, 2, 3]), g.STATIC_DRAW);
    const l = g.getAttribLocation(p, 'i'); g.enableVertexAttribArray(l); g.vertexAttribPointer(l, 1, g.FLOAT, false, 0, 0); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    const a = read(g, 64, 64); let off = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== a[i + 1] || a[i + 2] !== a[i + 3]) off++;
    W.uniformPosVsFragCoord = { off, of: 4096 };
  }
  // C) WebGL2 getBufferSubData: buffer lưu trên GPU có bị đổi?
  {
    const c = mk(4, 4), g = c.getContext('webgl2');
    if (g) {
      const src = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1, 0.25, 0.5]);
      const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, src, g.STATIC_DRAW);
      const back = new Float32Array(src.length); g.getBufferSubData(g.ARRAY_BUFFER, 0, back);
      W.getBufferSubData = { equal: Array.from(back).every((v, i) => v === src[i]), back: Array.from(back) };
      // transform feedback: vertex shader chép attribute ra → đọc lại
      try {
        const vs = '#version 300 es\nin vec2 p;out vec2 o;void main(){o=p;gl_Position=vec4(p,0.,1.);}', fs = '#version 300 es\nprecision highp float;out vec4 c;void main(){c=vec4(1.);}';
        const sh = (t, s) => { const o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); return o; };
        const p = g.createProgram(); g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs));
        g.transformFeedbackVaryings(p, ['o'], g.INTERLEAVED_ATTRIBS); g.linkProgram(p); g.useProgram(p);
        const vb = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, vb); g.bufferData(g.ARRAY_BUFFER, src.subarray(0, 8), g.STATIC_DRAW);
        const l = g.getAttribLocation(p, 'p'); g.enableVertexAttribArray(l); g.vertexAttribPointer(l, 2, g.FLOAT, false, 0, 0);
        const tb = g.createBuffer(); g.bindBuffer(g.TRANSFORM_FEEDBACK_BUFFER, tb); g.bufferData(g.TRANSFORM_FEEDBACK_BUFFER, 32, g.STREAM_READ);
        const tf = g.createTransformFeedback(); g.bindTransformFeedback(g.TRANSFORM_FEEDBACK, tf); g.bindBufferBase(g.TRANSFORM_FEEDBACK_BUFFER, 0, tb);
        g.enable(g.RASTERIZER_DISCARD); g.beginTransformFeedback(g.POINTS); g.drawArrays(g.POINTS, 0, 4); g.endTransformFeedback(); g.disable(g.RASTERIZER_DISCARD);
        const r = new Float32Array(8); g.getBufferSubData(g.TRANSFORM_FEEDBACK_BUFFER, 0, r);
        W.transformFeedback = Array.from(r);
      } catch (e) { W.transformFeedback = { error: String(e) }; }
    }
  }
  // D) giới hạn uniform thật so với giá trị khai báo
  {
    const g = mk(4, 4).getContext('webgl');
    const link = (vsN, fsN) => {
      const v = g.createShader(g.VERTEX_SHADER); g.shaderSource(v, vsN ? `uniform vec4 u[${vsN}];void main(){vec4 s=vec4(0.);for(int i=0;i<${vsN};i++)s+=u[i];gl_Position=s;}` : 'void main(){gl_Position=vec4(0.);}'); g.compileShader(v);
      const f = g.createShader(g.FRAGMENT_SHADER); g.shaderSource(f, fsN ? `precision mediump float;uniform vec4 u[${fsN}];void main(){vec4 s=vec4(0.);for(int i=0;i<${fsN};i++)s+=u[i];gl_FragColor=s;}` : 'void main(){gl_FragColor=vec4(1.);}'); g.compileShader(f);
      if (!g.getShaderParameter(v, g.COMPILE_STATUS) || !g.getShaderParameter(f, g.COMPILE_STATUS)) return false;
      const p = g.createProgram(); g.attachShader(p, v); g.attachShader(p, f); g.linkProgram(p); return !!g.getProgramParameter(p, g.LINK_STATUS);
    };
    const mv = g.getParameter(g.MAX_VERTEX_UNIFORM_VECTORS), mf = g.getParameter(g.MAX_FRAGMENT_UNIFORM_VECTORS);
    W.uniformLimit = { declaredVS: mv, vsAtDeclared: link(mv, 0), vsAtDeclaredPlus1: link(mv + 1, 0), vs4096: link(4096, 0), vs4097: link(4097, 0), declaredFS: mf, fsAtDeclared: link(0, mf), fsAtDeclaredPlus1: link(0, mf + 1) };
  }
}

// ---------- Audio: DynamicsCompressor ----------
{
  const A = out.audio, R = 44100, N = 5000;
  const render = async (setup, len = N) => { const ctx = new OfflineAudioContext(1, len, R); setup(ctx); return (await ctx.startRendering()).getChannelData(0); };
  const bufSrc = (c, fill) => { const b = c.createBuffer(1, N, R); const d = b.getChannelData(0); for (let i = 0; i < N; i++) d[i] = fill(i); const s = c.createBufferSource(); s.buffer = b; s.start(0); return s; };
  const comp = (c, opt) => { const k = c.createDynamicsCompressor(); for (const [n, v] of Object.entries(opt)) k[n].value = v; return k; };
  const FP = { threshold: -50, knee: 40, ratio: 12, attack: 0, release: 0.25 };
  const stats = (d) => { let s = 0, nz = 0, first = -1; for (let i = 0; i < d.length; i++) { s += Math.abs(d[i]); if (d[i] !== 0) { nz++; if (first < 0) first = i; } } return { sumAbs: s, nonZero: nz, firstNonZero: first, s4500: d[4500], s4999: d[4999] }; };
  // im lặng qua compressor phải ra 0
  A.silence = stats(await render((c) => { const s = bufSrc(c, () => 0); const k = comp(c, FP); s.connect(k); k.connect(c.destination); }));
  // sine qua compressor với tham số fingerprint
  const sine = (i) => Math.sin(2 * Math.PI * 1000 * i / R) * 0.5;
  const fp = await render((c) => { const s = bufSrc(c, sine); const k = comp(c, FP); s.connect(k); k.connect(c.destination); });
  A.sineFP = stats(fp);
  // compressor "trung tính": threshold 0, ratio 1, knee 0 ⇒ chỉ trễ (pre-delay) + makeup = 1?
  const neutral = await render((c) => { const s = bufSrc(c, sine); const k = comp(c, { threshold: 0, knee: 0, ratio: 1, attack: 0, release: 0.25 }); s.connect(k); k.connect(c.destination); });
  // tìm độ trễ khớp nhất với input
  let best = null;
  for (let lag = 0; lag < 600; lag++) { let mx = 0; for (let i = 1000; i < 4000; i++) mx = Math.max(mx, Math.abs(neutral[i] - Math.fround(sine(i - lag)))); if (!best || mx < best.mx) best = { lag, mx }; }
  A.neutral = { ...stats(neutral), bestLag: best.lag, maxDiffAtLag: best.mx };
  // ratio giữa 2 lần render với biên độ x2 (compressor không tuyến tính, chỉ để so profile)
  A.sineFP_amp2 = stats(await render((c) => { const s = bufSrc(c, (i) => sine(i) * 2); const k = comp(c, FP); s.connect(k); k.connect(c.destination); }));
  // reduction sau render
  {
    const ctx = new OfflineAudioContext(1, N, R); const s = bufSrc(ctx, sine); const k = comp(ctx, FP); s.connect(k); k.connect(ctx.destination); await ctx.startRendering(); A.reduction = k.reduction;
  }
  // mẫu đầu ra từng đoạn để xem noise nhân hay cộng (so với p3 ở bước phân tích)
  A.fpSamples = Array.from(fp.subarray(4000, 4010));
  A.neutralSamples = Array.from(neutral.subarray(4000, 4010));
}
return out;
