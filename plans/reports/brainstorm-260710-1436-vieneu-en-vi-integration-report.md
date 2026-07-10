# Brainstorm — VieNeu-TTS en→vi integration

- Date: 2026-07-10
- Scope: backend infra + web test UI; batch; dev-first
- Predecessor: spike verdict GO (`from-spike-to-decision-260710-1436-vieneu-tts-verdict-report.md`)

## Problem statement

Tích hợp VieNeu-TTS làm TTS tiếng Việt cho chiều dịch **en→vi**. Pipeline hiện chỉ vi→en
(TTS đọc tiếng Anh). VieNeu chạy CPU-only qua Python sidecar; route TTS theo ngôn ngữ output.

## Scout findings (verified)

- Interfaces provider ĐÃ direction-agnostic: `stt.transcribe(audio,mime,language)`,
  `translation.translate({sourceLanguage,targetLanguage})`, `tts.synthesize({language})`.
- Hardcode vi→en chỉ ở 3 chỗ: `translateRequestSchema` (packages/types/.../translate.ts),
  `translate.controller.ts`, `pipeline-translator.service.ts`.
- `ai-providers.factory.ts` ép `tts='elevenlabs'`, cache trio theo model-tier key.
- Request schema chỉ có audioBase64/audioMimeType/quality — không có direction.
- WS gateway là stub NotImplemented; pipeline thật là batch (POST /translate → full audio).
- Web test UI tối giản: `api-client.ts` + `use-audio-recorder.ts` + slider.

## Decisions (user-approved)

- Scope: backend + web test UI. Batch. Dev-first (chưa đóng gói production).
- TTS routing: **out=en → ElevenLabs, out=vi → VieNeu** (theo ngôn ngữ output).
- Audio vi: **wav 48kHz passthrough** (mime audio/wav); mp3 để sau.
- Watermark perth: giữ bật. Direction: enum `'vi-en' | 'en-vi'` (default vi-en).
- Sidecar đặt `services/vieneu-tts/` (uv, ngoài pnpm workspace).

## Chosen architecture

```
[Web UI] POST /translate {audio, quality, direction}
  → NestJS pipeline: STT(in) → translate(in→out) → TTS route by out-lang
      out=en → ElevenLabsTtsProvider
      out=vi → VieNeuTtsProvider --HTTP--> [FastAPI sidecar + vieneu, model warm, threads=8]
```

Rejected alternatives: reimplement ONNX in Node (phonemizer/tokenizer/watermark toàn Python,
quá lớn); subprocess mỗi request (cold-start 7.5s giết latency). Sidecar giữ model warm.

## Change set

Backend:

1. `packages/types/src/http/translate.ts`: thêm `direction` enum vào request schema.
2. `translate.controller.ts`: truyền direction xuống pipeline.
3. `pipeline-translator.service.ts`: suy (source,target) từ direction, bỏ hardcode.
4. `ai-providers.factory.ts`: route TTS theo output-lang; thêm target-lang vào cache key.
5. `packages/ai-providers/src/providers/vieneu/vieneu-tts-provider.ts`: mới, gọi sidecar HTTP.
6. `env.schema.ts` + `.env.example`: `VIENEU_TTS_URL`, `VIENEU_TTS_VOICE`.

Sidecar (mới): 7. `services/vieneu-tts/`: FastAPI+uvicorn, load model startup, `POST /synthesize`→wav, `/healthz`.

Frontend: 8. `apps/web`: toggle chiều + gửi `direction` trong body translate().

Tests: cập nhật pipeline/factory/e2e specs cho direction + VieNeu routing.

## Risks

- Python trong monorepo JS = ops smell; cô lập `services/`.
- Contributor cần `uv` + tải model lần đầu → doc dev.
- Factory cache: phải thêm target-lang/tts-provider vào key (tránh serve nhầm trio).

## Success criteria

- POST /translate direction=en-vi → audio tiếng Việt từ VieNeu sidecar.
- direction=vi-en → không đổi (ElevenLabs).
- Web test UI đổi được chiều.
- Sidecar chạy local dev; STT tiếng Anh + translate en→vi hoạt động.

## Out of scope (round này)

Streaming (WS gateway), đóng gói production, UI mobile, encode mp3 cho vi.

## Unresolved questions

- Sidecar dev runner: script spawn kèm `pnpm dev` hay docker-compose? (đề xuất script trước, để plan chốt).
- STT tiếng Anh: scribe_v2 xác nhận nhận 'en' (rất khả năng có — verify khi plan/impl).
- Default preset voice VieNeu ('Phạm Tuyên' đề xuất) — user chưa chốt cứng.
