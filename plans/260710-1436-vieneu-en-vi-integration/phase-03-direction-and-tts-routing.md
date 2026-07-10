---
phase: 3
title: Direction and TTS routing
status: completed
priority: P1
dependencies:
  - 2
---

# Phase 3: Direction and TTS routing

## Overview

Thêm `direction` vào API/pipeline và route TTS theo ngôn ngữ output (en→ElevenLabs,
vi→VieNeu). Đây là phần wiring lõi. TDD để khoá regression chiều vi→en đang có test.

## Outcome (DONE)

- **Tái dùng enum canonical** `translationDirectionSchema` từ `domain/transcript.ts`
  (giá trị **`vi_to_en`/`en_to_vi`**, KHÔNG phải `vi-en`/`en-vi`) — tránh trùng tên + DRY.
  Thêm helper `directionLanguages()` + `voice?` vào `translateRequestSchema`; `direction` để
  `.optional()` (server default `vi_to_en`) nên web cũ không vỡ.
- `translate.controller.ts` truyền direction+voice; `pipeline-translator.service.ts` suy
  source/target, mime theo target (vi→audio/wav, en→audio/mpeg), truyền voice cho tts.
- `ai-providers.factory.ts`: `makeProviders(profile, targetLang='en')` route TTS
  (vi→VieNeu đọc `VIENEU_TTS_URL/VOICE`, en→ElevenLabs); targetLang trong cache key.
- Kết quả: types build OK; **api tests 30/30 pass** (regression vi→en giữ + en_to_vi mới);
  typecheck api + web **0 lỗi**.
- **⚠ Cho Phase 4:** web gửi `direction: 'en_to_vi'` (giá trị canonical, không phải `en-vi`).

## Requirements

- Functional: `POST /translate` nhận `direction: 'vi-en' | 'en-vi'` (default `vi-en`).
  vi-en giữ nguyên (STT vi → translate vi→en → ElevenLabs en). en-vi: STT en →
  translate en→vi → VieNeu (audio/wav). Response `audioMimeType` phản ánh đúng (mpeg vs wav).
- Non-functional: không phá contract vi-en hiện tại; factory cache không serve nhầm provider
  giữa 2 chiều.

## Architecture

- **Schema** (`translate.ts`): thêm `direction` enum default `vi-en`; helper suy
  `{ sourceLang, targetLang }` từ direction. **Thêm `voice?: string` (optional)** để UI chọn
  giọng VieNeu (Validation S1). vi-en bỏ qua voice (ElevenLabs dùng env voice riêng).
- **Pipeline** (`pipeline-translator.service.ts`): dùng sourceLang/targetLang thay hardcode;
  chọn `OUTPUT_MIME` theo targetLang (vi→audio/wav, en→audio/mpeg); **truyền `voice` xuống
  `tts.synthesize({..., voice})`** (TtsSynthesizeRequest.voice đã có sẵn).

<!-- Updated: Validation Session 1 - thêm voice? xuyên suốt cho picker giọng VieNeu -->

STT en: **giữ `scribe_v2`**, verify nhận 'en' khi impl (Validation S1) — không thêm STT model theo chiều.

- **Factory** (`ai-providers.factory.ts`): chọn TTS provider theo targetLang —
  en→`ElevenLabsTtsProvider`, vi→`VieNeuTtsProvider` (đọc `VIENEU_TTS_URL`/`VIENEU_TTS_VOICE`).
  **Thêm targetLang vào cache key** để không tái dùng trio sai chiều. STT model + translate
  giữ nguyên resolver.
- STT: xác nhận `scribe_v2` nhận `language_code='en'` (verify khi impl; scribe đa ngôn ngữ).

## Related Code Files

- Modify: `packages/types/src/http/translate.ts` (direction enum + helper + `voice?`)
- Modify: `apps/api/src/modules/translate/dto/translate.dto.ts` (kế thừa schema — tự động)
- Modify: `apps/api/src/modules/translate/translate.controller.ts` (truyền direction)
- Modify: `apps/api/src/modules/translate/services/pipeline-translator.service.ts`
- Modify: `apps/api/src/modules/translate/providers/ai-providers.factory.ts`
- Modify specs: `pipeline-translator.service.spec.ts`, `ai-providers.factory.spec.ts`,
  `quality-and-elevenlabs.spec.ts`

## Implementation Steps

1. (Test-first) Cập nhật/không đổi test vi-en (khẳng định regression). Thêm test:
   - factory: targetLang='vi' ⇒ tts là VieNeuTtsProvider; 'en' ⇒ ElevenLabs; cache key phân biệt.
   - pipeline: direction='en-vi' ⇒ gọi STT 'en', translate en→vi, tts vi, mime audio/wav
     (mock providers). direction default vi-en giữ nguyên.
2. Thêm `direction` vào schema + helper suy source/target.
3. Sửa controller truyền direction; sửa pipeline dùng source/target + mime theo target.
4. Sửa factory: build TTS theo targetLang + thêm vào cache key + đọc env VieNeu.
5. `pnpm --filter @chatofy/api test` + `@chatofy/types` build + `typecheck` xanh.

## Success Criteria

- [ ] Test vi-en cũ vẫn xanh (không regression).
- [ ] Test mới: en-vi route sang VieNeu, mime audio/wav; factory chọn đúng provider theo targetLang.
- [ ] Cache key gồm targetLang — không serve nhầm trio.
- [ ] typecheck + build types xanh.

## Risk Assessment

- Nếu `scribe_v2` không nhận 'en' như kỳ vọng → verify sớm ở bước 3; fallback cấu hình STT model
  khác cho en (ít khả năng — scribe đa ngôn ngữ).
- Factory cache: quên targetLang trong key = bug serve nhầm giọng. Test bước 1 chặn việc này.
- Response mime đổi theo chiều → client phải tôn trọng `audioMimeType` (Phase 4 xử lý UI).
