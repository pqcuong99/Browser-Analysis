import { cn } from '../../lib/cn.js';
import { PRIORITY_STYLES, SEVERITY_STYLES, STATUS_STYLES } from '../../lib/statusStyles.js';

/** Badge bo tròn nhỏ: chấm màu + nhãn trạng thái + số đếm (tùy chọn) */
export function StatusPill({ status, count, label, className }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.UNAVAILABLE;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-xxs font-semibold tracking-wide', s.pill, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden="true" />
      {count != null && <span className="tabular text-ink-strong">{count}</span>}
      {label ?? s.label}
    </span>
  );
}

/** Badge trạng thái có icon, dùng trong thẻ module và bảng rule */
export function StatusBadge({ status, label, className }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.UNAVAILABLE;
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xxs font-bold tracking-wider', s.badge, className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label ?? s.label}
    </span>
  );
}

export function SeverityBadge({ severity }) {
  return (
    <span className={cn('inline-flex rounded-md px-1.5 py-0.5 font-mono text-xxs font-semibold ring-1', SEVERITY_STYLES[severity])}>
      {severity}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  return (
    <span className={cn('inline-flex rounded-md px-1.5 py-0.5 font-mono text-xxs font-bold ring-1', PRIORITY_STYLES[priority])}>
      {priority}
    </span>
  );
}
