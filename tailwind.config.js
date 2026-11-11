import colors from 'tailwindcss/colors';

/**
 * Toàn bộ màu nền, màu trạng thái và hiệu ứng phát sáng của SentinelFP được định nghĩa tại đây.
 * Component chỉ dùng tên token (bg-surface, ring-fail-500, shadow-glow-fail...), không dùng giá trị arbitrary.
 */

// Hiệu ứng phát sáng (box-shadow) theo trạng thái
const glow = {
  fail: '0 0 15px rgba(239, 68, 68, 0.3)',
  failStrong: '0 0 26px rgba(239, 68, 68, 0.5)',
  warn: '0 0 14px rgba(245, 158, 11, 0.14)',
  pass: '0 0 14px rgba(16, 185, 129, 0.12)',
  accent: '0 0 18px rgba(34, 211, 238, 0.25)',
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Nền phân lớp (Slate/Zinc), không dùng đen thuần
        canvas: colors.zinc[950],     // nền trang
        surface: colors.zinc[900],    // card
        raised: colors.zinc[800],     // phần tử nổi trên card
        sunken: '#0d0d10',            // nền terminal / code (tối hơn card, vẫn không phải #000)
        line: colors.zinc[800],       // viền mảnh
        'line-strong': colors.zinc[700],
        ink: { DEFAULT: colors.zinc[200], strong: colors.zinc[50], muted: colors.zinc[400], faint: colors.zinc[500] },
        accent: colors.cyan,
        // Trạng thái ngữ nghĩa
        pass: colors.emerald,
        warn: colors.amber,
        fail: colors.red,
        na: colors.slate,
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'glow-fail': glow.fail,
        'glow-fail-strong': glow.failStrong,
        'glow-warn': glow.warn,
        'glow-pass': glow.pass,
        'glow-accent': glow.accent,
        glass: '0 8px 32px rgba(0, 0, 0, 0.35)',
        drawer: '-24px 0 60px rgba(0, 0, 0, 0.5)',
      },
      keyframes: {
        // Thẻ FAIL "thở" nhẹ giữa 2 mức phát sáng
        'fail-pulse': {
          '0%, 100%': { boxShadow: glow.fail },
          '50%': { boxShadow: glow.failStrong },
        },
        'slide-in': {
          from: { transform: 'translateX(24px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'fail-pulse': 'fail-pulse 2.6s ease-in-out infinite',
        'slide-in': 'slide-in 0.2s ease-out',
        'fade-in': 'fade-in 0.15s ease-out',
      },
      maxWidth: { dashboard: '1480px', drawer: '880px', modal: '640px', prose: '46ch' },
      maxHeight: { terminal: '26rem', table: '22rem', 'table-lg': '40rem' },
      gridTemplateColumns: {
        kv: 'max-content minmax(0, 1fr)',
        metric: 'minmax(6.5rem, 42%) minmax(0, 1fr)',
        signal: 'auto minmax(0, 1fr) auto',
        modules: 'repeat(auto-fill, minmax(19rem, 1fr))',
      },
      zIndex: { nav: '30', menu: '40', drawer: '50', modal: '60', toast: '70' },
      backdropBlur: { glass: '14px' },
      transitionProperty: { gauge: 'stroke-dashoffset' },
    },
  },
  plugins: [],
};
