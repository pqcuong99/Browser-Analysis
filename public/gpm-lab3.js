/* GPM Lab vòng 3: kiểm chứng các phép thử có đáp án sẽ đưa vào probe.js. */
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const out = {};

// T1: glyph đầu của 'HH' phải giống hệt 'H' (cùng toạ độ), cả fill lẫn stroke, nhiều font
{
  const res = [];
  for (const [g, font] of [['H', '40px Arial'], ['W', '32px Verdana'], ['m', '36px Times New Roman'], ['E', '30px Georgia'], ['A', '28px Courier New']]) {
    const W = 160, Hh = 64;
    const draw = (t, stroke) => { const c = mk(W, Hh), x = c.getContext('2d'); x.font = font; x.textBaseline = 'alphabetic'; if (stroke) { x.lineWidth = 1; x.strokeText(t, 7, 46); } else x.fillText(t, 7, 46); return { d: x.getImageData(0, 0, W, Hh).data, adv: x.measureText(g).width, m: x.measureText(g) }; };
    for (const stroke of [false, true]) {
      const one = draw(g, stroke), two = draw(g + g, stroke);
      const limit = Math.floor(7 + one.adv - 1); // cột trước glyph thứ 2
      // giới hạn thêm: không vượt mép phải của mực glyph 1 + 1
      let diff = 0, inkCols = 0;
      for (let x = 0; x < limit; x++) { let has = false; for (let y = 0; y < Hh; y++) { const i = (y * W + x) * 4 + 3; if (one.d[i] !== two.d[i]) diff++; if (one.d[i]) has = true; } if (has) inkCols++; }
      // 2nd glyph phải bắt đầu sau cột limit
      res.push({ g, font, stroke, limit, diffBytes: diff, inkCols });
    }
  }
  out.glyphRun = res;
}

// T2: gradient tuyến tính ngang: mọi hàng như nhau; giá trị so với công thức
{
  const c = mk(64, 8), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, '#ff0000'); g.addColorStop(1, '#0000ff'); x.fillStyle = g; x.fillRect(0, 0, 64, 8);
  const d = x.getImageData(0, 0, 64, 8).data;
  let rowsDiff = 0; for (let y = 1; y < 8; y++) for (let i = 0; i < 64 * 4; i++) if (d[y * 256 + i] !== d[i]) rowsDiff++;
  const r = [], b = []; for (let i = 0; i < 64; i++) { r.push(d[i * 4]); b.push(d[i * 4 + 2]); }
  // r + b phải = 255 (nội suy tuyến tính giữa 2 màu bù)
  const sumOff = r.map((v, i) => v + b[i] - 255).filter((v) => Math.abs(v) > 1).length;
  out.linear = { rowsDiff, r: r.join(','), sumOff };
  // gradient 2 điểm dừng cùng màu: phải ra màu đặc
  const c2 = mk(32, 4), y = c2.getContext('2d'); const g2 = y.createLinearGradient(0, 0, 32, 0); g2.addColorStop(0, 'rgb(10,200,30)'); g2.addColorStop(1, 'rgb(10,200,30)'); y.fillStyle = g2; y.fillRect(0, 0, 32, 4);
  const d2 = y.getImageData(0, 0, 32, 4).data; let so = 0; for (let i = 0; i < d2.length; i += 4) if (d2[i] !== 10 || d2[i + 1] !== 200 || d2[i + 2] !== 30 || d2[i + 3] !== 255) so++;
  out.flatGradientOff = so;
  // radial đối xứng
  const c3 = mk(64, 64), z = c3.getContext('2d'); const g3 = z.createRadialGradient(32, 32, 2, 32, 32, 30); g3.addColorStop(0, '#ff0'); g3.addColorStop(1, '#00f'); z.fillStyle = g3; z.fillRect(0, 0, 64, 64);
  const d3 = z.getImageData(0, 0, 64, 64).data; let asym = 0, maxd = 0;
  for (let yy = 0; yy < 64; yy++) for (let xx = 0; xx < 32; xx++) for (let k = 0; k < 3; k++) { const a = d3[(yy * 64 + xx) * 4 + k], bb = d3[(yy * 64 + 63 - xx) * 4 + k]; if (a !== bb) { asym++; maxd = Math.max(maxd, Math.abs(a - bb)); } }
  let asymV = 0; for (let yy = 0; yy < 32; yy++) for (let xx = 0; xx < 64; xx++) for (let k = 0; k < 3; k++) if (d3[(yy * 64 + xx) * 4 + k] !== d3[((63 - yy) * 64 + xx) * 4 + k]) asymV++;
  // transpose: (x,y) ↔ (y,x)
  let asymT = 0; for (let yy = 0; yy < 64; yy++) for (let xx = 0; xx < 64; xx++) for (let k = 0; k < 3; k++) if (d3[(yy * 64 + xx) * 4 + k] !== d3[(xx * 64 + yy) * 4 + k]) asymT++;
  out.radial = { asymH: asym, asymV, asymT, maxd, center: Array.from(d3.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)), edge: Array.from(d3.slice((32 * 64 + 2) * 4, (32 * 64 + 2) * 4 + 4)) };
  // linear gradient chéo: đối xứng qua đường chéo phụ
  const c4 = mk(32, 32), w = c4.getContext('2d'); const g4 = w.createLinearGradient(0, 0, 32, 0); g4.addColorStop(0, '#000'); g4.addColorStop(1, '#fff'); w.fillStyle = g4; w.fillRect(0, 0, 32, 32);
  const d4 = w.getImageData(0, 0, 32, 1).data; const grey = []; for (let i = 0; i < 32; i++) grey.push(d4[i * 4]);
  // đen→trắng: pixel i và 31-i phải cộng = 255 (±1)
  out.greyMirror = grey.map((v, i) => v + grey[31 - i] - 255).filter((v) => Math.abs(v) > 1).length;
  out.grey = grey.join(',');
}

// T3: WebGL varying vs gl_FragCoord ở nhiều kích thước + WEBGL_debug_shaders
{
  const prog = (g, vs, fs) => { const sh = (t, s) => { const o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); return o; }; const p = g.createProgram(); const v = sh(g.VERTEX_SHADER, vs); g.attachShader(p, v); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs)); g.linkProgram(p); g.useProgram(p); return { p, v }; };
  const res = [];
  for (const n of [16, 32, 64, 100]) {
    const c = mk(n, n), g = c.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
    const { p, v } = prog(g, 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}', `precision highp float;varying vec2 v;void main(){gl_FragColor=vec4(v.x,gl_FragCoord.x/${n}.,v.y,gl_FragCoord.y/${n}.);}`);
    const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    const l = g.getAttribLocation(p, 'p'); g.enableVertexAttribArray(l); g.vertexAttribPointer(l, 2, g.FLOAT, false, 0, 0); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    const a = new Uint8Array(n * n * 4); g.readPixels(0, 0, n, n, g.RGBA, g.UNSIGNED_BYTE, a);
    let off = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== a[i + 1] || a[i + 2] !== a[i + 3]) off++;
    const dbg = g.getExtension('WEBGL_debug_shaders');
    res.push({ n, off, of: n * n, translated: dbg ? dbg.getTranslatedShaderSource(v).length : null, src: g.getShaderSource(v).length });
    if (dbg && n === 16) out.translatedVS = dbg.getTranslatedShaderSource(v).slice(0, 4000);
  }
  out.varying = res;
  // WebGL2
  const c = mk(32, 32), g = c.getContext('webgl2', { antialias: false });
  if (g) {
    const { p } = prog(g, '#version 300 es\nin vec2 p;out vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}', '#version 300 es\nprecision highp float;in vec2 v;out vec4 o;void main(){o=vec4(v.x,gl_FragCoord.x/32.,v.y,gl_FragCoord.y/32.);}');
    const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    const l = g.getAttribLocation(p, 'p'); g.enableVertexAttribArray(l); g.vertexAttribPointer(l, 2, g.FLOAT, false, 0, 0); g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    const a = new Uint8Array(32 * 32 * 4); g.readPixels(0, 0, 32, 32, g.RGBA, g.UNSIGNED_BYTE, a);
    let off = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== a[i + 1] || a[i + 2] !== a[i + 3]) off++;
    out.varyingWebGL2 = { off, of: 1024 };
  }
}

// T4: WebGPU chi tiết
try {
  const ad = await navigator.gpu.requestAdapter();
  const i = ad.info;
  out.webgpu = { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, subgroupMinSize: i.subgroupMinSize, subgroupMaxSize: i.subgroupMaxSize, isFallback: i.isFallbackAdapter,
    features: [...ad.features].sort(), limits: Object.fromEntries(['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxTextureDimension2D', 'maxBindGroups', 'maxColorAttachmentBytesPerSample', 'minUniformBufferOffsetAlignment', 'maxInterStageShaderVariables'].map((k) => [k, ad.limits[k]])) };
} catch (e) { out.webgpu = { error: String(e) }; }
return out;
