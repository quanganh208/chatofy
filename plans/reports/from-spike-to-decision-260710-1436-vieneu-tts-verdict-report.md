# VieNeu-TTS spike — verdict: GO

- Date: 2026-07-10
- Scope: measurement spike, dev box only (i7-11700K, 32GB, AMD RX 580 no-CUDA, Win11)
- Spike dir: `plans/260710-1436-vieneu-tts-local-spike/spike/`
- Raw data: `spike/results.md`

## Verdict: GO (đáng tích hợp làm TTS chiều en→vi)

Cả hai tiêu chí gate đạt:

- **Tốc độ:** RTF median 0.511 (≤ 0.7), p90 0.569, max 0.625; first-audio ~0.30s (streaming).
- **Chất lượng:** user chấp nhận sau A/B (VieNeu ≥ ElevenLabs cho giọng Việt).

## Measured data

**VieNeu v3 Turbo ONNX (CPU, torch-free), 8 threads tối ưu:**

| Metric                       | Value                         |
| ---------------------------- | ----------------------------- |
| RTF min/median/p90/max       | 0.491 / 0.511 / 0.569 / 0.625 |
| First-audio latency (stream) | ~0.30s                        |
| Cold-start load (cached)     | 7.5s                          |
| Throughput                   | 42s audio / 22s gen           |

**ElevenLabs (đối chứng, đo được):**

| Model           | Round-trip | Ghi chú                                            |
| --------------- | ---------- | -------------------------------------------------- |
| flash_v2_5 + vi | 0.35–0.65s | ép vi OK; tier nhanh                               |
| v3 + vi         | 1.5–2.6s   | biểu cảm nhất                                      |
| multilingual_v2 | 1.0–2.7s   | KHÔNG nhận language_code → SAI tiếng với text Việt |

## Key findings

- Máy chạy VieNeu **native Windows, CPU-only, KHÔNG cần WSL/GGUF/build tools**. Bản mặc định
  v3 Turbo là ONNX torch-free (`pip install vieneu` là đủ). GPU AMD không dùng.
- Giả định ban đầu "CPU không thắng ElevenLabs về tốc độ" **bị dữ liệu bác bỏ**: với streaming,
  VieNeu ra tiếng ~0.30s, cạnh tranh cả ElevenLabs flash và nhanh hơn REST batch backend đang dùng.
- ElevenLabs `multilingual_v2` (tier "quality" trong `quality-profile.ts`) **không ép được
  tiếng Việt** → gen nhầm tiếng với text Việt. Nếu làm en→vi bằng ElevenLabs phải dùng
  flash/turbo v2.5 (có language_code) hoặc v3, và cần voice Việt bản xứ.
- 8 threads (= nhân vật lý) tối ưu hơn 16 (hyperthreading thêm overhead).

## Integration sketch (vòng sau — CHƯA làm)

**Bối cảnh quan trọng:** pipeline hiện tại là **vi→en, TTS đọc tiếng Anh**
(`pipeline-translator.service.ts`). VieNeu chỉ hợp cho **output tiếng Việt** ⇒ cần chiều
**en→vi** (STT tiếng Anh → dịch en→vi → TTS Việt). Chiều này **chưa tồn tại** trong code —
đây là scope lớn hơn "thêm 1 provider".

Thành phần khi tích hợp:

1. **Python sidecar** (FastAPI/uvicorn) wrap `vieneu`, giữ model load sẵn (tránh cold-start
   7.5s mỗi request), endpoint streaming dùng `infer_stream` cho first-audio thấp; ORT
   intra-op threads = 8.
2. **`VieNeuTtsProvider`** trong `packages/ai-providers/src/providers/vieneu/`, implement
   `TtsProvider` (đã có `synthesize` + optional `synthesizeStream`), gọi sidecar HTTP localhost.
3. Wire vào `ai-providers.factory.ts` + chọn provider theo ngôn ngữ output ở
   `quality-profile.ts` (hiện chỉ map model ElevenLabs).
4. Xử lý: 48kHz output vs mp3 44.1k backend; watermark `perth` bật mặc định (cân nhắc tắt);
   chọn 1 trong 14 preset voice làm mặc định.

**Ops:** thêm runtime Python cạnh Node — cần cho vào dev setup + deploy. Production target
chưa chốt (spike này chỉ dev box). Nếu production CPU-only, RTF 0.51 vẫn ổn; sidecar phải
co-locate với API.

## Next step đề xuất

Chiều en→vi + tích hợp sidecar là **vòng brainstorm/plan mới** (scope lớn hơn spike). Nên
mở `/ck:brainstorm` cho "en→vi bidirectional + VieNeu TTS integration" trước khi plan.

## Unresolved questions

- Chiều en→vi: xây khi nào, ai quyết? (STT tiếng Anh + translate en→vi chưa có trong code.)
- Production deployment target (hiện "dev box only") — CPU hay có GPU? Ảnh hưởng kiến trúc sidecar.
- Chấp nhận thêm runtime Python vào stack Node không?
- Preset voice mặc định (chưa chọn trong 14 giọng).
- Bỏ qua A/B với voice Việt bản xứ ElevenLabs — user chấp nhận VieNeu mà không cần bước này.
