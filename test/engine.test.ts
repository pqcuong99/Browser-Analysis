import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, RULEBOOK } from '../server/engine/index.ts';
import { defaultPolicy, sanitizePolicy } from '../server/engine/policy.ts';
import { cleanChrome, PROFILES, type Scenario } from '../server/engine/profiles.ts';
import { tlsFamily } from '../server/engine/rules.ts';
import { parseUA } from '../server/engine/ua.ts';

const run = (s: Scenario, policy = defaultPolicy()) => analyze(s.data, s.http, { net: s.net, policy });
const rule = (r: ReturnType<typeof analyze>, id: string) => r.modules.flatMap((m) => m.rules_evaluated).find((x) => x.rule_id === id)!;
const statusOf = (r: ReturnType<typeof analyze>, id: string) => rule(r, id).status;

test('rulebook có đúng 63 rule, 10 module, mỗi rule có evaluator', () => {
  assert.equal(RULEBOOK.length, 63);
  assert.equal(new Set(RULEBOOK.map((r) => r.module)).size, 10);
  const r = run(cleanChrome());
  assert.equal(r.modules.flatMap((m) => m.rules_evaluated).length, 63);
  assert.ok(r.modules.flatMap((m) => m.rules_evaluated).every((x) => !x.message.startsWith('Không đánh giá được')));
});

for (const p of PROFILES) {
  test(`profile ${p.id} => ${p.expected}`, () => {
    const r = run(p.build());
    assert.equal(r.scoring_breakdown.enforcement_action, p.expected, JSON.stringify(r.top_signals.map((s) => s.rule_id)));
  });
}

test('Chrome sạch: không có FAIL/WARNING, Trust = 100, C_total = 1', () => {
  const r = run(cleanChrome());
  const bad = r.modules.flatMap((m) => m.rules_evaluated).filter((x) => x.status === 'FAIL' || x.status === 'WARNING');
  assert.deepEqual(bad.map((x) => x.rule_id), []);
  assert.equal(r.scoring_breakdown.trust_score, 100);
  assert.equal(r.scoring_breakdown.total_risk_score, 0);
  assert.equal(r.scoring_breakdown.overall_confidence, 1);
  assert.equal(r.scoring_breakdown.risk_label, 'Safe');
});

test('Damping theo nhóm: S(G) = max + 0.25 × phần còn lại', () => {
  const s = cleanChrome();
  // 2 rule cùng GRP_CANVAS_TAMPER: CANV_01 (28×0.95) và CANV_03 (25×0.92)
  Object.assign(s.data.canvas, { hashB: 'x', diffBytes: 5, decodedDiffPixels: 3 });
  const r = run(s);
  const g = r.scoring_breakdown.group_scores.GRP_CANVAS_TAMPER;
  assert.equal(g.max_rule_score, 26.6);
  assert.equal(g.damped_additional_score, 5.75);
  assert.equal(g.group_total, 32.35);
  assert.equal(r.scoring_breakdown.total_risk_score, 32);
  assert.equal(r.scoring_breakdown.trust_score, 68);
  assert.equal(r.scoring_breakdown.enforcement_action, 'CHALLENGE');
});

test('Hard-block cần 2 rule CRITICAL ở module và nhóm khác nhau', () => {
  // BINF_05 (browser_info) + AUTO_02 (automation) cùng nhóm GRP_PROTO_HOOK => không phải bằng chứng độc lập
  const s = cleanChrome();
  s.data.tamper.navigatorOwnProps = ['userAgent'];
  s.data.tamper.toStringNative = false;
  const r = run(s);
  assert.equal(statusOf(r, 'BINF_05'), 'FAIL');
  assert.equal(statusOf(r, 'AUTO_02'), 'FAIL');
  assert.equal(r.scoring_breakdown.hard_block_triggered, false);

  // Thêm LOCL_01 (locale, GRP_GEO_LOCALE) => 2 bằng chứng độc lập
  s.data.locale.samples[0].intl = -300;
  const r2 = run(s);
  assert.equal(r2.scoring_breakdown.hard_block_triggered, true);
  assert.ok(r2.scoring_breakdown.trust_score <= 25);
  assert.equal(r2.scoring_breakdown.enforcement_action, 'BLOCK');
});

test('Brave: noise canvas/audio chỉ là WARNING với độ tin cậy thấp', () => {
  const s = cleanChrome();
  s.data.navigator.isBrave = true;
  s.data.uaData.brands = [{ brand: 'Brave', version: '142' }, { brand: 'Chromium', version: '142' }, { brand: 'Not_A Brand', version: '99' }];
  s.data.worker.uaBrands = s.data.uaData.brands.map((b: any) => `${b.brand}/${b.version}`);
  s.http.headers['sec-ch-ua'] = '"Brave";v="142", "Chromium";v="142", "Not_A Brand";v="99"';
  s.data.canvas.hashB = 'farbled';
  s.data.audio.sumB = 124.1;
  const r = run(s);
  assert.equal(statusOf(r, 'CANV_01'), 'WARNING');
  assert.equal(rule(r, 'CANV_01').confidence, 0.2);
  assert.equal(statusOf(r, 'AUDI_01'), 'WARNING');
  assert.equal(r.scoring_breakdown.enforcement_action, 'ALLOW');
});

test('Payload thiếu phần bắt buộc => hard block, không crash', () => {
  const r = analyze({}, { ip: '192.0.2.1', headers: { 'user-agent': 'x' } });
  assert.equal(r.scoring_breakdown.enforcement_action, 'BLOCK');
  assert.match(r.scoring_breakdown.hard_block_reason!, /thiếu phần bắt buộc/);
});

test('Blocklist IP => BLOCK, R = 100', () => {
  const s = cleanChrome();
  const policy = sanitizePolicy({ blocklist: { ips: [s.http.ip] } }, defaultPolicy());
  const r = run(s, policy);
  assert.equal(r.scoring_breakdown.trust_score, 0);
  assert.equal(r.scoring_breakdown.enforcement_action, 'BLOCK');
});

test('Policy: tắt rule và đổi trọng số có hiệu lực', () => {
  const s = PROFILES.find((p) => p.id === 'mismatched-macos-gpu')!.build();
  const off = sanitizePolicy({ rules: { WBGL_01: { enabled: false } } }, defaultPolicy());
  const r = run(s, off);
  assert.equal(statusOf(r, 'WBGL_01'), 'UNAVAILABLE');
  assert.equal(r.scoring_breakdown.enforcement_action, 'CHALLENGE');
  const heavier = sanitizePolicy({ rules: { FONT_01: { weight: 40 } } }, defaultPolicy());
  assert.equal(run(s, heavier).scoring_breakdown.enforcement_action, 'BLOCK');
  const clamp = sanitizePolicy({ thresholds: { safe: 30, suspicious: 90 }, rules: { NOPE: { weight: 1 }, CANV_01: { weight: 999 } } }, defaultPolicy());
  assert.equal(clamp.thresholds.suspicious, 29);
  // Policy lưu từ bản Risk Score cũ được quy đổi giữ nguyên ý nghĩa: risk ≥ 25 ⇔ trust ≤ 75 < 76
  const legacy = sanitizePolicy({ thresholds: { challenge: 25, block: 60 }, hardBlock: { floorScore: 75 } }, defaultPolicy());
  assert.deepEqual(legacy.thresholds, { safe: 76, suspicious: 41 });
  assert.equal(legacy.hardBlock.maxTrust, 25);
  assert.equal(clamp.rules.CANV_01.weight, 50);
  assert.equal(clamp.rules.NOPE, undefined);
});

// ---- Từng rule không được profile mô phỏng nào kích hoạt ----
const cases: [string, (s: Scenario) => void, string][] = [
  ['WRTC_03', (s) => { s.data.webrtc.candidates[1].raw = s.data.webrtc.candidates[1].raw.replace('203.0.113.10', '127.0.0.1'); }, 'FAIL'],
  // Scan ở localhost: IP HTTP nội bộ, probe tự hỏi IP egress qua proxy, srflx lộ IP khác
  ['WRTC_01', (s) => { s.http.ip = '127.0.0.1'; s.data.egress = { ips: ['198.51.100.77'] }; }, 'FAIL'],
  ['WRTC_03', (s) => { s.data.webrtc.candidates[1].raw = s.data.webrtc.candidates[1].raw.replace('1677729535', '2113937151'); }, 'FAIL'],
  ['WRTC_06', (s) => { Object.assign(s.data.webrtc, { state: 'timeout', gatheringState: 'gathering', candidates: [], sdpCandidates: [] }); }, 'WARNING'],
  ['WRTC_07', (s) => {
    const c = s.data.webrtc.candidates[0];
    c.address = c.fields.address = '192.168.1.23'; c.raw = c.raw.replace(/\S+\.local/, '192.168.1.23');
    s.data.webrtc.sdpCandidates[0] = c.raw;
  }, 'WARNING'],
  ['WRTC_08', (s) => { s.data.webrtc.candidates[1].address = '198.51.100.77'; s.data.webrtc.candidates[1].raw = s.data.webrtc.candidates[1].raw.replace('203.0.113.10', '198.51.100.77'); }, 'FAIL'],
  ['WBGL_03', (s) => { s.data.webgl.maxVertexUniformVectors = 1024; }, 'FAIL'],
  ['HRDW_02', (s) => { s.data.webgl.unmaskedRenderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'; s.data.navigator.hardwareConcurrency = 3; }, 'FAIL'],
  ['HRDW_03', (s) => { s.data.screen.availWidth = 3000; }, 'FAIL'],
  ['HRDW_04', (s) => {
    const ua = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
    s.data.navigator.userAgent = ua; s.http.headers['user-agent'] = ua;
  }, 'FAIL'],
  ['HRDW_05', (s) => { s.data.navigator.deviceMemory = null; }, 'UNAVAILABLE'],
  ['AUDI_03', (s) => { s.data.audio.sumA = s.data.audio.sumB = 35.7383295930922; }, 'WARNING'],
  ['FONT_02', (s) => { s.data.fonts.foundDom.windows = ['Segoe UI']; }, 'FAIL'],
  ['FONT_03', (s) => { s.data.fonts.metrics.dom = [512.34375, 512.35]; }, 'FAIL'],
  ['NETW_02', (s) => { s.net.h2 = '1:65536;4:131072;5:16384|12517377|3|m,p,a,s'; }, 'FAIL'],
  ['BINF_04', (s) => {
    const ff = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
    s.data.navigator.userAgent = ff; s.data.iframe.userAgent = ff; s.data.worker.userAgent = ff; s.http.headers['user-agent'] = ff;
  }, 'FAIL'],
  ['AUTO_01', (s) => { s.data.navigator.webdriverInNavigator = false; }, 'FAIL'],
  ['AUTO_03', (s) => { s.data.iframe.hardwareConcurrency = 4; }, 'FAIL'],
  ['WBGL_06', (s) => { s.data.webgl.unmaskedRenderer = null; }, 'UNAVAILABLE'],
  ['CANV_05', (s) => { s.data.canvas.uniform = true; }, 'UNAVAILABLE'],
];
for (const [id, mutate, expected] of cases) {
  test(`${id} kích hoạt => ${expected}`, () => {
    const clean = run(cleanChrome());
    assert.equal(statusOf(clean, id), 'PASS', `${id} phải PASS trên Chrome sạch`);
    const s = cleanChrome();
    mutate(s);
    assert.equal(statusOf(run(s), id), expected);
  });
}

test('WRTC_01 ở localhost: srflx trùng IP egress => PASS, không lấy được egress => UNAVAILABLE', () => {
  const s = cleanChrome();
  s.http.ip = '127.0.0.1';
  s.data.egress = { ips: ['203.0.113.10'] };
  assert.equal(statusOf(run(s), 'WRTC_01'), 'PASS');
  s.data.egress = { results: [{ url: 'x', error: 'timeout' }], ips: [] };
  assert.equal(statusOf(run(s), 'WRTC_01'), 'UNAVAILABLE');
  // Egress chỉ IPv4 mà srflx IPv6 => UDP đi thẳng
  s.data.egress = { ips: ['203.0.113.10'] };
  s.data.webrtc.candidates.push({ protocol: 'udp', address: '2001:db8:1::5', port: '5000', type: 'srflx', raw: 'candidate:1 1 udp 1677729535 2001:db8:1::5 5000 typ srflx raddr :: rport 0 generation 0' });
  const r = rule(run(s), 'WRTC_01');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.confidence, 0.6);
});

test('WRTC_08: srflx ở iframe khác window chính và field RTCIceCandidate bị lệch', () => {
  const s = cleanChrome();
  s.data.webrtc.iframe.candidates[1].address = '198.51.100.9';
  assert.equal(statusOf(run(s), 'WRTC_08'), 'FAIL');
  const t = cleanChrome();
  t.data.webrtc.candidates[1].fields.address = '198.51.100.9';
  assert.equal(statusOf(run(t), 'WRTC_08'), 'FAIL');
});

test('WebRTC tắt hợp lệ (gather complete, 0 candidate) không bị WRTC_06', () => {
  const s = cleanChrome();
  Object.assign(s.data.webrtc, { state: 'complete', candidates: [], sdpCandidates: [], iframe: null });
  const r = run(s);
  assert.equal(statusOf(r, 'WRTC_06'), 'PASS');
  assert.equal(statusOf(r, 'WRTC_05'), 'UNAVAILABLE');
});

// ---- WRTC_09: VPS thấy IP nguồn thật của gói UDP ----
const PROXY = '198.51.100.77', HOME = '203.0.113.10';
/** Scan ở localhost qua proxy PROXY; candidate srflx báo `shown`; VPS thấy UDP từ `udpFrom` */
function groundScenario(shown: string, udpFrom: string[], extra: Partial<Scenario['net']['ground']> = {}) {
  const s = cleanChrome();
  s.http.ip = '127.0.0.1';
  s.data.egress = { ips: [PROXY] };
  for (const c of [s.data.webrtc.candidates[1], s.data.webrtc.iframe.candidates[1]]) {
    c.raw = c.raw.replace(c.address, shown); c.address = shown;
    if (c.fields) c.fields.address = shown;
  }
  s.data.webrtc.sdpCandidates = s.data.webrtc.candidates.map((c: any) => c.raw);
  s.net.ground = {
    vps: 'vps.example', bindings: [],
    sources: udpFrom.map((ip) => ({ ip, port: 54321, proto: 'udp' as const, kinds: ['turn-allocate'], first: 1, last: 1, count: 2 })),
    ...extra,
  };
  return s;
}

test('WRTC_09: candidate báo IP proxy nhưng UDP thật đến từ IP nhà => FAIL CRITICAL (Dolphin)', () => {
  const r = run(groundScenario(PROXY, [HOME]));
  assert.equal(statusOf(r, 'WRTC_09'), 'FAIL');
  assert.equal(statusOf(r, 'WRTC_01'), 'PASS'); // nhìn từ JS thì không thấy lộ
  assert.match(rule(r, 'WRTC_09').message, /203\.0\.113\.10/);
});

test('WRTC_09: UDP thật đi qua proxy => PASS (Hidemium)', () => {
  assert.equal(statusOf(run(groundScenario(PROXY, [PROXY])), 'WRTC_09'), 'PASS');
});

test('WRTC_09: lộ IP thật nhưng không làm giả => WRTC_09 PASS, WRTC_01 FAIL', () => {
  const r = run(groundScenario(HOME, [HOME]));
  assert.equal(statusOf(r, 'WRTC_09'), 'PASS');
  assert.equal(statusOf(r, 'WRTC_01'), 'FAIL');
});

test('WRTC_09: candidate bịa IP mà VPS không thấy => FAIL', () => {
  assert.equal(statusOf(run(groundScenario('192.0.2.200', [PROXY])), 'WRTC_09'), 'FAIL');
});

test('WRTC_09: không có tag TURN, khớp STUN Binding theo port srflx => FAIL độ tin cậy 0.75', () => {
  const r = rule(run(groundScenario(PROXY, [], { bindings: [{ ip: HOME, port: 54321, proto: 'udp', t: 1 }] })), 'WRTC_09');
  assert.equal(r.status, 'FAIL');
  assert.equal(r.confidence, 0.75);
});

test('WRTC_09: chưa cấu hình / VPS lỗi / không nhận gói => UNAVAILABLE, chỉ TCP qua proxy => PASS', () => {
  assert.equal(statusOf(run(cleanChrome()), 'WRTC_09'), 'UNAVAILABLE');
  assert.equal(statusOf(run(groundScenario(PROXY, [], { error: 'timeout' })), 'WRTC_09'), 'UNAVAILABLE');
  assert.equal(statusOf(run(groundScenario(PROXY, [])), 'WRTC_09'), 'UNAVAILABLE');
  const tcp = groundScenario(PROXY, []);
  tcp.net.ground!.sources = [{ ip: PROXY, port: 40000, proto: 'tcp', kinds: ['turn-allocate'], first: 1, last: 1, count: 1 }];
  assert.equal(statusOf(run(tcp), 'WRTC_09'), 'PASS');
});

test('Constructor native (RTCPeerConnection) có prototype không bị coi là hook', () => {
  const r = run(cleanChrome());
  assert.equal(statusOf(r, 'WRTC_04'), 'PASS');
  assert.equal(statusOf(r, 'AUTO_02'), 'PASS');
});

test('Webview nhúng chỉ có outerWidth = 0: AUTO_05 là WARNING độ tin cậy thấp', () => {
  const s = cleanChrome();
  s.data.automation.outerZero = true;
  const r = run(s);
  assert.equal(statusOf(r, 'AUTO_05'), 'WARNING');
  assert.equal(r.scoring_breakdown.enforcement_action, 'ALLOW');
});

test('deviceMemory 32 (Chromium mới) hợp lệ, 12 không hợp lệ', () => {
  const s = cleanChrome();
  s.data.navigator.deviceMemory = 32;
  assert.equal(statusOf(run(s), 'HRDW_01'), 'PASS');
  s.data.navigator.deviceMemory = 12;
  assert.equal(statusOf(run(s), 'HRDW_01'), 'FAIL');
});

test('tlsFamily phân loại JA4', () => {
  assert.equal(tlsFamily({ ja4: 't13d1516h2_8daaf6152771_02713d6af862' }).family, 'chromium');
  assert.equal(tlsFamily({ ja4: 't13d1715h2_5b57614c22b0_3d5424432f57' }).family, 'firefox');
  assert.equal(tlsFamily({ ja4: 't13d4907h1_0d8feac7bc37_7395dae3b2f3' }).family, 'library');
  assert.equal(tlsFamily({ tlsClient: 'python-requests' }).family, 'library');
});

test('mockData.json: phiên Antidetect Trust 13/100, 3 FAIL, 2 WARNING, khớp engine hiện tại', async () => {
  const { readFileSync } = await import('node:fs');
  const mock = JSON.parse(readFileSync(new URL('../web/src/data/mockData.json', import.meta.url), 'utf8'));
  const r = mock.report;
  assert.equal(r.scoring_breakdown.trust_score, 13);
  assert.equal(r.scoring_breakdown.total_risk_score, 87);
  assert.equal(r.scoring_breakdown.enforcement_action, 'BLOCK');
  assert.equal(r.module_summary_counts.FAIL, 3);
  assert.equal(r.module_summary_counts.WARNING, 2);
  assert.equal(r.modules.length, 10);
  assert.equal(r.modules.flatMap((m: any) => m.rules_evaluated).length, RULEBOOK.length);
});

// ---------------- noise tĩnh kiểu Dolphin Anty: chỉ lộ khi so với đáp án ----------------
test('Dolphin static noise: các rule ổn định cũ PASS, rule đáp án mới FAIL và hard-block', () => {
  const r = run(PROFILES.find((p) => p.id === 'dolphin-static-noise')!.build());
  for (const id of ['CANV_02', 'CANV_03', 'WBGL_04', 'AUDI_01', 'AUDI_02', 'FONT_03']) assert.equal(statusOf(r, id), 'PASS', id);
  for (const id of ['CANV_06', 'WBGL_07', 'FONT_05', 'AUDI_05']) assert.equal(statusOf(r, id), 'FAIL', id);
  assert.match(rule(r, 'WBGL_07').message, /tràn số uint8/);
  assert.equal(r.scoring_breakdown.hard_block_triggered, true);
  assert.equal(r.scoring_breakdown.enforcement_action, 'BLOCK');
});

test('Probe cũ thiếu trường mới: 4 rule mới là UNAVAILABLE, không cộng điểm', () => {
  const s = cleanChrome();
  delete s.data.canvas.roundTrip; delete s.data.webgl.truth; delete s.data.audio.invariants; delete s.data.rects;
  const r = run(s);
  for (const id of ['CANV_06', 'WBGL_07', 'AUDI_05', 'FONT_05']) assert.equal(statusOf(r, id), 'UNAVAILABLE', id);
  assert.equal(r.scoring_breakdown.trust_score, 100);
});

test('Brave farbling canvas/webgl: WARNING độ tin cậy thấp, trừ khi WebGL tràn số uint8', () => {
  const s = cleanChrome();
  s.data.navigator.isBrave = true;
  s.data.uaData.brands = [...s.data.uaData.brands, { brand: 'Brave', version: '142' }];
  s.data.canvas.roundTrip = { ...s.data.canvas.roundTrip, changedPx: 40, changedBytes: 40, maxDelta: 1 };
  s.data.webgl.truth.clear = { bad: 12, maxDelta: 1, wrap: 0, alphaBad: 0 };
  let r = run(s);
  assert.equal(statusOf(r, 'CANV_06'), 'WARNING');
  assert.equal(statusOf(r, 'WBGL_07'), 'WARNING');
  s.data.webgl.truth.solid = { bad: 10, maxDelta: 255, wrap: 10, alphaBad: 0 };
  r = run(s);
  assert.equal(statusOf(r, 'WBGL_07'), 'FAIL');
});

test('FONT_05: DPR 1.1 (zoom 110%) không kết luận; lệch > 1px không coi là noise', () => {
  const s = cleanChrome();
  s.data.rects = { ...s.data.rects, off: 3, maxDelta: 0.005, dpr: 1.1 };
  assert.equal(statusOf(run(s), 'FONT_05'), 'UNAVAILABLE');
  s.data.rects.dpr = 1.25;
  assert.equal(statusOf(run(s), 'FONT_05'), 'FAIL');
  s.data.rects.maxDelta = 4;
  assert.equal(statusOf(run(s), 'FONT_05'), 'UNAVAILABLE');
});

test('AUDI_05: phép bất biến bị phá => FAIL; không chạy được => UNAVAILABLE', () => {
  const s = cleanChrome();
  s.data.audio.invariants.gainHalf = 4096;
  assert.equal(statusOf(run(s), 'AUDI_05'), 'FAIL');
  s.data.audio.invariants = { error: 'timeout' };
  assert.equal(statusOf(run(s), 'AUDI_05'), 'UNAVAILABLE');
});

test('parseUA', () => {
  assert.equal(parseUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0').browser, 'Edge');
  const ios = parseUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1');
  assert.equal(ios.engine, 'webkit');
  assert.equal(ios.os, 'iOS');
});

test('AUDI_05 wavetable: lệch đối xứng/đỉnh => FAIL trên Windows; OS khác không dùng phép này', () => {
  const s = cleanChrome();
  s.data.audio.invariants.waveAntiSine = 61;
  s.data.audio.invariants.wavePeak = 0.99999994;
  const r = run(s);
  assert.equal(statusOf(r, 'AUDI_05'), 'FAIL');
  assert.match(rule(r, 'AUDI_05').message, /wavetable sine/);
  const mac = cleanChrome();
  mac.data.audio.invariants.waveAntiSine = 61;
  mac.data.navigator.userAgent = mac.data.navigator.userAgent.replace('Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10_15_7');
  assert.equal(statusOf(run(mac), 'AUDI_05'), 'PASS');
});

// ---------------- noise lúc vẽ kiểu GPM Login: đọc pixel sạch, chỉ lộ ở phép thử hình học / baseline ----------------
test('GPM draw-time noise: rule đáp án cũ PASS, 5 rule mới bắt được và hard-block', () => {
  const r = run(PROFILES.find((p) => p.id === 'gpm-draw-noise')!.build());
  for (const id of ['CANV_01', 'CANV_02', 'CANV_03', 'CANV_06', 'WBGL_04', 'WBGL_07', 'AUDI_01', 'AUDI_05']) assert.equal(statusOf(r, id), 'PASS', id);
  for (const id of ['CANV_07', 'WBGL_08', 'WBGL_09', 'WBGL_10', 'AUDI_06', 'FONT_05']) assert.equal(statusOf(r, id), 'FAIL', id);
  assert.match(rule(r, 'WBGL_10').message, /AMD GCN/);
  assert.equal(r.scoring_breakdown.hard_block_triggered, true);
  assert.equal(r.scoring_breakdown.enforcement_action, 'BLOCK');
});

test('Chrome sạch: 5 rule mới PASS; probe cũ thiếu trường => UNAVAILABLE', () => {
  const s = cleanChrome();
  let r = run(s);
  for (const id of ['CANV_07', 'WBGL_08', 'WBGL_09', 'WBGL_10', 'AUDI_06']) assert.equal(statusOf(r, id), 'PASS', id);
  delete s.data.canvas.glyphRun; delete s.data.webgl.varying; delete s.data.webgl.uniformLimit; delete s.data.webgpu;
  r = run(s);
  for (const id of ['CANV_07', 'WBGL_08', 'WBGL_09', 'WBGL_10']) assert.equal(statusOf(r, id), 'UNAVAILABLE', id);
  assert.equal(r.scoring_breakdown.trust_score, 100);
});

test('WBGL_10: GPU khai báo khác họ subgroup => FAIL; vendor chưa có bảng => PASS', () => {
  const s = cleanChrome();
  s.data.webgpu = { ...s.data.webgpu, vendor: 'amd', architecture: 'rdna-2', subgroupMinSize: 64, subgroupMaxSize: 64 };
  assert.equal(statusOf(run(s), 'WBGL_10'), 'FAIL');
  s.data.webgpu = { ...s.data.webgpu, architecture: 'gcn-4' };
  assert.equal(statusOf(run(s), 'WBGL_10'), 'PASS');
  s.data.webgpu = { ...s.data.webgpu, vendor: 'intel', architecture: 'gen-12lp', subgroupMinSize: 16, subgroupMaxSize: 32 };
  assert.equal(statusOf(run(s), 'WBGL_10'), 'PASS');
  s.data.webgpu = { ...s.data.webgpu, subgroupMinSize: null };
  assert.equal(statusOf(run(s), 'WBGL_10'), 'UNAVAILABLE');
});

test('WBGL_08: lệch lẻ tẻ < 1% chỉ WARNING; WBGL_09 chỉ đánh giá trên ANGLE', () => {
  const s = cleanChrome();
  s.data.webgl.varying = { ...s.data.webgl.varying, off: 30 };
  assert.equal(statusOf(run(s), 'WBGL_08'), 'WARNING');
  s.data.webgl.uniformLimit = { ...s.data.webgl.uniformLimit, vsAbove: true };
  assert.equal(statusOf(run(s), 'WBGL_09'), 'FAIL');
  s.data.webgl.unmaskedRenderer = 'Apple M2';
  assert.equal(statusOf(run(s), 'WBGL_09'), 'UNAVAILABLE');
});

test('AUDI_06: lệch baseline > 5e-4 => FAIL; dao động nhỏ giữa máy => PASS; ngoài Windows => UNAVAILABLE', () => {
  const s = cleanChrome();
  s.data.audio.sumA = 124.04114187159576;
  assert.equal(statusOf(run(s), 'AUDI_06'), 'FAIL');
  s.data.audio.sumA = 124.04347091798263; // Dolphin: lệch 4e-6, để AUDI_05 xử lý
  assert.equal(statusOf(run(s), 'AUDI_06'), 'PASS');
  s.data.audio.sumA = 124.04114187159576;
  s.data.navigator.userAgent = s.data.navigator.userAgent.replace('Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10_15_7');
  assert.equal(statusOf(run(s), 'AUDI_06'), 'UNAVAILABLE');
});

test('CANV_07: Brave farbling chỉ WARNING; không phải Blink => UNAVAILABLE', () => {
  const s = cleanChrome();
  s.data.canvas.glyphRun = { ...s.data.canvas.glyphRun, bad: 2, diffBytes: 300 };
  assert.equal(statusOf(run(s), 'CANV_07'), 'FAIL');
  s.data.navigator.isBrave = true;
  s.data.uaData.brands = [...s.data.uaData.brands, { brand: 'Brave', version: '142' }];
  assert.equal(statusOf(run(s), 'CANV_07'), 'WARNING');
});
