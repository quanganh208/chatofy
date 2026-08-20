---
phase: 2
title: 'e2e into CI, and non-vacuous'
status: pending
priority: P1
effort: '1-1.5d'
dependencies: [1]
---

# Phase 2: e2e into CI, and non-vacuous

## Overview

Lưới an toàn duy nhất cho bản viết lại 419 dòng ở Phase 7 hiện **không chạy trong CI**,
và vài check của nó đo số 0 rồi báo xanh. Sửa lưới trước khi nhảy.

## Requirements

- Functional: `test:e2e` chạy trong CI trên mọi PR.
- Functional: 9 check "does not scroll sideways" **không vacuous** — chứng minh bằng mutation.
- Functional: check render tồn tại sẵn (`run.mjs:262`) được siết để đo thứ nó tự nhận là đo.
- Non-functional: không đổi bất kỳ file nào dưới `entrypoints/`. Phase này chỉ đụng harness và CI.

## Architecture

**e2e vào CI là việc thật, không phải một dòng yaml.** Playwright browser, headed
Chromium, cờ fake-media, thời gian chạy. `run.mjs` tự ghi rằng nó không nằm trong CI và
do đó "the isolation checks above guard nothing unless someone runs them". Phase này
biến câu đó thành sai.

**Ba check đang nói dối, cả ba đều do controller viết trong phiên này.**

`run.mjs:1304-1306` deref `document.querySelector('main')` không guard null. Dưới React
`<main>` mount sau khi storage resolve; trượt là throw trong `p.evaluate` và **abort cả
harness** chứ không fail một check. Sửa: `waitForSelector('main')`, và evaluate trả
`null` khi thiếu để check _đỏ_ thay vì suite _chết_.

Cùng ba dòng đó vacuous trên pane ẩn: `<main hidden>` cho `clientWidth` và `scrollWidth`
đều bằng 0, nên `over <= 0` pass. Đã vacuous hôm nay ở state `consent-unseen` — nhìn thấy
được trong chính output của nó. Sửa: khẳng định `clientWidth > 0` và một control đã biết
có mặt, rồi mutation-prove trên pane rỗng.

`waitForTimeout(400)` cố định phải thành `waitForFunction` trên một marker đã render.
Chờ theo đồng hồ là cách một suite xanh trên chín tấm ảnh chụp panel trống.

**Check render đã tồn tại.** Plan v1 bảo "thêm check render, chứng minh nó đỏ trước khi
viết lại". Không làm được: check có ở `run.mjs:262`, và `#toggle` mang chữ "Start" là
markup tĩnh nên throw ở top level vẫn để lại nút có text. Việc thật là: siết nó để chờ
marker thay vì 200ms, mở rộng ra cả chín state, và **bỏ nhãn tĩnh** khỏi `index.html`
để mutation đỏ được.

**Hai thứ nữa harness đang che.** `run.mjs:1266-1271` nối mọi `pageerror` vào một check
tên "the popup state stubs installed" — throw của React sẽ báo dưới tên sai. Và
`:1279-1280` stub `sendMessage` trả `undefined` cho mọi type trừ `query`, nên component
đọc field trên kết quả đó sẽ throw vào listener kia. Đổi tên check và ghi lại hợp đồng
stub.

`shots.length === 20` hard-code ở `:1350`: mọi state thêm vào đều làm nó đỏ. Số phải đi
cùng inventory, và phase nào đổi số thì phase đó cập nhật có chủ ý.

## Related Code Files

- Modify: `apps/extension/e2e/run.mjs` (null guard, waitForSelector, non-vacuous, tên check, shots count)
- Modify: `apps/extension/entrypoints/popup/index.html` (bỏ nhãn tĩnh của `#toggle`)
- Modify: `.github/workflows/ci.yml` (job e2e, cài Playwright browser)
- Modify: `turbo.json` nếu `test:e2e` cần ràng buộc `dependsOn: ["build"]` (không mũ)
- Do NOT touch: `entrypoints/content/**`, `entrypoints/popup/main.ts`, `styles.ts`

## Implementation Steps

1. Bỏ nhãn tĩnh của `#toggle`; xác nhận check `run.mjs:262` giờ **đỏ được** khi script không chạy.
2. `waitForSelector` + `waitForFunction` thay `waitForTimeout` ở cả hai chỗ.
3. Sideways: null-safe, `clientWidth > 0`, control đã biết có mặt. Mutation-prove trên pane rỗng.
4. Mở rộng check render ra cả 9 popupShot state.
5. Đổi tên check `pageerror`; ghi hợp đồng stub `sendMessage`.
6. `shots.length` lấy từ inventory thay vì hằng số.
7. Job e2e vào CI; xác nhận nó đỏ được bằng một mutation cố ý.

## Success Criteria

- [ ] e2e chạy trong CI trên PR, và **đã thấy nó đỏ** một lần bằng mutation cố ý
- [ ] Sideways check mutation-verified: pane rỗng làm nó **đỏ**, không phải pass
- [ ] `<main>` vắng mặt làm check **đỏ**, không abort suite
- [ ] Check render đỏ được khi script không chạy (sau khi bỏ nhãn tĩnh)
- [ ] Không còn `waitForTimeout` cố định trên đường đo
- [ ] `pageerror` báo dưới tên đúng nghĩa
- [ ] Suite xanh, số check ghi lại rõ ràng (không còn khẳng định "46" ở nhiều nơi)

## Risk Assessment

**e2e trong CI chậm hoặc flaky, rồi bị tắt.** Đó là kết cục thường gặp và nó tệ hơn
không có, vì để lại niềm tin sai.
_Tín hiệu:_ job đỏ vì timing hai lần liên tiếp mà không có thay đổi liên quan.
_Phản ứng:_ sửa nguyên nhân timing (chờ marker, không chờ đồng hồ). Nếu vẫn không ổn
định thì báo user và quyết cùng, **không** âm thầm `continue-on-error`.

**Bỏ nhãn tĩnh của `#toggle` làm popup nháy chữ rỗng.** _Tín hiệu:_ thấy trong ảnh chụp.
_Phản ứng:_ chấp nhận — script chạy trong vài ms, và đánh đổi là một check thật sự đo
được cái nó nói.
