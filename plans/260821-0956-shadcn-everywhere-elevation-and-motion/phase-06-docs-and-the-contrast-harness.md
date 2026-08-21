---
phase: 6
title: 'Docs và harness contrast'
status: pending
priority: P2
effort: '0.5d'
dependencies: [4, 5]
---

# Phase 6: Docs và harness contrast

## Overview

Ghi lại direction mới vào docs, ghi lại việc đảo quyết định RadioGroup→ToggleGroup,
sửa mục "Where a component lives" để phản ánh **toàn bộ shadcn**, và đưa harness
đo contrast ra khỏi thư mục `plans/` xoá được.

## Requirements

- Functional: người đọc `docs/design-guidelines.md` sau phase này không tìm thấy
  câu nào còn mô tả direction cũ.
- Non-functional: mọi trích dẫn `file:line` trong docs phải đúng sau khi code đã
  đổi. Docs viện dẫn sai còn tệ hơn docs im lặng.

## Architecture

**Bốn chỗ trong `design-guidelines.md` mô tả direction đã chết.**

| Mục                         | Câu phải đi                                                                                              | Thay bằng                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| _Direction: two grounds…_   | triết lý phẳng, một accent                                                                               | direction elevation; ghi luật "một accent" đã được nới                                       |
| _What the measurements say_ | _"separates surfaces with rules instead of luminance steps"_ và sàn `borderStrong` 2.01/2.03 dựa trên nó | elevation gánh việc tách bề mặt; `borderControl` 3.03 giữ nguyên vì là ranh giới WCAG 1.4.11 |
| _Motion_                    | danh sách trắng 4 chuyển động, cộng hai lỗ đã ghi                                                        | thang token duration/easing; giữ bất biến _"never in the way of reading a translation"_      |
| _Where a component lives_   | chia Primitives / Compositions theo nguồn gốc                                                            | mọi thứ web+popup là shadcn hoặc chỉ ghép từ shadcn                                          |

**Thêm mục Elevation mới**, cùng hình dạng với các bảng token khác: hai cột
light/dark, cột "ở đâu", và ghi rõ **vì sao dark không dùng bóng** — `#111214`
nuốt bóng, nên chiều sâu đến từ ba bậc `bg → surface → surfaceRaised` vốn đã tồn
tại và đã được đo. Đây là lý do palette đứng yên.

**Một khuyết tật trong docs phải sửa nhân tiện.** Mục _"Re-skinning a generated
component"_ viết _"each is banned by `packages/ui/src/react/skin-guard.spec.ts`
rather than left to review"_ — **sai với hàng `hover:bg-primary/90`**. Danh sách
`FORBIDDEN` thật gồm: `dark:`, `bg-accent`, `text-accent-foreground`,
`bg-popover`/`text-popover-foreground`, `border-input`, `text-sm`/`text-xs`,
alias `@/lib/utils`. Luật `/90` chỉ sống trong bảng đó và là luật review, không
phải luật có test. Sửa câu, đừng sửa spec.

**Harness contrast đang bị treo vào thứ xoá được.** `design-guidelines.md:29` và
`packages/ui/src/tokens.ts:41` đều viện dẫn
`plans/260820-1131-two-theme-palette/measure-palette.py` làm thẩm quyền thực thi
(_"fails when one slips"_). Nhưng `plans/` là thư mục trạng thái — nó đã bị xoá
một lần trong chính session này, mang theo thẩm quyền được viện dẫn. Một doc
thường trực trỏ vào đó là khuyết tật thật.

Đưa nó thành spec committed cạnh `token-parity.spec.ts`, tính contrast thẳng từ
`tokens.ts`, rồi sửa cả hai trích dẫn.

## Related Code Files

- Modify: `docs/design-guidelines.md` — bốn mục ở trên, cộng mục Elevation mới
- Modify: `docs/codebase-summary.md:133` — dòng nói về quy ước component shadcn
- Modify: `packages/ui/src/tokens.ts:41` — trích dẫn harness
- Create: `apps/web/src/design/contrast-floors.spec.ts` — harness thành spec
- Delete (sau khi spec chạy được): `plans/260820-1131-two-theme-palette/measure-palette.py`

## Implementation Steps

1. Chuyển `measure-palette.py` thành `contrast-floors.spec.ts`: cùng danh sách
   cặp, cùng sàn, đọc màu từ `tokens.ts` thay vì bảng hardcode trong Python. Giữ
   nguyên cả 54 phép đo và cả 4 phép đo khoảng cách hue.
2. Chạy song song cả hai một lần, đối chiếu từng con số. Chỉ khi khớp mới xoá bản Python.
3. Sửa `design-guidelines.md:29` và `tokens.ts:41` trỏ vào spec mới.
4. Viết lại bốn mục trong bảng ở trên. Với mục _Direction_, ghi rõ đây là **đảo
   quyết định**, ai yêu cầu, và vì sao — không viết như thể chưa từng có direction cũ.
   4b. Ghi lại **cái giá thật** của việc chuyển `SegmentedControl` sang ToggleGroup,
   và ghi cho đúng. Cái giá được nêu lúc thương lượng — mất `role="radiogroup"` —
   **không xảy ra**: Radix `type="single"` vẫn render `radiogroup`/`radio`/
   `aria-checked` (đã kiểm chứng ở `@radix-ui/react-toggle-group@1.1.19`). Cái mất
   thật là hành vi: mũi tên chuyển focus mà không chọn, trong khi role vẫn là
   `radio` — nên trình đọc màn hình sẽ đọc "radio, 1 of 3" trong khi phím mũi tên
   không cư xử như radio. **Dự án không nhận quirk này**: Phase 3 nối lại
   chọn-theo-mũi-tên để component khớp với ARIA của chính nó. Ghi cả quirk lẫn
   lý do nối lại — người sau nhìn thấy `onKeyDown` thủ công phải hiểu vì sao nó ở
   đó, nếu không họ sẽ gỡ. Comment đầu `segmented-control.tsx` bênh RadioGroup
   phải được viết lại cho khớp, chứ không xoá.
5. Thêm mục Elevation với bảng hai nửa và đoạn giải thích vì sao dark khác light.
6. Viết lại mục _Motion_: thang token thay danh sách trắng; giữ bất biến về chữ
   bản dịch; xoá hai dòng "two current gaps" vì Phase 4 đã vá.
7. Viết lại _Where a component lives_: Primitives giờ gồm cả `Tabs`,
   `ToggleGroup`, `Toggle`; Compositions đổi định nghĩa thành "chỉ ghép từ
   primitive shadcn"; ghi `Tabs` cố ý chưa có consumer.
8. Trong _Where a component lives_, thêm đoạn về **hai bề mặt không chuyển được**
   — overlay (invariant `var(`) và mobile (không DOM) — kèm trích dẫn spec, để
   lần sau không ai thử "cho đồng bộ".
9. Sửa câu sai về `skin-guard.spec.ts` và hàng `hover:bg-primary/90`.
10. Cập nhật mục _Still duplicated_: chọn giọng đọc vẫn là hai control, quyết định
    giữ nguyên.
11. Sửa `codebase-summary.md:133`.
12. Kiểm mọi trích dẫn `file:line` trong `design-guidelines.md` còn đúng sau
    Phase 3-5. Đây là mục dễ mục ruỗng nhất.

## Success Criteria

- [x] `contrast-floors.spec.ts` chạy, cho đúng 54 pass + 4 hue check như bản Python
- [x] `measure-palette.py` đã xoá, và không còn docs nào trỏ vào `plans/`
- [x] Không câu nào trong `design-guidelines.md` còn mô tả direction phẳng
- [x] Mục Elevation tồn tại, giải thích vì sao dark khác light
- [x] Mục Motion mô tả thang token, không phải danh sách trắng
- [x] _Where a component lives_ nói rõ web+popup toàn shadcn, và hai bề mặt ngoại lệ kèm spec
- [x] Việc đảo RadioGroup→ToggleGroup được ghi kèm lý do, và ghi **đúng** cái giá:
      hành vi bàn phím lệch với role, không phải mất role
- [x] Câu sai về `skin-guard.spec.ts` đã sửa
- [x] Mọi trích dẫn `file:line` trong docs đã kiểm lại và còn đúng
- [x] CI xanh toàn bộ

## Kết quả thực thi — 2026-08-21

**Harness đã chuyển và đối chiếu từng số.** `contrast-floors.spec.ts` cho **54/54**,
và diff từng giá trị với bản Python: **khớp toàn bộ 54 số**, không lệch cái nào.
Chỉ sau đó mới xoá `measure-palette.py`. Spec mới **đọc màu từ `tokens.ts`** thay
vì chép lại — bản Python mang bản sao riêng nên chỉ đo được thứ nó được bảo lần
cuối. Web test: 185 → 239.

**Docs sửa sáu chỗ:** đoạn Direction (ghi rõ đây là đảo quyết định, ai yêu cầu, và
cái gì được giữ lại), trích dẫn harness, sàn `borderStrong` (không còn dựa vào cơ
chế đã chết), toàn bộ mục Motion, mục _Where a component lives_, và câu sai về
`skin-guard.spec.ts`.

**Thêm mục Elevation** với bảng ba bậc hai nửa, giải thích vì sao dark không dùng
bóng, và hai cách làm sai **đều im lặng**: `light-dark()` bọc cả list, và arbitrary
`[box-shadow:…]` xoá focus ring.

**Một khẳng định trong docs hoá ra sai.** Mục Motion viết hai lỗ `motion-reduce:`
là "both real". Kiểm ra: `audio-source-controls.tsx` và `baseline/page.tsx` **đều
đã có** guard từ trước. Docs sai, code không thiếu. Đoạn đó bị xoá thay vì được mô
tả như việc phải làm.

**Ba trích dẫn stale KHÔNG sửa, và nói rõ vì sao.** Bảng _State inventory_ của
popup trỏ vào `main.ts` và `styles.ts` — đã bị thay bởi lần viết lại popup sang
React, **trước** việc này. Các _trạng thái_ vẫn đúng và vẫn là thứ bảng đó tồn tại
để bắt; chỉ địa chỉ mục ruỗng. Thêm cảnh báo ngay trên bảng để nó không đánh lừa
người đọc, còn việc dẫn lại là thay đổi riêng, không nhét vào một lượt làm chiều
sâu và chuyển động.

**Gate cuối:** `@chatofy/ui` 25 · web **239** · extension 188 · typecheck+test+lint
12/12 task · e2e **65 passed, 0 failed**.

## Risk Assessment

**Rủi ro: docs viết lại nhưng bỏ mất lý do cũ.** Direction phẳng có lý do thật
(bản dịch là thứ cần đọc, accent một lần để không loạn). Xoá sạch nó biến docs
thành bản ghi ý thích mới nhất thay vì bản ghi quyết định.

- Tín hiệu đã vỡ: người đọc mới không trả lời được "vì sao trước đây phẳng".
- Phản ứng đã định: mỗi mục viết lại phải giữ một câu nói direction cũ là gì và
  vì sao nó bị thay — đúng cách mục _Type_ đang ghi lại bẫy `--text-sm`.

**Rủi ro: `contrast-floors.spec.ts` lệch số so với Python.** Làm tròn hoặc công
thức luminance khác nhau có thể đẩy một cặp sát ngưỡng qua bên kia.

- Tín hiệu đã vỡ: bất kỳ cặp nào lệch quá 0.01, hoặc một cặp đổi pass/fail.
- Phản ứng đã định: giữ cả hai cho đến khi khớp. Không xoá bản Python dựa trên
  "spec mới xanh" — xanh có thể vì đo sai.
