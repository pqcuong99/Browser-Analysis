import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Database, Download, FlaskConical, GitCompareArrows, Radar, RefreshCw, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Button } from '../common/Button.jsx';
import { StatusPill } from '../common/StatusPill.jsx';

const MODES = [
  { id: 'scanner', label: 'Public Scanner', icon: Radar },
  { id: 'qa', label: 'Internal Browser QA', icon: GitCompareArrows },
  { id: 'admin', label: 'Admin Rules & Blocking Policy', icon: SlidersHorizontal },
];

const EXPECTED_STATUS = { ALLOW: 'PASS', CHALLENGE: 'WARNING', BLOCK: 'FAIL' };

const TAB_TONE = {
  true: 'text-ink-strong',
  false: 'text-ink-muted hover:text-ink',
};

/** Thanh tab hàng dưới; gạch chân trượt theo tab đang chọn */
function ModeSwitcher({ view, onChange }) {
  return (
    <nav role="tablist" aria-label="Chế độ hoạt động" className="no-scrollbar -mb-px flex gap-1 overflow-x-auto">
      {MODES.map(({ id, label, icon: Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={cn('relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg px-3.5 pb-3 pt-2 text-sm transition-colors', TAB_TONE[active])}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
            {active && (
              <motion.span
                layoutId="nav-active-tab"
                className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-400 shadow-glow-accent"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

function MenuItem({ title, description, expected, icon: Icon, onClick }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-zinc-800/80">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-strong">{title}</span>
          {expected && <StatusPill status={EXPECTED_STATUS[expected]} label={expected} />}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">{description}</span>
      </span>
    </button>
  );
}

function SimulateMenu({ profiles, mockProfile, onSimulate, onMock, onLive }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <div className="relative" ref={ref}>
      <Button icon={FlaskConical} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Simulate Antidetect Profile" title="Simulate Antidetect Profile">
        <span className="hidden lg:inline">Simulate Antidetect Profile</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-menu mt-2 max-h-terminal w-96 animate-fade-in overflow-y-auto rounded-2xl bg-zinc-900/95 p-2 ring-1 ring-line-strong shadow-glass backdrop-blur-glass">
          {profiles.map((p) => <MenuItem key={p.id} {...p} icon={FlaskConical} onClick={pick(() => onSimulate(p.id))} />)}
          <div className="my-1.5 h-px bg-line" />
          <MenuItem {...mockProfile} icon={Database} onClick={pick(onMock)} />
          <MenuItem title="Live browser (quét thật)" description="Quay lại báo cáo của trình duyệt hiện tại." icon={Radar} onClick={pick(onLive)} />
        </div>
      )}
    </div>
  );
}

/**
 * Thanh điều hướng kính mờ cố định trên cùng, 2 hàng để không bao giờ chồng lấn:
 *   hàng 1: thương hiệu (co lại được) + nút thao tác (không co)
 *   hàng 2: thanh tab chế độ (cuộn ngang trên màn hẹp)
 */
export function TopNav({ view, onView, ruleset, profiles, mockProfile, actions, busy }) {
  return (
    <header className="sticky top-0 z-nav border-b border-white/5 bg-zinc-950/60 shadow-glass backdrop-blur-glass backdrop-saturate-150">
      <div className="mx-auto max-w-dashboard px-6">
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fail-500/15 text-fail-400 ring-1 ring-fail-500/40 shadow-glow-fail">
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink-strong">
                SentinelFP <span className="hidden font-normal text-ink-muted md:inline">— Antidetect &amp; Fingerprint Analyzer</span>
              </div>
              <div className="flex items-center gap-1.5 truncate font-mono text-xxs text-pass-400">
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-pass-400" aria-hidden="true" />
                <span className="truncate">{ruleset}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="primary" icon={RefreshCw} onClick={actions.rescan} disabled={busy} aria-label="Re-scan Browser">
              <span className="hidden sm:inline">Re-scan Browser</span>
            </Button>
            <SimulateMenu profiles={profiles} mockProfile={mockProfile} onSimulate={actions.simulate} onMock={actions.mock} onLive={actions.live} />
            <Button icon={Download} onClick={actions.exportReport} aria-label="Export JSON Report" title="Export JSON Report">
              <span className="hidden lg:inline">Export JSON</span>
            </Button>
          </div>
        </div>
        <ModeSwitcher view={view} onChange={onView} />
      </div>
    </header>
  );
}
