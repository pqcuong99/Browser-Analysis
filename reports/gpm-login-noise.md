# GPM Login: phân tích 3 profile, định vị noise và case check

Ngày đo: 2026-11-10 · Máy: Windows 10, GPU thật AMD Radeon RX 580 (WebGPU `gcn-4`), 12 luồng CPU ·
Trình duyệt: GPM ChromiumCore 156.0.8078.48 · Điều khiển qua CDP cổng 42000 / 42001 / 42002 (`scripts/cdp-run.ts`).

## 1. Ba profile

Cấu hình đọc từ `D:\GPM_Login\<id>\Default\GPMSoft\gpm_fg.dat` (JSON base64, phần license/proxy không đọc ra). Cột "đo được" là giá trị trang web thấy.

| | p1 (`ad9d9718…`, :42000) | p2 (`eb131c14…`, :42001) | p3 (`95c81fee…`, :42002) |
|---|---|---|---|
| Canvas / WebGL / ClientRect / Audio | noise / noise / noise / noise | noise / noise / noise / noise | real / real / real / real |
| GPU khai báo (WebGL) | AMD Radeon(TM) Vega 3 (0x15DD) | NVIDIA GeForce GTX 960 (0x1401) | AMD Radeon RX 6800M (0x73DF) |
| WebGPU vendor / architecture | amd / gcn-5 | nvidia / maxwell | amd / rdna-2 |
| WebGPU subgroup (phần cứng thật) | 64/64 | 64/64 | 64/64 |
| MAX_VERTEX_UNIFORM_VECTORS | 4096 | **4095** (nhưng link được 4096) | 4096 |
| hardwareConcurrency (cấu hình → đo) | 2 → 2 | 6 → 6 | 16 → **12** (thật) |
| deviceMemory / jsHeapSizeLimit | 4 / 2 248 146 944 | 16 / 2 197 815 296 | 4 / 2 248 146 944 |
| Font | mode noise, "thêm" AmdtSymbols, RomanD | mode noise, thêm 2 font | mode noise, thêm 2 font |
| Timezone / WebRTC / geo | Asia/Bangkok / real / fake | giống p1 | giống p1 |

Ghi chú:
- p3 **không sạch hoàn toàn**: tắt 4 loại noise nhưng vẫn giả tên GPU (RX 6800M, RDNA-2) và bật navigator/font/WebGPU "noise".
- Seed noise của p1 và p2 gần như liền nhau: `noiseGlobalAlpha` 0.79474 / 0.79774, `clientRect.noise` 14.7068 / 14.7418, `audio.noise` −1.67937 / −1.67137 (cách nhau đúng 0.003, 0.035, 0.008). Hai profile tạo cùng lúc có noise tương quan, có thể liên kết với nhau nếu thu đủ mẫu.
- Font "thêm vào" (AmdtSymbols, RomanD…) không hiện ra ở cả Canvas lẫn DOM, `FontFace(local())` cũng thất bại: tuỳ chọn này không có tác dụng thấy được.
- Lệnh mở p3 có `--remote-debugging-port=42002-unsafe-webgpu` (thiếu `--enable`), Chrome vẫn nhận cổng 42002.

## 2. Noise nằm ở đâu

p3 cho đúng y các giá trị của Chromium sạch trên cùng máy (textScene `89030893…`, WebGL gradient `969530ca…`, audio 124.04347776696522), nên p3 là baseline. So p1/p2 với p3:

| Vùng | Sạch (đúng đáp án) | Bị noise | Cơ chế suy ra |
|---|---|---|---|
| Canvas | putImageData→getImageData, toDataURL/toBlob, fillRect, globalAlpha, shadow, arc, bezier, ký tự đơn, measureText | fillText/strokeText **chuỗi ≥ 2 ký tự**, gradient tuyến tính/radial (hash đổi) | Cộng độ lệch vào vị trí chuỗi lúc vẽ: centroid mực dịch ≈ +0.4–0.7 px ngang, +1.0 px dọc |
| WebGL | clear + readPixels (mọi kích thước), shader màu đặc, uniform1f…4fv, getUniform, getBufferSubData, transform feedback, gl_FragCoord | mọi phép nội suy **varying** (gradient theo attribute hoặc uniform) | gl_Position bị lệch nhẹ khi link chương trình; shader gốc không đổi nhưng trên ANGLE D3D11 thiếu đoạn "COMPILER INPUT HLSL" sau khi vẽ (chương trình thật là bản khác) |
| ClientRects | x, y, kích thước nguyên, offsetWidth, getComputedStyle, ResizeObserver, SVG getBBox | getBoundingClientRect/getClientRects **width/height không nguyên**, độ rộng text span và Range (lệch khác nhau) | Cộng/trừ k/64 px (k = −8…+7, theo hộp) vào width/height; vẫn nằm trên lưới LayoutUnit 1/64 |
| Audio | Oscillator (mọi dạng sóng, wavetable đỉnh = 1, phản đối xứng), Gain, BufferSource, Analyser, copyFromChannel | **DynamicsCompressor** (đầu ra và `reduction`) | Nhiễu cố định trong compressor: 124.04114 (p1), 124.03965 (p2) thay vì 124.04348 |
| GPU | | tên GPU WebGL + vendor/architecture WebGPU (cả p3), MAX_VERTEX_UNIFORM_VECTORS (p2) | Đổi chuỗi trả về, không đổi được phần cứng: subgroup WebGPU và giới hạn uniform thật vẫn lộ |

Khác hẳn Dolphin Anty (noise lúc đọc: getImageData ±1–3, readPixels ±1–2 có tràn uint8, wavetable oscillator, toạ độ x/y + 0.005). Vì vậy Noise Lab và rule cũ chỉ bắt được ClientRects của GPM.

## 3. Case check mới (đã đưa vào `public/probe.js` v1.1.0 và engine)

| Rule | Phép thử | p1 | p2 | p3 | Chromium sạch |
|---|---|---|---|---|---|
| `CANV_07` CRITICAL | glyph đầu của "XX" = "X" ở cùng toạ độ, 4 cặp (fill/stroke, font + vị trí theo seed server) | FAIL 4/4, 1393 byte | FAIL 4/4, 1672 byte | PASS | PASS |
| `WBGL_08` CRITICAL | R = v.x vs G = gl_FragCoord.x/N, B/A cho trục y; 15 120 pixel | FAIL 33.0% | FAIL 26.2% | PASS 0 | PASS 0 |
| `WBGL_09` HIGH | link shader với MAX+1 vec4 uniform phải thất bại (chỉ ANGLE) | PASS | FAIL (khai 4095, link được 4096) | PASS | PASS |
| `WBGL_10` HIGH | subgroup WebGPU khớp họ GPU khai báo | PASS (gcn-5 cùng họ GCN) | FAIL (NVIDIA phải 32/32) | FAIL (RDNA-2 phải 32/64) | PASS (gcn-4 64/64) |
| `AUDI_06` MEDIUM | compressor nằm trong baseline Chromium Windows, lệch > 5·10⁻⁴ là noise | FAIL 2.33e-3 | FAIL 3.83e-3 | PASS | PASS |
| `FONT_05` (cũ) | getBoundingClientRect = số CSS | FAIL 98/192 | FAIL 94/192 | PASS | PASS |

Các phép thử đã thử nhưng loại: gradient (Chromium dithering làm hàng/đối xứng lệch ngay cả bản sạch), globalAlpha/shadow (sạch trên GPM), font thêm vào (không có tác dụng), so compressor với chính nó (noise tĩnh nên mọi phép bất biến đều giữ).

## 4. Kết quả quét thật

| Profile | Trước (engine cũ) | Sau |
|---|---|---|
| p1 | Trust 75 · CHALLENGE (chỉ FONT_05) | **Trust 6 · BLOCK (hard-block)** |
| p2 | Trust 56 · CHALLENGE (FONT_05, WBGL_03) | **Trust 0 · BLOCK (hard-block)** |
| p3 | Trust 100 · ALLOW | **Trust 78 · CHALLENGE** (chỉ WBGL_10: GPU giả) |
| Chromium 152 sạch (browser pane) | Trust 100 · ALLOW | Trust 100 · ALLOW |

`npm test`: 54/54 pass. `npm run simulate`: 8/8 profile đúng kỳ vọng (thêm profile `gpm-draw-noise` dựng từ số đo thật của p2).

## 5. Còn hở

- **hardwareConcurrency / deviceMemory giả** (p1 = 2, p2 = 6 trên máy 12 luồng): main, iframe và Worker trả cùng số nên không rule nào bắt. Cần phép thử thời gian (chạy N Worker song song đo thông lượng), dễ nhiễu nên chưa làm.
- **GPU giả cùng họ**: p1 khai Vega 3 (GCN-5) trên RX 580 (GCN-4), cùng subgroup 64/64, không phân biệt được.
- Ngưỡng `AUDI_06` mới hiệu chỉnh cho Chromium Windows x64; OS khác là UNAVAILABLE.
- `CANV_07`, `WBGL_08` mới kiểm chứng trên Blink (GPM 156, Chromium 152). Nên chạy `BG_MODE=monitor` một thời gian trên traffic thật trước khi bật chặn cứng.
- Chưa dùng: cờ `--disable-background-timer-throttling` mà GPM luôn bật (tab nền không bị giãn timer về 1 s), có thể thành phép thử hành vi.

## 6. Cách chạy lại

```bash
node scripts/cdp-run.ts lab  gpm-p1=42000 gpm-p2=42001 gpm-p3=42002
node scripts/cdp-run.ts eval public/gpm-lab3.js gpm-p1=42000 gpm-p2=42001 gpm-p3=42002
node scripts/cdp-run.ts scan gpm-p1=42000 gpm-p2=42001 gpm-p3=42002
```

Dữ liệu thô: `data/noise-lab/gpm-p*_*.json` (Noise Lab), `data/cdp/gpm-p*_gpm-lab{,2,3}.json` (thí nghiệm).
