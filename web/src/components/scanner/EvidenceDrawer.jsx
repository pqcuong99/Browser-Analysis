import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { fmt, pct } from '../../lib/format.js';
import { MODULE_ICONS } from '../../lib/moduleIcons.js';
import { cn } from '../../lib/cn.js';
import { STATUS_STYLES } from '../../lib/statusStyles.js';
import { Button } from '../common/Button.jsx';
import { PriorityBadge, StatusBadge } from '../common/StatusPill.jsx';
import {
  AppliedRulesTable, DrawerSection, EvidenceExplanation, ObservedDataTable, RawDiffTerminal, ReferenceBaseline, StabilityCheck,
} from './drawer/EvidenceSections.jsx';

/** Khay trượt bên phải: 6 thành phần bằng chứng của một module */
export function EvidenceDrawer({ ctx, moduleId, onClose }) {
  const closeRef = useRef(null);
  const m = ctx.res.report.modules.find((x) => x.module_id === moduleId);
  const prevModule = ctx.prev?.res?.report?.modules?.find((x) => x.module_id === moduleId);

  useEffect(() => {
    const last = document.activeElement;
    closeRef.current?.focus();
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      last?.focus?.();
    };
  }, [onClose]);

  if (!m) return null;
  const Icon = MODULE_ICONS[m.module_id];
  return (
    <div className="fixed inset-0 z-drawer">
      <div className="absolute inset-0 animate-fade-in bg-zinc-950/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={m.title}
        className="absolute inset-y-0 right-0 flex w-full max-w-drawer animate-slide-in flex-col bg-canvas/95 shadow-drawer ring-1 ring-line-strong backdrop-blur-glass"
      >
        <header className="space-y-3 border-b border-line bg-surface/80 px-7 py-5">
          <div className="flex items-center gap-3">
            <span className={cn('grid h-9 w-9 place-items-center rounded-xl bg-zinc-800 ring-1 ring-line-strong', STATUS_STYLES[m.status].text)}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <h2 className="flex-1 text-lg font-semibold tracking-tight text-ink-strong">{m.title}</h2>
            <Button ref={closeRef} variant="ghost" size="icon" icon={X} onClick={onClose} aria-label="Đóng" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={m.priority} />
            <StatusBadge status={m.status} />
            <span className="rounded-md px-1.5 py-0.5 font-mono text-xxs text-ink-muted ring-1 ring-line-strong">confidence {pct(m.confidence)}</span>
            <span className="ml-auto font-mono text-sm font-bold text-ink-strong">−{fmt(m.module_risk_points)} trust</span>
          </div>
          <p className="text-xs leading-relaxed text-ink-muted">{m.summary_headline}</p>
        </header>

        <div className="flex-1 space-y-9 overflow-y-auto px-7 py-7">
          <DrawerSection n={1} title="Observed Data" note="JS probe · DOM · Web Worker · HTTP/TLS">
            <ObservedDataTable data={m.observed_raw_data} />
          </DrawerSection>
          <DrawerSection n={2} title="Applied Rules Table" note={`${m.rules_evaluated.length} rule`}>
            <AppliedRulesTable rules={m.rules_evaluated} />
          </DrawerSection>
          <DrawerSection n={3} title="Reference Baseline">
            <ReferenceBaseline module={m} />
          </DrawerSection>
          <DrawerSection n={4} title="Stability & Multi-Context Check" note="Run 1 · Run 2 · Worker / iframe">
            <StabilityCheck module={m} />
          </DrawerSection>
          <DrawerSection n={5} title="Evidence Explanation">
            <EvidenceExplanation module={m} />
          </DrawerSection>
          <DrawerSection n={6} title="Raw JSON & Side-by-Side Diff">
            <RawDiffTerminal module={m} prevModule={prevModule} prevScanId={ctx.prev?.res?.scanId} />
          </DrawerSection>
        </div>
      </aside>
    </div>
  );
}
