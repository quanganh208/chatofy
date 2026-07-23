# Brainstorm — tích hợp provider STT/TTS local vào pipeline

Đầu vào: model đã benchmark xong, cần đưa vào app. Toàn bộ chạy trên máy dev này.
Evidence: `plans/reports/stt-cpu-benchmark-260718-results-report.md`,
`plans/reports/tts-en-cpu-benchmark-260718-results-report.md`.
Handoff kế tiếp: plan skill → `/ak:cook`.

## Contract

**Outcome:** với `AI_STT_PROVIDER=local` + `AI_TTS_PROVIDER=local` (default mới),
`POST /translate` chạy cả 2 chiều vi↔en mà không gọi ElevenLabs — không cần
`ELEVENLABS_API_KEY`. STT vi/en + TTS en qua sherpa-onnx; TTS vi giữ VieNeu.

**Constraints:**

- Giữ nguyên contract `SttProvider`/`TtsProvider` và REST `/translate` — client không đổi.
- Máy đích: Windows, 8 physical / 16 logical cores, 32 GB RAM, CPU-only.
- Bắt buộc preload `onnxruntime.dll` từ venv trước khi sherpa-onnx chạy native —
  ORT 1.17.1 trong System32 gây abort cứng (không phải exception).
  Nguồn: `benchmarks/stt/stt_bench/engines/base.py:preload_onnxruntime_dll`.
- Zipformer-30M vi là CC-BY-NC-ND-4.0 → chỉ dùng học thuật; ghi rõ trong README +
  luận văn. Moonshine MIT, Kokoro Apache-2.0 (sạch).
- Engine là tài nguyên blocking dùng chung → serialize bằng lock
  (mẫu `services/vieneu-tts/app.py`).
- Sidecar là uv project độc lập, không nằm trong pnpm/turbo workspace.

**Non-goals:**

- Dịch máy local — Gemini vẫn cloud ⇒ **hệ thống chưa offline hoàn toàn** sau đợt này.
- Streaming STT (`startStream` giữ optional, không implement).
- Ghi âm trên mobile (chưa có code ghi âm trong `apps/mobile`).
- Toggle local/cloud trên UI — chọn bằng env.
- Đổi thang quality slider — local bỏ qua model tier, `resolveQualityProfile` giữ nguyên.
- Gộp VieNeu vào sidecar mới.
- Xoá provider ElevenLabs — giữ để so sánh cloud↔local cho luận văn.
- Sửa `/health` của API để probe sidecar.
- Harness benchmark mới.

**Acceptance:**

1. `/translate` vi→en và en→vi chạy được với `ELEVENLABS_API_KEY` rỗng.
2. Đo latency end-to-end thật (gồm overhead HTTP + PyAV), ghi số vào report bàn giao.
3. Unit spec cho 2 provider mới theo mẫu `vieneu-tts-provider.spec.ts`;
   `pnpm typecheck && pnpm lint && pnpm knip` sạch.
4. Cả 2 sidecar có `/healthz`; `pnpm dev:all` khởi động đủ 5 process.
5. README + `docs/system-architecture.md` + `docs/codebase-summary.md` cập nhật,
   có mục nghĩa vụ license.

## Quyết định đã chốt

Chốt bởi user (2026-07-23):

| Vấn đề        | Chốt                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Topology      | 2 sidecar tách hẳn: `services/local-stt` (8002) + `services/local-tts` (8003). VieNeu giữ 8001. |
| Decode audio  | Server-side bằng PyAV trong `local-stt` — client giữ nguyên 100%.                               |
| Chọn provider | Chỉ qua env; đổi default trong `env.schema.ts` thành `local`.                                   |

Chốt tự quyết (user uỷ quyền, cùng ngày):

| #   | Quyết định                                                                                                                                                                          | Lý do                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Load model **eager** lúc startup; `/healthz` trả 503 `loading` cho tới khi sẵn sàng                                                                                                 | 1.3 GB / 32 GB là không đáng kể; tránh vách latency ở request đầu; đúng mẫu VieNeu                                                                                                          |
| D2  | Sidecar chỉ nhận `vi`/`en`, còn lại **400**                                                                                                                                         | `languageCodeSchema = z.enum(['vi','en'])` đã khoá ở tầng contract — validate ở sidecar là phòng vệ tầng sâu, không phải giới hạn tuỳ tiện                                                  |
| D3  | Đo latency end-to-end **một lần** lúc nghiệm thu, **không** dựng harness mới                                                                                                        | Harness benchmark là measurement-only, README nói rõ "never imported by the app" — không kéo vào runtime                                                                                    |
| D4  | `LOCAL_STT_THREADS` / `LOCAL_TTS_THREADS` mặc định **8**; set `OMP_NUM_THREADS`+`MKL_NUM_THREADS` **trước** khi import engine                                                       | 8 (physical) thắng 16 (hyperthread) theo spike đã ghi trong `vieneu-tts/app.py`; pipeline turn-based chạy STT→TTS tuần tự nên không tranh core                                              |
| D5  | `local-stt`: `POST /transcribe` **multipart** (`file` + `language`) → `{text, language}`. `local-tts`: `POST /synthesize` **JSON** `{text, language, voice?, speed?}` → `audio/wav` | Multipart khiến `LocalSpeechSttProvider` gần như bản sao của `ElevenLabsSttProvider` (cùng pattern FormData) — nhất quán call-site; TTS JSON khớp y hệt VieNeu. Thêm dep `python-multipart` |
| D6  | `audio/decode.py` resample **tường minh** về 16 kHz mono float32; không dựa vào sherpa tự resample. Bytes rỗng/không giải mã được → 400                                             | Mic web là 48 kHz, model train ở 16 kHz — không để hành vi resample ngầm quyết định chất lượng                                                                                              |
| D7  | Mỗi sidecar tự có `models/` + `scripts/download_models.py` (port từ benchmark), **không** trỏ vào `benchmarks/*/models/`                                                            | Giữ ranh giới harness↔app. HF cache dùng lại cho Zipformer; tarball moonshine/kokoro tải một lần ~500 MB; uv hardlink nên 3 venv gần như không tốn thêm disk                                |
| D8  | `LOCAL_TTS_VOICE_ID` default `0` (sid af — đúng bản đã benchmark), `LOCAL_TTS_SPEED` `1.0`. `voice` không parse được thành sid hợp lệ → **fallback default**, không lỗi             | Web chỉ gửi `voice` khi `en_to_vi` (`use-translate-turn.ts:81`) nên local-tts thực tế không nhận voice; nhưng API là public nên vẫn phải chịu được input lạ                                 |
| D9  | `pnpm dev:all` chạy 5 process; README đổi `dev:all` thành lệnh thường dùng                                                                                                          | Default đã là local ⇒ `pnpm dev` đơn thuần không còn đủ cho `/translate`                                                                                                                    |

Đánh đổi đã chấp nhận: 3 sidecar khi dev; lặp ~30 dòng helper (preload DLL, threads,
tải model) giữa 2 service. **Không** tạo package Python chung — YAGNI, mỗi service tự chứa.

## Cấu trúc mục tiêu

```
services/local-stt/                 # port 8002, sherpa-onnx
├── app.py                          # wiring FastAPI: /healthz, POST /transcribe
├── engines/
│   ├── registry.py                 # lang -> engine, load 1 lần lúc startup
│   ├── zipformer_vi.py             # STT vi
│   └── moonshine_en.py             # STT en
├── audio/decode.py                 # PyAV: mọi container -> 16k mono float32
├── scripts/download_models.py
└── models/                         # gitignored

services/local-tts/                 # port 8003, sherpa-onnx
├── app.py                          # /healthz, POST /synthesize
├── engines/kokoro_en.py            # TTS en
├── scripts/download_models.py
└── models/                         # gitignored

packages/ai-providers/src/providers/local-speech/
├── local-speech-stt-provider.ts    # name 'local', route vi|en qua tham số language
└── local-speech-tts-provider.ts    # name 'local', en
```

Engine module bám chuẩn có sẵn của repo (`benchmarks/stt/stt_bench/engines/*`:
1 engine 1 file, `load`/`transcribe`/`decode_params` tách bạch) — code load model
port thẳng từ harness đã đo, không viết lại.

## Điểm tích hợp phía API (nhỏ hơn dự kiến)

`AiProvidersFactory` đã route TTS theo `targetLang` (`ai-providers.factory.ts:57`):
`targetLang === 'vi' ? 'vieneu' : ttsName`. Chỉ cần đăng ký provider tên `local` là
`AI_TTS_PROVIDER=local` tự động cho en→Kokoro, vi vẫn VieNeu. **Không sửa logic
routing, không sửa `pipeline-translator.service.ts`.**

Việc phải làm:

- `register-default-providers.ts`: 2 `register()` + 2 field vào `AiProviderResolveConfig`.
- `env.schema.ts`: thêm `LOCAL_STT_URL` (`http://localhost:8002`),
  `LOCAL_TTS_URL` (`http://localhost:8003`), `LOCAL_TTS_VOICE_ID` (`0`);
  đổi default `AI_STT_PROVIDER`/`AI_TTS_PROVIDER` → `local`.
- `ai-providers.factory.ts`: đọc env mới vào `resolveConfig`.
- `index.ts` barrel export; **xoá 2 thư mục rỗng** `providers/local-whisper`,
  `providers/local-tts`.
- `.gitignore`: thêm `models/` (hiện chưa có; `__pycache__` đã có ở dòng 63).
- `package.json`: `dev:all` thêm 2 sidecar.
- `apps/api/.env.example`.

## Rủi ro

| Rủi ro                                                                                                          | Xử lý                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **PyAV wheel trên Windows/py3.11 chưa verify**                                                                  | Spike ở bước đầu tiên của plan, fail sớm. Fallback: gọi ffmpeg subprocess (thêm dep hệ thống). |
| Default `local` đổi lỗi từ `ProviderConfigError` (thiếu key) sang `ProviderConnectionError` (sidecar chưa chạy) | Đã map sẵn ở `handlePipelineError` → 503. Thêm spec cho nhánh này.                             |
| Spec hiện tại vỡ                                                                                                | Không — `ai-providers.factory.spec.ts:24-25` truyền env tường minh, không dựa default.         |
| Lock serialize → user thứ 2 chờ                                                                                 | Chấp nhận: chờ thêm ~0.35s (STT) / ~1.2s (TTS). Đủ cho demo 1–2 người.                         |
| RAM/cold start                                                                                                  | STT ~640 MB, TTS ~620 MB, load < 2.5s — thoải mái trên 32 GB.                                  |
| Jest api có thể hỏng do dual-jest hoisted-linker                                                                | Đã biết; nếu gặp thì báo, không sửa lan man.                                                   |

## Câu hỏi chưa giải quyết

Không còn câu hỏi nào cần user quyết. Rủi ro duy nhất phải kiểm chứng bằng code
là PyAV trên Windows (bảng trên) — xử lý ngay bước 1 của plan.
