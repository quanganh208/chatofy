---
title: 'Phase 5: Extension Background Collaborators'
status: todo
phase: 5
priority: P2
effort: '6h'
dependencies: []
---

# Phase 5: Extension Background Collaborators

## Overview

`apps/extension/entrypoints/background.ts` là 646 dòng — file lớn nhất repo và
file thủ tục thật sự duy nhất: ~20 hàm module-level thao tác trên state
module-level, **không có spec nào**.

Tách các collaborator có state sang `apps/extension/src/` nơi đã có harness test.

## Requirements

- Functional: hành vi service worker không đổi, gồm cả khôi phục state sau evict.
- Non-functional: logic có state có spec; `entrypoints/background.ts` chỉ còn wiring.

## Architecture

**Lý do là ranh giới KIỂM THỬ, không phải "class hoá".** Nói rõ vì nó quyết định
phạm vi:

| Thư mục                       | Spec | Đã có class                        |
| ----------------------------- | ---- | ---------------------------------- |
| `apps/extension/src/`         | 5    | `MeetingCapture`, `DuckController` |
| `apps/extension/entrypoints/` | 0    | —                                  |

**KHÔNG biến `background.ts` thành một class singleton.** MV3 service worker bị
evict tuỳ ý; nguồn state có thẩm quyền đã là `chrome.storage`
(`PATCHED_TABS_KEY:111`, `ACTIVE_TAB_KEY:122`, `restoreSessionState:132`) — biến
module chỉ là cache nóng. Một instance singleton có **đúng cùng vòng đời** với
module: thay đổi hành vi bằng 0, diff lớn, không có test đỡ. Đó là nghi thức rỗng.

Tách theo ba cụm gắn kết sẵn có:

| Collaborator         | Nguồn                                   | Sở hữu                                                                                      |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PatchedTabRegistry` | `:46-61`, `:78-111`, `:124`, `:153-199` | `patchedTabs`, probe/refresh, đăng ký content script, bền hoá                               |
| `OffscreenHost`      | `:221-242`                              | `hasOffscreen`, `ensureOffscreen`, đường dẫn tài liệu                                       |
| `OverlayPublisher`   | `:30`, `:382-446`                       | state overlay, `publish`, `applyStatus`, `applyTranscript`, ceiling `MAX_OVERLAY_LINES:418` |

Còn lại trong `background.ts`: đăng ký listener, lệnh, menu ngữ cảnh, và điều
phối `startCapture`/`stopCapture`/`toggleCaptureFor`. Đó là wiring — đúng chỗ
cho một entrypoint.

`chrome.*` được **inject** vào từng collaborator, không gọi thẳng — đó là thứ làm
chúng test được.

## Related Code Files

- Create: `apps/extension/src/patched-tab-registry.ts` + `.spec.ts`
- Create: `apps/extension/src/offscreen-host.ts` + `.spec.ts`
- Create: `apps/extension/src/overlay-publisher.ts` + `.spec.ts`
- Modify: `apps/extension/entrypoints/background.ts`
- Modify: `knip.json` nếu khối `apps/extension` cần biết file `src/` mới

## Implementation Steps

1. `OverlayPublisher` trước — ít phụ thuộc `chrome.*` nhất, rủi ro thấp nhất.
   Spec: ceiling 40 dòng cắt đúng đầu nào, hợp nhất errors, publish idempotent.
2. `OffscreenHost` — nhỏ, ranh giới rõ. Spec: `ensureOffscreen` không tạo trùng
   khi đã có; xử lý được đường đua tạo-đồng-thời.
3. `PatchedTabRegistry` — lớn nhất, làm cuối. Spec: probe hết hạn, `restore`
   khôi phục từ storage, huỷ đăng ký khi outbound tắt.
4. Rút `background.ts` xuống còn wiring.
5. Chạy cổng nghiệm thu + `pnpm --filter extension test`.
6. Kiểm tra thủ công: load unpacked, mở một cuộc họp, bật/tắt capture, và
   **reload service worker giữa lúc capture** để kiểm chứng đường khôi phục state.

## Success Criteria

- [x] Ba collaborator mới, mỗi cái có spec — `OverlayPublisher` (15 test),
      `MicrophonePatchRegistry` (11), `OffscreenHost` (10)
- [x] Không collaborator nào gọi `chrome.*` — mọi thứ inject qua deps
- [x] `pnpm --filter extension test` pass: 88 test (từ 52); 5 spec cũ **không sửa**
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm knip` xanh
- [ ] **CHƯA LÀM — kiểm tra thủ công**, gồm reload service worker giữa lúc capture
- [ ] **CHƯA CHẠY — `wxt build`.** Hook chặn lệnh chứa chữ `build`. `tsc --noEmit`
      có chạy và xanh, nhưng bước bundle của WXT thì chưa.

**Đích "background.ts ≤ 250 dòng" đã bỏ — sai lần thứ ba, cùng một nguyên nhân.**
Kết quả: 646 → 539 tổng (365 → 299 dòng code). Nó không giảm nhiều vì phần
**wiring `chrome.*` phải ở lại entrypoint** — đó chính là quy ước
`vitest.config.ts` ghi rõ, và là điều khiến collaborator test được. Cái chuyển đi
là **luật**, không phải số dòng.

Thước đo đúng cho phase này không phải kích thước file mà là: `entrypoints/` từng
có 0 test cho các luật này, giờ chúng có **36 test**.

**Ba đích kích thước file liên tiếp (Phase 2, 3, 5) đều trượt vì cùng một lý do.**
Kết luận rút ra: khi việc cần làm là _tách trách nhiệm sang chỗ test được_, đích
phải là **số test và ranh giới phụ thuộc**, không phải số dòng của file gốc.
Đích dòng chỉ đúng khi việc cần làm là _cắt method_.

**Một sửa lỗi ngoài kế hoạch:** `publish()` bản cũ tính `patched` tại thời điểm
publish. Bản đầu tôi viết `setPatched()` lưu sẵn — sẽ tạo bug cũ kỹ khi tab được
patch giữa hai lần push. Đã đổi sang dep `patchedFor(tabId)` hỏi lại mỗi lần
publish, đúng ngữ nghĩa gốc, và có test ghim.

## Risk Assessment

Vùng rủi ro cao nhất toàn kế hoạch: 646 dòng, không spec nền, và vòng đời MV3
làm regression xuất hiện **chỉ khi service worker bị evict** — có thể là nhiều
phút sau, không phải lúc load.

**Giả định có thể sai:** ba ranh giới trên thật sự gắn kết và không đan xen state.
**Tín hiệu:** một collaborator cần đọc-ghi state của collaborator khác trong cùng
một thao tác.
**Phản ứng đã định trước:** đừng thêm tham chiếu chéo. Để `background.ts` điều
phối giữa chúng — đó chính là việc của một entrypoint. Nếu vẫn không tách được,
**dừng và báo cáo**: ranh giới sai còn tệ hơn file to.

**Giả định thứ hai:** đường khôi phục sau evict được kiểm bằng test.
**Tín hiệu:** không spec nào dựng lại được chuỗi restore-from-storage.
**Phản ứng:** viết spec đó trước khi rút `background.ts` — đây là hành vi dễ hỏng
âm thầm nhất và tốn nhiều thời gian nhất để phát hiện thủ công.

**Cân nhắc cắt phase:** nếu sát hạn nộp, đây là phase nên cắt **đầu tiên**. Nó
là công sức lớn nhất, rủi ro cao nhất, và không sửa vị trí sai nào mà hội đồng
sẽ nhìn thấy. Nhóm A + Phase 7 mang lại nhiều giá trị hơn trên mỗi giờ bỏ ra.
