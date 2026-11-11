export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function page(title: string, body: string) {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · SentinelFP</title>
<link rel="stylesheet" href="/style.css">
</head>
<body class="center">
${body}
</body>
</html>`;
}

const ICON_BLOCK = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m14.5 9.5-5 5"/><path d="m9.5 9.5 5 5"/></svg>';
const ICON_WARN = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';

/** Màn hình chặn production: không tiết lộ rule nào đã kích hoạt */
export function blockPage(kind: 'BLOCK' | 'CHALLENGE', scanId: string) {
  const block = kind === 'BLOCK';
  return page(block ? 'Access Denied' : 'Verification Required', `
    <div class="gate-card ${block ? 'is-block' : 'is-challenge'}">
      <div class="gate-icon ${block ? 'fail' : 'warn'}">${block ? ICON_BLOCK : ICON_WARN}</div>
      <div class="gate-code">${block ? 'HTTP 403 · ACCESS DENIED' : 'HTTP 403 · VERIFICATION REQUIRED'}</div>
      <h1>${block ? 'Truy cập bị từ chối' : 'Cần xác minh thêm'}</h1>
      <p>${block
        ? 'Trình duyệt của bạn không đáp ứng chính sách bảo mật của hệ thống. Nếu bạn cho rằng đây là nhầm lẫn, hãy liên hệ bộ phận hỗ trợ và cung cấp mã tham chiếu bên dưới.'
        : 'Phiên truy cập có một số dấu hiệu bất thường. Hãy hoàn tất bước xác minh bổ sung để tiếp tục.'}</p>
      ${block ? '' : '<p class="muted">[Điểm tích hợp CAPTCHA / OTP / Proof-of-Work]</p>'}
      <div class="gate-ref"><span>Reference ID</span><code>${esc(scanId)}</code></div>
    </div>`);
}
