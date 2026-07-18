# Brainstorm Report — Local CPU TTS tiếng Anh (thay ElevenLabs, mảnh cloud cuối)

Date: 2026-07-18 | Status: research complete, pending approach decision
Context: vi TTS đã local (VieNeu), STT vi+en đã chốt sherpa-onnx
(`plans/reports/stt-cpu-benchmark-260718-results-report.md`). English TTS
(vi→en direction) là mảnh cloud cuối cùng.

## Measured Outcome (2026-07-18, post-benchmark)

Benchmark executed same day — see
`plans/reports/tts-en-cpu-benchmark-260718-results-report.md`. **Kokoro-82M
won**: p95 1.18s/sentence (PASS ≤2s rule), RTF 0.32 on the 8-core machine
(beat its published 4-core numbers), Apache-2.0, and user A/B verdict favored
its quality. Piper (p95 0.57s, MIT) recorded as latency-first fallback.
Runtime hợp nhất sherpa-onnx (STT vi/en + TTS en) được xác nhận.

## Requirements (carried from STT session)

- Windows 8-core CPU, 32GB RAM, CPU-only; sidecar/turn-based batch
- Target: câu dịch 5–15 từ (~5–10s audio) tổng hợp ≤2s (RTF ≲0.3 ưu tiên,
  ≤1.0 chấp nhận nếu quality vượt trội)
- Quality là tiêu chí thật (thay ElevenLabs) — MOS/naturalness có trọng số
- License OK cho đồ án; ưu tiên chạy được trên **sherpa-onnx** (chung runtime
  với STT đã chọn → 1 sidecar STT+TTS duy nhất)

## Candidates

| Model                             | Params     | Quality (MOS)                  | CPU RTF                                                    | RAM    | License                   | sherpa-onnx         |
| --------------------------------- | ---------- | ------------------------------ | ---------------------------------------------------------- | ------ | ------------------------- | ------------------- |
| Kokoro-82M                        | 82M        | **~4.5** (top open-source)     | ~0.47–0.51 (4-core EPYC; 8-core desktop kỳ vọng nhanh hơn) | ~300MB | Apache-2.0 ✓              | YES (flagship)      |
| Piper VITS (lessac/libritts-high) | 15–25M     | ~4.0 (voice-dependent)         | **0.008** (10s audio / 80ms)                               | <100MB | MIT ✓                     | YES (vits-piper)    |
| Supertonic-3                      | 66–99M     | ~3.8 (chưa công bố chính thức) | ~0.3                                                       | ~256MB | OpenRAIL-M ⚠ (cần review) | YES (int8)          |
| KittenTTS                         | 15–80M     | ~3.5, project non (08/2025)    | ~0.15–0.25 (ước)                                           | <50MB  | Apache-2.0 ✓              | YES (mới)           |
| MeloTTS / Matcha-TTS              | 250M+/150M | không có số en tin cậy         | không rõ / 0.39                                            | lớn    | MIT/Apache                | không xác nhận / có |

Loại: MeloTTS (không benchmark, không sherpa-onnx), Matcha (không tối ưu en),
F5-TTS/Orpheus/Chatterbox (GPU-class, quá nặng CPU).

**Góc "chung runtime" ĐƯỢC XÁC NHẬN**: cả 3 ứng viên top đều sherpa-onnx-native
→ 1 sidecar Python duy nhất phục vụ STT vi + STT en + TTS en (VieNeu vẫn riêng
cho TTS vi). Giảm hẳn maintenance so với thêm 1 sidecar mới.

## Trade-off trung tâm: Quality vs Latency

- **Kokoro-82M**: hay nhất (4.5 MOS ~ ngang cloud), nhưng RTF ~0.5 → câu 8s
  mất ~4s tổng hợp. Trong pipeline dịch giọng nói turn-based, TTS sẽ chiếm
  phần lớn thời gian chờ (STT 0.25s + translate ~1s + TTS 4s).
- **Piper lessac-high**: gần như tức thì (80ms/10s audio), quality ~4.0 —
  nghe tốt nhưng kém tự nhiên hơn Kokoro ở câu dài. Nhược: repo gốc archived
  10/2025 (fork OHF-Voice/piper1-gpl active); model cũ vẫn dùng tốt qua sherpa-onnx.
- Số RTF Kokoro đo trên EPYC 4-core — trên máy 8-core của đồ án chưa ai đo.
  Bài học từ STT: **số ước lượng từng sai 2 lần** (PhoWhisper fail, Zipformer
  nhanh hơn công bố) → đo thật rẻ và đáng.

## Approaches

### A. Benchmark-first Kokoro vs Piper (RECOMMENDED — lặp lại playbook STT)

- Extend harness sẵn có thành `benchmarks/tts/` (hoặc thêm mode TTS vào
  benchmarks/stt): đo RTF/latency/RAM khách quan + xuất WAV A/B để nghe thử
  chủ quan (bạn tự chấm, hoặc mini-MOS với vài người nghe — content thesis tốt)
- Pros: quyết định bằng số liệu trên đúng máy; thêm 1 chương benchmark thesis;
  pattern/metrics code tái dùng ~70%
- Cons: thêm ~nửa ngày trước khi chốt
- Risk: thấp

### B. Chốt Kokoro-82M luôn (quality-first)

- Pros: quality thesis-grade, license sạch, sherpa-onnx native; khỏi benchmark
- Cons: RTF 0.5 chưa kiểm chứng trên máy target; nếu ~4s/câu thì UX demo kém
  rõ rệt so với cloud hiện tại — rủi ro phải quay lại đổi model
- Risk: trung bình (latency)

### C. Chốt Piper luôn (latency-first)

- Pros: nhanh không đối thủ, MIT, nhẹ; UX demo mượt chắc chắn
- Cons: bỏ ~0.5 MOS quality mà không đo thử Kokoro trên máy mình; repo gốc
  archived (dùng qua sherpa-onnx nên ảnh hưởng thấp)
- Risk: thấp về kỹ thuật, trung bình về "điểm quality" thesis

## Recommendation

**Option A** — benchmark Kokoro vs Piper (+ Supertonic nếu license review OK)
trên harness mở rộng: đo RTF/RAM khách quan, xuất cùng bộ câu dịch mẫu ra WAV
để A/B listening. Nếu Kokoro trên 8-core đạt ≲2s/câu → chọn Kokoro (quality);
nếu không → Piper. Mọi lựa chọn đều cùng sherpa-onnx nên kiến trúc sidecar
không đổi theo kết quả.

## Success Metrics

- TTS en chạy offline, RTF + latency đo được trên máy target
- Bảng so sánh RTF/RAM/load + nhận xét chất lượng A/B ghi vào report thesis
- Model chốt tích hợp được vào sidecar sherpa-onnx chung với STT

## Next Steps

1. User chọn approach (A khuyến nghị)
2. Nếu A: plan mở rộng benchmark (TTS mode) → chạy → chốt model
3. Sau đó: plan tích hợp `services/local-stt` (đổi tên `local-speech`?) sidecar
   sherpa-onnx STT vi/en + TTS en + `LocalSttProvider`/`LocalTtsProvider`

## Unresolved Questions

- Kokoro RTF thực trên 8-core Windows? (số hiện có từ 4-core EPYC)
- Quality chấm thế nào cho thesis: tự nghe A/B hay mini-MOS nhiều người nghe?
- Sidecar hợp nhất: gộp luôn TTS en vào cùng sidecar STT hay tách? (đề xuất: gộp)
