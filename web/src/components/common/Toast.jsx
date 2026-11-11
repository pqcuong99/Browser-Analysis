import { createContext, useCallback, useContext, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const ToastContext = createContext(() => {});

const TONES = {
  info: { icon: Info, box: 'ring-line-strong', iconCls: 'text-accent-400', bar: 'bg-accent-400' },
  success: { icon: CheckCircle2, box: 'ring-pass-500/40 shadow-glow-pass', iconCls: 'text-pass-400', bar: 'bg-pass-500' },
  warning: { icon: AlertTriangle, box: 'ring-warn-500/50 shadow-glow-warn', iconCls: 'text-warn-400', bar: 'bg-warn-500' },
  danger: { icon: ShieldAlert, box: 'ring-fail-500/60 shadow-glow-fail', iconCls: 'text-fail-400', bar: 'bg-fail-500' },
};

/**
 * notify('text') hoặc notify({ tone, title, message, duration })
 * Toast nổi ở góc trên bên phải, dưới thanh điều hướng.
 */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const dismiss = useCallback((id) => setItems((x) => x.filter((t) => t.id !== id)), []);
  const notify = useCallback((input, ms) => {
    const t = typeof input === 'string' ? { message: input } : input;
    const id = Math.random().toString(36).slice(2);
    const duration = t.duration ?? ms ?? 3200;
    setItems((x) => [...x.slice(-3), { id, tone: 'info', ...t, duration }]);
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed right-4 top-32 z-toast flex w-full max-w-sm flex-col gap-3 sm:right-6" aria-live="polite" role="status">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const tone = TONES[t.tone] ?? TONES.info;
            const Icon = tone.icon;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, x: 40, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className={cn('pointer-events-auto relative overflow-hidden rounded-2xl bg-zinc-900/90 px-4 py-3.5 ring-1 backdrop-blur-glass', tone.box)}
              >
                <div className="flex gap-3">
                  {t.icon !== false && <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone.iconCls)} aria-hidden="true" />}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {t.title && <p className="text-sm font-semibold text-ink-strong">{t.title}</p>}
                    {t.message && <p className="text-xs leading-relaxed text-ink-muted">{t.message}</p>}
                  </div>
                  <button type="button" onClick={() => dismiss(t.id)} className="h-6 w-6 shrink-0 rounded-md text-ink-faint transition hover:bg-zinc-800 hover:text-ink" aria-label="Đóng thông báo">
                    <X className="mx-auto h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                {/* Thanh thời gian còn lại */}
                <motion.span
                  className={cn('absolute bottom-0 left-0 h-0.5', tone.bar)}
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: t.duration / 1000, ease: 'linear' }}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
