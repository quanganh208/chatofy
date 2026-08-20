---
phase: 6
title: 'React and Tailwind into the popup'
status: pending
priority: P1
effort: '1d'
dependencies: [4]
---

# Phase 6: React and Tailwind into the popup

## Overview

Dựng toolchain, **không** viết lại gì. Tách khỏi Phase 7 có chủ đích: dựng toolchain và
viết lại 419 dòng là hai loại rủi ro, trộn vào thì lúc hỏng không biết hỏng ở đâu.

## Requirements

- Functional: `@wxt-dev/module-react` + `@tailwindcss/vite` chạy; một `<Button>` từ
  package render trong popup, ăn đúng token cả hai theme.
- Non-functional: `.output/chrome-mv3` không chứa dạng đánh giá động nào — MV3 CSP.
- Non-functional: content script **không** nhận Tailwind, và điều đó được canh bằng một
  guard thật sự đo được.

## Architecture

**Guard `var(--color-` của plan v1 đã bị bác bằng thực nghiệm.** Compile Tailwind v4 với
đúng hình dạng `@theme inline` của repo cho ra `.bg-background { background-color:
var(--background) }` — **0** occurrence của `var(--color-`. `inline` khiến utility dùng
_giá trị_ của biến theme thay vì tham chiếu nó. Guard đó xanh trên build sạch và trên
build nhiễm hoàn toàn. Bỏ.

**Thay bằng kiểm cấu trúc trên manifest build ra.** Đường nhiễm thật không phải chuỗi
custom property trong chunk JS: WXT phát CSS content-script thành **asset riêng** đăng ký
trong mảng `css` của manifest, và Chrome tiêm nó vào **document của trang họp**. Thiệt
hại là Preflight rơi xuống meet.google.com, và một stylesheet ổn định xuất hiện trong
`document.styleSheets` — dấu vân tay nhận diện người dùng Chatofy, đúng thứ invariant
chống-phát-hiện ở `overlay-invariants.spec.ts:152-159` tồn tại để chặn, và cùng lý do
manifest cố ý không khai `web_accessible_resources`.

Nên guard là: `manifest.content_scripts[*].css` **rỗng**, và không file nào tồn tại dưới
`.output/chrome-mv3/content-scripts/*.css`. Một kiểm cấu trúc bắt mọi đường tiêm, kể cả
đường chưa ai nghĩ ra.

**Xác minh cơ chế trước khi viết guard.** Chưa xác nhận được WXT version này phát CSS
content-script thành `css[]` hay nội tuyến vào JS. Chạy một `wxt build` thật, đọc
manifest, rồi mới viết.

**Preflight sẽ đụng popup vanilla.** `@import 'tailwindcss'` mang Preflight, reset
`button`, `fieldset`, `legend`, `select`, `h1`, `p`, `input` — mọi element popup hiện
đang style. CSS cũ được `main.ts` tiêm runtime nên thắng ở những property nó khai lại,
nhưng mọi thứ Preflight xoá mà `styles.ts` dựa vào kế thừa từ UA sheet đều đổi âm thầm.
Nên **"UI cũ chưa đụng nên phải nguyên vẹn" là suy luận sai** — phase này đổi cascade dù
không đổi markup. Hoặc cô lập Tailwind vào mount point tạm, hoặc chấp nhận reset và
re-baseline ảnh chụp **trong phase này**.

**CSP: grep là proxy yếu.** Mở rộng mẫu ra `Function(` không `new`, indirect eval,
`setTimeout('string')`, `WebAssembly.instantiate`. Và rẻ hơn nhiều: e2e đã lái Chromium
thật với extension nạp sẵn — thêm một listener fail khi có console error CSP. Đó là bằng
chứng trực tiếp, không phải khớp chuỗi. Chỉ grep `.output/chrome-mv3`, không grep
`*-dev` (chứa HMR client có eval).

## Related Code Files

- Modify: `apps/extension/package.json`, `wxt.config.ts` (modules, hook `vite()`)
- Create: `apps/extension/entrypoints/popup/style.css` (import `theme.css` của Phase 3)
- Modify: `apps/extension/entrypoints/popup/index.html` (mount point tạm)
- Create: guard artifact (task riêng từ Phase 1, **không** phải vitest spec trong `src/`)
- Modify: `apps/extension/e2e/run.mjs` (listener CSP console error)
- Do NOT touch: `entrypoints/content/**`, `entrypoints/popup/main.ts`

## Implementation Steps

1. Cài module + plugin; `wxt build`; **đọc manifest** để xác minh cơ chế CSS content-script.
2. Viết guard theo cơ chế thật, chạy trong task phụ thuộc `build` của chính package.
   Mutation-prove: import CSS vào content script làm nó đỏ.
3. CSS entry cho popup; mount một `<Button>` cạnh UI cũ.
4. Chụp cả hai theme, xác nhận Button ăn token.
5. Đo tác động Preflight lên popup cũ; re-baseline ảnh chụp và **ghi lại chênh lệch**.
6. Listener CSP vào e2e; grep `.output/chrome-mv3` với mẫu mở rộng.
7. Đo bundle popup, ghi con số thật đối chiếu ước tính 65–70KB gzip.

## Success Criteria

- [ ] Cơ chế CSS content-script **đã xác minh bằng manifest thật**, không phải suy đoán
- [ ] Guard: `content_scripts[].css` rỗng và không file `.css` nào dưới `content-scripts/`
      — mutation-verified, và **fail khi `.output` vắng mặt**
- [ ] e2e không thấy console error CSP nào; grep `.output/chrome-mv3` sạch với mẫu mở rộng
- [ ] Button từ package render đúng token ở cả light và dark
- [ ] Tác động Preflight lên popup cũ **đã đo và ghi lại**; ảnh chụp re-baseline
- [ ] `overlay-invariants.spec.ts` không sửa dòng nào và xanh
- [ ] e2e xanh (số check cập nhật có chủ ý); bundle popup đã đo

## Risk Assessment

**Cháy cũ tái diễn:** Vite qua WXT không resolve nổi package. Nếu Phase 4 đã lật sang
ship source thì đây là chỗ nó bị thử thật.
_Tín hiệu:_ build extension đỏ ở bước resolve. _Phản ứng:_ quay entry react về build,
chấp nhận máy móc directive — cái giá đã biết.

**Preflight làm hỏng nhiều hơn dự tính.** _Tín hiệu:_ bước 5 cho chênh lệch lớn trên
nhiều state. _Phản ứng:_ cô lập Tailwind vào mount point tạm cho tới Phase 7, thay vì
sống chung với popup lai trong một phase.

**Guard viết trước khi biết cơ chế.** _Tín hiệu:_ bước 1 cho kết quả khác giả định.
_Phản ứng:_ đó là lý do bước 1 đứng trước bước 2. Viết guard theo cái đo được.
