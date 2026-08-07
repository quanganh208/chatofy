---
title: 'Phase 1: Relocate Misplaced Injectable'
status: todo
phase: 1
priority: P1
effort: '30m'
dependencies: []
---

# Phase 1: Relocate Misplaced Injectable

## Overview

Chuyển `LiveTranslateSessionService` từ `session/` sang `services/`. Đây là
`@Injectable` **duy nhất trong toàn repo** nằm ngoài `services/`/`providers/`.
Di chuyển thuần — không đổi một dòng logic nào.

## Requirements

- Functional: không đổi hành vi. Chỉ đổi đường dẫn file và import.
- Non-functional: quy tắc `services/` vs `session/` trở nên nhất quán 100%,
  viện dẫn được bằng phân bố `@Injectable` chứ không bằng khẩu vị.

## Architecture

Quy tắc de facto, chứng minh bằng cách đếm:

| Thư mục                   | Nội dung                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `services/`, `providers/` | mọi `@Injectable` — collaborator có DI                                                             |
| `session/`                | collaborator thuần, không DI (`TurnSession`, `EventChannel`, `SessionRegistry`, `TurnTimeline`, …) |

Ngoại lệ duy nhất: `session/live-translate-session.service.ts:96`. Nó cũng có
metrics recorder anh em đã nằm đúng chỗ (`services/live-session-metrics.recorder.ts`),
nên việc chuyển làm hai file cùng cụm về chung nhà.

## Related Code Files

- Move: `apps/api/src/modules/translate/session/live-translate-session.service.ts`
  → `apps/api/src/modules/translate/services/live-translate-session.service.ts`
- Move: `apps/api/src/modules/translate/session/live-translate-session.service.spec.ts`
  → `apps/api/src/modules/translate/services/live-translate-session.service.spec.ts`
- Modify: `apps/api/src/modules/translate/translate.gateway.ts` (import ~dòng 19)
- Modify: `apps/api/src/modules/translate/translate.module.ts` (import + provider)

## Implementation Steps

1. `git mv` cả hai file (`.ts` và `.spec.ts`) sang `services/`.
2. Sửa import **trong** file vừa chuyển — đường dẫn tương đối lùi một cấp:
   - `../../../config/env.schema` giữ nguyên độ sâu (cùng cấp thư mục)
   - `../services/live-session-metrics.recorder` → `./live-session-metrics.recorder`
   - `./outbound-audio-framer`, `./stream-socket`, `./turn-concurrency`,
     `./live-session-limits` → `../session/...`
3. Sửa import trong `translate.gateway.ts` và `translate.module.ts`.
4. Sửa import trong file spec vừa chuyển.
5. Chạy cổng nghiệm thu.

## Success Criteria

- [x] `grep -rl "@Injectable" apps/api/src/modules/translate` chỉ trả về đường dẫn
      dưới `services/` và `providers/`
- [x] `pnpm --filter @chatofy/api test` pass
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm knip` xanh
- [x] `live-translate-session.service.spec.ts` pass **không sửa assertion nào**
- [x] `git log --follow` vẫn theo được lịch sử file (dùng `git mv`, không xoá-tạo)

## Risk Assessment

Rủi ro gần bằng 0 — chỉ 2 import site ngoài file, `tsc` bắt được mọi sai sót.

**Giả định có thể sai:** knip có thể báo file mới là unused nếu `knip.json`
neo đường dẫn cứng.
**Tín hiệu:** `pnpm knip` báo unused file sau khi chuyển.
**Phản ứng đã định trước:** kiểm tra khối `apps/api` trong `knip.json` — mục
`entry` hiện là `src/main.ts` + glob, nên nhiều khả năng không cần đụng. Nếu có
đường dẫn cứng, cập nhật nó trong cùng commit.
