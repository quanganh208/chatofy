---
title: 'Shadcn everywhere, elevation and motion'
description: 'Bỏ cảm giác phẳng lì và thiếu chuyển động: thêm thang elevation + motion vào token layer, và đưa mọi component của hai bề mặt DOM về shadcn.'
status: completed
priority: P1
effort: '4-6d'
tags: [ui, ux, design-tokens, shadcn, motion, elevation, web, extension]
created: 2026-08-21
---

# Shadcn everywhere, elevation and motion

## Overview

Branch `feat/production-ui-ux` đã ship đúng spec và **vẫn bị từ chối**. Nguyên
nhân không phải bug — là chính cái direction đang chạy:

- `docs/design-guidelines.md` viết _"separates surfaces with rules instead of
  luminance steps"_, nên **không có token elevation nào tồn tại**. Mấy chỗ
  `shadow-xs`/`shadow-sm` còn sót là rác shadcn stock chưa bao giờ được thiết kế.
- Mục Motion cho phép đúng 4 chuyển động, và **không có token duration/easing
  nào**. Toàn bộ motion đang chạy là `transition-colors` mặc định 150ms.

Nghịch lý: overlay — bề mặt duy nhất **ngoài** token layer — lại là bề mặt duy
nhất có chiều sâu, bằng hai dòng `box-shadow` hardcode ở `overlay-styles.ts:81`
và `:119`.

Plan này đảo direction đó, và đồng thời đưa **mọi component của web + popup về
shadcn** theo yêu cầu của người dùng.

**Kế thừa `260819-1801-production-ui-ux-for-web-and-extension`** (`status:
in-progress`, cùng branch). Plan đó đóng khoảng cách token và IA; plan này thay
phần direction mà nó đã chốt. Thư mục của nó hiện bị xoá khỏi disk (staged `D`)
nhưng còn trong HEAD — không khôi phục, chỉ ghi nhận quan hệ.

## Ràng buộc đã chốt với người dùng

| Quyết định       | Chọn                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| Cơ chế chiều sâu | elevation thật — light dùng bóng, dark dùng bậc độ sáng sẵn có         |
| Palette          | **không đổi**. `measure-palette.py` phải giữ 54/54                     |
| Motion           | thang token duration/easing + quét micro-interaction, cộng thumb trượt |
| Theme            | cả sáng lẫn tối đều bị coi là phẳng                                    |
| Component        | **toàn bộ shadcn** trên web + popup                                    |
| Luật được phá    | _"rules not luminance"_, _"một accent mỗi màn hình"_                   |
| Cổng duyệt       | mock phải được gật **trước** khi viết token                            |

## Goals

| #   | Goal                                                                                            | Priority |
| --- | ----------------------------------------------------------------------------------------------- | -------- |
| 1   | Người dùng gật một frame trong `mock.html` trước khi bất kỳ token nào được viết                 | P1       |
| 2   | `tokens.ts` có `elevation` (hai nửa) + `motion`, cả ba bề mặt đọc từ đó, parity spec phủ được   | P1       |
| 3   | Mọi component web + popup là primitive shadcn hoặc chỉ ghép từ primitive shadcn                 | P1       |
| 4   | Không còn `transition-colors` trần; hai lỗ `motion-reduce:` đã ghi trong docs được vá           | P1       |
| 5   | Overlay tokenise hết bóng hardcode mà vẫn giữ `overlay-invariants.spec.ts` xanh                 | P1       |
| 6   | Docs ghi lại direction mới, việc đảo RadioGroup→ToggleGroup, và đưa harness contrast thành spec | P2       |

## Phases

| #   | Phase                                                                                                   | Status    |
| --- | ------------------------------------------------------------------------------------------------------- | --------- |
| 1   | [Phase 1: Cổng mock và chốt hướng](./phase-01-start.md)                                                 | Completed |
| 2   | [Phase 2: Token layer — elevation và motion](./phase-02-token-layer-elevation-and-motion.md)            | Completed |
| 3   | [Phase 3: Chuyển toàn bộ composition sang shadcn](./phase-03-shadcn-conversion-of-every-composition.md) | Completed |
| 4   | [Phase 4: Bề mặt web](./phase-04-web-surfaces.md)                                                       | Completed |
| 5   | [Phase 5: Popup và overlay](./phase-05-popup-and-overlay.md)                                            | Completed |
| 6   | [Phase 6: Docs và harness contrast](./phase-06-docs-and-the-contrast-harness.md)                        | Completed |

Phụ thuộc: 1 → 2 → 3 → (4, 5) → 6.

## Hai thứ KHÔNG chuyển được, và spec nào chặn

**Overlay.** `apps/extension/src/overlay-invariants.spec.ts:70` assert
`expect(STYLE).not.toContain('var(')`. Mọi utility Tailwind đều sinh custom
property, mà `all: initial` **không** reset custom property — chúng cố ý băng qua
shadow boundary như interface styling công khai. Overlay dùng Tailwind nghĩa là
trang họp repaint được **chỉ báo đang ghi âm**. Invariant bảo mật, không phải
khẩu vị. Overlay giữ chuỗi CSS viết tay và chỉ tokenise giá trị.

**`apps/mobile`.** React Native, không DOM. `packages/ui/src/react/index.ts` ghi
rõ mobile không được resolve React, Radix hay bất kỳ DOM type nào.

## Success Criteria

- [ ] Người dùng gật frame trong `mock.html`; giá trị được chốt ghi vào Phase 1
- [ ] `tokens.ts` export `elevation` + `motion`; mỗi bậc elevation có hai nửa
- [ ] `globals.css`, `popup/theme.css`, `overlay-styles.ts` đều đọc từ token
- [ ] `token-parity.spec.ts` phủ elevation + motion và **fail được** khi mất một nửa
- [ ] Đã kiểm chứng bằng mắt: bóng hiện ở cả hai theme — regex spec không thấy được CSS invalid
- [ ] Không còn `shadow-xs`/`shadow-sm`/`shadow-md` stock shadcn, và không chỗ nào dùng arbitrary `[box-shadow:…]`
- [ ] Focus ring còn nguyên trên mọi control đã áp elevation
- [ ] `ThemeToggle`, `StatusIndicator`, `DirectionToggle`, `SegmentedControl` chỉ ghép từ primitive shadcn
- [ ] `Tabs` + `ToggleGroup` sinh bằng CLI, re-skin, `skin-guard.spec.ts` xanh
- [ ] `segmented-control.spec.tsx` viết lại assert `radiogroup`/`radio`/`aria-checked`, không xoá
- [ ] Hai lỗ `motion-reduce:` được vá: `audio-source-controls.tsx:86`, `baseline/page.tsx:70`
- [ ] `overlay-invariants.spec.ts` xanh — không `var(` trong sheet
- [ ] `measure-palette.py` vẫn 54/54, và đã thành spec committed cạnh `token-parity.spec.ts`
- [ ] `docs/design-guidelines.md` ghi direction mới + việc đảo quyết định
- [ ] CI xanh: lint, typecheck, test, build, verify:build, extension e2e

<!-- slug: shadcn-everywhere-elevation-and-motion -->
