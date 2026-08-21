---
phase: 2
title: 'Token layer — elevation và motion'
status: pending
priority: P1
effort: '1d'
dependencies: [1]
---

# Phase 2: Token layer — elevation và motion

## Overview

Thêm hai họ token chưa từng tồn tại — `elevation` và `motion` — vào
`packages/ui/src/tokens.ts`, đưa chúng tới cả ba bề mặt, và mở rộng parity spec
để nó **fail được** khi một nửa biến mất.

## Requirements

- Functional: `elevation` mỗi bậc mang hai nửa light/dark; `motion` mang duration
  (số, không đơn vị) và easing (chuỗi `cubic-bezier`).
- Non-functional: `apps/mobile` import `@chatofy/ui` qua Metro và **không được**
  chạm React/Radix/DOM type. Duration là số nên RN dùng được; easing là chuỗi mà
  RN bỏ qua — bất đối xứng này đã tồn tại sẵn với `fontWeight`.

## Architecture

**Dark không nhận thêm giá trị màu nào.** Bóng đen trên `#111214` gần như vô
hình, nên dark không thể dùng bóng làm chiều sâu — và không cần:
`bg #111214 → surface #191B1E → surfaceRaised #212429` đã tồn tại và **đã được
đo**. Dark elevation là ba bậc đó cuối cùng được _dùng_ như elevation, cộng một
bóng chỉ để neo và một highlight `inset 0 1px 0` ở mép trên. Hệ quả: palette
đứng yên, `measure-palette.py` giữ 54/54.

**`light-dark()` KHÔNG bọc được một shadow list.** Theo CSS Color 5 nó là hàm
`<color>`, chỉ trả về màu. Nên khai
`--elevation-md: light-dark(0 2px 4px rgba(...), 0 4px 14px rgba(...))` thì custom
property vẫn _parse_ được (custom property nhận token stream tùy ý), nhưng lúc
`box-shadow: var(--elevation-md)` thay thế vào thì giá trị **invalid at computed
value time** — `box-shadow` rơi về `none`. Kết quả: **không bóng ở cả hai theme**,
CI xanh hoàn toàn, và sản phẩm ship phẳng đúng cái mà plan này sinh ra để chấm dứt.

**Cách viết đúng: hợp layer, `light-dark()` nằm ở vị trí MÀU của từng layer.** Mỗi
bậc mang đủ layer của cả hai theme; layer nào không thuộc theme đang chạy thì màu
của nó là `transparent` nên không vẽ gì:

```css
--elevation-md:
  0 2px 4px light-dark(rgba(19, 19, 19, 0.05), transparent),
  0 6px 16px light-dark(rgba(19, 19, 19, 0.075), transparent),
  0 4px 14px light-dark(transparent, rgba(0, 0, 0, 0.42)),
  inset 0 1px 0 light-dark(transparent, rgba(255, 255, 255, 0.045));
```

Đây không phải sở thích — web **không có** khối `.dark` để khai giá trị riêng.
`globals.css:173-177` ghi rõ `:root.light` và `:root.dark` chỉ chuyển
`color-scheme` chứ không chuyển gì khác, và đó là bất biến có chủ đích. Không có
khối riêng thì hợp layer là cách duy nhất diễn đạt được việc **hình học bóng của
light và dark khác nhau** (light 2 layer, dark 1 layer + inset highlight).

**Hình dạng token phải phục vụ hai người tiêu dùng khác nhau.** `tokens.ts` export
**hai nửa rời**:

```ts
export const elevation = {
  sm: { light: '0 1px 2px rgba(19,19,19,.055), …', dark: '0 1px 2px rgba(0,0,0,.35)' },
  md: { light: '…', dark: '…' },
  lg: { light: '…', dark: '…' },
} as const;
```

- **Web và popup** ghép hai nửa thành dạng hợp layer ở trên, trong CSS.
- **Overlay dùng thẳng nửa `dark`.** Nó vĩnh viễn tối và `overlay-invariants.spec.ts:112`
  cấm chạm `colorLight`; một giá trị `light-dark()` trong sheet của overlay sẽ khiến
  nó đi theo hệ điều hành — đúng cái lỗi "laptop sáng trong cuộc họp tối" mà
  `overlay-styles.ts:19-21` cảnh báo. Spec `not.toContain('var(')` **không** bắt được
  chuyện này, nên nó là luật của phase chứ không phải luật của test.

**Namespace của Tailwind v4 — đã tra bảng chính thức.** Có `--shadow-*`,
`--inset-shadow-*`, `--ease-*`. **Không có `--duration-*`.**

- Elevation phải vào namespace `--shadow-*` trong `@theme inline` thì mới sinh
  utility. Đặt tên khác biệt — `--shadow-elev-sm/md/lg` — để tiêu chí grep "không
  còn `shadow-xs`/`shadow-sm`" ở Phase 4 không bị nhập nhằng.
- `--ease-standard/enter/exit` chạy thẳng, sinh `ease-standard`…
- **`--duration-fast` sẽ KHÔNG sinh ra `duration-fast`.** Phải chọn một trong hai
  và ghi lại lựa chọn: dùng arbitrary value `duration-[var(--duration-fast)]`, hoặc
  định nghĩa `@utility`. Kiểm chứng trên Tailwind đang cài (`4.3.2`/`4.3.3`) trước
  khi quét call site, không giả định.

**Cái bẫy trong parity spec, phải xử chứ không lách.**
`apps/web/src/design/token-parity.spec.ts:172` định nghĩa `COLOUR_LIKE` neo ở `^`
và khớp cả `light-dark(`. Nên khai `--shadow-md: light-dark(…, …)` sẽ **fail**
test `:247` _"declares no colour the mapping does not account for"_, vì
`--shadow-md` không nằm trong `MAPPING`.

Cách viết đúng ở trên bắt đầu bằng `0`, nên **không** khớp `^` và không rơi vào
test đó. Điều này ban đầu bị coi là "né guard" và bị cấm — **cấm sai**. Né guard
là làm token biến mất khỏi mọi kiểm tra; ở đây token vẫn được khai báo tường minh
trong `ELEVATION_MAPPING` viết tay, tức là **được kể đến**, đúng ngược lại. Giữ
yêu cầu "mọi token elevation phải có mặt trong `ELEVATION_MAPPING`"; bỏ lệnh cấm
cách viết.

Mở rộng spec bằng bảng elevation/motion viết tay, cùng hình dạng với `MAPPING`
màu — đúng triết lý "bảng viết tay, không codegen" mà file đó tự ghi.

**Nhưng `halves()` không đọc được dạng hợp layer.** Helper ở
`token-parity.spec.ts:157` mong `^light-dark(...)$` nguyên giá trị. Elevation cần
parser riêng: tách theo layer, và assert **mỗi layer có đủ hai nửa**, trong đó một
nửa được phép là `transparent`.

Token mới phải nằm trong **khối `@theme inline` ĐẦU TIÊN**. `globals.css:88` đã
ghi cái bẫy này: spec match non-greedy, nên khối thứ hai render đúng mà test đọc
là vắng mặt.

## Related Code Files

- Modify: `packages/ui/src/tokens.ts` — thêm `elevation`, `motion`, và type của chúng
- Modify: `apps/web/app/globals.css` — khối `@theme inline` đầu tiên
- Modify: `apps/extension/entrypoints/popup/theme.css` — khối `@theme inline` đầu tiên
- Modify: `apps/web/src/design/token-parity.spec.ts` — bảng elevation + motion
- Modify: `packages/ui/src/index.ts` — export nếu root entry cần

## Implementation Steps

0. **Kiểm chứng trước khi viết — ĐÃ CHẠY, kết quả ở mục dưới.**
1. Đọc "Giá trị đã chốt" trong Phase 1. Không tự chế giá trị.
2. `tokens.ts`: thêm `export const elevation` với mỗi bậc là `{ light, dark }`,
   và `export const motion = { duration: {...số...}, easing: {...chuỗi...} }`.
   Thêm `Elevation`, `Duration`, `Easing` vào khối type ở cuối file.
3. `globals.css`: khai `--elevation-*` trong `:root` theo dạng **hợp layer** ở
   trên. Trong khối `@theme inline` đầu tiên: `--shadow-elev-*` trỏ vào chúng,
   `--ease-*` khai thẳng, và `--duration-*` theo lựa chọn đã kiểm chứng ở bước 0.
4. Lặp cho `popup/theme.css`. Nhớ khác biệt đã ghi: popup không có `--font-inter`,
   không có `@layer base`, không có `@custom-variant dark`.
5. `token-parity.spec.ts`: thêm `ELEVATION_MAPPING` và `MOTION_MAPPING`, chạy qua
   cả hai `SURFACES`. Thêm test "gives every elevation both halves".
6. **Chứng minh spec fail được:** tạm xoá một nửa dark của `elevation.md`, chạy
   test, xác nhận đỏ, khôi phục. Ghi kết quả vào phase này.
7. Chạy `python3 plans/260820-1131-two-theme-palette/measure-palette.py` — phải 54/54.

## Kết quả bước 0 — đã chạy 2026-08-21

**A. Rendering, kiểm bằng Chromium thật (playwright), đọc `getComputedStyle().boxShadow`:**

| Cách viết                         | `color-scheme: light`                                                         | `color-scheme: dark`                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Hợp layer, `light-dark()` ở ô màu | **có vẽ** — `rgba(19,19,19,.05) 0 2px 4px, rgba(19,19,19,.075) 0 6px 16px, …` | **có vẽ** — layer light thành `rgba(0,0,0,0)`, layer dark `rgba(0,0,0,.42) 0 4px 14px` |
| `light-dark()` bọc cả shadow list | **`none`**                                                                    | **`none`**                                                                             |

Cách viết bọc cả list cho `box-shadow: none` ở **cả hai** theme — đúng dự đoán,
và là thứ sẽ ship phẳng với CI xanh. Cách hợp layer chạy đúng.

**B. Namespace Tailwind, kiểm bằng `@tailwindcss/cli@4.3.2` trên chính repo:**

| Utility                                 | Kết quả           |
| --------------------------------------- | ----------------- |
| `.ease-standard` từ `--ease-standard`   | **sinh ra**       |
| `.shadow-elev-md` từ `--shadow-elev-md` | **sinh ra**       |
| `.duration-fast` từ `--duration-fast`   | **KHÔNG sinh ra** |

Xác nhận: `--ease-*` và `--shadow-*` là namespace; `--duration-*` **không phải**.

**C. Phát hiện thêm — namespace `--shadow-*` bảo toàn focus ring.** Output thật:

```css
.shadow-elev-md {
  --tw-shadow: 0 2px 4px var(--tw-shadow-color, light-dark(rgba(19, 19, 19, 0.05), transparent)), …;
  box-shadow:
    var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow),
    var(--tw-ring-shadow), var(--tw-shadow);
}
```

Ring nằm nguyên trong stack. Đây là bằng chứng cho luật ở Phase 4: dùng utility
sinh từ `--shadow-*`, **không** dùng arbitrary property `[box-shadow:…]` — cái sau
ghi đè cả stack và xoá ring.

**Quyết định cho duration.** Khai `--duration-*` trong `:root` (không phải
`@theme`, vì không phải namespace), rồi định nghĩa ba `@utility` mang tên vai trò
trỏ vào chúng. Giữ một nguồn sự thật, và tên theo vai trò khớp với cách repo đã
đặt tên thang chữ (`--text-body`, không phải `--text-sm`).

## Kết quả thực thi — 2026-08-21

**Spec fail được, chứng minh bằng hai đột biến rồi khôi phục:**

| Đột biến                             | Spec phản ứng                                                   |
| ------------------------------------ | --------------------------------------------------------------- |
| Xoá layer dark khỏi `--elevation-md` | `--elevation-md is missing the dark colour rgba(0, 0, 0, 0.42)` |
| Quay về `light-dark(<list>, <list>)` | `never wraps a whole shadow list in light-dark()` + 2 test khác |

**Một bẫy gặp lúc làm, đáng ghi:** `halves()` sẵn có cắt ở dấu phẩy đầu tiên. Với
palette hex thì đúng, nhưng `--surface-hairline` là `rgba()` nên nó trả về
`rgba(19`. Thêm `lightDarkPair()` đếm độ sâu ngoặc; không sửa `halves()` vì mọi
token màu hiện có vẫn đúng với nó.

**Gate:** `token-parity` 162/162 · extension 188/188 · typecheck+test+lint 12/12
task xanh · `measure-palette.py` **54/54**.

## Success Criteria

- [x] `tokens.ts` export `elevation` (hai nửa/bậc) và `motion`
- [x] Cả hai file CSS khai đủ, trong khối `@theme inline` **đầu tiên**
- [x] `token-parity.spec.ts` phủ elevation + motion trên cả hai surface
- [x] Đã chứng minh spec đỏ khi xoá một nửa — có ghi lại
- [x] Mọi token elevation có mặt trong `ELEVATION_MAPPING` — không cái nào vô hình với spec
- [x] Đã kiểm chứng bằng mắt: bóng hiện ở **cả hai** theme khi chỉ đổi `color-scheme`
- [x] Đã ghi lại cách `--duration-*` được đưa tới call site, kèm bằng chứng
- [x] `measure-palette.py` 54/54
- [x] `pnpm turbo run typecheck test` xanh

## Risk Assessment

**Rủi ro lớn nhất: token elevation invalid mà mọi guard vẫn xanh.** Parity spec so
khớp bằng regex trên văn bản CSS; nó không dựng CSSOM và không biết
`box-shadow: light-dark(<list>)` là invalid. Nên một token sai cú pháp vẫn qua được
toàn bộ CI, và triệu chứng duy nhất là sản phẩm phẳng — đúng thứ không ai phát hiện
lần trước.

- Tín hiệu đã vỡ: mở web, không thấy bóng, mà `test` vẫn xanh.
- Phản ứng đã định: bước 0 ở trên là bắt buộc, không phải tùy chọn. Và tiêu chí
  "kiểm chứng bằng mắt ở cả hai theme" phải do người xác nhận, không do test.

**Rủi ro: mở rộng `COLOUR_LIKE` làm hỏng test cũ.** Nếu sửa regex thay vì thêm
bảng riêng, các test màu hiện có đổi hành vi.

- Tín hiệu: bất kỳ test màu nào trong `token-parity.spec.ts` đổi trạng thái.
- Phản ứng: không đụng `COLOUR_LIKE`. Elevation/motion đi bằng bảng riêng và
  danh sách loại trừ tường minh.

**Rủi ro: `apps/mobile` gãy build.** Nếu `elevation` vô tình mang giá trị dạng
CSS mà Metro không hiểu, hoặc type mới kéo theo DOM type.

- Tín hiệu: `pnpm turbo run typecheck --filter=mobile` đỏ.
- Phản ứng: giữ `elevation` là chuỗi thuần, không import gì; nếu vẫn gãy, tách
  `elevation` sang subpath riêng như `react` đã làm.
