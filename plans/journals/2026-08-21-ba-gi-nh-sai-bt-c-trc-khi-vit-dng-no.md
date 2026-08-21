---
title: 'Ba giả định sai, bắt được trước khi viết dòng nào'
date: 2026-08-21
summary: 'Brainstorm + plan đảo hướng UI sang elevation/motion và shadcn toàn bộ; red-team bắt được ba giả định sai, một trong số đó sẽ ship phẳng với CI xanh.'
---

# Ba giả định sai, bắt được trước khi viết dòng nào

## Bối cảnh

Branch `feat/production-ui-ux` ship đúng spec và vẫn bị từ chối lần hai. Chẩn
đoán: không phải bug. `docs/design-guidelines.md` viết _"separates surfaces with
rules instead of luminance steps"_ nên không token elevation nào tồn tại, và mục
Motion cấp phép đúng 4 chuyển động nên không token duration/easing nào tồn tại.
Cái người dùng ghét chính là direction đang chạy đúng spec.

Nghịch lý tìm được: overlay — bề mặt duy nhất **ngoài** token layer — lại là bề
mặt duy nhất có chiều sâu, bằng hai dòng `box-shadow` hardcode ở
`overlay-styles.ts:81` và `:119`.

## Ba giả định sai, bắt được trước khi viết dòng nào

**1. `light-dark()` không bọc được shadow list.** Tôi đã viết vào plan
`--elevation-md: light-dark(<list>, <list>)`. Theo CSS Color 5 nó là hàm
`<color>`. Custom property vẫn parse (token stream tùy ý), nhưng lúc
`box-shadow: var(...)` thay vào thì invalid at computed value time → `box-shadow`
về `none`. Hậu quả nếu làm theo: **không bóng ở cả hai theme, CI xanh hoàn
toàn** — ship phẳng đúng cái plan sinh ra để chấm dứt. Parity spec so khớp bằng
regex trên văn bản, không dựng CSSOM, nên không thể thấy.

Tệ hơn: plan còn **cấm cách viết duy nhất chạy được** vì tưởng là né guard. Cách
đúng là `light-dark()` ở vị trí màu của từng layer, layer không thuộc theme thì
màu là `transparent`. Bắt buộc phải vậy vì web không có khối `.dark` —
`globals.css:173-177` ghi rõ hai class chỉ chuyển `color-scheme`.

**2. Cái giá ToggleGroup được nêu ra là sai.** Đã nói với người dùng rằng chuyển
`SegmentedControl` sang `ToggleGroup` sẽ mất `role="radiogroup"`. Đọc thẳng
`@radix-ui/react-toggle-group@1.1.19`: `type="single"` vẫn render
`role="radiogroup"` với `role="radio"` mang `aria-checked`, `aria-pressed` bị gỡ
tường minh. Bản spec rewrite đã viết (assert `role="group"`, `aria-pressed`) sẽ
đỏ ngay ngày đầu.

Cái mất thật khác hẳn và khó chịu hơn: role vẫn là `radio` nhưng roving focus
khiến mũi tên chuyển focus mà không chọn — role và hành vi nói hai chuyện khác
nhau. Quyết định: nối lại chọn-theo-mũi-tên, vì như vậy không phải đè lên shadcn
mà là làm component khớp với ARIA của chính nó.

**3. Tailwind v4 không có namespace `--duration-*`.** Bảng chính thức có
`--shadow-*`, `--inset-shadow-*`, `--ease-*` — không có duration. `--duration-fast`
trong `@theme inline` sẽ không sinh ra `duration-fast`.

## Bài học quy trình

Vòng trước ship đúng spec và vẫn trượt, vì spec viết bằng chữ và duyệt bằng chữ.
Direction đang dùng vốn được chọn qua mock HTML (`visual-direction.html`) — đúng
cổng mà vòng đó bỏ qua.

Lần này dựng `mock.html` làm cổng chặn cứng: Phase 2 không được bắt đầu khi mục
"Giá trị đã chốt" của Phase 1 còn trống. Và phải hỏi riêng về cột dark, vì dark
`--card` **đã** là `#191B1E` trên nền `#111214` (`globals.css:133`) — bậc độ sáng
mà plan trông cậy thì hôm nay đã dùng, mà người dùng vẫn gọi dark là phẳng.

## Hai thứ không chuyển được, và spec chặn chúng

- **Overlay:** `overlay-invariants.spec.ts:70` assert không `var(` trong sheet.
  Mọi utility Tailwind sinh custom property, và `all: initial` không reset custom
  property — chúng cố ý băng qua shadow boundary. Overlay dùng Tailwind nghĩa là
  trang họp repaint được chỉ báo đang ghi âm. Invariant bảo mật, không phải khẩu vị.
- **`apps/mobile`:** React Native, không DOM.

## Khuyết tật hạ tầng tìm được

`docs/design-guidelines.md:29` và `tokens.ts:41` đều viện dẫn
`plans/260820-1131-two-theme-palette/measure-palette.py` làm thẩm quyền thực thi.
`plans/` là thư mục trạng thái và **đã bị xoá một lần ngay trong session này**,
mang theo thẩm quyền được viện dẫn. Đưa nó thành spec committed cạnh
`token-parity.spec.ts`.

Một khuyết tật nhỏ hơn: docs viết _"each is banned by skin-guard.spec.ts"_ —
sai với hàng `hover:bg-primary/90`. Spec không cấm nó; đó là luật review.

## Next steps

- Người dùng duyệt `mock.html`, trả lời riêng cho cột dark.
- Phase 2 có bước 0 bắt buộc: kiểm chứng bằng mắt bóng hiện ở cả hai theme, và
  kiểm chứng `--duration-*` trên Tailwind đang cài, trước khi viết token.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
