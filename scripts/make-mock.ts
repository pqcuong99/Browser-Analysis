// Sinh web/src/data/mockData.json: một phiên "Antidetect" Trust Score 13/100 (bị trừ 87 điểm) với đúng 3 module FAIL và 2 module WARNING.
// Dữ liệu chạy qua engine thật nên luôn khớp schema ScanReportResponse.
//   node scripts/make-mock.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyze } from '../server/engine/index.ts';
import { CHROME_UA, cleanChrome } from '../server/engine/profiles.ts';

const NOW = Date.parse('2026-11-10T09:30:00Z');
const s = cleanChrome(NOW);
const d = s.data;

// FAIL 1 (canvas): chèn nhiễu canvas, 2 lần vẽ giống hệt ra khác nhau
Object.assign(d.canvas, { hashB: '5e0c41a9d2b7f3d1', diffBytes: 812 });

// FAIL 2 (webgl): profile Windows nhưng GPU Apple (copy fingerprint từ MacBook)
const apple = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)';
d.webgl.unmaskedVendor = 'Google Inc. (Apple)';
d.webgl.unmaskedRenderer = apple;
d.webgl.webgl2.unmaskedRenderer = apple;
d.worker.webglRenderer = apple;

// FAIL 3 (browser_info): UA khai báo Chrome 120 nhưng core là 142 (đồng bộ ở mọi tầng, chỉ lộ qua tính năng JS)
const ua = CHROME_UA.replace('Chrome/142', 'Chrome/120');
for (const o of [d.navigator, d.iframe, d.worker]) o.userAgent = ua;
d.navigator.appVersion = ua.replace('Mozilla/', '');
s.http.headers['user-agent'] = ua;
d.uaData.brands = d.uaData.brands.map((b: any) => (/Not/.test(b.brand) ? b : { ...b, version: '120' }));
d.uaData.high.fullVersionList = d.uaData.high.fullVersionList.map((b: any) => (/Not/.test(b.brand) ? b : { ...b, version: '120.0.6099.71' }));
d.worker.uaBrands = d.uaData.brands.map((b: any) => `${b.brand}/${b.version}`);
s.http.headers['sec-ch-ua'] = '"Chromium";v="120", "Google Chrome";v="120", "Not_A Brand";v="99"';

// WARNING 1 (webrtc): Antidetect "giả IP local" => host candidate lộ IP LAN thô thay vì <uuid>.local (WRTC_07)
for (const c of [d.webrtc.candidates[0], d.webrtc.iframe.candidates[0]]) {
  c.raw = c.raw.replace(c.address, '192.168.1.37');
  c.address = '192.168.1.37';
  if (c.fields) c.fields.address = '192.168.1.37';
}
d.webrtc.sdpCandidates = d.webrtc.candidates.map((c: any) => c.raw);
Object.assign(s.net, {
  asnType: 'residential', country: 'US', ipTimezone: 'America/New_York',
});
// WARNING 2 (locale): timezone trình duyệt (Asia/Ho_Chi_Minh) khác timezone theo IP (America/New_York)

const report = analyze(d, s.http, { net: s.net, now: NOW, scanId: '9f3c2a71-5b8e-4d0a-a6c4-2e71d0f8b195' });
const sb = report.scoring_breakdown;
const counts = report.module_summary_counts;
if (sb.trust_score !== 13 || counts.FAIL !== 3 || counts.WARNING !== 2) {
  throw new Error(`Mock không đạt yêu cầu: Trust=${sb.trust_score}, counts=${JSON.stringify(counts)}`);
}

const mock = {
  _comment: 'Dữ liệu giả lập một phiên Antidetect (Trust Score 13/100, 3 FAIL, 2 WARNING). Sinh bằng: node scripts/make-mock.ts',
  scanId: report.scan_id,
  mode: 'enforce',
  label: 'mock:antidetect-trust-13',
  profile: {
    id: 'mock-antidetect-trust-13',
    title: 'Mock Antidetect Session (Trust 13/100)',
    description: 'Dữ liệu tĩnh từ mockData.json: chèn nhiễu canvas, GPU Apple trên Windows, UA Chrome 120 chạy core 142, lộ IP LAN qua WebRTC, lệch timezone IP.',
    expected: 'BLOCK',
  },
  report,
  raw: d,
};
mkdirSync('web/src/data', { recursive: true });
writeFileSync('web/src/data/mockData.json', JSON.stringify(mock, null, 2) + '\n');
console.log(`mockData.json: Trust=${sb.trust_score}, ${sb.enforcement_action}, counts=${JSON.stringify(counts)}, hard=${sb.hard_block_reason ?? '-'}`);
