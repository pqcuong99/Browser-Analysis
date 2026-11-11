import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { fmt } from '../../lib/format.js';
import { MODULE_ICONS } from '../../lib/moduleIcons.js';
import { STATUS_STYLES } from '../../lib/statusStyles.js';
import { PriorityBadge, StatusBadge } from '../common/StatusPill.jsx';

const ICON_TONE = {
  FAIL: 'bg-fail-500/15 text-fail-300 ring-fail-500/40',
  WARNING: 'bg-warn-500/10 text-warn-300 ring-warn-500/30',
  PASS: 'bg-zinc-800 text-ink-muted ring-line-strong',
  UNAVAILABLE: 'bg-zinc-800/60 text-ink-faint ring-line',
};

export function ModuleCard({ module: m, onOpen }) {
  const s = STATUS_STYLES[m.status];
  const Icon = MODULE_ICONS[m.module_id];
  const pts = m.module_risk_points;
  return (
    <button
      type="button"
      onClick={() => onOpen(m.module_id)}
      aria-label={`${m.title}: ${m.status}, trừ ${fmt(pts, 1)} điểm Trust. Mở bảng bằng chứng`}
      className={cn(
        'group relative flex w-full min-w-0 flex-col gap-4 rounded-2xl bg-surface/80 p-5 text-left backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:bg-surface',
        s.card,
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1', ICON_TONE[m.status])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-ink-strong">{m.title}</h3>
          <div className="mt-1.5 flex items-center gap-2">
            <PriorityBadge priority={m.priority} />
            <StatusBadge status={m.status} />
          </div>
        </div>
        <span className={cn('font-mono text-sm font-bold tabular', pts ? 'text-ink-strong' : 'text-ink-faint')}>
          {pts ? `−${fmt(pts, 1)}` : '0'}<span className="ml-0.5 text-xxs font-normal text-ink-faint">trust</span>
        </span>
      </div>

      <dl className="space-y-1.5 font-mono text-xs">
        {m.key_metrics.slice(0, 3).map((k) => (
          <div key={k.label} className="grid grid-cols-metric gap-3">
            <dt className="truncate text-ink-faint">{k.label}</dt>
            <dd className={cn('truncate text-ink', k.is_anomalous && 'font-semibold text-fail-400')} title={k.value}>{k.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex items-start gap-2 border-t border-line pt-3.5">
        <p className={cn('line-clamp-2 flex-1 text-xs leading-relaxed', s.headline)}>{m.summary_headline}</p>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden="true" />
      </div>
    </button>
  );
}
