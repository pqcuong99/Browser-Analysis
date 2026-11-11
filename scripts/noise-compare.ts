/**
 * So sánh kết quả Noise Lab giữa các profile.
 *   node scripts/noise-compare.ts            → lấy bản mới nhất của mỗi label
 *   node scripts/noise-compare.ts p1 p2 p3   → chỉ các label này, theo thứ tự
 * In bảng ra terminal và ghi data/noise-lab/report.md
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'noise-lab');
if (!existsSync(dir)) { console.error('Chưa có data/noise-lab/. Mở /noise-lab.html?label=... trước.'); process.exit(1); }

const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const latest = new Map<string, any>();
for (const f of files) {
  const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  latest.set(j.label, { ...j, file: f });
}
const want = process.argv.slice(2);
const labels = want.length ? want.filter((l) => latest.has(l)) : [...latest.keys()].sort();
if (!labels.length) { console.error('Không có label nào khớp. Có:', [...latest.keys()].join(', ')); process.exit(1); }
const runs = labels.map((l) => latest.get(l));

const key = (f: any) => `${f.area} | ${f.ctx} | ${f.test}`;
const keys: string[] = [];
const byLabel = runs.map((r) => {
  const m = new Map<string, any>();
  for (const f of r.findings) { const k = key(f); m.set(k, f); if (!keys.includes(k)) keys.push(k); }
  return m;
});

const lines: string[] = [];
lines.push(`# Noise Lab report`, '', `Tạo lúc ${new Date().toISOString()}`, '');
lines.push('| label | file | UA | screen | elapsed |', '|---|---|---|---|---|');
for (const r of runs) lines.push(`| ${r.label} | ${r.file} | ${r.env.userAgent.slice(0, 70)} | ${r.env.screen.join('×')} | ${r.elapsedMs} ms |`);
lines.push('');

// 1) Phép thử có đáp án: label nào lệch
lines.push('## Phép thử có đáp án (NOISE = lệch đáp án)', '');
lines.push(`| Nhóm | Ngữ cảnh | Phép thử | ${labels.join(' | ')} |`, `|---|---|---|${labels.map(() => '---').join('|')}|`);
const interesting = keys.filter((k) => byLabel.some((m) => m.get(k)?.status !== 'OK'));
for (const k of interesting) {
  const [a, c, t] = k.split(' | ');
  const cells = byLabel.map((m) => { const f = m.get(k); return f ? `${f.status === 'NOISE' ? '**NOISE**' : f.status} ${String(f.detail || '').replace(/\|/g, '/').slice(0, 70)}` : '–'; });
  lines.push(`| ${a} | ${c} | ${t} | ${cells.join(' | ')} |`);
}
lines.push('', `${keys.length - interesting.length} phép thử OK ở mọi label (không liệt kê).`, '');

// 2) Giá trị fingerprint: so trực tiếp giữa các profile cùng máy
const get = (o: any, p: string) => p.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
const FP = [
  'main.canvas.textScene.hashA', 'main.canvas.textScene.toDataURL.hash', 'worker.canvas.textScene.hashA',
  'main.canvas.putGet_128x64.readHash', 'main.canvas.measure.arial16.width', 'main.canvas.measure.monoCharWidth',
  'main.webgl.gradientHash', 'main.webgl.gradient_toDataURL.hash', 'main.webgl.paramsHash', 'main.webgl.params.UNMASKED_RENDERER',
  'main.webgl.params.UNMASKED_VENDOR', 'main.webgl.params.MAX_TEXTURE_SIZE', 'main.webgl.params.precision', 'main.webgl2.paramsHash',
  'worker.webgl.params.UNMASKED_RENDERER', 'worker.webgl.gradientHash',
  'main.rects.textSpan.observed', 'main.rects.domVsMeasureText.delta', 'main.rects.svgTextLength.computedTextLength',
  'main.audio.dynamicsFP.sumA', 'main.audio.dynamicsFP.hashA', 'main.audio.analyser.a.freq', 'main.audio.realtime.baseLatency',
  'main.integrity.nonNative',
];
lines.push('## Giá trị fingerprint giữa các profile', '');
lines.push(`| Trường | ${labels.join(' | ')} | Khác nhau |`, `|---|${labels.map(() => '---').join('|')}|---|`);
for (const p of FP) {
  const vals = runs.map((r) => JSON.stringify(get(r, p)) ?? '–');
  const diff = new Set(vals).size > 1;
  lines.push(`| ${p} | ${vals.map((v) => v.slice(0, 40)).join(' | ')} | ${diff ? '**có**' : ''} |`);
}
// WebGL params: khoá nào khác
const pk = new Set<string>();
for (const r of runs) for (const k of Object.keys(get(r, 'main.webgl.params') ?? {})) pk.add(k);
const pdiff = [...pk].filter((k) => new Set(runs.map((r) => JSON.stringify(get(r, `main.webgl.params.${k}`)))).size > 1);
lines.push('', `WebGL params khác nhau giữa label: ${pdiff.length ? pdiff.join(', ') : 'không có'}`, '');

const md = lines.join('\n');
writeFileSync(join(dir, 'report.md'), md);
console.log(md);
console.log(`\n→ data/noise-lab/report.md`);
