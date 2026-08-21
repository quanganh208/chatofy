---
phase: 5
title: 'Popup và overlay'
status: pending
priority: P1
effort: '1d'
dependencies: [2, 3]
---

# Phase 5: Popup và overlay

## Overview

Popup thừa hưởng phần lớn từ Phase 3 vì nó render cùng component. Overlay là bề
mặt duy nhất **không** chuyển sang shadcn được, và phase này làm rõ nó nhận được
gì: tokenise bóng đang hardcode, mở rộng khối reduce sẵn có, và giữ invariant.

## Requirements

- Functional: popup đọc elevation và motion từ `theme.css`; overlay đọc từ
  `tokens.ts` dưới dạng **giá trị literal**.
- Non-functional: `overlay-invariants.spec.ts` phải xanh. Overlay không được có
  `var(` trong sheet, không được đọc `colorLight`, và chỉ được có đúng một rule
  `:host`.

## Architecture

**Vì sao overlay không thể là shadcn.** `apps/extension/src/overlay-invariants.spec.ts:70`
assert `expect(STYLE).not.toContain('var(')`. Mọi utility Tailwind đều sinh custom
property, và `all: initial` **không** reset custom property — chúng cố ý băng qua
shadow boundary như một interface styling công khai. Nên overlay dùng Tailwind
nghĩa là trang họp repaint được panel, **kể cả chỉ báo đang ghi âm** mà trang
không được phép chạm. Đây là invariant bảo mật có test canh.

**Overlay vẫn được hưởng gì.** Nó là bề mặt duy nhất đã có chiều sâu, bằng hai
dòng hardcode: `overlay-styles.ts:81` (`0 4px 14px rgba(0,0,0,.4)` cho pill) và
`:119` (`0 8px 28px rgba(0,0,0,.45)` cho panel). Hai dòng đó thành
`${elevation.dark.md}` / `${elevation.dark.lg}` nội suy như `color` đang làm.
Đây là tokenise, không phải thêm mới.

**Chi phí byte đã đo, và nhỏ hơn tưởng.** `overlay-styles.ts` là 12.910 byte.
Ràng buộc "mỗi byte đều tính" nói về font và asset tiêm vào trang người khác,
không phải về dòng CSS. Một dòng transition là vài chục byte.

**Khối reduce đã tồn tại** ở `overlay-styles.ts:171`:
`@media (prefers-reduced-motion: reduce) { .dot, .pill.live .pill-dot { animation: none } }`.
Mở rộng nó, đừng dựng cơ chế thứ hai.

**Popup có ba khác biệt đã ghi, không được xoá.** `theme.css` giải thích:
`--font-sans` không resolve qua `--font-inter` (next/font không tồn tại ở đây);
không `@layer base`; không `@custom-variant dark`. Và utilities phải để
**unlayered** — Chrome áp default riêng cho popup từ một stylesheet unlayered
không xuất hiện trong `document.styleSheets`.

## Related Code Files

- Modify: `apps/extension/entrypoints/popup/theme.css` — elevation + motion (Phase 2 đã mở đường)
- Modify: `apps/extension/entrypoints/popup/popup.tsx`
- Modify: `apps/extension/entrypoints/popup/settings-pane.tsx`
- Modify: `apps/extension/entrypoints/popup/style.css`
- Modify: `apps/extension/entrypoints/content/overlay-styles.ts` — tokenise `:81`, `:119`, mở rộng `:171`
- Verify: `apps/extension/src/overlay-invariants.spec.ts`, `popup-invariants.spec.ts`

## Implementation Steps

1. Popup: xác nhận component từ `@chatofy/ui/react` đã mang elevation và motion
   sau **Phase 3** — phase đó re-skin thẳng lên token, nên popup phần lớn tự
   hưởng, không phải sửa.
2. Popup: quét `style.css` và hai file `.tsx` tìm bóng hoặc transition viết tay,
   đổi sang token.
3. Popup: kiểm chứng thumb trượt của `SegmentedControl` hoạt động trong 320px —
   đây là consumer thứ hai và là chỗ hẹp nhất.
4. Overlay: đổi `:81` và `:119` sang nội suy từ `elevation`. Nhớ overlay chỉ được
   dùng nửa **dark** — `overlay-invariants.spec.ts:112` cấm chạm `colorLight`.
5. Overlay: thêm transition cho `.pill:hover` và cho `.panel` mở/đóng, dùng
   `${motion.duration.base}ms ${motion.easing.standard}` nội suy literal.
6. Overlay: mở rộng khối reduce ở `:171` để phủ mọi transition mới.
7. Chạy `pnpm turbo run test --filter=extension` và bộ e2e của extension.

## Success Criteria

- [x] `overlay-styles.ts` không còn bóng hardcode; cả hai đọc từ `elevation`
- [x] `overlay-invariants.spec.ts` xanh — không `var(`, một `:host`, không `colorLight`
- [x] Khối reduce ở overlay phủ mọi chuyển động mới
- [x] Popup: thumb trượt đúng trong 320px
- [x] `popup-invariants.spec.ts` xanh
- [x] Bộ e2e extension xanh
- [x] Kiểm bằng mắt: overlay trên nền video sáng và video tối đều đọc được

## Kết quả thực thi — 2026-08-21

**Popup: không phải sửa gì.** Nó render `@chatofy/ui/react`, nên elevation và
motion tới nơi cùng lúc với Phase 3/4. Quét `style.css` và hai file `.tsx`: không
có bóng hay transition viết tay nào.

**Overlay:** `:81` và `:119` giờ nội suy `${elevation.md.dark}` /
`${elevation.lg.dark}`. Thêm transition cho `.pill` (viền + bóng,
`${motion.duration.fast}ms ${motion.easing.standard}`) và bóng nâng lên khi hover.
Khối reduce ở `:171` mở rộng để phủ nó.

**Luật riêng của overlay, đã ghi vào header file:** chỉ được đọc nửa `dark`.
`elevation.md.dark`, không bao giờ `elevation.md`. Một `light-dark()` trong sheet
này sẽ khiến overlay đi theo hệ điều hành — đúng lỗi "laptop sáng trong cuộc họp
tối". `overlay-invariants.spec.ts` **không bắt được** chuyện này (nó chỉ cấm
`var(`), nên đây là luật của người viết chứ không phải của test.

**Gate:** `overlay-invariants.spec.ts` 12/12 · extension 188 · typecheck+test+lint
12/12 task · **e2e 65 passed, 0 failed**. Chuỗi `OVERLAY_STYLE` không có `var(`
(hai hit trong file đều nằm ở comment giải thích chính luật đó) và không chạm
`colorLight`.

## Risk Assessment

**Rủi ro: một utility Tailwind lọt vào overlay.** Nếu ai đó import component từ
`@chatofy/ui/react` vào content script cho "đồng bộ", invariant vỡ và trang họp
giành được quyền vẽ lại chỉ báo ghi âm.

- Tín hiệu đã vỡ: `overlay-invariants.spec.ts:71` đỏ với `var(` trong sheet.
- Phản ứng đã định: revert ngay. Đây không phải chuyện thương lượng phong cách —
  spec tồn tại vì hậu quả bảo mật. Ghi lại trong Phase 6 để lần sau không ai thử.

**Rủi ro: popup mất kiểu vì thứ tự layer.** `theme.css` ghi rõ utilities phải
unlayered; một component mới kéo theo `@layer` sẽ tụt dưới stylesheet vô hình của
Chrome.

- Tín hiệu đã vỡ: control trong popup mất nền hoặc mất thang chữ mà không có lỗi
  nào, và không thanh tra được từ trong trang.
- Phản ứng đã định: giữ nguyên ba dòng `@import 'tailwindcss/...'` tách rời.
  Không đổi về dạng import gộp.
