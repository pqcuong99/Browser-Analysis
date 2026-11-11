/**
 * Điều khiển các profile antidetect (GPM Login, …) qua cổng --remote-debugging-port để tự chạy phép thử.
 * Không bật Runtime.enable / Debugger (tránh tự kích hoạt AUTO_04): chỉ Target + Runtime.evaluate.
 *
 *   node scripts/cdp-run.ts lab  gpm-p1=42000 gpm-p2=42001 gpm-p3=42002   → Noise Lab, lưu data/noise-lab/
 *   node scripts/cdp-run.ts scan gpm-p1=42000 …                           → quét thật SentinelFP, in Trust/quyết định
 *   node scripts/cdp-run.ts eval public/gpm-lab.js gpm-p1=42000 …         → chạy file JS trong trang, lưu data/cdp/<label>_<file>.json
 *
 * BASE=http://127.0.0.1:3000 (mặc định). Các profile chạy song song.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const [mode, ...rest] = process.argv.slice(2);
const file = mode === 'eval' ? rest.shift() : undefined;
const targets = rest.map((a) => { const [label, port] = a.split('='); return { label, port: Number(port) }; });
if (!['lab', 'scan', 'eval'].includes(mode) || !targets.length || targets.some((t) => !t.label || !t.port) || (mode === 'eval' && !file)) {
  console.error('Dùng: node scripts/cdp-run.ts lab|scan|eval [file.js] label=port …');
  process.exit(1);
}

class Page {
  ws: WebSocket; id = 0; pending = new Map<number, (m: any) => void>();
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); this.pending.get(m.id)?.(m); this.pending.delete(m.id); });
  }
  static async open(port: number, url: string) {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(url)}`, { method: 'PUT' });
    if (!r.ok) throw new Error(`json/new ${r.status}`);
    const t = await r.json();
    await fetch(`http://127.0.0.1:${port}/json/activate/${t.id}`); // tab phải ở foreground: observer/rAF mới chạy
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    return Object.assign(new Page(ws), { port, targetId: t.id as string });
  }
  send(method: string, params: any = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise<any>((res, rej) => this.pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))));
  }
  async eval(expression: string, timeout = 120000) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expression: string, ms = 120000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (await this.eval(expression, 5000)) return; } catch { /* trang đang tải */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('timeout chờ ' + expression);
  }
  async close() { this.ws.close(); await fetch(`http://127.0.0.1:${(this as any).port}/json/close/${(this as any).targetId}`).catch(() => {}); }
}

async function run({ label, port }: { label: string; port: number }) {
  const t0 = Date.now();
  if (mode === 'lab') {
    const p = await Page.open(port, `${BASE}/noise-lab.html?label=${label}`);
    try {
      await p.waitFor('!!window.__noiseLab', 180000);
      const s = await p.eval(`(() => { const r = window.__noiseLab; const n = r.findings.filter(f => f.status === 'NOISE');
        const by = {}; for (const f of n) by[f.area] = (by[f.area] || 0) + 1;
        return { saved: document.querySelector('#status').textContent, hc: r.env.hardwareConcurrency, tests: r.findings.length, noise: n.length, by }; })()`);
      return { label, ms: Date.now() - t0, ...s };
    } finally { await p.close(); }
  }
  if (mode === 'scan') {
    const p = await Page.open(port, `${BASE}/api/server-info`);
    try {
      await p.waitFor(`document.readyState === 'complete'`);
      const r = await p.eval(`new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/probe.js';
        s.onload = () => SentinelFP.verify({ label: ${JSON.stringify(label)} }).then(res, (e) => rej(e)); s.onerror = rej; document.head.appendChild(s); })
        .then((b) => ({ scanId: b.scanId, trust: b.report.trustScore ?? b.report.score?.trust, decision: b.report.decision ?? b.report.action,
          fails: (b.report.rules || b.report.findings || []).filter((x) => x.status === 'FAIL').map((x) => x.id || x.ruleId),
          warns: (b.report.rules || b.report.findings || []).filter((x) => x.status === 'WARNING').map((x) => x.id || x.ruleId), keys: Object.keys(b.report) }))`, 180000);
      return { label, ms: Date.now() - t0, ...r };
    } finally { await p.close(); }
  }
  // eval
  const src = readFileSync(join(root, file!), 'utf8');
  const p = await Page.open(port, `${BASE}/api/server-info`);
  try {
    await p.waitFor(`document.readyState === 'complete'`);
    const out = await p.eval(`(async () => { ${src}\n })()`, 180000);
    const dir = join(root, 'data', 'cdp');
    mkdirSync(dir, { recursive: true });
    const f = join(dir, `${label}_${basename(file!, '.js')}.json`);
    writeFileSync(f, JSON.stringify({ label, port, at: new Date().toISOString(), out }, null, 2));
    return { label, ms: Date.now() - t0, saved: f };
  } finally { await p.close(); }
}

const results = await Promise.allSettled(targets.map(run));
for (const [i, r] of results.entries()) console.log(JSON.stringify(r.status === 'fulfilled' ? r.value : { label: targets[i].label, error: String(r.reason) }));
