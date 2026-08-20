---
phase: 6
title: 'Review pass'
status: blocked
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

- Functional: **review chạy trên dev build** (chốt 2026-08-20: chưa có backend deploy).
  **Giả định "dev giữ `#api`" đã sai** — Phase 5 xoá `#api` vô điều kiện, URL đến từ
  `WXT_API_BASE_URL` lúc compile. Popup dev vì thế **giống hệt** popup production về
  markup; danh sách khác biệt dev↔production **rỗng**, khác biệt duy nhất là giá trị URL
  nhúng trong bundle mà không màn hình nào hiển thị. Vẫn trình câu đó cùng bộ screenshot —
  người dùng cần biết là không có control nào họ xem sẽ biến mất khi ship.
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
- [x] Whole-plan consistency sweep: một mâu thuẫn tìm thấy và đã sửa — Phase 6 khẳng định "dev giữ `#api`", sai từ khi Phase 5 xoá hẳn control đó. Hai criterion của plan chỉ xanh khi grep được scope đúng (`max-w-`, `animate-`); đã ghi tại chỗ. Còn lại 0
- [x] `docs/design-guidelines.md`: type scale theo tên vai trò đã đóng divergence ở Phase 2; **0 ngoại lệ** off-scale trong web nên không có exception table để viết
- [x] `packages/ui/README.md`: mobile **có** screens (14 file, gồm conversation/history/settings) — lập luận "không có gì để share" viết lại theo lý do thật: React Native, không phải DOM
- [x] Danh sách khác biệt dev↔production (từ Phase 5) được trình cùng bộ screenshot — danh sách **rỗng**: `#api` bị xoá hẳn chứ không gate theo dev, nên không control nào người dùng xem sẽ biến mất khi ship
- [x] Joint `pnpm knip` chạy một lần: **không finding mới** so với baseline đã ghi ở Phase 1. Nó **fail sẵn hôm nay** (exit 1: `SITE_ENABLEMENT_KEY`, 3 export mobile, 2 type) và một finding nằm trong `site-enablement.ts` — file Phase 5 cấm chạm, nên "sạch" là bất khả thi
- [x] Orphan không xảy ra: popup vẫn dùng `DEFAULT_TRANSLATE_MODE` (`packages/types`), route `/translate/live` giữ `LiveSessionStatus` (`packages/realtime-client`). knip không flag package nào
- [x] `pnpm turbo run lint typecheck test build` 27/27; `pnpm --filter extension test:e2e` 37/0; `pnpm knip` đúng baseline (chạy tay, CI không chạy hai cái sau)
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

## Review notes

### The "no backend" premise was only half true

The plan recorded "chưa có backend" on 2026-08-20 and planned to force web states. There
is no _deployed_ backend, but `apps/api` is running locally on :3000 and the web dev
server on :3001. So the web states were driven against the real pipeline instead of
forced — better evidence than the plan asked for, and nothing in the set is faked.

### What was captured

30 stills. Extension: 20, from `pnpm --filter extension test:e2e`, deterministic and
regenerable. Web: 10, captured against the running dev server with Chrome's fake
capture device fed a synthetic waveform; the script is a one-off and lives outside the
repo, because the guidelines record that `apps/web` has no Playwright and none is
being added.

A flat tone never stops, so voice activity never closes a turn and the page sits on
`hearing you`. Speech-shaped audio — wobbled tone, syllable envelope, real pauses —
reaches a finished turn. The recogniser answers it with real Vietnamese words, so the
transcript states are genuine renders, not fixtures.

### What was NOT captured, and why

Not faked, not quietly dropped:

- `connecting`, `translating`, `playing` — transient states between two that were
  captured. Reaching them reliably needs the page paused mid-transition, which the
  fake device cannot time.
- `error notice`, `languageMismatch` — need a failing or mismatched upstream. The local
  API answered every request.
- `baseline mic error`, `baseline turn error` — same reason; the upload path succeeded.

Six of fourteen web inventory rows are therefore unshot. Each is a status string or a
notice built from components that ARE shown in the captured states, so the risk carried
into acceptance is the copy, not the layout.

### Two things worth your eye, found while capturing

- `web-09-baseline-result` renders the browser's own `<audio controls>` — light grey
  chrome on a dark page, the one unstyled element in either surface.
- The same shot shows two accent-filled buttons at once (`Re-record` and `Translate`),
  which is the rule the extension popup was rebuilt around: one filled action per
  surface.

Neither is fixed here. This phase does not change code unless the review asks for it.

### Still outstanding, and both need a person

- The overlay on a real meeting, including a bright video frame. The shadow root is
  closed, so this cannot be automated and the harness runs against a stand-in page.
- Acceptance, or a per-shot list of changes.

## Gate outcome: direction rejected, 2026-08-20

The user rejected the visual direction, not the details: ground, typeface, accent and
whitespace, all four at once. This phase's own rule applies — a direction rejection is
not answered with another sweep, it goes back to the design question.

Worth naming: the direction **was accepted at Phase 1**, through
`visual-direction.html`. That mock showed detached fragments, and detached fragments
did not predict how the thing would feel assembled. The gate ran and still let this
through, which is a finding about the gate rather than about the person who passed it.

Three concrete weaknesses, from the captures rather than from taste:

- **Type is not shared.** Web takes a self-hosted face through `next/font`; popup and
  overlay take `system-ui` (`popup/styles.ts:40`). The extension therefore reads as an
  OS dialog. Phase 5 recorded a decision not to unify — that reasoning covers the
  overlay, which cannot carry a bundled face, and does not cover the popup.
- **The ground is flat.** `bg #0C0C0E` → `surface #111113` → `surfaceRaised #17171A`
  are five or six units apart. On a real display they are one black plane, so nothing
  reads as sitting above anything.
- **One accent does every job.** Cyan `#00A2C7` fills every button, every selected
  segment and the brand dot.

Next: `visual-directions-v2.html` in this plan directory offers three directions —
Bản ghi, Bàn trộn, Tĩnh — each applied to the popup and the busiest web state, same
copy and same controls, so the visual language is the only variable. Choosing one is
the gate that unblocks this phase.

Whatever is chosen lands in `packages/ui/src/tokens.ts`, which is one palette shared by
web, extension and mobile, with the overlay interpolating literals rather than reading
`var()`. That is a phase of its own, not an edit.

### Decided while comparing, independent of which direction wins

**No typed arrows for a language direction.** A `→` in a string is a glyph whose
weight, baseline and width nothing in the type system controls, and it renders
differently in each of the three faces under consideration. The direction is now a
pair of named sides — Source and Translation — with a drawn swap between them, which
also states the two languages explicitly instead of encoding them in one line.

This carries into the product wherever the pattern exists today:

- `apps/web/src/components/translate/direction-toggle.tsx:13-14` — `'VI → EN'`, `'EN → VI'`
- `apps/extension/entrypoints/content/overlay.ts:203-204` — the same pair
- `apps/web/src/components/translate/cascade-panel.tsx:34` — `'Vietnamese → English'`

Left alone deliberately: `overlay.ts:354-355` and `:59` use `→` for a menu path
("right-click → Chatofy"). That is a different idiom — a route through a UI, not a
translation direction — and it is not what the arrow objection was about.

**The web panel stated the direction twice.** A heading naming it, and a segmented
control setting it, one above the other. The pair is the control, so the heading
stops being a separate claim about the same fact and the segmented row is gone. Voice
keeps its segmented control.
