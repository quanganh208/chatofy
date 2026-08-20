---
phase: 5
title: 'Extension surfaces'
status: pending
priority: P1
effort: '2-3d'
dependencies: [1]
---

# Phase 5: Extension surfaces

## Overview

Popup: một hành động chính + một nhóm setting phụ thuộc, thay vì 6 control cùng trọng
lượng trước nút. Overlay panel: transcript chiếm ưu thế, control row có thứ bậc.

Phase này chứa **ba cái bẫy ship-breaking** mà red-team tìm ra, mỗi cái có step riêng
đứng trước phần UI. Đọc mục Architecture trước khi bắt đầu.

`dependencies: [1]` — chỉ cần glossary. Phase này **không đọc gì** từ Phase 2/3
(`globals.css`, `token-parity`, web utility sweep). Bắt nó chờ Phase 3 đẩy item rủi ro
nhất của cả plan xuống gần cuối mà không đổi lấy điều gì.

## Requirements

- Functional: stored `mode: 'live'` phải được coerce về `cascade` — nếu không, người từng
  chọn Live bị ghim vĩnh viễn vào backend ẩn, không còn surface nào để đổi.
- Functional: production build nhúng server URL thật, **và** URL đó là phần của turbo
  cache key.
- Functional: mọi listener trỏ tới id bị xoá phải được xoá cùng lúc (`el()` **throw**).
- Functional: `main#settings > label` từ 4 xuống ≤1 ngoài group/`<details>`.
- Functional: `#mode`, `#api`, `#metrics` không có trong bản production.
- Functional: overlay — transcript là con trực tiếp duy nhất của `.panel` có `flex: 1`,
  kèm `min-height: 0`.
- Functional: hai `<select>` của overlay có label thấy được hoặc `aria-label`.
- Non-functional: `<footer>` vẫn là con trực tiếp của `<body>` sau `main`.
- Non-functional: **không chạm** `src/site-enablement.ts` hay spec của nó.
- Non-functional: `OVERLAY_STYLE` giữ **đúng một** rule `:host`, vẫn `all: initial !important`.

## Architecture

### Bẫy 1 — stored `mode: 'live'` không có đường về (BLOCKER)

`DEFAULT_TRANSLATE_MODE` **đã là** `'cascade'`
(`packages/types/src/domain/translate-mode.ts:30`), nên "khoá default về cascade" là
no-op. Đường đi thật:

- `loadSettings()` merge stored **trên** defaults (`apps/extension/src/settings.ts:32`)
- worker giữ lại stored mode mỗi lần ghi settings (`background.ts:564`
  `mode: forWorker.mode ?? current.mode`)
- `direction-session.ts:99` branch `if (deps.settings.mode === 'live')` → `LiveTranslateSocket`

Bỏ `#mode` mà không coerce → ai từng chọn Live (tức chính tác giả đồ án, người có lý do
để đã bấm vào nó) bị ghim vào backend ẩn: trễ ~3s, voice selector âm thầm vô nghĩa
(`popup/main.ts:119` là thứ duy nhất disable nó), và không surface nào nói backend nào
đang chạy. Cùng cơ chế, cùng file, cùng dòng `loadSettings` như bẫy `apiBaseUrl` — chỉ một
trong hai được nhận ra ở bản plan đầu.

**Cách xử lý (ĐÃ CHỐT):** coerce lúc đọc trong `loadSettings()`, không phải đổi default.
Coerce **mọi giá trị `!== 'cascade'`**, không chỉ `'live'` — cùng một dòng, phủ luôn giá trị
hỏng hoặc giá trị tương lai, và dev route đằng nào cũng set mode tường minh nên không mất gì
hợp lệ. Route dev cho Live **phải** set mode tường minh cho session của nó, không dựa vào
stored value.

### Bẫy 2 — server URL không cache-safe, và không định nghĩa khi thiếu env (BLOCKER)

`apps/extension/src/settings.ts:19` đặt `apiBaseUrl` mặc định `http://localhost:3000`, và
`#api` là **cách duy nhất** để đổi. Nhưng vá bằng build-time value thôi thì chưa đủ:

- `turbo.json` task `build` chỉ khai `dependsOn` + `outputs` — **không** `env`, **không**
  `passThroughEnv`, **không** `inputs`. Một `define`/`import.meta.env` value vì thế
  **không nằm trong cache key**, và WXT `.env` bị gitignore nên cũng không phải turbo
  input. Nghĩa là "xác minh bằng một production build thật" có thể được thoả bằng một
  cache entry restore, và một build sau có thể âm thầm dùng lại bundle build bằng
  localhost — đúng cái mà step đó tồn tại để chặn.
- CI chạy `pnpm turbo run build` **không có env nào** (`.github/workflows/ci.yml:115`), và
  `apps/extension` **không có** `.env.example` (khác `apps/web`, `apps/api`, `apps/mobile`).

**ĐÃ CHỐT (không còn là câu hỏi mở):** `wxt build` dùng localhost placeholder khi thiếu biến
(CI xanh), và **`wxt zip` fail** nếu thiếu. Ranh giới đặt ở **release**, không ở build — đây
là lựa chọn duy nhất mà CI vẫn xanh **và** không có gì ship được mang localhost:
`.output` từ `build` trần không phải artifact ai đem đi. Xác minh một lần rằng `wxt zip`
(`package.json:17` `"zip": "wxt zip"`) đúng là đường phát hành duy nhất trước khi gắn check.

**Scope biến vào `extension#build`, KHÔNG phải task `build` toàn cục.** `env` ở task `build`
chung đưa biến server-URL vào cache key của cả web/api/mobile: mọi build không liên quan bị
cache-bust khi biến đổi, và tệ hơn — một dev có export biến đó sẽ có cache key web khác CI.
Dùng cấu hình task theo package:

```jsonc
{ "tasks": { "extension#build": { "env": ["<SERVER_URL_VAR>"] } } }
```

### Bẫy 3 — xoá `<details>` làm trắng cả popup (BLOCKER)

`popup/main.ts:412` có
`el<HTMLDetailsElement>('advanced').addEventListener('toggle', refreshScrollFade)`, và
`el()` **throw** khi thiếu id (`main.ts:47-51`), ở top level của module. Xoá
`<details id="advanced">` mà không xoá listener → script chết trước `getElementById` đầu
tiên: không header, không settings, không Start, và không lỗi nào người dùng thấy được.

Không gate nào hiện tại bắt được: `e2e/run.mjs` navigate tới `popup.html` (`:192`, `:906`)
mà **không** assert gì về việc nó đã render. Module throw vẫn pass cả hai.

**Cách xử lý:** xoá listener cùng lúc, **và** thêm một smoke assertion vào `run.mjs` rằng
popup thật sự render (ví dụ `#toggle` tồn tại và có text). Đây là gate còn thiếu, không
chỉ là một lần sửa.

### `<details>Advanced` biến mất hoàn toàn

Advanced chỉ chứa label Server + `#api` + row `#metrics`. Bỏ cả hai → rỗng → xoá. Kéo theo
CSS chết: `popup/styles.ts:200-215` và `summary:focus-visible` trong `:246`. Cũng lưu ý
`main > label:first-child` (`styles.ts:142`) hôm nay **đã** không match gì — con đầu của
`main` là `#unsupported` (`index.html:67`).

### Overlay — sự thật về flex, và hai criterion sai ở bản đầu

- `.panel` là flex column, `max-height: 45vh`, `overflow: hidden`
  (`overlay-styles.ts:106-116`).
- `.lines` hôm nay **không có** flex (`:187`). Cho nó `flex: 1` mà **không** `min-height: 0`
  → automatic minimum size giữ nguyên chiều cao nội dung, column overflow, và
  `overflow: hidden` **cắt mất hàng dưới** — tức là cắt mất nút Stop, trên overlay nằm
  trên meeting đang chạy của người khác. Hit test của e2e không thấy được (probe point
  vẫn retarget về host).
- `.title { flex: 1 }` (`:125`) là thứ đẩy nút collapse sang phải trong header, và header
  là con của panel (`overlay.ts:241`). Criterion "transcript là phần tử **duy nhất** có
  `flex:1` trong panel" ở bản đầu vì thế **tự mâu thuẫn** — hiểu đúng chữ thì phải xoá
  `.title{flex:1}`. Criterion mới scope về **con trực tiếp** của `.panel`.
- `.check` và `.hint` là `flex: 1 0 100%` (`:256`, `:281`) — chúng **đã** chiếm hàng riêng.
  Hàng đầu hôm nay là **3** item (toggle, direction, voice), không phải 5. Criterion "không
  còn 5 item một hàng" ở bản đầu **đã đúng trước khi phase bắt đầu**, tức đo không gì cả. Bỏ.
- `overlay-styles.ts:282-287` ghi một contract về thứ tự/specificity (`[hidden]` đặt cuối,
  cùng specificity với `.indicator`/`.error`/`.outbound`). Phase này rewrite file đó nên
  phải giữ contract: một rule `display: … !important` mới cho element hideable, đặt **sau**
  `[hidden]`, sẽ thắng và làm element không ẩn được.

### Gate thật sự trống với chính file phase này sửa

`apps/extension/vitest.config.ts:16` include **chỉ** `src/**/*.spec.ts`, và `entrypoints/`
có **zero** spec file. Trong 6 source target của phase này, đúng **một**
(`src/settings.ts`) nằm trong vùng được test. Nghĩa là mọi criterion popup/overlay ở bản
đầu là hand-check — kể cả những item `plan.md` gọi là non-negotiable.

Grep xác nhận **không** assertion nào tồn tại cho: closed shadow root, một rule `:host`,
`OVERLAY_STYLE` không `var()`, không `innerHTML`, host không id, footer ngoài scroll,
consent thay cả popup, settings không gate theo tab.

**Cách xử lý:** thêm file-reading spec dưới `apps/extension/src/` — cùng khuôn
`token-parity.spec.ts` của web (đọc source như text rồi assert). Chúng nằm trong include
glob hiện có nên **chạy trong CI**, biến hand-check thành gate thật. Đây là hạng mục giá
trị cao nhất của phase.

#### Bẫy của chính cách xử lý này: spec đọc-file có thể pass rỗng

`token-parity.spec.ts` **không** vacuous được: nó iterate key của một **token object đã
import**, nên extraction rỗng là bất khả thi. Hai spec mới **không có** neo đó. Một regex bắt
`el('...')` sẽ khớp **zero** occurrence ngay khi ai đó refactor sang template literal, sang
wrapper, hay đổi tên `el` — và assertion "mọi id trích ra đều tồn tại" **pass xanh trên tập
rỗng**. Tương tự với regex đếm `:host` nếu style string bị tách hay nối.

Đây đúng là lớp lỗi đã bắt hai lần ở plan này (lệnh gate chạy rỗng; e2e không assert render),
giờ bị tái tạo bởi chính bản sửa của nó — ở đúng chỗ không ai soi lại, vì "nó là gate".

**Vá: mỗi spec assert một sàn cho số lượng trích được.**
`expect(elCallSites.length).toBeGreaterThan(20)`;
`expect(hostRules.length).toBe(1)` (0 phải fail khác 2). Một dòng mỗi spec.

Ngoài ra: hai isolation attack hardcode hình học overlay mà phase này rewrite —
`run.mjs:362-364` probe `elementFromPoint(innerWidth - 180, innerHeight - 40)`, suy ra từ
`.panel{width:340px}` + `.root{right:16px;bottom:16px}`. Điểm đó rơi vào `.controls`. Nếu
attack FAIL vì hình học, **không được nới probe** — đó là cách guard duy nhất của recording
indicator regress mà không ai nói dối. Cho probe suy ra từ geometry render thật.

## Related Code Files

- Create: `apps/extension/src/overlay-invariants.spec.ts` (file-reading: `:host` đúng một
  rule, không `var(`, không `innerHTML`, host không id)
- Create: `apps/extension/src/popup-structure.spec.ts` (file-reading: footer ngoài `main`,
  `label` count, không `#mode`/`#api`/`#metrics`, mọi `el('id')` có id tương ứng trong HTML)
- Create: `apps/extension/.env.example`
- Modify: `apps/extension/src/settings.ts` (coerce mode lúc đọc; apiBaseUrl từ build-time)
- Modify: `turbo.json` (`env`/`passThroughEnv` cho server URL → vào cache key)
- Modify: `apps/extension/wxt.config.ts` (build-time define; fail ở `zip` khi thiếu)
- Modify: `apps/extension/entrypoints/popup/index.html`
- Modify: `apps/extension/entrypoints/popup/styles.ts` (thứ bậc; xoá CSS chết `:200-215`, `:246`)
- Modify: `apps/extension/entrypoints/popup/main.ts` (bỏ wiring `#mode`/`refreshModeNote`/`#api`/`#metrics`/**`#advanced`**)
- Modify: `apps/extension/entrypoints/content/overlay.ts` (label select, thứ bậc control row)
- Modify: `apps/extension/entrypoints/content/overlay-styles.ts` (panel flex + `min-height: 0`)
- Modify: `apps/extension/e2e/run.mjs` (smoke assert popup render; probe theo geometry thật; state list)
- **Không sửa:** `apps/extension/src/site-enablement.ts` + spec của nó
- **Cẩn thận, không có trong danh sách nào ở bản đầu:** `apps/extension/entrypoints/content/index.ts:71-83`
  giữ nửa mount/unmount của cùng invariant. Đọc trước khi đổi overlay; sửa chỉ khi buộc phải.

## Implementation Steps

**Ba step đầu là ship-breaking. Không làm UI trước khi xong.**

1. **Coerce mode (Bẫy 1).** Trong `loadSettings()`, coerce stored `mode` về `cascade` lúc
   đọc. Viết spec trong `src/` chứng minh: stored `{mode:'live'}` → `loadSettings()` trả
   `cascade`. Nếu Phase 4 giữ dev-only route cho Live, route đó set mode tường minh.
2. **Server URL cache-safe (Bẫy 2).** Thêm `env` vào **`extension#build`** (task theo
   package, không phải `build` toàn cục — xem Architecture). Thêm
   `apps/extension/.env.example`. Cho `DEFAULT_SETTINGS.apiBaseUrl` đọc build-time value.
   Hành vi khi thiếu biến **đã chốt**: `build` placeholder, `zip` fail.
   **Xác minh (một build, không phải hai):** một build sạch + grep URL trong `.output`, cộng
   `turbo run build --filter=extension --dry=json` xác nhận biến có trong hash input. Cùng
   mức bảo đảm, khỏi phải diễn màn đầu độc cache — khi biến đã ở trong cache key thì kiểm
   build-từ-cache là đang kiểm thuật toán hash của turbo, không phải code của mình.
   Quyết định và ghi lại đường xử lý stored `apiBaseUrl` cũ trỏ localhost.
   **Nếu chạy nhiều agent:** land sửa đổi `turbo.json` thành **một commit sớm riêng**, để
   nhánh web rebase một lần chứ không giữa dòng.
3. **Smoke gate cho popup (Bẫy 3).** Thêm assertion vào `run.mjs` rằng `popup.html` render
   thật (`#toggle` tồn tại, có text). Thêm `popup-structure.spec.ts` assert **mọi**
   `el('<id>')` trong `main.ts` có `id` tương ứng trong `index.html` — đây là gate tổng cho
   cả lớp lỗi này, không chỉ cho `#advanced`.
4. Thêm `overlay-invariants.spec.ts`: `OVERLAY_STYLE` có đúng một `:host` và vẫn
   `all: initial !important`; không chứa `var(`; module overlay không chứa `innerHTML`;
   host không set id. Chạy: phải xanh **trước** khi sửa gì (đây là baseline bảo vệ, không
   phải gate phải-fail-trước như Phase 2).
5. Bỏ `#api` + `#metrics` khỏi markup và wiring; xoá `<details>` **và** listener
   `#advanced` (`main.ts:412`); dọn CSS chết `styles.ts:200-215`, `:246`, và
   `main > label:first-child` (`:142`, đã dead).
6. Bỏ `#mode` + `refreshModeNote`. `mode` **giữ** trong `CaptureSettings` (background vẫn
   gửi trong start message); việc khoá đã làm ở step 1 bằng coercion, không phải ở đây.
   Trước khi xoá `refreshModeNote`, **trích câu của nó vào glossary Phase 1** — Phase 1 cite
   nó làm mẫu register phải giữ, nên xoá mà không trích là mất chính cái mẫu đó.

   **`reportMetrics` — giữ cờ, chỉ bỏ UI.** Consumer thật:
   `messages.ts:40`, `direction-session.ts:172`,
   `packages/realtime-client/src/conversation/conversation-session.ts:130,344`, cộng hai spec
   (`live-direction-session.spec.ts:74`, `meeting-capture.spec.ts:22`) — **bốn file ngoài
   Related Code Files của phase này**. Nên **không** "dọn luôn": bỏ `#metrics` khỏi UI, giữ
   nguyên cờ và đường code. Phase 4 bảo vệ đường so sánh Live bằng lập luận "ẩn khỏi UI ≠
   xoá khả năng đo"; đường timing đáng **cùng** mức bảo vệ.

7. Tái cấu trúc IA popup: hành động chính có trọng lượng cao nhất; direction + voice thấy
   được; `Runs on` phụ thuộc nhưng **vẫn ngoài** `<details>` (giờ không còn `<details>`).
   Giảm trọng lượng label — hôm nay mọi label là 11px uppercase giống nhau, chính cái làm
   6 control trông bằng nhau.
8. Kiểm chiều cao ở state **đúng**: ngay **sau khi consent được bấm** (không phải lúc
   consent chưa xem — lúc đó `capture.hidden = true`, `main.ts:272-278`, Start không trên
   màn hình chút nào). Đó mới là state từng regress, và là lý do `refreshScrollFade()` được
   chạy lại ở đó (`main.ts:402-408`). Kiểm thêm tab không phải meeting (list platform dài nhất).
9. Overlay: label thấy được hoặc `aria-label` cho hai select (thay `title` mang chữ nội bộ
   `direction`/`voice`). Cho `.lines` `flex: 1` **kèm `min-height: 0`**; cho `.controls`
   `flex: none`. Tách Start/Stop khỏi settings theo thứ bậc. Giữ contract thứ tự
   `[hidden]` ở `:282-287`.
10. Kiểm `.panel` `max-height: 45vh` trên viewport thấp, và kiểm bằng mắt rằng hàng
    Start/Stop **không bị cắt** (hit test e2e không thấy được lỗi này).
11. Cho probe của hai isolation attack suy ra từ geometry render thật thay vì hằng số.
    **Không nới probe** để làm nó xanh.
12. **Dựng screenshot harness — KHÔNG "gần như miễn phí".** Đã kiểm: `e2e/run.mjs` 946 dòng
    có **zero** khả năng capture (`grep -ciE "screenshot|\.png|toFile"` → 0). `playwright`
    là devDep nên `page.screenshot()` dùng được, nhưng phải dựng từ đầu: thư mục artifact +
    quy ước tên, cộng setup **tất định** cho ~8 state popup (consent-unseen cần clear
    storage; non-meeting/Zoom-desktop cần đổi tab URL; mic-notice cần một permission state;
    `main.scrolls` on/off cần điều khiển chiều cao nội dung) và ~11 state overlay. Cái dùng
    lại được chỉ là `renderCapturing(capturing)` (`:307`) đẩy `OverlayState` tuỳ ý và hai
    lần `goto(popup.html)` (`:192`, `:906`).
    Reconcile `run.mjs:218` (`apiBaseUrl: 'http://localhost:3000'` ghi vào storage) với việc
    product không còn cho user set key đó.
13. Typeface popup (câu hỏi còn mở): Inter bundled ~+40KB vs `system-ui`. **Không**
    blocking. Overlay giữ `system-ui` dù thế nào.
14. Gate — **bốn lệnh riêng**, không gộp: `pnpm --filter extension test`,
    `pnpm --filter extension typecheck`, `pnpm --filter extension lint`,
    `pnpm --filter extension build`. Gộp thành
    `pnpm --filter extension test typecheck lint` làm vitest nhận `typecheck`/`lint` là name
    filter và **bỏ qua cả suite** (`No test files found, exiting with code 1`).
    Rồi `pnpm --filter extension test:e2e` gồm cả hai isolation attack.

## Success Criteria

- [ ] Spec chứng minh stored `{mode:'live'}` → `loadSettings()` trả `cascade`; coerce **mọi** giá trị `!== 'cascade'`
- [ ] Server URL khai trong **`extension#build`** (task theo package), **không** trong `build` toàn cục — tránh cache-bust web/api/mobile
- [ ] `apps/extension/.env.example` tồn tại
- [ ] `wxt zip` fail khi thiếu biến; `wxt build` dùng placeholder. Đã xác minh `wxt zip` là đường phát hành duy nhất
- [ ] Build sạch nhúng URL đúng (grep `.output`), **và** `turbo run build --filter=extension --dry=json` cho thấy biến trong hash input
- [ ] Hai spec mới có **sàn số lượng trích được** (`elCallSites.length > 20`; `hostRules.length === 1`) — nếu không, chúng pass rỗng khi regex hết khớp
- [ ] Đường xử lý stored `apiBaseUrl` cũ đã quyết định và ghi lại
- [ ] `popup-structure.spec.ts` assert mọi `el('<id>')` trong `main.ts` có id trong `index.html`
- [ ] `run.mjs` assert `popup.html` render thật (`#toggle` tồn tại + có text)
- [ ] `overlay-invariants.spec.ts` xanh: đúng một `:host` + `all: initial !important`, không `var(`, không `innerHTML`, host không id
- [ ] `#api`, `#metrics`, `#mode`, `<details>` không còn; listener `#advanced` đã xoá; CSS chết đã dọn
- [ ] `main#settings > label` ≤1 ngoài group (từ 4) — **và** trọng lượng thị giác thật sự
      khác nhau, không chỉ đếm được. Bọc ba label còn lại vào một `<div>` thoả phép đếm
      direct-child mà **không** đổi gì về trọng lượng, tức là đúng lời phàn nàn ban đầu. Bằng
      chứng phải là screenshot, không phải grep
- [ ] `index.html:122` `<label>Runs on</label>` — không `for`, không bọc control nào: khuyết
      tật a11y **có sẵn**. Chuyển thành `<legend>`/heading cho đúng, nhưng ghi rõ nó pass phép
      đếm vì lý do khác chứ không phải vì IA đã tốt hơn
- [ ] `<footer>` vẫn là con trực tiếp của `<body>` sau `main`
- [ ] Start trên fold **ngay sau khi bấm consent**, và trên tab không phải meeting
- [ ] Overlay: hai select có label thấy được hoặc `aria-label`
- [ ] `.lines` là **con trực tiếp duy nhất của `.panel`** có `flex: 1`, và có `min-height: 0`; `.controls` có `flex: none`
- [ ] Hàng Start/Stop không bị cắt trên viewport thấp (kiểm bằng mắt)
- [ ] Probe của isolation attack suy ra từ geometry thật, **không** bị nới
- [ ] `panel.append(...)` vẫn liệt kê indicator **trước** transcript
- [ ] `overlay.ts` không có handler dismiss/close bind vào `.indicator`
- [ ] Contract thứ tự `[hidden]` (`overlay-styles.ts:282-287`) còn nguyên
- [ ] `git diff --stat main...HEAD -- apps/extension/src/site-enablement.ts` → rỗng (**không** `git diff` trần — rỗng ngay khi commit)
- [ ] Screenshot harness đã dựng: artifact dir + naming + setup tất định cho ~8 state popup và ~11 state overlay.
      Đừng dùng `grep -ciE "screenshot|\.png|toFile" e2e/run.mjs` → 0 làm baseline sau khi đã sửa file:
      một comment nói "chưa có screenshot ở đây" cũng khớp. Kiểm bằng sự tồn tại của file ảnh
      sinh ra, không bằng grep trên source
- [ ] `pnpm --filter extension test` và `pnpm --filter extension test:e2e` — **lệnh riêng**, đều xanh, gồm cả hai isolation attack. (`pnpm test:e2e` ở root **không tồn tại**)
- [ ] Font body popup: hợp nhất với web, **hoặc** quyết định không hợp nhất được ghi tường minh. Hôm nay khác (`popup/styles.ts:40` vs `globals.css:22`) và ở bản plan đầu **không criterion nào gate nó**

## Risk Assessment

- **Risk (BLOCKER, đã xử lý ở step 1):** stored `mode: 'live'` ghim user vào backend ẩn.
  **Signal:** một profile từng chọn Live vẫn nghe trễ ~3s sau update.
  **Response:** coercion lúc đọc, có spec. Đổi default là no-op — default đã là `cascade`.
- **Risk (BLOCKER, đã xử lý ở step 2):** turbo cache phục vụ lại bundle localhost.
  **Signal:** build từ cache nhúng URL khác build sạch.
  **Response:** URL vào cache key. Xác minh hai chiều, không chỉ một build.
- **Risk (BLOCKER, đã xử lý ở step 3+5):** xoá id mà còn listener → popup trắng, im lặng.
  **Signal:** popup rỗng, không lỗi hiển thị.
  **Response:** spec đối chiếu `el('id')` ↔ HTML id, cộng smoke assert. Gate cho cả lớp lỗi.
- **Risk:** `flex: 1` thiếu `min-height: 0` cắt mất nút Stop trên overlay đang chạy.
  **Signal:** hàng dưới panel bị cắt trên viewport ngắn; e2e **không** thấy.
  **Response:** `min-height: 0` là bắt buộc trong criterion; kiểm bằng mắt ở step 10.
- **Risk:** isolation attack fail vì hình học đổi, và phản xạ là nới probe.
  **Signal:** diff của `run.mjs` làm probe rộng ra hoặc bỏ assert.
  **Response:** từ chối. Probe suy ra từ geometry render. Đây là guard duy nhất của
  recording indicator.
- **Risk:** thêm `:host { display: block }` khi rewrite panel layout → mất im lặng, vì
  `all: initial !important` outrank.
  **Signal:** không có, theo định nghĩa — đó là lý do có `overlay-invariants.spec.ts`.
  **Response:** spec assert đúng một `:host`.
- **Risk:** xoá `reportMetrics` phá đường đo. Consumer thật:
  `direction-session.ts:172` → `packages/realtime-client/src/conversation/conversation-session.ts:130,344`.
  Phase 4 bảo vệ đường so sánh Live bằng lập luận "ẩn khỏi UI ≠ xoá khả năng đo"; đường
  timing đáng **cùng** mức bảo vệ.
  **Signal:** không đo được timing sau phase này.
  **Response:** bỏ `#metrics` khỏi UI, **giữ** cờ và đường code. Không "dọn luôn".
- **Risk:** IA mới vỡ lại cap 600px. Không test nào bắt được.
  **Signal:** Start dưới fold sau khi bấm consent.
  **Response:** kiểm tay ở hai state tệ nhất trước khi đóng phase.
- **Risk:** chạm `site-enablement.ts` hoặc `entrypoints/content/index.ts` khi đổi layout.
  **Signal:** `git diff` cho thấy hai file đó bị chạm.
  **Response:** revert. Thứ bậc là việc của style + thứ tự append, không phải của logic hiển thị.

## Unresolved questions

Không còn. Ba câu đã chốt — xem Architecture (hành vi thiếu env; semantics coercion) và dưới đây.

**Backend cho review (chốt 2026-08-20):** chưa có backend deploy → Phase 6 review trên **dev
build**. Hệ quả phải xử lý **trong phase này, không để tới Phase 6**: dev build giữ `#api`
(hoặc localhost default), nên popup dev khác popup production về markup. Khi làm step 5/7,
**ghi lại chính xác chỗ khác biệt** (control nào chỉ có ở dev) để Phase 6 nói rõ với người
dùng họ đang ký cái gì. Giữ danh sách khác biệt ngắn — mỗi control chỉ-có-ở-dev là một điểm
IA được ký mà không ship.
