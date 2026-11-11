import { Sigma } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { fmt } from '../../lib/format.js';
import { SectionHeader, TABLE } from '../common/Card.jsx';

/** Công thức + điểm theo nhóm nguyên nhân gốc (khử trùng lặp) */
export function ScoringBreakdown({ sb }) {
  const rows = Object.entries(sb.group_scores).sort((a, b) => b[1].group_total - a[1].group_total);
  const max = Math.max(1, ...rows.map(([, g]) => g.group_total));
  const hb = sb.hard_block_policy;
  return (
    <section aria-label="Scoring Breakdown">
      <SectionHeader icon={Sigma} title="Scoring Breakdown" hint="Khử trùng lặp theo nhóm nguyên nhân gốc (Correlation Group Damping)" />
      <div className="mb-5 space-y-1.5 rounded-xl bg-sunken px-5 py-4 font-mono text-xs leading-relaxed text-ink-muted ring-1 ring-line">
        <p>
          <span className="text-ink-strong">sᵢ = wᵢ × cᵢ</span>
          <span className="mx-3 text-ink-faint">·</span>
          <span className="text-ink-strong">S(Gk) = max(sᵢ) + {sb.damping ?? 0.25} × Σ s_j</span>
          <span className="mx-3 text-ink-faint">·</span>
          <span className="text-ink-strong">Trust = 100 − min(100, round(Σ S(Gk))) = {sb.trust_score}</span>
        </p>
        <p>
          Safe (ALLOW) ≥ {sb.thresholds.safe} · Suspicious (CHALLENGE) {sb.thresholds.suspicious}–{sb.thresholds.safe - 1} · High Risk (BLOCK) &lt; {sb.thresholds.suspicious} · Hard-block{hb.enabled ? '' : ' (tắt)'}: ≥ {hb.minRules} rule CRITICAL FAIL (c ≥ {hb.minConfidence}) ở module và nhóm khác nhau ⇒ Trust ≤ {hb.maxTrust}
        </p>
      </div>
      <div className={TABLE.wrap}>
        <table className={TABLE.table}>
          <thead>
            <tr>
              <th className={TABLE.th}>Correlation group</th>
              <th className={TABLE.th}>Triggered rules</th>
              <th className={cn(TABLE.th, 'text-right')}>max(sᵢ)</th>
              <th className={cn(TABLE.th, 'text-right')}>+damped</th>
              <th className={cn(TABLE.th, 'text-right')}>−Trust S(Gk)</th>
              <th className={TABLE.th}><span className="sr-only">Tỉ lệ</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([g, s]) => (
              <tr key={g} className={cn(!s.group_total && 'text-ink-faint')}>
                <td className={cn(TABLE.td, 'font-mono')}>{g}</td>
                <td className={cn(TABLE.td, 'font-mono')}>{s.triggered_rules.join(', ') || '—'}</td>
                <td className={cn(TABLE.td, TABLE.num)}>{fmt(s.max_rule_score)}</td>
                <td className={cn(TABLE.td, TABLE.num)}>{fmt(s.damped_additional_score)}</td>
                <td className={cn(TABLE.td, TABLE.num, 'font-bold text-ink-strong')}>{fmt(s.group_total)}</td>
                <td className={cn(TABLE.td, 'w-40')}>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-warn-500 to-fail-500" style={{ width: `${(s.group_total / max) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
