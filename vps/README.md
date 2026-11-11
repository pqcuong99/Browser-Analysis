# Ground listener trên VPS (WRTC_09)

Antidetect sửa được chuỗi ICE candidate mà JavaScript đọc, nhưng không sửa được **địa chỉ nguồn của gói UDP**
đến một server thật. Listener này là STUN/TURN tối giản chạy trên VPS có IP public:

- probe thêm `stun:` + `turn:` của VPS vào `iceServers`. USERNAME của TURN mang tag riêng của từng phiên quét;
- Chrome gửi TURN Allocate từ chính socket UDP dùng cho host/srflx → VPS ghi IP:port thật của phiên đó;
- listener **từ chối cấp relay** (không ai mượn VPS chuyển tiếp được), giữ dữ liệu 10 phút trong RAM, không ghi đĩa;
- server SentinelFP hỏi `GET /lookup` (header `x-ground-key`) lúc verify rồi so với candidate → **WRTC_09**.

| VPS thấy UDP từ | Candidate JS báo | WRTC_09 |
|---|---|---|
| IP proxy | IP proxy | PASS: UDP thật đi qua proxy |
| IP nhà | IP proxy (hoặc ẩn) | **FAIL CRITICAL: WebRTC bị làm giả** |
| IP nhà | IP nhà | PASS (lộ IP thật, WRTC_01 FAIL) |
| IP X | IP Y không ai thấy | FAIL: candidate bị bịa |
| chỉ TCP từ IP proxy | — | PASS: UDP bị chặn, chỉ đi qua proxy |
| không gói nào | — | UNAVAILABLE |

## Tài nguyên

Một tiến trình Node (chạy được từ Node 16, không cần `npm install`), ~30–50 MB RAM, CPU gần 0.
Cổng: **UDP 3478, TCP 3478, TCP 8478**. Không đụng IIS/cổng 80/443, không đổi phiên bản Node.

## Cài trên VPS (Windows Server)

1. Tạo khóa trên máy chạy SentinelFP:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
2. Copy `stun-listener.cjs` và `install.ps1` lên VPS (ví dụ `C:\Users\Administrator\Desktop\ground\`).
3. Mở PowerShell **Run as Administrator** trong thư mục đó:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Key "<KHÓA>"
   ```
   Thêm `-ApiAllowFrom <IP nhà bạn>` để chỉ IP đó gọi được API tra cứu (khuyên dùng nếu IP nhà ít đổi).
4. Mở UDP 3478, TCP 3478, TCP 8478 trong firewall/security group của nhà cung cấp VPS (nếu họ có).

Script tạo thư mục `C:\sentinelfp-ground`, scheduled task *SentinelFP Ground Listener* chạy lúc khởi động
bằng tài khoản `LOCAL SERVICE` (tự chạy lại nếu crash) và 3 firewall rule. Log: `C:\sentinelfp-ground\listener.log`.

Kiểm tra: `Invoke-RestMethod http://127.0.0.1:8478/health` → `ok: True`.
Gỡ toàn bộ: `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall`.

## Cấu hình máy chạy SentinelFP

Tạo file `.env` ở thư mục gốc project (server tự đọc khi khởi động):

```
GROUND_HOST=<IP public của VPS>
GROUND_KEY=<KHÓA giống trên VPS>
# GROUND_STUN_PORT=3478
# GROUND_API=http://<IP VPS>:8478
```

Restart server rồi quét lại. Module WebRTC có thêm dòng **UDP thật (VPS)** và rule WRTC_09.

## Lưu ý

- Listener phải ở IP public: STUN tới `127.0.0.1` hay IP LAN không đi qua NAT/proxy nên không đo được gì.
- API 8478 là HTTP thường, khóa đi trên mạng dạng rõ. Dùng `-ApiAllowFrom` để giới hạn IP gọi.
- Nếu một antidetect định tuyến UDP qua SOCKS5 đúng cách, VPS sẽ thấy IP proxy: đó là "không lộ" thật, WRTC_09 PASS.
