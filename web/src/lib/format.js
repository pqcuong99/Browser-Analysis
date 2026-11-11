/** Số gọn: bỏ số 0 thừa sau dấu thập phân */
export function fmt(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(digits).replace(/\.?0+$/, '') || '0';
}

export const pct = (c) => (c == null ? '—' : `${Math.round(c * 100)}%`);

export function show(v) {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** Danh sách cặp [đường dẫn, giá trị lá] của một object, dùng cho bảng Observed Data và diff */
export function flatten(obj, prefix = '', out = [], depth = 0) {
  const leaf = obj === null || typeof obj !== 'object' || depth > 6;
  if (leaf) {
    out.push([prefix || '(value)', obj]);
    return out;
  }
  if (Array.isArray(obj)) {
    const scalarArray = obj.length === 0 || obj.every((x) => x === null || typeof x !== 'object');
    if (scalarArray) out.push([prefix, obj]);
    else obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out, depth + 1));
    return out;
  }
  const keys = Object.keys(obj);
  if (!keys.length) out.push([prefix, {}]);
  for (const k of keys) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out, depth + 1);
  return out;
}

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
