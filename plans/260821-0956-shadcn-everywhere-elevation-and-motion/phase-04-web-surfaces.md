---
phase: 4
title: 'Bề mặt web'
status: pending
priority: P1
effort: '0.75d'
dependencies: [2, 3]
---

# Phase 4: Bề mặt web

## Overview

Quét `apps/web` áp elevation và motion, vá hai lỗ `motion-reduce:` mà chính docs
đã tự khai là khuyết tật, và xử lý bề mặt animation của `tw-animate-css` hiện
không ai sở hữu.

**Phạm vi là `apps/web`, không phải `packages/ui`.** Phase 3 đã re-skin thẳng
component dùng chung lên token — chạm lần hai chỉ tạo xung đột, và
`segmented-control.tsx:88` mà bản plan đầu viện dẫn sẽ không còn tồn tại sau khi
`SegmentedControl` chuyển sang ToggleGroup.

## Requirements

- Functional: mọi card, panel, control trên `apps/web` đọc elevation và
  duration/easing từ token.
- Non-functional: không chuyển động nào sống sót qua `prefers-reduced-motion:
reduce`, và **không tín hiệu nào mất theo**. Không chuyển động liên tục cạnh chữ
  bản dịch — đó là thứ người ta đang đọc.

## Architecture

**Elevation phải đi qua bộ máy shadow của Tailwind, không được đi tắt.** Focus
ring của shadcn là `focus-visible:ring-[3px]` (ví dụ `select.tsx:32`), và ring
hợp thành với shadow qua stack `--tw-shadow` / `--tw-ring-*` **bên trong** các
utility shadow. Viết thẳng `[box-shadow:var(--elevation-md)]` sẽ ghi đè cả stack
đó và **mọi control được focus mất ring**. Nên: dùng utility sinh từ namespace
`--shadow-*` (`shadow-elev-md`), hoặc `shadow-[var(--elevation-md)]`. Không bao
giờ dùng arbitrary property `box-shadow`.

**Hai lỗ `motion-reduce:` docs đã tự ghi.** Mục Motion viết thẳng:
`audio-source-controls.tsx:86` transition một `width` mà không có `motion-reduce:`,
và `baseline/page.tsx` quay `Loader2` cũng không có. Hai meter y hệt ở
`cascade-panel.tsx:123` và `live-panel.tsx:126` thì **có**. Docs còn cảnh báo:
grep `transition-\[` một mình sẽ không thấy lỗ thứ hai — phải dùng
`animate-|transition-`.

**Bề mặt `tw-animate-css` chưa ai sở hữu.** `select.tsx:57` mang
`animate-in`/`animate-out`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*` — **không
có `motion-reduce:`**, thời lượng chưa token hoá, và nó render ở cả web lẫn popup
320px. Đây là animation vào/ra của portal Radix; nó cần một bước riêng, không phải
được quét ké. Ghi rõ: đây là component dùng chung nên sửa ở `packages/ui`, nhưng
nó là animation chứ không phải elevation, nên nằm ở phase này chứ không phải Phase 3.

**Luật "một accent mỗi màn hình" đã được người dùng cho phép phá**, nhưng hướng
elevation **không cần** phá nó. Giữ nguyên trừ khi Phase 1 chốt khác. Có quyền
không có nghĩa là phải dùng.

## Related Code Files

- Modify: `apps/web/src/components/translate/audio-source-controls.tsx` — lỗ `motion-reduce:`
- Modify: `apps/web/app/translate/baseline/page.tsx` — lỗ `motion-reduce:`
- Modify: `apps/web/src/components/layout/app-shell.tsx`
- Modify: `apps/web/app/page.tsx` — nút CTA viết tay, không dùng `Button`
- Modify: `apps/web/src/components/translate/cascade-panel.tsx`, `live-panel.tsx`,
  `conversation-transcript.tsx`, `result-card.tsx`, `voice-gender-toggle.tsx`
- Modify: `packages/ui/src/react/select.tsx` — animation portal, `motion-reduce:`

## Implementation Steps

1. Quét `grep -rnE 'shadow-(xs|sm|md|lg)' packages/ui/src apps/web` — đổi sang
   utility elevation. Lưu ý `select.tsx:57` mang `shadow-md`, không chỉ `xs`/`sm`.
2. Quét `grep -rnE 'animate-|transition-' apps/web packages/ui/src/react`. Dùng
   đúng biểu thức này, không phải `transition-\[`. Với mỗi hit: đổi sang token, và
   xác nhận có `motion-reduce:` che.
3. Vá `audio-source-controls.tsx:86`: thêm `motion-reduce:transition-none` cho
   khớp hai meter kia.
4. Vá `baseline/page.tsx`: `Loader2` cần `motion-reduce:hidden`. Trước đó phải xác
   nhận chữ `Translating… {elapsed}s` vẫn hiện — spinner chỉ được là trang trí.
5. `select.tsx:57`: cho toàn bộ chuỗi `animate-in`/`animate-out` một
   `motion-reduce:animate-none`, và đưa thời lượng về token. Kiểm chứng dropdown
   vẫn mở/đóng đúng khi tắt chuyển động, ở cả web lẫn popup 320px.
6. `app/page.tsx`: nút CTA đang là `<Link>` gắn class thủ công, không dùng
   `Button`. Theo yêu cầu "toàn bộ shadcn", đổi sang `Button asChild`.
7. Áp elevation cho `Card` trên `/translate`, `/translate/live`,
   `/translate/baseline`, và cho transcript.
8. `app-shell.tsx`: header hiện là `border-b`. Đổi sang elevation khi cuộn **chỉ
   nếu Phase 1 chốt** — đây không phải quyền tự quyết.
9. Chụp lại ba route ở hai theme, đối chiếu cột `elev` của `mock.html`.

## Success Criteria

- [x] `grep -rnE 'shadow-(xs|sm|md|lg)'` trong `packages/ui/src` và `apps/web` không còn hit stock
- [x] Không chỗ nào dùng arbitrary property `[box-shadow:…]`
- [x] Focus ring còn nguyên trên mọi control đã áp elevation — kiểm bằng tab qua từng cái
- [x] `grep -rnE 'animate-|transition-'` — mọi hit dùng token và có `motion-reduce:`
- [x] `audio-source-controls.tsx`, `baseline/page.tsx`, `select.tsx` không còn là lỗ
- [x] Bật giảm chuyển động ở OS: không gì động, và **không mất thông tin nào**
- [x] `app/page.tsx` dùng `Button asChild`, không còn class thủ công
- [x] Ảnh chụp ba route hai theme khớp cột `elev` của mock
- [x] `pnpm turbo run lint typecheck test` xanh

## Kết quả thực thi — 2026-08-21

**Hai "lỗ" docs khai là khuyết tật thì đã được vá từ trước.**
`audio-source-controls.tsx` có `motion-reduce:transition-none`,
`baseline/page.tsx` có `motion-reduce:hidden`. Mục Motion trong
`docs/design-guidelines.md` viết "Two current gaps, both real" — **docs sai, code
không thiếu**. Phase 6 phải xoá đoạn đó thay vì mô tả một công việc không tồn tại.

**Đã quét:** `card`, `checkbox`, `radio-group`, `select`, `button`, `badge` sang
elevation + duration/easing token. `select.tsx:57` — chuỗi `animate-in`/`zoom`/
`slide` của portal Radix — nhận `motion-reduce:animate-none motion-reduce:transition-none`
và `shadow-elev-lg`. `app/page.tsx` CTA thành `Button asChild` (giữ link thật:
chuột phải, chuột giữa, prefetch đều còn).

**Audit sau khi quét:** 0 stock shadow, 0 arbitrary `[box-shadow:…]`, mọi
`transition-` dùng token và có `motion-reduce:`.

**Kiểm bằng Chromium thật, không phải suy luận** (dùng lại dev server đang chạy ở
`:3001`, không spawn trùng):

| Kiểm                                              | Light     | Dark      |
| ------------------------------------------------- | --------- | --------- |
| `/` có bóng thật                                  | 3 phần tử | 3 phần tử |
| `/translate`                                      | 6         | 6         |
| `/translate/baseline`                             | 6         | 6         |
| `box-shadow` là chuỗi hợp thành (ring còn nguyên) | 17 lớp    | 17 lớp    |

Chế độ `reducedMotion: 'reduce'`: **0 phần tử còn chuyển động.**

**Một bẫy trong chính phép đo, đáng ghi.** Bản kiểm đầu đọc `transitionDuration`
và báo 11 phần tử "còn chuyển động" ở chế độ reduce. Sai:
`transition-none` đặt `transition-property: none` và **để nguyên duration** —
duration khác 0 không có nghĩa là có chuyển động. Phép đo đúng là
`transitionProperty !== 'none' && duration > 0`, hoặc `animationName !== 'none'`.
Lỗi nằm ở thước đo, không ở code.

Ảnh chụp 6 tấm (3 route × 2 theme) ở `./screenshots/`.

## Sửa sau khi người dùng phát hiện — 2026-08-21

**Người dùng hỏi "sao vẫn thấy viền" và họ đúng.** Lượt quét đầu tìm `shadow-*` và
`transition-*` nhưng **chưa bao giờ grep `border-border`**. `Card` lùi được là vì
primitive được sửa; mọi chỗ dùng `border-border` trực tiếp trong app thì không ai
đụng — **9 chỗ** trên web và popup.

**Và một chỗ phân loại sai, nặng hơn.** Hai ô Source/Translation trong
`DirectionToggle` mang `border-border-control` — token ranh giới WCAG 1.4.11 ở
3.03:1, đậm nhất trang. Nhưng `Side` là `<div>` với hai `<p>`: không handler,
không tab stop, không role. **Không phải user interface component**, nên 1.4.11
không với tới nó. Hai cạnh đậm nhất trang thuộc về đúng thứ duy nhất không bấm
được.

**Cách sửa:** thêm `--color-hairline: var(--surface-hairline)` vào `@theme inline`
của cả hai bề mặt, sinh ra utility `border-hairline`. Rải
`border-[var(--surface-hairline)]` khắp nơi thì không grep được và mỗi lần đổi là
sửa nhiều chỗ.

**Đo lại trên trang chạy thật — mọi viền còn lại đều ở 6%:**

| Phần tử                               | Trước     | Sau      |
| ------------------------------------- | --------- | -------- |
| header `border-b`                     | `#E4E4E0` | hairline |
| `theme-toggle`                        | `#E4E4E0` | hairline |
| Source / Translation                  | `#8D8D85` | hairline |
| vạch ngăn status, khung transcript    | `#E4E4E0` | hairline |
| popup: header, footer, pill, fieldset | `#E4E4E0` | hairline |

**Ba chỗ cố ý giữ:** nút swap (`border-control` — control thật), `Badge` variant
`outline` (variant tên là outline), và vạch trái nét đứt của lượt đang dịch (dấu
hiệu ngữ nghĩa, không phải vạch ngăn bề mặt).

**Bài học cho lần sau:** một lượt quét chiều sâu phải grep **cả ba** —
`shadow-`, `transition-`, **và `border-`**. Bỏ cái thứ ba thì elevation tới nơi
mà viền cũ vẫn ở nguyên đó, và kết quả trông y như chưa làm gì.

## Risk Assessment

**Rủi ro lớn nhất: mất focus ring hàng loạt mà test không thấy.** Không có test
nào trong repo assert ring hiện diện; nó là thuộc tính hình ảnh. Áp elevation sai
cách làm mọi control mất ring cùng lúc, và triệu chứng chỉ lộ ra khi có người dùng
bàn phím.

- Tín hiệu đã vỡ: tab qua control bất kỳ đã áp elevation, không thấy vòng focus.
- Phản ứng đã định: tiêu chí "tab qua từng cái" ở trên là bắt buộc và do người
  làm, không do CI. Nếu vỡ, quay về `shadow-[var(...)]` thay vì arbitrary property.

**Rủi ro: tắt spinner làm mất trạng thái loading.** `baseline/page.tsx` dùng
`Loader2` làm tín hiệu; `motion-reduce:hidden` mà không có gì thay thế thì người
tắt chuyển động không biết nó đang chạy.

- Tín hiệu đã vỡ: ở chế độ reduce, trang baseline lúc đang dịch trông hệt lúc rảnh.
- Phản ứng đã định: giữ chữ `Translating… {elapsed}s` làm tín hiệu chính. Luật của
  repo đã nói: không tín hiệu nào được là tín hiệu duy nhất.

**Rủi ro: elevation làm tụt contrast của viền.** Nếu viền nhạt đi trên bề mặt nổi,
`borderControl` có thể tụt dưới 3:1 — ngưỡng WCAG 1.4.11 cho ranh giới của control.

- Tín hiệu đã vỡ: harness contrast báo `borderControl on surface` dưới 3.0.
- Phản ứng đã định: `borderControl` **không** được nhạt đi. Chỉ `border` (hairline,
  1.34:1, không phải ranh giới) mới được lùi. Phase 1 đã chốt chuyện này.
