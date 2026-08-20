---
phase: 3
title: 'Subpath, exports, shared theme'
status: completed
priority: P1
effort: '1d'
dependencies: [1]
---

# Phase 3: Subpath, exports, shared theme

## Overview

Mở `@chatofy/ui/react` mà không động vào root export, và giải bài "hai gốc Tailwind, một
theme" **không** bằng codegen.

## Requirements

- Functional: package export hai entry — `.` (token, zero-dep, Metro đọc) và `./react`.
- Functional: `react`/`react-dom` là peerDependencies; `radix-ui` (hoặc các package lẻ),
  `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@chatofy/types`
  là dependencies thật.
- Functional: `token-parity.spec.ts` đọc **cả** `globals.css` **và** CSS entry của popup.
- Non-functional: output entry `.` byte-identical **sau một lần install sạch hoàn toàn**.

## Architecture

**Không sinh `theme.css`.** Ba lý do độc lập, mỗi cái đủ để bỏ:
`globals.css:12-15` ghi "there is deliberately no codegen"; sinh CSS từ `tokens.ts` rồi
so nó với `tokens.ts` là kiểm generator với chính nó, giết phần lớn assertion của
`token-parity.spec.ts`; và `--font-sans` phụ thuộc `--font-inter` do `next/font` bơm lúc
render, không có nguồn trong `tokens.ts`.

Thay bằng: popup có CSS entry **viết tay** riêng, mang `@theme inline` của nó, và
`token-parity.spec.ts` được mở rộng để so **cả hai** file với cùng `MAPPING` viết tay.
Không bước build mới, không nặng `prepare`, và cả hai file vẫn do người viết nên
assertion vẫn sai được. Cái này là cơ chế đồng bộ, y như hôm nay — chỉ nhân đôi số file
nó canh.

Ranh giới rõ: **`theme` là token màu/radius/type. Font stack, `@layer base` reset, và
`@custom-variant dark` là của từng surface**, không dùng chung. Popup giữ
`system-ui, -apple-system, 'Segoe UI'` của nó.

**Hai tsup config trên một `dist`.** Config hiện tại có `clean: true`; config thứ hai
copy từ nó sẽ xoá output của cái đầu, và `files: ["dist"]` nghĩa là thứ rơi ra ngoài
không được publish. Một bước dọn duy nhất trước cả hai, `clean: false` trên cả hai — hoặc
`outDir` tách. Kiểm bằng install sạch, không bằng build ấm.

**`"use client"`.** react entry là all-client, `banner: { js: '"use client"' }`,
`splitting: false`. Quy tắc ghi vào code: helper dùng được ở server phải có entry riêng
không banner, nếu không banner biến nó thành client reference và Next lỗi.
`buttonVariants` hôm nay không có importer ngoài `button.tsx`, nên an toàn — nhưng đó là
sự thật hết hạn được.

## Related Code Files

- Create: `packages/ui/tsup.react.config.ts`, `packages/ui/src/react/index.ts`,
  `packages/ui/src/lib/utils.ts` (`cn`), `packages/ui/components.json`
- Create: `apps/extension/entrypoints/popup/theme.css` (viết tay, `@theme inline`)
- Modify: `packages/ui/package.json` (exports, deps, peerDeps, `prepare`, `files`)
- Modify: `packages/ui/tsup.config.ts` (chỉ phần `clean`, nếu buộc phải)
- Modify: `apps/web/src/design/token-parity.spec.ts` (đọc hai file)
- Modify: `packages/ui/README.md` — bullet "**No dependencies**" ở `:44` là đúng cái
  phase này phá; sửa **ở đây**, nơi ràng buộc thật sự đổi, không để tới Phase 8
- Do NOT touch: giá trị trong `tokens.ts`, `entrypoints/content/**`

## Implementation Steps

1. Exports map hai entry; giữ `main`/`types` cũ trỏ tokens làm fallback.
2. tsup thứ hai; giải bài `clean` bằng một bước dọn chung.
3. Viết `theme.css` của popup bằng tay từ `tokens.ts`, **không** copy `--font-sans` và
   `@layer base`.
4. Mở rộng `token-parity.spec.ts` sang file thứ hai; mutation-prove: đổi một giá trị
   trong file popup làm spec đỏ.
5. Chốt umbrella-vs-lẻ cho Radix (mặc định: **lẻ**, để bề mặt cài khớp bề mặt dùng).
6. Kiểm `@chatofy/types` có tạo vòng không.
7. `pnpm install --frozen-lockfile` trên worktree detached.

## Success Criteria

- [x] `import('@chatofy/ui')` không kéo gì — `root-export.spec.ts` giờ **đi theo đồ thị
      import** từ `index.ts` thay vì liệt kê thư mục, và mutation-verified
- [x] `token-parity.spec.ts` đọc cả hai file; hai mutation trên file popup (một hex lệch,
      một scheme sập về một palette) đều làm nó đỏ. 92 → 161 test
- [x] `theme.css` của popup không chứa `--font-sans` hay `@layer base`
- [x] `pnpm install --frozen-lockfile` trên worktree tách rời chạy được; `wxt prepare` của
      extension chạy sau đó, tức là cả hai entry đã sinh kịp
- [x] `react.js`/`react.cjs` mở đầu `"use client";`; `index.js`/`index.cjs` **không**
- [x] `packages/ui/README.md` nói đúng ranh giới mới, sửa ngay ở phase làm nó đổi
- [x] mobile typecheck không đổi; `check-single-react.mjs` xanh
- [x] Radix **lẻ**, không umbrella — bề mặt cài bằng bề mặt dùng, khớp
      `@radix-ui/react-slot` web đang dùng

## Risk Assessment

**`prepare` xoá mất output.** Đây là failure mode thật, không phải "chậm": config thứ hai
mang `clean: true` sẽ xoá `dist/index.js`, và Metro, Next, WXT đều resolve vào file
không tồn tại. Nó nổ ở `pnpm install` trên checkout sạch — đúng trường hợp README ghi là
"cách nó lọt tới CI lần trước".
_Tín hiệu:_ bước 7 đỏ. _Phản ứng:_ tách `outDir`, đừng chia sẻ thư mục.

**Hai file `@theme` trôi khỏi nhau.** _Tín hiệu:_ bước 4 mutation không đỏ → spec chưa
thật sự đọc file thứ hai. _Phản ứng:_ sửa spec trước khi đi tiếp; đó là toàn bộ lý do
phase này bỏ generator.

## Outcome

Generator bỏ hẳn, đúng như đã chốt. Popup có `theme.css` viết tay, và
`token-parity.spec.ts` giờ chạy `describe.each` trên **hai** surface với cùng một MAPPING
viết tay. 92 test thành 161. Mutation trên file popup làm nó đỏ, nên file thứ hai được
đọc thật chứ không phải khai suông.

**Ba chỗ tôi khai ít hơn plan, có chủ đích.**

Plan liệt kê `radix-ui`, `cva`, `lucide-react`, `@chatofy/types` là dependency của Phase 3.
Nhưng phase này chưa có component nào — chỉ `cn` dùng `clsx` + `tailwind-merge`. Khai
trước là knip đỏ suốt một phase, và một công cụ đỏ thường xuyên là công cụ người ta lướt
qua. Chúng vào cùng component dùng chúng: Slot/cva/lucide ở Phase 4, `@chatofy/types` ở
Phase 5.

`@chatofy/types` khi tới sẽ là **devDependency** + `import type`, không phải dependency:
`DirectionToggle` chỉ cần `TranslationDirection` như kiểu, mà `@chatofy/types` kéo `zod`
theo. Không có vòng — `@chatofy/types` chỉ phụ thuộc `zod` và `@chatofy/config`.

`@chatofy/config` **bỏ khỏi** `packages/ui`: Phase 1 đổi `extends` sang đường dẫn tương
đối, nên link workspace không còn chịu lực. `packages/realtime-client` đã ở đúng hình
dạng đó từ trước.

**Bẫy H12 không nổ, vì bước dọn nằm ngoài cả hai config.** `build` và `prepare` bắt đầu
bằng `rm -rf dist`, và cả hai tsup config đều `clean: false`. Nếu để `clean: true` ở
config thứ hai thì nó xoá output của config đầu, và `files: ["dist"]` biến đó thành một
package cài xong thiếu entry — đúng ca README ghi là đã lọt tới CI một lần.

`peerDependenciesMeta` đánh dấu react/react-dom **optional**: Metro không bao giờ resolve
`./react`, nên không được đòi `apps/mobile` phải có `react-dom` — thứ nó không có và
không nên có.
