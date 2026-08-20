---
phase: 1
title: 'Toolchain — make the gates able to see the work'
status: completed
priority: P1
effort: '1-1.5d'
dependencies: []
---

# Phase 1: Toolchain — make the gates able to see the work

## Overview

Không component nào ở phase này. Nó tồn tại vì red-team chứng minh mọi cổng plan v1 dựa
vào đều không chạy được: guard nằm trong package không có test runner, `.tsx` nằm ngoài
mọi glob, guard đọc `.output` chạy ở job không có `.output`. Sửa trước, rồi mới có quyền
tin vào chữ "xanh".

## Requirements

- Functional: `packages/ui` chạy được vitest qua `turbo run test`.
- Functional: `turbo lint typecheck test` **nhìn thấy** file `.tsx` trong `apps/extension`.
- Functional: đúng một bản `react` resolve được từ mỗi app, canh bằng một script chạy
  trong CI. (Metro bundle được là mục tiêu ban đầu; hoá ra `expo export` đã hỏng từ
  trước vì lý do không liên quan — xem Outcome.)
- Functional: guard đọc build artifact có task riêng phụ thuộc build của **chính** package.
- Non-functional: không đổi hành vi runtime nào. Phase này chỉ đụng cấu hình và CI.

## Architecture

**Bốn điểm mù, bốn cách sửa.**

`packages/ui` không có `test` script và không có vitest, nên `turbo run test` bỏ qua nó.
Thêm vitest + `"test": "vitest run"` + `vitest.config.ts` **trước** khi có spec nào được
viết vào đó ở Phase 4.

`apps/extension/tsconfig.json:16` include `**/*.ts`; không có option `jsx` ở đâu;
`package.json:16` eslint glob `.ts`; `vitest.config.ts:15-16` là `environment: 'node'` +
`src/**/*.spec.ts`. Mở rộng cả bốn, thêm `"jsx": "react-jsx"`, thêm `happy-dom` và một
render library, và cho phép chọn environment theo file. `apps/web/vitest.config.ts:18-19`
cũng vậy — Phase 5 cần render story trong test.

`turbo.json:45` `"test": { "dependsOn": ["^build"] }` — dấu mũ là build của
**dependency**, không bao giờ là `extension#build`. Guard đọc `.output` cần task riêng
với `dependsOn: ["build"]` (không mũ), và phải **fail to** khi `.output` vắng mặt, không
skip. Repo đã có tiền lệ skip-when-absent (`3a738f3`) và đó chính là cách một guard
thành xanh vĩnh viễn.

**React version, và cái bẫy peerDependencies.** `.npmrc:2-3` có `auto-install-peers=true`
và `node-linker=hoisted`. Khai `react` là peerDependency của `packages/ui` **không** tạo
được cách ly như plan v1 tưởng — pnpm sẽ cài và hoist một bản react thoả range, bên cạnh
hai bản đã ghim (web `19.2.5`, mobile `19.2.0`). Hai bản React một bundler là "Invalid
hook call", và nó là lỗi _resolution_, `tsc` không thấy. Thống nhất một version trên cả
ba nơi, rồi **chứng minh bằng resolve thật**, không bằng typecheck.

**Cung ứng.** `.github/dependabot.yml` là allow-list; comment của nó nêu đích danh
`react` là bị bỏ qua ngầm. Tám package sắp vào một extension giữ `tabCapture`,
`scripting` và microphone. Mở rộng allow-list và thêm `pnpm audit` vào CI trước khi
package đầu tiên vào.

## Related Code Files

- Modify: `packages/ui/package.json` (vitest devDep, `test` script)
- Create: `packages/ui/vitest.config.ts`
- Modify: `apps/extension/tsconfig.json` (include `.tsx`, `jsx: react-jsx`)
- Modify: `apps/extension/package.json` (eslint glob, happy-dom, render lib)
- Modify: `apps/extension/vitest.config.ts`, `apps/web/vitest.config.ts`
- Modify: `apps/web/package.json` (`@chatofy/ui` devDependency → dependency)
- Modify: `apps/mobile/package.json`, `apps/web/package.json` (react version thống nhất)
- Modify: `turbo.json` (task guard artifact, `dependsOn: ["build"]`)
- Modify: `.github/dependabot.yml`, `.github/workflows/ci.yml` (audit step)
- Do NOT touch: `apps/extension/entrypoints/**`, `packages/ui/src/**`

## Implementation Steps

1. vitest vào `packages/ui`; chứng minh bằng một spec tầm thường **cố tình đỏ**, thấy nó
   đỏ qua `turbo run test`, rồi sửa cho xanh.
2. Mở ba glob của extension + `jsx`. Chứng minh: thả một `.tsx` có lỗi type, thấy
   `turbo typecheck` đỏ.
3. `@chatofy/ui` sang `dependencies` của web.
4. Thống nhất react version; verify `require.resolve('react', { paths: ['apps/mobile'] })`
   và từ web trỏ cùng một đường dẫn.
5. Task turbo cho guard artifact, với floor "đọc được ít nhất N file, nếu không thì fail".
6. dependabot allow-list + `pnpm audit --audit-level=high` vào CI.

## Success Criteria

- [x] `packages/ui` chạy test qua `turbo run test`, mutation-verified hai chiều (một callable
      trên root export, một bare import trong token module — cả hai làm nó đỏ)
- [x] `.tsx` có lỗi type làm `turbo typecheck` đỏ — chứng minh bằng probe; eslint glob bắt `.tsx`
- [x] Mỗi app resolve **đúng một** bản react — `scripts/check-single-react.mjs`, chạy trong CI.
      Version khác nhau giữa các app là hợp lệ và mong đợi (Expo ghim theo SDK); điều bị
      cấm là hai bản cùng với tới được từ **một** app. Tiêu chí v1 nói "cùng một đường
      dẫn" — sai, nó sẽ buộc mobile rời ma trận Expo mà không đổi lại được gì.
- [ ] ~~`expo export` chạy được~~ — **đỏ từ trước, không nhận vào plan này**. `expo-router/entry`
      import `@expo/metro-runtime` mà `apps/mobile/package.json` không khai. Phát hiện
      riêng, báo user; `check-single-react.mjs` là cổng Metro-adjacent thật sự chạy được.
- [x] Task `verify:build` khai `dependsOn: ["build"]` (không mũ) — guard đọc artifact có
      chỗ chạy đúng. Guard đầu tiên dùng nó ở Phase 6.
- [x] `pnpm audit --audit-level=high` chạy trong CI và **xanh**, với 16 advisory có sẵn
      ghi baseline trong `pnpm-workspace.yaml` — mutation-verified: bỏ một id làm nó đỏ.
      8 package mới nằm trong dependabot allow-list.
- [x] `turbo lint typecheck test build` xanh

## Risk Assessment

**Thống nhất react version làm hỏng mobile.** Expo ghim react theo SDK.
_Tín hiệu:_ `expo export` đỏ ở bước 4. _Phản ứng:_ mobile giữ version của nó, và
`packages/ui/react` **không** khai react peer nào cả — nó không bao giờ được mobile
resolve. Kiểm bằng resolve, không bằng suy luận.

**`expo export` chưa từng chạy trong repo này.** _Tín hiệu:_ nó đỏ vì lý do có sẵn,
không liên quan plan. _Phản ứng:_ ghi lại baseline trước khi đổi gì; nếu nó vốn đã hỏng
thì đó là phát hiện riêng, báo user, không âm thầm gánh vào plan.

## Outcome

Không component nào, đúng như dự định. Bốn điểm mù đã đóng, mỗi cái có bằng chứng đỏ-được
chứ không chỉ "đã cấu hình".

Một thứ ngoài dự kiến, và nó xác nhận tiền đề của phase: `packages/ui` không chạy nổi
vitest vì `tsconfig.json` extends preset qua **dạng export** (`@chatofy/config/...`).
`packages/realtime-client/tsconfig.json` đã ghi sẵn lỗi này và cách chữa —
_"`tsc` copes either way; Vitest's transform does not... `packages/types` gets away with
the export form only because it has no test runner."_ `packages/ui` là ca tiếp theo mà
comment đó dự đoán. Sửa: extends bằng đường dẫn tương đối.

Hai thứ báo lên user, không gánh vào plan:

1. **`pnpm audit` có 16 high + 1 critical từ trước.** Critical là `shell-quote` sâu trong
   chuỗi dev-tool của Expo. User chốt: baseline hôm nay, gate chỉ đỏ khi có CVE mới.
2. **`expo export` hỏng từ trước** — `@expo/metro-runtime` không được khai trong
   `apps/mobile/package.json`. Không phải do plan; lockfile diff chỉ có happy-dom và
   chỗ dời `@chatofy/ui`.
