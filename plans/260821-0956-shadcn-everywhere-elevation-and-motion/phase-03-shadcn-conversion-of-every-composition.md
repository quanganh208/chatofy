---
phase: 3
title: 'Chuyển toàn bộ composition sang shadcn'
status: pending
priority: P1
effort: '1.5d'
dependencies: [2]
---

# Phase 3: Chuyển toàn bộ composition sang shadcn

## Overview

Bốn composition viết tay dựng lại trên primitive shadcn, cộng `Tabs` và
`ToggleGroup` lấy từ CLI. Sau phase này, mọi thứ web + popup render là primitive
shadcn hoặc chỉ ghép từ primitive shadcn.

## Requirements

- Functional: `ThemeToggle`, `StatusIndicator`, `DirectionToggle`,
  `SegmentedControl` không còn tự dựng cấu trúc.
- Non-functional: `skin-guard.spec.ts` xanh trên mọi component mới. Import phải
  tương đối — alias `@/lib/utils` mà CLI viết ra resolve được cho bundler nhưng
  **không** cho `rollup-plugin-dts`, nên chỉ type build gãy.

## Architecture

**Trạng thái xuất phát.** 9/13 export trong `packages/ui/src/react/index.ts` đã
là shadcn sinh từ CLI rồi re-skin: `Alert`, `Badge`, `Button`, `Card`,
`Checkbox`, `Label`, `RadioGroup`, `Select`, `Separator`. Bốn cái viết tay tồn
tại vì **shadcn không có hình dáng đó**, không phải vì ai thích tự viết.

**Bản đồ chuyển đổi.**

| Hiện tại                              | Thành                | Ghi chú                                                       |
| ------------------------------------- | -------------------- | ------------------------------------------------------------- |
| `ThemeToggle` — 3 nút tay             | `ToggleGroup` single | `value` vẫn được phép `undefined` — trạng thái hydration-safe |
| `StatusIndicator` — chấm + nhãn       | `Badge` + chấm pulse | **nhãn và pulse giữ nguyên**, xem dưới                        |
| `DirectionToggle`                     | `Button` + `Badge`   | vốn đã là nút swap cộng hai phía có tên                       |
| `SegmentedControl` — Radix RadioGroup | `ToggleGroup`        | ARIA **không đổi**; hành vi bàn phím đổi — xem dưới           |

**Cái giá THẬT, sau khi đã kiểm chứng nguồn.** Đã đọc
`@radix-ui/react-toggle-group@1.1.19` (pin qua `radix-ui@1.6.7`, xác nhận trong
`pnpm-lock.yaml:3649`):

```js
jsx(ToggleGroupImplSingle, { role: 'radiogroup', ...singleProps });
const singleProps = { role: 'radio', 'aria-checked': props.pressed, 'aria-pressed': void 0 };
```

Nên **ARIA không đổi**. `type="single"` vẫn render `role="radiogroup"` với các
`role="radio"` mang `aria-checked`, và `aria-pressed` bị gỡ tường minh. Cái giá
được nêu lúc thương lượng — "radiogroup của radio thành group của nút toggle" —
**không xảy ra**. `segmented-control.spec.tsx:78`
(`it('is a radiogroup of radios, not a toolbar of buttons')`) phần lớn vẫn xanh.

**Cái mất thật là hành vi, và ta nối lại.** Radix ToggleGroup dùng roving focus:
mũi tên **chuyển focus mà không chọn**; chọn xảy ra khi kích hoạt
(Enter/Space/click). RadioGroup thì chọn ngay khi di chuyển. Vì role vẫn là
`radio`, hành vi mặc định của Radix **lệch với chính ARIA nó phát ra**: trình đọc
màn hình đọc "radio, 1 of 3" rồi người dùng bấm mũi tên và không gì được chọn.

**Quyết định: nối lại chọn-theo-mũi-tên.** Lúc thương lượng, phương án này bị
loại vì nghe như "code tay đè lên shadcn". Tính toán đã đổi khi biết role vẫn là
`radio`: nối lại **không phải** đè lên shadcn, mà là làm component khớp với ARIA
của chính nó. Bỏ qua mới là để lại một control tự mâu thuẫn.

Cách làm: bắt `onKeyDown` ở Root, và với các phím mũi tên thì sau khi Radix
chuyển focus, phát `onChange` theo item đang được focus. Giữ nguyên roving focus
của Radix — không tự cài lại điều hướng, chỉ nối _chọn_ vào _focus_. Cần một test
riêng khẳng định điều này, vì nó là thứ dễ bị gỡ nhất trong lần refactor sau.

**KHÔNG được làm yếu đi:** nhãn và pulse của `StatusIndicator`. Header của
`status-indicator.tsx` bảo vệ chúng: `live` đỏ và `speaking` xanh lá nằm trên
cùng một chấm — đúng ca đỏ-xanh kinh điển. Nhãn là thứ giúp người mù màu phân
biệt; pulse là tín hiệu thứ hai (`live` pulse, không gì khác pulse). `Badge` cho
hình dáng, không lấy đi hai thứ đó.

**Thumb trượt.** Không phải đổi class. Thumb là phần tử anh em định vị tuyệt đối,
**đo từ layout thật chứ không suy từ index** — segment rộng theo chữ, mà
`Việt → Anh` và `Anh → Việt` không bằng nhau. Cần đặt chỗ trước rồi mới bật
transition (nếu không thumb bay từ góc vào ở lần vẽ đầu), cộng đo lại khi resize
và khi font load xong. Popup render cùng component trong 320px nên cả hai consumer
ăn một lúc.

Một phần tử không phải item nằm trong Root là an toàn: roving focus của Radix theo
dõi item qua collection context chứ không quét DOM, nên thumb không lọt vào vòng
điều hướng — miễn là nó mang `aria-hidden` và `pointer-events-none`.

## Related Code Files

- Create: `packages/ui/src/react/tabs.tsx` — CLI sinh, re-skin
- Create: `packages/ui/src/react/toggle-group.tsx` — CLI sinh, re-skin
- Create: `packages/ui/src/react/toggle.tsx` — `ToggleGroup` phụ thuộc
- Modify: `packages/ui/src/react/theme-toggle.tsx`
- Modify: `packages/ui/src/react/status-indicator.tsx`
- Modify: `packages/ui/src/react/direction-toggle.tsx`
- Modify: `packages/ui/src/react/segmented-control.tsx`
- Modify: `packages/ui/src/react/segmented-control.spec.tsx` — viết lại, không xoá
- Modify: `packages/ui/src/react/index.ts` — export mới

## Implementation Steps

1. `pnpm dlx shadcn@latest add tabs toggle-group` trong `packages/ui`. CLI ghi
   token của nó vào `src/styles/globals.css` — **bỏ hết**, file đó chỉ là bia đỡ
   cho CLI, không ai import.
2. Re-skin cả ba file mới theo bảng trong `docs/design-guidelines.md`: bỏ `dark:`,
   đổi `text-sm`/`text-xs` sang `text-body`/`text-hint`, đổi `bg-accent` sang
   `bg-secondary`, đổi import alias sang tương đối. Chạy `skin-guard.spec.ts`.
3. `ThemeToggle` → `ToggleGroup type="single"`. Giữ `value?: ThemeChoice` cho
   phép `undefined` — nhưng **truyền xuống Radix là `value ?? ''`**. Truyền
   `undefined` thẳng khiến `useControllableState` chạy ở chế độ uncontrolled rồi
   lật sang controlled khi theme resolve: React cảnh báo, và lựa chọn có thể kẹt.
   Giữ ba icon `Sun`/`Moon`/`Monitor`.
4. `StatusIndicator` → `Badge` bọc chấm + nhãn. Giữ nguyên bảng `TONE`, giữ
   `animate-ping` cho `live` và `motion-reduce:` che nó.
5. `DirectionToggle` → `Button` (nút swap) + `Badge` (hai phía). Giữ
   `languageName`, giữ luật không để lộ language code.
6. `SegmentedControl` → `ToggleGroup type="single"`, cộng hai lá chắn:
   - **Chặn giá trị rỗng.** Bấm lại đúng ô đang chọn khiến Radix gọi
     `onItemDeactivate` → `setValue('')` (đã xác nhận trong nguồn). Segmented
     control luôn phải có giá trị, nên: `onValueChange={(v) => v && onChange(v)}`.
   - **Gỡ lớp sơn cũ.** Bỏ `data-[state=on]:bg-secondary` khỏi item. Nếu giữ, hai
     phần tử cùng vẽ trạng thái chọn — đúng cái nhảy cóc mà thumb sinh ra để xoá.
7. Thumb trượt: phần tử anh em `absolute`, `aria-hidden` và `pointer-events-none`
   (nó không phải control, không được vào cây a11y). Đo bằng
   `offsetLeft`/`offsetWidth` chứ **không** dùng rect viewport — không phụ thuộc
   cuộn và không phải trừ border. Đặt chỗ trước rồi mới bật transition,
   `ResizeObserver` + `document.fonts.ready`.
8. **Nối chọn vào focus.** `onKeyDown` ở Root: với `ArrowLeft/Right/Up/Down`, sau
   khi Radix đã dời focus thì phát `onChange` theo item đang focus. Không tự cài
   lại điều hướng — roving focus vẫn là của Radix.
9. Viết lại `segmented-control.spec.tsx` theo hợp đồng **đúng**: assert
   `role="radiogroup"`, các `role="radio"` mang `aria-checked`, **mũi tên chọn
   ngay** (đủ bốn phím — đây là hành vi đã nối lại, và là test dễ bị gỡ nhất về
   sau nên phải nói rõ trong tên test), chọn bằng Enter/Space/click, bấm lại ô
   đang chọn **không** phát ra giá trị rỗng, và thumb khớp ô đang chọn.
   **Không xoá test — đổi hợp đồng nó assert.**
10. **Re-skin thẳng lên token elevation/motion của Phase 2**, không để dành cho
    Phase 4. Bốn file này bị viết lại ở đây; chạm lần hai chỉ tạo xung đột.
11. Chuẩn hoá nguồn import: repo dùng entry gộp `from 'radix-ui'`
    (`segmented-control.tsx:2`), còn CLI hay viết `@radix-ui/react-toggle-group`.
    `skin-guard.spec.ts` không soi chuyện này nên phải làm bằng tay.
12. Cập nhật `index.ts`: export `Tabs*`, `ToggleGroup`, `ToggleGroupItem`.
13. Chạy `pnpm turbo run typecheck test --filter=@chatofy/ui`, rồi bước đóng gói
    của turbo cho package đó, để bắt lỗi `rollup-plugin-dts`.

## Kết quả thực thi — 2026-08-21

**Bản đồ cuối, sau khi audit từng file:**

| Component                                                                                                       | Nền                                  |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `alert`, `badge`, `button`, `card`, `checkbox`, `label`, `radio-group`, `select`, `separator`, `tabs`, `toggle` | primitive shadcn (CLI sinh, re-skin) |
| `toggle-group`                                                                                                  | primitive shadcn, ghép từ `toggle`   |
| `theme-toggle`, `segmented-control`                                                                             | ghép từ `toggle-group`               |
| `direction-toggle`                                                                                              | ghép từ `button`                     |
| `status-indicator`                                                                                              | ghép từ `badge`                      |

Không còn component nào tự dựng cấu trúc.

**Ba thứ chỉ lộ ra khi làm thật:**

1. **Radix dời focus trong `setTimeout`, không đồng bộ.** Bản đầu của
   `onKeyDown` đọc `document.activeElement` ngay lập tức và luôn thấy item cũ;
   `requestAnimationFrame` thì đọc đúng trong trình duyệt nhưng **không bao giờ
   resolve dưới jsdom** — tức là hành vi quan trọng nhất của component sẽ không
   có test nào phủ. `setTimeout` độ trễ 0 xếp sau đúng cái timeout của Radix và
   chạy đúng ở cả hai nơi.

2. **jsdom không có `ResizeObserver`.** Stub trong spec chứ **không** nhét
   feature-detect vào component: mọi trình duyệt đích đều có nó từ lâu, nên một
   guard ở đó là code chết trong production mà lại nuốt luôn trường hợp nó thật
   sự biến mất.

3. **`Badge` có `overflow-hidden`** — sẽ cắt mất halo `animate-ping`, đúng tín
   hiệu thứ hai phân biệt `live` (đỏ) với `speaking` (xanh lá). Override đúng một
   thuộc tính, có ghi lý do. Còn lại `Badge` thật ra khớp mock **hơn** bản cũ:
   mock dùng 12px/600, tức `text-hint` + `font-semibold`, trong khi code cũ dùng
   `text-body`.

**`Tabs` ship không consumer**, đúng chủ đích. Comment trong file nói rõ vì sao
nó không phải nền của segmented control, và rằng ba route web là route thật chứ
không phải tab.

**Gate:** `@chatofy/ui` 25 · web 185 · extension 188 · typecheck+test+lint 12/12
task · **e2e extension 65 passed, 0 failed** · skin-guard xanh trên cả ba file
CLI sinh.

## Success Criteria

- [x] `tabs.tsx`, `toggle-group.tsx`, `toggle.tsx` tồn tại, re-skin, `skin-guard` xanh
- [x] Bốn composition không còn tự dựng cấu trúc — chỉ ghép primitive shadcn
- [x] `StatusIndicator` vẫn render nhãn và vẫn pulse khi `live`
- [x] Thumb trượt đúng vị trí với segment rộng khác nhau, và không bay vào ở frame đầu
- [x] `segmented-control.spec.tsx` assert `radiogroup`/`radio`/`aria-checked`, không phải `group`/`aria-pressed`
- [x] Có test chứng minh bấm lại ô đang chọn **không** phát ra giá trị rỗng
- [x] Có test chọn bằng Enter **và** Space
- [x] Có test **mũi tên chọn ngay** cho đủ bốn phím — hành vi nối lại, tên test phải nói rõ vì sao nó tồn tại
- [x] Item không còn tự vẽ trạng thái chọn — chỉ thumb vẽ
- [x] Mọi import Radix dùng entry gộp `'radix-ui'`
- [x] Bước đóng gói của `@chatofy/ui` xanh, gồm cả type
- [x] `Tabs` export nhưng chưa có consumer — có chủ đích

## Risk Assessment

**Rủi ro: mất khả năng dùng bàn phím mà không ai thấy.** Đổi từ chọn-theo-focus
sang focus-rồi-commit là hồi quy thật cho người dùng bàn phím, kể cả khi test mới
xanh.

- Tín hiệu đã vỡ: sau khi viết lại spec, không còn test nào chứng minh chọn được
  bằng bàn phím.
- Phản ứng đã định: spec mới **bắt buộc** phải có test chọn bằng Enter và Space,
  và test đi qua đủ bốn mũi tên. Thiếu là phase chưa xong. Đếm số assertion
  **không** thay thế được danh sách hành vi: viết lại đúng hợp đồng Radix vẫn giữ
  nguyên các assert về role, trong khi ý nghĩa của test mũi tên lặng lẽ đổi từ
  "chọn" sang "chuyển focus". Danh sách hành vi mới là thứ phải duyệt.

**Rủi ro: `Tabs` không consumer làm knip ồn thêm.** Đã đo: knip **không nằm trong
CI** (`ci.yml` chạy lint, typecheck, test, đóng gói, verify, e2e) và **đã đỏ sẵn**
— 5 unused export, không cái nào thuộc `packages/ui`.

- Tín hiệu đã vỡ: `packages/ui` lần đầu xuất hiện trong báo cáo knip.
- Phản ứng đã định: chấp nhận, đã quyết. Ghi vào Phase 6 để docs nói rõ `Tabs` cố
  ý chưa có consumer.

**Rủi ro: `rollup-plugin-dts` gãy vì alias.** CLI viết `@/lib/utils`; bundler
resolve được, dts thì không.

- Tín hiệu đã vỡ: bước đóng gói `@chatofy/ui` đỏ ở type, JS xanh.
- Phản ứng đã định: đổi sang import tương đối. `skin-guard.spec.ts` đã có luật này.
