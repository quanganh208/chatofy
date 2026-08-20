---
phase: 1
title: 'Glossary, state list, visual direction'
status: completed
priority: P1
effort: '3-4h'
dependencies: []
---

# Phase 1: Glossary, state list, visual direction

## Overview

Ba thứ, cùng một lần gặp người dùng: (1) bảng từ vựng dùng chung cho web + extension,
(2) state list per surface, (3) **một bản mock hướng thị giác thô** cho hai bề mặt mang lời
phàn nàn. Không sửa code sản phẩm trong phase này.

Bảng từ vựng là thứ chặn web và extension trôi xa nhau lần nữa. Mock là thứ trả lời trực
tiếp chữ "xấu".

### Vì sao có mock ở đây, và vì sao đúng chỗ này

Toàn bộ vẻ đẹp của kết quả nằm trong Phase 4 step 6 ("tái phân bổ trọng lượng `/translate`")
và Phase 5 step 7 ("giảm trọng lượng label") — đúng hai step **mỏng nhất** của plan, vì
criteria chốt được tính nhất quán mà không chốt được tỉ lệ. Hệ quả cấu trúc: nếu không có
mock, **lần đầu người dùng thấy bất cứ thứ gì là Phase 6**, sau ~4 ngày làm việc. Và đường
thoát của plan ("nếu người dùng bác hướng đi → về brainstorm") lại nổ **sau** toàn bộ chi phí đó.

Phase 1 vốn đã kết thúc bằng một gate có người dùng. Gộp mock vào chính điểm gặp đó biến
"bác hướng đi ở Phase 6" từ mất 4 ngày thành mất 1 giờ. Đây là **can thiệp duy nhất trong cả
plan tác động vào "xấu"** thay vì vào drift.

Mock không cần đẹp hay chạy được: một file HTML tĩnh, hoặc thậm chí wireframe có annotation,
trả lời đúng ba câu cho `/translate` và popup — **cái gì chiếm ưu thế, cái gì lùi lại, bản
dịch nằm đâu**. Dùng token đã có; không phát minh màu mới.

## Requirements

- Functional: một bảng `string hiện tại → string thay thế`, mỗi dòng có `file:line`.
- Functional: state list cho popup / overlay / web, mỗi entry hoặc trỏ tới nơi render
  hoặc ghi "không áp dụng, vì …". Ô trống là lỗi.
- Non-functional: bảng phải phủ cả hai bề mặt trong **một** tài liệu — hai glossary
  riêng là cách chúng trôi xa nhau.
- Non-functional: giữ nguyên nghĩa của mọi câu an toàn (consent, disclosure ghi âm,
  hướng dẫn reload nhiều bước của overlay). Đổi register được, đổi nghĩa thì không.

## Architecture

Tài liệu sống ở `docs/design-guidelines.md` như hai section mới ("Copy register",
"State inventory"), vì đó là nơi đã giữ lý do cho từng giá trị design. Không tạo file
mới: guidelines hiện có 203 dòng và `docs.maxLoc` là 800.

Quyết định đã chốt ảnh hưởng tới glossary:

- `Live` là thí nghiệm → **không** cần cặp tên user-facing cho mode. Toggle bị xoá.
  Điều này làm glossary ngắn hơn đáng kể so với dự kiến ban đầu.
- `baseline` vẫn user-facing → **cần** một tên theo trải nghiệm (không phải
  "Turn-based baseline").

## Related Code Files

- Modify: `docs/design-guidelines.md` (thêm 2 section; không sửa section cũ)

Chỉ đọc, để lấy `file:line`:

- `apps/web/src/components/translate/mode-toggle.tsx:23,32,38`
- `apps/web/app/translate/page.tsx:75`
- `apps/web/src/components/translate/cascade-panel.tsx:143,145`
- `apps/web/src/components/translate/live-panel.tsx:87,142-151,181-182`
- `apps/extension/entrypoints/popup/index.html:82,83,137`
- `apps/extension/entrypoints/popup/main.ts` (`refreshModeNote` — đã đúng register, giữ làm mẫu)
- `apps/extension/entrypoints/content/overlay.ts:65-79` (select chỉ có `title` là tên nội bộ)

## Implementation Steps

1. Grep ra toàn bộ string ứng viên:
   `grep -rniE "cascade|baseline|barge-in|\becho\b|heard during playback|report timings|end-to-end" apps/web/app apps/web/src/components apps/extension/entrypoints`
2. Với mỗi hit: quyết định **xoá / đổi tên / giữ kèm lý do**. Ghi `file:line` + bản
   thay thế. Hit nào "giữ" phải có lý do viết ra — đây là exception list đóng mà
   criterion 16 kiểm tra.
3. Đặt tên mới cho route baseline theo trải nghiệm (nó vẫn user-facing).
4. Thay `live-panel.tsx:142-151`: bỏ language code trần, dùng tên ngôn ngữ.
5. Viết state list:
   - **Popup:** consent-unseen; meeting tab idle; meeting tab capturing; non-meeting
     tab; Zoom-desktop tab; mic-notice; Start bị disable vì `Runs on` off;
     `main.scrolls` on/off.
   - **Overlay:** pill idle; pill live; panel idle rỗng; panel capturing rỗng; panel
     có turn (gồm `.mine` và `.live`); error bar (capture/inbound/outbound); outbound
     `sending`/`muted`/`patched: false`.
   - **Web:** `/`; `/translate` idle; connecting; running có turn; live-panel có
     source+target; error notice; language-mismatch notice; baseline idle/loading/result.
6. Với mỗi state, ghi nơi render (`file:line`) hoặc "không áp dụng, vì …".
7. **Ghi baseline `pnpm knip`** vào phase notes. Nó **fail sẵn** hôm nay (exit 1) với:
   `SITE_ENABLEMENT_KEY` (`site-enablement.ts:32` — file Phase 5 cấm chạm),
   `spacing`/`radii`/`typography` (`apps/mobile/src/ui/theme.ts:67-69` — ngoài scope),
   `ComposedGraph` (`microphone-patch.ts:48`), `SegmentedOption`
   (`segmented-control.tsx:30`). Mọi criterion knip ở các phase sau so với baseline này,
   **không** đòi zero.
8. Trích câu của `refreshModeNote` (`popup/main.ts`) vào glossary làm mẫu register — Phase 5
   sẽ xoá hàm đó, nên không trích bây giờ là mất mẫu.
9. **Dựng mock hướng thị giác** cho `/translate` và popup. Một file HTML tĩnh trong
   `{plan-dir}/`, dùng token hiện có, annotation chỉ rõ: bản dịch nằm đâu và to bao nhiêu so
   với phần còn lại; control lùi lại thế nào; popup cái gì là hành động chính. **Không** phát
   minh màu, **không** đòi chạy được. Mục đích duy nhất: để người dùng nói "đúng hướng" hay
   "sai hướng" trước khi tiêu 4 ngày.
10. Trình **cả ba** cho người dùng cùng lúc: glossary, state list, mock.

## Success Criteria

- [x] Mọi hit của grep ở step 1 xuất hiện trong bảng với quyết định + `file:line`
- [x] Không ô trống nào trong state list (đếm được)
- [x] Mọi region/state khai báo đều truy được về dòng đã cite
- [x] Câu an toàn giữ nguyên nghĩa — diff review xác nhận
- [x] Route baseline có tên mới theo trải nghiệm
- [x] Baseline `pnpm knip` đã ghi vào phase notes (nó fail sẵn — mọi criterion knip so với baseline này)
- [x] Câu của `refreshModeNote` đã trích vào glossary trước khi Phase 5 xoá hàm
- [x] Mock hướng thị giác tồn tại cho `/translate` **và** popup, dùng token hiện có, có annotation nói rõ cái gì chiếm ưu thế / cái gì lùi lại / bản dịch nằm đâu
- [x] **Gate: người dùng chấp nhận glossary + hướng thị giác.** Chặn mọi phase sau. Nếu người dùng bác **hướng đi** ở đây thì về `/ak:brainstorm` — mất 1 giờ, không phải 4 ngày

## Phase notes (recorded during execution, 2026-08-20)

### knip baseline — `pnpm knip` exits 1 TODAY, before any change

Every later knip criterion compares against this. Do **not** require zero.

```
Unused exports (4)
  SITE_ENABLEMENT_KEY   apps/extension/src/site-enablement.ts:32:14   <- Phase 5 forbids touching this file
  spacing               apps/mobile/src/ui/theme.ts:67:14            <- out of scope
  radii                 apps/mobile/src/ui/theme.ts:68:14            <- out of scope
  typography            apps/mobile/src/ui/theme.ts:69:14            <- out of scope
Unused exported types (2)
  ComposedGraph         apps/extension/src/microphone-patch.ts:48:18
  SegmentedOption       apps/web/src/components/ui/segmented-control.tsx:30:18
Configuration hints (2)
  @types/chrome  apps/extension  knip.json   Remove from ignoreDependencies
  tailwindcss    apps/web        knip.json   Remove from ignoreDependencies
[ELIFECYCLE] Command failed with exit code 1.
```

`CardFooter` is **not** listed — confirming the `@public` tag at `card.tsx:39-40` is what
keeps it alive, and that Phase 3 must handle it deliberately rather than assume knip will.

### `refreshModeNote` register model — extracted before Phase 5 deletes it

`popup/main.ts:110-120`. Kept in `docs/design-guidelines.md` § Copy register:

- cascade: `"Waits for a sentence to finish before answering."`
- live: `"Answers about three seconds behind and talks over pauses — wear headphones."`

Its own comment carries the principle: the cascade line used to describe its pipeline
("recognise, translate, speak"), "which is a fact about the implementation, not about the
wait." That sentence is the rule the whole register table is derived from.

### Deliverables written

- `docs/design-guidelines.md` — two new sections (§ Copy register, § State inventory);
  203 → 314 lines, under `docs.maxLoc` 800. Existing sections untouched.
- `plans/260819-1801-.../visual-direction.html` — annotated mock, tokens only, dark-only
  (deliberate: overlay cannot follow `prefers-color-scheme`).

### Scope note

The candidate-string grep returned 38 hits, but only **11** are rendered strings. The rest
are code comments and identifiers (`CascadePanel`, `EchoMonitor`, doc comments). This is why
the plan's criterion is scoped to user-facing text and **not** to a bare
`grep "Cascade" → 0` — Phase 4 keeps `CascadePanel` by design.

## Risk Assessment

- **Risk:** đổi register làm loãng một câu an toàn (vd hướng dẫn reload của overlay
  giải thích rằng reload làm mất grant `activeTab` mà `tabCapture` cần — nói ngắn hơn
  sẽ dắt người dùng vào bẫy).
  **Signal:** reviewer không diễn đạt lại được hệ quả sau khi đọc bản mới.
  **Response:** giữ nguyên bản cũ; ghi vào exception list kèm lý do.
- **Risk:** glossary phình thành thiết kế lại nội dung.
  **Signal:** bảng bắt đầu có string chưa tồn tại trong code.
  **Response:** cắt về đúng các hit của grep. Nội dung mới thuộc Phase 4/5.
- **Assumption:** "rối" phần lớn là từ vựng + thứ bậc, không phải style. Nếu Phase 6
  bác bỏ _hướng_ chứ không phải chi tiết → quay lại brainstorm, không sweep tiếp.
