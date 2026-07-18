# Brainstorm Report — Local CPU STT (vi + en) thay thế cloud

Date: 2026-07-18 | Status: research complete, pending approach decision
Requested by: user (đồ án tốt nghiệp — cần STT local để không phụ thuộc cloud)

## Problem Statement

STT hiện tại 100% cloud (ElevenLabs Scribe v2). Đồ án cần pipeline offline-capable:
vi→en cần STT tiếng Việt, en→vi cần STT tiếng Anh. TTS tiếng Việt đã local
(VieNeu sidecar, ONNX/CPU); STT là mảnh còn thiếu lớn nhất.

## Locked Requirements

- Hardware: Windows dev machine, CPU-only, 8 physical cores, ~32GB RAM
- Latency: ≤2s cho utterance 5–10s (RTF ≤ ~0.3), batch (turn-based, không cần streaming)
- 2 model chuyên biệt (vi riêng, en riêng) — registry đã route theo language
- Integration: ưu tiên pattern sidecar Python FastAPI + uv như `services/vieneu-tts`
- Contract: `SttProvider.transcribe(audio, mimeType, language)` — chỉ cần batch
- License: dùng được cho đồ án học thuật; ghi rõ nếu non-commercial

## Candidates — Vietnamese slot

| Model                                  | Params | WER (vi)                    | CPU RTF                                   | RAM    | License                  | Engine                                       |
| -------------------------------------- | ------ | --------------------------- | ----------------------------------------- | ------ | ------------------------ | -------------------------------------------- |
| Zipformer-30M-RNNT-6000h (hynt)        | 30M    | 7.97% VLSP2025-public       | **0.025** (đo thật: 12s audio / 0.3s)     | ~150MB | CC-BY-NC-ND ✗ commercial | sherpa-onnx                                  |
| PhoWhisper-small (VinAI)               | 244M   | 11.08% VIVOS                | ~0.15–0.3 (ước, chưa có benchmark 8-core) | ~600MB | BSD-3 ✓                  | faster-whisper INT8 (bản CT2 có sẵn trên HF) |
| PhoWhisper-base                        | 74M    | 16.19%                      | ~0.1–0.2 (ước)                            | ~300MB | BSD-3 ✓                  | faster-whisper                               |
| wav2vec2-base-vi-250h (nguyenvulebinh) | 95M    | 6.15% VIVOS (cần 4-gram LM) | 0.165                                     | ~250MB | CC-BY-NC ✗               | transformers/ONNX                            |
| Whisper-small multilingual (baseline)  | 244M   | kém hơn PhoWhisper          | ~0.78 → **fail ≤2s**                      | ~600MB | MIT ✓                    | faster-whisper                               |

Nguồn chính: VinAIResearch/PhoWhisper (ICLR 2024), HF hynt/Zipformer-30M-RNNT-6000h,
k2-fsa sherpa-onnx docs, HF nguyenvulebinh/wav2vec2-base-vietnamese-250h.

## Candidates — English slot

| Model                                 | Params  | WER (en)                                    | CPU RTF                                  | RAM         | License      | Engine                                                                    |
| ------------------------------------- | ------- | ------------------------------------------- | ---------------------------------------- | ----------- | ------------ | ------------------------------------------------------------------------- |
| Moonshine tiny/base (UsefulSensors)   | 27M/61M | ~7.8% avg (base ≈ ngang Whisper lớn hơn 5x) | ~0.07–0.27, latency <300ms               | ~200–800MB  | MIT ✓        | ONNX Runtime (`useful-moonshine-onnx`); sherpa-onnx cũng hỗ trợ Moonshine |
| whisper.cpp small.en Q4/Q5            | 244M    | 3.05% LibriSpeech clean                     | ~0.1–0.2 desktop (ngoại suy, cần verify) | ~150–400MB  | MIT ✓        | whisper.cpp (có Node binding: smart-whisper)                              |
| Zipformer-en transducer (sherpa-onnx) | ~273M   | ~8% (int8 ≈ fp32)                           | ~0.167                                   | ~270MB int8 | Apache-2.0 ✓ | sherpa-onnx                                                               |
| Parakeet TDT 0.6B                     | 600M    | top leaderboard                             | ~1.38 CPU → **fail**; không có vi        | —           | CC-BY-4.0    | NeMo/ONNX                                                                 |
| Vosk en                               | nhỏ     | 12–14% — kém                                | ~0.3                                     | thấp        | Apache-2.0   | vosk                                                                      |

Lưu ý researcher: số RTF của distil-whisper/faster-whisper trên CPU có mâu thuẫn giữa
các nguồn (0.78 vs 1.67 cho small) — mọi số RTF Whisper-family coi là ước lượng,
bắt buộc benchmark local trước khi chốt.

Multilingual single-model fallback: **không khả thi** — Whisper large-v3/turbo quá chậm
trên CPU, Parakeet v3 không hỗ trợ tiếng Việt, Moonshine chỉ en. Quyết định 2 model
chuyên biệt được research xác nhận đúng.

## Approaches

### A. Sherpa-onnx unified sidecar (1 engine, 2 model) — RECOMMENDED cho đồ án

- vi: Zipformer-30M-RNNT | en: Moonshine base (sherpa-onnx hỗ trợ) hoặc Zipformer-en
- Pros: RTF chắc chắn đạt với dư địa lớn (0.025 vi), WER vi tốt nhất bảng (7.97% VLSP2025),
  1 runtime duy nhất → 1 sidecar Python gọn, RAM tổng ~500MB, pattern y hệt VieNeu
- Cons: license vi model CC-BY-NC-ND (OK đồ án, cấm thương mại — phải ghi rõ trong thesis);
  cần verify Moonshine-trong-sherpa-onnx trên Windows
- Risk: thấp về perf, trung bình về license nếu sau này muốn thương mại hóa

### B. faster-whisper unified sidecar (license sạch 100%)

- vi: PhoWhisper-small CT2 INT8 | en: whisper small.en / distil-small.en INT8
- Pros: BSD/MIT toàn bộ — thương mại hóa được; PhoWhisper là paper ICLR 2024 dễ cite;
  1 engine duy nhất (faster-whisper)
- Cons: RTF chưa được chứng minh trên 8-core (ước 0.15–0.3, sát ngưỡng); WER vi kém hơn
  Zipformer (11% vs 8%); RAM ~1.2GB cho 2 model
- Risk: trung bình — có thể fail mục tiêu ≤2s, phải benchmark trước khi cam kết

### C. Best-of-breed mix (2 engine khác nhau)

- vi: Zipformer-30M (sherpa-onnx) | en: whisper.cpp small.en (WER 3.05% tốt nhất)
- Pros: accuracy tối đa mỗi ngôn ngữ
- Cons: 2 runtime khác nhau → 2 sidecar hoặc sidecar phức tạp; chi phí maintain cao;
  vi phạm KISS khi option A đã đủ tốt
- Risk: phức tạp không cần thiết → không khuyến nghị

## Recommendation

**Option A**, với twist "ăn điểm đồ án": benchmark chapter so sánh 3 trục —
cloud (ElevenLabs Scribe) vs Zipformer/Moonshine (A) vs PhoWhisper (B) — đo WER + RTF
thực tế trên cùng bộ audio test. Kết quả benchmark tự nó là contribution của thesis,
và nếu PhoWhisper bất ngờ đạt RTF thì có thể đổi sang B lấy license sạch mà không
đổi kiến trúc (cùng pattern sidecar, cùng `SttProvider` contract).

Architecture khi implement (phác thảo):

- `services/local-stt/` — Python FastAPI + uv sidecar, clone pattern vieneu-tts
  (`/healthz`, `/transcribe`, lock serialize inference, env `LOCAL_STT_*`)
- `packages/ai-providers` — thêm `LocalSttProvider` implement `SttProvider`,
  đăng ký vào registry route theo language, fallback cloud khi sidecar down (tùy chọn)

## Success Metrics

- STT vi + en chạy offline hoàn toàn, không API key
- RTF đo được ≤0.3 trên máy target (utterance 5–10s → ≤2s)
- WER đo được trên bộ test tự thu ghi lại trong thesis, so với cloud baseline
- Sidecar pass healthz + integration test như vieneu-tts

## Risks

- Số RTF Whisper-family là ước lượng → benchmark local trước khi chốt option B
- Moonshine qua sherpa-onnx trên Windows chưa tự verify → nếu kẹt, dùng
  `useful-moonshine-onnx` package riêng (vẫn 1 sidecar, 2 lib)
- Zipformer-30M license CC-BY-NC-ND: chỉ academic — ghi rõ trong thesis + README
- Audio input hiện là webm/opus từ browser → sidecar cần decode (ffmpeg) sang PCM 16k

## Measured Outcome (2026-07-18, post-benchmark)

Benchmark executed same day — see
`plans/reports/stt-cpu-benchmark-260718-results-report.md`. **Stack A won
decisively**: Zipformer-30M vi (WER 5.38%, RTF 0.017) + Moonshine base en
(WER 3.86%, RTF 0.040), one sherpa-onnx runtime. PhoWhisper-small INT8 failed
the RTF <= 0.3 target (0.332) and had worse WER than Zipformer — the license
trade-off (CC-BY-NC-ND, academic only) is accepted for the thesis.

## Decision (user, 2026-07-18)

**Benchmark-first cả A và B.** Plan tiếp theo chỉ scope benchmark harness đo
WER + RTF trên máy target — CHƯA implement vào app. Sau khi có số liệu thật
mới chốt model + plan integration (sidecar + provider).

Benchmark scope đã thống nhất:

- Stack A: Zipformer-30M-RNNT vi + Moonshine base en (sherpa-onnx)
- Stack B: PhoWhisper-small CT2 INT8 vi + whisper small.en INT8 (faster-whisper)
- Baseline: ElevenLabs Scribe v2 (cloud) trên cùng bộ audio test
- Metrics: WER (bộ test vi + en tự chuẩn bị), RTF/latency per-utterance, RAM peak
- Kết quả benchmark dùng làm chương so sánh trong thesis

## Next Steps

1. `/ck:plan` cho standalone STT benchmark harness (không đụng app code)
2. Chạy benchmark, ghi số liệu vào report
3. Chốt model theo số liệu → plan integration sidecar + `LocalSttProvider`
4. Sau STT: lặp lại quy trình research cho TTS tiếng Anh local (thay ElevenLabs TTS)

## Unresolved Questions

- PhoWhisper-small RTF thật trên 8-core Windows INT8? (chưa có số công bố)
- Zipformer-68M vi: WER delta vs 30M chưa công bố; nếu RTF vẫn <0.3 có thể ăn thêm accuracy
- Moonshine offline-batch latency scaling với utterance 10s (benchmark công bố là streaming)
- Advisor có chấp nhận model CC-BY-NC-ND trong đồ án không? (thường OK, nên confirm)
