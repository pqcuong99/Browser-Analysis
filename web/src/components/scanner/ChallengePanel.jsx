import { useState } from 'react';
import { Cpu, ShieldCheck } from 'lucide-react';
import { Button } from '../common/Button.jsx';

const EVENT_LABEL = {
  challenge_issued: 'Nhận challenge',
  challenge_passed: 'Vượt challenge',
  challenge_failed: 'Giải sai',
  flagged_access: 'Truy cập (gắn cờ)',
  rate_limited: 'Bị rate-limit (429)',
  blocked: 'Bị chặn (403)',
  monitor_pass: 'Cho qua (monitor)',
};

function SessionActivity({ events }) {
  if (!events?.length) return null;
  const counts = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {Object.entries(counts).map(([k, n]) => (
        <span key={k} className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-xxs text-ink-muted ring-1 ring-line-strong">
          {EVENT_LABEL[k] ?? k} ×{n}
        </span>
      ))}
    </div>
  );
}

/** Bước CHALLENGE: Proof-of-Work, gắn cờ phiên, rate-limit */
export function ChallengePanel({ ctx, onPassed }) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const passed = ctx.res.challenge;

  if (passed) {
    return (
      <div className="space-y-1.5 rounded-xl bg-pass-500/10 px-4 py-3 text-xs ring-1 ring-pass-500/30">
        <div className="flex items-center gap-2 font-semibold text-pass-200">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" /> CHALLENGE passed · Proof-of-Work
        </div>
        <p className="font-mono text-xxs text-ink-muted">
          {[`${passed.difficulty} bit`, passed.clientMs && `${passed.clientMs} ms`, passed.hashes && `${Math.round(passed.hashes / 1000)}k hashes`].filter(Boolean).join(' · ')}
        </p>
        <p className="text-ink-muted">Phiên được cho qua nhưng bị gắn cờ theo dõi và giới hạn tốc độ truy cập.</p>
        <SessionActivity events={ctx.res.events} />
      </div>
    );
  }

  if (ctx.profile) {
    return (
      <p className="rounded-xl bg-warn-500/10 px-4 py-3 text-xs text-warn-200 ring-1 ring-warn-500/30">
        Hành động CHALLENGE yêu cầu Proof-of-Work + rate-limit + gắn cờ phiên. Dữ liệu mô phỏng không gắn với phiên của bạn nên không giải ở đây được.
      </p>
    );
  }

  const run = async () => {
    if (!window.SentinelPoW) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.SentinelPoW.solve({ onProgress: setProgress });
      onPassed({ method: 'pow', difficulty: r.difficulty, clientMs: r.ms, hashes: r.hashes, passedAt: Date.now() });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const pctDone = progress ? Math.min(96, (progress.hashes / progress.expected) * 100) : 0;

  return (
    <div className="space-y-3 rounded-xl bg-warn-500/10 px-4 py-3 text-xs ring-1 ring-warn-500/30">
      <p className="text-warn-200">Cần vượt Proof-of-Work để được cho qua. Độ khó tăng khi Trust Score giảm (2^16 → 2^20 phép băm).</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-gradient-to-r from-warn-500 to-accent-400 transition-all" style={{ width: `${pctDone}%` }} />
      </div>
      {progress && (
        <p className="font-mono text-xxs text-ink-muted">
          {Math.round(progress.hashes / 1000)}k / ~{Math.round(progress.expected / 1000)}k hashes · {progress.difficulty} bit · {progress.ms} ms
        </p>
      )}
      {error && <p className="text-fail-300">{error}</p>}
      <Button size="sm" variant="secondary" icon={Cpu} onClick={run} disabled={busy}>Complete Challenge (Proof-of-Work)</Button>
    </div>
  );
}
