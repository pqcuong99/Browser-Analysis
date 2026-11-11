import { Activity, Eye, Fingerprint, Gauge, ShieldAlert } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { fmt, pct } from '../../lib/format.js';
import { ACTION_STYLES, STATUS_STYLES } from '../../lib/statusStyles.js';
import { Button } from '../common/Button.jsx';
import { Card, CardTitle, EmptyNote, KeyValueList } from '../common/Card.jsx';
import { StatusPill } from '../common/StatusPill.jsx';
import { ChallengePanel } from './ChallengePanel.jsx';
import { TrustGauge } from './TrustGauge.jsx';

function isOsMismatch(env) {
  if (env.inferred_real_os === 'Unknown') return false;
  if (env.declared_os.startsWith('iOS') && env.inferred_real_os === 'macOS') return false;
  return !env.declared_os.startsWith(env.inferred_real_os);
}

function IdentityTile({ eyebrow, title, subtitle, alert }) {
  return (
    <div className={cn('min-w-0 rounded-xl bg-zinc-950/60 px-4 py-3 ring-1 ring-line', alert && 'bg-fail-500/10 ring-fail-500/50')}>
      <div className="eyebrow mb-1">{eyebrow}</div>
      <div className={cn('truncate font-semibold text-ink-strong', alert && 'text-fail-200')}>{title}</div>
      <div className="truncate font-mono text-xxs text-ink-faint">{subtitle}</div>
    </div>
  );
}

/** Khối 1: định danh phiên quét, khai báo vs suy luận */
function IdentityPanel({ res }) {
  const r = res.report;
  const env = r.environment_summary;
  return (
    <Card className="flex flex-col gap-5 lg:col-span-4">
      <CardTitle icon={Fingerprint}>Scan Identity</CardTitle>
      <KeyValueList
        items={[
          { label: 'Scan ID', value: res.scanId, mono: true },
          { label: 'Timestamp', value: new Date(r.timestamp).toLocaleString(), mono: true },
          { label: 'IP Public', value: env.country_code === '—' ? env.client_ip : `${env.client_ip} · ${env.country_code}`, mono: true },
          { label: 'ASN / ISP', value: env.asn_org },
          res.label && { label: 'Label', value: res.label, mono: true },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <IdentityTile eyebrow="Declared · User-Agent" title={env.declared_browser} subtitle={env.declared_os} />
        <IdentityTile eyebrow="Observed · Inferred" title={env.inferred_real_os} subtitle={env.inferred_real_engine} alert={isOsMismatch(env)} />
      </div>
      <p className="break-all rounded-xl bg-sunken px-4 py-3 font-mono text-xxs leading-relaxed text-ink-muted ring-1 ring-line">{env.declared_user_agent}</p>
    </Card>
  );
}

/** Khối 2: đồng hồ Trust Score + quyết định chặn */
function TrustPanel({ ctx, onPreview, onChallengePassed, onScoreAnimated }) {
  const sb = ctx.res.report.scoring_breakdown;
  const action = ACTION_STYLES[sb.enforcement_action];
  const ActionIcon = action.icon;
  return (
    <Card className="flex flex-col gap-5 lg:col-span-4">
      <CardTitle icon={Gauge}>Trust Score &amp; Enforcement</CardTitle>
      <TrustGauge score={sb.trust_score} thresholds={sb.thresholds} animKey={ctx.res.scanId} onComplete={onScoreAnimated} />
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-zinc-950/50 px-2 py-2.5 ring-1 ring-line">
          <div className="eyebrow">Confidence</div>
          <div className="font-mono text-base font-semibold text-ink-strong">{pct(sb.overall_confidence)}</div>
        </div>
        <div className="rounded-xl bg-zinc-950/50 px-2 py-2.5 ring-1 ring-line">
          <div className="eyebrow">Bị trừ</div>
          <div className="font-mono text-base font-semibold text-ink-strong">−{fmt(sb.total_risk_score)}</div>
        </div>
        <div className="rounded-xl bg-zinc-950/50 px-2 py-2.5 ring-1 ring-line">
          <div className="eyebrow">Label</div>
          <div className="truncate pt-0.5 text-xs font-medium text-ink-strong">{sb.risk_label}</div>
        </div>
      </div>
      <div className={cn('flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-mono text-xs font-bold tracking-wider', action.banner)} role="status">
        <ActionIcon className="h-4 w-4" aria-hidden="true" />
        {action.label}
      </div>
      {sb.hard_block_triggered && (
        <p className="rounded-xl bg-fail-500/10 px-4 py-3 text-xs leading-relaxed text-fail-200 ring-1 ring-fail-500/30">
          <span className="font-semibold">Hard-Block Override: </span>{sb.hard_block_reason}
        </p>
      )}
      {sb.enforcement_action === 'CHALLENGE' && <ChallengePanel ctx={ctx} onPassed={onChallengePassed} />}
      {action.previewLabel && (
        <Button variant={action.previewButton} icon={Eye} onClick={onPreview} className="mt-auto w-full">{action.previewLabel}</Button>
      )}
    </Card>
  );
}

/** Khối 3: thống kê 10 module + top tín hiệu */
function StatusSummary({ report, onOpenModule }) {
  const c = report.module_summary_counts;
  const fails = report.top_signals.filter((s) => s.status === 'FAIL').slice(0, 3);
  const signals = fails.length ? fails : report.top_signals.slice(0, 3);
  const title = fails.length ? 'Top Triggered High-Risk Signals' : 'Top Signals';
  return (
    <Card className="flex flex-col gap-5 lg:col-span-4">
      <CardTitle icon={Activity}>10 Modules · Status</CardTitle>
      <div className="flex flex-wrap gap-2">
        {['FAIL', 'WARNING', 'PASS', 'UNAVAILABLE'].map((s) => <StatusPill key={s} status={s} count={c[s]} />)}
      </div>
      <div className="h-px bg-line" />
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
        <h3 className="eyebrow">{title}</h3>
      </div>
      {signals.length === 0 && <EmptyNote>Không có rule nào bị kích hoạt.</EmptyNote>}
      <ul className="space-y-2.5">
        {signals.map((s) => {
          const st = STATUS_STYLES[s.status];
          return (
            <li key={s.rule_id}>
              <button
                type="button"
                onClick={() => onOpenModule(s.module_id)}
                className="grid w-full grid-cols-signal items-start gap-3 rounded-xl bg-zinc-950/50 px-4 py-3 text-left ring-1 ring-line transition hover:ring-line-strong"
              >
                <span className={cn('h-2 w-2 translate-y-1.5 rounded-full', st.dot)} aria-hidden="true" />
                <span className="min-w-0">
                  <span className={cn('block font-mono text-xxs font-bold', st.text)}>{s.rule_id}</span>
                  <span className="block text-xs text-ink">{s.name}</span>
                </span>
                <span className="font-mono text-xs font-semibold text-ink-strong">−{fmt(s.contributed_score, 1)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Khu vực tổng quan đầu trang: 3 khối ngang trên lưới 12 cột */
export function OverviewBanner({ ctx, onPreview, onOpenModule, onChallengePassed, onScoreAnimated }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <IdentityPanel res={ctx.res} />
      <TrustPanel ctx={ctx} onPreview={onPreview} onChallengePassed={onChallengePassed} onScoreAnimated={onScoreAnimated} />
      <StatusSummary report={ctx.res.report} onOpenModule={onOpenModule} />
    </div>
  );
}
