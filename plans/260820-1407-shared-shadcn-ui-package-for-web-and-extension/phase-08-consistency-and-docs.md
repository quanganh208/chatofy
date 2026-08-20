---
phase: 8
title: 'Consistency and docs'
status: pending
priority: P2
effort: '0.5d'
dependencies: [5, 7]
---

# Phase 8: Consistency and docs

## Overview

Thu hoạch phần "đồng nhất", và sửa hai tài liệu đang **lập luận ngược** với những gì plan
này vừa làm.

## Requirements

- Functional: ThemeToggle và Alert là một component, dùng ở cả hai surface.
- Non-functional: không tài liệu nào còn khẳng định component bị từ chối khỏi
  `packages/ui`, và ràng buộc CSP **không bị xoá** — chỉ được viết lại thành ràng buộc
  còn sống.

## Architecture

Hai chỗ hợp nhất, cả hai là cùng khái niệm cài hai lần:

- **ThemeToggle.** Web ba nút radio, popup một `<select>`. Sau Phase 5 nó là một component
  controlled; ở đây hai surface cùng dùng. Ba nút biểu tượng chiếm một hàng thay vì khối
  label+select, nên ô Theme của popup thoát khỏi chỗ dưới fold.
- **Alert.** Hai severity, phân biệt bằng fill-vs-outline **cộng** hue ở cả hai nơi.

**Voice vẫn là hai control khác nhau** sau plan này (web SegmentedControl, popup Radix
Select). Không thuộc phạm vi đã chốt; ghi ra trong docs để không ai tưởng "đồng nhất" đã
trọn.

**Hai tài liệu phải sửa, và chỉ hai.**

`packages/ui/README.md` — mục "Tokens, not components" nêu ba lý do từ chối. Lý do overlay
và mobile **vẫn đúng nguyên văn**; chỉ lý do "component dùng chung sẽ chỉ có một consumer"
là hết đúng. (Bullet "No dependencies" ở `:44` đã sửa ở Phase 3, nơi ràng buộc thật sự đổi.)

`apps/extension/wxt.config.ts` — comment nêu hai lý do: overlay trong shadow root, và
eval/CSP. **Không xoá lý do CSP.** Ràng buộc đó không trở nên sai; nó trở nên _được thoả
mãn_, và đó là chuyện khác — nó sai lại ngay khi một dependency đổi. Viết lại thành ràng
buộc sống: "React và Tailwind nằm trong build này; MV3 cấm eval, và `<file guard>` là thứ
chứng minh mỗi build vẫn tuân thủ" — trỏ vào cổng Phase 6 đã dựng và Phase 1 đã làm cho
chạy được.

`docs/design-guidelines.md` là **bổ sung**, không phải đính chính — nó không mâu thuẫn gì.
Thêm ranh giới primitive-vs-composition và bảng re-skin, để lần sau không ai sinh
component rồi để nguyên `text-sm` và `dark:`.

## Related Code Files

- Modify: `packages/ui/README.md` (chỉ mục "Tokens, not components")
- Modify: `apps/extension/wxt.config.ts` (chỉ comment, **viết lại** chứ không thu hẹp)
- Modify: `docs/design-guidelines.md` (bổ sung)
- Modify: `packages/ui/src/react/{theme-toggle,alert}.tsx` + call site hai surface

## Implementation Steps

1. Hợp nhất ThemeToggle; xác nhận ô Theme của popup hiển thị không cần cuộn.
2. Hợp nhất Alert theo bản hai trục.
3. Viết lại hai tài liệu. Đọc trước khi sửa; kiểm mọi khẳng định lại với source.
4. Bổ sung `docs/design-guidelines.md`.
5. Chụp lại cả hai surface × hai theme, xem.

## Success Criteria

- [ ] ThemeToggle là một component, dùng ở cả hai surface; ô Theme popup không cần cuộn
- [ ] Alert hai severity, hai trục phân biệt, dùng chung
- [ ] `packages/ui/README.md` giữ nguyên văn lý do overlay và mobile; bỏ đúng lý do đã hết đúng
- [ ] Comment `wxt.config.ts` **vẫn nêu ràng buộc CSP**, và trỏ vào guard đang chạy
- [ ] `docs/design-guidelines.md` có ranh giới primitive-vs-composition + bảng re-skin,
      và ghi rõ Voice còn là hai control
- [ ] Ảnh chụp cả hai surface × hai theme, đã xem
- [ ] `turbo lint typecheck test build` xanh; e2e xanh

## Risk Assessment

**Viết lại README thành quảng cáo cho quyết định mới.** Tài liệu cũ có giá trị vì nó ghi
_vì sao_ từng từ chối.
_Tín hiệu:_ bản mới không còn giải thích được vì sao overlay và mobile ở ngoài.
_Phản ứng:_ giữ nguyên văn hai lý do đó.

**Xoá ràng buộc CSP vì "đã đo rồi".** Đây là finding riêng của red-team và đáng nhắc lại:
xoá một ràng buộc chỉ đúng khi ràng buộc thôi áp dụng.
_Tín hiệu:_ bản mới chỉ còn nói về overlay.
_Phản ứng:_ ràng buộc phải trỏ vào một cổng chạy được, nếu không thì đừng đụng nó.

**Hợp nhất ThemeToggle làm hỏng contract popup.** `chatofy.theme` cố ý ngoài
`CaptureSettings`. _Tín hiệu:_ đổi theme giữa cuộc gọi làm capture khởi động lại.
_Phản ứng:_ component đổi, đường ghi không đổi.
