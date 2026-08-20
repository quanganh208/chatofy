---
phase: 3
title: 'Web idiom and drift sweep'
status: completed
priority: P2
effort: '6-8h'
dependencies: [2]
---

# Phase 3: Web idiom and drift sweep

## Overview

Diff cơ học: một cách duy nhất để chạm token, một card treatment duy nhất, một notice
component duy nhất, và vá hai chỗ drift đã đo được. Tách khỏi Phase 4 có chủ đích —
gộp diff cơ học vào diff cấu trúc làm cả hai không review được.

## Requirements

- Functional: 0 arbitrary `[var(--color-*)]` utility ở nơi đã có semantic utility.
- Functional: mọi `text-*` size utility và `text-[Npx]` literal → tên vai trò từ Phase 2.
- Functional: notice pattern có **một** định nghĩa, ba call site.
- Functional: một card treatment reachable từ bề mặt sản phẩm.
- Functional: **hai** chỗ thiếu `motion-reduce` được vá, không phải một:
  `audio-source-controls.tsx:86` (`transition-[width]`) và `baseline/page.tsx:63`
  (`animate-spin` trên `<Loader2>`). Grep `transition-\[` **bỏ sót** cái thứ hai; phải dùng
  `grep -rnE "animate-|transition-"`.
- Functional: `audio-source-controls.tsx:34` dùng `variant="live"` thay `destructive`.
- Non-functional: **không** đổi hành vi. Chỉ presentation.

## Architecture

**Card — quyết định, không phải cả hai.** Hôm nay tồn tại hai treatment:
`Card` (`ui/card.tsx:8`, có `shadow-sm`, title `text-xl`=20) chỉ dùng bởi
`/translate/baseline` + `result-card.tsx`; còn bề mặt sản phẩm tự viết tay box tương
đương, không shadow, title `text-lg`=18 (`cascade-panel.tsx:87`, `live-panel.tsx:81`).
Chọn **một**: hoặc panel dùng `<Card>`, hoặc xoá `card.tsx` và class viết tay là nguồn
duy nhất. Không giữ cả hai.

Lưu ý knip: `card.tsx` đang export `CardFooter` không ai dùng, được giữ sống bằng tag
`@public` (`card.tsx:39-40`). Dù criterion 12 ngã về phía nào, tag đó **không** được là
lý do một dead export sống sót — xử lý luôn.

**`variant="live"` vs `destructive` — zero thay đổi thị giác.** `button.tsx:37-38` cho
thấy hai variant mang **class string y hệt nhau**. Đây là sửa ngữ nghĩa (kết thúc một
lượt dịch không phải hành vi phá hoại), không phải sửa hình. Đừng kỳ vọng diff ảnh.

**Idiom `[var(...)]` — chỉ ban màu, không ban radius.** Criterion cấm
`[var(--color-*)]` nhưng criterion khác lại **yêu cầu** `rounded-[var(--radius-lg)]` tồn
tại. Không mâu thuẫn nếu nói rõ: chỉ **colour** utility bị chuyển sang semantic. Nhưng lưu ý
Tailwind v4 **đã** sinh `rounded-lg` từ `--radius-lg` (`globals.css:49`), nên
`rounded-[var(--radius-lg)]` (11 hit / 7 file) là arbitrary-value không cần thiết. Không
thuộc scope phase này — ghi vào exception table kèm lý do, hoặc mở một dọn dẹp riêng. Đừng
im lặng để nó thành mâu thuẫn nội bộ.

Cũng lưu ý: "9 hit" là 9 **dòng**, nhưng **11 occurrence** (`card.tsx:8` mang 3 cái). Grep
theo dòng đúng cho criterion; số lần sửa thực tế là 11.

**Notice.** Viết inline ba lần: `cascade-panel.tsx:150-157`,
`live-panel.tsx:133-140` (`bg-live-subtle`), `live-panel.tsx:142-151`
(`bg-warning-subtle`). Rút thành một component có tone variant. Chú ý:
`baseline/page.tsx:67-72` render error thành paragraph màu **không có** `role`; hợp nhất
vào cùng component thì nó có `role="alert"` — đây là cải thiện a11y thật, không phải refactor thuần.

## Related Code Files

- Create: `apps/web/src/components/ui/notice.tsx`
- Modify: `apps/web/src/components/ui/card.tsx` (hoặc Delete — theo quyết định trên)
- Modify: `apps/web/src/components/translate/cascade-panel.tsx`
- Modify: `apps/web/src/components/translate/live-panel.tsx`
- Modify: `apps/web/src/components/translate/audio-source-controls.tsx`
- Modify: `apps/web/src/components/translate/result-card.tsx`
- Modify: `apps/web/src/components/translate/conversation-transcript.tsx`
- Modify: `apps/web/app/translate/baseline/page.tsx`
- Modify: `apps/web/app/translate/page.tsx`
- Modify: `docs/design-guidelines.md` (exception table nếu có ngoại lệ)

## Implementation Steps

0. **Trước khi sweep — quy tắc grep của phase này.** Mọi baseline và criterion đếm call site
   phải có `--include='*.tsx'`. Comment giải thích trong `.css`/`.ts` khớp chính các pattern
   bị cấm (Phase 2 đã tạo ra 6 hit như vậy), nên grep không scope sẽ báo false-RED và dụ
   người làm đi xoá đúng những comment đang bảo vệ luật. Nguyên tắc chung từ đây: **trong
   file bị grep sweep, đừng trích nguyên văn pattern bị cấm vào comment** — để lý do ở
   `docs/design-guidelines.md` (ngoài vùng sweep) rồi trỏ tới.
1. Liệt kê baseline để đối chiếu sau (tất cả **scoped `*.tsx`**):
   - `grep -rn "\[var(--color-" apps/web/app apps/web/src --include='*.tsx'` → mong đợi **9** hit / 4 file (11 occurrence — `card.tsx:8` mang 3)
   - `grep -rEoh "\btext-(xs|sm|base|lg|xl|2xl|3xl)\b" apps/web/app apps/web/src --include='*.tsx' | sort | uniq -c`
     → mong đợi 17 `text-sm`, 9 `text-xs`, 2 `text-lg`, 2 `text-base`, 1 `text-xl`, 1 `text-2xl` (= 32)
   - `grep -rn "text-\[[0-9]" apps/web/app apps/web/src --include='*.tsx'` → mong đợi **3**
   - Tổng 35, và đó đúng là con số `--include='*.tsx'` trả về hôm nay — bằng chứng chênh lệch với raw grep (41) toàn bộ là comment
2. Đổi 9 arbitrary utility → semantic utility (`bg-card`, `text-muted-foreground`, …).
3. Sweep `text-*` → tên vai trò. **Line-height đi kèm sẵn** — Phase 2 đã thêm
   `--text-<role>--line-height` cho cả sáu step, và có test `pairs every type step with a
line-height` chặn việc khai một nửa cặp. Nếu không có nửa đó, utility chỉ phát font-size và
   element rơi về 1.5 kế thừa: `text-title` sẽ là 28px/42 — lỏng khắp nơi, trong đúng cái phase
   tự nhận là "cơ học", và **không grep hay test nào thấy được**.
   Khi thay `text-[22px] leading-snug` → `text-translation`, cân nhắc bỏ luôn `leading-snug`:
   step đã mang 1.375, tức chính `leading-snug`. Giữ cả hai không sai, chỉ là dư.
   Ánh xạ theo **vai trò**, không theo cỡ gần nhất:
   h1 → `text-title` (28, hiện 24); h2 section → `text-heading` (22, hiện 18);
   body/transcript → `text-body`; label uppercase → `text-label`; hint → `text-hint`;
   bản dịch → `text-translation` (thay `text-[17px]`/`text-[22px]` literal).
   Ngoại lệ nào không ánh xạ được → ghi vào exception table trong guidelines kèm lý do.
4. Bây giờ mới dùng `text-prose` cho supporting prose (source transcript, prose phụ) —
   đây là chỗ Phase 2 trả lại bậc chữ giữa, và là thay đổi thị giác **duy nhất** đáng kể
   của phase này.
   **Không gõ `text-secondary`.** Utility đó đã tồn tại từ `--color-secondary`
   (`globals.css:29`, `--secondary: #17171a`) và resolve về gần-đen trên nền gần-đen. Hai
   tên chỉ khác một tiền tố; không test nào bắt được vì parity spec kiểm declaration, không
   kiểm call site. Đây là lý do Phase 2 đặt tên `--prose`.
5. Rút `notice.tsx` với tone variant (`live` / `warning`); thay 3 call site; kéo
   `baseline/page.tsx:67-72` vào cùng component (nó nhận thêm `role="alert"`).
6. Quyết định card: panel dùng `<Card>`, hoặc xoá `card.tsx`. Xử lý `CardFooter`
   `@public` cho đúng.
7. Motion: `audio-source-controls.tsx:86` thêm `motion-reduce:transition-none`; **và**
   `baseline/page.tsx:63` `animate-spin` thêm `motion-reduce:hidden` (hoặc tương đương).
   Không cần chạm `status-indicator.tsx:49` — `animate-ping` ở đó **đã** được phủ bởi
   `motion-reduce:hidden` tại `:54`. Ba `transition-colors`
   (`button.tsx:20`, `segmented-control.tsx:115`, `translate/page.tsx:73`) là colour-only,
   để ngoài scope có lý do.
   `:34` đổi `variant="destructive"` → `variant="live"`.
8. Gate — **chạy riêng từng lệnh** (`pnpm --filter web test lint typecheck` không chạy
   lint/typecheck; xem M1 trong plan.md): `pnpm --filter web test`,
   `pnpm --filter web lint`, `pnpm --filter web typecheck`, `pnpm --filter web build`.
   `pnpm knip` chạy ở root (chạy tay, CI không chạy).

## Success Criteria

- [x] `grep -rn "\[var(--color-" apps/web/app apps/web/src` → 0 (từ 9)
- [x] `grep -rEn "\btext-(xs|sm|base|lg|xl|2xl|3xl)\b|text-\[[0-9]" apps/web/app apps/web/src --include='*.tsx'`
      → 0, hoặc mọi hit có trong exception table kèm lý do.
      **`--include='*.tsx'` là bắt buộc.** Không có nó, criterion **không bao giờ pass được**:
      comment ở `globals.css:62,64` và `token-parity.spec.ts:81-85` (giải thích vì sao tránh
      `--text-xs…xl`) khớp chính pattern bị cấm. Đã đo: raw 41 hit, scoped `*.tsx` 35 hit —
      đúng baseline 32 + 3. Toàn bộ chênh lệch là comment.
      **Tuyệt đối không** "sửa" bằng cách xoá comment đó — chúng chính là hàng rào chống lại
      cái tidy-up mà chúng cảnh báo. Nguy hiểm ở đây là **false-RED** giữa phase, không phải false-green
- [x] `grep -rnE "animate-|transition-" apps/web/app apps/web/src` → mọi hit **motion** đi kèm `motion-reduce:` (grep `transition-\[` một mình bỏ sót `animate-spin`)
- [x] 0 control kết thúc session dùng `variant="destructive"`
- [x] `bg-card` + `rounded-[var(--radius-lg)]` + `border` co-occur ở **đúng một** file
- [x] Mọi element **notice** có `role="alert"`/`role="status"` sinh ra từ một notice component. **Không** tính `status-indicator.tsx:42` — nó có `role="status"` nhưng không phải notice và không thuộc file set của phase này
- [x] `text-prose` thực sự được dùng cho supporting prose (không chỉ khai rồi bỏ)
- [x] `grep -rnE "['\" ]text-secondary['\" ]" apps/web/app apps/web/src --include='*.tsx'` → 0
      (utility gần-đen, không phải prose). Dạng cũ `"text-secondary\b"` → 0 là **bất khả thi**
      vì hai lý do độc lập: `\b` khớp bên trong `text-secondary-foreground`
      (`button.tsx:40` — utility shadcn hợp lệ, phải giữ), và comment Phase 2 nhắc tên này để
      giải thích vì sao tránh nó. Đã đo: 9 hit, không cách nào về 0
- [x] `pnpm --filter web` test / lint / typecheck / build — **bốn lệnh riêng**, đều xanh
- [x] `pnpm knip`: **không finding mới** so với baseline đã ghi (nó fail sẵn hôm nay — xem plan.md)
- [x] Không thay đổi hành vi: hook/socket/permission không bị chạm

## Phase notes (executed 2026-08-20)

### Results against baseline

| Target                                              | Before                            | After |
| --------------------------------------------------- | --------------------------------- | ----- |
| arbitrary `[var(--color-*)]`                        | 9 lines / 11 occurrences, 4 files | **0** |
| off-scale `text-*` + `text-[Npx]`                   | 35 (32 utilities + 3 literals)    | **0** |
| files carrying a card treatment                     | 3 (`card.tsx` + two hand-written) | **1** |
| notice implementations                              | 4, in 3 shapes                    | **1** |
| motion without `motion-reduce`                      | 2                                 | **0** |
| `variant="destructive"` on a session-ending control | 1                                 | **0** |

`text-prose` now used in 6 files (9 occurrences) — the token from Phase 2 is actually
consumed rather than declared and abandoned.

### Card: the shadow was dropped, not adopted

Two treatments existed and they differed in shadow and title size. Consolidating had to
pick: `Card` had `shadow-sm`, the product panels had none. The panels won that point —
`docs/design-guidelines.md` builds elevation from the neutral ramp
(`bg` → `surface` → `surfaceRaised`), never from shadows, and a drop shadow on `#0C0C0E`
reads as a smudge. `Card` won on being a component. So `ResultCard` and the turn-based page
lose a shadow they should not have had, which **is** a visible change on those two surfaces.

### The notice consolidation is an a11y fix, not a refactor

`baseline/page.tsx` rendered both its errors as bare coloured paragraphs with **no role** —
a failed turn sat on screen and said nothing to a screen reader. They now go through
`Notice`, which pairs tone with role (`live` → `alert`, `warning` → `status`). Recorded so
Phase 6 does not read the new announcements as a regression.

The one surviving `role="status"` outside `Notice` is `status-indicator.tsx:42`, which is the
status pill, not a notice — exactly the exception the corrected criterion allows.

### `button.tsx` size `lg` used `text-base` (16), a size in no scale

Resolved to `text-body`. Verified unused today, and a size variant's job is height and
padding; 16px belonged to no step. Noted rather than silently rounded.

### I tripped my own trap, in the file I was sweeping

The `card.tsx` docstring I wrote earlier this phase quoted the superseded utility name
verbatim — inside a file this phase greps. It showed up in the final sweep as a hit. Rationale
moved to `docs/design-guidelines.md` § Type, with the comment pointing there and saying why.
Exactly the discipline step 0 now mandates; found it by following my own criterion rather than
by being careful.

### Known state, deliberately not fixed here

The page h1 is now `text-title` (28) and the live translation is `text-heading` (22), so the
heading **still** outranks the content — the inversion this whole plan exists to fix is
momentarily _wider_ than before (title went 24 → 28, translation stayed 22). That is
expected: this phase is token conformance, Phase 4 is hierarchy.

Phase 4 note: the scale tops out at 28 (`xl`), and the approved mock showed the translation at
~34px. So the mock's proportion must be reached by making everything around the translation
smaller — brand and page title recede, translation takes `text-title` — **not** by adding a
step. Adding one would mean editing `packages/ui/src/tokens.ts`, which reaches
`apps/mobile/src/ui/theme.ts` and is an explicit non-goal.

### Gates

`pnpm --filter web test` 57/57 · `typecheck` clean · `lint` clean. `pnpm knip` unchanged from
the Phase 1 baseline (same 4 unused exports + 2 types; `Notice` is reached from 3 call sites so
it adds nothing). 13 files changed, +300/-111.

## Risk Assessment

- **Risk:** sweep `text-*` là mechanical nhưng đông — guidelines đã cảnh báo việc này
  "means … sweeping every utility, which is a change of its own". 32 site là **sàn**, không phải tổng.
  **Signal:** diff vượt xa 32 site, hoặc bắt đầu chạm layout.
  **Response:** dừng, tách phần layout sang Phase 4. Phase này chỉ đổi token reference.
- **Risk:** ánh xạ theo cỡ gần nhất thay vì theo vai trò sẽ đóng băng đúng cái hierarchy
  phẳng đang bị phàn nàn (h1 24→`text-heading` 22 là _giảm_, sai hướng).
  **Signal:** h1 không phải `text-title`.
  **Response:** ánh xạ lại theo cột "Role" của guidelines.
- **Risk:** xoá `card.tsx` làm `result-card.tsx` và baseline page mất treatment.
  **Signal:** knip báo export mới không dùng, hoặc baseline mất viền.
  **Response:** ngã về phía "panel dùng `<Card>`" — ít file bị chạm hơn.
- **Risk:** hợp nhất notice thêm `role="alert"` vào baseline error → screen reader đọc
  thêm chỗ trước đây im. Đây là **đúng**, nhưng là thay đổi hành vi a11y.
  **Signal:** không có; chủ ý.
  **Response:** ghi vào phase notes để Phase 6 không coi là regression.
