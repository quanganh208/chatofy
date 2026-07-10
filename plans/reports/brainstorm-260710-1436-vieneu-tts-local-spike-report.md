# Brainstorm — VieNeu-TTS local spike (Vietnamese TTS)

- Date: 2026-07-10
- Scope: measurement spike (throwaway), dev box only
- Repo: chatofy monorepo (Turborepo + pnpm)

## Problem statement

Backend dùng ElevenLabs cho cả TTS + STT. User muốn thử VieNeu-TTS (Vietnamese TTS,
NeuTTS Air 0.5B) chạy local để cải thiện tốc độ. Priorities: chất lượng giọng Việt,
chi phí=0, offline/privacy, và (vẫn muốn) latency thấp hơn.

## Verified findings (scout)

- Provider abstraction sẵn: `TtsProvider` interface + `ai-providers.factory.ts` +
  registry + `quality-profile.ts`. Tích hợp provider mới = điểm cắm sạch.
- Backend Node/NestJS/TS; VieNeu-TTS là Python (ONNX/GGUF, `uv`). Local = Python sidecar.
- **[Mấu chốt] Pipeline hiện tại vi→en, TTS đọc TIẾNG ANH** (`pipeline-translator.service.ts:52-76`,
  `language: 'en'`). VieNeu là TTS tiếng Việt ⇒ chỉ hợp cho chiều output tiếng Việt (en→vi).
  User xác nhận: sẽ thêm chiều en→vi.

## Hardware verdict (đo trên máy)

| Thành phần | Giá trị               | Kết luận                                             |
| ---------- | --------------------- | ---------------------------------------------------- |
| GPU        | AMD Radeon RX 580 4GB | Vô dụng — không CUDA, ROCm không hỗ trợ trên Windows |
| CPU        | i7-11700K 8c/16t      | Chạy được CPU-only (GGUF Q4/Q8 qua ONNX)             |
| RAM        | 32 GB                 | Dư cho model 0.5B                                    |

Máy CHẠY ĐƯỢC nhưng **CPU-only**; GPU không tăng tốc.

## Brutal-honesty note (speed)

- NeuTTS Air 0.5B autoregressive, CPU "real-time" = RTF ≈ 1.0.
- ElevenLabs Flash v2.5 ~75ms model latency (cloud). Trên CPU máy này VieNeu **khả năng
  chậm hơn**, không nhanh hơn. Local thắng ở: cost, offline, privacy, giọng Việt tự nhiên —
  KHÔNG phải raw latency. Spike sẽ ra số chính xác.

## Recommended solution — Measurement Spike

1. Dựng VieNeu-TTS standalone bằng `uv` (thư mục spike riêng), CPU-only. Thử **GGUF Q4**
   (`pnnbao-ump/VieNeu-TTS-q4-gguf`) trước (nhanh nhất), fallback Q8/ONNX nếu chất lượng thiếu.
2. Benchmark ~10–15 câu tiếng Việt kiểu bản dịch en→vi: đo **RTF**, **first-audio latency**,
   **throughput tuần tự**; xuất .wav để so sánh chủ quan vs giọng Việt ElevenLabs.
3. **Decision gate:**
   - RTF ≤ ~0.7 + chất lượng ≥ ElevenLabs Việt ⇒ đáng tích hợp (vòng sau: `VieNeuTtsProvider` + sidecar).
   - RTF > 1 hoặc chất lượng thua ⇒ để lại, chờ server NVIDIA.

## Risks

- Windows: `llama-cpp-python` (GGUF) + phonemizer/eSpeak hay kẹt build ⇒ **fallback WSL2**.
  Đây là rủi ro setup lớn nhất, không phải rủi ro model.
- Kỳ vọng RTF thực tế ~0.6–1.2 trên CPU; thắng latency ElevenLabs là khó.

## Integration point (vòng sau, không làm trong spike)

`packages/ai-providers/src/providers/vieneu/vieneu-tts-provider.ts` implement `TtsProvider`,
gọi Python sidecar HTTP localhost; wire vào `ai-providers.factory.ts` + `quality-profile.ts`.

## Success criteria (spike)

- Có bảng số RTF + latency + throughput trên máy này.
- Có mẫu .wav để đánh giá chất lượng.
- Ra được quyết định go/no-go rõ ràng theo decision gate.

## Unresolved questions

- Chiều en→vi hiện đã tồn tại trong pipeline chưa? (scout chỉ thấy vi→en). Cần xác nhận khi
  sang tích hợp — spike không phụ thuộc điều này.
- Ngưỡng RTF/chất lượng "đạt" có cần user tinh chỉnh không (đang đề xuất RTF ≤ 0.7).
