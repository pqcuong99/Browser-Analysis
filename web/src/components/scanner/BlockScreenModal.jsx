import { useEffect, useRef, useState } from 'react';
import { ShieldAlert, ShieldX, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { fmt, pct } from '../../lib/format.js';
import { Button } from '../common/Button.jsx';
import { EmptyNote, KeyValueList, TABLE } from '../common/Card.jsx';
import { SeverityBadge } from '../common/StatusPill.jsx';
import { Toggle } from '../common/Toggle.jsx';

// Nội dung màn hình theo quyết định (chỉ CHALLENGE và BLOCK mới có màn hình chặn).
const SCREENS = {
  BLOCK: {
    icon: ShieldX, tone: 'bg-fail-500/15 text-fail-400 ring-fail-500/60 shadow-glow-fail',
    code: 'HTTP 403 · ACCESS DENIED', title: 'Truy cập bị từ chối',
    text: 'Trình duyệt của bạn không đáp ứng chính sách bảo mật của hệ thống. Nếu bạn cho rằng đây là nhầm lẫn, hãy liên hệ bộ phận hỗ trợ và cung cấp mã tham chiếu bên dưới.',
    topLabel: 'Preview · HTTP 403 interstitial',
  },
  CHALLENGE: {
    icon: ShieldAlert, tone: 'bg-warn-500/10 text-warn-400 ring-warn-500/40',
    code: 'HTTP 403 · VERIFICATION REQUIRED', title: 'Cần xác minh thêm',
    text: 'Phiên truy cập có một số dấu hiệu bất thường. Trình duyệt sẽ tự giải một bài toán Proof-of-Work để tiếp tục.',
    topLabel: 'Preview · Challenge interstitial',
  },
};

/** Xem trước màn hình chặn + Developer Debug View (chỉ admin) */
export function BlockScreenModal({ ctx, onClose }) {
  const [debug, setDebug] = useState(false);
  const closeRef = useRef(null);
  const sb = ctx.res.report.scoring_breakdown;
  const action = sb.enforcement_action;
  const screen = SCREENS[action] ?? SCREENS.BLOCK;
  const Icon = screen.icon;
  const fails = ctx.res.report.modules.flatMap((m) => m.rules_evaluated).filter((x) => x.status === 'FAIL').sort((a, b) => b.contributed_score - a.contributed_score);

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

  return (
    <div className="fixed inset-0 z-modal grid animate-fade-in place-items-center overflow-y-auto bg-zinc-950/80 p-4 backdrop-blur" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Preview màn hình chặn" className="w-full max-w-modal overflow-hidden rounded-2xl bg-zinc-900/95 ring-1 ring-line-strong shadow-glass">
        <div className="flex items-center justify-between border-b border-line bg-zinc-950/60 px-5 py-3">
          <span className="eyebrow">{screen.topLabel}</span>
          <Button ref={closeRef} variant="ghost" size="sm" icon={X} onClick={onClose}>Đóng preview</Button>
        </div>


        <div className="flex flex-col items-center gap-4 px-8 py-10 text-center">
          <span className={cn('grid h-16 w-16 place-items-center rounded-2xl ring-1', screen.tone)}>
            <Icon className="h-8 w-8" aria-hidden="true" />
          </span>
          <span className="font-mono text-xxs font-bold tracking-widest text-ink-faint">{screen.code}</span>
          <h2 className="text-2xl font-bold tracking-tight text-ink-strong">{screen.title}</h2>
          <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{screen.text}</p>
          <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl bg-sunken px-4 py-2.5 ring-1 ring-line">
            <span className="text-xxs text-ink-faint">Reference ID</span>
            <code className="break-all font-mono text-xs text-ink-strong">{ctx.res.scanId}</code>
          </div>
        </div>

        <div className="border-t border-dashed border-line-strong px-6 py-5">
          <Toggle checked={debug} onChange={setDebug} label="Developer Debug View" />
          {debug && (
            <div className="mt-5 space-y-4">
              <p className="eyebrow">Chỉ hiển thị cho admin · không bao giờ trả về client ở production</p>
              <KeyValueList
                items={[
                  { label: 'Action', value: action, mono: true },
                  { label: 'Trust score', value: `${sb.trust_score}/100 (bị trừ ${sb.total_risk_score}, raw ${fmt(sb.raw_score)})`, mono: true },
                  { label: 'Confidence', value: pct(sb.overall_confidence), mono: true },
                  sb.hard_block_triggered && { label: 'Hard block', value: sb.hard_block_reason },
                ]}
              />
              {fails.length === 0 && <EmptyNote>Không có rule FAIL.</EmptyNote>}
              {fails.length > 0 && (
                <div className={TABLE.wrap}>
                  <table className={TABLE.table}>
                    <thead><tr><th className={TABLE.th}>FAIL rule</th><th className={TABLE.th}>Severity</th><th className={cn(TABLE.th, 'text-right')}>−Trust</th></tr></thead>
                    <tbody>
                      {fails.map((f) => (
                        <tr key={f.rule_id}>
                          <td className={TABLE.td}><div className="font-mono font-semibold text-ink-strong">{f.rule_id}</div><div className="mt-0.5 text-ink-muted">{f.message}</div></td>
                          <td className={TABLE.td}><SeverityBadge severity={f.severity} /></td>
                          <td className={cn(TABLE.td, TABLE.num)}>−{fmt(f.contributed_score)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
