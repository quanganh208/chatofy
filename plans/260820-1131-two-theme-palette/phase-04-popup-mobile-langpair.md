---
phase: 4
title: 'Popup, mobile, và cụm ngôn ngữ'
status: pending
priority: P1
effort: '5-6h'
dependencies: [2]
---

# Phase 4: Popup, mobile, và cụm ngôn ngữ

# Overview

Popup nhận ba chế độ như web. Mobile điền vào map đã chờ sẵn. Và mũi tên text ở hướng dịch bị
thay bằng cụm nguồn/đích có nút swap vẽ — trên cả web, popup và overlay.

Chạy song song với Phase 3: file set rời nhau, giao nhau duy nhất ở `packages/ui` vốn đã đóng
băng sau Phase 2.

## Requirements

- Functional: popup có ba chế độ, lựa chọn sống qua lần mở sau.
- Functional: mobile có hai palette thật.
- Functional: 0 mũi tên `→` trong chuỗi hướng dịch ở cả ba bề mặt.
- Non-functional: `OVERLAY_STYLE` chỉ đổi phần cụm ngôn ngữ, **không** đổi màu.
- Non-functional: `overlay-invariants.spec.ts` và `popup-structure.spec.ts` xanh.

## Architecture

### Popup phải đổi cách sinh CSS, không chỉ đổi giá trị

`popup/styles.ts:31` khai `:root { color-scheme: dark }` và nội suy màu thành **literal** khắp
template. Ba chế độ nghĩa là phải phát ra custom property rồi override — tức viết lại cách file
đó sinh CSS, không phải thay vài hex.

Bẫy đã cắn một lần: đầu file ghi "No backticks below: this is a template literal", và một lần
sửa bằng script đã nuốt mất backtick đóng, làm stylesheet mang hai ký tự rác suốt nhiều commit
mà không gate nào thấy — vì không có gì trong repo parse CSS. Khi sửa file này, kiểm bằng cách
**parse chuỗi đã compile**, không phải đọc source.

Popup là trang extension bình thường nên `prefers-color-scheme` và `chrome.storage` đều dùng
được. Không cần script chặn như web: popup dựng DOM từ module của chính nó, chưa từng có HTML
render sẵn để nháy.

### Lựa chọn theme của popup không thuộc CaptureSettings

`CaptureSettings` là thứ worker gửi cho offscreen document lúc bắt đầu capture. Theme không ảnh
hưởng gì tới capture, và nhét vào đó sẽ khiến mỗi lần đổi theme trở thành một lần ghi settings
mà worker phải xử lý. Dùng khoá storage riêng, giống `chatofy.recordingNoticeSeen` — thứ cũng
cố ý nằm ngoài settings vì cùng lý do.

### Overlay: đổi cấu trúc, không đổi màu

Overlay vẫn luôn tối. Nhưng nó **cũng** có hai `<select>` mang nhãn `EN → VI` / `VI → EN`
(`overlay.ts:203-204`), nên cụm ngôn ngữ áp vào đây. Đây là thay đổi cấu trúc trong shadow
root, và mọi bất biến cũ vẫn phải đứng: một rule `:host`, không `var(`, không `innerHTML`,
host không id, indicator trước transcript.

### Mũi tên nào bị bỏ, mũi tên nào giữ

Bỏ ở: `direction-toggle.tsx:13-14`, `overlay.ts:203-204`, `cascade-panel.tsx:34`.

**Giữ** ở `overlay.ts:59,354-355` — `"right-click → Chatofy"` là đường dẫn qua menu, một idiom
khác hẳn hướng dịch. Ghi rõ để lần sweep sau không xoá nhầm rồi tưởng là dọn dẹp.

## Related Code Files

- Modify: `apps/extension/entrypoints/popup/styles.ts` (custom property; ba chế độ)
- Modify: `apps/extension/entrypoints/popup/index.html` + `main.ts` (bộ chọn)
- Create: `apps/extension/src/theme.ts` (đọc/ghi lựa chọn, khoá storage riêng)
- Create: `apps/extension/src/theme.spec.ts`
- Modify: `apps/mobile/src/ui/theme.ts` (nếu Phase 2 chưa xong phần này)
- Modify: `apps/web/src/components/translate/direction-toggle.tsx` (cụm ngôn ngữ)
- Modify: `apps/web/src/components/translate/cascade-panel.tsx` (bỏ tiêu đề trùng lặp)
- Modify: `apps/extension/entrypoints/content/overlay.ts` (cụm ngôn ngữ trong shadow root)
- Modify: `apps/extension/src/popup-structure.spec.ts` (assert không còn mũi tên hướng dịch)
- **Không sửa:** `apps/extension/src/site-enablement.ts`

## Implementation Steps

1. Viết `src/theme.ts` + spec: đọc, ghi, xoá; vắng giá trị nghĩa là theo máy.
2. Viết lại `popup/styles.ts` sang custom property, `:root` sáng, override cho tối, cộng khối
   `prefers-color-scheme`. Kiểm bằng cách parse `POPUP_STYLE` đã compile — đếm rule, xác nhận
   không có token rác ở cuối chuỗi.
3. Thêm bộ chọn vào popup. Nó là control phụ, **không** được cạnh tranh với Start —
   Phase 5 của plan trước vừa dựng lại toàn bộ popup quanh nguyên tắc một hành động chính.
4. Mobile: hai khoá, hai palette (nếu Phase 2 chưa làm).
5. Cụm ngôn ngữ trên web: `direction-toggle.tsx` thành cụm nguồn/đích; bỏ tiêu đề trùng ở
   `cascade-panel.tsx:34` vì cụm đã nói hướng rồi.
6. Cụm ngôn ngữ trong overlay. Chạy `overlay-invariants.spec.ts` sau mỗi bước.
7. Thêm assertion: không chuỗi hướng dịch nào chứa `→`; và `OVERLAY_STYLE` không đổi màu.
8. Gate: `pnpm --filter extension test` / `typecheck` / `lint` / `build` — **riêng từng lệnh**;
   rồi `pnpm --filter extension test:e2e`. Nhớ recompile trước e2e, guard sẽ chặn nếu quên.
9. Chụp lại bộ screenshot popup ở cả hai theme, và overlay để chứng minh nó không đổi.

## Success Criteria

- [ ] Popup: ba chế độ; lựa chọn sống qua lần mở sau; mặc định theo máy
- [ ] `POPUP_STYLE` sau compile parse được, số rule khớp số khai trong source, không token rác
- [ ] Bộ chọn theme trong popup không phải nút filled — Start vẫn là hành động filled duy nhất
- [ ] Lựa chọn theme **không** nằm trong `CaptureSettings`
- [ ] `apps/mobile`: hai khoá trỏ hai palette khác nhau
- [ ] 0 mũi tên trong chuỗi hướng dịch ở cả ba bề mặt; assertion chặn tái diễn
- [ ] `overlay.ts:59,354-355` **vẫn còn** `→` — đường dẫn menu, cố ý giữ
- [ ] `OVERLAY_STYLE`: không giá trị màu nào đổi; diff chỉ chạm phần cụm ngôn ngữ
- [ ] `overlay-invariants.spec.ts` xanh: một `:host`, không `var(`, không `innerHTML`, host không id
- [ ] `popup-structure.spec.ts` xanh; mọi `el('id')` vẫn có id tương ứng
- [ ] `pnpm --filter extension test:e2e` xanh, gồm cả hai isolation attack
- [ ] Screenshot popup hai theme; screenshot overlay chứng minh không đổi

## Risk Assessment

- **Risk:** viết lại `styles.ts` bằng script rồi nuốt ký tự như lần trước.
  **Signal:** không có — trình duyệt bỏ qua token hỏng im lặng.
  **Response:** parse chuỗi đã compile, đếm rule. Đây là gate, không phải bước kiểm thêm.
- **Risk:** bộ chọn theme phá nguyên tắc một hành động chính của popup.
  **Signal:** hai nút filled trên một màn.
  **Response:** criterion đếm.
- **Risk:** đổi màu overlay "cho nhất quán".
  **Signal:** giá trị màu trong diff của `overlay-styles.ts`.
  **Response:** revert. Overlay tối là quyết định đã chốt.
- **Risk:** xoá luôn mũi tên đường dẫn menu rồi tưởng là dọn sạch.
  **Signal:** `overlay.ts:354` trong diff.
  **Response:** criterion yêu cầu nó **còn**.
- **Risk:** chạy e2e trên bundle cũ.
  **Signal:** không — nhưng guard staleness đã có và sẽ chặn.
  **Response:** recompile trước, để guard làm việc của nó.
