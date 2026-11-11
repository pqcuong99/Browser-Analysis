import { randomUUID } from 'node:crypto';
import { MODULE_VIEWS, engineLabel, inferRealOS } from './modules.ts';
import { defaultPolicy, type Policy } from './policy.ts';
import { MODULES, RULEBOOK, RULESET_VERSION } from './rulebook.ts';
import { EVALUATORS, type Ctx, type Outcome } from './rules.ts';
import {
  GROUP_IDS, type CorrelationGroupId, type GroupScore, type ModuleDiagnosticReport, type ModuleStatus,
  type NetIntel, type RuleEvaluationResult, type ScanReportResponse,
} from './types.ts';
import { parseUA } from './ua.ts';

export { RULEBOOK, MODULES, RULESET_VERSION };

const REQUIRED_PARTS = ['navigator', 'engine', 'screen', 'locale', 'canvas', 'webgl', 'tamper', 'automation', 'iframe'];
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface AnalyzeOptions {
  policy?: Policy;
  net?: NetIntel;
  scanId?: string;
  now?: number;
  simulatedProfile?: string;
}

export function analyze(rawData: any, http: Ctx['http'], opts: AnalyzeOptions = {}): ScanReportResponse {
  const data = rawData && typeof rawData === 'object' ? rawData : {};
  const policy = opts.policy ?? defaultPolicy();
  const net = opts.net ?? {};
  const serverNow = opts.now ?? Date.now();

  const ua = parseUA(String(data.navigator?.userAgent ?? http.headers['user-agent'] ?? ''));
  const engine = String(data.engine?.engine ?? 'unknown');
  const brands: string[] = (data.uaData?.brands ?? []).map((b: any) => b.brand);
  const brave = !!data.navigator?.isBrave && brands.includes('Brave');
  const privacyReason = brave ? 'Brave (farbling)'
    : engine === 'gecko' ? 'Firefox (fingerprinting protection)'
    : engine === 'webkit' ? 'Safari (Advanced Fingerprinting Protection)'
    : null;
  const ctx: Ctx = { data, http, net, ua, engine, privacyBrowser: !!privacyReason, privacyReason, serverNow };

  // ---------- Lớp 1-3: đánh giá từng rule ----------
  const results: RuleEvaluationResult[] = RULEBOOK.map((meta) => {
    const ov = policy.rules[meta.id] ?? {};
    const weight = ov.weight ?? meta.weight;
    const baseConf = ov.confidence ?? meta.confidence;
    let o: Outcome;
    if (ov.enabled === false) o = { result: 'na', message: 'Rule đã bị tắt trong Blocking Policy' };
    else {
      try {
        o = EVALUATORS[meta.id](ctx);
      } catch (e: any) {
        o = { result: 'na', message: `Không đánh giá được: ${e?.message ?? e}` };
      }
    }
    const status: ModuleStatus = o.result === 'pass' ? 'PASS'
      : o.result === 'na' ? 'UNAVAILABLE'
      : o.downgrade && meta.status === 'FAIL' ? 'WARNING'
      : meta.status;
    const confidence = o.result === 'hit' && o.confidence !== undefined ? Math.min(o.confidence, baseConf) : baseConf;
    const triggered = status === 'FAIL' || status === 'WARNING';
    return {
      rule_id: meta.id, name: meta.name, module_id: meta.module, group_id: meta.group,
      status, severity: meta.severity, base_weight: weight, confidence: round2(confidence),
      effective_score: triggered ? round2(weight * confidence) : 0, contributed_score: 0,
      observed_value: o.observed ?? null, expected_baseline: meta.baseline,
      evidence_explanation: meta.explanation, message: o.message,
    };
  });

  // ---------- Lớp 4: khử trùng lặp theo nhóm nguyên nhân gốc ----------
  const group_scores = {} as Record<CorrelationGroupId, GroupScore>;
  for (const g of GROUP_IDS) {
    const rs = results.filter((r) => r.group_id === g && r.effective_score > 0).sort((a, b) => b.effective_score - a.effective_score);
    const [top, ...rest] = rs;
    if (top) top.contributed_score = top.effective_score;
    for (const r of rest) r.contributed_score = round2(r.effective_score * policy.damping);
    const max = top?.effective_score ?? 0;
    const damped = round2(rest.reduce((a, r) => a + r.contributed_score, 0));
    group_scores[g] = { max_rule_score: max, damped_additional_score: damped, group_total: round2(max + damped), triggered_rules: rs.map((r) => r.rule_id) };
  }
  const rawScore = round2(Object.values(group_scores).reduce((a, g) => a + g.group_total, 0));
  let score = Math.min(100, Math.round(rawScore));

  // ---------- Hard-block override ----------
  let hardReason: string | undefined;
  let hardRules: string[] | undefined;
  const missing = REQUIRED_PARTS.filter((k) => !data[k] || typeof data[k] !== 'object');
  const ip = http.ip.replace(/^::ffff:/i, '');
  if (missing.length) {
    hardReason = `Payload probe thiếu phần bắt buộc (${missing.join(', ')}): script bị chặn hoặc dữ liệu bị dựng tay`;
    score = Math.max(score, 100 - policy.hardBlock.maxTrust);
  } else if (policy.blocklist.ips.includes(ip) || (net.asn && policy.blocklist.asns.includes(net.asn.toUpperCase())) || (net.ja4 && policy.blocklist.ja4.includes(net.ja4))) {
    hardReason = 'IP / ASN / JA4 nằm trong Blocklist của admin';
    score = 100;
  } else if (policy.hardBlock.enabled) {
    // Cần >= minRules rule CRITICAL bị FAIL ở các module VÀ nhóm nguyên nhân khác nhau (bằng chứng độc lập)
    const crit = results
      .filter((r) => r.severity === 'CRITICAL' && r.status === 'FAIL' && r.confidence >= policy.hardBlock.minConfidence)
      .sort((a, b) => b.effective_score - a.effective_score);
    const usedM = new Set<string>(), usedG = new Set<string>(), picked: RuleEvaluationResult[] = [];
    for (const r of crit) {
      if (usedM.has(r.module_id) || usedG.has(r.group_id)) continue;
      usedM.add(r.module_id); usedG.add(r.group_id); picked.push(r);
    }
    if (picked.length >= policy.hardBlock.minRules) {
      hardRules = picked.map((r) => r.rule_id);
      hardReason = `${picked.length} rule CRITICAL độc lập bị FAIL (c ≥ ${policy.hardBlock.minConfidence}): ${hardRules.join(', ')}`;
      score = Math.max(score, 100 - policy.hardBlock.maxTrust);
    }
  }
  const hard = !!hardReason;
  // Trust Score: 100 = hoàn hảo, mỗi rule FAIL/WARNING trừ dần (đúng bằng tổng điểm rủi ro sau damping)
  const trust = 100 - score;
  const { safe, suspicious } = policy.thresholds;
  let action: ScanReportResponse['scoring_breakdown']['enforcement_action'] = 'ALLOW';
  if (hard || trust < suspicious) action = 'BLOCK';
  else if (trust < safe) action = 'CHALLENGE';
  const RISK_LABEL = { ALLOW: 'Safe', CHALLENGE: 'Suspicious', BLOCK: 'High Risk (Antidetect)' } as const;
  const risk_label = RISK_LABEL[action];

  const triggered = results.filter((r) => r.effective_score > 0);
  const sumW = triggered.reduce((a, r) => a + r.base_weight, 0);
  const overall_confidence = sumW ? round2(triggered.reduce((a, r) => a + r.base_weight * r.confidence, 0) / sumW) : 1;

  // ---------- Báo cáo theo module ----------
  const modules: ModuleDiagnosticReport[] = MODULES.map((m) => {
    const rs = results.filter((r) => r.module_id === m.id);
    const status: ModuleStatus = rs.some((r) => r.status === 'FAIL') ? 'FAIL'
      : rs.some((r) => r.status === 'WARNING') ? 'WARNING'
      : rs.some((r) => r.status === 'PASS') ? 'PASS'
      : 'UNAVAILABLE';
    const trig = rs.filter((r) => r.effective_score > 0);
    const w = trig.reduce((a, r) => a + r.base_weight, 0);
    const evaluated = rs.filter((r) => r.status !== 'UNAVAILABLE').length;
    const lead = [...trig].sort((a, b) => b.contributed_score - a.contributed_score)[0];
    // Rule INFO (CANV_05, WRTC_05…) mô tả lý do module không khả dụng
    const infoHit = rs.find((r) => r.severity === 'INFO' && r.status === 'UNAVAILABLE' && !/^Thiếu/.test(r.message));
    const view = MODULE_VIEWS[m.id];
    const safe = <T>(f: () => T, fb: T): T => { try { return f(); } catch { return fb; } };
    return {
      module_id: m.id, title: m.title, priority: m.priority, status,
      module_risk_points: round2(rs.reduce((a, r) => a + r.contributed_score, 0)),
      confidence: w ? round2(trig.reduce((a, r) => a + r.base_weight * r.confidence, 0) / w) : round2(evaluated / rs.length),
      summary_headline: lead ? `${lead.rule_id}: ${lead.message}`
        : status === 'UNAVAILABLE' ? (infoHit ? `${infoHit.rule_id}: ${infoHit.message}` : rs[0]?.message ?? 'Không đủ dữ liệu')
        : `${evaluated}/${rs.length} kiểm tra hợp lệ${infoHit ? ` · ${infoHit.rule_id}: ${infoHit.message}` : ', không phát hiện bất thường'}`,
      key_metrics: safe(() => view.metrics(ctx), []),
      reference_baseline: `${m.baseline} Ngữ cảnh đối chiếu: ${ua.browser} ${ua.major ?? ''} · ${ua.os} · ${engineLabel(engine)}${data.webgl?.unmaskedRenderer ? ` · ${String(data.webgl.unmaskedRenderer).slice(0, 60)}` : ''}.`,
      stability_check: safe(() => view.stability?.(ctx), undefined),
      observed_raw_data: safe(() => view.observed(ctx), {}),
      rules_evaluated: rs,
    };
  });

  const module_summary_counts: Record<ModuleStatus, number> = { PASS: 0, WARNING: 0, FAIL: 0, UNAVAILABLE: 0 };
  for (const m of modules) module_summary_counts[m.status]++;

  const top_signals = triggered
    .sort((a, b) => (a.status === b.status ? b.contributed_score - a.contributed_score : a.status === 'FAIL' ? -1 : 1))
    .slice(0, 5)
    .map((r) => ({ rule_id: r.rule_id, name: r.name, module_id: r.module_id, status: r.status, contributed_score: r.contributed_score, message: r.message }));

  return {
    scan_id: opts.scanId ?? randomUUID(),
    timestamp: new Date(serverNow).toISOString(),
    ruleset_version: RULESET_VERSION,
    ...(opts.simulatedProfile ? { simulated_profile: opts.simulatedProfile } : {}),
    environment_summary: {
      declared_user_agent: ua.raw,
      declared_os: ua.os + (ua.mobile ? ' (mobile)' : ''),
      declared_browser: `${ua.browser}${ua.version ? ' ' + ua.version : ''}`,
      inferred_real_os: inferRealOS(ctx),
      inferred_real_engine: engineLabel(engine, data.engine?.jsEngine),
      client_ip: ip,
      asn_org: net.asnOrg ? `${net.asn ? net.asn + ' · ' : ''}${net.asnOrg}` : net.asn ?? 'Unknown (chưa cấu hình ASN)',
      country_code: net.country ?? '—',
    },
    scoring_breakdown: {
      trust_score: trust, total_risk_score: score, raw_score: rawScore, overall_confidence, risk_label, enforcement_action: action,
      hard_block_triggered: hard,
      ...(hardReason ? { hard_block_reason: hardReason } : {}),
      ...(hardRules ? { hard_block_rules: hardRules } : {}),
      thresholds: { safe, suspicious }, damping: policy.damping, hard_block_policy: policy.hardBlock,
      group_scores,
    },
    module_summary_counts,
    top_signals,
    modules,
  };
}
