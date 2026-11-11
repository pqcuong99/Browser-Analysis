/*!
 * SentinelFP Proof-of-Work client
 * Tìm nonce sao cho SHA-256(prefix + ":" + nonce) có `difficulty` bit 0 đầu tiên.
 * Chạy trong Web Worker với SHA-256 thuần JS (1 block) để không khóa giao diện.
 */
(() => {
  'use strict';

  const WORKER_SRC = `
const K = new Uint32Array([
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const W = new Uint32Array(64);
const block = new Uint8Array(64);
const ror = (x, n) => (x >>> n) | (x << (32 - n));
// SHA-256 của thông điệp < 56 byte (1 block), trả về word đầu tiên của digest
function h0(len) {
  block.fill(0, len);
  block[len] = 0x80;
  const bits = len * 8;
  block[62] = (bits >>> 8) & 0xff; block[63] = bits & 0xff;
  for (let i = 0; i < 16; i++) W[i] = (block[i*4] << 24) | (block[i*4+1] << 16) | (block[i*4+2] << 8) | block[i*4+3];
  for (let i = 16; i < 64; i++) {
    const a = W[i-15], b = W[i-2];
    W[i] = (W[i-16] + (ror(a,7) ^ ror(a,18) ^ (a >>> 3)) + W[i-7] + (ror(b,17) ^ ror(b,19) ^ (b >>> 10))) | 0;
  }
  let a=0x6a09e667,b=0xbb67ae85,c=0x3c6ef372,d=0xa54ff53a,e=0x510e527f,f=0x9b05688c,g=0x1f83d9ab,h=0x5be0cd19;
  for (let i = 0; i < 64; i++) {
    const t1 = (h + (ror(e,6) ^ ror(e,11) ^ ror(e,25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const t2 = ((ror(a,2) ^ ror(a,13) ^ ror(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  return (0x6a09e667 + a) >>> 0;
}
self.onmessage = (ev) => {
  const { prefix, difficulty } = ev.data;
  const base = new TextEncoder().encode(prefix + ':');
  block.set(base, 0);
  const mask = difficulty >= 32 ? 0 : (0xffffffff << (32 - difficulty)) >>> 0;
  const t0 = performance.now();
  for (let n = 0; ; n++) {
    const s = n.toString(36);
    for (let i = 0; i < s.length; i++) block[base.length + i] = s.charCodeAt(i);
    if ((h0(base.length + s.length) & mask) === 0) {
      self.postMessage({ done: true, nonce: s, hashes: n + 1, ms: Math.round(performance.now() - t0) });
      return;
    }
    if ((n & 0xffff) === 0 && n) self.postMessage({ done: false, hashes: n, ms: Math.round(performance.now() - t0) });
  }
};`;

  async function json(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(body.message || body.error || 'HTTP ' + res.status); e.code = body.error; e.status = res.status; throw e; }
    return body;
  }

  /**
   * Lấy challenge, giải trong Worker, gửi lời giải.
   * onProgress({ hashes, expected, ms, difficulty })
   */
  async function solve(opts = {}) {
    const base = opts.endpoint || '';
    const ch = await json(await fetch(base + '/api/pow/challenge', { credentials: 'include', cache: 'no-store' }));
    const expected = 2 ** ch.difficulty;
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
    const worker = new Worker(url);
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('Proof-of-Work quá thời gian')), (ch.expiresIn - 5) * 1000);
        worker.onerror = (e) => { clearTimeout(to); reject(new Error(e.message || 'Worker lỗi')); };
        worker.onmessage = (e) => {
          const m = e.data;
          if (opts.onProgress) try { opts.onProgress({ hashes: m.hashes, expected, ms: m.ms, difficulty: ch.difficulty }); } catch {}
          if (m.done) { clearTimeout(to); resolve(m); }
        };
        worker.postMessage({ prefix: ch.prefix, difficulty: ch.difficulty });
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
    const v = await json(await fetch(base + '/api/pow/verify', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ch.id, nonce: result.nonce, hashes: result.hashes, elapsedMs: result.ms }),
    }));
    return { ...v, hashes: result.hashes, ms: result.ms, difficulty: ch.difficulty };
  }

  window.SentinelPoW = { solve };
})();
