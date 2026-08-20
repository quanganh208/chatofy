---
title: 'Two-theme palette on the Tĩnh direction'
description: 'Đổi palette sản phẩm sang hướng Tĩnh và cho người dùng chọn light / dark / theo máy trên web, popup và mobile. Overlay giữ nguyên tối.'
status: pending
priority: P1
effort: '2-3d'
tags: [ui, design-tokens, theming, web, extension, mobile]
created: 2026-08-20
---

# Two-theme palette on the Tĩnh direction

## Overview

Phase 6 của [plan trước](../260819-1801-production-ui-ux-for-web-and-extension/plan.md)
bị chặn: người dùng bác **hướng thị giác**, không phải chi tiết — nền phẳng, font không
dùng chung, một accent làm mọi việc, khoảng trống lỏng. Ba hướng được dựng lại trên bề mặt
thật ([`visual-directions-v2.html`](../260819-1801-production-ui-ux-for-web-and-extension/visual-directions-v2.html));
người dùng chốt **Tĩnh**, và thêm một yêu cầu: **light / dark / theo máy, do người dùng chọn**.

Hai điều làm việc này rẻ hơn vẻ ngoài của nó.

**Ổ cắm đã có sẵn ở cả ba bề mặt.** `apps/mobile/src/ui/theme.ts:53` đã khai
`colors: Record<ColorScheme, ThemeColors>` với hai khoá trỏ cùng một palette, kèm comment
"When a light theme is designed, this is where it lands". `apps/web/app/globals.css:17` đã
khai `@custom-variant dark`, và `@theme inline` đã map `--color-*` sang `var(--*)` nên đổi
giá trị trong `:root` là đổi toàn bộ utility. Chỉ `popup/styles.ts` là phải viết lại thật.

**Overlay không đụng tới.** Quyết định dark-only cũ ghi lý do đúng nhưng suy rộng sai:
overlay bắt buộc tối _vì nó nằm trên video của người khác và `prefers-color-scheme` trong
content script báo theo OS chứ không theo trang_ — điều đó buộc **overlay** phải tối, không
buộc web và popup phải tối theo. Tách ra thì `OVERLAY_STYLE` giữ nguyên một chuỗi literal,
bất biến "không `var(`" còn nguyên, và `overlay-invariants.spec.ts` không phải sửa một dòng.
Bề mặt rủi ro nhất nằm ngoài phạm vi.

## Goals

| #   | Goal                                                                        | Priority |
| --- | --------------------------------------------------------------------------- | -------- |
| 1   | Palette Tĩnh, hai nền, mọi cặp màu có tỉ lệ tương phản đo được              | P1       |
| 2   | `tokens.ts` mang hai palette; parity spec kiểm **cả hai**, không phải một   | P1       |
| 3   | Web: light / dark / theo máy, có lựa chọn lưu lại, không nháy theme lúc tải | P1       |
| 4   | Popup: cùng ba chế độ; mobile: điền vào map đã chờ sẵn                      | P1       |
| 5   | Overlay **không đổi** — có assertion chứng minh nó độc lập với theme        | P1       |
| 6   | Bỏ mũi tên text ở hướng dịch, thay bằng cụm nguồn/đích có nút swap vẽ       | P2       |

## Phases

| #   | Phase                                                                 | Status  |
| --- | --------------------------------------------------------------------- | ------- |
| 1   | [Palette và khoá tương phản](./phase-01-palette-and-contrast.md)      | Pending |
| 2   | [Tầng token và parity spec](./phase-02-token-layer.md)                | Pending |
| 3   | [Web: hai theme và bộ chọn](./phase-03-web-theming.md)                | Pending |
| 4   | [Popup, mobile, và cụm ngôn ngữ](./phase-04-popup-mobile-langpair.md) | Pending |

**Dependencies:** `1 → 2 → 3` và `2 → 4`. Phase 3 và 4 chạy song song được: file set rời nhau
(`apps/web` so với `apps/extension` + `apps/mobile`), giao nhau duy nhất ở `packages/ui`, vốn
đã đóng băng sau Phase 2.

## Decisions already made (do not re-litigate)

| Câu hỏi                  | Quyết định (2026-08-20)                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Hướng thị giác           | **Tĩnh** — gần như không màu, thứ bậc do cỡ chữ và khoảng trống, accent đúng một nút mỗi màn  |
| Overlay có theo theme    | **Không.** Luôn tối. Meet và Zoom đều nền tối; một tấm sáng đè lên video là thứ chói nhất màn |
| Phạm vi theme            | Web, popup, mobile. Ba chế độ: light, dark, theo máy                                          |
| Mũi tên `→` ở hướng dịch | **Bỏ.** Thay bằng hai ô có nhãn Source/Translation và nút swap vẽ bằng SVG                    |

## Success Criteria

- [ ] `packages/ui/src/tokens.ts` xuất hai palette; `overlay` tokens vẫn là **một** bộ
- [ ] `token-parity.spec.ts` kiểm **cả hai** palette — test phải **fail** nếu chỉ điền một nửa `globals.css`
- [ ] Mọi cặp text/nền trong cả hai theme ≥ 4.5:1 (chữ thường) và ≥ 3:1 (chữ lớn), có bảng số đo trong `docs/design-guidelines.md`
- [ ] Accent mới cách token `speaking` ≥ 60° hue ở cả hai theme — hôm nay cyan cách 40.1°, và guidelines đã gọi đó là "chỉ chấp nhận được vì luôn có nhãn"
- [ ] Web: chọn light trên máy đang dark thì ra light, và ngược lại — kiểm cả bốn chiều
- [ ] Web: **không nháy theme** khi tải lại ở chế độ đã chọn (script chặn trước paint)
- [ ] Popup: cùng ba chế độ, lựa chọn sống qua lần mở popup sau
- [ ] `apps/mobile/src/ui/theme.ts`: hai khoá `light`/`dark` trỏ **hai** palette khác nhau; comment "light carries the dark values for now" bị xoá vì không còn đúng
- [ ] Overlay **nhận palette tối mới** (nó import `color`, và để nó ở lại cyan thì nó thành bề mặt duy nhất chưa đổi — đúng kiểu trôi dạt plan này chống). Cái bất biến là nó **không có nửa sáng**: `OVERLAY_STYLE` không được đọc `colorLight`/`palettes`, và mọi bất biến cũ vẫn xanh
- [ ] 0 mũi tên `→` trong chuỗi hướng dịch: `direction-toggle.tsx:13-14`, `overlay.ts:203-204`, `cascade-panel.tsx:34`. Mũi tên đường dẫn menu (`overlay.ts:59,354-355`) **giữ nguyên** — khác idiom
- [ ] `pnpm turbo run lint typecheck test build` xanh; `pnpm --filter extension test:e2e` xanh; `pnpm knip` không finding mới so với baseline đã ghi ở plan trước
- [ ] Bộ screenshot **cả hai theme** cho web và popup; overlay chụp lại ở palette mới, chứng minh nó chỉ có một nền
- [ ] Người dùng chấp nhận

## Bẫy đã biết

**Parity spec chỉ kiểm một nửa là kiểm không gì cả.** `token-parity.spec.ts` hôm nay iterate
key của `color` và đối chiếu `MAPPING` với `globals.css`. Thêm palette thứ hai mà không mở
rộng spec thì nửa còn lại trôi tự do — và spec vẫn xanh. Test mới phải fail trên tree chỉ
điền một nửa, trước khi điền nốt.

**Nháy theme là lỗi chỉ thấy khi tải lại.** Next.js App Router render server trước, nên lựa
chọn nằm trong `localStorage` chưa tồn tại lúc HTML đầu tiên tới. Không có script chặn trong
`<head>`, người chọn light trên máy dark sẽ thấy một nháy tối mỗi lần tải. Không test tự động
nào bắt được; phải kiểm bằng mắt và ghi lại.

**Popup không có `prefers-color-scheme` miễn phí.** `popup/styles.ts:31` đang khai
`:root { color-scheme: dark }` và nội suy màu thành literal. Đổi sang custom property là viết
lại cách file đó sinh CSS — và nhớ ràng buộc "không backtick trong template literal" ghi ở
đầu file, thứ đã một lần làm hỏng stylesheet khi bị sửa bằng script.

**`apps/mobile` import trực tiếp `color`.** Đổi shape export của `tokens.ts` làm mobile không
compile. Mobile nằm trong `pnpm turbo run typecheck`, nên nó sẽ báo — nhưng phải sửa cùng
Phase 2 chứ không để sang phase sau.

<!-- slug: two-theme-palette -->
