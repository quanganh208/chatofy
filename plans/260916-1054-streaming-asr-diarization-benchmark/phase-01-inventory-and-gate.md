---
phase: 1
title: Khảo sát ứng viên và lọc qua tiêu chí cứng
depends-on: none
gpu: không
outputs: bảng ứng viên, ước lượng chi phí đo, quyết định GPU
---

# Phase 1 — Inventory và cổng lọc cứng

## Bối cảnh

Không tải weight nào ở pha này. Chỉ đọc model card, license, và thông số công bố.
Mục đích là cắt danh sách xuống còn những ứng viên **có thể** thắng, trước khi
tiêu bất kỳ giờ máy nào.

## Yêu cầu

Dựng một bảng ứng viên, mỗi dòng trả lời được sáu câu hỏi cứng. Một ứng viên
trượt bất kỳ câu nào thì bị loại ở pha này, kèm lý do ghi lại — danh sách bị loại
cũng là dữ liệu luận văn.

| #   | Cổng                        | Loại nếu                                                                                            |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| G1  | Có tiếng Việt               | Model card không liệt kê `vi`, hoặc liệt kê nhưng không có số nào cho tiếng Việt                    |
| G2  | Streaming thật              | Không có chế độ causal/cache-aware/chunked. Một model offline chạy theo cửa sổ trượt **không** tính |
| G3  | Chạy được CPU               | Không có export ONNX/GGML/CT2, hoặc chỉ có kernel CUDA-only                                         |
| G4  | License dùng được cho đồ án | Cấm nghiên cứu, hoặc không nêu license                                                              |
| G5  | Runtime khả dụng            | Cần runtime không cài được cạnh sherpa-onnx 1.13.4 / onnxruntime 1.27.0 (R2)                        |
| G6  | Kích thước hợp lý           | Weight không vừa `mem_limit: 4g` cùng lúc với cache mỗi stream (R4)                                 |

Với ứng viên **làm luôn nhận diện người nói**, thêm hai cổng:

| #   | Cổng                          | Loại nếu                                                                                          |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| G7  | Diarization streaming         | Chỉ diarize được sau khi hết audio (offline clustering) — khi đó nó không thay được tầng realtime |
| G8  | Số người nói không biết trước | Bắt buộc phải khai báo số người nói. Sản phẩm không biết trước con số đó                          |

## Họ model phải kiểm

Danh sách hạt giống, **chưa xác minh** — nhiệm vụ của pha này là xác minh hoặc
loại từng cái, không phải tin:

- **NVIDIA Nemotron-3.5 ASR streaming 0.6b** — đã có bằng chứng mạnh nhất từ
  phiên trước: sherpa-onnx 1.13.4 hỗ trợ, gói int8 chính thức cho 5 chunk size,
  license OpenMDW-1.1, có tiếng Việt. Đây là ứng viên tham chiếu.
- **NVIDIA Sortformer / diar_sortformer_4spk** — diarization streaming. Kiểm G8:
  tên gọi gợi ý giới hạn 4 người nói cố định.
- **NVIDIA cache-aware FastConformer** các biến thể khác trong NeMo.
- **Parakeet** các bản có đa ngôn ngữ — phiên trước ghi nhận "Parakeet v3 không có
  tiếng Việt", cần xác minh lại với bản mới.
- **SenseVoice / FunASR streaming (Paraformer-streaming)** — FunASR có
  paraformer online; kiểm G1 cho tiếng Việt.
- **WeNet / wenet-e2e streaming** các checkpoint tiếng Việt cộng đồng.
- **Whisper-streaming, faster-whisper + VAD** — kiểm G2 nghiêm: phần lớn là cửa
  sổ trượt trên model offline, tức **cùng loại pseudo-streaming repo đang chạy**,
  không phải thứ đang tìm.
- **pyannote / diart** — diarization streaming, nhưng không phải ASR; chỉ vào
  danh sách nếu ghép được với một ASR ở trên và vẫn qua ngân sách CPU.
- **Khe để ngỏ**: danh sách người dùng tự tìm, nhận bất cứ lúc nào, đi qua **đúng**
  bộ cổng G1–G8 này, không miễn trừ.

Đã đóng từ phiên trước, **không mở lại**:

- **sherpa-onnx online-transducer zipformer**: không có model tiếng Việt nào.
- **VietASR** (arXiv 2505.21527): paper mô tả causal Zipformer nhưng chỉ phát hành
  checkpoint `zzasdf/viet_iter3_pseudo_label` **non-causal**. Không có weight
  streaming.

## Files

**Tạo:**

- `plans/260916-1054-streaming-asr-diarization-benchmark/reports/inventory.md` —
  bảng ứng viên, bảng bị loại kèm lý do, ước lượng chi phí.

**Đọc, không sửa:** `services/local-stt/pyproject.toml`,
`docker-compose.prod.yml`, `docs/development-journey.md`, `README.md`.

**Không tạo, không sửa:** bất cứ gì trong `apps/`, `packages/`, `services/`,
`benchmarks/`.

## Các bước

1. Với mỗi họ model, mở model card và license. Ghi `path/url` làm nguồn cho từng
   ô trong bảng — không có ô nào được để "theo trí nhớ".
2. Áp G1–G8. Ghi lý do loại bằng một câu trích được.
3. Với ứng viên sống sót, ghi: số tham số, định dạng export có sẵn, runtime cần,
   kích thước weight, chunk size hỗ trợ, WER công bố kèm **tên bộ test** (không
   được trộn bộ test khác nhau vào cùng một cột).
4. Ước lượng chi phí screening: `(tổng giây audio test) × (RTF ước tính) × (số
ứng viên) × (số ngôn ngữ)`. Ghi rõ RTF ước tính lấy từ đâu.
5. Đánh giá trigger GPU theo hai điều kiện ở `plan.md`. **Báo cho người dùng**
   kèm con số, không tự quyết.

## Xác minh

- Bảng có ít nhất một ứng viên sống sót, hoặc một kết luận tường minh rằng không
  có ứng viên nào — kèm bảng bị loại đủ để người khác kiểm lại.
- Mỗi ô trong bảng có nguồn.
- `git diff --name-only` rỗng ngoài thư mục plan.
- Ước lượng chi phí có công thức hiện rõ, không phải một con số trần trụi.

## Rủi ro

**Model card nói dối hoặc nói thiếu.** Số WER công bố thường đo trên bộ test có
lợi cho model. Giảm thiểu: cột WER công bố **luôn** kèm tên bộ test, và không bao
giờ được so trực tiếp với 5,38% của VIVOS. Phase 3 mới sinh ra số so được.

**Bộ lọc quá chặt khiến không còn ai.** Nếu G1–G8 loại sạch, đó là một kết quả
hợp lệ và phải báo ngay chứ không nới cổng để có người qua.

## Rollback

Xoá thư mục plan. Không có tác dụng phụ nào khác — pha này không tải gì, không
sửa gì.
