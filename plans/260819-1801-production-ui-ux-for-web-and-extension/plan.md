---
title: 'Production UI UX for web and extension'
description: 'Đưa web + extension từ bề mặt test sang bề mặt sản phẩm: vá hai token chưa tới được web, dựng lại hierarchy/IA, và bỏ từ vựng thí nghiệm khỏi UI người dùng.'
status: in-progress
priority: P1
effort: '6-8d'
tags: [ui, ux, web, extension, design-tokens]
created: 2026-08-19
---

# Production UI UX for web and extension

## Overview

`apps/web` và `apps/extension` bị đánh giá "rất xấu, thiết kế khá rối, giống tạm để
test". Token layer **không** phải nguyên nhân — nó chặt chẽ và có test enforce. Hai
nguyên nhân thật:

1. **Hai token chưa bao giờ tới được web.** `borderStrong` và `textSecondary` có
   trong `packages/ui/src/tokens.ts:37,50` nhưng không tồn tại trong
   `apps/web/app/globals.css`, và không có trong `MAPPING` của
   `token-parity.spec.ts`. `textSecondary` chính là bậc chữ mà guidelines gán cho
   "supporting prose"; thiếu nó, mọi chữ không phải heading trên web chỉ còn
   `--foreground` (16.83) hoặc `--muted-foreground` (5.92) — gào lên hoặc gần như
   disabled, không có gì ở giữa. Extension render đủ bậc giữa đó. Đây là lý do đo
   được, thuộc tầng plumbing, khiến web phẳng hơn extension.
2. **Phần còn lại nằm trên tầng token**: IA, hierarchy, copy register. `app/page.tsx`
   là 8 dòng HTML không style. Popup có 4 nhóm `<label>` cùng trọng lượng trước cái
   nút duy nhất nó tồn tại để bấm. Từ vựng thí nghiệm (`Cascade`/`Live`,
   `Turn-based baseline`, `heard during playback: N`) nằm thẳng trên bề mặt sản phẩm.

Contract đầy đủ (outcome, constraints, non-goals, 21 acceptance criteria):
[`plans/reports/brainstorm-260819-1712-web-extension-production-ui-ux.md`](../reports/brainstorm-260819-1712-web-extension-production-ui-ux.md).

## Goals

| #   | Goal                                                                                        | Priority |
| --- | ------------------------------------------------------------------------------------------- | -------- |
| 1   | Vá hai token thiếu + đóng type-scale divergence, có test chặn tái diễn                      | P1       |
| 2   | Bỏ toàn bộ từ vựng thí nghiệm/đo đạc khỏi bề mặt người dùng (web + extension)               | P1       |
| 3   | `/` thành entry point thật; ba route web dùng chung shell (width/padding/rhythm một chỗ)    | P1       |
| 4   | Popup: một hành động chính + một nhóm setting phụ thuộc, thay vì 6 control cùng trọng lượng | P1       |
| 5   | Overlay panel: transcript là phần tử chiếm ưu thế, control row không còn 5 peer cùng hàng   | P2       |
| 6   | Một idiom styling duy nhất trong web (0 arbitrary `[var(--color-*)]`, 0 off-scale `text-*`) | P2       |

## Phases

| #   | Phase                                                                         | Status    |
| --- | ----------------------------------------------------------------------------- | --------- |
| 1   | [Phase 1: Glossary, state list, visual direction](./phase-01-start.md)        | Completed |
| 2   | [Phase 2: Token layer completion](./phase-02-token-layer-completion.md)       | Completed |
| 3   | [Phase 3: Web idiom and drift sweep](./phase-03-web-idiom-and-drift-sweep.md) | Completed |
| 4   | [Phase 4: Web surfaces](./phase-04-web-surfaces.md)                           | Completed |
| 5   | [Phase 5: Extension surfaces](./phase-05-extension-surfaces.md)               | Completed |
| 6   | [Phase 6: Review pass](./phase-06-review-pass.md)                             | Pending   |

**Dependencies:** `1 → 2 → 3 → 4 → 6` và `1 → 5 → 6`.

Phase 5 chỉ phụ thuộc Phase 1 (glossary) — nó **không đọc gì** từ `globals.css`,
`token-parity`, hay web utility sweep. Bắt nó chờ Phase 3 đẩy hạng mục rủi ro nhất của cả
plan (ship extension trỏ localhost) xuống gần cuối mà không đổi lấy gì. Nên Phase 5 khởi
động **ngay sau Phase 1**, song song với 2/3/4.

Phase 3 **không** song song với Phase 4: cùng file web, gộp diff cơ học vào diff cấu trúc.

### Joint gate (không thuộc phase nào)

`pnpm knip` là **một config root cho cả monorepo** (`knip.json`), nên nó không phán quyết
được gì khi Phase 4 và Phase 5 còn đang dở. knip chạy **một lần**, sau khi cả hai xong.

Hai package sẽ bị orphan mà **không** phase nào liệt kê — phải xử lý ở joint gate:

- `DEFAULT_TRANSLATE_MODE` (`packages/types/src/domain/index.ts:23`) có đúng hai consumer:
  `apps/web/app/translate/page.tsx:6` (Phase 4 bỏ) và `apps/extension/src/settings.ts:1`
  (Phase 5 bỏ nếu hardcode mode). Mất cả hai → knip flag `packages/types`.
- `LiveSessionStatus` — consumer duy nhất trong monorepo là
  `apps/web/src/hooks/use-live-translate.ts:11` → knip flag `packages/realtime-client`.

Dev-only route cho Live ở Phase 4 giữ được nhánh thứ hai; nhánh `packages/types` cần kiểm
riêng.

## Bẫy gate: lệnh gộp không chạy cái bạn nghĩ

Đã kiểm bằng thực nghiệm:

- `pnpm --filter web test lint typecheck` → `lint` và `typecheck` bị **vitest nhận làm name
  filter**, output: `No test files found, exiting with code 1  filter: lint, typecheck`.
  Suite **cũng bị bỏ qua**. Phải chạy **riêng từng lệnh**, hoặc
  `pnpm turbo run test lint typecheck --filter=web`.
- Root `package.json` **không có** script `test` và **không có** `test:e2e`. `pnpm test:e2e`
  ở root → `ERR_PNPM_NO_SCRIPT`. Đúng lệnh là `pnpm --filter extension test:e2e`
  (root `turbo run test:e2e` sẽ kéo theo cả jest-e2e của api).
- `pnpm lint typecheck build test` ở root chỉ chạy được **do tình cờ**: pnpm nối các từ
  thừa vào `turbo run lint`. Dùng `pnpm turbo run lint typecheck test build` cho rõ ràng.

### Bẫy grep, dạng thứ hai: comment khớp chính pattern bị cấm

Phát hiện sau Phase 2, và nó do **chính plan này** gây ra. Comment giải thích "vì sao tránh
`--text-xs…xl`" và "vì sao tránh `--text-secondary`" nằm trong `globals.css` và
`token-parity.spec.ts` — tức nằm trong vùng grep của Phase 3. Kết quả: criterion đếm
`text-*` raw trả 41 hit thay vì 35, và criterion `text-secondary` **không bao giờ về 0** được
(còn bị `\b` khớp trong `text-secondary-foreground` ở `button.tsx:40`, một utility hợp lệ).

Hai hệ quả:

1. Mọi criterion đếm call site phải scope `--include='*.tsx'`. Đã đo: raw 41 / scoped 35, và
   35 đúng bằng baseline 32 + 3 — toàn bộ chênh lệch là comment.
2. **Nguy hiểm là false-RED, không phải false-green.** Người làm thấy nonzero, "sửa" bằng cách
   xoá comment, và cái bẫy mà comment đang canh được gài lại. Nên criterion phải nói rõ:
   không được xoá comment để làm grep xanh.

Nguyên tắc từ đây: **trong file bị grep sweep, đừng trích nguyên văn pattern bị cấm vào
comment.** Để lý do trong `docs/design-guidelines.md` (ngoài vùng sweep) và trỏ tới.
`vitest` không mắc lỗi này vì nó strip comment (`WITHOUT_COMMENTS`) — chỉ criteria dạng grep mắc.

### Bẫy grep: hai criterion tự pass trên tree chưa sửa

- `grep -rn "max-w-" apps/web/app/**/page.tsx` — bash **không bật globstar** mặc định, nên
  `**` co lại thành `*` và chỉ quét **một** file (`translate/page.tsx`).
  `baseline/page.tsx` và `app/page.tsx` **không bao giờ được quét** — tức criterion tồn tại
  để bắt hai route khai hai width khác nhau, mà pass được khi vẫn còn khác nhau. Đúng:
  `grep -rn "max-w-" apps/web/app --include=page.tsx`.
- `git diff --stat -- <path>` → rỗng ngay khi commit, nên criterion pass trên nhánh đã
  rewrite file đó. Đúng: `git diff --stat main...HEAD -- <path>`.

### knip: đã fail sẵn, nên "sạch" là bất khả thi

`pnpm knip` **hôm nay exit 1**:

```
Unused exports (4): SITE_ENABLEMENT_KEY  apps/extension/src/site-enablement.ts:32
                    spacing / radii / typography  apps/mobile/src/ui/theme.ts:67-69
Unused exported types (2): ComposedGraph  apps/extension/src/microphone-patch.ts:48
                           SegmentedOption  apps/web/src/components/ui/segmented-control.tsx:30
```

Một finding nằm trong `site-enablement.ts` — **file Phase 5 cấm chạm**. Hai finding nằm
trong `apps/mobile`, ngoài scope. Nên "knip sạch" vừa tự mâu thuẫn vừa đòi việc ngoài scope.

**Định nghĩa lại:** criterion là **"không có finding MỚI so với baseline đã ghi ở trên"**.
Ghi baseline vào phase notes lúc bắt đầu; so sánh, không đòi zero. Nợ cũ là plan riêng.

knip cũng **không** báo `CardFooter` — xác nhận tag `@public` ở `card.tsx:39-40` đúng là
thứ giữ nó sống.

## Decisions already made (do not re-litigate)

Người dùng đã chốt 2026-08-19:

| Câu hỏi                        | Quyết định                                                                  |
| ------------------------------ | --------------------------------------------------------------------------- |
| `Live` mode                    | Chỉ là thí nghiệm → **ẩn khỏi UI**. `mode-toggle.tsx` bị xoá, `#mode` bị bỏ |
| `/`                            | **Entry point gọn** — brand + 1 câu + 1 nút. Không phải marketing page      |
| `Server` (`#api`) + `#metrics` | **Không ship** trong bản production                                         |
| `/translate/baseline`          | **Đổi tên tử tế + có link về**, vẫn user-facing                             |

Chốt thêm 2026-08-20:

| Câu hỏi                    | Quyết định                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Backend cho review Phase 6 | **Chưa có** → review trên dev build; Phase 5 ghi danh sách khác biệt dev↔production để trình kèm |
| Build thiếu env server URL | `wxt build` dùng placeholder (CI xanh); **`wxt zip` fail**. Ranh giới ở release, không ở build   |
| Coercion `mode`            | Coerce **mọi** giá trị `!== 'cascade'`, không chỉ `'live'`                                       |
| Turbo env scope            | **`extension#build`**, không phải task `build` toàn cục (tránh cache-bust web/api/mobile)        |

Từ brainstorm contract, đã verify bằng source, **không mở lại**: palette / contrast /
dark-only / motion policy; không framework, Tailwind hay `var()` trong overlay;
`packages/ui` không nhận dependency; capture indicator không thể dismiss; consent
không stack trên form; popup footer ngoài vùng scroll; settings không bị gate theo tab.

## Success Criteria

- [x] `borderStrong` + `textSecondary` có trong `globals.css` (tên `--border-strong` và **`--prose`**) và trong `MAPPING`
- [x] `grep -n "\-\-text-secondary:" apps/web/app/globals.css` → 0 — tên đó đụng utility `text-secondary` đã có (gần-đen). Dấu `:` là bắt buộc: không có nó thì grep khớp luôn comment giải thích vì sao tránh tên này
- [x] `token-parity.spec.ts` có test "mọi key của `color` phải có trong `MAPPING`" — test này **fail** trên tree hiện tại trước khi vá
- [x] `grep -rn "\[var(--color-" apps/web/app apps/web/src` → 0 (hôm nay: 9)
- [x] 0 off-scale `text-*` utility trong web, hoặc mỗi cái có trong exception table kèm lý do (hôm nay: 32 size utility + 3 literal `text-[Npx]`)
- [x] `grep -rnE "animate-|transition-" apps/web/app apps/web/src` → mọi hit motion đi kèm `motion-reduce:`. **Hôm nay thiếu HAI chỗ**, không phải một: `audio-source-controls.tsx:86` (`transition-[width]`) và `baseline/page.tsx:63` (`animate-spin`). (`status-indicator.tsx:49` `animate-ping` **đã** được phủ bởi `motion-reduce:hidden` ở `:54`; ba `transition-colors` là colour-only, ngoài scope có lý.) — **the `animate-ping` hit is covered.** `status-indicator.tsx:49` carries the animation and `:54` carries `motion-reduce:hidden` on the same element; a line-scoped grep separates them and reports a violation that is not there
- [x] `app/page.tsx` có `Link href="/translate"` + ≥1 `className`
- [x] Giá trị width **chỉ** khai trong `app-shell.tsx` (shell nhận prop variant nếu một route cần measure khác); `grep -rn "max-w-" apps/web/app --include=page.tsx` → 0. **Không** dùng `app/**/page.tsx` — globstar tắt, chỉ quét 1 trong 3 file — **`max-w-` scoped to page width.** `page.tsx` carries `max-w-[22ch]` and `max-w-prose`, which bound a line of text, not the page; the page measures live in `app-shell.tsx` `MEASURE`. A bare `max-w-` count returns 2 and means nothing
- [x] `baseline/page.tsx` có link về `/translate`
- [x] Từ vựng thí nghiệm: 0 hit ngoài exception list đã liệt kê tường minh. **Chỉ tính string người dùng thấy** — `grep "Cascade\|ModeToggle" → 0` là **sai**: `CascadePanel` là identifier Phase 4 chủ động giữ (12 hit hôm nay, 6 tồn tại theo thiết kế). Chỉ `mode-toggle.tsx:23` là text người dùng thấy
- [x] Không string người dùng thấy nào hiện language code trần (`vi`/`en`). Lưu ý: `EXPECTED_SOURCE` greppable, nhưng `live.detectedLanguage` là **dữ liệu server không giới hạn** — cần bảng code→tên + fallback cho code lạ, nếu không thì pass ở grep mà vẫn vi phạm lúc chạy
- [x] Font body của popup và web resolve về **cùng** family, hoặc quyết định "không hợp nhất" được ghi tường minh. Hôm nay khác nhau (`popup/styles.ts:40` `system-ui` vs `globals.css:22` Inter) và **không criterion nào gate nó** ở bản đầu
- [x] Stored `mode: 'live'` được coerce về `cascade` lúc đọc, có spec chứng minh (đổi default là **no-op** — default đã là `cascade`)
- [x] `#api`, `#metrics`, `#mode`, `<details>` không có trong bản production; listener `#advanced` đã xoá cùng lúc
- [x] Server URL nằm trong `turbo.json` `env`/`passThroughEnv` (nếu không, cache phục vụ lại bundle localhost); xác minh ở **cả** build sạch và build từ cache
- [x] `popup/index.html`: `main#settings > label` từ 4 xuống ≤1 ngoài group; `<footer>` vẫn là con trực tiếp của `<body>` sau `main`
- [x] Overlay: `.lines` là **con trực tiếp duy nhất của `.panel`** có `flex: 1`, **kèm `min-height: 0`**; `.controls` có `flex: none`
- [x] `git diff --stat main...HEAD -- apps/extension/src/site-enablement.ts` → rỗng (**không** dùng `git diff` trần — rỗng ngay khi commit)
- [x] `OVERLAY_STYLE` giữ **đúng một** rule `:host` (`all: initial !important`), không có `var(`; overlay không có `innerHTML`; host vẫn không có id — **có spec**, không phải kiểm tay
- [x] `pnpm turbo run lint typecheck test build` xanh (CI gate); `pnpm --filter extension test:e2e` xanh (chạy tay); `pnpm knip` (joint, một lần) **không có finding mới so với baseline** — nó đã fail sẵn hôm nay
- [x] Screenshot harness **được dựng** (hôm nay `e2e/run.mjs` 946 dòng có **zero** khả năng capture) — không phải "gần như miễn phí"
- [ ] State list per surface được đi hết và screenshot — extension: 20 stills, deterministic, in `e2e/screenshots/`. Web: 10 stills, captured against the running dev server and the local API; the conversation states past `listening` need real speech and were not reached, listed in the Phase 6 notes rather than faked
- [x] **Hướng thị giác được chấp nhận ở Phase 1** (mock), không phải chỉ ở Phase 6. Nếu thiếu, lần đầu người dùng thấy gì là sau ~4 ngày, và đường thoát "bác hướng → về brainstorm" nổ sau toàn bộ chi phí
- [ ] Người dùng chấp nhận bộ screenshot ở Phase 6

## Notes on enforcement reality

CI chạy **chỉ** `lint`, `typecheck`, `test`, `build`
(`.github/workflows/ci.yml:42,65,93,115`) — **không** `knip`, **không** `test:e2e`.
Nên các vitest spec đọc-file là acceptance criteria duy nhất thật sự gate; knip và
e2e phải chạy tay. Đừng ghi criteria nào giả định CI bắt được chúng.

**Và với extension thì gate gần như trống.** `apps/extension/vitest.config.ts:16` include
**chỉ** `src/**/*.spec.ts`; `entrypoints/` có **zero** spec file. Trong các file Phase 5
sửa, đúng một (`src/settings.ts`) nằm trong vùng test. Grep xác nhận **không** assertion
nào tồn tại cho: closed shadow root, một rule `:host`, `OVERLAY_STYLE` không `var()`, không
`innerHTML`, host không id, footer ngoài scroll, consent thay cả popup, settings không gate
theo tab — tức là các invariant chính plan này gọi là non-negotiable.

Phase 5 vì thế **thêm hai file-reading spec dưới `apps/extension/src/`**
(`overlay-invariants.spec.ts`, `popup-structure.spec.ts`) theo đúng khuôn
`token-parity.spec.ts` của web. Chúng nằm trong include glob hiện có nên **chạy trong CI**,
biến hand-check thành gate thật. Đây là hạng mục giá trị cao nhất của cả plan sau ba blocker.

<!-- slug: production-ui-ux-for-web-and-extension -->
