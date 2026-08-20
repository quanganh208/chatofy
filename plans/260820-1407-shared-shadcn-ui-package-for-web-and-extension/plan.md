---
title: 'Shared shadcn UI package for web and extension'
description: 'Dựng shadcn + Radix trong packages/ui sau subpath @chatofy/ui/react, và cho apps/web + popup extension render từ đúng một bộ primitive.'
status: in_progress
priority: P1
effort: '8-11d'
tags: [ui, shadcn, radix, monorepo, design-tokens, extension, web]
created: 2026-08-20
blocks: [260819-1801-production-ui-ux-for-web-and-extension]
---

# Shared shadcn UI package for web and extension

## Overview

Yêu cầu: "setup shadcn radix UI ở package UI dùng chung, tất cả các component,
dùng chung cho cả extension và web" — "nên sử dụng UI framework cho đẹp và đồng nhất".

shadcn/Radix **chưa từng được setup**. Không có `components.json` ở đâu. `apps/web` có
nền của shadcn và viết theo quy ước shadcn, nhưng mọi component đều viết tay.
`apps/extension` có zero dependency UI.

Contract: [`brainstorm-260820-1343`](../reports/brainstorm-260820-1343-shared-shadcn-ui-package.md) ·
Xác minh ngoài repo: [`researcher-260820-1358`](../reports/researcher-260820-1358-shadcn-monorepo-and-wxt-react.md) ·
Red team: [`redteam-260820-1420`](../reports/redteam-260820-1420-shared-shadcn-ui-package.md)

**Bản v1 của plan này bị red-team chặn với 7 Critical.** Tất cả đã xác minh và đã sửa
vào cấu trúc dưới đây. Hai phase mới (1 và 2) tồn tại vì lý do chung: _plan v1 đặt việc
vào phase muộn hơn phase phụ thuộc nó, và dựa vào những cổng không thể chạy._

## Phạm vi thật: 2 trong 4 surface

| Surface               | Runtime                            | shadcn?                           | Vì sao                                        |
| --------------------- | ---------------------------------- | --------------------------------- | --------------------------------------------- |
| `apps/web`            | Next 16, React 19, Tailwind v4     | có                                | `@theme inline` đã tự ghi "shadcn-compatible" |
| extension **popup**   | vanilla HTML + CSS string          | có, sau khi thêm React + Tailwind | trang extension thường                        |
| extension **overlay** | closed shadow root, `all: initial` | **không**                         | `overlay-invariants.spec.ts:71` cấm `var(`    |
| `apps/mobile`         | Expo / React Native                | **không**                         | DOM                                           |

Overlay là **non-goal**, và là thuộc tính an ninh chứ không phải sở thích: `:host {
all: initial }` không reset custom property, nên overlay dùng biến là overlay để trang
họp sơn lại được. `packages/ui` gốc giữ **zero-dependency** — Metro import trực tiếp.

## Goals

| #   | Goal                                                                                     | Priority |
| --- | ---------------------------------------------------------------------------------------- | -------- |
| 1   | Mọi cổng nhìn thấy được việc: `packages/ui` chạy test, extension thấy `.tsx`, e2e vào CI | P1       |
| 2   | `@chatofy/ui/react` giữ 11 component; root vẫn zero-dep, mobile chạy được thật           | P1       |
| 3   | `apps/web/src/components/ui/` biến mất; popup render từ cùng bộ đó                       | P1       |
| 4   | Một `@theme` cho hai app, parity spec đọc **cả hai** file                                | P1       |
| 5   | Overlay + mobile không bị kéo vào; `overlay-invariants.spec.ts` nguyên vẹn               | P1       |
| 6   | Bảng màu đã đo sống sót: `token-parity` + `token-contrast` xanh suốt                     | P1       |

## Quyết định đã chốt

**Token chatofy thắng, shadcn cấp cấu trúc.** Radix behaviour, cva variant, composition
vào nguyên; skin đổi sang token sản phẩm.

**Không thêm alias `--accent`.** shadcn `--accent` (nền hover xám) đúng bằng
`--secondary` = `surfaceRaised`; shadcn `--popover` đúng bằng `--card` = `surface`.
Re-skin cơ học `bg-accent`→`bg-secondary`, `text-accent-foreground`→`text-foreground`,
`bg-popover`→`bg-card`, `text-popover-foreground`→`text-card-foreground`.
**Không token mới nào cả** — v1 tự mâu thuẫn ở `--popover` (một câu bảo re-skin, câu sau
bảo thêm token, Phase 2 lại thêm vào file popup không đọc). Mâu thuẫn đã gỡ về phía
re-skin.

**Bóc sạch `dark:`.** Web có **0** utility `dark:`. `globals.css:17` khai
`@custom-variant dark (&:is(.dark *))`, nhưng `:root.dark` chỉ set `color-scheme`, và ở
"system" — mặc định — không có class nào. `light-dark()` vẫn đổi token; `dark:` không
bao giờ chạy. shadcn stock có `dark:bg-input/30` trên SelectTrigger.

**Không sinh `theme.css`.** v1 đề xuất emit từ `tokens.ts`. Bỏ, vì ba lý do độc lập:
`globals.css:12-15` ghi thẳng "**there is deliberately no codegen**"; sinh CSS từ
`tokens.ts` rồi so CSS đó với `tokens.ts` là kiểm generator với chính nó — phần lớn
assertion của `token-parity.spec.ts` thành không thể sai; và `--font-sans` phụ thuộc
`--font-inter` do `next/font` bơm lúc render, không có nguồn trong `tokens.ts`.
Thay bằng: popup có CSS entry viết tay riêng, và **`token-parity.spec.ts` đọc cả hai
file** với cùng `MAPPING`. Không bước build mới, assertion vẫn sai được.

**Build bằng tsup, gate ở Phase 4.** Template `vite-monorepo` của shadcn ship raw source
và Vite không cần config; nhưng `tsup.config.ts` ghi một lần cháy đã xác minh —
source-only exports làm Vite qua WXT không resolve nổi tsconfig. Plugin giữ
`"use client"` (`esbuild-plugin-preserve-directives`) đã kiểm và trượt: v0.0.11, bỏ
hoang từ 2024-09-17, một maintainer.

## Phases

| #   | Phase                                                                                                         | Status    |
| --- | ------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | [Phase 1: Toolchain — make the gates able to see the work](./phase-01-start.md)                               | Completed |
| 2   | [Phase 2: e2e into CI, and non-vacuous](./phase-02-e2e-into-ci-and-non-vacuous.md)                            | Completed |
| 3   | [Phase 3: Subpath, exports, shared theme](./phase-03-subpath-exports-shared-theme.md)                         | Completed |
| 4   | [Phase 4: Button probe and the source-vs-build gate](./phase-04-button-probe-and-the-source-vs-build-gate.md) | Completed |
| 5   | [Phase 5: Remaining web primitives](./phase-05-remaining-web-primitives.md)                                   | Completed |
| 6   | [Phase 6: React and Tailwind into the popup](./phase-06-react-and-tailwind-into-the-popup.md)                 | Completed |
| 7   | [Phase 7: Popup rewrite](./phase-07-popup-rewrite.md)                                                         | Completed |
| 8   | [Phase 8: Consistency and docs](./phase-08-consistency-and-docs.md)                                           | Pending   |

**Dependencies:** `1 → 2`, `1 → 3 → 4 → 5`, `4 → 6 → 7`, `2 → 7`, `5 + 7 → 8`.

Phase 1 và 2 đứng trước mọi thứ vì red-team chứng minh mọi cổng plan v1 dựa vào đều
không chạy: guard nằm trong package không có test runner, `.tsx` nằm ngoài mọi glob,
guard đọc `.output` chạy ở job không có `.output`, và e2e — lưới an toàn duy nhất cho
bản viết lại 419 dòng — không nằm trong CI.

Phase 2 phải xong **trước** Phase 7, không phải song song: lưới an toàn có thật rồi mới
được nhảy.

## Component inventory

11 thứ vào `@chatofy/ui/react`: Button, Card, Alert, Badge, ToggleGroup, Select,
Checkbox, Label, Separator, StatusIndicator, và hai composition dùng chung —
`DirectionToggle`, `ThemeToggle`.

`DirectionToggle` và `ThemeToggle` là composition, không phải primitive, nhưng cả hai
surface DOM đều cần — đó mới là tiêu chí. `DirectionToggle` kéo theo `languageName`,
có **hai** consumer (`direction-toggle.tsx` và `live-panel.tsx`), nên nó phải được
export từ `/react`, không phải nội bộ package. Nó dùng `Intl.DisplayNames` mà Hermes
không đảm bảo có, nên **không** vào root export.

`app-shell` và 6 component còn lại trong `translate/` ở lại app.

**Voice vẫn là hai control khác nhau sau plan này** (web: SegmentedControl, popup:
`<select>`). Không thuộc phạm vi đã chốt; ghi ra để không ai tưởng "đồng nhất" đã trọn.
Radix Select do đó có đúng một consumer: `<select id="voice">` của popup, chuyển ở
Phase 7.

## Success Criteria

- [x] `import('@chatofy/ui')` không kéo react/radix vào graph; **đúng một** bản react
      resolve được từ `apps/mobile`; `expo export` chạy được
- [x] `@chatofy/ui/react` export 15 (kế hoạch nói 11; SegmentedControl/DirectionToggle/
      StatusIndicator/ThemeToggle thêm vào); `apps/web/src/components/ui/` không còn file
- [x] Popup render từ cùng bộ đó; `#consent-ok`, `#toggle`, `<main>` giữ nguyên
- [x] `token-parity.spec.ts` đọc **cả** `globals.css` **và** CSS entry của popup
- [x] `overlay-invariants.spec.ts` không sửa dòng nào và xanh
- [x] Guard biên overlay: manifest build ra có `content_scripts[].css` **rỗng**, và
      không file nào dưới `.output/chrome-mv3/content-scripts/*.css`
- [x] Guard: không file nào dưới `entrypoints/popup/` chứa `innerHTML`/`dangerouslySetInnerHTML`
- [x] Grep-test: 0 `dark:` và 0 utility mang nghĩa `accent` của shadcn trong `packages/ui/src`
- [x] e2e chạy trong CI, và 9 check sideways **không vacuous** (mutation-verified)
- [x] `turbo lint typecheck test build` xanh, và gate đó thật sự nhìn thấy `.tsx`

## Quan hệ với plan khác

`blocks: 260819-1801`. Phase 6 (review pass) của plan đó đang `blocked` và sẽ review
đúng những component sắp bị thay; phần overlay của nó độc lập và vẫn chạy được.

## Red Team Review

### Session — 2026-08-20

**Findings:** 28 (28 accepted, 0 rejected) · 4 reviewer dispatch, **3 delivered**
Failure Mode Analyst không trả kết quả. Địa hạt của nó (thứ tự install, turbo graph,
CI, popup lai) được phủ gián tiếp bởi C6/H11/H12/H21 — phủ do chồng lấn, không phải
do lượt review riêng. Build/install-ordering là vùng ít được soi độc lập nhất.
**Severity:** 7 Critical, 13 High, 8 Medium

Mọi finding Critical đã tự xác minh lại bằng source trước khi chấp nhận. Chi tiết đầy đủ
kèm trích dẫn `file:line`: [`redteam-260820-1420`](../reports/redteam-260820-1420-shared-shadcn-ui-package.md).

| #   | Finding                                                                                                    | Sev      | Applied to       |
| --- | ---------------------------------------------------------------------------------------------------------- | -------- | ---------------- |
| 1   | Guard nằm trong `packages/ui` — không test script, không vitest, không bao giờ chạy                        | Critical | Phase 1          |
| 2   | `theme.css` sinh ra: đảo no-codegen, làm parity tautological, không mang được `--font-sans`                | Critical | Phase 3          |
| 3   | Toolchain extension mù `.tsx`: tsconfig include, thiếu `jsx`, eslint glob, vitest env/glob                 | Critical | Phase 1          |
| 4   | 9 check sideways deref `querySelector('main')` không guard → abort; vacuous trên pane ẩn                   | Critical | Phase 2          |
| 5   | Guard `var(--color-` không bao giờ match được dưới `@theme inline` — chứng minh bằng compile               | Critical | Phase 6          |
| 6   | Hai guard đọc `.output` chạy ở job không có `.output` (`test.dependsOn: ["^build"]`)                       | Critical | Phase 1, 6       |
| 7   | Phase xoá `main.ts` nhưng `popup-structure.spec.ts` đọc nó → ENOENT                                        | Critical | Phase 7          |
| 8   | `auto-install-peers` + `hoisted` vô hiệu peerDeps; web react 19.2.5 vs mobile 19.2.0                       | High     | Phase 1          |
| 9   | `@chatofy/ui` là devDependency của web, sắp thành runtime import                                           | High     | Phase 1          |
| 10  | Mobile chỉ được canh bằng `tsc`; không có script `build`; Metro không bao giờ chạy                         | High     | Phase 1          |
| 11  | Tailwind Preflight reset popup vanilla; "UI cũ nguyên vẹn" là suy luận sai                                 | High     | Phase 6          |
| 12  | tsup `clean: true` + config thứ hai trên cùng `dist` → xoá lẫn nhau                                        | High     | Phase 3          |
| 13  | `--popover`: plan tự mâu thuẫn, và thêm vào file popup không đọc                                           | High     | plan.md, Phase 4 |
| 14  | `theme-toggle.tsx` không có trong Create list nhưng phase sau lại Modify nó                                | High     | Phase 5          |
| 15  | `lucide-react` + `@chatofy/types` thiếu trong dependency list                                              | High     | Phase 3          |
| 16  | ThemeToggle: web đọc localStorage sync, extension đọc chrome.storage async → phải controlled               | High     | Phase 5          |
| 17  | Radix Select không có consumer nào khi plan kết thúc                                                       | High     | plan.md, Phase 7 |
| 18  | Step "chứng minh check render đỏ trước khi viết lại" bất khả thi: check đã tồn tại, `#toggle` có text tĩnh | High     | Phase 2          |
| 19  | 8 package mới vào extension có `tabCapture`/`scripting`; dependabot allow-list không phủ; không audit gate | High     | Phase 1          |
| 20  | Không có test a11y nào → tín hiệu rủi ro roving-tabindex→Radix không thể phát                              | High     | Phase 5          |
| 21  | Content-script CSS là asset riêng + manifest `css[]`, tiêm vào trang họp — guard nhắm nhầm chunk JS        | High     | Phase 6          |
| 22  | Phase cuối xoá lý do CSP dựa trên bằng chứng không tồn tại lâu                                             | High     | Phase 8          |
| 23  | `languageName` có hai consumer, không phải một                                                             | High     | Phase 5          |
| 24  | Không guard `innerHTML`/`dangerouslySetInnerHTML` cho popup sau khi có React                               | Medium   | Phase 7          |
| 25  | Consent từ HTML tĩnh vào cây React — disclosure vào vùng có thể hỏng                                       | Medium   | Phase 7          |
| 26  | `shots.length === 20` hard-code; "e2e 46/0" khẳng định ở nhiều phase trong khi vài phase đổi số            | Medium   | Phase 2          |
| 27  | README "No dependencies" không nằm trong scope sửa; design-guidelines là bổ sung chứ không phải đính chính | Medium   | Phase 3, 8       |
| 28  | `rounded-md`→`rounded-[var(--radius-md)]` là no-op và tệ hơn; `pageerror` báo lỗi React dưới tên sai       | Medium   | Phase 4, 2       |

### Whole-Plan Consistency Sweep

Chạy sau khi áp dụng. Delta: bỏ generator `theme.css`; bỏ token `--popover`; đổi
"10 primitive" → "11 component"; thêm Phase 1 và 2; đánh số lại 6→8; "5 component còn
lại trong translate/" → 6; "e2e 46/0" → "không có failure, số check cập nhật có chủ ý ở
phase nào đổi nó".

## Unresolved

1. `radix-ui` (umbrella) hay các package `@radix-ui/react-*` lẻ? Web đang dùng lẻ
   (`@radix-ui/react-slot`). Umbrella đổi bề mặt cài đặt đáng kể — Phase 3 chốt, ưu tiên
   lẻ để bề mặt cài khớp bề mặt dùng.
2. WXT phát CSS content-script thành manifest `css[]` hay nội tuyến vào chunk JS ở
   version này? Chưa xác minh được (`node_modules` bị hook chặn). Phase 6 xác minh bằng
   một `wxt build` thật trước khi viết guard.
3. `packages/ui` phụ thuộc `@chatofy/types` có tạo vòng không? Chưa kiểm.
