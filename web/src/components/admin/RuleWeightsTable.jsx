import { Fragment } from 'react';
import { cn } from '../../lib/cn.js';
import { fmt } from '../../lib/format.js';
import { MODULE_ICONS } from '../../lib/moduleIcons.js';
import { TABLE } from '../common/Card.jsx';
import { PriorityBadge, SeverityBadge, StatusBadge } from '../common/StatusPill.jsx';

const cellInput = 'field-input h-8 w-20 px-2 text-right font-mono text-xs';

/** Bảng trọng số / độ tin cậy / bật-tắt cho 50 rule, nhóm theo module */
export function RuleWeightsTable({ meta, draft, setRule }) {
  return (
    <div className={cn(TABLE.wrap, 'max-h-table-lg')}>
      <table className={TABLE.table}>
        <thead>
          <tr>
            {['On', 'rule_id', 'Rule / group', 'Severity', 'On trigger'].map((h) => <th key={h} className={TABLE.th}>{h}</th>)}
            {['wᵢ', 'cᵢ', 'max sᵢ', 'Default'].map((h) => <th key={h} className={cn(TABLE.th, 'text-right')}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {meta.modules.map((m) => {
            const Icon = MODULE_ICONS[m.id];
            return (
              <Fragment key={m.id}>
                <tr>
                  <td colSpan={9} className="border-b border-line bg-zinc-900/80 px-4 py-2">
                    <span className="flex items-center gap-2 font-mono text-xxs font-semibold uppercase tracking-wider text-accent-300">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {m.title} <PriorityBadge priority={m.priority} />
                    </span>
                  </td>
                </tr>
                {meta.rules.filter((r) => r.module === m.id).map((r) => {
                  const ov = draft.rules[r.id] || {};
                  const w = ov.weight ?? r.weight;
                  const c = ov.confidence ?? r.confidence;
                  const on = ov.enabled !== false;
                  const modified = ov.weight !== undefined || ov.confidence !== undefined;
                  return (
                    <tr key={r.id} className={cn(!on && 'opacity-40', modified && 'bg-accent-500/5')}>
                      <td className={TABLE.td}>
                        <input type="checkbox" aria-label={`Bật ${r.id}`} checked={on} onChange={(e) => setRule(r, 'enabled', e.target.checked)} className="h-4 w-4 accent-cyan-400" />
                      </td>
                      <td className={cn(TABLE.td, 'whitespace-nowrap font-mono font-semibold text-ink-strong')}>{r.id}</td>
                      <td className={TABLE.td}>
                        <div className="text-ink">{r.name}</div>
                        <div className="font-mono text-xxs text-ink-faint">{r.group}</div>
                      </td>
                      <td className={TABLE.td}><SeverityBadge severity={r.severity} /></td>
                      <td className={TABLE.td}><StatusBadge status={r.status} /></td>
                      <td className={cn(TABLE.td, 'text-right')}>
                        <input type="number" min={0} max={50} step={1} value={w} aria-label={`Weight ${r.id}`} className={cellInput}
                          disabled={r.status === 'UNAVAILABLE'}
                          onChange={(e) => Number.isFinite(Number(e.target.value)) && setRule(r, 'weight', Number(e.target.value))} />
                      </td>
                      <td className={cn(TABLE.td, 'text-right')}>
                        <input type="number" min={0} max={1} step={0.01} value={c} aria-label={`Confidence ${r.id}`} className={cellInput}
                          onChange={(e) => Number.isFinite(Number(e.target.value)) && setRule(r, 'confidence', Number(e.target.value))} />
                      </td>
                      <td className={cn(TABLE.td, TABLE.num, 'text-ink-strong')}>{fmt(w * c)}</td>
                      <td className={cn(TABLE.td, TABLE.num, 'text-ink-faint')}>{r.weight} × {r.confidence}</td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
