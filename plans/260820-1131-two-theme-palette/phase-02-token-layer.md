---
phase: 2
title: 'Tầng token và parity spec'
status: pending
priority: P1
effort: '4-5h'
dependencies: [1]
---

# Phase 2: Tầng token và parity spec

## Overview

Đưa hai palette vào `packages/ui/src/tokens.ts`, và mở rộng parity spec để nó kiểm **cả
hai**. Không kỳ vọng thay đổi thị giác nào ở phase này — mobile và popup vẫn đọc palette tối,
web vẫn render như cũ. Đây là tầng nền cho Phase 3 và 4.

## Requirements

- Functional: `tokens.ts` xuất hai palette; `overlay.*` giữ nguyên một bộ.
- Functional: `token-parity.spec.ts` kiểm cả hai, và **fail** khi chỉ một nửa được điền.
- Functional: `apps/mobile/src/ui/theme.ts` compile và trỏ hai khoá vào hai palette thật.
- Non-functional: overlay nhận palette tối mới nhưng **không** có nửa sáng — không đọc `colorLight` hay `palettes`.
- Non-functional: `pnpm turbo run typecheck` xanh ở **mọi** package, không chỉ web.

## Architecture

### Shape của export quyết định ba consumer sống hay chết

`color` hiện là một object phẳng, và ba nơi import trực tiếp: `apps/mobile/src/ui/theme.ts:6`,
`apps/extension/entrypoints/content/overlay-styles.ts:1`,
`apps/extension/entrypoints/popup/styles.ts:1`. Đổi `color` thành
`{ light, dark }` làm cả ba gãy cùng lúc.

Đường ít vỡ nhất: **giữ `color` như hiện tại làm palette tối**, thêm `colorLight` bên cạnh, và
thêm `palettes = { light: colorLight, dark: color }` cho ai cần chọn lúc chạy. Overlay tiếp tục
import `color` và không biết gì về light — đúng như quyết định. Mobile đổi từ một palette sang
`palettes`. Popup đổi ở Phase 4.

Đây là lựa chọn có đánh đổi: `color` mang nghĩa "bộ tối" thay vì "bộ mặc định", nên phải ghi rõ
trong doc comment, nếu không người sau sẽ thêm khoá vào `color` mà quên `colorLight`.

### Spec chỉ kiểm một nửa là spec không kiểm gì

`token-parity.spec.ts` hôm nay iterate key của `color` và so với `MAPPING` + `globals.css`.
Nó **không** vacuous được vì nó lặp trên object đã import — đó là điểm neo đã ghi ở plan trước.
Thêm palette thứ hai mà giữ nguyên spec thì nửa sáng không có gì canh, và spec vẫn xanh.

Vá: spec lặp trên `palettes` chứ không trên `color`, và với mỗi palette đối chiếu block CSS
tương ứng (`:root` cho sáng, `.dark` cho tối, theo wiring `@custom-variant dark` có sẵn ở
`globals.css:17`). Bằng chứng nó cắn: điền `:root` nhưng để `.dark` trống → phải đỏ.

### Overlay đổi màu, và đó là đúng

Overlay import `color`. Đổi giá trị của `color` sang palette Tĩnh tối thì overlay đổi theo —
**không sửa `overlay-styles.ts` một dòng nào**. Đó là kết quả mong muốn: để overlay ở lại cyan
sẽ biến nó thành bề mặt duy nhất chưa đổi.

Cái phải giữ không phải giá trị hex mà là: overlay **không có nửa sáng**. Nó không được đọc
`colorLight` hay `palettes`, vì `prefers-color-scheme` trong content script báo theo OS chứ
không theo trang. Cộng thêm mọi bất biến cũ: một rule `:host`, không `var(`, không `innerHTML`,
host không id — `overlay-invariants.spec.ts` phải xanh **mà không bị sửa**, ngoài assertion mới
về việc không đọc palette sáng.

## Related Code Files

- Modify: `packages/ui/src/tokens.ts` (thêm palette sáng, doc comment về nghĩa của `color`)
- Modify: `apps/web/src/design/token-parity.spec.ts` (lặp trên `palettes`, hai block CSS)
- Modify: `apps/mobile/src/ui/theme.ts` (hai khoá trỏ hai palette; xoá comment đã sai)
- Modify: `docs/design-guidelines.md` (bảng số đo từ Phase 1; đóng mục "dark, and only dark")
- **Không sửa:** `apps/extension/entrypoints/content/overlay-styles.ts`
- **Không sửa:** `apps/extension/src/overlay-invariants.spec.ts` (phải xanh không cần sửa)

## Implementation Steps

1. Thêm `colorLight` và `palettes` vào `tokens.ts`. Doc comment nói rõ `color` **là bộ tối**.
2. Mở rộng `token-parity.spec.ts` lặp trên `palettes`. **Chạy trước khi điền `globals.css`** —
   phải đỏ. Test không đỏ trước khi vá là test không kiểm gì.
3. Điền `globals.css`: `:root` nhận palette sáng, `.dark` nhận palette tối. Chạy lại, phải xanh.
4. Sửa `apps/mobile/src/ui/theme.ts` trỏ hai khoá vào hai palette; xoá đoạn comment nói
   "light therefore carries the dark values for now" — nó không còn đúng.
5. Thêm assertion vào `overlay-invariants.spec.ts` rằng overlay không đọc palette sáng.
6. Cập nhật `docs/design-guidelines.md`: dán bảng tương phản Phase 1, viết lại đoạn mở đầu
   "Direction: dark, with a cool accent" — hướng đã đổi và lý do dark-only đã được thu hẹp về
   riêng overlay.
7. Gate: `pnpm turbo run lint typecheck test build`, chạy **riêng** từng lệnh nếu qua pnpm filter.

## Success Criteria

- [ ] `palettes.light` và `palettes.dark` có **cùng tập khoá**; test chứng minh, không đọc tay
- [ ] Parity spec đỏ khi `.dark` trống, xanh khi cả hai đầy — quan sát được cả hai trạng thái
- [ ] `apps/mobile` typecheck xanh; hai khoá trỏ hai palette **khác nhau**
- [ ] `overlay-styles.ts` **không** xuất hiện trong diff — nó import `color`, nên đổi giá trị của `color` là đủ; sửa file đó nghĩa là đang làm gì khác
- [ ] `overlay-invariants.spec.ts` xanh **mà không bị sửa**, cộng assertion mới về độc lập theme
- [ ] `docs/design-guidelines.md`: bảng tương phản có mặt; đoạn "dark, and only dark" được viết lại
- [ ] Web render **không đổi** so với trước phase — mọi thay đổi thị giác thuộc Phase 3

## Risk Assessment

- **Risk:** đổi shape `color` làm ba consumer gãy, rồi sửa vội bằng cast.
  **Signal:** `as` xuất hiện quanh import token.
  **Response:** giữ `color` là bộ tối, thêm cạnh nó. Không đổi nghĩa của tên đang có.
- **Risk:** parity spec mở rộng nhưng chỉ kiểm nửa sáng, nửa tối trôi.
  **Signal:** spec xanh trên tree có `.dark` trống.
  **Response:** bắt buộc quan sát trạng thái đỏ trước khi điền.
- **Risk:** đụng overlay "cho nhất quán".
  **Signal:** `overlay-styles.ts` trong diff.
  **Response:** revert. Overlay tối là quyết định, và nó là thứ giữ phase này rẻ.
