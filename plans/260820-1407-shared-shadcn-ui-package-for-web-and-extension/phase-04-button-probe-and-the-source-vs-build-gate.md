---
phase: 4
title: 'Button probe and the source-vs-build gate'
status: pending
priority: P1
effort: '0.5-1d'
dependencies: [3]
---

# Phase 4: Button probe and the source-vs-build gate

## Overview

Một component đi hết đường: sinh bằng CLI, re-skin, xuất từ package, render trong web.
Phase này tồn tại để **quyết định**, không phải để giao Button — nó là chỗ build-vs-source
được chứng minh hoặc bị lật, trước khi mười component nữa cưỡi lên.

## Requirements

- Functional: `Button` từ `@chatofy/ui/react` thay `apps/web/src/components/ui/button.tsx`
  ở cả 4 chỗ import, giữ 6 variant (kể cả `live`) và 4 size.
- Non-functional: quyết định build-vs-source ghi lại trong phase này kèm lý do đo được.

## Architecture

**Bước một, trước mọi thứ khác: `@source`.** Tailwind v4 bỏ qua `node_modules` và path
gitignored — `packages/ui/dist` là cả hai. Thiếu `@source` thì mọi class chỉ dùng bên
trong component của package **không được sinh ra**: render đúng cấu trúc, chết sạch phần
nhìn, trông như lỗi CSS lặt vặt. Hướng của nó phụ thuộc build-vs-source: build → mỗi app
trỏ vào `dist`; source → CSS của package glob ra apps.

**Quy tắc re-skin** (cơ học, grep được):

| shadcn stock              | thành                                                  |
| ------------------------- | ------------------------------------------------------ |
| `bg-accent`               | `bg-secondary`                                         |
| `text-accent-foreground`  | `text-foreground`                                      |
| `bg-popover`              | `bg-card`                                              |
| `text-popover-foreground` | `text-card-foreground`                                 |
| `border-input`            | `border-border-control`                                |
| `text-sm`                 | `text-body` (14px) hoặc `text-hint` (12px) tuỳ vai trò |
| `dark:*` bất kỳ           | **xoá**                                                |

`rounded-md` **giữ nguyên**. Plan v1 định đổi sang `rounded-[var(--radius-md)]`; đó là
no-op — `globals.css:57` đã khai `--radius-md`, nên `rounded-md` vốn đã resolve đúng, và
dạng arbitrary-value chỉ tệ hơn.

Không thêm token nào. `--popover` không tồn tại và không cần tồn tại.

## Related Code Files

- Create: `packages/ui/src/react/button.tsx`
- Create: `packages/ui/src/react/directive.spec.ts` (output react entry mở đầu `"use client"`)
- Modify: `packages/ui/src/react/index.ts`
- Modify: `apps/web/app/globals.css` (chỉ `@source`)
- Modify: 4 file import Button trong `apps/web`
- Delete: `apps/web/src/components/ui/button.tsx` (chỉ khi 4 import đã chuyển)

## Implementation Steps

1. `@source`. Xác nhận trước bằng một class chỉ tồn tại trong package — nếu nó không
   xuất hiện trong CSS build ra, dừng và sửa `@source` trước khi đi tiếp.
2. `pnpm dlx shadcn@latest add button -c packages/ui`.
3. Re-skin theo bảng. Giữ variant `live` — của sản phẩm, shadcn không có.
4. `directive.spec.ts`, chạy **qua `turbo run test`** (Phase 1 đã làm nó chạy được).
5. Chuyển 4 import, xoá bản cũ, chạy toàn bộ gate.

## Success Criteria

- [ ] Class chỉ dùng trong package **có** trong CSS web build ra
- [ ] `directive.spec.ts` xanh **qua `turbo run test`**, và mutation-verified: bỏ banner làm nó đỏ
- [ ] Next build không lỗi client/server
- [ ] 6 variant + 4 size giữ hành vi; `apps/web/src/components/ui/button.tsx` biến mất
- [ ] `token-parity` + `token-contrast` xanh; `turbo lint typecheck test build` xanh
- [ ] **Quyết định build-vs-source ghi vào phase này**, kèm lý do

## Risk Assessment

**`"use client"` không sống sót qua tsup.** Rủi ro chính, và lý do phase tồn tại. esbuild
hoist directive đi mất theo mặc định. Cách vá thường nêu —
`esbuild-plugin-preserve-directives` — **đã kiểm và trượt**: v0.0.11, sửa lần cuối
2024-09-17, một maintainer, chưa từng ra 0.1.
_Tín hiệu:_ Next lỗi ở hook đầu tiên, hoặc `directive.spec.ts` đỏ.
_Phản ứng — đã quyết trước:_ lật react subpath sang **ship source**. Đổi `exports` sang
`src/*.tsx`, thêm `transpilePackages: ['@chatofy/ui']` cho Next, Vite không cần gì, dời
`@source` sang hướng ngược lại. Entry tokens vẫn build cho Metro.

**Nếu phản ứng đó được kích hoạt, thêm bước 6 vào phase này:** thử resolve react subpath
qua Vite-của-WXT ngay, không đợi Phase 6. Cháy cũ trong `tsup.config.ts` là cùng bundler;
phát hiện muộn hai phase thì đắt hơn nhiều.
_Nếu cả hai đường đều hỏng:_ dừng, báo user. Đường thứ ba là tsdown (0.22.14, sửa
2026-08-12) nhưng đổi bundler của package ba consumer đọc là quyết định riêng.
