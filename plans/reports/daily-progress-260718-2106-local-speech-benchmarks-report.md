# Báo cáo tiến độ ngày 18/07/2026 — Chốt speech stack local bằng benchmark thực nghiệm

Dự án: Chatofy — Ứng dụng dịch giọng nói hai chiều vi↔en (đồ án tốt nghiệp)

## 1. Mục tiêu ngày

Giải quyết vấn đề tồn đọng lớn nhất của đồ án: chưa tìm được model STT/TTS nào
chạy tốt trên CPU để thay thế hoàn toàn cloud (mới có VieNeu cho TTS tiếng
Việt). Yêu cầu: chạy offline trên máy phổ thông (8 nhân CPU, 32GB RAM, không
GPU), độ trễ mỗi bước ≤2s, chất lượng chấp nhận được cho demo.

## 2. Phương pháp

Thay vì chọn model theo số liệu công bố, áp dụng quy trình
**research → benchmark thực nghiệm → quyết định** (2 vòng trong ngày):

1. Khảo sát ứng viên qua paper/model card/benchmark cộng đồng (2025–2026)
2. Xây benchmark harness tái lập được, đo trên đúng máy mục tiêu
3. Quyết định theo ngưỡng định lượng đặt trước; TTS thêm bước nghe A/B chủ quan

Harness (2 project Python độc lập `benchmarks/stt/`, `benchmarks/tts/`):
mỗi engine chạy trong subprocess riêng (cách ly RAM, không tranh CPU), 1 lượt
warmup không tính giờ, chạy 2 lần kiểm tra variance, tham số decode/threads ghi
vào kết quả để tái lập.

## 3. Kết quả benchmark

### 3.1 STT (50 câu/ngôn ngữ: VIVOS-test vi, LibriSpeech test-clean en; ngưỡng RTF ≤ 0.3)

| Engine                                 | Ngôn ngữ | WER %    | RTF       | RAM   | Kết luận                              |
| -------------------------------------- | -------- | -------- | --------- | ----- | ------------------------------------- |
| Zipformer-30M-RNNT (sherpa-onnx)       | vi       | **5.38** | **0.017** | 223MB | **CHỌN**                              |
| PhoWhisper-small INT8 (faster-whisper) | vi       | 7.71     | 0.332     | 972MB | Loại — trượt ngưỡng RTF, thua cả WER  |
| Moonshine base (sherpa-onnx)           | en       | 3.86     | **0.040** | 418MB | **CHỌN**                              |
| whisper small.en INT8 (faster-whisper) | en       | **3.74** | 0.228     | 552MB | Đạt nhưng chậm hơn 5.7 lần, WER ngang |

Variance giữa 2 lần chạy ≤5%. Cloud baseline (ElevenLabs Scribe) tạm hoãn do
thiếu API key trong shell — không ảnh hưởng quyết định (ngưỡng tuyệt đối).

### 3.2 TTS tiếng Anh (30 câu hội thoại kiểu output dịch; ngưỡng p95 ≤ 2s/câu)

| Engine                          | Latency p95 | RTF  | RAM   | License    | Kết luận                                                    |
| ------------------------------- | ----------- | ---- | ----- | ---------- | ----------------------------------------------------------- |
| Kokoro-82M (sherpa-onnx)        | **1.18s**   | 0.32 | 619MB | Apache-2.0 | **CHỌN** (nghe A/B xác nhận chất lượng vượt trội, MOS ~4.5) |
| Piper lessac-high (sherpa-onnx) | 0.57s       | 0.15 | 323MB | MIT        | Phương án dự phòng latency-first                            |

Variance ≤1.1%. Kokoro trên máy 8 nhân nhanh hơn đáng kể số công bố (đo trên
4 nhân) — vượt qua ngưỡng 2s mà nghiên cứu ban đầu lo ngại sẽ trượt.

### 3.3 Phát hiện phương pháp luận (giá trị cho chương thực nghiệm)

Số liệu công bố sai lệch ở **cả hai chiều** trong cùng một ngày:
PhoWhisper-small được ước đạt RTF nhưng đo thực tế trượt (0.332 > 0.3);
ngược lại Zipformer và Kokoro đều nhanh hơn công bố. Kết luận: với bài toán
chọn model chạy CPU, benchmark trên đúng phần cứng mục tiêu là bắt buộc,
không thể tin số ước lượng.

## 4. Kiến trúc chốt được

Toàn bộ speech stack đã có phương án local, **3 model mới chạy chung 1 runtime
sherpa-onnx** → tương lai chỉ cần 1 sidecar hợp nhất:

- STT vi: Zipformer-30M-RNNT | STT en: Moonshine base | TTS en: Kokoro-82M
- TTS vi: giữ VieNeu sidecar (đã có)
- Ước tính 1 lượt dịch vi→en full-local: STT 0.25s + dịch ~1s + TTS ~1s ≈ **2.3s**

Lưu ý license: Zipformer-30M là CC-BY-NC-ND (chỉ dùng học thuật — ghi rõ trong
thesis; đường thay thế thương mại: PhoWhisper cùng contract). Kokoro/Moonshine/
Piper đều Apache/MIT.

## 5. Khó khăn đã xử lý

- **Segfault không traceback trên Windows**: wheel sherpa-onnx không kèm
  `onnxruntime.dll`, Windows load nhầm bản ORT 1.17 trong System32 (Windows ML)
  gây crash cứng do lệch C-API. Root-cause bằng unbuffered logging + rà DLL;
  fix bằng preload DLL của venv qua ctypes — tái dùng cho sidecar sau này.
- Repo HF của Zipformer thiếu `tokens.txt` → tự sinh từ `bpe.model` (sentencepiece).
- VIVOS đổi đường dẫn tarball trên HF (root 404), mirror gốc AILAB chết →
  cập nhật URL + fallback.

## 6. Sản phẩm bàn giao trong repo

- 2 benchmark harness tái lập được: `benchmarks/stt/`, `benchmarks/tts/`
  (unit tests xanh, code review 2 vòng đã xử lý hết finding)
- 4 báo cáo: 2 brainstorm/research + 2 kết quả benchmark (`plans/reports/`)
- 2 journal kỹ thuật (`docs/journals/`)
- 4 commit trên main: `2df1e7e`, `6d5fa1a` (STT), `6af1b33`, `de866ed` (TTS)

## 7. Kế hoạch tiếp theo

1. Plan + implement sidecar hợp nhất `services/local-speech` (sherpa-onnx:
   STT vi/en + TTS en) + `LocalSttProvider`/`LocalTtsProvider` vào registry —
   gỡ hoàn toàn ElevenLabs khỏi pipeline
2. Bổ sung cloud baseline WER khi có API key (so sánh thêm cho thesis)
3. Tùy chọn tăng độ tin cậy: thêm câu tự thu âm vào test set; mini-MOS panel
   cho TTS thay vì 1 người nghe

## Câu hỏi tồn đọng

- Advisor có yêu cầu format báo cáo tiến độ riêng không? (chưa đối chiếu được
  các báo cáo cũ trong NotebookLM do lỗi xác thực MCP — xem mục dưới)
- Mức độ chấp nhận license CC-BY-NC-ND cho model vi trong đồ án cần advisor
  xác nhận chính thức
