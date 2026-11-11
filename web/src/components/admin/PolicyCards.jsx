import { Ban, Gauge, ShieldOff } from 'lucide-react';
import { Card, CardTitle } from '../common/Card.jsx';
import { Toggle } from '../common/Toggle.jsx';

function NumberField({ label, value, onChange, min, max, step = 1 }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-ink-faint">
      {label}
      <input
        type="number"
        className="field-input w-28 font-mono"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

/** Ngưỡng Trust Score: Safe / Suspicious / High Risk + thanh minh họa */
export function ThresholdCard({ draft, defaults, update }) {
  const { safe, suspicious } = draft.thresholds;
  const set = (k) => (v) => update((d) => { d.thresholds[k] = v; });
  return (
    <Card className="space-y-5">
      <CardTitle icon={Gauge}>Trust Score Threshold</CardTitle>
      <div className="flex flex-wrap gap-4">
        <NumberField label="ALLOW khi Trust ≥" value={safe} onChange={set('safe')} min={2} max={100} />
        <NumberField label="BLOCK khi Trust <" value={suspicious} onChange={set('suspicious')} min={1} max={99} />
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full ring-1 ring-line" aria-hidden="true">
        <div className="bg-fail-500" style={{ width: `${suspicious}%` }} />
        <div className="bg-warn-500" style={{ width: `${Math.max(0, safe - suspicious)}%` }} />
        <div className="bg-pass-500" style={{ width: `${Math.max(0, 100 - safe)}%` }} />
      </div>
      <div className="flex justify-between font-mono text-xxs text-ink-faint">
        <span>BLOCK 0–{suspicious - 1}</span><span>CHALLENGE {suspicious}–{safe - 1}</span><span>ALLOW {safe}–100</span>
      </div>
      <p className="text-xs leading-relaxed text-ink-faint">
        Mặc định Safe ≥ {defaults.thresholds.safe}, Suspicious ≥ {defaults.thresholds.suspicious}. Chạy BG_MODE=monitor 1–2 tuần và xem Impact Preview trước khi nâng ngưỡng.
      </p>
    </Card>
  );
}

/** Damping + Hard-block override */
export function ScoringPolicyCard({ draft, update }) {
  const hb = (k) => (v) => update((d) => { d.hardBlock[k] = v; });
  return (
    <Card className="space-y-5">
      <CardTitle icon={ShieldOff}>Scoring &amp; Hard-Block Override</CardTitle>
      <div className="flex flex-wrap gap-4">
        <NumberField label="Damping (rule phụ)" value={draft.damping} onChange={(v) => update((d) => { d.damping = v; })} min={0} max={1} step={0.05} />
        <NumberField label="Hard-block: Trust tối đa" value={draft.hardBlock.maxTrust} onChange={hb('maxTrust')} min={0} max={100} />
        <NumberField label="Số rule CRITICAL" value={draft.hardBlock.minRules} onChange={hb('minRules')} min={1} max={10} />
        <NumberField label="cᵢ tối thiểu" value={draft.hardBlock.minConfidence} onChange={hb('minConfidence')} min={0} max={1} step={0.01} />
      </div>
      <Toggle checked={draft.hardBlock.enabled} onChange={hb('enabled')} label="Bật Hard-Block Override" />
      <p className="text-xs leading-relaxed text-ink-faint">Các rule CRITICAL phải nằm ở module VÀ nhóm nguyên nhân khác nhau mới được tính là bằng chứng độc lập.</p>
    </Card>
  );
}

const LISTS = [
  { key: 'ips', label: 'IP (mỗi dòng một IP)', placeholder: '198.51.100.7' },
  { key: 'asns', label: 'ASN', placeholder: 'AS64511' },
  { key: 'ja4', label: 'JA4', placeholder: 't13d4907h1_…' },
];

/** Danh sách chặn cứng */
export function BlocklistCard({ draft, update }) {
  return (
    <Card className="space-y-4">
      <CardTitle icon={Ban}>Blocklist</CardTitle>
      {LISTS.map(({ key, label, placeholder }) => (
        <label key={key} className="flex flex-col gap-1.5 text-xs text-ink-faint">
          {label}
          <textarea
            rows={3}
            placeholder={placeholder}
            className="field-input h-auto resize-y py-2 font-mono text-xs"
            value={(draft.blocklist[key] || []).join('\n')}
            onChange={(e) => update((d) => { d.blocklist[key] = e.target.value.split(/\s+/).map((x) => x.trim()).filter(Boolean); })}
          />
        </label>
      ))}
    </Card>
  );
}
