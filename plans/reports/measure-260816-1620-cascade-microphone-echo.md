# Runbook: echo trên loa sau khi mở cổng micro cho cascade streaming

Phase: `260813-2239-cascade-streaming-clause-commit/phase-05b-continuous-microphone.md`, bước 4.
Trạng thái: **runbook, chưa có số.** Người chạy điền vào §Kết quả.

## Câu hỏi cần trả lời

Cascade streaming vừa được miễn cổng echo — micro không còn bị kéo về 0 khi bản
dịch đang phát. Thứ thay thế là `echoCancellationMode: 'all'` (`outbound-mic.ts`).
Ba điều cần biết, không phải một:

1. Chrome trên **máy này, Linux** có nhận `'all'` không?
2. Nếu nhận, nó có thật sự cắt được tiếng loa khỏi micro không — hay chỉ báo
   nhận?
3. Nếu không cắt được, dùng loa ngoài có còn sống được không, hay chữ trong popup
   phải giữ nguyên câu tai nghe?

Câu 1 và 2 tách nhau vì một constraint được báo là đã áp dụng vẫn có thể không
làm gì. Chỉ số ở §Đo mới phân biệt được hai thứ đó.

## Chuẩn bị

- Phòng yên, không người khác nói.
- Loa laptop, ghi lại **mức âm lượng hệ thống** — con số này là một phần của kết
  quả, không phải chi tiết vặt. Một lần chạy ở 30% và một lần ở 80% không so được
  với nhau.
- Fixture làm "cuộc họp": `apps/extension/src/fake-meeting-audio.ts`.
- Ghi lại: model máy, phiên bản Chrome, bản build extension.

## Đo

`echoEvents` đã có sẵn trong status (`meeting-capture.ts` → `reportStatus`), đếm
bởi `echo-monitor.ts` khi RMS vượt `ECHO_THRESHOLD = 0.02` **trong lúc** inbound
đang phát. Chỉ số báo cáo là **`echoEvents` / phút playback**, không phải
`echoEvents` thô — hai lần chạy khác nhau về lượng playback thì số thô vô nghĩa.

Đọc dòng log lúc mở micro để biết câu 1:

```
[chatofy] outbound microphone: echoCancellation=<giá trị thật>
```

Đọc như sau — và đọc đúng chỗ này quan trọng, vì bản nháp đầu của code đã hỏng
đúng ở đây:

- `all` → Chrome **đã nhận** chuỗi. Chưa nghĩa là nó hoạt động; câu 2 do
  `echoEvents` trả lời.
- `true` → Chrome ép chuỗi về boolean, tức trình duyệt này **chưa có** chế độ đó.
  Đây là ca lùi, và nó phải đọc là "không hỗ trợ", không phải "thành công".
- `unreported` → không có track hoặc `getSettings()` không trả trường này.

`"all"` là **giá trị của `echoCancellation`**, không phải một trường riêng.
Không có member nào tên `echoCancellationMode` — đó là tên của enum. Viết nó
thành member riêng thì WebIDL bỏ im lặng: không lỗi, không tác dụng, và log báo
"không hỗ trợ" trên mọi máy kể cả máy chạy được.

**Ba lần chạy, mỗi lần cùng độ dài (đề xuất 3 phút):**

| #   | Cấu hình                                                             | Kỳ vọng                    |
| --- | -------------------------------------------------------------------- | -------------------------- |
| A   | Loa ngoài, AEC mặc định (tạm bỏ `echoCancellationMode` để đối chứng) | Đường nền: echo cao        |
| B   | Loa ngoài, `echoCancellationMode: 'all'`                             | Nếu `'all'` hoạt động: ≈ C |
| C   | Tai nghe                                                             | Đối chứng, kỳ vọng ≈ 0     |

Không có C thì B không đọc được — không biết số thấp là do AEC hay do hôm đó
phòng yên.

**Bắt buộc ghi: micro của `EchoMonitor` có được cấp quyền không.** Nếu bị từ chối,
`echo-monitor.ts:90-95` nuốt lỗi và để `echoEvents` ở 0 — một số 0 không có nghĩa
gì cả, và nó trông giống hệt một số 0 thật.

## Kiểm thêm, không chỉ số nào bắt được

- **Có lượt outbound nào mang chính text của bản dịch inbound không?** Đây là
  vòng lặp tự dịch hiện ra ở tầng chữ. Đếm được từ overlay/transcript, và nó là
  tín hiệu trực tiếp hơn `echoEvents` — `echoEvents` chỉ nói "có tiếng", cái này
  nói "nó đã thành một lượt".
- **Nói chồng lên lúc bản dịch inbound đang phát** — lượt có mở không. Đây là
  đúng cái người dùng báo hỏng.
- **Chiều outbound ở trang không có patch micro** (`sending === false`): nói một
  đoạn dài 20–30s liên tục, xem lượt có bị đóng sớm không. Đây là ca dao động tự
  bóp cổ mà phase 5b nhắm vào.
- **Rollback**: đặt `CASCADE_STREAMING = false` rồi kiểm tay rằng cổng cũ quay
  lại. Phải làm bằng tay ở đây vì nó **không có integration test** — hằng đó là
  hằng biên dịch, nên chỉ có spec ở tầng hàm thuần (`microphone-gate.spec.ts`)
  cộng với một lần đọc call site trong `meeting-capture.ts`. Đừng đọc nhánh này
  như đã được test đầu-cuối.

## Kết quả

_Chưa chạy._

| #   | echoCancellation báo | echoEvents/phút | Lượt outbound trùng text inbound | Ghi chú |
| --- | -------------------- | --------------- | -------------------------------- | ------- |
| A   |                      |                 |                                  |         |
| B   |                      |                 |                                  |         |
| C   |                      |                 |                                  |         |

Máy / Chrome / âm lượng: _điền_
Micro của EchoMonitor được cấp quyền: _có / không_

## Quyết định treo trên số này

- **B ≈ C** → `'all'` làm được việc. Bỏ câu tai nghe khỏi chữ cascade trong
  `popup/main.ts`, ghi lại lý do.
- **B ≈ A** → `'all'` không cứu được (dù có báo nhận). Giữ câu tai nghe, giống
  hệt Live. Miễn trừ cổng **vẫn giữ** — cổng không phải là thứ chữa được, nó chỉ
  đổi echo lấy một cái micro chết.
- **Có lượt outbound trùng text inbound ở cả B** → đây mới là tín hiệu nghiêm
  trọng, không phải `echoEvents`. Lúc đó mới mở lại phương án lọc theo text
  (phase 5b §Phương án đã cân và loại), và mở lại có điều kiện: chỉ khi người
  dùng từ chối đeo tai nghe.
