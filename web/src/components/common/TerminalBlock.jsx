import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../lib/cn.js';

export function CopyButton({ text, className }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={copy}
      className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xxs text-ink-muted ring-1 ring-line-strong transition-colors hover:bg-raised hover:text-ink-strong', copied && 'text-pass-300 ring-pass-500/40', className)}
      aria-label="Copy"
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/**
 * Khung kiểu Terminal: thanh tiêu đề có 3 chấm, tab tùy chọn, nút copy; thân nền tối hơn card.
 * tabs: [{ id, label }], activeTab, onTab
 */
export function TerminalBlock({ title, tabs, activeTab, onTab, copyText, children, className, bodyClassName }) {
  return (
    <div className={cn('overflow-hidden rounded-xl bg-sunken ring-1 ring-line shadow-glass', className)}>
      <div className="flex items-center gap-3 border-b border-line bg-zinc-900/80 px-4 py-2">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-fail-500/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn-500/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-pass-500/80" />
        </div>
        <span className="truncate font-mono text-xxs text-ink-faint">{title}</span>
        {tabs && (
          <div className="ml-2 flex gap-1" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => onTab(t.id)}
                className={cn('rounded-md px-2 py-0.5 font-mono text-xxs transition-colors', activeTab === t.id ? 'bg-raised text-ink-strong' : 'text-ink-faint hover:text-ink')}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto">{copyText != null && <CopyButton text={copyText} />}</div>
      </div>
      <div className={cn('max-h-terminal overflow-auto p-4 font-mono text-xs leading-relaxed text-zinc-300', bodyClassName)}>{children}</div>
    </div>
  );
}
