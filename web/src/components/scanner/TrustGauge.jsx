import { useEffect, useId } from 'react';
import { useCountUp } from '../../hooks/useCountUp.js';
import { cn } from '../../lib/cn.js';
import { PALETTE } from '../../lib/palette.js';
import { TRUST_BAND_STYLES, trustBand } from '../../lib/statusStyles.js';

// Nửa vòng tròn: tâm (120,120), bán kính 96, từ trái (0 điểm) qua đỉnh sang phải (100 điểm)
const CX = 120, CY = 120, R = 96, STROKE = 16;
const ARC = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
const LENGTH = Math.PI * R;
export const GAUGE_DURATION_MS = 1500;

function pointAt(f, radius = R) {
  const a = Math.PI * (1 - f);
  return [CX + radius * Math.cos(a), CY - radius * Math.sin(a)];
}

/**
 * SVG Gauge Trust Score. Dải màu theo ngưỡng: 0–(suspicious-1) đỏ, suspicious–(safe-1) vàng, safe–100 xanh.
 * Vòng cung và con số chạy từ 0 lên điểm thật trong 1.5s; gọi onComplete khi xong.
 */
export function TrustGauge({ score, thresholds, animKey, onComplete }) {
  const gid = useId().replace(/:/g, '');
  const { value, done } = useCountUp(score, { duration: GAUGE_DURATION_MS, key: animKey });
  const f = Math.min(1, Math.max(0, value / 100));
  const [mx, my] = pointAt(f);
  // Màu con số đổi theo dải khi đang đếm: đỏ → vàng → xanh
  const band = TRUST_BAND_STYLES[trustBand(Math.round(value), thresholds)];
  const s = thresholds.suspicious / 100, g = thresholds.safe / 100;
  const blend = 0.025; // vùng chuyển màu ngắn giữa các dải

  useEffect(() => {
    if (done) onComplete?.();
    // onComplete chỉ cần gọi một lần mỗi lượt animation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, animKey]);

  const ticks = [
    { v: thresholds.suspicious, label: String(thresholds.suspicious) },
    { v: thresholds.safe, label: String(thresholds.safe) },
  ];

  return (
    <div className="relative mx-auto w-full max-w-xs" role="img" aria-label={`Trust Score ${score} trên 100`}>
      <svg viewBox="0 0 240 140" className="w-full overflow-visible">
        <defs>
          <linearGradient id={`g-${gid}`} x1={CX - R} x2={CX + R} y1="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={PALETTE.fail} />
            <stop offset={Math.max(0, s - blend)} stopColor={PALETTE.fail} />
            <stop offset={Math.min(1, s + blend)} stopColor={PALETTE.warn} />
            <stop offset={Math.max(0, g - blend)} stopColor={PALETTE.warn} />
            <stop offset={Math.min(1, g + blend)} stopColor={PALETTE.pass} />
            <stop offset="1" stopColor={PALETTE.pass} />
          </linearGradient>
          <filter id={`glow-${gid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Nền: 3 dải màu mờ để thấy vùng Safe / Suspicious / High Risk */}
        <path d={ARC} fill="none" stroke={PALETTE.track} strokeWidth={STROKE} strokeLinecap="round" />
        <path d={ARC} fill="none" stroke={`url(#g-${gid})`} strokeWidth={STROKE} strokeLinecap="round" opacity="0.15" />

        {/* Vòng cung điểm: vẽ dần theo giá trị đang đếm */}
        <path
          d={ARC}
          fill="none"
          stroke={`url(#g-${gid})`}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={LENGTH}
          strokeDashoffset={LENGTH * (1 - f)}
          filter={`url(#glow-${gid})`}
          opacity={value > 0.5 ? 1 : 0}
        />

        {ticks.map((t) => {
          const [x1, y1] = pointAt(t.v / 100, R - STROKE / 2 - 4);
          const [x2, y2] = pointAt(t.v / 100, R + STROKE / 2 + 4);
          const [lx, ly] = pointAt(t.v / 100, R + STROKE / 2 + 15);
          return (
            <g key={t.label}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={PALETTE.tick} strokeWidth="1.5" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-zinc-500 font-mono" fontSize="9">{t.label}</text>
            </g>
          );
        })}

        <circle cx={mx} cy={my} r="7" fill={PALETTE.needleFill} stroke={PALETTE.needleStroke} strokeWidth="2.5" />
        <text x={CX - R} y={CY + 18} textAnchor="middle" className="fill-zinc-500 font-mono" fontSize="9">0</text>
        <text x={CX + R} y={CY + 18} textAnchor="middle" className="fill-zinc-500 font-mono" fontSize="9">100</text>
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center">
        <div className="flex items-baseline gap-1">
          <span className={cn('font-mono text-6xl font-bold leading-none tracking-tighter tabular transition-colors duration-300', band.text)}>
            {Math.round(value)}
          </span>
          <span className="font-mono text-sm text-ink-faint">/100</span>
        </div>
        <span className="eyebrow mt-1.5">Trust Score</span>
      </div>
    </div>
  );
}
