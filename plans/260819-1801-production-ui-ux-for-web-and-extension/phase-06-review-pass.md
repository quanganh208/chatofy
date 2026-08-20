---
phase: 6
title: 'Review pass'
status: pending
priority: P1
effort: '2-3h'
dependencies: [4, 5]
---

# Phase 6: Review pass

## Overview

Một lượt review duy nhất, trên bộ state cố định từ Phase 1, cộng một lượt trên meeting
thật cho overlay. Đây là gate cho phần **không** cơ giới hoá được: kết quả có đẹp hay
không. Một lượt có tên, không phải vòng lặp thẩm mỹ mở.

## Requirements

- Functional: **review chạy trên dev build** (chốt 2026-08-20: chưa có backend deploy). Nên
  popup dev khác popup production về markup — dev giữ `#api`. Phase 5 đã ghi lại danh sách
  khác biệt; **trình danh sách đó cho người dùng cùng với bộ screenshot**, để họ biết chính
  xác control nào họ đang xem sẽ không có trong bản ship. Đây là hạn chế đã chấp nhận tường
  minh, không phải điều bỏ qua.
- Functional: bộ screenshot phủ trọn state list Phase 1 cho cả ba bề mặt.
- Functional: joint `pnpm knip` chạy **một lần** ở đây (không phải trong Phase 4 hay 5), và
  xử lý orphan của `packages/types` / `packages/realtime-client` — xem plan.md §Joint gate.
- Functional: một lượt trên meeting thật (Meet hoặc Zoom web) cho overlay — shadow root
  đóng nên đây là cách duy nhất thấy khiếm khuyết thị giác của overlay.
- Functional: whole-plan consistency sweep trước khi tuyên bố xong.
- Non-functional: người dùng chấp nhận, hoặc nêu thay đổi **cụ thể theo từng shot**.

## Architecture

**Vì sao gate này tồn tại và giới hạn của nó.** Criteria ở Phase 1-5 chốt được tính nhất
quán, inventory hierarchy, register, và state coverage. Chúng **không** chốt được vẻ đẹp.
Không có visual-regression tooling nào trong repo (không Storybook, không screenshot
baseline), nên sau phase này không có gì phát hiện regression thẩm mỹ. Chấp nhận, không
giải quyết — nêu ra để người dùng tự quyết có đầu tư sau hay không.

**Phân biệt hai loại phản hồi.** Nếu người dùng bác bỏ **chi tiết** → quay lại Phase 4/5
với danh sách theo shot. Nếu người dùng bác bỏ **hướng đi** → brainstorm đã mis-scope, và
việc đó quay về `/ak:brainstorm`, **không** phải sweep thêm một lượt. Đây là phân biệt
quan trọng nhất của phase này, vì sweep thêm khi hướng sai chỉ tốn thêm credibility.

## Related Code Files

- Modify: `docs/design-guidelines.md` (đóng mục Type divergence nếu chưa; exception table)
- Modify: `packages/ui/README.md` (sửa dòng "mobile has no screens yet" đã cũ)
- Modify: `docs/codebase-summary.md` (chỉ nếu hành vi đổi)

Không sửa code trừ khi review yêu cầu.

## Implementation Steps

1. Sinh bộ screenshot extension qua `e2e/run.mjs` (popup DOM-level, overlay pixel-level).
2. Chụp tay bộ screenshot web từ các route/state; state cần backend thì force giá trị và
   **ghi rõ đã force**.
3. Chạy overlay trên một meeting thật: pill idle, pill live, panel có turn, panel trên
   frame video sáng (đây là state mà `overlay.bg` opacity được thiết kế cho — nếu không
   đọc được thì fix là tăng opacity ở token overlay, **không** phải làm sáng text token
   dùng chung).
4. Trình bộ shot cho người dùng cạnh trạng thái hôm nay.
5. **Whole-plan consistency sweep:** đọc lại `plan.md` + cả 6 phase file. Tìm term cũ,
   giả định đã bị bác, API/file/field đã đổi tên, quyết định đã bị thay thế, draft trùng.
   Đối chiếu mâu thuẫn trên toàn plan, không chỉ phase vừa sửa.
6. Cập nhật docs **chỉ** ở nơi hành vi đổi: `docs/design-guidelines.md`,
   `packages/ui/README.md` (dòng mobile đã cũ).
7. Chạy full gate lần cuối: `pnpm turbo run lint typecheck test build`, rồi `pnpm knip`
   (so baseline) và `pnpm --filter extension test:e2e` — chạy tay, CI không chạy hai cái
   này. **`pnpm test:e2e` ở root không tồn tại** (root `package.json` không có script đó).

## Success Criteria

- [ ] Bộ screenshot phủ trọn state list Phase 1; không state nào thiếu shot hoặc ghi chú
- [ ] Overlay đã được xem trên meeting thật, gồm frame video sáng
- [ ] Whole-plan consistency sweep báo **0** mâu thuẫn chưa giải quyết
- [ ] `docs/design-guidelines.md` đóng mục Type divergence + có exception table nếu có ngoại lệ
- [ ] `packages/ui/README.md` sửa dòng mobile đã cũ
- [ ] Danh sách khác biệt dev↔production (từ Phase 5) được trình cùng bộ screenshot — người dùng biết control nào họ xem sẽ không ship
- [ ] Joint `pnpm knip` chạy một lần: **không finding mới** so với baseline đã ghi ở Phase 1. Nó **fail sẵn hôm nay** (exit 1: `SITE_ENABLEMENT_KEY`, 3 export mobile, 2 type) và một finding nằm trong `site-enablement.ts` — file Phase 5 cấm chạm, nên "sạch" là bất khả thi
- [ ] Orphan của `packages/types` / `packages/realtime-client` đã xử lý (xem plan.md §Joint gate)
- [ ] `pnpm turbo run lint typecheck test build` xanh; `pnpm knip` + `pnpm --filter extension test:e2e` xanh (chạy tay)
- [ ] **Gate: người dùng chấp nhận**, hoặc nêu thay đổi cụ thể theo shot

## Risk Assessment

- **Risk:** mọi criterion xanh mà người dùng vẫn không thích. Đây là rủi ro không loại bỏ
  được, chỉ giảm bằng gate glossary ở Phase 1 và bộ shot cố định ở đây.
  **Signal:** phản hồi nói về _hướng_, không phải chi tiết.
  **Response:** quay về `/ak:brainstorm`. Không sweep thêm.
- **Risk:** review biến thành vòng lặp mở, mỗi lượt một ý kiến mới.
  **Signal:** lượt review thứ ba xuất hiện.
  **Response:** một lượt có tên đã thoả thuận. Yêu cầu danh sách theo shot, không phải
  cảm nhận chung.
- **Risk:** sau phase này không có gì chặn regression thẩm mỹ.
  **Signal:** không — theo định nghĩa.
  **Response:** nêu rõ với người dùng; nếu họ muốn bảo vệ thì visual-regression tooling
  là một plan riêng, không nhồi vào đây.
- **Risk:** overlay đọc không được trên frame video sáng và phản xạ là làm sáng text token.
  **Signal:** đề xuất đổi `text`/`textSecondary`.
  **Response:** guidelines đã trả lời: fix là tăng opacity ở `overlay.bg`, **không bao
  giờ** làm sáng token text dùng chung. Từ chối bằng dẫn chứng.
