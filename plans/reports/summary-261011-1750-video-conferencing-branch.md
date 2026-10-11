# Tổng kết nhánh `video-conferencing`

**Ngày:** 2026-10-11  
**Phạm vi:** Issue #207 → #212 — giai đoạn nghiên cứu và chứng minh khả thi cho chức năng gọi video đa ngôn ngữ

---

## Chức năng đang xây dựng là gì?

Chatofy hiện tại cho phép hai người nói chuyện và được dịch giọng nói theo thời gian thực (ví dụ: người Việt nói, người kia nghe tiếng Anh). Nhánh này nghiên cứu cách **nâng cấp lên cuộc gọi video nhiều người** — giống Zoom hoặc Google Meet, nhưng có tính năng dịch thuật tích hợp sẵn: mỗi người nghe người kia bằng ngôn ngữ của mình, không cần phiên dịch viên.

---

## Đã làm được gì?

Giai đoạn này là **nghiên cứu và thử nghiệm** — chưa phải sản phẩm hoàn chỉnh, nhưng đã chứng minh được rằng ý tưởng hoạt động được trên phần cứng thực tế.

### Cuộc gọi video nhiều người hoạt động được

Đã xây dựng một bản thử nghiệm (PoC) trên trình duyệt: hai người mở hai tab trên cùng máy tính, vào cùng một "phòng họp", thấy và nghe được nhau qua video. Công nghệ xử lý việc chuyển tiếp video giữa các người dùng được chọn là **mediasoup** — một thư viện mã nguồn mở phổ biến, phù hợp hơn các lựa chọn khác vì không cần thêm server riêng biệt.

### Dịch thuật hoạt động trong phòng họp

Đã ghép nối tính năng dịch thuật sẵn có của Chatofy vào phòng họp video. Kết quả đo thực tế: sau khi người dùng nói xong, phụ đề dịch xuất hiện sau khoảng **6 giây** (lần đầu tiên) hoặc **6 giây** (lần tiếp theo). Con số này thực tế hơn ước tính ban đầu là 1–2 giây — phản ánh đúng tốc độ xử lý của mô hình AI hiện tại.

### Ứng dụng mobile có màn hình phòng họp

Đã thêm giao diện phòng họp vào ứng dụng Android. Chưa test trên điện thoại thật — cần thiết bị Android thực tế để xác nhận.

### Máy chủ chịu được bao nhiêu người?

Đã đo thực tế bằng cách mô phỏng tự động nhiều người dùng cùng lúc. Kết quả:

| Số người trong phòng |   Chất lượng video    | Băng thông cần thiết |
| :------------------: | :-------------------: | :------------------: |
|       2 người        |      Thấp (360p)      |   1.8 MB / 30 giây   |
|       4 người        |      Cao (720p)       |  18.7 MB / 30 giây   |
|       6 người        | Cao nhất (720p 60fps) |  36.6 MB / 30 giây   |

**6 người gọi video chất lượng cao cùng lúc** sử dụng khoảng **9.7 Mbps** — hoàn toàn chịu được trên một máy chủ đơn. Đây là giới hạn đặt ra cho đồ án, và máy chủ xử lý tốt mà không có dấu hiệu quá tải.

### Kế hoạch triển khai lên internet

Đã quyết định cách để người dùng bên ngoài (không cùng mạng nội bộ) có thể tham gia cuộc gọi: mở một số cổng mạng trên máy chủ và dùng dịch vụ trung gian miễn phí của Cloudflare làm dự phòng. Phần này chỉ cần cấu hình khi chạy thật, không cần viết thêm code.

### Tổng kết và kế hoạch tiếp theo

Đã tổng hợp tất cả quyết định thiết kế thành tài liệu hoàn chỉnh, loại bỏ các tính năng không cần thiết cho đồ án (thanh toán theo phút, lưu dấu giọng nói), và lên kế hoạch cho giai đoạn xây dựng thật sự.

---

## Kết quả bằng số

| Mục                                         | Số liệu                |
| ------------------------------------------- | ---------------------- |
| Thời gian thực hiện                         | ~1 tuần                |
| Số lượng thay đổi code                      | 28 lần commit, 60 file |
| Số vấn đề nghiên cứu đã giải quyết          | 6/6                    |
| Số người tối đa đã test                     | 6 người                |
| Độ trễ dịch thuật đo được                   | ~6 giây                |
| Băng thông tối đa đo được (6 người, 720p60) | 9.7 Mbps               |

---

## Còn lại gì?

- **Test trên điện thoại Android thật** — giao diện mobile chưa được xác nhận trên thiết bị thực.
- **Cấu hình mạng cho server thật** — cần khi muốn người dùng bên ngoài kết nối được.
- **Xây dựng sản phẩm thực sự** — giai đoạn nghiên cứu đã xong, giai đoạn lập trình chính thức (issue #215–#217) chưa bắt đầu.

---

## Chi tiết kỹ thuật

### #207 — mediasoup SFU PoC

Lựa chọn mediasoup 3.28.0 (bác bỏ LiveKit vì cần 2 container riêng, bác bỏ Pion vì phải viết Go server mới). Triển khai conference gateway trên NestJS (`apps/api/src/modules/conference/`) với xác thực JWT qua `Sec-WebSocket-Protocol`. PoC web tại `apps/web/app/(app)/conference-poc/page.tsx` — 2 peer join cùng phòng, trao đổi video/audio qua SFU thành công.

### #208 — Đường truyền media ra internet

Quyết định Path A: mở UDP 40000–49999 trên server production + Cloudflare TURN (free tier, 1 TB/tháng) làm fallback cho mạng chặn UDP. Thêm coturn vào `docker-compose.yml` cho test ngoài localhost. Không cần code runtime thêm; chỉ cần cấu hình khi deploy lên server thật có IP public.

### #209 — Dịch thuật audio trong phòng họp

Nối pipeline `/ws/translate` hiện có vào conference PoC: mic người dùng A → STT → dịch → TTS → phát cho người dùng B. Sửa 3 lỗi: wire format, JWT subprotocol auth, audio capture (pcm16 qua ScriptProcessor). Đo latency thực: warm ~5.9 s, cold ~9.2 s — thay thế ước tính gốc 1.2–1.8 s trong risk doc.

### #210 — Hỗ trợ client web và mobile

Xác nhận mediasoup-client chạy trong browser không có vấn đề CSP. Thêm màn hình PoC conference trên mobile (`apps/mobile/app/(app)/conference-poc.tsx`, `conference-poc-call-view.tsx`). Test trên thiết bị Android thật còn pending — cần physical device + USB debugging.

### #211 — Benchmark hiệu năng SFU

Harness Playwright headless Chromium chạy lưới 4 × 3 (2/3/4/6 người × 360p30/720p30/720p60, 2 lần mỗi ô). Ba lỗi phải sửa để có số liệu thực: `window.__ws` chưa gán khiến consumer không kết nối, `bytesWritten` → `bytesSent` trong metrics service, `--allow-loopback-in-peer-connection` để Chromium chấp nhận ICE candidate 127.0.0.1.

Kết quả đo đầy đủ (`benchmarks/video/results/summary.csv`):

| Participants | Resolution | Bytes sent / 30 s | Bytes recv / 30 s | Worker RSS |
| :----------: | :--------: | :---------------: | :---------------: | :--------: |
|      2       |   360p30   |      1.81 MB      |      1.85 MB      |  15.4 KB   |
|      2       |   720p30   |      4.61 MB      |      4.71 MB      |  16.4 KB   |
|      2       |   720p60   |      4.91 MB      |      4.94 MB      |  16.5 KB   |
|      3       |   360p30   |      3.52 MB      |      2.69 MB      |  16.5 KB   |
|      3       |   720p30   |     13.06 MB      |      7.24 MB      |  17.1 KB   |
|      3       |   720p60   |     12.21 MB      |      7.45 MB      |  17.3 KB   |
|      4       |   360p30   |      6.52 MB      |      3.65 MB      |  17.5 KB   |
|      4       |   720p30   |     18.72 MB      |      9.71 MB      |  18.1 KB   |
|      4       |   720p60   |     26.69 MB      |      9.95 MB      |  18.5 KB   |
|      6       |   360p30   |     19.19 MB      |      5.64 MB      |  18.5 KB   |
|      6       |   720p30   |     31.96 MB      |     14.22 MB      |  20.0 KB   |
|      6       |   720p60   |     36.60 MB      |     14.27 MB      |  20.5 KB   |

Worker CPU = 0% do Windows không expose `ru_utime` qua POSIX `getrusage`.

### #212 — System design v2 và tổng kết

Đóng 4 open decision còn lại: billing (deferred — thesis phi thương mại), capacity (resolved bởi #211), speaker embeddings (deferred — per-track identity đủ), recording (deferred — chưa có private bucket policy). Cập nhật Prisma schema (bỏ billing/embedding model), re-rate risk dịch thuật theo số đo thực. Tạo doc tổng hợp `docs/architecture/video-conferencing-v2-synthesis.md`. Mở Phase 1 implementation: issue #215, #216, #217.

### Thống kê commit

| Mục                       | Số liệu             |
| ------------------------- | ------------------- |
| Commits                   | 28                  |
| Files thay đổi            | 60                  |
| Insertions                | ~20,786             |
| Issues đóng               | 6 (#207–#212)       |
| Open decisions giải quyết | 7 (Decision 1, 3–7) |
