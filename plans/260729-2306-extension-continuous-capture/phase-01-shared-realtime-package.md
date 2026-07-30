---
phase: 1
title: 'Shared realtime package'
status: pending
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: Shared realtime package

## Overview

Chuyển lõi audio/transport từ `apps/web/src` sang một package dùng chung, để
extension import được. Không đổi một dòng hành vi nào.

## Requirements

- Functional: `apps/web` chạy y nguyên sau khi chuyển.
- Non-functional: package không phụ thuộc DOM ngoài Web Audio; không phụ thuộc
  React, Next, `chrome.*`.
- `pnpm test`, `pnpm knip`, `pnpm build` đều xanh **sau** phase, không chỉ trước.

## Architecture

Tại sao phải tách chứ không copy: hai bản sao của chính sách turn-taking sẽ
trôi lệch. Repo đã có tiền lệ được ghi lại — `SpeechGate.push()` trả về
`isSpeech` chính là để `CapturePump` không tự suy lại ngưỡng, vì "two copies of
the threshold would drift" (`speech-gate.ts:91-94`).

Package mới `@chatofy/realtime-client`, theo khuôn `@chatofy/types`
(`type: module`, build bằng `tsup`, `exports` có subpath).

```
packages/realtime-client/
├── src/
│   ├── audio/          # speech-gate, capture-pump, pcm-resampler, pcm-playback-queue
│   ├── conversation/   # conversation-session, conversation-status, fake-audio-context
│   ├── transport/      # translate-socket
│   └── index.ts
├── worklets/mic-capture-processor.js
├── package.json
├── tsup.config.ts
└── vitest.config.ts
```

**`conversation-state.ts` KHÔNG chuyển đi.** Nó giữ đúng một `liveText` và một
`liveTranslation` cho cả hội thoại, và xoá cả hai ở `server.transcript.final` và
`server.session.ended` bất kể sự kiện thuộc lượt nào
(`conversation-state.ts:62-84`). Với nhiều lượt song song, ba luồng partial ghi
đè lên nhau và một lượt kết thúc sẽ xoá dòng live của lượt khác đang mở. Web cần
bản một-dòng hiện tại; extension cần bản khoá theo lượt. Chia sẻ một file buộc
phải rẽ nhánh là điều ngược lại với lý do DRY mở đầu phase này. File ở lại
`apps/web`; extension có reducer riêng, thuộc phase 5.

Worklet đi theo package: extension nạp qua `chrome.runtime.getURL`, web nạp qua
`/worklets/...`. Seam đã đúng chỗ sẵn — `ConversationSessionDeps.workletUrl`
(`conversation-session.ts:35`) vốn là dependency tiêm từ ngoài.

`env.NEXT_PUBLIC_API_BASE_URL` trong `translate-socket.ts:26` là phụ thuộc
Next-only duy nhất. Phải bỏ: `TranslateSocket` nhận `url` qua constructor,
`apps/web` truyền từ `env` của nó. **Đây là đổi chữ ký công khai** và nó phá
`fake-audio-context.ts:130-150`, vốn hiện thực hoá `TranslateSocket` — file đó
cần sửa nội dung, không chỉ sửa import.

### Test và knip: cả hai vỡ nếu không xử lý

Cả **5** spec của `apps/web` nằm trong tập file chuyển đi:

```
src/audio/capture-pump.spec.ts
src/audio/capture-pump.replay.spec.ts
src/audio/pipeline-latency.measure.spec.ts
src/conversation/conversation-session.spec.ts
src/state/conversation-state.spec.ts      ← ở lại cùng conversation-state.ts
```

Bốn file đầu đi. `apps/web/vitest.config.ts:16` có
`include: ['src/**/*.spec.ts']` và không có `passWithNoTests`; `knip.json` khai
`apps/web.entry = ["src/**/*.spec.ts"]`. Vì `conversation-state.spec.ts` ở lại,
cả hai vẫn có ít nhất một file để bám — nhưng phải kiểm tra chứ không giả định,
và `knip.json` cần thêm workspace cho package mới.

## Related Code Files

- Create: `packages/realtime-client/` (package.json, tsup.config.ts, vitest.config.ts, tsconfig.json, src/**, worklets/**)
- Move: `apps/web/src/audio/*` → `packages/realtime-client/src/audio/`
- Move: `apps/web/src/conversation/*` → `packages/realtime-client/src/conversation/`
- Move: `apps/web/src/clients/translate-socket.ts` → `packages/realtime-client/src/transport/`
- Move: `apps/web/public/worklets/mic-capture-processor.js` → `packages/realtime-client/worklets/`
- **Stay:** `apps/web/src/state/conversation-state.ts` + `conversation-state.spec.ts`
- Modify: `apps/web/package.json`, `apps/web/src/hooks/use-streaming-translate.ts`, `apps/web/src/hooks/use-audio-recorder.ts`, `apps/web/vitest.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/app/translate/page.tsx`
- Modify: **`knip.json`** — thêm workspace `packages/realtime-client`, kiểm lại `apps/web.entry`
- Modify: `packages/realtime-client/src/conversation/fake-audio-context.ts` — nội dung, do đổi chữ ký `TranslateSocket`

## Implementation Steps

1. Dựng khung package theo khuôn `packages/types`. Phải có script `build`, nếu
   không turbo (`dependsOn: ["^build"]`) bỏ qua và app import vào `dist` rỗng —
   `packages/ui` là tiền lệ của một package không có `build` và không có consumer.
2. Bỏ phụ thuộc `@/config/env` khỏi `TranslateSocket`: thêm tham số `url`.
3. Chuyển file kèm test (trừ `conversation-state`). Sửa import.
4. Sửa `fake-audio-context.ts` cho khớp chữ ký `TranslateSocket` mới.
5. Trỏ `apps/web` sang package; xoá alias không còn ai dùng.
6. Cập nhật `apps/web/vitest.config.ts` và eslint scope; xác nhận
   `pnpm --filter web test` vẫn tìm thấy `conversation-state.spec.ts`.
7. Thêm workspace `packages/realtime-client` vào `knip.json` với `entry` là các
   spec của nó.
8. Chạy `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm knip` ở root.

## Success Criteria

- [ ] Test đã chuyển pass; nội dung test không sửa trừ import và `fake-audio-context.ts`
- [ ] `pnpm --filter web test` chạy và tìm thấy ít nhất một spec
- [ ] `pnpm build` xanh, `pnpm knip` exit 0 với workspace mới đã khai
- [ ] `apps/web` chạy dev, dịch một lượt thành công bằng tay
- [ ] Package không import `next`, `react`, hay `chrome`
- [ ] `conversation-state.ts` vẫn ở `apps/web`

## Risk Assessment

- **Khối lượng thật:** ~2851 LOC trên 15 file, cộng scaffold package và rewire
  vitest/eslint/knip/turbo. Ước lượng 4h ban đầu là thiếu; 1d.
- **Vòng phụ thuộc turbo** — package mới phải có script `build`.
- **`@types/node` drift** — `pnpm-workspace.yaml` pin `^24`; khai báo tường minh.
- **Rollback:** phase này là một lần di chuyển cây thư mục mà mọi phase sau đều
  dựa vào. Revert được bằng một `git revert` nếu làm riêng một commit — bắt buộc
  không trộn với phase khác.
