/** Công tắc bật/tắt (checkbox role=switch) */
export function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-ink-muted">
      <span className="relative inline-flex">
        <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="h-5 w-9 rounded-full bg-zinc-700 ring-1 ring-line-strong transition peer-checked:bg-accent-500/40 peer-checked:ring-accent-400 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-400" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-zinc-400 transition peer-checked:translate-x-4 peer-checked:bg-accent-300" />
      </span>
      {label}
    </label>
  );
}
