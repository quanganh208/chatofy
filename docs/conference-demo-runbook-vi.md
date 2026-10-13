# Hội nghị video — Sổ tay chạy demo

**Nhánh:** `video-conferencing`  
**Mục tiêu:** demo đồ án trên một máy / loopback (cùng một máy, cùng trình duyệt, nhiều profile)  
**Kiểm lần cuối:** 2026-10-13

> Bản tiếng Việt của `conference-demo-runbook.md`. Khi hai bản lệch nhau, bản tiếng Anh là bản gốc.

---

## 1. Điều kiện cần

### Tệp môi trường

`apps/api/.env` tối thiểu phải có:

```bash
# Bắt buộc — API không khởi động nếu thiếu
AUTH_JWT_SECRET=<chuỗi base-64 32 byte>
# openssl rand -base64 32

# Bắt buộc cho dịch máy (Gemini)
GEMINI_API_KEY=<khóa của bạn>

# Giới hạn đồng thời cho demo — tăng lên khi có từ 3 người nói cùng lúc.
# Mặc định (6 / 4) đủ cho demo 2 người.
# Với 3 người nói và cùng dịch một lúc, mức mặc định chạm trần; hãy tăng cả hai
# trước khi demo, và khởi động lại sidecar STT sau khi đổi LOCAL_STT_CONCURRENCY.
MAX_CONCURRENT_TURNS_GLOBAL=12
LOCAL_STT_CONCURRENCY=6
```

`apps/web/.env.local` phải có:

```bash
# Ký cookie phiên của Next-Auth
AUTH_SECRET=<chuỗi base-64 32 byte>
# openssl rand -base64 32

# Trỏ web app tới WebSocket của API chạy local
NEXT_PUBLIC_API_WS_URL=ws://localhost:3000
```

### Tài khoản

Bạn cần 2–3 tài khoản đã đăng ký (mỗi profile trình duyệt một tài khoản). Tạo qua
`http://localhost:3001/register` sau khi stack đã chạy. Khi các biến `SMTP_*` chưa đặt,
link xác minh email sẽ **in ra console của API** — copy link đó, mở trong cùng trình
duyệt là xong.

---

## 2. Trình tự khởi động

```bash
# Chạy từ thư mục gốc repo — khởi động Postgres, Redis, hai sidecar giọng nói
# (local-stt cổng 8002, local-tts cổng 8003), API NestJS cổng 3000, và web Next.js
# cổng 3001. Lệnh này giữ terminal (blocking).
pnpm dev:all
```

Đợi tới khi terminal hiện:

- `[api] Application is running on: http://localhost:3000`
- `[web] ✓ Ready in ...`
- Cả hai sidecar in banner khởi động (local-stt và local-tts đều log ra stdout)

**Các URL**

| Bề mặt         | URL                              |
| -------------- | -------------------------------- |
| Web app        | http://localhost:3001            |
| API (health)   | http://localhost:3000/health     |
| Sidecar STT    | http://localhost:8002            |
| Sidecar TTS    | http://localhost:8003            |
| Lobby hội nghị | http://localhost:3001/conference |

---

## 3. Kịch bản demo (một máy, 2–3 profile trình duyệt)

### Chuẩn bị

Mở Chrome (hoặc trình duyệt Chromium bất kỳ) với hai hoặc ba profile riêng. Mỗi profile
đăng nhập một tài khoản Chatofy khác nhau. Xếp các cửa sổ cạnh nhau.

### Từng bước

1. **Profile A** — vào `http://localhost:3001/conference`.
2. Nhập tên (ví dụ "Quang Anh"), để nguyên mã phòng được tạo sẵn, chọn **Tiếng Việt**.
3. Bấm **Start** — màn hình trong cuộc gọi mở ra. Copy mã phòng từ thanh địa chỉ
   (`/conference/<roomId>`).
4. **Profile B** — vào `http://localhost:3001/conference`.
5. Nhập tên (ví dụ "Alice"), dán mã phòng vào ô Room ID, chọn **English**.
6. Bấm **Start** — Profile B vào cùng phòng. Hai profile giờ thấy video của nhau.

### Phần dịch

7. **Profile A (tiếng Việt)** — nói một câu ngắn bằng tiếng Việt (5–10 từ rồi dừng).
   - Profile B (tiếng Anh) sẽ thấy phụ đề hiện trong ~6 giây (phiên đã "nóng") và nghe
     bản dịch tiếng Anh đọc lên ngay sau đó.
8. **Profile B (tiếng Anh)** — đáp lại bằng một câu ngắn tiếng Anh.
   - Profile A (tiếng Việt) sẽ thấy và nghe bản dịch tiếng Việt.

**Điểm nên nhấn mạnh với người xem:**

- Phụ đề hiện **trước** bản dịch tiếng (phụ đề nhanh hơn — không tốn thời gian tổng hợp giọng).
- Mã phòng là chuỗi chữ-số ngắn, ai cũng gõ hoặc chia sẻ được.
- Mỗi người tự chọn ngôn ngữ của mình.

### Nút điều khiển mic / camera

9. Profile A bấm nút mic → mic tắt tiếng; roster bên Profile B hiện icon đã tắt mic.
10. Profile A bấm nút camera → tile video tối đi ở cả hai bên.
11. Bấm lại cả hai để khôi phục.

### Rời phòng

12. Một trong hai profile bấm **Leave** → quay về lobby hội nghị. Grid của profile còn
    lại bỏ tile của người vừa rời đi.

### Checklist smoke (tích từng mục — ánh xạ các hạng mục polish A/B/C/D)

Chạy một lần trên stack thật trước khi tin cậy bản demo. Mỗi dòng là một thứ phải tận
mắt thấy / tai nghe — unit test không xác nhận được. Tích `[x]` khi làm xong.

**Cơ bản**

- [ ] Cả hai profile vào `/conference` qua **link Conference trên sidebar** (không chỉ gõ URL tay).
- [ ] Sau khi cả hai vào cùng phòng, mỗi bên thấy **video** của bên kia và nghe được giọng gốc của nhau.
- [ ] Nút mic tắt tiếng và roster bên kia hiện icon đã tắt; nút camera làm tối tile ở cả hai bên; **Leave** đưa về lobby và xóa tile ở phía người còn lại.

**Dịch hai chiều (phần lõi)**

- [ ] Người nói tiếng Việt → profile tiếng Anh thấy **phụ đề Việt→Anh** và nghe tiếng Anh.
- [ ] Người nói tiếng Anh → profile tiếng Việt thấy **phụ đề Anh→Việt** và nghe tiếng Việt. (PoC cũ hỏng đúng chiều này — đây là điểm sửa quan trọng nhất.)

**A — mở khóa audio**

- [ ] Tiếng dịch thật sự **phát ra** loa/tai nghe.
- [ ] Nếu lần đầu vào bị im, có nút **"tap to enable sound"** hiện ra; bấm vào thì có tiếng. (Nếu có tiếng ngay mà không bao giờ thấy nút đó thì cũng là đạt.)

**B — chỉ báo đang dịch**

- [ ] Trong lúc bạn nói và trước khi phụ đề hiện, tile của chính bạn hiện badge **"đang dịch…"**, rồi tự tắt khi phụ đề về (không bao giờ kẹt).

**C — nổi người nói + phụ đề đẹp**

- [ ] Tile của người đang nói/đang dịch có **viền sáng** rõ.
- [ ] Phụ đề **to và dễ đọc** từ xa; dòng final đậm, dòng partial mờ hơn.

**D — tự kết nối lại** (kill API giữa cuộc để giả lập mất kết nối)

- [ ] Khi cuộc gọi đang chạy, dừng API một lát (`Ctrl+C` terminal `pnpm dev:all`, hoặc kill tiến trình/docker), rồi bật lại: UI hiện **"Reconnecting (1/3)…"** và cuộc gọi **tự hồi phục** — không tile trùng, tiếng chạy lại.
- [ ] Kill API lâu hơn 3 lần thử (~7 giây): UI rơi xuống **"Connection lost. The call ended."** kèm nút Back to lobby (điểm dừng cuối, không phải crash).

Nếu dòng nào fail, ghi lại triệu chứng và các dòng log `[T1]`–`[T4]` trong DevTools console cho
lượt nói đó — chúng chỉ ra đúng tầng (gửi audio / transcript / phụ đề / frame TTS) bị hỏng.

---

## 4. Các trạng thái biên (điều cần biết, không phải lỗi)

| Tình huống                                  | UI hiển thị                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Trình duyệt chặn CẢ camera và mic           | "Camera and microphone access is required" + nút Back to lobby            |
| Trình duyệt chỉ chặn camera (mic được phép) | Vào ở chế độ chỉ-audio; banner nhẹ: "No camera — joining with audio only" |
| Mất WS giữa cuộc (API bị kill)              | "Connection lost. The call ended." + nút Back to lobby                    |
| Mở khi chưa đăng nhập                       | Trình duyệt tự chuyển hướng về `/login`                                   |

---

## 5. Rủi ro demo đã biết (nói thẳng)

| Rủi ro                                  | Tác động                                | Ghi chú                                                                                                                                          |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Chỉ một máy / loopback**              | Khách từ xa không vào được              | Media qua mạng (TURN/STUN, UDP 40000–49999) **chưa test** (Issue #208). Demo trên cùng một máy.                                                  |
| **Mobile chưa test trên thiết bị thật** | —                                       | Test mobile thiết bị thật đang treo (Issue #210). Demo trên trình duyệt web thôi.                                                                |
| **Tải dịch nhiều người nói đồng thời**  | Dịch xếp hàng khi 3+ người nói cùng lúc | Mặc định `MAX_CONCURRENT_TURNS_GLOBAL` (6) chạm trần ở 3 người × 2 job. Tăng lên 12 theo §1. Chưa load-test chính thức khi đã tăng hết các trần. |
| **Độ trễ dịch ~6 giây (phiên nóng)**    | Người xem có thể thấy trễ               | Đo được: ~6 giây khi nóng (T1→T2 trên stack local). Cho người nói dùng câu ngắn, ngắt quãng. Dẫn dắt bằng phụ đề — nó hiện trước tiếng.          |
| **Phạt câu đầu khi phiên nguội**        | Lần dịch đầu mất ~9 giây                | Model STT đệm ~2–3 giây audio trước khi ra transcript ở phiên nguội. "Làm nóng" mỗi profile bằng một câu bỏ đi trước khi demo thật.              |

---

## 6. Reset giữa các lần chạy

```bash
# Dừng tất cả (Postgres, Redis, sidecar, API, web)
pnpm dev:stop

# Chạy lại cho lần mới
pnpm dev:all
```

Để reset tài khoản người tham gia giữa các lần chạy, đăng xuất mỗi profile rồi đăng nhập
lại — không cần xóa database.

Để reset hẳn dữ liệu Postgres:

```bash
pnpm dev:stop
docker compose down -v postgres
docker compose up -d --wait postgres
pnpm --filter api exec prisma migrate deploy
pnpm dev:all
```

---

## 7. Xử lý sự cố

**Báo "Application is running" nhưng `/health` trả 500**  
Kiểm tra `AUTH_JWT_SECRET` và `GEMINI_API_KEY` đã đặt trong `apps/api/.env`.

**Sidecar STT không khởi động**  
Docker Desktop phải đang chạy. `docker compose up -d --wait` nằm sẵn trong `pnpm dev:all`;
nếu một sidecar thoát, xem `docker compose logs local-stt`.

**Không có tiếng dịch từ Profile B (người nói tiếng Anh)**  
Kiểm tra `GEMINI_API_KEY` còn hợp lệ. Bước MT (Google Gemini) là lệnh gọi cloud duy nhất
trong pipeline; STT và TTS chạy local.

**Đổi `LOCAL_STT_CONCURRENCY` không có tác dụng**  
Biến này đọc lúc **sidecar khởi động**. Sau khi đổi, khởi động lại sidecar:
`docker compose restart local-stt`.

**Dịch chạy một chiều nhưng chiều kia không**  
Kiểm tra ngôn ngữ mỗi profile đã chọn đúng ở lobby (Tiếng Việt vs English). Chiều dịch
được tính lúc vào phòng từ ngôn ngữ chọn trên trang lobby.
