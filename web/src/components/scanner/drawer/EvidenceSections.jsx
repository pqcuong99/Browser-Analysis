import { useMemo, useState } from 'react';
import { cn } from '../../../lib/cn.js';
import { flatten, fmt, show } from '../../../lib/format.js';
import { STATUS_STYLES } from '../../../lib/statusStyles.js';
import { EmptyNote, TABLE } from '../../common/Card.jsx';
import { SeverityBadge, StatusBadge } from '../../common/StatusPill.jsx';
import { TerminalBlock } from '../../common/TerminalBlock.jsx';

export function DrawerSection({ n, title, note, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-accent-500/10 font-mono text-xxs font-bold text-accent-300 ring-1 ring-accent-500/30">{n}</span>
        <h3 className="text-sm font-semibold text-ink-strong">{title}</h3>
        {note && <span className="ml-auto text-xxs text-ink-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** 1. Observed Data */
export function ObservedDataTable({ data }) {
  const rows = useMemo(() => flatten(data).slice(0, 400), [data]);
  return (
    <div className={cn(TABLE.wrap, 'max-h-table')}>
      <table className={TABLE.table}>
        <thead><tr><th className={TABLE.th}>Property</th><th className={TABLE.th}>Observed value</th></tr></thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className={cn(TABLE.td, 'whitespace-nowrap font-mono text-ink-faint')}>{k}</td>
              <td className={cn(TABLE.td, TABLE.mono)}>{show(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 2. Applied Rules Table */
export function AppliedRulesTable({ rules }) {
  return (
    <div className={TABLE.wrap}>
      <table className={TABLE.table}>
        <thead>
          <tr>
            {['rule_id', 'Rule', 'Severity', 'Status'].map((h) => <th key={h} className={TABLE.th}>{h}</th>)}
            {['wᵢ', 'cᵢ', 'sᵢ', '−Trust'].map((h) => <th key={h} className={cn(TABLE.th, 'text-right')}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.rule_id} className={STATUS_STYLES[r.status].row}>
              <td className={cn(TABLE.td, 'whitespace-nowrap font-mono font-semibold text-ink-strong')}>{r.rule_id}</td>
              <td className={TABLE.td}>
                <div className="text-ink">{r.name}</div>
                <div className="mt-1 text-xxs leading-relaxed text-ink-faint">{r.message}</div>
                <div className="mt-1 font-mono text-xxs text-ink-faint">{r.group_id}</div>
              </td>
              <td className={TABLE.td}><SeverityBadge severity={r.severity} /></td>
              <td className={TABLE.td}><StatusBadge status={r.status} /></td>
              <td className={cn(TABLE.td, TABLE.num)}>{fmt(r.base_weight)}</td>
              <td className={cn(TABLE.td, TABLE.num)}>{fmt(r.confidence)}</td>
              <td className={cn(TABLE.td, TABLE.num)}>{fmt(r.effective_score)}</td>
              <td className={cn(TABLE.td, TABLE.num, 'font-bold text-ink-strong')}>{r.contributed_score ? `−${fmt(r.contributed_score)}` : '0'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 3. Reference Baseline */
export function ReferenceBaseline({ module: m }) {
  return (
    <div className="space-y-3 rounded-xl bg-surface/70 p-5 text-xs leading-relaxed ring-1 ring-line">
      <p className="text-ink">{m.reference_baseline}</p>
      <ul className="space-y-1.5">
        {m.rules_evaluated.map((r) => (
          <li key={r.rule_id} className="flex gap-3">
            <span className="shrink-0 font-mono font-semibold text-ink-muted">{r.rule_id}</span>
            <span className="text-ink-faint">{r.expected_baseline}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Nhãn của các ô hash theo loại module */
function stabilityCells(m, s) {
  const realmLabels = m.module_id === 'browser_info' || m.module_id === 'automation';
  const cells = [
    { k: realmLabels ? 'window' : 'Run 1', v: s.run_1_hash },
    { k: realmLabels ? 'iframe about:blank' : 'Run 2', v: s.run_2_hash },
  ];
  if (s.main_context_hash) cells.push({ k: 'Main thread', v: s.main_context_hash });
  if (s.worker_or_iframe_hash) cells.push({ k: 'Web Worker', v: s.worker_or_iframe_hash });
  // Ô lệch khỏi giá trị tham chiếu (run 1 hoặc main thread) bị tô đỏ
  return cells.map((c) => {
    const ref = c.k === 'Web Worker' && s.main_context_hash ? s.main_context_hash : s.run_1_hash;
    return { ...c, bad: !s.is_deterministic && c.v !== ref && c.k !== 'Main thread' };
  });
}

const DETERMINISM = {
  true: { status: 'PASS', label: 'DETERMINISTIC' },
  false: { status: 'FAIL', label: 'NON-DETERMINISTIC' },
};

/** 4. Stability & Multi-Context Check */
export function StabilityCheck({ module: m }) {
  const s = m.stability_check;
  if (!s) return <EmptyNote>Module này không có phép thử nhiều lần / đa ngữ cảnh.</EmptyNote>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {stabilityCells(m, s).map((c) => (
          <div key={c.k} className={cn('min-w-0 rounded-xl bg-sunken px-4 py-3 ring-1 ring-line', c.bad && 'ring-fail-500/50')}>
            <div className="eyebrow">{c.k}</div>
            <div className={cn('mt-1 break-all font-mono text-xs font-semibold text-ink-strong', c.bad && 'text-fail-400')}>{c.v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <StatusBadge {...DETERMINISM[Boolean(s.is_deterministic)]} />
        <span className="text-ink-faint">{s.note}</span>
      </div>
    </div>
  );
}

/** 5. Evidence Explanation */
export function EvidenceExplanation({ module: m }) {
  const items = m.rules_evaluated.filter((r) => r.status === 'FAIL' || r.status === 'WARNING' || (r.status === 'UNAVAILABLE' && r.severity === 'INFO'));
  if (!items.length) {
    return (
      <div className="rounded-xl bg-surface/70 p-5 text-xs leading-relaxed text-ink ring-1 ring-line">
        Không có rule nào bị kích hoạt. Mọi tín hiệu của module này khớp với hành vi của trình duyệt nguyên bản tương ứng.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((r) => (
        <article key={r.rule_id} className="flex gap-4 rounded-xl bg-surface/70 p-4 ring-1 ring-line">
          <span className={cn('w-1 shrink-0 rounded-full', STATUS_STYLES[r.status].accentBar)} aria-hidden="true" />
          <div className="min-w-0 space-y-1.5 text-xs leading-relaxed">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold text-ink-strong">{r.rule_id}</span>
              <span className="font-semibold text-ink-strong">{r.name}</span>
            </div>
            <p className="break-words font-mono text-xxs text-ink-muted">Quan sát: {r.message}</p>
            <p className="text-ink">{r.evidence_explanation}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

const DIFF_TONE = { same: 'text-zinc-400', changed: 'bg-warn-500/10 text-warn-200', missing: 'bg-zinc-800/60 text-ink-faint' };

function diffRows(a, b) {
  const fa = new Map(flatten(a ?? {}).map(([k, v]) => [k, show(v)]));
  const fb = new Map(flatten(b ?? {}).map(([k, v]) => [k, show(v)]));
  return [...new Set([...fa.keys(), ...fb.keys()])].map((k) => {
    const va = fa.get(k), vb = fb.get(k);
    let kind = 'same';
    if (va === undefined || vb === undefined) kind = 'missing';
    else if (va !== vb) kind = 'changed';
    return { k, va, vb, kind };
  });
}

/** 6. Raw JSON & Side-by-Side Diff trong khung Terminal */
export function RawDiffTerminal({ module: m, prevModule, prevScanId }) {
  const [tab, setTab] = useState('raw');
  const payload = useMemo(() => ({
    module_id: m.module_id, status: m.status, module_risk_points: m.module_risk_points,
    stability_check: m.stability_check, observed_raw_data: m.observed_raw_data,
    rules: m.rules_evaluated.map(({ rule_id, status, effective_score, contributed_score, observed_value, message }) => ({ rule_id, status, effective_score, contributed_score, observed_value, message })),
  }), [m]);
  const json = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const rows = useMemo(() => (prevModule ? diffRows(prevModule.observed_raw_data, m.observed_raw_data) : []), [prevModule, m]);
  const changes = rows.filter((r) => r.kind !== 'same').length;

  const tabs = [{ id: 'raw', label: 'raw.json' }, { id: 'diff', label: 'diff' }];
  const DIFF_MARK = { same: ' ', changed: '~', missing: '±' };
  const diffText = rows.map((r) => `${DIFF_MARK[r.kind]} ${r.k}: ${r.va ?? '∅'} -> ${r.vb ?? '∅'}`).join('\n');
  const copyText = tab === 'raw' ? json : diffText;

  return (
    <TerminalBlock title={`sentinelfp://${m.module_id}`} tabs={tabs} activeTab={tab} onTab={setTab} copyText={copyText} bodyClassName={tab === 'diff' ? 'p-0' : undefined}>
      {tab === 'raw' && <pre className="whitespace-pre-wrap break-all">{json}</pre>}
      {tab === 'diff' && !prevModule && (
        <p className="p-4 text-ink-faint">Chưa có lần quét trước trong phiên này. Bấm “Re-scan Browser” để so sánh hai lần quét.</p>
      )}
      {tab === 'diff' && prevModule && (
        <div>
          <p className="border-b border-line px-4 py-2 text-xxs text-ink-faint">
            So với scan {prevScanId?.slice(0, 8)}… · {changes} giá trị thay đổi (hash có seed theo nonce đổi giữa các lần quét là bình thường)
          </p>
          <div className="grid grid-cols-2 divide-x divide-line">
            {['PREVIOUS', 'CURRENT'].map((side) => (
              <div key={side} className="min-w-0 py-2">
                <div className="px-4 pb-1 text-xxs font-semibold text-ink-faint">{side}</div>
                {rows.map((r) => (
                  <div key={r.k} className={cn('break-all px-4 py-0.5', DIFF_TONE[r.kind])}>
                    {r.k}: {side === 'PREVIOUS' ? r.va ?? '∅' : r.vb ?? '∅'}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </TerminalBlock>
  );
}
