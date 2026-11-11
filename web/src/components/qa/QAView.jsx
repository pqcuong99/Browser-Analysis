import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, GitCompareArrows, RefreshCw, Tag } from 'lucide-react';
import { api } from '../../lib/api.js';
import { cn } from '../../lib/cn.js';
import { fmt, pct, show } from '../../lib/format.js';
import { normalizeReport } from '../../lib/report.js';
import { ACTION_STYLES } from '../../lib/statusStyles.js';
import { Button } from '../common/Button.jsx';
import { Card, CardTitle, EmptyNote, SectionHeader, TABLE } from '../common/Card.jsx';
import { StatusBadge } from '../common/StatusPill.jsx';

// Tín hiệu fingerprint phải giữ nguyên giữa các phiên của cùng một profile
const FP_KEYS = [
  ['Canvas fixed hash', (r) => r.canvas?.fixedHash],
  ['Canvas run1 = run2', (r) => r.canvas && String(r.canvas.hashA === r.canvas.hashB)],
  ['Canvas main ↔ worker', (r) => (r.canvas && r.worker?.canvas2d ? String(r.canvas.geoHash === r.worker.canvas2d) : undefined)],
  ['WebGL render hash', (r) => r.webgl?.renderHashA],
  ['WebGL renderer', (r) => r.webgl?.unmaskedRenderer],
  ['WebGL extensions', (r) => r.webgl?.extensionCount],
  ['Audio sample sum', (r) => r.audio?.sumA],
  ['User-Agent', (r) => r.navigator?.userAgent],
  ['Platform', (r) => r.navigator?.platform],
  ['CPU / RAM', (r) => r.navigator && `${r.navigator.hardwareConcurrency} / ${r.navigator.deviceMemory}`],
  ['Screen', (r) => r.screen && `${r.screen.width}×${r.screen.height} @${r.screen.dpr}`],
  ['Timezone', (r) => r.locale?.timeZone],
  ['Languages', (r) => r.navigator?.languages?.join(',')],
  ['Fonts (win/mac/linux)', (r) => r.fonts?.found && `${r.fonts.found.windows.length}/${r.fonts.found.mac.length}/${r.fonts.found.linux.length}`],
  ['Emoji font', (r) => r.fonts?.emoji?.join(',')],
  ['WebRTC srflx', (r) => r.webrtc?.candidates?.filter((c) => c.type === 'srflx').map((c) => c.address).join(',')],
];

const ACTION_TO_STATUS = { ALLOW: 'PASS', CHALLENGE: 'WARNING', BLOCK: 'FAIL' };

const CHANGE_TONE = { true: 'font-semibold text-warn-300', false: 'text-ink-faint' };

function ChangeTag({ changed, yes = 'CHANGED', no = 'same' }) {
  const labels = { true: yes, false: no };
  return <span className={cn('font-mono text-xxs', CHANGE_TONE[Boolean(changed)])}>{labels[Boolean(changed)]}</span>;
}

function ScanSummary({ title, scan }) {
  const sb = scan.res.report.scoring_breakdown;
  const env = scan.res.report.environment_summary;
  return (
    <Card className="space-y-3">
      <div className="eyebrow">{title}</div>
      <p className="break-all font-mono text-xs text-ink-strong">{scan.res.scanId}</p>
      {scan.res.label && <p className="font-mono text-xxs text-ink-faint">{scan.res.label}</p>}
      <div className="flex items-center gap-3">
        <span className={cn('font-mono text-4xl font-bold tabular', ACTION_STYLES[sb.enforcement_action].text)}>{sb.trust_score}<span className="text-base text-ink-faint">/100</span></span>
        <StatusBadge status={ACTION_TO_STATUS[sb.enforcement_action]} label={sb.enforcement_action} />
        <span className="text-xs text-ink-faint">confidence {pct(sb.overall_confidence)}</span>
      </div>
      <p className="text-xs text-ink-muted">{env.declared_browser} · {env.declared_os} · {new Date(scan.res.report.timestamp).toLocaleString()}</p>
    </Card>
  );
}

function CompareResult({ a, b }) {
  const ra = a.res.report, rb = b.res.report;
  const delta = rb.scoring_breakdown.trust_score - ra.scoring_breakdown.trust_score;
  const rulesA = new Map(ra.modules.flatMap((m) => m.rules_evaluated).map((r) => [r.rule_id, r]));
  const changedRules = rb.modules.flatMap((m) => m.rules_evaluated).filter((r) => {
    const x = rulesA.get(r.rule_id);
    return !x || x.status !== r.status || x.contributed_score !== r.contributed_score;
  });
  const fpRows = FP_KEYS.map(([k, f]) => {
    let va, vb;
    try { va = f(a.raw || {}); } catch {}
    try { vb = f(b.raw || {}); } catch {}
    return { k, va, vb, same: show(va) === show(vb) };
  });

  return (
    <div className="animate-fade-in">
      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <ScanSummary title="Scan A · baseline" scan={a} />
        <ScanSummary title="Scan B · candidate" scan={b} />
      </div>

      <SectionHeader title="Module Status Matrix" hint={`Δ Trust ${delta >= 0 ? '+' : ''}${delta}`} />
      <div className={TABLE.wrap}>
        <table className={TABLE.table}>
          <thead><tr>{['Module', 'A', 'A −Trust', 'B', 'B −Trust', ''].map((h) => <th key={h} className={TABLE.th}>{h}</th>)}</tr></thead>
          <tbody>
            {ra.modules.map((m) => {
              const mb = rb.modules.find((x) => x.module_id === m.module_id);
              const changed = m.status !== mb?.status || m.module_risk_points !== mb?.module_risk_points;
              return (
                <tr key={m.module_id} className={cn(changed && 'bg-warn-500/5')}>
                  <td className={cn(TABLE.td, 'text-ink')}>{m.title}</td>
                  <td className={TABLE.td}><StatusBadge status={m.status} /></td>
                  <td className={cn(TABLE.td, TABLE.num)}>{fmt(m.module_risk_points, 1)}</td>
                  <td className={TABLE.td}>{mb && <StatusBadge status={mb.status} />}</td>
                  <td className={cn(TABLE.td, TABLE.num)}>{fmt(mb?.module_risk_points, 1)}</td>
                  <td className={TABLE.td}><ChangeTag changed={changed} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SectionHeader title="Rule Changes" hint={`${changedRules.length} rule đổi trạng thái hoặc điểm`} />
      {changedRules.length === 0 && <EmptyNote>Không có rule nào thay đổi giữa A và B.</EmptyNote>}
      {changedRules.length > 0 && (
        <div className={TABLE.wrap}>
          <table className={TABLE.table}>
            <thead><tr>{['rule_id', 'Rule', 'A', 'A −Trust', 'B', 'B −Trust', 'B observation'].map((h) => <th key={h} className={TABLE.th}>{h}</th>)}</tr></thead>
            <tbody>
              {changedRules.map((r) => {
                const x = rulesA.get(r.rule_id);
                return (
                  <tr key={r.rule_id}>
                    <td className={cn(TABLE.td, 'whitespace-nowrap font-mono font-semibold text-ink-strong')}>{r.rule_id}</td>
                    <td className={cn(TABLE.td, 'text-ink')}>{r.name}</td>
                    <td className={TABLE.td}>{x && <StatusBadge status={x.status} />}</td>
                    <td className={cn(TABLE.td, TABLE.num)}>{fmt(x?.contributed_score)}</td>
                    <td className={TABLE.td}><StatusBadge status={r.status} /></td>
                    <td className={cn(TABLE.td, TABLE.num)}>{fmt(r.contributed_score)}</td>
                    <td className={cn(TABLE.td, 'text-ink-muted')}>{r.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SectionHeader title="Fingerprint Stability (cross-session)" hint="Cùng một profile phải giữ nguyên các giá trị này giữa các phiên" />
      <div className={TABLE.wrap}>
        <table className={TABLE.table}>
          <thead><tr>{['Signal', 'Scan A', 'Scan B', ''].map((h) => <th key={h} className={TABLE.th}>{h}</th>)}</tr></thead>
          <tbody>
            {fpRows.map((r) => (
              <tr key={r.k} className={cn(!r.same && 'bg-warn-500/5')}>
                <td className={cn(TABLE.td, 'whitespace-nowrap text-ink')}>{r.k}</td>
                <td className={cn(TABLE.td, TABLE.mono)}>{show(r.va)}</td>
                <td className={cn(TABLE.td, TABLE.mono)}>{show(r.vb)}</td>
                <td className={TABLE.td}><ChangeTag changed={!r.same} yes="DRIFT" no="stable" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScanSelect({ value, onChange, label, extra, scans }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-ink-faint">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field-input w-full" aria-label={label}>
        <option value="">— chọn scan —</option>
        {extra.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        {scans.map((s) => <option key={s.id} value={s.id}>{scanOption(s)}</option>)}
      </select>
    </label>
  );
}

function scanOption(s) {
  return `${new Date(s.createdAt).toLocaleString()} · ${s.decision ?? '?'} · ${s.label ?? (s.userAgent || '').slice(0, 40)}`;
}

/** Chế độ Internal Browser QA: kiểm thử hồi quy profile trình duyệt */
export function QAView({ session, qaLabel, setQaLabel, onScanWithLabel }) {
  const [scans, setScans] = useState([]);
  const [status, setStatus] = useState('');
  const [selA, setSelA] = useState('');
  const [selB, setSelB] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const cur = session.current;
  const prev = session.prev;

  const fetchScan = useCallback(async (v) => {
    if (v === '__current') return cur;
    if (v === '__prev') return prev;
    const s = await api(`/api/scans/${encodeURIComponent(v)}`);
    return { res: { scanId: s.scanId, label: s.label, report: normalizeReport(s.report) }, raw: s.raw };
  }, [cur, prev]);

  const compare = useCallback(async (a, b) => {
    if (!a || !b) return;
    setBusy(true);
    try {
      const [x, y] = await Promise.all([fetchScan(a), fetchScan(b)]);
      setResult({ a: x, b: y });
    } catch (e) {
      setStatus(`Không so sánh được: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [fetchScan]);

  const loadList = useCallback(async () => {
    setStatus('Đang tải danh sách scan…');
    try {
      const list = await api('/api/scans?limit=100');
      setScans(list);
      setStatus(`${list.length} scan gần nhất`);
      return list;
    } catch (e) {
      setStatus(e.status === 403 ? 'Cần quyền admin (localhost hoặc nhập ADMIN_KEY ở tab Policy) để liệt kê scan.' : `Không tải được: ${e.message}`);
      return [];
    }
  }, []);

  useEffect(() => {
    loadList().then((list) => {
      const a = prev ? '__prev' : list[1]?.id;
      const b = cur ? '__current' : list[0]?.id;
      if (a) setSelA(a);
      if (b) setSelB(b);
      if (a && b && a !== b) compare(a, b);
    });
    // chỉ chạy khi mở tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extra = [];
  if (prev) extra.push({ id: '__prev', label: `◀ Scan trước (${prev.res.scanId.slice(0, 8)}…)` });
  if (cur) extra.push({ id: '__current', label: `▶ Scan hiện tại (${cur.res.scanId.slice(0, 8)}…)` });


  return (
    <div className="animate-fade-in">
      <SectionHeader icon={GitCompareArrows} title="Internal Browser QA — Regression Compare" hint="Quét cùng một profile nhiều lần (gắn label) rồi so sánh Scan A với Scan B" />
      <Card className="space-y-6">
        <CardTitle icon={Tag}>Scan có gắn label</CardTitle>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-ink-faint">
            QA label cho lần quét tiếp theo
            <input className="field-input" placeholder="vd: profile-01-gologin" value={qaLabel} onChange={(e) => setQaLabel(e.target.value)} />
          </label>
          <Button variant="primary" icon={RefreshCw} onClick={onScanWithLabel}>Scan &amp; save with label</Button>
        </div>
        <div className="h-px bg-line" />
        <div className="flex flex-wrap items-end gap-3">
          <ScanSelect label="Scan A (baseline)" value={selA} onChange={setSelA} extra={extra} scans={scans} />
          <Button variant="ghost" size="icon" icon={ArrowLeftRight} aria-label="Đổi chỗ A và B" onClick={() => { setSelA(selB); setSelB(selA); }} />
          <ScanSelect label="Scan B (candidate)" value={selB} onChange={setSelB} extra={extra} scans={scans} />
          <Button variant="primary" icon={GitCompareArrows} onClick={() => compare(selA, selB)} disabled={busy || !selA || !selB}>Compare</Button>
          <Button onClick={loadList}>Tải lại</Button>
        </div>
        <p className="text-xs text-ink-faint">{status}</p>
      </Card>
      {result && <CompareResult a={result.a} b={result.b} />}
    </div>
  );
}
