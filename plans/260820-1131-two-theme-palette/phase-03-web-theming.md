---
phase: 3
title: 'Web: hai theme và bộ chọn'
status: pending
priority: P1
effort: '5-6h'
dependencies: [2]
---

# Phase 3: Web — hai theme và bộ chọn

## Overview

Web nhận ba chế độ: light, dark, theo máy. Lựa chọn sống qua lần tải sau, và **không nháy**
theme lúc tải. Wiring Tailwind đã có sẵn từ trước; phần thật sự mới là nguồn sự thật của theme
và thứ tự chạy lúc khởi động.

## Requirements

- Functional: ba chế độ, mặc định là "theo máy".
- Functional: lựa chọn tường minh thắng `prefers-color-scheme` ở **cả hai** chiều.
- Functional: không nháy theme khi tải lại ở chế độ đã chọn.
- Functional: bộ chọn nói **đích đến**, không nói trạng thái hiện tại.
- Non-functional: không thêm dependency quản lý theme.

## Architecture

### Wiring đã có, đừng dựng lại

`globals.css:17` đã khai `@custom-variant dark (&:is(.dark *))`, và `@theme inline` map
`--color-*` sang `var(--*)`. Nghĩa là mọi utility Tailwind trong app **đã** đi qua biến — đổi
giá trị trong `:root` và `.dark` là đổi toàn bộ giao diện, không phải sửa từng component.
Comment ở đầu file nói đúng điều đó: "adding it later means filling in a `.light` block, not
re-deriving the wiring."

Hệ quả: phase này gần như không đụng file component nào. Nếu diff bắt đầu đầy `dark:` prefix
rải rác trong `.tsx` thì đã đi sai đường — đó là dấu hiệu ai đó đang vá từng chỗ thay vì đổi
biến.

### Ba trạng thái, không phải hai

"Theo máy" không phải là một trong hai giá trị mà là **vắng mặt giá trị**. Lưu `'light'`,
`'dark'`, hoặc không lưu gì. Đọc: có giá trị thì dùng; không có thì để media query quyết.
Lưu chuỗi `'system'` cũng được nhưng phải nhớ nó tương đương xoá, nếu không sẽ có bug "chọn
system rồi đổi theme máy mà giao diện không đổi".

### Nháy theme: lỗi chỉ thấy khi tải lại

App Router render trên server; `localStorage` chưa tồn tại lúc HTML đầu tiên tới trình duyệt.
Không có script chặn trong `<head>`, người chọn light trên máy dark sẽ thấy một nháy tối mỗi
lần tải. Script phải:

- nằm trong `<head>`, chạy đồng bộ, **trước** khi body paint;
- chỉ đọc storage và gắn class lên `<html>`, không làm gì khác;
- đi kèm `suppressHydrationWarning` trên `<html>`, vì server không biết class đó.

**Không có test tự động nào bắt được lỗi này.** Nó phải nằm trong danh sách kiểm tay, và bằng
chứng là ảnh chụp hoặc quay màn hình lúc tải lại, không phải một dòng "đã kiểm".

### Bộ chọn đặt ở đâu

`AppShell` (`apps/web/src/components/layout/app-shell.tsx`) là nơi duy nhất khai header cho cả
ba route — đó là chỗ đúng. Đặt trong từng page là tái tạo đúng thứ Phase 4 của plan trước vừa
gộp lại.

## Related Code Files

- Modify: `apps/web/app/globals.css` (giá trị đã điền ở Phase 2; ở đây thêm hỗ trợ media query)
- Modify: `apps/web/app/layout.tsx` (script chặn trong `<head>`, `suppressHydrationWarning`)
- Modify: `apps/web/src/components/layout/app-shell.tsx` (bộ chọn trong header)
- Create: `apps/web/src/components/ui/theme-toggle.tsx`
- Create: `apps/web/src/lib/theme.ts` (đọc/ghi lựa chọn; dùng chung giữa script và component)
- Modify: `apps/web/src/design/token-parity.spec.ts` (nếu cần thêm khối media query)

## Implementation Steps

1. Cho `globals.css` hỗ trợ ba trạng thái: `:root` sáng, `.dark` tối, và một khối
   `@media (prefers-color-scheme: dark)` áp bảng tối khi **không** có lựa chọn tường minh.
   Bẫy: khối media phải thua class, nếu không "chọn light trên máy dark" sẽ hỏng.
2. Viết `lib/theme.ts`: đọc, ghi, xoá lựa chọn. Một chỗ duy nhất biết tên khoá storage.
3. Thêm script chặn vào `layout.tsx`. Giữ nó ngắn — nó chạy trước mọi thứ và không debug được.
4. Dựng `theme-toggle.tsx`. Nhãn nói đích đến. Có nhãn cho trình đọc màn hình.
5. Gắn vào `AppShell`.
6. Kiểm bốn chiều: máy sáng + chọn tối, máy tối + chọn sáng, cả hai về "theo máy".
7. Kiểm nháy: tải lại ở từng chế độ, quay lại nếu cần.
8. Chụp lại bộ screenshot web ở **cả hai** theme.

## Success Criteria

- [ ] Bốn chiều đều đúng: máy sáng/chọn tối, máy tối/chọn sáng, và hai lần về "theo máy"
- [ ] Đổi theme của OS khi đang ở "theo máy" thì giao diện đổi theo, không cần tải lại
- [ ] Không nháy theme khi tải lại — bằng chứng là ảnh/quay màn hình, không phải lời khẳng định
- [ ] `grep -rn "dark:" apps/web/src apps/web/app --include=*.tsx` → 0 thêm mới so với hôm nay.
      Wiring đi qua biến; `dark:` rải rác là dấu hiệu vá từng chỗ
- [ ] Bộ chọn có nhãn trợ năng và focus ring thấy được
- [ ] Bộ chọn khai **một** lần, trong `AppShell`
- [ ] `pnpm --filter web test` / `typecheck` / `lint` / `build` — bốn lệnh **riêng**, đều xanh
- [ ] Screenshot web đủ hai theme

## Risk Assessment

- **Risk:** khối media thắng class, "chọn light trên máy dark" hỏng.
  **Signal:** đúng một trong bốn chiều sai — dễ bỏ sót nếu chỉ kiểm hai.
  **Response:** criterion bắt kiểm cả bốn.
- **Risk:** nháy theme lọt vì không test nào bắt.
  **Signal:** không có, theo định nghĩa.
  **Response:** bằng chứng hình ảnh, không phải lời.
- **Risk:** rải `dark:` khắp component thay vì đổi biến.
  **Signal:** diff nhiều `.tsx`, ít `.css`.
  **Response:** criterion đếm. Wiring đã có, không cần chạm component.
- **Risk:** hydration mismatch vì server không biết class.
  **Signal:** cảnh báo trong console dev.
  **Response:** `suppressHydrationWarning` trên `<html>`, đúng phạm vi đó, không rải rộng.
