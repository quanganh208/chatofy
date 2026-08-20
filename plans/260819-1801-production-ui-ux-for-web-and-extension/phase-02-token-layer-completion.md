---
phase: 2
title: 'Token layer completion'
status: completed
priority: P1
effort: '3-4h'
dependencies: [1]
---

# Phase 2: Token layer completion

## Overview

Vá hai token chưa tới được web, thêm type scale vào `@theme`, và mở rộng parity spec để
lỗ hổng này không tái diễn. **Không kỳ vọng thay đổi thị giác nào ở phase này** — đây là
tầng nền cho Phase 3/4 dùng.

## Requirements

- Functional: `textSecondary` và `borderStrong` có mặt trong `:root` của `globals.css`,
  alias trong `@theme inline`, có trong `MAPPING`. **Tên property: `--prose`, không phải
  `--text-secondary`** — xem mục "Bẫy tên" bên dưới.
- Functional: type scale vào `@theme` dùng **tên theo vai trò**, không phải `xs…xl`.
- Functional: parity spec có test "mọi key của `color` phải có trong `MAPPING`".
- Non-functional: test mới phải **fail** trên tree hiện tại trước khi vá — đó là bằng
  chứng nó cắn. Test không fail trước khi vá là test không kiểm tra gì.
- Non-functional: **không** sửa `packages/ui/src/tokens.ts`. Sửa _giá trị_ ở đó lan tới
  `apps/mobile/src/ui/theme.ts` (import trực tiếp). Ở đây chỉ thêm CSS phái sinh.

## Architecture

**Vì sao lỗ hổng tồn tại được.** `token-parity.spec.ts` có test
"has no colour in `:root` that the mapping does not account for" — nó bắt colour _đã
khai trong CSS_ mà thiếu mapping. Nhưng `textSecondary`/`borderStrong` không có trong
`:root` **và** không có trong `MAPPING`, nên cả test đó lẫn "declares every mapped
property" đều xanh. Chiều còn thiếu là: **mọi key của `color` phải có trong `MAPPING`**.

### `MAPPING` phải đổi shape, nếu không test mới vô nghĩa

`color` trong `packages/ui/src/tokens.ts:26-136` là **phẳng** — 21 key string, không nhóm
lồng (`overlay` là export **riêng**, không nằm trong `color`). Nên `Object.keys(color)` an toàn.

Nhưng `MAPPING` hôm nay là `CSS-prop → token *value*` (`spec:25-55`), **không có liên kết
key**. Viết "mọi key của `color` có trong `MAPPING`" trên shape đó chỉ có thể là _value
inclusion_, và value inclusion để lại lỗ hổng vĩnh viễn: bất kỳ token tương lai nào có hex
trùng một token đã map sẽ pass mà **không bao giờ tới `globals.css`** — đúng cái lớp drift mà
test này được thêm để chặn. Hôm nay đã có hai cặp trùng: `onAccent === bg === '#0C0C0E'`, và
`destructive === live`.

**Đổi value type của `MAPPING` sang token key:**

```ts
const MAPPING: Record<string, keyof typeof color> = {
  '--background': 'bg',
  '--foreground': 'text',
  // … cả 26 entry
  '--prose': 'textSecondary',
  '--border-strong': 'borderStrong',
};

it('maps every colour token', () => {
  const mapped = new Set(Object.values(MAPPING));
  expect(Object.keys(color).filter((k) => !mapped.has(k as keyof typeof color))).toEqual([]);
});

// test value hiện có sâu thêm một tầng indirection:
it.each(Object.entries(MAPPING))('%s carries its token value', (name, key) => {
  expect(declared.get(name)?.toLowerCase()).toBe(color[key].toLowerCase());
});
```

Chi phí: cả **26** entry hiện có đổi shape, cộng `it.each` ở `spec:109-111`. Đây là lý do
effort phase này lên 3-4h.

Vẫn là **coverage, không phải uniqueness** — `--destructive`/`--live` đều map `'live'`,
`--input`/`--border-control` đều map `'borderControl'`. Đúng như thiết kế, nhưng nó quyết
định step 7 phải chọn entry nào (xem dưới).

**Type scale — lệch khỏi tên key của token, có chủ đích.** Thêm `--text-xs…xl` vào
`@theme` sẽ **ghi đè utility cùng tên của Tailwind** ở giá trị khác:

| Tên         | Token | Tailwind | Hệ quả nếu dùng tên token |
| ----------- | ----- | -------- | ------------------------- |
| `text-xs`   | 11    | 12       | mọi `text-xs` đổi cỡ      |
| `text-sm`   | 12    | 14       | 17 call site đổi cỡ       |
| `text-base` | 14    | 16       | 2 call site đổi cỡ        |
| `text-lg`   | 22    | 18       | 2 call site đổi cỡ        |
| `text-xl`   | 28    | 20       | 1 call site đổi cỡ        |

Tức là đặt tên `xs…xl` sẽ âm thầm đổi cỡ chữ toàn bộ web trong một commit — đúng cái
hazard mà `docs/design-guidelines.md` ghi là "a change of its own". Nên dùng tên vai trò:

**Append vào BÊN TRONG block `@theme inline` đang có (`globals.css:20-52`)** — không tạo
block thứ hai:

```css
/* … bên trong @theme inline hiện có, không mở block mới … */
--text-label: 11px; /* fontSize.xs  — uppercase label, folio */
--text-hint: 12px; /* fontSize.sm  — hint, secondary metadata */
--text-body: 14px; /* fontSize.base — body, source transcript */
--text-translation: 17px; /* fontSize.md  — bản dịch */
--text-heading: 22px; /* fontSize.lg  — section heading */
--text-title: 28px; /* fontSize.xl  — page title */
```

**Vì sao phải cùng block:** `themeAliases()` (`spec:93-94`) dùng regex non-greedy
`/@theme inline\s*\{([\s\S]*?)\n\}/` — nó chỉ đọc block **đầu tiên**. Một block `@theme
inline` thứ hai vẫn render đúng (Tailwind merge), nhưng test fontSize sẽ báo scale **absent**
trong khi CSS hoàn toàn ổn. Đã kiểm bằng thực nghiệm: cùng block → pass; block thứ hai →
`FAIL ["--text-label absent-or-unparsable: absent", …]`.

Tên vai trò không đụng gì của Tailwind, mang đúng nghĩa mà cột "Role" trong guidelines
đã gán, và làm criterion 5 (grep-based) thực thi được.

### Bẫy tên — `--text-secondary` sẽ ship prose vô hình

`globals.css:29` **đã có** `--color-secondary: var(--secondary)` với
`--secondary: #17171a` (`:64`, = `surfaceRaised`). Tailwind vì thế **đã sinh** một utility
text-colour `text-secondary` resolve về gần-đen (~1.2:1 trên `#0c0c0e`).

Nếu token mới được khai là `--text-secondary` → alias `--color-text-secondary` → utility
thật là `text-text-secondary`. Tức là `text-secondary` (cái tay sẽ tự gõ) và
`text-text-secondary` (cái đúng) **chỉ khác nhau một tiền tố**, một cái là prose đọc được
và một cái là chữ gần-đen trên nền gần-đen. Không test nào phân biệt được:
`token-parity.spec.ts` kiểm **declaration**, không kiểm call site.

**Nên đặt tên là `--prose`:**

```css
:root {
  --prose: #b4b6c0;
} /* color.textSecondary */
@theme inline {
  --color-prose: var(--prose);
}
```

→ utility `text-prose`. Không đụng gì, mang đúng nghĩa mà guidelines đã gán
("the source transcript, supporting prose"), và không có anh em gần-trùng nào để gõ nhầm.

`borderStrong` giữ `--border-strong` → `--color-border-strong` → `border-border-strong`,
khớp convention của `--color-border` → `border-border` đang có. Không có collision.

## Related Code Files

- Modify: `apps/web/app/globals.css` (thêm 2 custom property + alias + type scale)
- Modify: `apps/web/src/design/token-parity.spec.ts` (thêm 2 mapping entry + 2 test)
- Modify: `docs/design-guidelines.md` (ghi lý do tên vai trò; đóng mục "Type" divergence)
- **Không sửa:** `packages/ui/src/tokens.ts`

## Implementation Steps

1. Viết test mới **trước**: `it('maps every colour token', …)` — assert mọi key của
   `color` từ `@chatofy/ui` có trong `MAPPING`. Chạy: phải fail với đúng
   `borderStrong` + `textSecondary`. Ghi lại output fail.
   **Chú ý shape:** kiểm `color` trong `packages/ui/src/tokens.ts` là phẳng hay có nhóm
   lồng (`overlay` là export **riêng**, không nằm trong `color` — xác nhận trước khi viết
   assertion). Assert trên **key của `color`**, không phải tính duy nhất của value:
   `borderControl` đã được map hai lần (`--border-control` và `--input`), nên một assertion
   1-1 sẽ fail sai.
2. Thêm vào `:root`: `--prose: #B4B6C0;` `--border-strong: #35373D;` kèm comment nói chúng
   dùng ở đâu (supporting prose / hovered edge) **và** vì sao không tên là
   `--text-secondary` (bẫy collision ở trên).
3. Thêm alias trong `@theme inline`: `--color-prose`, `--color-border-strong`.
4. Thêm 2 entry vào `MAPPING`: `'--prose': color.textSecondary`,
   `'--border-strong': color.borderStrong`. Chạy lại: test step 1 xanh.
5. Append type scale tên vai trò **vào bên trong** block `@theme inline` đang có
   (`globals.css:20-52`) — **không** mở block thứ hai (xem trên).
6. Thêm `fontSize` mapping + test so CSS với `fontSize` import từ `@chatofy/ui`
   (`tokens.ts:172-185`), theo đúng khuôn test radius (`spec:160-177`) — tức
   `xs→--text-label`, `sm→--text-hint`, `base→--text-body`, `md→--text-translation`,
   `lg→--text-heading`, `xl→--text-title`. **Không restate `11/12/14/17/22/28` trong test**;
   con số chỉ nằm trong CSS và trong token module. (Criterion tương ứng đã sửa cho khớp.)
7. Xác nhận chiều ngược — **phải chọn entry singly-mapped**: xoá tạm `--prose` hoặc
   `--border-strong` khỏi `MAPPING`, và assert **đúng test nào** đỏ, không chỉ "suite đỏ".
   **Lý do:** với 14/28 entry, việc xoá **không** làm test mới đỏ mà làm test _khác_ đỏ
   ("has no colour in `:root` that the mapping does not account for") — implementer sẽ thấy
   đỏ và ghi nhận **xác nhận sai**. Xác suất chọn nhầm gần một nửa. Nguyên nhân: value trùng
   (`onAccent === bg`, `destructive === live`, `text` map ba lần,
   `surfaceRaised`/`borderControl`/`accentText`/`onAccent` mỗi cái hai lần). Trả lại sau khi kiểm.
8. Cập nhật `docs/design-guidelines.md`: đóng mục "Type" divergence, ghi lý do tên vai
   trò **và** lý do `--prose` (cả hai thuộc doc, không chỉ commit message — nếu ai đó "dọn"
   về `xs…xl` hay `--text-secondary` thì hỏng âm thầm).
9. Gate — **chạy riêng từng lệnh**: `pnpm --filter web test`, rồi
   `pnpm --filter web lint`, rồi `pnpm --filter web typecheck`. Gộp thành
   `pnpm --filter web test lint typecheck` **không chạy lint/typecheck** — chúng bị vitest
   nhận làm name filter và suite thoát với "No test files found". Xem M1 trong plan.md.

## Success Criteria

- [x] Test "mọi key của `color` có trong `MAPPING`" tồn tại và đã được chứng minh fail
      trên tree trước khi vá (output fail ghi vào PR/commit body)
- [x] `grep -nE "\-\-prose|\-\-border-strong" apps/web/app/globals.css` → có cả hai
- [x] `grep -n "\-\-text-secondary" apps/web/app/globals.css` → **0** (bẫy collision)
- [x] `MAPPING` đổi shape sang `Record<string, keyof typeof color>`; cả 26 entry + `it.each` (`spec:109-111`) đã cập nhật
- [x] `fontSize` mapping so CSS với `fontSize` từ `@chatofy/ui`, **không** restate số trong test
- [x] Type scale nằm **trong** block `@theme inline` đang có. Kiểm bằng
      `grep -cE "^@theme inline \{" apps/web/app/globals.css` → 1. **Không** dùng
      `grep -c "@theme inline"` — nó đếm cả cụm từ trong comment (chính comment giải thích
      luật này). Cùng lớp lỗi mà red-team bắt ở criterion `OVERLAY_STYLE` không `var(`
- [x] `grep -n "\-\-text-secondary:" apps/web/app/globals.css` → 0 (có dấu `:` — không có nó thì
      khớp luôn comment nói vì sao **không** dùng tên đó). Test `does not declare a text token
  whose utility collides with an existing one` là bản kiểm đúng: nó strip comment
- [x] Type scale dùng tên vai trò; `grep -nE "\-\-text-(xs|sm|base|lg|xl):" apps/web/app/globals.css` → 0
- [x] Assertion mới kiểm **key của `color`** (coverage), không phải value inclusion
- [x] Step 7 dùng entry singly-mapped (`--prose`/`--border-strong`) và assert **đúng test nào** đỏ
- [x] `git diff --stat main...HEAD -- packages/ui/src/tokens.ts` → rỗng (**không** `git diff` trần)
- [x] `pnpm --filter web test`, `pnpm --filter web lint`, `pnpm --filter web typecheck` — **ba lệnh riêng**, đều xanh
- [x] Lý do tên vai trò **và** lý do `--prose` có trong `docs/design-guidelines.md`
- [x] Không thay đổi thị giác nào (screenshot trước/sau `/translate` giống nhau)

## Phase notes (executed 2026-08-20)

### The fail-first proof, and the false confirmation it nearly produced

First attempt failed the wrong way. Adding `--prose`/`--border-strong` to `MAPPING` **and**
writing the new test in one edit made three tests go red —
`--prose carries its token value`, `--border-strong carries its token value`, and
`declares every mapped property` — while `maps every colour token` **passed**. Red suite,
wrong reason: those three fire because the CSS lacks the declarations, not because the new
check bites. Recording it as "the test fails, proof done" would have been exactly the false
confirmation the plan warns about.

Proper proof — remove the two entries from `MAPPING`, leave the CSS alone:

```
× maps every colour token
AssertionError: expected [ 'borderStrong', 'textSecondary' ] to deeply equal []
Tests  1 failed | 50 passed (51)
```

**One** test, the right one, naming the right two tokens. That is the reverse check working.

### `MAPPING` reshaped, 26 → 28 entries

`Record<string, string>` → `Record<string, keyof typeof color>`; `it.each` now resolves
`color[key]`. `color` verified **flat** — 21 string keys, no nested groups (`overlay` is a
separate export, not a member). After the two additions all 21 are covered.

Coverage, not uniqueness, and intentionally: `--destructive`/`--live` both map `live`;
`--input`/`--border-control` both map `borderControl`.

### Tests added (50 → 55)

`maps every colour token`; `keeps the type scale in step with the tokens`;
`does not declare a text token whose utility collides with an existing one`; plus two new
`it.each` cases from the `MAPPING` additions.

### My own criteria were comment-blind

Two criteria I wrote tripped on prose, not declarations:
`grep -c "@theme inline"` returned 2 (one is the comment explaining the single-block rule)
and `grep -c "--text-secondary"` returned 1 (the comment explaining why that name is
avoided). Actual counts: **one** `^@theme inline {` block, **zero** `--text-secondary:`
declarations. Same comment-blindness the red team caught in the `OVERLAY_STYLE` no-`var(`
criterion — now found in mine. Criteria corrected to anchor on `:` and line start; the
vitest checks were already right because they strip comments via `WITHOUT_COMMENTS`.

### Verified zero visual change

`git diff --stat -- apps/web/src apps/web/app/translate` touches **only**
`token-parity.spec.ts`. No component file changed, and nothing consumes `--prose`,
`--border-strong` or the six `--text-*` properties yet — Phase 3 does that. So the "no
visual change" criterion holds structurally, not just by eye.

### Two gaps found at the post-phase advisory checkpoint, both fixed here

**1. Line-height was missing from every type step.** Tailwind's own size utilities ship a
`--line-height` companion; six entries declaring font-size alone would have emitted size
only, dropping each swept element to the inherited 1.5 — `text-title` at 28px/42, loose
everywhere, in the phase that claims to be mechanical. No grep or test could see it. Added
`--text-<role>--line-height` for all six (label 1.4, hint 1.45, body 1.5, translation 1.375
= the `leading-snug` already on those sites, heading 1.25, title 1.2) plus a
`pairs every type step with a line-height` test. `tokens.ts` still untouched — line-height is
a CSS-consumer concern and mobile handles its own.

**2. Declaration → `@theme` alias was unguarded.** The suite proved
token → `MAPPING` → `:root` → correct value, but nothing proved the alias that turns a
declaration into a utility. Verified by deleting `--color-prose: var(--prose)`: **55/55 green
while `text-prose` ceased to exist** — the same "never reached web" failure, one link further
down. Added `exposes every mapped colour as a @theme alias`.

Both new tests proven to bite, each naming exactly what was removed:

```
× exposes every mapped colour as a @theme alias   expected [ '--prose' ] to deeply equal []
× pairs every type step with a line-height        expected [ '--text-title' ] to deeply equal []
```

### This phase's comments broke Phase 3's criteria — fixed there, not by deleting them

The rationale comments added here (why `--text-xs…xl` is wrong, why `--text-secondary` is
wrong) live in `globals.css` and `token-parity.spec.ts`, both inside Phase 3's grep scope,
and they quote the banned patterns verbatim. Measured: Phase 3's type criterion returns 41
raw vs **35** with `--include='*.tsx'` — and 35 is exactly the recorded baseline of 32 + 3,
so the whole delta is comments. Its `text-secondary` criterion could never reach 0 at all:
`\b` also matches inside `text-secondary-foreground` (`button.tsx:40`), a legitimate utility
that stays.

Phase 3's criteria now scope to `*.tsx` and say explicitly that deleting the comments is not
an acceptable fix — the failure mode is false-RED luring someone into stripping the very
guard rails. New standing rule in plan.md: inside a grep-swept file, never quote a banned
pattern in a comment; put the rationale in `docs/design-guidelines.md`, outside sweep scope.

### Gates

`pnpm --filter web test` **57/57** · `typecheck` clean · `lint` clean · `build` clean (4 routes
prerendered). `pnpm knip` exit 1 with a set **byte-identical to the Phase 1 baseline** — no
new findings. `git diff` on `packages/ui/src/tokens.ts` empty. Component files still untouched,
so the no-visual-change property holds.

## Risk Assessment

- **Risk:** thêm `--text-*` vào `@theme` làm test "no colour declared outside `:root`"
  fail. **Đã kiểm tra: không.** Test đó filter theo `COLOUR_LIKE`
  (`token-parity.spec.ts:103-104`) nên giá trị `px` không khớp. Test alias chỉ soi
  `var()` reference. Ghi lại đây để reviewer không phải kiểm lại.
  **Signal:** nếu vẫn fail thì giả định trên sai.
  **Response:** đọc lại `rootDeclarations()`/`themeAliases()` và điều chỉnh scope test,
  đừng nới `COLOUR_LIKE`.
- **Risk:** tên vai trò là **convention, không có compiler đứng sau**. Chỉ grep ở
  criterion 5 chặn `text-sm` quay lại.
  **Signal:** `text-sm` mới xuất hiện trong diff sau này.
  **Response:** nói thẳng đây là convention + check, đừng tuyên bố là enforcement.
- **Risk:** `--input` đã map `borderControl`, nên `borderControl` xuất hiện 2 lần trong
  `MAPPING`. Test "mọi key có trong MAPPING" phải kiểm _key của color_, không phải tính
  duy nhất của value.
  **Signal:** test fail vì trùng value.
  **Response:** assert trên `Object.values(MAPPING).includes(...)` theo key, không theo cặp 1-1.
