# SentinelFP — Antidetect & Fingerprint Analyzer

Probe JavaScript + detection engine 63 rule + middleware chặn truy cập.
Hệ thống tìm **mâu thuẫn và sự bất ổn định giữa các tín hiệu** (không so khớp hash fingerprint),
chấm điểm theo công thức có khử trùng lặp nguyên nhân gốc rồi quyết định **ALLOW / CHALLENGE / BLOCK**.

## Chạy thử

Yêu cầu Node.js ≥ 22.18 (chạy TypeScript trực tiếp, SQLite tích hợp `node:sqlite`).

```bash
npm install
npm start          # build giao diện React rồi chạy http://127.0.0.1:3000 + https://localhost:3443 (HTTP/2, đo JA4)
npm test           # 54 unit test (engine, PoW, chứng chỉ, JA4, mockData)
npm run simulate   # in điểm của 8 profile mô phỏng
npm run mock       # sinh lại web/src/data/mockData.json từ engine
```

Phát triển giao diện với hot reload (cần backend chạy song song ở cổng 3000):

```bash
npm run dev        # backend, tự khởi động lại khi sửa server/
npm run dev:web    # Vite tại http://localhost:5173, proxy /api, /probe.js, /pow.js sang backend
```

## Giao diện

React 19 + Vite + Tailwind CSS 3 + lucide-react, mã nguồn trong `web/`, build ra `dist/` (Fastify phục vụ
`dist/` trước, rồi tới `public/` cho probe/PoW/gate). Dark mode phân lớp Zinc, thanh điều hướng kính mờ,
font Inter + JetBrains Mono đóng gói sẵn (không gọi CDN).

- **Màu và hiệu ứng** chỉ định nghĩa trong `tailwind.config.js` (`canvas`, `surface`, `raised`, `sunken`,
  `pass/warn/fail/na`, `shadow-glow-fail`, `animate-fail-pulse`...). Component không dùng giá trị arbitrary.
- **Class theo trạng thái** tra trong `web/src/lib/statusStyles.js` (`STATUS_STYLES`, `ACTION_STYLES`,
  `SEVERITY_STYLES`) và ghép bằng `cn()` = `clsx` + `tailwind-merge`, không dùng ternary lồng nhau.
- **Dữ liệu mock** `web/src/data/mockData.json`: phiên Antidetect Trust Score 13/100 (bị trừ 87 điểm, 3 FAIL, 2 WARNING), sinh bằng engine thật.
  Mở `/?mock=1` hoặc chọn *Mock Antidetect Session* trong Simulate; giao diện tự dùng mock khi không kết nối được backend.

```
web/src/
  App.jsx                         bố cục + định tuyến 3 chế độ
  hooks/useScanSession.js         quét thật, mô phỏng, mock, re-scan, challenge
  lib/  cn.js statusStyles.js moduleIcons.js palette.js format.js api.js
  components/common/              Button, StatusPill/StatusBadge, Card, TerminalBlock, Toggle, Toast
  components/layout/TopNav.jsx    thanh kính mờ: ModeSwitcher, SimulateMenu, actions
  components/scanner/             OverviewBanner, RiskGauge, ModuleGrid, ModuleCard, EvidenceDrawer (+ drawer/),
                                  BlockScreenModal, ChallengePanel, RescanReport, ScoringBreakdown, ScannerExtras
  components/qa/QAView.jsx
  components/admin/               AdminView, PolicyCards, RuleWeightsTable
```

### Hiệu ứng

- Gauge Trust Score: vòng cung và con số chạy từ 0 lên điểm thật trong 1.5 giây (count-up, easeOutCubic),
  màu con số đổi theo dải khi đang đếm.
- Lưới 10 thẻ module hiện lần lượt (staggered fade-in + slide-up) bằng Framer Motion.
- Khi gauge chạy xong, toast góc trên phải báo kết quả: `✅ Hoàn tất: Trình duyệt an toàn hợp lệ` (Trust ≥ 80)
  hoặc `⚠️ Cảnh báo: Phát hiện bất thường - Đã lưu log` (vàng khi 50–79, đỏ khi < 50). Mock tĩnh không ghi DB nên
  không nói "đã lưu log".
- Người dùng bật *giảm chuyển động* (prefers-reduced-motion) thì các hiệu ứng được bỏ qua.

### 3 chế độ

| Chế độ | Nội dung |
|---|---|
| **Public Scanner** (`/#/scanner`) | Hero 3 khối (định danh phiên · đồng hồ Trust Score + quyết định · thống kê 10 module + top tín hiệu), lưới 10 thẻ module sắp FAIL → WARNING → PASS → N/A, bảng Scoring Breakdown theo nhóm. Bấm thẻ để mở drawer 6 phần: Observed Data, Applied Rules, Reference Baseline, Stability & Multi-Context, Evidence Explanation, Raw JSON & Diff |
| **Internal Browser QA** (`/#/qa`) | Quét có gắn label, so sánh Scan A vs Scan B: ma trận trạng thái module, rule thay đổi, độ ổn định fingerprint giữa các phiên |
| **Admin Rules & Blocking Policy** (`/#/admin`) | Sửa ngưỡng, damping, hard-block, trọng số/độ tin cậy/bật-tắt từng rule, blocklist IP/ASN/JA4. **Preview impact** chạy lại policy nháp trên scan gần đây và 8 profile trước khi lưu |

Thanh công cụ: **Re-scan Browser**, **Simulate Antidetect Profile** (8 kịch bản), **Export JSON**.
Sau mỗi lần Re-scan, **Re-scan Stability Report** so từng hash/thông số với lần quét trước
(canvas seed cố định, WebGL readPixels, audio, text metrics, font, navigator...) và báo `STABLE` hoặc `DRIFT`.
**Preview Block Screen** mô phỏng màn hình 403, có toggle *Developer Debug View* để xem rule FAIL.

Trang khác: `/protected` (demo được `browserGuard` bảo vệ), `/gate?next=/path` (kiểm tra trung gian).

## Detection engine

4 lớp: (1) toàn vẹn API: hàm native bị Proxy/wrapper, `toString`, stack frame, PropertyDescriptor;
(2) đối chiếu chéo: UA ↔ Client Hints ↔ HTTP header ↔ JA4, GPU ↔ OS, IP ↔ WebRTC ↔ timezone;
(3) ổn định & đa ngữ cảnh: Canvas/WebGL/Audio/font đo ≥ 2 lần, main thread ↔ Web Worker ↔ iframe;
(4) chấm điểm:

```
sᵢ    = wᵢ × cᵢ                                  (PASS / UNAVAILABLE ⇒ 0)
S(Gk) = max sᵢ + 0.25 × Σ s_j (rule phụ cùng nhóm)
Trust = 100 − min(100, round(Σ S(Gk)))           (100 = trình duyệt hoàn hảo)
C     = Σ wᵢcᵢ / Σ wᵢ trên các rule bị kích hoạt (1.0 nếu không có)
Safe / ALLOW 80–100 (xanh) · Suspicious / CHALLENGE 50–79 (vàng) · High Risk / BLOCK 0–49 (đỏ)
```

**Hard-block override**: ≥ 2 rule `CRITICAL` bị FAIL với cᵢ ≥ 0.90, nằm ở **module khác nhau và nhóm
nguyên nhân khác nhau**, ⇒ Trust ≤ 25 và BLOCK. Payload probe thiếu phần bắt buộc hoặc IP/ASN/JA4 trong blocklist
cũng bị BLOCK ngay.

Toàn bộ 63 rule, trọng số, baseline và lời giải thích nằm trong `server/engine/rulebook.ts`;
logic từng rule trong `server/engine/rules.ts`.

### Các điểm lệch có chủ đích so với đặc tả gốc

| Rule | Đặc tả | Đã làm | Lý do |
|---|---|---|---|
| `HRDW_01` | `deviceMemory` > 8 là FAIL | Chấp nhận 16 và 32 | Chrome 152–157 thật trên máy này trả `32`; giữ ngưỡng 8 sẽ chặn nhầm người dùng thật |
| `FONT_02` | `document.fonts.check()` = true nhưng đo DOM ra font dự phòng | So danh sách font đo bằng Canvas với đo bằng DOM | Chromium trả `true` cho mọi font hệ thống (kể cả font không có), nên phép so ban đầu báo nhầm 100% |
| `LOCL_03` | Intl locale ≠ `navigator.language` | Chỉ FAIL khi locale Intl không thuộc *bất kỳ* ngôn ngữ nào của trình duyệt, hoặc DateTimeFormat ≠ NumberFormat | Chrome dùng ngôn ngữ giao diện cho Intl, khác `languages[0]` là chuyện bình thường |
| `AUTO_05` | outerWidth = 0 là FAIL | Một dấu hiệu yếu đơn lẻ ⇒ WARNING, c = 0.4 | Webview nhúng (Electron, in-app browser) có outerWidth = 0 |
| Canvas/Audio/WebGL noise | FAIL | WARNING, c = 0.2 trên Brave/Firefox/Safari | Đây là tính năng privacy hợp lệ của các trình duyệt đó |

## Noise tĩnh của Antidetect native (Dolphin Anty) và Noise Lab

Antidetect sửa thẳng trong Chromium (Dolphin Anty, …) chèn noise **cố định theo profile** và **giống nhau ở mọi đường đọc**
(getImageData = toDataURL = toBlob, main = iframe = Worker, đo lặp ra cùng số), hàm vẫn `[native code]`. Các rule so ổn định
(CANV_02–03, WBGL_04, AUDI_01–02, FONT_03) vì vậy PASS. Bộ rule bổ sung so với **đáp án tuyệt đối** thay vì so 2 lần đo:

| Rule | Phép thử | Quan sát trên Dolphin (noise bật) |
|---|---|---|
| `CANV_06` | `putImageData` ảnh đục ngẫu nhiên (theo seed server) → `getImageData` phải trả đúng từng byte; 4 ô màu đặc | 99.8% pixel lệch ±1–3, alpha 255 → 252–254 |
| `WBGL_07` | `clearColor(0.2,0.4,0.6)` → đúng 51/102/153; shader tô (0,1,0) → đúng 0/255/0 | 98.5% pixel lệch ±1–2, tràn số uint8 (0 → 255, 255 → 0) |
| `FONT_05` | 32 hộp toạ độ/kích thước bội số 0.25 px → `getBoundingClientRect` phải đúng số CSS (LayoutUnit 1/64 px) | mọi toạ độ lẻ (x, y, right, bottom) cộng hằng số theo profile (+0.005 / +0.01 px); số nguyên, width, height giữ nguyên |
| `AUDI_05` | oscillator f = fs/64 tuần hoàn tuyệt đối (mẫu n = n+64); osc→gain(0.5) = 0.5×osc; 2 osc = 2×osc; render dài gấp đôi cùng phần đầu; Analyser/AudioWorklet = buffer | noise nằm trong OscillatorNode và DynamicsCompressor (ConstantSource/Gain/BufferSource sạch), wavetable bị làm nhiễu sẵn: vẫn tuyến tính và tuần hoàn (các phép tuyến tính đều PASS), nhưng phản đối xứng lệch 56–62/64 mẫu và đỉnh sine = 0.9999991 thay vì 1.0 (phép wavetable chỉ dùng khi khai báo Windows) |

Đã thử và loại: "oscillator bắt đầu trễ k mẫu = bản gốc dịch k mẫu" và đối xứng gương sin(π−θ) = sin θ đều không đúng tuyệt đối ngay cả trên Chrome sạch.

**Noise Lab** (`/noise-lab.html?label=tên`, chỉ loopback/admin) chạy khoảng 200 phép thử có đáp án ở main, iframe, Worker,
lưu JSON vào `data/noise-lab/`. So sánh nhiều profile: `node scripts/noise-compare.ts p1 p2 p3` (ghi `data/noise-lab/report.md`).

## Noise lúc vẽ của GPM Login (và cách tự chạy trên profile thật)

GPM Login (ChromiumCore 156) chèn noise **lúc vẽ / lúc tính** chứ không phải lúc đọc: putImageData→getImageData, clear/readPixels,
màu uniform, oscillator và gain đều đúng đáp án, nên CANV_06 / WBGL_07 / AUDI_05 PASS. Cấu hình noise nằm trong
`<user-data-dir>/Default/GPMSoft/gpm_fg.dat` (JSON base64: `canvas.noiseTextX/Y`, `webgl.uniform*Noise`, `clientRect.noise`, `audio.noise`…).

| Rule | Phép thử có đáp án | Quan sát trên GPM (noise bật) |
|---|---|---|
| `CANV_07` | glyph đầu của `fillText("HH")` = `fillText("H")` ở cùng toạ độ (fill + stroke, font/vị trí theo seed) | chuỗi ≥ 2 ký tự dịch ≈ +0.5 px ngang, +1 px dọc; ký tự đơn sạch |
| `WBGL_08` | varying `v = p·0.5+0.5` phải bằng `gl_FragCoord/N` ở mọi pixel (WebGL1 64², 100², WebGL2 32²) | 26–33% pixel lệch ±1: gl_Position bị lệch khi link, buffer/shader nguồn nguyên vẹn |
| `WBGL_09` | ANGLE không link được shader dùng quá `MAX_*_UNIFORM_VECTORS` | khai 4095 nhưng link được 4096 |
| `WBGL_10` | WebGPU `subgroupMinSize/MaxSize` khớp họ GPU khai báo (NVIDIA 32/32, RDNA 32/64, GCN 64/64) | khai NVIDIA Maxwell / AMD RDNA-2 nhưng phần cứng báo 64/64 (GCN thật) |
| `AUDI_06` | tổng biên độ compressor nằm trong vài giá trị Chromium Windows (dao động < 2·10⁻⁴) | 124.04114 / 124.03965 thay vì 124.04348 |
| `FONT_05` | getBoundingClientRect = số CSS | width/height không nguyên ± k/64 px; ResizeObserver, getComputedStyle sạch |

Profile mở bằng `--remote-debugging-port` được điều khiển thẳng (chỉ Target + Runtime.evaluate, không Runtime.enable nên không tự kích hoạt AUTO_04):

```bash
node scripts/cdp-run.ts lab  gpm-p1=42000 gpm-p2=42001 gpm-p3=42002   # Noise Lab → data/noise-lab/
node scripts/cdp-run.ts scan gpm-p1=42000 gpm-p2=42001 gpm-p3=42002   # quét thật, in scanId
node scripts/cdp-run.ts eval public/gpm-lab3.js gpm-p1=42000 …        # chạy thí nghiệm, lưu data/cdp/
```

`public/gpm-lab*.js` là các thí nghiệm dùng để định vị noise. Báo cáo đầy đủ: `reports/gpm-login-noise.md`.

## Bước CHALLENGE: Proof-of-Work

Khi quyết định là `CHALLENGE`, trình duyệt phải giải Proof-of-Work trước khi được vào route bảo vệ:

1. `browserGuard` chuyển trang HTML sang `/gate` (API nhận `403 challenge_required`).
2. Gate gọi `GET /api/pow/challenge`: server cấp `prefix` ngẫu nhiên, dùng 1 lần, gắn IP + UA, sống 120 giây.
   Độ khó tăng theo điểm rủi ro: 16 bit (≈ 65k phép băm) sát ngưỡng CHALLENGE → 20 bit (≈ 1M) sát ngưỡng BLOCK.
3. `public/pow.js` tìm nonce sao cho `SHA-256(prefix:nonce)` có đủ số bit 0 đầu, trong Web Worker (≈ 0.1–1 giây).
4. `POST /api/pow/verify` kiểm lời giải, cấp lại cookie với `decision: ALLOW` kèm cờ `challenge`.
5. Phiên bị gắn cờ: giới hạn `FLAGGED_RATE_LIMIT` request/phút (mặc định 30, quá thì `429`) và mọi truy cập
   được ghi vào bảng `events` (xem trong báo cáo scan, mục *Session activity*).

Phiên `BLOCK` không thể vượt bằng PoW. Trong Public Scanner, scan thật bị CHALLENGE có nút **Complete Challenge**.
Muốn thay PoW bằng Turnstile/hCaptcha/OTP, sửa `/api/pow/*` và `public/pow.js`.

## Dữ liệu tầng mạng (Module 10, WRTC_02, LOCL_04)

**JA4 và HTTP/2 do server tự đo** khi trình duyệt vào thẳng cổng HTTPS (`HTTPS_PORT`, mặc định 3443):
một TCP frontend đọc TLS ClientHello trước khi bàn giao socket cho Fastify (HTTP/2 + HTTP/1.1), tính JA4,
và lấy SETTINGS / WINDOW_UPDATE / thứ tự pseudo-header từ phiên HTTP/2. Chứng chỉ tự ký cho localhost được
tạo bằng Node thuần trong `data/tls/` ở lần chạy đầu: trình duyệt sẽ cảnh báo, bấm *Advanced → Proceed*
(hoặc thêm `data/tls/cert.pem` vào trusted root của máy). Trang HTTP thường có nút dẫn sang bản HTTPS
khi module Network còn N/A. Chạy sau proxy/CDN thì kết nối đến server là của proxy, nên phải lấy JA4 từ edge.

p0f (`NETW_03`), ASN, GeoIP, IP reputation vẫn phải đến từ Edge/Reverse proxy. Server đọc các header sau
**chỉ khi** `TRUST_PROXY=1` hoặc `TRUST_EDGE=1` (nếu không, client tự đặt được header để qua mặt):

| Dữ liệu | Header mặc định | Biến đổi tên |
|---|---|---|
| JA4 / JA3 | `x-ja4`, `x-ja3` | `TLS_HEADER`, `JA3_HEADER` |
| Họ TLS client do edge phân loại | `x-tls-client` | `TLS_CLIENT_HEADER` |
| HTTP/2 (Akamai format) | `x-h2-fingerprint` | `H2_HEADER` |
| Phiên bản HTTP | `x-http-version` | `HTTP_VERSION_HEADER` |
| OS theo TCP (p0f) | `x-tcp-os` | `TCP_OS_HEADER` |
| ASN, tên, loại (`residential`/`hosting`…) | `x-asn`, `x-asn-org`, `x-asn-type` | `ASN_*_HEADER` |
| Quốc gia, timezone theo IP | `x-geo-country`, `x-geo-timezone` | `COUNTRY_HEADER`, `IP_TZ_HEADER` |
| Cờ IP (`tor,proxy,abuse`) | `x-ip-flags` | `IP_FLAGS_HEADER` |

Khi thiếu dữ liệu, rule tương ứng là `UNAVAILABLE` (không cộng điểm). Chạy ở localhost thì module
Network luôn N/A; dùng **Simulate Antidetect Profile** để xem các rule này hoạt động.

## Đối chiếu WebRTC với VPS (WRTC_09)

Chuỗi ICE candidate do JavaScript đọc nên Antidetect sửa được (thay IP thật bằng IP proxy). `vps/stun-listener.cjs`
là STUN/TURN tối giản chạy trên VPS có IP public: nó ghi IP:port nguồn thật của gói UDP theo tag từng phiên,
server so với candidate. VPS thấy IP nhà mà candidate báo IP proxy ⇒ **WRTC_09 FAIL CRITICAL** (WebRTC bị làm giả).
Cài đặt: `vps/README.md`. Cấu hình: `GROUND_HOST`, `GROUND_KEY` (có thể đặt trong `.env`).

## Luồng chặn

```
Trình duyệt ── GET /api/challenge ──► nonce + seed (dùng 1 lần, gắn IP + UA, sống 120s)
     │ probe.js chạy phép thử (canvas vẽ theo seed để không phát lại được)
     └── POST /api/verify ──► engine + policy hiện tại ──► report + quyết định
                                  └─► cookie bg_token (HMAC, gắn IP + UA, 30 phút)
Route cần bảo vệ ── preHandler browserGuard ──► ALLOW / CHALLENGE (403) / BLOCK (403)
```

Màn hình 403 ở production chỉ hiện mã tham chiếu, không tiết lộ rule nào đã kích hoạt.

## API

| Endpoint | Quyền | Mô tả |
|---|---|---|
| `GET /api/challenge`, `POST /api/verify` | public | Quét và nhận quyết định (schema `ScanReportResponse` trong `server/engine/types.ts`) |
| `GET /api/scans/:id` | ai có id | Báo cáo + payload probe |
| `GET /api/scans?label=` | admin | Danh sách scan |
| `GET /api/rules` | public | Metadata 63 rule + 10 module |
| `GET/PUT/DELETE /api/policy` | admin | Đọc / lưu / khôi phục Blocking Policy (lưu trong SQLite) |
| `POST /api/policy/preview` | admin | Chạy policy nháp trên 100 scan gần nhất + 8 profile |
| `GET /api/profiles`, `GET /api/simulate/:id` | public | Kịch bản mô phỏng |
| `GET /api/pow/challenge`, `POST /api/pow/verify` | phiên CHALLENGE | Proof-of-Work |
| `GET /api/server-info` | public | Cổng HTTPS, JA4/HTTP2 đo được cho request hiện tại |
| `POST /api/token/introspect` | admin | Cho backend khác kiểm tra cookie `bg_token` |

Admin = request từ localhost khi chưa đặt `ADMIN_KEY`; khi đã đặt thì phải gửi header `x-admin-key`.

## Tích hợp vào website

```ts
import { browserGuard } from './server/guard.ts';
app.post('/register', { preHandler: browserGuard }, handler);
```

Backend khác gọi `POST /api/token/introspect`. Frontend nhúng `/probe.js` rồi gọi
`await SentinelFP.verify()`, hoặc chuyển người dùng qua `/gate?next=...`.

## Biến môi trường

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `BG_SECRET` | ngẫu nhiên | **Bắt buộc ở production**, nếu không token mất hiệu lực khi restart |
| `BG_MODE` | `enforce` | `monitor` = chỉ ghi log, luôn cho qua. Nên chạy monitor 1–2 tuần trước khi bật chặn |
| `SAFE_SCORE` / `SUSPICIOUS_SCORE` | 80 / 50 | Ngưỡng Trust mặc định: ≥ SAFE → ALLOW, ≥ SUSPICIOUS → CHALLENGE, còn lại BLOCK (Admin có thể ghi đè). Policy cũ lưu theo Risk Score được tự quy đổi |
| `ADMIN_KEY` | (trống) | Bảo vệ API admin. Trống = chỉ localhost |
| `TRUST_PROXY` / `TRUST_EDGE` | `0` | Bật khi chạy sau proxy tin cậy để lấy IP thật và header edge |
| `STUN_URLS` | Google + Cloudflare STUN | Phân tách bằng dấu phẩy. Nên có ≥ 2 server: NAT thật trả cùng IP public cho mọi server |
| `GROUND_HOST` / `GROUND_KEY` | (trống) | IP VPS chạy `vps/stun-listener.cjs` và khóa chung. Bật WRTC_09. `GROUND_STUN_PORT` (3478), `GROUND_API` (`http://<host>:8478`) |
| `IP_ECHO_URLS` | api.ipify.org, api64.ipify.org | Khi server thấy IP nội bộ (scan ở localhost), probe hỏi các URL này để biết IP egress thật qua proxy và so với srflx (WRTC_01). Rỗng = tắt |
| `HTTPS_PORT` | 3443 | Cổng HTTPS + HTTP/2 tự đo JA4. `0` = tắt |
| `TLS_DIR` | data/tls | Nơi lưu chứng chỉ tự ký (tự tạo/gia hạn) |
| `FLAGGED_RATE_LIMIT` | 30 | Request/phút cho phiên đã vượt CHALLENGE |
| `PORT`, `HOST`, `DB_PATH`, `TOKEN_TTL` | 3000, 127.0.0.1, data/scans.db, 1800 | |

## Giới hạn cần biết

1. **Dữ liệu từ client có thể bị làm giả.** Nonce + seed chống phát lại, nhưng bot viết tay vẫn dựng được
   payload sạch. Lớp chặn thật sự là tầng mạng (JA4, HTTP/2, header) — xem profile *Scripted Replay Bot*.
2. **Antidetect vá Chromium ở tầng C++** qua được phần lớn kiểm tra JS. Rule mạnh nhất với loại này:
   phiên bản ↔ tính năng, Worker/iframe, GPU ↔ OS, font ↔ OS, JA4.
3. Baseline audio (`AUDI_03`) mới có hằng số Chromium Windows; bảng tính năng theo phiên bản trong
   `rules.ts` cần cập nhật khi Chrome/Firefox ra bản mới.
4. `AUTO_04` (CDP) cũng kích hoạt khi người dùng mở DevTools, nên chỉ là WARNING.
5. Trọng số là giá trị khởi điểm: **hiệu chỉnh bằng dữ liệu thật** — chạy `BG_MODE=monitor`, quét các
   profile antidetect tự kiểm soát với `?label=antidetect-<tên>`, rồi dùng tab QA và Impact Preview.

## Cấu trúc

```
public/probe.js            thu thập tín hiệu (window · iframe · Web Worker)
public/gate.html, style.css   trang kiểm tra trung gian + CSS cho trang server-rendered
web/                       giao diện React (xem mục Giao diện), build ra dist/
tailwind.config.js         bảng màu, glow, animation
server/index.ts            Fastify: API + route demo
server/engine/rulebook.ts  metadata 63 rule + 10 module
server/engine/rules.ts     logic đánh giá từng rule
server/engine/index.ts     chấm điểm, damping, hard-block, dựng report
server/engine/modules.ts   key metrics, stability, observed data theo module
server/engine/policy.ts    Blocking Policy (ngưỡng, trọng số, blocklist)
server/engine/profiles.ts  8 profile mô phỏng
server/engine/types.ts     data contract
server/guard.ts            middleware: ALLOW / CHALLENGE (PoW) / BLOCK, rate-limit phiên gắn cờ
server/pow.ts              Proof-of-Work: cấp và kiểm lời giải
server/tlsfp.ts            đọc ClientHello → JA4, HTTP/2 fingerprint
server/cert.ts             tạo chứng chỉ tự ký bằng Node thuần
server/token.ts, store.ts, db.ts
public/pow.js              client Proof-of-Work (SHA-256 trong Web Worker)
scripts/simulate.ts        in kết quả mô phỏng ra terminal
scripts/make-mock.ts       sinh web/src/data/mockData.json
test/engine.test.ts, test/pow.test.ts
```
