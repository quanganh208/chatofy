---
phase: 1
title: 'Palette và khoá tương phản'
status: pending
priority: P1
effort: '3-4h'
dependencies: []
---

# Phase 1: Palette và khoá tương phản

## Overview

Chốt giá trị hex cho hai nền của hướng Tĩnh, và **đo** thay vì ước lượng. Không sửa code
sản phẩm ở phase này — đầu ra là một bảng số và một mock chứng minh bảng số đó đứng được.

Mock hiện có (`visual-directions-v2.html`, mục 3 và 4) đã có bản nháp cho cả hai nửa. Phase
này biến nháp thành palette đầy đủ: hôm nay nó mới có ~12 token, trong khi `globals.css` cần
73 biến và `tokens.ts` có 30+ khoá màu.

## Requirements

- Functional: mỗi khoá trong `color` của `tokens.ts` có giá trị cho **cả hai** nền.
- Functional: bảng tỉ lệ tương phản cho mọi cặp text/nền thực sự được dùng.
- Functional: accent mới cách `speaking` ≥ 60° hue ở cả hai nền.
- Non-functional: `overlay.*` tokens **không đổi** — overlay đã chốt là luôn tối.
- Non-functional: không sửa file nào trong `apps/` hay `packages/`.

## Architecture

### Vì sao đo hue chứ không chỉ đo tương phản

Guidelines đã ghi điểm yếu sẵn có: `speaking` (`#30A46C`) đứng cạnh `accent` (`#00A2C7`) là
"green against cyan rather than green against purple", và nó "tolerable only because the
labelling rule above already holds everywhere". Đo được: cyan cách green **40.1°**.

Khi so ba hướng, hai trong ba làm điểm này **tệ hơn** — teal của Bàn trộn 24.4°, mực của Bản
ghi 12.5°. Xanh dương của Tĩnh 79.1°. Đây là lý do định lượng để chọn Tĩnh, nên nó phải trở
thành criterion chứ không phải một lần đo rồi quên.

### Hai nền không phải một bảng đảo ngược

Đảo `#FFFFFF`↔`#131313` cho mọi khoá là cách nhanh nhất để có một theme sáng xấu. Ba chỗ
phải tính riêng:

- **Accent trên nền sáng cần đậm hơn.** Xanh của mock nửa sáng là `#2F4CE0`, nửa tối là
  `#7A90F5`. Cùng vai trò, hai giá trị — vì chữ trắng trên xanh nhạt không đọc được, và xanh
  đậm trên nền than cũng vậy.
- **`live` và `speaking` phải giữ nghĩa ở cả hai nền.** Đỏ và xanh lá là cặp phân biệt bởi
  nhãn chứ không bởi màu (guidelines), nên chúng chỉ cần đủ tương phản với nền của chúng.
- **Bậc nền tách bằng đường kẻ, không bằng độ sáng** — đó là cơ chế của Tĩnh. Nên `border`
  quan trọng hơn `surface` ở hướng này, ngược với palette hiện tại.

## Related Code Files

- Đọc: `packages/ui/src/tokens.ts` (danh sách khoá phải phủ)
- Đọc: `apps/web/app/globals.css` (73 biến phải phủ)
- Đọc: `apps/web/src/design/token-parity.spec.ts` (`MAPPING` cho biết khoá nào tới được web)
- Modify: `plans/260819-1801-.../visual-directions-v2.py` (mở rộng mock lên palette đầy đủ)
- Create: bảng số đo, dán vào `docs/design-guidelines.md` ở Phase 2 chứ không phải ở đây

## Implementation Steps

1. Liệt kê mọi khoá `color` trong `tokens.ts` và mọi biến trong `globals.css`; đối chiếu với
   `MAPPING` để biết khoá nào thực sự tới được web. Khoá nào không tới thì hỏi tại sao trước
   khi gán cho nó hai giá trị.
2. Gán giá trị nền sáng cho từng khoá, lấy nửa sáng của Tĩnh làm điểm khởi đầu.
3. Gán giá trị nền tối, lấy nửa tối làm điểm khởi đầu — **không** đảo ngược bảng sáng.
4. Viết script đo: mọi cặp text/nền, tỉ lệ WCAG, cộng khoảng cách hue giữa `accent`,
   `speaking`, `live`, `warning`. Script sống trong plan dir, không trong `apps/`.
5. Sửa giá trị nào không đạt. Ghi lại **giá trị đã bị bác và lý do**, không chỉ giá trị cuối.
6. Cập nhật mock lên palette đầy đủ, render cả hai nửa, xem lại bằng mắt.
7. Trình bảng số + mock cho người dùng. Đây là gate: sai palette ở đây thì Phase 2-4 vô nghĩa.

## Success Criteria

- [ ] Mọi khoá `color` có hai giá trị; `overlay.*` vẫn một
- [ ] Bảng tương phản: mọi cặp đang dùng ≥ 4.5:1, hoặc ≥ 3:1 nếu là chữ ≥ 22px, kèm số đo
- [ ] `accent` cách `speaking` ≥ 60° hue ở **cả hai** nền
- [ ] `live` cách `speaking` ≥ 60° hue ở cả hai nền — chúng là cặp có/không nguy hiểm
- [ ] Không cặp nào chỉ đạt nhờ làm sáng token text dùng chung; nếu thiếu tương phản thì sửa nền
- [ ] Mock render đủ cả hai nửa với palette đầy đủ
- [ ] **Gate: người dùng chấp nhận bảng màu.** Chặn mọi phase sau

## Risk Assessment

- **Risk:** đảo bảng tối thành bảng sáng rồi gọi đó là thiết kế.
  **Signal:** giá trị sáng là hàm số học của giá trị tối.
  **Response:** ba khoá nêu ở Architecture phải tính riêng, có lý do viết ra.
- **Risk:** đo tương phản trên cặp không ai dùng, bỏ sót cặp có dùng.
  **Signal:** bảng số đẹp nhưng màn hình thật vẫn khó đọc.
  **Response:** danh sách cặp lấy từ `MAPPING` và từ mock, không tự nghĩ ra.
- **Risk:** phase này phình thành thiết kế lại bố cục.
  **Signal:** bắt đầu sửa spacing, không phải màu.
  **Response:** bố cục thuộc hướng Tĩnh và đã chốt ở mock. Ở đây chỉ có màu.
