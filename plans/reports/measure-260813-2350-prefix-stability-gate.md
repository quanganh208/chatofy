# Đo độ ổn định prefix — cổng go/no-go của plan streaming commit

Ngày 2026-08-13. Máy: linux, sidecar STT/TTS local trên :8002/:8003.
Plan: `plans/260813-2239-cascade-streaming-clause-commit/`.

**Kết luận: cổng KHÔNG đạt.** Điều kiện dừng đã ghi sẵn trong phase 1 đã kích
hoạt. Không làm tiếp phase 2–4 cho tới khi có quyết định của người dùng.

## Câu hỏi

Cả plan đặt trên một giả định: decode lại buffer đang lớn dần bằng recognizer
**offline** thì prefix có đơn điệu không? Nếu không, LocalAgreement không dùng
được, vì audio đã phát không rút lại được.

## Kết quả

| Đầu vào                            | depth 2 | depth 3 | depth 4 |
| ---------------------------------- | ------- | ------- | ------- |
| TTS sạch (vi)                      | **0**   | 0       | 0       |
| TTS sạch (en)                      | **0**   | 0       | 0       |
| Giọng thật vi — `vlsp-vi-01` (42s) | **66**  | 68      | 72      |
| Giọng thật vi — `vlsp-vi-02` (34s) | **38**  | 33      | 28      |

Cột là số lần một từ **đã phát ra tiếng** bị bản decode sau phủ nhận.

Fixture: `doof-ferb/vlsp2020_vinai_100h` (CC BY 4.0), chọn clip bằng grep token
ngập ngừng trên transcript, ghép thành đoạn dài. Xem
`benchmarks/realtime/fixtures/manifest.json` để dựng lại đúng bộ đó.

## Vì sao tăng ngưỡng không cứu được

Agreement canh **đuôi**: chờ N bản đọc liên tiếp đồng ý rồi mới nói. Nhưng chỗ
hỏng nằm ở **đầu** — recognizer nhận lại phần đã đọc xong khi có thêm ngữ cảnh:

- `thì rất là bình thường` → `thị trấn bình thường`
- `xin được mỹ` → `sinh được mỹ`
- `chấp thuận đó thì cái` → `**ờ** chấp thuận đó thì cái thời`

Ca thứ ba là ca chí mạng và đúng chủ đề: **từ ngập ngừng "ờ" xuất hiện ở đầu
câu** khi audio dài ra, đẩy lệch toàn bộ chuỗi token phía sau. Không ngưỡng chờ
nào bắt được chuyện đó, vì phần bị đổi là phần đã chờ xong và đã nói ra rồi.

Đó cũng là lý do depth 4 không tốt hơn depth 2 — có fixture còn tệ hơn.

## Cảnh báo về chính dụng cụ đo

Bản đầu của `prefix-stability.mjs` có lỗi thật, đã sửa: phép kiểm tra so bản đọc
**với chính nó** (`reads[index]` chính là `read`), nên chỉ phát hiện được bản đọc
bị **ngắn đi**, mù hoàn toàn với ca một từ đã commit bị **thay bằng từ khác** —
tức là đúng ca quan trọng nhất. Mọi số "0 contradictions" báo trước lúc sửa đều
yếu hơn vẻ ngoài của nó. Bảng trên là số sau khi sửa.

Chế độ cửa sổ trượt (`--window-s 8`, mặc định) **chưa dùng được**: phần dựng lại
chuỗi token tuyệt đối từ các cửa sổ trượt sinh ra báo động giả khi token rơi khỏi
đầu cửa sổ. Nhận ra được vì tăng depth làm số lỗi **tăng**, điều không thể xảy ra
với bất ổn thật. Số trong bảng vì thế lấy ở chế độ `--window-s 0`, nơi chỉ số
token là tuyệt đối theo định nghĩa nên không có bài toán canh lệch.

Hệ quả cho thiết kế: việc ánh xạ text trong cửa sổ về offset đã commit **không
phải chi tiết phụ, nó là phần khó nhất**, và làm sai thì sinh ra đúng loại mâu
thuẫn ma này.

## Cái đã đạt

- Sàn latency đường nền tính được ngay từ JSONL đang có: đo giả lập cho
  **intercept 9200ms** (8s cắt cứng + 1163ms pipeline), khớp dự đoán.
- Prompt dịch nối tiếp: 6/6 không ngoái lại trên `gemini-3.5-flash-lite` và
  `gemini-3.1-flash-lite`. **`gemma-4-31b-it` phải bị cấm** — 0/6, và nó trả về
  cả phần tự luận của mình, thứ sẽ bị đọc thành tiếng vào cuộc họp.
- `gemini-3.1-flash-lite` đo được median **3001ms** (README ghi 557ms).

## Lựa chọn

1. **Phương án B trong brainstorm** — giữ mô hình lượt, cắt ngắn ở khoảng lặng
   (~150ms thay vì 500ms), không commit giữa lượt. Mất tính năng "nói đến đâu
   phát đến đó" giữa câu, nhưng độ trễ vẫn giảm mạnh so với trần 8s hiện tại, và
   **không có ca phát ra tiếng rồi sai**.
2. **Commit theo ranh giới khoảng lặng, không theo agreement** — chỉ commit phần
   audio đã kết thúc bằng một khoảng lặng đủ dài, vì phần đó sẽ không được
   decode lại cùng ngữ cảnh mới nữa. Cần đo lại: giả thuyết, chưa có bằng chứng.
3. **Đổi recognizer** — model streaming thật sự sẽ đơn điệu theo thiết kế. Catalog
   sherpa-onnx không có Zipformer streaming tiếng Việt (đã kiểm ở brainstorm), nên
   hướng này tốn kém.
4. **Bỏ hẳn** — giữ cascade như hiện tại, dùng Gemini Live khi cần độ mượt.

## Câu hỏi chưa trả lời

1. Chọn hướng nào trong bốn hướng trên?
2. Chế độ cửa sổ trượt của dụng cụ đo có đáng sửa cho đúng không, hay bỏ luôn
   (`--window-s 0` là chế độ dùng được duy nhất hiện nay)?
3. Chưa đo tiếng Anh trên giọng thật (AMI) — nếu Moonshine ổn định hơn Zipformer
   thì có thể chỉ chiều en→vi làm được, và điều đó tự nó là một quyết định về
   phạm vi.
