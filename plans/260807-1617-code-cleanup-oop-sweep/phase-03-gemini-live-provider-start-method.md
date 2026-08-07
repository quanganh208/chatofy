---
title: 'Phase 3: Gemini Live Provider Start Method'
status: todo
phase: 3
priority: P2
effort: '2h'
dependencies: []
---

# Phase 3: Gemini Live Provider Start Method

## Overview

`GeminiLiveTranslateProvider.start()` là 126 dòng làm bốn việc tách bạch: kiểm
tra định dạng audio, dựng client, mở socket kèm khối callback lồng sâu, rồi xử lý
đường đua đóng-trong-lúc-connect. Tách ra thành các private method.

Độc lập với Phase 1-2 — file khác, package khác. Chạy song song được.

## Requirements

- Functional: hành vi không đổi, kể cả xử lý đường đua và loại lỗi ném ra.
- Non-functional: mỗi đơn vị đọc được mà không cần cuộn màn hình.

## Architecture

Cắt theo bốn trách nhiệm đã có sẵn trong `start()`:

| Đoạn hiện tại | Tách thành                                                                              |
| ------------- | --------------------------------------------------------------------------------------- |
| `:116-126`    | `private assertSupportedFormat(params)` — chỉ ném `ProviderConfigError`                 |
| `:132-137`    | `private clientFor(params)` — quy tắc `\|\|` trên apiKey, giữ nguyên comment `:133-136` |
| `:172-204`    | `private connectCallbacks(id, params, state, onEarlyClose)` — khối callback             |
| `:210-238`    | giữ trong `start()`: đường đua và dựng handle là điều phối                              |

**Giữ nguyên tuyệt đối:** biến `closedDuringConnect` và kiểm tra `:210`. Comment
`:144-153` ghi lại một bug thật đã xảy ra (entry đăng ký sau lệnh delete lẽ ra
phải xoá nó, để lại socket chết mà `pushAudio` vẫn ghi vào). Đây không phải mã
phòng thủ thừa — đừng đơn giản hoá.

`||` ở `:137` cũng không phải nhầm lẫn với `??`; comment `:133-136` giải thích.
Giữ nguyên và giữ cả comment.

## Related Code Files

- Modify: `packages/ai-providers/src/providers/gemini-live/gemini-live-translate-provider.ts`

## Implementation Steps

1. Tách `assertSupportedFormat` từ `:116-126`.
2. Tách `clientFor` từ `:132-137`, mang theo comment.
3. Tách khối callback `:172-204` thành method nhận `id`, `params`, `state` và một
   callback báo early-close. `closedDuringConnect` vẫn là biến cục bộ của
   `start()`; method chỉ ghi vào nó qua closure được truyền.
4. `start()` còn lại: assert → client → connect → kiểm tra đường đua → đăng ký → trả handle.
5. Chạy cổng nghiệm thu.

## Success Criteria

- [x] `start()` ≤ 70 dòng — **đạt: 68** (từ 126)
- [x] `gemini-live-translate-provider.spec.ts` pass **không sửa assertion nào** — 27/27
- [x] `closedDuringConnect` và kiểm tra đường đua còn nguyên ngữ nghĩa — hai test
      `'fails the start when the server closes during connect'` và
      `'does not leak a session that failed to start'` pass không sửa
- [x] Mọi comment giải thích lý do được mang theo cùng đoạn mã
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm knip` xanh

**Đích "file ≤ 320, không tăng" đã bỏ — nó sai.** File 322 → 358 tổng
(196 → 215 dòng code). Tách thành method có tên **luôn** làm file dài thêm trong
repo tài liệu dày: mỗi method mới cộng chữ ký, dấu đóng, và doc comment. Đó là
chi phí của việc đặt tên cho một thứ, và nó đáng. Cùng bài học với Phase 2 —
đích kích thước phải đặt cho _method_, không cho _file_, khi việc cần làm là
tách method.

**Đã tách 4 đơn vị** (plan ghi 3): `assertSupportedFormat`, `clientFor`,
`socketCallbacks`, và `handleFor` — khối `return { id, close }` cũng là một đơn vị
gắn kết (ngữ nghĩa đóng idempotent) nên được đặt tên luôn.

**Lưu ý cho các phase sau:** spec 515 dòng của provider này nằm ở
`apps/api/src/modules/translate/providers/`, **không** nằm cùng workspace với code
(`packages/ai-providers/`). Package `ai-providers` không có spec riêng cho nó.

## Risk Assessment

Rủi ro: khối callback đóng trên `id`, `state`, `this.sessions` và
`closedDuringConnect`. Tách sai closure sẽ phá đúng đường đua mà comment `:144-153`
mô tả — và nó **không** fail đồng bộ, nó để lại socket chết.

**Giả định có thể sai:** spec 515 dòng có bao ca đóng-trong-lúc-connect.
**Tín hiệu:** kiểm tra trước khi refactor — `grep -n "closedDuringConnect\|during connect" packages/ai-providers/src/providers/gemini-live/*.spec.ts`.
**Phản ứng đã định trước:** nếu ca đó **không** được bao, viết spec cho nó
**trước** khi tách. Đây là bug đã từng xảy ra thật; refactor nó mà không có lưới
là đúng cách để nó quay lại.

**Cân nhắc cắt phase:** nếu thiếu thời gian, đây là phase P2 dễ bỏ nhất trong
nhóm A — nó chỉ cải thiện tính đọc được, không sửa vị trí sai nào.
