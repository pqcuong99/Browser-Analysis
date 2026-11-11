/**
 * Chuẩn hóa báo cáo cũ (lưu theo Risk Score, ngưỡng challenge/block) sang Trust Score
 * để giao diện chỉ phải làm việc với một hệ điểm.
 */
export function normalizeReport(report) {
  const sb = report?.scoring_breakdown;
  if (!sb || sb.trust_score !== undefined) return report;
  const t = sb.thresholds ?? {};
  const hb = sb.hard_block_policy ?? {};
  return {
    ...report,
    scoring_breakdown: {
      ...sb,
      trust_score: 100 - sb.total_risk_score,
      thresholds: { safe: 101 - (t.challenge ?? 21), suspicious: 101 - (t.block ?? 51) },
      hard_block_policy: { ...hb, maxTrust: 100 - (hb.floorScore ?? 75) },
    },
  };
}
