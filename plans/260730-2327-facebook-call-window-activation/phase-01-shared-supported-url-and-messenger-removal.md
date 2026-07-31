---
phase: 1
title: 'Shared supported URL and Messenger removal'
status: in-progress
priority: P2
effort: '1h'
dependencies: []
---

# Phase 1: Shared supported URL and Messenger removal

## Overview

Tách logic "tab này có capture được không" ra một module dùng chung cho popup và
service worker, rồi gỡ Messenger web khỏi mọi bề mặt. Phase 2 cần module này vì
worker sắp phải tự quyết định trên tab nào thì bật.

## Requirements

- Functional: `supportOf(url)` cho cùng một câu trả lời ở popup và worker; sau
  phase này extension không còn xin quyền hay quảng cáo hỗ trợ `messenger.com`.
- Non-functional: không đổi hành vi người dùng thấy trên Meet / Zoom web /
  Facebook call; không thêm dependency.

## Architecture

Hiện `supportOf()` sống trong `entrypoints/popup/main.ts:39-71` và danh sách site
được lặp lại ở ba nơi — `wxt.config.ts` (host_permissions), `content/index.ts`
(matches), popup (regex). Comment ngay trong popup đã cảnh báo hệ quả: một tab
popup chấp nhận mà matches không khớp là capture chạy còn overlay không bao giờ
hiện.

Manifest và matches là dữ liệu tĩnh của WXT, không import được từ TS runtime một
cách an toàn, nên gom **hai chỗ runtime** (popup + worker) vào một module và để
lại comment nhắc cặp tĩnh phải đi cùng. Không dựng abstraction sinh manifest —
YAGNI.

## Related Code Files

- Create: `apps/extension/src/supported-meeting-url.ts`
- Modify: `apps/extension/entrypoints/popup/main.ts` (bỏ `supportOf` cục bộ, import; sửa câu unsupported)
- Modify: `apps/extension/entrypoints/content/index.ts` (bỏ match `messenger.com`)
- Modify: `apps/extension/wxt.config.ts` (bỏ host permission `messenger.com` + comment tương ứng)
- Modify: `README.md:64`, `docs/project-overview-pdr.md:20`
- Modify: `plans/reports/measure-260730-continuous-capture-runbook.md:180` (bỏ Messenger khỏi danh sách site phải xác nhận)

## Implementation Steps

1. Tạo `src/supported-meeting-url.ts`: export `interface MeetingSupport { ok: boolean; message?: string }`
   và `supportOf(url: string | undefined): MeetingSupport`. Copy nguyên logic hiện có,
   bỏ nhánh `messenger.com`, giữ nguyên nhánh Zoom-desktop (thông báo riêng) và
   nhánh `groupcall`. Comment nêu rõ: danh sách này phải khớp `host_permissions`
   trong `wxt.config.ts` và `matches` của content script.
2. Popup import `supportOf` từ module mới, xoá bản cục bộ. Câu unsupported đổi
   thành "Chatofy works on Google Meet, Zoom web, and Facebook calls."
3. Content script: bỏ `'https://www.messenger.com/*'` khỏi `matches`.
4. `wxt.config.ts`: bỏ `'https://www.messenger.com/*'` khỏi `host_permissions`;
   sửa comment cạnh `facebook.com/groupcall` cho khỏi nhắc Messenger web như một
   site còn được hỗ trợ.
5. README + `docs/project-overview-pdr.md` + runbook: bỏ "Messenger web" khỏi
   danh sách site.
6. Build và knip.

## Todo

- [x] `src/supported-meeting-url.ts` với `supportOf` + comment ràng buộc manifest
- [x] Popup dùng module chung, câu unsupported đã cập nhật
- [x] Messenger biến mất khỏi matches và host_permissions
- [x] README, PDR, runbook đã cập nhật
- [x] Build + knip xanh

## Success Criteria

- [x] `rg -i messenger apps/extension README.md docs/` chỉ còn hai comment giải
      thích "cuộc gọi Messenger chạy ở đâu / messenger.com đã đóng"; không còn
      pattern, regex hay câu UI nào
- [x] `.output/chrome-mv3/manifest.json` sau build không chứa `messenger.com`
- [ ] Popup trên tab Meet / Zoom web / Facebook groupcall vẫn hiện controls; trên
      Zoom desktop vẫn ra đúng câu giải thích cũ — **chờ kiểm tra tay**
- [x] `pnpm knip` exit 0 (module mới có hai consumer nên không bị báo unused)

## Risk Assessment

- **Regex lệch khi copy** → giữ nguyên chuỗi regex cũ, chỉ xoá một nhánh; đọc lại
  diff trước khi build.
- **Bỏ sót một chỗ nhắc Messenger** → chốt bằng lệnh `rg -i messenger` ở success
  criteria thay vì rà bằng mắt.
