/* Noise Lab: chạy cùng bộ phép thử trong Web Worker (OffscreenCanvas). Antidetect hay quên vá ngữ cảnh này. */
importScripts('/noise-lab-core.js');
const C = self.NLCore;

self.onmessage = async () => {
  const n = self.navigator;
  const out = {
    navigator: { userAgent: n.userAgent, platform: n.platform, hardwareConcurrency: n.hardwareConcurrency, deviceMemory: n.deviceMemory ?? null, languages: Array.from(n.languages || []) },
  };
  if (typeof OffscreenCanvas === 'undefined') { out.offscreen = false; self.postMessage(out); return; }
  const mk = (w, h) => new OffscreenCanvas(w, h);
  const enc = ['convertToBlob'];
  out.canvas = {
    solid_16: C.canvasSolid(mk, 16, 16),
    quad_64: C.canvasQuad(mk, 64, 64),
    putGet_64x64: await C.safe(() => C.canvasPutGet(mk, 64, 64, 0x1234, enc)),
    putGet_128x64: await C.safe(() => C.canvasPutGet(mk, 128, 64, 0xbeef, enc)),
    textScene: await C.safe(() => C.canvasTextScene(mk, enc)),
    measure: await C.safe(() => C.measureSuite(mk)),
  };
  out.webgl = await C.safe(() => C.glSuite(mk, 'webgl', enc));
  out.webgl2 = await C.safe(() => C.glSuite(mk, 'webgl2', enc));
  self.postMessage(out);
};
