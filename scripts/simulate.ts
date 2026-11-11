// In kết quả chấm điểm của các profile mô phỏng: node scripts/simulate.ts [profile-id]
import { analyze, RULEBOOK } from '../server/engine/index.ts';
import { PROFILES } from '../server/engine/profiles.ts';

const only = process.argv[2];
const seen = new Set<string>();
for (const p of PROFILES) {
  if (only && p.id !== only) continue;
  const s = p.build();
  const r = analyze(s.data, s.http, { net: s.net });
  const sb = r.scoring_breakdown;
  const ok = sb.enforcement_action === p.expected ? 'OK ' : 'XX ';
  console.log(`\n${ok}${p.id}: expected=${p.expected} got=${sb.enforcement_action} Trust=${sb.trust_score} (−${sb.total_risk_score}, raw ${sb.raw_score}) C=${sb.overall_confidence}`);
  if (sb.hard_block_reason) console.log(`   hard block: ${sb.hard_block_reason}`);
  console.log(`   modules ${JSON.stringify(r.module_summary_counts)}`);
  for (const m of r.modules) {
    for (const x of m.rules_evaluated) {
      if (x.status === 'PASS') continue;
      const isHit = x.status !== 'UNAVAILABLE' || x.severity === 'INFO';
      if (isHit && !(x.status === 'UNAVAILABLE' && /^(Thiếu|Không|Chưa|Edge|Canvas không|Audio không|WebGL không)/.test(x.message))) seen.add(x.rule_id);
      console.log(`   ${x.status.padEnd(11)} ${x.rule_id}  s=${x.effective_score}  +${x.contributed_score}  ${x.message.slice(0, 100)}`);
    }
  }
}
if (!only) console.log(`\nChưa kích hoạt trong profile nào: ${RULEBOOK.filter((r) => !seen.has(r.id)).map((r) => r.id).join(' ') || '(không)'}`);
