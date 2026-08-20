---
phase: 4
title: 'Button probe and the source-vs-build gate'
status: completed
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

- [x] `ring-[3px]` và `aria-invalid:border-destructive` — chỉ tồn tại trong Button của
      package — có trong CSS web build ra. Mutation: bỏ `@source` → **cả hai biến mất**
- [x] Guard directive xanh qua `turbo run verify:build`, mutation-verified: bỏ banner →
      `react.js`/`react.cjs` đỏ. Đặt ở `verify:build` chứ không `test`, vì nó đọc artifact
- [x] Next build xanh với Button đến từ bản build của package — không lỗi client/server
- [x] 7 variant (6 cũ + `link`) và 4 size; `apps/web/src/components/ui/button.tsx` biến mất
- [x] `token-parity` + `token-contrast` xanh; `turbo lint typecheck test build` 28/28
- [x] **Build thắng.** Lý do đo được ở Outcome

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

## Outcome

**Gate mở về phía build.** Không phải bằng lập luận: `react.js` và `react.cjs` mở đầu
`"use client";`, `index.js`/`index.cjs` thì không, và Next build xanh với Button import từ
`@chatofy/ui/react`. Cả ba đều là quan sát trên artifact thật. Đường lùi sang ship source
không cần dùng tới, và cũng không cần bước 6 phòng hờ.

Banner của tsup là cơ chế duy nhất giữ directive — plugin thường dùng đã bị loại ở khâu
plan vì bỏ hoang. `packages/ui/scripts/verify-build.mjs` là thứ nói nó còn nổ, và nó chạy
dưới `verify:build` (phụ thuộc `build` của chính package) chứ không dưới `test`
(phụ thuộc `^build`, tức build của **dependency**).

**Hai câu treo của plan được trả lời bởi chính CLI, và một trong hai đảo quyết định của tôi.**

Câu #1 — umbrella hay lẻ. Plan chốt "lẻ". Sai: shadcn hiện sinh ra
`import { Slot } from "radix-ui"`, tức **umbrella**. Chống lại nó là sửa import ở mọi
component sinh ra, mãi mãi, và lệch khỏi mọi lần `add` sau này. Nhận umbrella.

Câu #3 — `@chatofy/types` có tạo vòng không. Không: nó chỉ phụ thuộc `zod` và
`@chatofy/config`.

**Ba thứ phải sửa mà plan không lường.**

`components.json` cần `paths` trong tsconfig, nếu không CLI hiểu alias `@/react` theo
nghĩa đen và tạo một thư mục tên `@`. Nhưng alias chỉ dùng được **cho CLI**: bản dts đi
qua rollup-plugin-dts, thứ không áp `paths`, nên ESM/CJS build xanh còn dts đỏ — chỗ khó
đoán nhất để phát hiện một path mapping. Component commit dùng import tương đối; re-skin
gồm cả việc viết lại dòng `@/lib/utils`.

`jsx` phải khai trong tsconfig của package. Thiếu nó thì esbuild vẫn suy ra JSX từ đuôi
file và hai bản JS xanh; chỉ bản dts đỏ.

CLI không thêm `class-variance-authority` dù component sinh ra import nó.

**Re-skin giữ được một quyết định đã ghi.** Bản cũ có comment: hover là bậc màu thật, vì
làm mờ một nút trên nền tối đọc ra "disabled" chứ không phải "hovered". shadcn stock dùng
`/90` khắp nơi. Giữ bậc màu. Lấy treatment focus của shadcn (`ring-[3px]`) vì "trông đúng
shadcn" là mục tiêu, và `--ring` đã có sẵn.
