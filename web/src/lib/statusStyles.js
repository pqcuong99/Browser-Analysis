// Bảng ánh xạ trạng thái -> class Tailwind + icon. Mọi component tra cứu tại đây,
// không dùng ternary lồng nhau để chọn màu.
import {
  AlertTriangle, Ban, CheckCircle2, CircleSlash, ShieldAlert, ShieldCheck, ShieldX, XOctagon,
} from 'lucide-react';

export const STATUS_ORDER = { FAIL: 0, WARNING: 1, PASS: 2, UNAVAILABLE: 3 };

export const STATUS_STYLES = {
  FAIL: {
    label: 'FAIL',
    icon: XOctagon,
    text: 'text-fail-400',
    badge: 'bg-fail-500/15 text-fail-300 ring-1 ring-fail-500/60',
    pill: 'bg-fail-500/10 text-fail-300 ring-1 ring-fail-500/40',
    dot: 'bg-fail-500 shadow-glow-fail',
    // Thẻ module FAIL: viền đỏ đậm + phát sáng nhấp nháy nhẹ
    card: 'ring-1 ring-fail-500 shadow-glow-fail animate-fail-pulse',
    headline: 'text-fail-200',
    row: 'bg-fail-500/5',
    accentBar: 'bg-fail-500',
  },
  WARNING: {
    label: 'WARNING',
    icon: AlertTriangle,
    text: 'text-warn-400',
    badge: 'bg-warn-500/10 text-warn-300 ring-1 ring-warn-500/40',
    pill: 'bg-warn-500/10 text-warn-300 ring-1 ring-warn-500/30',
    dot: 'bg-warn-500',
    card: 'ring-1 ring-warn-500/40 shadow-glow-warn',
    headline: 'text-warn-200',
    row: 'bg-warn-500/5',
    accentBar: 'bg-warn-500',
  },
  PASS: {
    label: 'PASS',
    icon: CheckCircle2,
    text: 'text-pass-400',
    badge: 'bg-pass-500/10 text-pass-300 ring-1 ring-pass-500/30',
    pill: 'bg-pass-500/10 text-pass-300 ring-1 ring-pass-500/25',
    dot: 'bg-pass-500',
    card: 'ring-1 ring-pass-500/15',
    headline: 'text-ink-muted',
    row: '',
    accentBar: 'bg-pass-500',
  },
  UNAVAILABLE: {
    label: 'N/A',
    icon: CircleSlash,
    text: 'text-na-400',
    badge: 'bg-na-500/10 text-na-300 ring-1 ring-na-500/30',
    pill: 'bg-na-500/10 text-na-300 ring-1 ring-na-500/25',
    dot: 'bg-na-500',
    card: 'ring-1 ring-na-500/15 opacity-80',
    headline: 'text-ink-faint',
    row: '',
    accentBar: 'bg-na-500',
  },
};

// Quyết định chặn. previewLabel = null nghĩa là không có nút xem trước màn hình chặn.
export const ACTION_STYLES = {
  ALLOW: {
    label: 'SAFE — ALLOW ACCESS',
    icon: ShieldCheck,
    banner: 'bg-pass-500/10 text-pass-300 ring-1 ring-pass-500/30',
    badge: STATUS_STYLES.PASS.badge,
    text: 'text-pass-400',
    previewLabel: null,
  },
  CHALLENGE: {
    label: 'SUSPICIOUS — CHALLENGE / REVIEW',
    icon: ShieldAlert,
    banner: 'bg-warn-500/10 text-warn-300 ring-1 ring-warn-500/40',
    badge: STATUS_STYLES.WARNING.badge,
    text: 'text-warn-400',
    previewLabel: 'Preview Challenge Screen',
    previewButton: 'secondary',
  },
  BLOCK: {
    label: 'HIGH RISK / ANTIDETECT — BLOCK',
    icon: ShieldX,
    banner: 'bg-fail-500/15 text-fail-200 ring-1 ring-fail-500 shadow-glow-fail animate-fail-pulse',
    badge: STATUS_STYLES.FAIL.badge,
    text: 'text-fail-400',
    previewLabel: 'Preview Block Screen',
    previewButton: 'danger',
  },
};

/** Dải Trust Score: ≥ safe → Safe (xanh), ≥ suspicious → Suspicious (vàng), còn lại High Risk (đỏ) */
export function trustBand(trust, thresholds) {
  if (trust >= thresholds.safe) return 'safe';
  if (trust >= thresholds.suspicious) return 'suspicious';
  return 'high';
}

export const TRUST_BAND_STYLES = {
  safe: { label: 'Safe', text: 'text-pass-400', toast: 'success' },
  suspicious: { label: 'Suspicious', text: 'text-warn-400', toast: 'warning' },
  high: { label: 'High Risk / Antidetect', text: 'text-fail-400', toast: 'danger' },
};

export const SEVERITY_STYLES = {
  CRITICAL: 'text-fail-300 ring-fail-500/40',
  HIGH: 'text-orange-300 ring-orange-500/40',
  MEDIUM: 'text-warn-300 ring-warn-500/35',
  LOW: 'text-ink-muted ring-line-strong',
  INFO: 'text-ink-faint ring-line-strong',
};

export const PRIORITY_STYLES = {
  P0: 'text-accent-300 ring-accent-500/35 bg-accent-500/5',
  P1: 'text-ink-muted ring-line-strong',
};

/** Thứ tự hiển thị thẻ: FAIL → WARNING → PASS → UNAVAILABLE, cùng trạng thái thì điểm cao trước */
export function sortModules(modules) {
  return [...modules].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.module_risk_points - a.module_risk_points);
}

export const BlockedIcon = Ban;
