# Runbook: web có full-duplex được không

Phase: `260813-2239-cascade-streaming-clause-commit/phase-05b-continuous-microphone.md`, nhánh web.
Trạng thái: **runbook, chưa có số.** Người chạy điền vào §Kết quả.

## Vì sao đo, thay vì bật

Web bị **cùng triệu chứng** với extension — đang phát bản dịch thì micro coi như
không có — nhưng **khác cơ chế hoàn toàn**, nên bản vá của extension không chảy
sang.

Trên web, cái chặn là máy trạng thái nửa song công, không phải cổng gain-0:

1. `cascade-panel.tsx` khởi động với `streaming: false`; `CapturePump` mặc định
   `fullDuplex = false`, `continuous = false` (`capture-pump.ts:145-146`).
2. Lượt đóng → `awaiting-result` (`capture-pump.ts:208`).
3. Ở trạng thái đó, block micro đi vào echo gate rồi **bị vứt**
   (`capture-pump.ts:229-238`).
4. Chỉ mở lại khi lượt đã kết thúc **và** playback đã cạn
   (`conversation-session.ts:464-466`).

Không bật đại được, và `capture-pump.ts:76-82` nói rõ lý do: full duplex an toàn
khi capture và playback **tách nhau về cấu trúc** — extension bắt tab rồi phát
qua offscreen document, nên đường quay về bằng tín hiệu số không tồn tại. Web
không có sự tách đó: một trang, một `getUserMedia`, phát ra cùng thiết bị. Bật mà
chưa đo thì loa nuôi micro, app dịch lại chính giọng nó, **trước mặt người đang
xem** (`use-streaming-translate.ts:15-24`).

Nên câu hỏi không phải "bật hay không" mà là: **thiết bị này khử echo đủ tốt
chưa.** Cờ `fullDuplex` dev-only vốn được dựng ra đúng để trả lời câu đó
(`use-streaming-translate.ts:31-32`), và tới giờ chưa ai kéo.

## Cái vừa đổi để đo được

- `echoCancellation: 'all'` thay cho `true` trên cả hai hook của web
  (`use-streaming-translate.ts`, `use-live-translate.ts`), qua constant chung
  `ECHO_CANCELLATION_ALL`. **Đây là điều kiện tiên quyết:** đo full duplex trên
  AEC mặc định là đo cái mặc định, không phải đo giới hạn của thiết bị.
- `?fullDuplex=1` trên `/translate` bật cờ cho một lần chạy. URL chứ không phải
  nút bấm: không thêm gì vào giao diện người dùng thấy, và một URL là **chỉ dẫn
  tái lập được**, thứ mà runbook cần ghi cạnh con số.
- Khi cờ bật, panel hiện `full duplex · echo heard N`. Không bật thì không hiện.

Cả ba đều bị `NODE_ENV === 'production'` chặn ở tầng hook, nên bản build phát
hành không chứa đường nào bật được.

## Đo

```
pnpm --filter web dev
# mở http://localhost:3000/translate?fullDuplex=1
```

Kiểm tra `echoCancellation` được cấp trong DevTools trước khi tin bất cứ số nào:

```js
(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: 'all' } }))
  .getAudioTracks()[0]
  .getSettings().echoCancellation;
```

- `'all'` → Chrome nhận chuỗi.
- `true` → bị ép về boolean, tức máy này **không có** chế độ đó. Đây là ca lùi, và
  phải đọc là "không hỗ trợ" chứ không phải "thành công".

**Bốn lần chạy, mỗi lần cùng độ dài (đề xuất 3 phút hội thoại thật):**

| #   | Cấu hình                                                      | Kỳ vọng                                        |
| --- | ------------------------------------------------------------- | ---------------------------------------------- |
| A   | Loa ngoài, nửa song công (mặc định, không có `?fullDuplex=1`) | Đường nền hôm nay                              |
| B   | Loa ngoài, `?fullDuplex=1`                                    | Câu hỏi chính                                  |
| C   | Tai nghe, `?fullDuplex=1`                                     | Đối chứng, kỳ vọng echo ≈ 0                    |
| D   | Loa ngoài, `?fullDuplex=1`, âm lượng ~30%                     | Ngưỡng: nếu B hỏng, có mức nào sống được không |

Không có C thì B không đọc được — không phân biệt được "AEC tốt" với "hôm nay
nói nhỏ".

Ghi lại: máy, phiên bản Chrome, loa, **mức âm lượng hệ thống**, hướng dịch.

## Kết quả

_Chưa chạy._

| #   | echoCancellation được cấp | echo heard | Lượt mở nhầm do tiếng loa | Ghi chú |
| --- | ------------------------- | ---------- | ------------------------- | ------- |
| A   |                           |            |                           |         |
| B   |                           |            |                           |         |
| C   |                           |            |                           |         |
| D   |                           |            |                           |         |

## Quyết định treo trên số này

- **B ≈ C (echo heard ≈ 0)** → thiết bị đủ tốt. Lúc đó mới đáng mở câu hỏi lớn:
  bỏ trần `FULL_DUPLEX_ALLOWED` cho production, rồi mới tới `continuous: true` +
  `streaming: true` + `maxInFlight > 1` để web thật sự phát theo vế. **Ba tầng
  đó là ba quyết định riêng, không phải một** — và tầng cuối lật một mục đã chốt
  trong plan ("chỉ extension"), nên nó phải quay lại hỏi bạn.
- **B ≫ C** → web ở nguyên nửa song công. Đó không phải thất bại: nó là lý do vì
  sao extension tồn tại như một bề mặt riêng, và giờ có số đứng sau câu đó thay
  vì một lập luận.
- **D cứu được B** → có ngưỡng âm lượng sống được, nhưng một tính năng đòi người
  dùng vặn nhỏ loa là một tính năng đòi tai nghe với thêm một bước. Ghi số, đừng
  bán nó như một giải pháp.

**Không hứa từ phép đo này:** `echo heard` đếm tiếng loa quay về, **không** đếm
việc nó có mở nhầm một lượt hay không. Cột thứ ba trong bảng phải đếm tay từ
transcript, và nó mới là cột quan trọng hơn.
