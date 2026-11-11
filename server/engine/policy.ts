import { RULE_BY_ID } from './rulebook.ts';

export interface RuleOverride { enabled?: boolean; weight?: number; confidence?: number }

/**
 * Ngưỡng tính theo Trust Score (100 = hoàn hảo, trừ dần theo rule kích hoạt):
 *   Trust ≥ safe                → ALLOW     (Safe)
 *   suspicious ≤ Trust < safe   → CHALLENGE (Suspicious)
 *   Trust < suspicious          → BLOCK     (High Risk / Antidetect)
 */
export interface Policy {
  thresholds: { safe: number; suspicious: number };
  /** Hệ số cộng thêm cho các rule phụ trong cùng nhóm nguyên nhân gốc */
  damping: number;
  /** Hard-block ép Trust ≤ maxTrust */
  hardBlock: { enabled: boolean; minRules: number; minConfidence: number; maxTrust: number };
  rules: Record<string, RuleOverride>;
  blocklist: { ips: string[]; asns: string[]; ja4: string[] };
  updatedAt?: string;
}

export function defaultPolicy(thresholds = { safe: 80, suspicious: 50 }): Policy {
  return {
    thresholds: { ...thresholds },
    damping: 0.25,
    hardBlock: { enabled: true, minRules: 2, minConfidence: 0.9, maxTrust: 25 },
    rules: {},
    blocklist: { ips: [], asns: [], ja4: [] },
  };
}

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const strList = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [])
    .map((x) => String(x).trim()).filter(Boolean).slice(0, 5000);

/** Policy lưu từ bản trước (ngưỡng theo Risk Score) -> quy đổi sang Trust Score, giữ nguyên ý nghĩa */
function migrateLegacy(p: any) {
  const t = p.thresholds ?? {};
  const out = { ...p, thresholds: { ...t }, hardBlock: { ...(p.hardBlock ?? {}) } };
  if (t.safe === undefined && t.challenge !== undefined) out.thresholds.safe = 101 - Number(t.challenge);
  if (t.suspicious === undefined && t.block !== undefined) out.thresholds.suspicious = 101 - Number(t.block);
  if (out.hardBlock.maxTrust === undefined && p.hardBlock?.floorScore !== undefined) out.hardBlock.maxTrust = 100 - Number(p.hardBlock.floorScore);
  return out;
}

/** Chuẩn hóa policy do admin gửi lên: kẹp giá trị vào miền hợp lệ, bỏ rule không tồn tại */
export function sanitizePolicy(input: any, base: Policy): Policy {
  const p = migrateLegacy(input && typeof input === 'object' ? input : {});
  const safe = num(p.thresholds?.safe, 2, 100, base.thresholds.safe);
  const suspicious = num(p.thresholds?.suspicious, 1, safe - 1, Math.min(base.thresholds.suspicious, safe - 1));
  const rules: Record<string, RuleOverride> = {};
  for (const [id, o] of Object.entries(p.rules ?? {})) {
    const meta = RULE_BY_ID.get(id);
    if (!meta || !o || typeof o !== 'object') continue;
    const r: RuleOverride = {};
    const ov = o as any;
    if (ov.enabled === false) r.enabled = false;
    if (ov.weight !== undefined && Number(ov.weight) !== meta.weight) r.weight = num(ov.weight, 0, 50, meta.weight);
    if (ov.confidence !== undefined && Number(ov.confidence) !== meta.confidence) r.confidence = num(ov.confidence, 0, 1, meta.confidence);
    if (Object.keys(r).length) rules[id] = r;
  }
  return {
    thresholds: { safe, suspicious },
    damping: num(p.damping, 0, 1, base.damping),
    hardBlock: {
      enabled: p.hardBlock?.enabled === undefined ? base.hardBlock.enabled : !!p.hardBlock.enabled,
      minRules: Math.round(num(p.hardBlock?.minRules, 1, 10, base.hardBlock.minRules)),
      minConfidence: num(p.hardBlock?.minConfidence, 0, 1, base.hardBlock.minConfidence),
      maxTrust: Math.round(num(p.hardBlock?.maxTrust, 0, 100, base.hardBlock.maxTrust)),
    },
    rules,
    blocklist: {
      ips: strList(p.blocklist?.ips),
      asns: strList(p.blocklist?.asns).map((a) => a.toUpperCase()),
      ja4: strList(p.blocklist?.ja4),
    },
    updatedAt: new Date().toISOString(),
  };
}
