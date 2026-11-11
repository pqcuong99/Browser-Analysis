// Mã màu cho thuộc tính SVG (stroke/fill), lấy từ cùng bảng màu Tailwind với tailwind.config.js
import colors from 'tailwindcss/colors';

export const PALETTE = {
  pass: colors.emerald[500],
  warn: colors.amber[500],
  fail: colors.red[500],
  track: colors.zinc[800],
  tick: colors.zinc[400],
  needleFill: colors.zinc[950],
  needleStroke: colors.zinc[50],
};
