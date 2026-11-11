import { RefreshCcw } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { show } from '../../lib/format.js';
import { Card } from '../common/Card.jsx';
import { StatusBadge } from '../common/StatusPill.jsx';
import { TABLE } from '../common/Card.jsx';

// Tín hiệu phải giữ nguyên giữa 2 lần quét độc lập trên cùng trình duyệt
const SIGNALS = [
  ['Canvas render (seed cố định)', (r) => r.canvas?.fixedHash],
  ['Canvas run 1 = run 2', (r) => r.canvas && r.canvas.hashA === r.canvas.hashB],
  ['Canvas main = Worker', (r) => (r.canvas && r.worker?.canvas2d ? r.canvas.geoHash === r.worker.canvas2d : undefined)],
  ['getImageData = toDataURL', (r) => (typeof r.canvas?.decodedDiffPixels === 'number' ? r.canvas.decodedDiffPixels === 0 : undefined)],
  ['WebGL readPixels hash', (r) => r.webgl?.renderHashA],
  ['WebGL renderer', (r) => r.webgl?.unmaskedRenderer],
  ['WebGL extensions', (r) => r.webgl?.extensionCount],
  ['Audio sample sum', (r) => r.audio?.sumA],
  ['Text metrics (DOM / canvas)', (r) => r.fonts?.metrics && `${r.fonts.metrics.dom?.[0]} / ${r.fonts.metrics.canvas?.[0]}`],
  ['Font set Win | Mac | Linux', (r) => r.fonts?.found && `${r.fonts.found.windows.join(',')} | ${r.fonts.found.mac.join(',')} | ${r.fonts.found.linux.join(',')}`],
  ['Emoji font', (r) => r.fonts?.emoji?.join(',')],
  ['User-Agent', (r) => r.navigator?.userAgent],
  ['CPU / RAM', (r) => r.navigator && `${r.navigator.hardwareConcurrency} / ${r.navigator.deviceMemory}`],
  ['Screen', (r) => r.screen && `${r.screen.width}×${r.screen.height} @${r.screen.dpr}`],
  ['Timezone / languages', (r) => r.locale && `${r.locale.timeZone} · ${(r.locale.languages || []).join(',')}`],
];

const VERDICT = {
  stable: { status: 'PASS', label: 'STABLE', note: 'Mọi hash và thông số giữ nguyên giữa 2 lần quét độc lập: trình duyệt nguyên bản là tất định.' },
  drift: { status: 'WARNING', note: 'Giá trị đổi giữa 2 lần tải trang thường là dấu hiệu chèn nhiễu theo phiên (antidetect đổi seed mỗi lần) hoặc môi trường vừa thay đổi.' },
  heavy: { status: 'FAIL', note: 'Nhiều tín hiệu cùng đổi giữa 2 lần tải trang: dấu hiệu mạnh của fingerprint ngẫu nhiên hóa theo phiên.' },
};
const ROW_STATE = {
  na: { cls: '', tag: 'n/a', tagCls: 'text-ink-faint' },
  stable: { cls: '', tag: 'stable', tagCls: 'text-ink-faint' },
  drift: { cls: 'bg-warn-500/5', tag: 'DRIFT', tagCls: 'font-semibold text-warn-300' },
};

function compare(prevRaw = {}, curRaw = {}) {
  return SIGNALS.map(([k, f]) => {
    let va, vb;
    try { va = f(prevRaw); } catch {}
    try { vb = f(curRaw); } catch {}
    let state = 'stable';
    if (va == null || vb == null) state = 'na';
    else if (show(va) !== show(vb)) state = 'drift';
    return { k, va, vb, state };
  }).filter((r) => r.va !== undefined || r.vb !== undefined);
}

/** So độ ổn định fingerprint với lần quét thật trước đó (sau Re-scan) */
export function RescanReport({ prev, ctx }) {
  const rows = compare(prev.raw, ctx.raw);
  const drift = rows.filter((r) => r.state === 'drift').length;
  let verdictKey = 'stable';
  if (drift >= 3) verdictKey = 'heavy';
  else if (drift > 0) verdictKey = 'drift';
  const v = VERDICT[verdictKey];
  const a = prev.res.report.scoring_breakdown, b = ctx.res.report.scoring_breakdown;
  return (
    <Card className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <RefreshCcw className="h-4 w-4 text-accent-400" aria-hidden="true" />
        <h2 className="text-base font-semibold text-ink-strong">Re-scan Stability Report</h2>
        <StatusBadge status={v.status} label={v.label ?? `${drift} DRIFT`} />
        <span className="font-mono text-xxs text-ink-faint">
          vs {prev.res.scanId.slice(0, 8)}… · trust {a.trust_score} → {b.trust_score} · {a.enforcement_action} → {b.enforcement_action}
        </span>
      </div>
      <p className="text-xs text-ink-muted">{v.note}</p>
      <div className={cn(TABLE.wrap, 'max-h-table')}>
        <table className={TABLE.table}>
          <thead><tr>{['Signal', 'Lần trước', 'Lần này', ''].map((h) => <th key={h} className={TABLE.th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const st = ROW_STATE[r.state];
              return (
                <tr key={r.k} className={st.cls}>
                  <td className={cn(TABLE.td, 'whitespace-nowrap text-ink')}>{r.k}</td>
                  <td className={cn(TABLE.td, TABLE.mono)}>{show(r.va)}</td>
                  <td className={cn(TABLE.td, TABLE.mono)}>{show(r.vb)}</td>
                  <td className={cn(TABLE.td, 'font-mono text-xxs', st.tagCls)}>{st.tag}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
