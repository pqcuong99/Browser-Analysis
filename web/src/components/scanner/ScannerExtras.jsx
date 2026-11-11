import { AlertOctagon, FlaskConical, Lock, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Button } from '../common/Button.jsx';

const EXPECTED_TONE = {
  ALLOW: 'text-pass-300',
  CHALLENGE: 'text-warn-300',
  BLOCK: 'text-fail-300',
};

/** Banner khi đang xem dữ liệu mô phỏng / mock */
export function SimBanner({ profile, onBack }) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-accent-500/40 bg-accent-500/5 px-5 py-4">
      <FlaskConical className="h-5 w-5 shrink-0 text-accent-400" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-60 space-y-1">
        <p className="text-sm text-ink-strong">
          Simulated profile: <span className="font-semibold text-accent-300">{profile.title}</span>
          <span className="ml-2 font-mono text-xxs text-ink-faint">expected <span className={cn('font-bold', EXPECTED_TONE[profile.expected])}>{profile.expected}</span></span>
        </p>
        <p className="text-xs text-ink-muted">{profile.description}</p>
      </div>
      <Button size="sm" icon={RotateCcw} onClick={onBack}>Quay lại quét thật</Button>
    </div>
  );
}

/** Gợi ý mở bản HTTPS để server tự đo JA4 + HTTP/2 */
export function NetworkHint({ ctx, serverInfo }) {
  const net = ctx.res.report.modules.find((m) => m.module_id === 'network');
  if (!net || ctx.profile || net.status !== 'UNAVAILABLE') return null;
  const canUpgrade = location.protocol === 'http:' && serverInfo?.https;
  const text = canUpgrade
    ? 'Module Network đang N/A vì trang chạy qua HTTP thường. Mở bản HTTPS để server tự đo JA4 (TLS ClientHello) và HTTP/2 fingerprint.'
    : 'Module Network cần JA4/HTTP2 (HTTPS trực tiếp) hoặc dữ liệu ASN/GeoIP/p0f từ edge proxy. Xem README, mục “Dữ liệu tầng mạng”.';
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong px-5 py-3.5 text-xs text-ink-muted">
      <Lock className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
      <span className="min-w-0 flex-1">{text}</span>
      {canUpgrade && <a href={serverInfo.https.url} className="font-mono text-xs text-accent-300 hover:underline">{serverInfo.https.url}</a>}
    </div>
  );
}

const STEPS = ['iframe', 'navigator', 'engine', 'screen', 'locale', 'canvas', 'webgl', 'fonts', 'tamper', 'automation', 'uaData', 'audio', 'worker', 'webrtc'];
const STEP_TONE = {
  done: 'text-pass-300 ring-pass-500/30 bg-pass-500/5',
  now: 'text-accent-300 ring-accent-500/50 bg-accent-500/10 shadow-glow-accent',
  todo: 'text-ink-faint ring-line',
};

/** Màn hình đang quét */
export function ScanProgress({ steps }) {
  const stateOf = (s) => {
    if (steps.now === s) return 'now';
    return steps.done.includes(s) ? 'done' : 'todo';
  };
  return (
    <div className="flex flex-col items-center gap-6 py-24 text-center" role="status">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-800 border-t-accent-400" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-ink-strong">Đang phân tích trình duyệt…</h2>
        <p className="text-sm text-ink-muted">Mỗi phép thử chạy ít nhất 2 lần và trên nhiều ngữ cảnh (window · iframe · Web Worker)</p>
      </div>
      <div className="flex max-w-2xl flex-wrap justify-center gap-2">
        {STEPS.map((s) => (
          <span key={s} className={cn('rounded-full px-3 py-1 font-mono text-xxs ring-1 transition', STEP_TONE[stateOf(s)])}>{s}</span>
        ))}
      </div>
    </div>
  );
}

export function ScanError({ message, onRetry }) {
  return (
    <div className="mx-auto mt-16 flex max-w-2xl flex-wrap items-center gap-4 rounded-2xl bg-fail-500/10 px-6 py-5 text-sm text-fail-100 ring-1 ring-fail-500/40">
      <AlertOctagon className="h-5 w-5 text-fail-400" aria-hidden="true" />
      <span className="min-w-0 flex-1"><b>Không quét được:</b> {message}</span>
      <Button size="sm" onClick={onRetry}>Thử lại</Button>
    </div>
  );
}
