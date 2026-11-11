import { cn } from '../../lib/cn.js';

const VARIANTS = {
  primary: 'bg-accent-400 text-zinc-950 hover:bg-accent-300 shadow-glow-accent font-semibold',
  secondary: 'bg-raised/70 text-ink-strong ring-1 ring-line-strong hover:bg-raised',
  ghost: 'text-ink-muted hover:text-ink-strong hover:bg-raised/60',
  danger: 'bg-fail-500/15 text-fail-200 ring-1 ring-fail-500/60 hover:bg-fail-500/25',
  success: 'bg-pass-500/15 text-pass-200 ring-1 ring-pass-500/50 hover:bg-pass-500/25',
};

const SIZES = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm',
  icon: 'h-9 w-9 justify-center',
};

export function Button({ variant = 'secondary', size = 'md', icon: Icon, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}
