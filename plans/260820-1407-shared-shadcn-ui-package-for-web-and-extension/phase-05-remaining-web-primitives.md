---
phase: 5
title: 'Remaining web primitives'
status: pending
priority: P1
effort: '2-2.5d'
dependencies: [4]
---

# Phase 5: Remaining web primitives

## Overview

Mười component còn lại vào package theo lối Button đã mở,
`apps/web/src/components/ui/` biến mất, và hai guard chốt quy tắc re-skin.

## Requirements

- Functional: Card, Alert, Badge, ToggleGroup, Select, Checkbox, Label, Separator,
  StatusIndicator, **ThemeToggle**, **DirectionToggle** vào `@chatofy/ui/react`.
- Functional: `apps/web/src/components/ui/` không còn file. `app-shell` và 6 component
  còn lại trong `translate/` ở lại app, chỉ đổi import.
- Functional: `languageName` **được export từ `/react`** — nó có hai consumer
  (`direction-toggle.tsx:5` và `live-panel.tsx:5`), không phải một.
- Non-functional: a11y không thụt lùi, và có test chứng minh — hôm nay **không có test
  a11y nào** trong `apps/web`.

## Architecture

**ThemeToggle phải là controlled, và đó là thay đổi hành vi.** Web đọc `localStorage`
đồng bộ trong mount effect, cố ý, để lần render đầu của server và client khớp nhau — file
ghi rõ lý do. Extension đọc `chrome.storage` bất đồng bộ. Một component dùng chung không
ôm được cả hai; nó nhận `value` + `onChange`, mỗi app giữ module persistence riêng, và
tính chất "chưa mount thì chưa đánh dấu gì" của web do caller giữ. Đây không phải "hợp
nhất", đây là đổi một thuộc tính hydration đã được viết tài liệu.

**Roving tabindex → Radix là hoán đổi hành vi thật, và hiện không gì canh.**
`segmented-control.tsx:88` tự cài `onKeyDown`, `:110` tự tính `tabIndex` gồm cả trường
hợp chưa chọn gì. Radix khác về wrapping, `loop`, Home/End, orientation. Plan v1 ghi
"_Tín hiệu:_ test a11y hiện có đỏ" — không có test nào cả. **Viết test bàn phím trước
khi hoán đổi**, mô tả hành vi hiện tại, rồi mới đổi.

**Alert hợp nhất theo bản mạnh hơn.** Popup phân biệt severity bằng fill-vs-outline
**cộng** hue, để người không phân biệt hai màu vẫn đọc ra; web chỉ có hue.

`status-indicator` giữ `role="status"` đơn lẻ — comment ghi rõ đã thử thêm
`aria-live`/`aria-atomic` và một số screen reader xử lý sai.

## Related Code Files

- Create: `packages/ui/src/react/{card,alert,badge,toggle-group,select,checkbox,label,separator,status-indicator,theme-toggle,direction-toggle}.tsx`
- Move: `apps/web/src/lib/language-name.ts` → `packages/ui/src/react/lib/language-name.ts`,
  **export từ barrel** (không nội bộ). Không vào root export — `Intl.DisplayNames`,
  Hermes không đảm bảo có.
- Create: `packages/ui/src/react/skin-guard.spec.ts`
- Create: `packages/ui/src/react/toggle-group-keyboard.spec.tsx` (viết **trước** bước hoán đổi)
- Modify: `apps/web` — mọi import từ `@/components/ui/*` và `@/lib/language-name`
- Delete: `apps/web/src/components/ui/`, `apps/web/src/components/translate/direction-toggle.tsx`
- Do NOT touch: 6 component còn lại trong `translate/` ngoài dòng import

## Implementation Steps

1. Test bàn phím cho hành vi roving tabindex **hiện tại**, chạy được, xanh trên bản cũ.
2. Sinh từng component bằng CLI, re-skin theo bảng Phase 4, thêm vào barrel.
3. ToggleGroup thay `segmented-control`; test bước 1 phải vẫn xanh, hoặc chênh lệch được
   ghi lại và chấp nhận có ý thức.
4. ThemeToggle dựng controlled; hai app giữ persistence riêng.
5. `skin-guard.spec.ts`: 0 `dark:`, 0 `bg-accent`/`text-accent-foreground` trong
   `packages/ui/src`. **Không** guard `text-sm` — `apps/web/src/components` hôm nay có 0
   occurrence, guard đó bảo vệ một vi phạm chưa từng xảy ra.
6. Chuyển import, xoá thư mục cũ, chạy gate.

## Success Criteria

- [ ] `apps/web/src/components/ui/` bị xoá; 11 component export từ `@chatofy/ui/react`
- [ ] `languageName` export từ barrel; `live-panel.tsx` import được nó; **không** với tới root export
- [ ] Test bàn phím ToggleGroup tồn tại và xanh — tín hiệu rủi ro phát được
- [ ] `skin-guard.spec.ts` xanh qua `turbo run test`, mutation-verified bằng một `dark:`
- [ ] ThemeToggle controlled; web giữ tính chất "chưa mount thì chưa đánh dấu"
- [ ] Alert mang cả fill-vs-outline lẫn hue
- [ ] `token-parity` + `token-contrast` xanh; `turbo lint typecheck test build` xanh

## Risk Assessment

**Re-skin hoá ra là viết lại.** Giả định chịu lực của cả hướng "token chatofy thắng".
_Tín hiệu:_ một component cần bậc size mà thang vai trò không có.
_Phản ứng:_ thêm đúng bậc đó vào thang (và `tokens.ts` + guidelines), không lặng lẽ nhét
`text-sm`. Xảy ra ở ≥3 component thì dừng, xem lại hướng.

**Radix đổi ngữ nghĩa bàn phím.** _Tín hiệu:_ test bước 1 đỏ sau bước 3.
_Phản ứng:_ giữ bản tự cài cho component đó, ghi lý do. Radix không phải mục tiêu tự thân.
