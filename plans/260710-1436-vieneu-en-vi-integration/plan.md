---
title: VieNeu-TTS en-vi integration
description: ''
status: completed
priority: P2
branch: main
tags: []
blockedBy: []
blocks: []
created: '2026-07-10T08:26:47.916Z'
createdBy: 'ck:plan'
source: skill
---

# VieNeu-TTS en-vi integration

## Overview

Tích hợp VieNeu-TTS làm TTS tiếng Việt cho chiều dịch **en→vi** (batch, dev-first). VieNeu
chạy CPU-only qua Python sidecar (giữ model warm); NestJS route TTS theo ngôn ngữ output
(en→ElevenLabs như cũ, vi→VieNeu). Thêm `direction` vào API/pipeline; web test UI thêm toggle chiều.

Context brainstorm: `../reports/brainstorm-260710-1436-vieneu-en-vi-integration-report.md`
Spike verdict (GO): `../reports/from-spike-to-decision-260710-1436-vieneu-tts-verdict-report.md`

**Cách tiếp cận:** TDD — mỗi phase viết test trước, khoá regression chiều vi→en đang có.

**Quyết định đã chốt:** batch (không streaming); audio vi = wav 48kHz passthrough (mime
`audio/wav`); watermark perth bật; direction enum `'vi-en'|'en-vi'` (default vi-en); TTS route
theo output-lang; sidecar ở `services/vieneu-tts/` (uv, ngoài pnpm workspace); dev-first.

**Out of scope:** streaming/WS gateway, đóng gói production, UI mobile, encode mp3 cho vi.

## Phases

| Phase | Name                                                                     | Status    |
| ----- | ------------------------------------------------------------------------ | --------- |
| 1     | [Python sidecar](./phase-01-python-sidecar.md)                           | Completed |
| 2     | [VieNeu TTS provider and env](./phase-02-vieneu-tts-provider-and-env.md) | Completed |
| 3     | [Direction and TTS routing](./phase-03-direction-and-tts-routing.md)     | Completed |
| 4     | [Web toggle e2e and docs](./phase-04-web-toggle-e2e-and-docs.md)         | Completed |

## Dependencies

<!-- Cross-plan dependencies -->

## Validation Log

### Session 1 (2026-07-10)

Verification (Standard tier, 4 phases) — **Failed: 0**:

- Đã xác nhận tồn tại: `env.schema.ts`, 3 spec (pipeline/factory/quality-and-elevenlabs).
- Web UI page thực tế: `apps/web/app/translate/page.tsx` (đã phát audio theo `res.audioMimeType`
  ⇒ wav 48kHz play sẵn; title/label đang hardcode "Vietnamese → English"). Root dev = `turbo run dev`,
  KHÔNG có `concurrently`.

Quyết định (user):

1. **Dev runner:** thêm `concurrently` + script root `dev:all` spawn sidecar + `turbo dev`.
2. **STT en:** verify khi impl, giữ `scribe_v2` (đa ngôn ngữ); không thêm cấu hình STT theo chiều.
3. **Voice VieNeu:** **thêm picker 14 giọng trên web UI** ⇒ cần truyền `voice` xuyên suốt
   UI → request schema → pipeline → VieNeuTtsProvider → sidecar. Danh sách 14 tên hardcode
   trong FE constant (KISS; sidecar có thể expose `/voices` sau).
4. **Sidecar concurrency:** chạy infer trong threadpool, serialize khi nhiều request (dev 1 user);
   ghi rõ giới hạn.

Propagation: Phase 1 (threadpool), Phase 3 (thêm `voice?` vào request schema + pipeline truyền
voice cho tts), Phase 4 (dev:all script + voice picker + path `apps/web/app/translate/page.tsx`).

### Whole-Plan Consistency Sweep — clean

Không còn tham chiếu cũ (docker-compose/UI mơ hồ); `voice` nhất quán xuyên phase 2/3/4;
đường dẫn web page đã sửa đúng. Không mâu thuẫn tồn đọng ⇒ eligible để cook.
