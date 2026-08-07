---
title: 'Phase 2: LiveSession Interface To Class'
status: todo
phase: 2
priority: P1
effort: '4h'
dependencies: [1]
---

# Phase 2: LiveSession Interface To Class

## Overview

`interface LiveSession` là 15 field mutable mà **hành vi bị rải khắp service**
dưới dạng `session.x += y`, rồi được ráp lại thành object literal trong
`finish()`. Đây là vi phạm OOP thật duy nhất trong mã mới — dữ liệu tách rời
hành vi. Biến nó thành class, hành vi về đúng chỗ, và `start()` 192 dòng tự co lại.

Đây là phase mang lại giá trị OOP lớn nhất trong toàn kế hoạch.

## Requirements

- Functional: hành vi không đổi. Cùng sự kiện, cùng thứ tự, cùng metrics row.
- Non-functional: đếm và biến đổi state sống cùng dữ liệu; service chỉ còn điều phối.

## Architecture

**Hiện tại — dữ liệu ở một nơi, hành vi ở nơi khác:**

| Vị trí      | Việc đang làm                                                    |
| ----------- | ---------------------------------------------------------------- |
| `:43-79`    | 15 field mutable, không method                                   |
| `:263,:268` | `session.sourceChars += delta.length`; `languageMismatches += 1` |
| `:278`      | `session.targetChars += delta.length`                            |
| `:288-290`  | `firstUpstreamByteMs ??=`; `outputBytes +=`; `outputRate =`      |
| `:295`      | `() => session.sequence++`                                       |
| `:398`      | `session.inputBytes += ...` (trong `pushFrame`)                  |
| `:514-529`  | ráp thủ công 11 field thành metrics row                          |

**Sau — class giữ cả hai:**

```ts
// apps/api/src/modules/translate/session/live-session.ts
export class LiveSession {
  constructor(
    readonly sessionId: string,
    readonly direction: TranslationDirection,
    readonly source: LanguageCode,
    readonly startedAt: number,
    readonly provider: RealtimeProvider,
  ) {}

  noteSourceDelta(delta: string, lang: LanguageCode): void; // :263,:268
  noteTargetDelta(delta: string): void; // :278
  noteAudio(chunk: Uint8Array, rate: number, now: number): void; // :288-290
  nextSequence(): number; // :295
  noteFrame(bytes: number, now: number): void; // :398
  attach(handle: StreamHandle, connectedAt: number): void; // :349-351
  finishOnce(): boolean; // latch — thay cho `finished` trần
  toMetricsRow(reason: string, now: number): LiveSessionMetricsRow; // :514-529
}
```

`finished` thành latch qua `finishOnce()` trả boolean: cuộc đua đóng session
được diễn đạt như một thao tác nguyên tử thay vì cặp đọc-rồi-ghi lặp ở nhiều nơi.

**Giữ nguyên có chủ đích:** `handle: StreamHandle | null` vẫn nullable. Comment
`:56-63` giải thích lý do (session đăng ký TRƯỚC khi dial xong) — đừng "dọn" nó
thành non-null, đó là mô hình hoá trung thực.

**File riêng, không nhét vào service:** đặt ở `session/live-session.ts` cạnh
`turn-session.ts` — cùng loại collaborator thuần, không DI, đúng quy tắc Phase 1.

**Lưu ý trùng tên:** `packages/realtime-client/src/conversation/live-session.ts`
cũng export một class tên `LiveSession` (phía client). Hai lớp ở hai workspace
khác nhau, không bao giờ import cùng nhau, và tên `LiveSession` vốn đã là tên
interface hiện tại ở API — nên giữ tên là bảo toàn hiện trạng, không phải tạo
xung đột mới. Đừng "sửa" bằng cách đổi tên một trong hai.

## Related Code Files

- Create: `apps/api/src/modules/translate/session/live-session.ts`
- Create: `apps/api/src/modules/translate/session/live-session.spec.ts`
- Modify: `apps/api/src/modules/translate/services/live-translate-session.service.ts` (sau Phase 1)
- Modify: `apps/api/src/modules/translate/services/live-session-metrics.recorder.ts` (chỉ nếu kiểu row cần export)

## Implementation Steps

1. Tạo `session/live-session.ts`: chuyển 15 field vào class, thêm các method trên.
   Chuyển nguyên văn các comment giải thích từ `:48-78` — chúng ghi lại **lý do**
   đã đo được, không phải chú thích trang trí.
2. Viết `live-session.spec.ts` cho class mới: đếm delta, latch `finishOnce()` gọi
   hai lần chỉ true một lần, `toMetricsRow` quy đổi bytes → ms đúng ở
   `outputRate` = 0 và khác 0.
3. Thay `interface` bằng class trong service; đổi mọi điểm mutation sang gọi method.
4. `finish()` gọi `session.toMetricsRow(reason, Date.now())` thay cho literal 11 field.
5. Rút gọn khối callback `:262-316` — sau bước 3 phần lớn thành một dòng uỷ nhiệm.
6. Chạy cổng nghiệm thu.

## Success Criteria

Đích kích thước ban đầu (`≤250` file, `≤60` start) đặt trên **tổng dòng** mà không
đếm comment — file này 28% comment, ghi lại phát hiện đo được và bug thật, nên
không cắt được. Đích đã sửa sang **dòng code**; xem cơ sở đo trong `plan.md`.

- [x] `live-translate-session.service.ts` ≤ 320 dòng code — **đạt: 316** (từ 361; tổng 541 → 486)
- [x] `start()` ≤ 110 dòng — **đạt: 104** (từ 192)
- [x] Không còn `session.<field> +=` hay `session.<field> =` ngoài class
- [x] `live-translate-session.service.spec.ts` (524 dòng) pass **không sửa assertion nào**
- [x] `live-session.spec.ts` mới: 14 test — đếm delta, mismatch ngôn ngữ, TTFB, quy đổi bytes→ms, ceiling, latch
- [ ] ~~`apps/api/test/live-translate-ws.e2e-spec.ts` (401 dòng) pass không sửa~~
      **TUYÊN BỐ SAI — tôi chưa từng chạy file này.** `pnpm --filter api test` là
      `jest` với `rootDir: "src"`, nên nó chỉ chạy spec trong `src/`; 27 suite =
      26 spec cũ + `live-session.spec.ts` mới. Toàn bộ `apps/api/test/` chạy bằng
      script riêng `test:e2e`, và script đó **không nằm trong CI**.
      Hành vi của Phase 2 vẫn được phủ bởi spec 524 dòng đã thực sự chạy; cái sai
      ở đây là tôi báo một cổng kiểm chứng mình không hề thực hiện.
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm knip` xanh — 27 suite, 389 test

**Ngoài plan, đã làm thêm:** tách `resolveProvider()` và `upstreamEvents()` khỏi
`start()` (163 → 104). Plan chỉ ghi "rút gọn khối callback"; hai đơn vị này gắn
kết và đặt tên được nên tách là chính đáng, nhưng là quyết định lúc thực thi.

`live-session.ts`: 153 dòng tổng / 89 dòng code.

## Risk Assessment

Rủi ro chính: đổi hành vi trong lúc di chuyển state — đặc biệt thứ tự
`firstUpstreamByteMs ??=` so với `outputBytes +=` tại `:288-289`, và tính nguyên
tử của latch `finished` tại `:498-499`.

**Giả định có thể sai:** spec 524 dòng bao phủ đủ các đường đua này.
**Tín hiệu:** phải sửa một assertion để spec pass.
**Phản ứng đã định trước:** **dừng ngay.** Sửa assertion = đã đổi hành vi. Hoàn
tác bước đó, viết một spec mới ghim hành vi cũ trước, rồi refactor lại.

Rủi ro thứ hai: `toMetricsRow` lệch kiểu với `LiveSessionMetricsRecorder.record()`.
**Tín hiệu:** `tsc` báo lỗi.
**Phản ứng:** export kiểu row từ recorder và để class implement nó — đừng nhân
bản định nghĩa field ở hai nơi.
