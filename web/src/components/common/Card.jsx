import { cn } from '../../lib/cn.js';

export function Card({ as: Tag = 'section', className, children, ...props }) {
  return (
    <Tag className={cn('rounded-2xl bg-surface/80 p-6 ring-1 ring-line backdrop-blur-sm', className)} {...props}>
      {children}
    </Tag>
  );
}

export function CardTitle({ icon: Icon, children, action, className }) {
  return (
    <div className={cn('mb-5 flex items-center gap-2', className)}>
      {Icon && <Icon className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />}
      <h2 className="eyebrow flex-1">{children}</h2>
      {action}
    </div>
  );
}

export function SectionHeader({ title, hint, icon: Icon, children }) {
  return (
    <div className="mb-5 mt-12 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-2.5">
        {Icon && <Icon className="h-4 w-4 text-accent-400" aria-hidden="true" />}
        <h2 className="text-base font-semibold tracking-tight text-ink-strong">{title}</h2>
      </div>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
      {children}
    </div>
  );
}

/** Danh sách nhãn - giá trị; mono cho dữ liệu kỹ thuật */
export function KeyValueList({ items, className }) {
  return (
    <dl className={cn('grid grid-cols-kv gap-x-5 gap-y-2.5 text-sm', className)}>
      {items.filter(Boolean).map(({ label, value, mono }) => (
        <div key={label} className="contents">
          <dt className="text-xs text-ink-faint">{label}</dt>
          <dd className={cn('min-w-0 break-words text-ink', mono && 'font-mono text-xs text-ink-strong')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyNote({ children, className }) {
  return (
    <div className={cn('rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-xs text-ink-faint', className)}>
      {children}
    </div>
  );
}

export const TABLE = {
  wrap: 'overflow-auto rounded-xl ring-1 ring-line bg-surface/60',
  table: 'w-full border-collapse text-left text-xs',
  th: 'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-zinc-900/95 px-4 py-2.5 font-mono text-xxs font-semibold uppercase tracking-wider text-ink-faint backdrop-blur',
  td: 'border-b border-line/70 px-4 py-2.5 align-top',
  num: 'text-right font-mono tabular',
  mono: 'font-mono text-xs text-ink-strong break-all',
};
