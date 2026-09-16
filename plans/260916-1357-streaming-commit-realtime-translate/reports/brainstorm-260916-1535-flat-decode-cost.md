---
type: brainstorm
date: 2026-09-16
plan: 260916-1357-streaming-commit-realtime-translate
status: accepted
decision: B — cửa sổ trượt cố định + khâu theo chồng lấp chữ
---

# Nhịp chữ chậm dần theo độ dài câu

## Triệu chứng người dùng

Thử phiên thật trên `/translate` sau khi Phase 4 xong: "chỉ mượt được 1 2 câu
đầu, những câu sau bị 1 vấn đề là trả từ ra lâu hơn".

## Nguyên nhân gốc — đã đo, không phải suy đoán

Mỗi lần đọc partial giải mã **lại toàn bộ** cửa sổ audio từ đầu. Chi phí giải mã
tăng theo độ dài buffer. Cổng duty rồi **nhân đôi** chi phí đó thành khoảng chờ
tới lần đọc kế: `interval = max(300ms, decode × 2)`.

Tiếng Anh (Moonshine), đo ngày 2026-09-16 trên máy này:

| Buffer | Rảnh   | Nhịp   | Có TTS chạy cùng | Nhịp    |
| ------ | ------ | ------ | ---------------- | ------- |
| 1s     | 73 ms  | 3,3 /s | 173 ms           | 2,9 /s  |
| 3s     | 100 ms | 3,3 /s | 130 ms           | 3,3 /s  |
| 5s     | 144 ms | 3,3 /s | 285 ms           | 1,8 /s  |
| 8s     | 237 ms | 2,1 /s | 411 ms           | 1,2 /s  |
| 9s     | 307 ms | 1,6 /s | 660 ms           | 0,76 /s |

Tiếng Việt (Zipformer) giữ 3,3/s suốt: 151 ms ở buffer 9 giây, vừa sát ngưỡng.

Ngưỡng lật là **150 ms** — dưới nó sàn 300 ms quyết định nhịp, trên nó chi phí
giải mã quyết định. Tiếng Anh vượt ngưỡng ở khoảng buffer 5–6 giây.

Hai hiệu ứng cộng lại đúng với mô tả của người dùng: câu sau **dài hơn** (log
phiên test: các lượt 7,8s / 5,1s / 4,1s đều về cuối), và từ câu thứ ba trở đi
**TTS đang tổng hợp** bản dịch câu trước trong khi người dùng nói câu sau.

## Không phải bug — là quyết định đã chốt

`docs/development-journey.md:978` đã có sẵn bảng chi phí giải mã theo buffer và
kết luận nguyên văn: _"nhịp re-decode phải giãn theo độ dài buffer, không cố
định"_. Cổng duty là câu trả lời có chủ ý cho phép đo đó. Sửa nó là **đổi thiết
kế**, không phải vá lỗi.

Đổi divisor 3→2 ở Phase 3 đã **cải thiện** chỉ số này (ngưỡng lật dời từ 100 ms
lên 150 ms), không gây ra nó.

## Ẩn số đã giải trước khi chọn

- **Timestamp:** Zipformer (vi) trả 19 token / 19 timestamp. Moonshine (en) trả
  3 token / **0 timestamp**. Cắt cửa sổ theo mốc thời gian chỉ làm được ở chiều
  không cần.
- **Model streaming:** sherpa-onnx **không có** Zipformer streaming tiếng Việt.
  Tiếng Anh có, nhưng bản 2023, encoder 250–338MB, tài liệu không công bố WER.

## Hợp đồng

**Kết quả:** nhịp chữ hiện lên không phụ thuộc độ dài câu.

**Ràng buộc:** CPU không GPU · không đụng extension/mobile · Gemini giữ nguyên ·
corpus VIVOS · giữ cơ chế chốt hai lần đọc và neo lại đã đo ở Phase 1–2.

**Không làm:** không tăng trần request · không bỏ cổng duty · không đổi giao thức.

**Nghiệm thu:** chi phí giải mã phẳng theo buffer 1→9 giây trên cùng phép đo
trên; nhịp ≥ 3/giây ở cả hai chiều kể cả khi TTS chạy cùng; WER cuối lượt không
tệ hơn 0,0538.

## Phương án đã cân nhắc

|                                 | Làm phẳng?               | Đổi model?        | Vỡ đầu tiên ở đâu                                     |
| ------------------------------- | ------------------------ | ----------------- | ----------------------------------------------------- |
| A — divisor về 1                | không, chỉ nhanh gấp đôi | không             | người nói thứ ba, lane bị giành                       |
| **B — cửa sổ trượt + khâu chữ** | **cả hai chiều**         | **không**         | ASR đọc khác nhau ở vùng chồng lấp                    |
| C — recognizer streaming cho en | có, chỉ chiều en         | có, WER chưa biết | chính giả định WER; sidecar phải giữ trạng thái phiên |

## Quyết định: B

Chỉ giải mã 4–5 giây cuối, giữ chuỗi đã chốt riêng, nối hai phần bằng cách tìm
hậu tố dài nhất của phần đã chốt trùng với tiền tố của lần đọc mới. Không cần
timestamp, không đổi model, không thêm trạng thái ở sidecar.

Lý do chọn: hướng duy nhất làm phẳng **cả hai chiều** mà không đổi model, không
thêm ẩn số, không tách kiến trúc. Chế độ hỏng của nó rơi về **neo lại** — cơ chế
Phase 2 đã dựng và Phase 1 đã đo (0/50, p95 1,2 giây) — chứ không phải một đường
lui trên giấy.

Không làm A kèm: nếu B chạy thì chi phí giải mã về ~100 ms, cổng duty nằm yên ở
sàn 300 ms, và divisor không còn ý nghĩa.

## Câu hỏi chưa giải được

Vùng chồng lấp cần dài bao nhiêu để khâu ổn định. Phải đo trên VIVOS, và đó là
việc đầu tiên của phase mới chứ không phải thứ quyết trước.
