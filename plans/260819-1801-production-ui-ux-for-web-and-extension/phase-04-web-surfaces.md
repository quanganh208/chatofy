---
phase: 4
title: 'Web surfaces'
status: completed
priority: P1
effort: '1-1.5d'
dependencies: [3]
---

# Phase 4: Web surfaces

## Overview

Diff cấu trúc cho web: một shell dùng chung, `/` thành entry point thật, `/translate`
tái phân bổ trọng lượng quanh hành động chính và bản dịch, baseline page có tên tử tế +
link về, và bỏ toàn bộ instrument đo đạc. Chạy **song song với Phase 5** — file set rời nhau.

## Requirements

- Functional: `app/page.tsx` render brand + một câu giá trị + một CTA vào `/translate`.
- Functional: content width / page padding / vertical rhythm khai báo ở **đúng một** file.
- Functional: `baseline/page.tsx` có link về `/translate` + tên mới từ glossary.
- Functional: `mode-toggle.tsx` **bị xoá**; header `/translate` không còn toggle.
- Functional: counter `heard during playback` bị bỏ khỏi bề mặt người dùng.
- Functional: language-mismatch notice dùng tên ngôn ngữ, không phải code trần.
- Non-functional: bản dịch là phần tử lớn nhất trên màn hình `/translate`.
- Non-functional: mọi control có đủ 5 state, gồm focus ring 2px `accentText` bắt buộc.

## Architecture

**Shell.** Hôm nay ba route là ba document rời: `translate/page.tsx:45` khai
`max-w-2xl … gap-8 px-6 py-10`, `baseline/page.tsx:41` khai
`max-w-xl … justify-center gap-6 p-6`, và baseline không có đường về. Rút một shell
component sở hữu width/padding/rhythm; ba route dùng nó. Criterion là
`grep -rn "max-w-" apps/web/app --include=page.tsx` → 0 (dạng `app/**/page.tsx` chỉ quét
1 trong 3 file — globstar tắt mặc định).

**`Live` bị ẩn — hệ quả lan rộng hơn một lần xoá.** Quyết định đã chốt: Live là thí
nghiệm. Nên:

- `mode-toggle.tsx` (54 dòng) bị xoá hoàn toàn.
- `translate/page.tsx` bỏ state `mode`, bỏ nhánh `mode === 'cascade' ? … : …`, mount
  thẳng `CascadePanel`.
- `live-panel.tsx` **không xoá** — nó vẫn là đường so sánh cho đồ án, chỉ không còn
  route người dùng tới.

  **`@public` không phải một lựa chọn ở đây.** `CardFooter` là một _export_ không dùng
  trong một file **vẫn reachable** (`ui/card.tsx`, được baseline page import). Sau khi xoá
  toggle, `live-panel.tsx` và `use-live-translate.ts` thành **file** unreachable — entry
  của `apps/web` trong knip là `src/**/*.spec.ts` cộng `app/**` qua Next plugin, và web chỉ
  có hai spec (`token-parity`, `token-contrast`). knip's `@public` chặn báo unused-_export_,
  **không** chặn báo unused-_file_. Nên phép loại suy với `CardFooter` là sai, và chỉ còn
  **hai** lựa chọn thật: giữ sau một dev-only route (`app/` nên Next plugin thấy), hoặc xoá
  thật. Chọn dev-only route — người dùng chốt "ẩn khỏi UI", không phải "xoá khả năng đo".

- State `running` trong `translate/page.tsx` từng tồn tại để giữ toggle khi session
  đang chạy. Không còn toggle → xét xem `onRunningChange` còn nghĩa gì; nếu không, bỏ
  luôn prop khỏi `CascadePanel` (và `LivePanel` nếu nó còn được mount ở đâu).

**Hierarchy.** Bản dịch phải là thứ lớn nhất. Hôm nay `live-panel.tsx:175` đặt bản dịch
ở 22px trong khi h1 trang là 24px — tiêu đề to hơn nội dung chính. Sau Phase 2, h1 là
`text-title` (28) và bản dịch là `text-translation` (17), nên **quan hệ vẫn sai**. Đây là
việc layout, không phải việc token: bản dịch cần chiếm ưu thế bằng không gian, contrast
và vị trí, chứ không chỉ bằng cỡ chữ. Ghi rõ ở đây vì đó là cái bẫy dễ nhất của phase này.

## Related Code Files

- Create: `apps/web/src/components/layout/app-shell.tsx`
- Modify: `apps/web/app/page.tsx` (từ 8 dòng thành entry point thật)
- Modify: `apps/web/app/layout.tsx` (nếu shell mount ở đây)
- Modify: `apps/web/app/translate/page.tsx` (bỏ mode state + toggle)
- Modify: `apps/web/app/translate/baseline/page.tsx` (tên mới + link về + shell)
- Modify: `apps/web/src/components/translate/cascade-panel.tsx` (bỏ echo counter, prose)
- Modify: `apps/web/src/components/translate/live-panel.tsx` (copy + language name)
- Delete: `apps/web/src/components/translate/mode-toggle.tsx`
- Modify: `docs/design-guidelines.md` (section Layout/IA)

## Implementation Steps

1. Rút `app-shell.tsx` sở hữu width/padding/rhythm. Chuyển `/translate` sang nó trước
   (route đang chạy được), xác nhận không đổi hình, rồi mới tới hai route kia.
2. Viết `app/page.tsx`: brand, một câu, một CTA `Link href="/translate"`. Entry point
   gọn — **không** hero/marketing (đã chốt).
3. Xoá `mode-toggle.tsx`; bỏ state `mode` + nhánh điều kiện trong `translate/page.tsx`;
   mount `CascadePanel` trực tiếp.
4. Dựng dev-only route cho Live (trong `app/`, để Next plugin của knip thấy nó là
   reachable) và set mode **tường minh** cho session của route đó — không dựa vào stored
   value (xem bẫy coercion ở Phase 5).
   **Chưa chạy knip để phán quyết ở đây.** knip là một config root cho cả monorepo
   (`knip.json`), nên nó thấy luôn cả các sửa đổi extension đang dở của Phase 5 → kết quả
   không phán quyết được gì khi hai phase chạy song song. knip là gate **chung** sau khi cả
   Phase 4 và 5 xong (xem plan.md §Joint gate).
5. Xét `onRunningChange`/`running`: nếu không còn consumer thì bỏ prop.
6. Tái phân bổ trọng lượng `/translate`: bản dịch chiếm ưu thế (không gian + contrast +
   vị trí, không chỉ cỡ chữ); control tụt xuống hàng phụ; status locus **một** chỗ.
7. Bỏ counter `heard during playback` (`cascade-panel.tsx:145`) + tooltip (`:143`).
8. Viết lại prose panel từ giải thích cơ chế sang cách dùng, theo glossary Phase 1.
9. `live-panel.tsx:142-151`: dùng tên ngôn ngữ thay `vi`/`en`. **Hai nửa, không chỉ một:**
   `EXPECTED_SOURCE` (`live-panel.tsx:35-38`) là nửa greppable, đổi dễ. Nhưng
   `live.detectedLanguage` (`use-live-translate.ts:32`, `string | null`) là **dữ liệu server
   không giới hạn** — model tự detect. Cần một bảng code→tên **và** một fallback cho code
   không có trong bảng (hiển thị code trần? "ngôn ngữ khác"?). Nếu bỏ qua, criterion pass ở
   grep mà vẫn vi phạm lúc chạy. Xem §Unresolved.
10. Baseline page: tên mới từ glossary, link về `/translate`, dùng shell.
11. Đi hết web state list của Phase 1, screenshot từng state. Với state cần backend
    (`live.error`, `languageMismatch`, `connecting`, `translating`): force giá trị tạm
    để review, và **nói rõ** đã force — không có Playwright trong `apps/web` và không thêm.
12. Gate — **chạy riêng từng lệnh** (xem M1 trong plan.md): `pnpm --filter web test`,
    `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm --filter web build`.
    knip **không** ở đây — nó là joint gate sau Phase 4 + 5.

## Success Criteria

- [x] `app/page.tsx` có `Link href="/translate"` + ≥1 `className`; render brand + 1 câu + 1 CTA
- [x] Giá trị width **chỉ** khai trong `app-shell.tsx`; shell nhận prop variant nếu một route cần measure hẹp hơn. Kiểm bằng `grep -rn "max-w-" apps/web/app --include=page.tsx` → 0 **và** `grep -rn "max-w-" apps/web/src/components/layout/app-shell.tsx` → có. (Bản đầu đòi "0 hit" cứng — cái đó đo sự tuân thủ chứ không đo thiết kế, và cách rẻ nhất để pass là giặt width qua một file wrapper. Không dùng `app/**/page.tsx`: globstar tắt mặc định, chỉ quét 1 trong 3 file)
- [x] `baseline/page.tsx` có link về `/translate`
- [x] `mode-toggle.tsx` không còn tồn tại. **Không** dùng `grep "Cascade\|ModeToggle" → 0`: `CascadePanel` là identifier phase này chủ động giữ (12 hit hôm nay; 6 tồn tại theo thiết kế ở `translate/page.tsx:10,57`, `cascade-panel.tsx:60,72`, `live-panel.tsx:14,73`). Chỉ kiểm **string người dùng thấy** — hôm nay chỉ `mode-toggle.tsx:23`
- [x] Counter `heard during playback` không còn trên bề mặt người dùng
- [x] 0 string người dùng thấy hiện `vi`/`en` trần, **và** có bảng code→tên kèm fallback cho code lạ — `live.detectedLanguage` là dữ liệu server không giới hạn, không phải enum
- [x] Bản dịch là phần tử chiếm ưu thế thị giác trên `/translate` (reviewer xác nhận trên screenshot)
- [x] Mọi control mới/đổi có đủ 5 state + focus ring 2px `accentText`
- [x] Live có dev-only route trong `app/`, set mode tường minh; **không** dùng `@public` cho unused-file
- [x] `pnpm --filter web` test / lint / typecheck / build — **bốn lệnh riêng**, đều xanh
- [x] Web state list được đi hết + screenshot; state phải force có ghi chú rõ
- [x] knip **không** được dùng làm gate của riêng phase này (joint gate sau Phase 4 + 5)

## Phase notes (executed 2026-08-20)

### What shipped

- `src/components/layout/app-shell.tsx` (new) — owns width, padding, rhythm, brand and the
  optional way back. Three routes adopted it; `grep -rn "max-w-" apps/web/app --include=page.tsx`
  → **0**.
- `app/page.tsx` — from 8 unstyled lines to brand + one sentence + one CTA into `/translate`.
- `app/translate/page.tsx` — mode state and toggle gone, `CascadePanel` mounted directly, footer
  measurement link gone, **no page-level `h1` at all**.
- `app/translate/live/page.tsx` (new) — the continuous experiment, reachable by URL, linked from
  nowhere.
- `app/translate/baseline/page.tsx` — heading now names the task, `AppShell` with a way back.
- `src/lib/language-name.ts` (new) — code → name with a real fallback.
- `mode-toggle.tsx` — **deleted**.

### `measure` is a variant, and that was a criterion change

The original criterion demanded `max-w-` appear in zero page files, full stop. Applied
literally that forces the landing page and the transcript to share one line length, and the
cheapest way to pass it would have been laundering a second width through a wrapper — a
criterion measuring compliance rather than design. The shell takes `wide` | `reading`; the
_values_ live in one file, which is the property that was actually wanted.

### The hierarchy fix was subtraction, not a bigger font

The scale stops at 28 (`xl`) and the approved mock showed the translation near 34, so
dominance could not come from growing it. It came from removing what competed: the display-size
product name is gone from `/translate` entirely, and the brand sits in the shell at
`text-body` as a way home. On the live stage the translation takes `text-title` (28) against a
`text-prose` source at 14 — the largest thing on the page is now the thing the page is for.

Adding a step above 28 would have meant editing `packages/ui/src/tokens.ts`, which reaches
`apps/mobile/src/ui/theme.ts`, and that is an explicit non-goal.

### `onRunningChange` died with the toggle

It existed for exactly one reason — hold the mode toggle while a session ran. No toggle, no
consumer, so the prop is gone from both panels along with the `useEffect` that maintained it
and the now-unused `useEffect` imports. Two fewer moving parts, not a rename.

### The unlinked route is what `@public` could not be

knip after this phase is **byte-identical to the Phase 1 baseline** — and specifically
`LivePanel`, `use-live-translate` and `DEFAULT_TRANSLATE_MODE` are **not** flagged, because
`/translate/live` lives under `app/` where the Next plugin sees it. This is the concrete
confirmation that the red team was right: `@public` suppresses unused-_export_ reports, never
unused-_file_, so it could not have saved those two files. `packages/types` also stays
un-orphaned because the extension still imports `DEFAULT_TRANSLATE_MODE` — Phase 5 must not
assume otherwise.

Honest limit: unlinked is not excluded from the production bundle. Doing that is build config,
not UI, and it is out of scope. Anyone typing the URL reaches it today.

### Next typed routes caught a real thing

`AppShell`'s `back.href` typed as `string` failed the build — this app has typed routes on. It
now borrows `Link`'s own href type, so a back link to a nonexistent route is a compile error.
Worth keeping rather than casting around: a dead end is exactly what this shell was added to
remove.

### Verified in the running app, not just in source

The user's existing dev server on 3001 (16h old, not started by me — reused rather than
duplicated) had hot-reloaded the changes:

- `/` serves "Speak Vietnamese. Be heard in English." — no "Coming soon"
- `/translate` markup contains **no** `Cascade` and no measurement link; brand present, empty
  state present
- `/translate/baseline` serves "Translate a recording" + "Back to the translator"
- `/translate/live` returns HTTP 200 and **0** pages link to it

### Gates

`pnpm --filter web test` 57/57 · `typecheck` clean · `lint` clean · `build` clean (5 routes
prerendered). `pnpm knip` unchanged from baseline. Both sweep targets from Phase 3 still 0.

### One thing left for Phase 6

The state list has four states unreachable without a backend (`live.error`,
`languageMismatch`, `connecting`, `translating`). They were not exercised here. Phase 6
reviews them against a forced value, and the report must say they were forced.

## Risk Assessment

- **Risk:** xoá mode toggle làm `LivePanel` + `use-live-translate` thành dead code, knip
  báo, và phản xạ dễ nhất là dán `@public` cho im — đúng cái anti-pattern `CardFooter`
  đang mắc.
  **Signal:** `@public` mới xuất hiện mà không có lý do viết ra.
  **Response:** hoặc dev-only route, hoặc xoá thật, hoặc `@public` **kèm** lý do trong
  doc comment. Không im lặng.
- **Risk:** Live là đường so sánh latency của đồ án. Bỏ khỏi UI mà không giữ đường chạy
  nào có thể làm mất bằng chứng đo đạc.
  **Signal:** không chạy được so sánh cascade-vs-live sau phase này.
  **Response:** giữ route dev-only. Người dùng đã chọn "ẩn khỏi UI", không phải "xoá khả
  năng đo" — đừng suy diễn rộng hơn quyết định.
- **Risk:** làm bản dịch chiếm ưu thế chỉ bằng cỡ chữ sẽ thất bại, vì scale chỉ tới 28 và
  bản dịch là 17.
  **Signal:** bản dịch vẫn nhỏ hơn tiêu đề trên screenshot.
  **Response:** dùng không gian, contrast, vị trí; nếu vẫn không đủ thì đây là câu hỏi
  cho Phase 6, không phải cớ thêm token mới.
- **Risk:** web state coverage một phần không tới được không có backend.
  **Signal:** không.
  **Response:** force giá trị + nói rõ. Không ngụ ý có harness.
