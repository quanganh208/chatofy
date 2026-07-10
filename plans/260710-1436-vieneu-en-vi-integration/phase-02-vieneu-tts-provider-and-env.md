---
phase: 2
title: VieNeu TTS provider and env
status: completed
priority: P1
dependencies:
  - 1
---

# Phase 2: VieNeu TTS provider and env

## Overview

Viết `VieNeuTtsProvider` (TS) implement `TtsProvider`, gọi sidecar Phase 1 qua HTTP. Thêm
env config cho URL + voice. Unit test với sidecar mock (không cần model thật).

## Outcome (DONE)

- `packages/ai-providers/src/providers/vieneu/vieneu-tts-provider.ts` + export ở `index.ts`.
- `env.schema.ts`: `VIENEU_TTS_URL` (url, default `http://localhost:8001`), `VIENEU_TTS_VOICE`
  (default `Phạm Tuyên`); `apps/api/.env.example` cập nhật.
- Spec đặt ở **`apps/api/.../vieneu-tts-provider.spec.ts`** (không phải packages/ai-providers —
  package đó không có test runner; jest ở apps/api, khớp pattern gemini/elevenlabs spec).
- Kết quả: ai-providers build OK; spec **5/5 pass** (config error, wav bytes, voice override,
  non-ok→ConnectionError, fetch throw→ConnectionError); typecheck api **0 lỗi**.

## Requirements

- Functional: `synthesize({text, language, audioFormat, voice?})` → `Uint8Array` wav bytes
  bằng cách POST sidecar `/synthesize`. Lỗi mạng/HTTP → `ProviderConnectionError`;
  thiếu URL config → `ProviderConfigError` (khớp pattern ElevenLabs provider).
- Non-functional: dùng global `fetch` (không SDK), theo đúng style provider hiện có.

## Architecture

- Constructor nhận `{ baseUrl, voice }`. `baseUrl` bắt buộc (throw ProviderConfigError nếu thiếu).
- `synthesize`: POST `${baseUrl}/synthesize` body `{text, voice: req.voice ?? this.voice}`,
  đọc `arrayBuffer()` → `Uint8Array`. Map lỗi giống `elevenlabs-tts-provider.ts`.
- Export từ `packages/ai-providers/src/index.ts` (provider + config type).
- Env: `VIENEU_TTS_URL` (default `http://localhost:8001`), `VIENEU_TTS_VOICE` (default `Phạm Tuyên`).

## Related Code Files

- Create: `packages/ai-providers/src/providers/vieneu/vieneu-tts-provider.ts`
- Create: `packages/ai-providers/src/providers/vieneu/vieneu-tts-provider.spec.ts`
- Modify: `packages/ai-providers/src/index.ts` (export provider + type)
- Modify: `apps/api/src/config/env.schema.ts` (thêm VIENEU_TTS_URL, VIENEU_TTS_VOICE)
- Modify: `apps/api/.env.example` + root `.env.example` (ghi 2 biến mới)

## Implementation Steps

1. (Test-first) `vieneu-tts-provider.spec.ts`: mock global `fetch` →
   (a) trả wav bytes ⇒ `synthesize` trả đúng Uint8Array;
   (b) `res.ok=false` ⇒ `ProviderConnectionError`;
   (c) fetch throw ⇒ `ProviderConnectionError`;
   (d) thiếu baseUrl ⇒ constructor throw `ProviderConfigError`.
2. Viết `vieneu-tts-provider.ts` theo interface `TtsProvider` (`name='vieneu'`).
3. Export ở `index.ts`.
4. Thêm 2 biến env vào `env.schema.ts` (zod, có default) + `.env.example`.
5. `pnpm --filter @chatofy/ai-providers test` + `typecheck` xanh.

## Success Criteria

- [ ] Unit test provider xanh (4 case trên), không cần sidecar thật.
- [ ] `typecheck` toàn workspace xanh.
- [ ] Env schema nhận 2 biến mới với default hợp lý; app vẫn boot khi không set.

## Risk Assessment

- Kích thước wav lớn (48kHz) → chấp nhận trong batch; không stream ở phase này.
- Đảm bảo `TtsSynthesizeRequest.voice` override đúng như ElevenLabs provider (đồng nhất contract).
