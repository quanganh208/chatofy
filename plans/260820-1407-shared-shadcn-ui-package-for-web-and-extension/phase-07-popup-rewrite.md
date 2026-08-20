---
phase: 7
title: 'Popup rewrite'
status: pending
priority: P1
effort: '2-2.5d'
dependencies: [2, 6]
---

# Phase 7: Popup rewrite

## Overview

419 dòng DOM mệnh lệnh thành React trên bộ component dùng chung. Mảng lớn nhất và rủi ro
hồi quy cao nhất. Phụ thuộc Phase 2 chứ không chỉ Phase 6: lưới an toàn phải có thật rồi
mới được nhảy.

## Requirements

- Functional: mọi hành vi giữ nguyên — consent một lần, gate captureable hai tầng, notice
  microphone theo `outbound`, ba site toggle sinh từ `SUPPORTED_MEETINGS`, scroll fade đo
  được, Start/Stop lạc quan.
- Functional: `<select id="direction">` → `DirectionToggle`; `<select id="voice">` →
  Radix Select. Nút swap phải bắn message `settings` tới worker như `<select>` đang bắn.
- Functional: giữ `#consent-ok`, `#toggle`, và **`<main>`** — cả ba đều là hợp đồng của e2e.
- Non-functional: `chatofy.theme` vẫn ngoài `CaptureSettings`; `apiBaseUrl` vẫn không ghi
  lại được.

## Architecture

**Consent ở lại HTML tĩnh.** Hôm nay nó là markup trong `index.html:32-49` và hiện ra kể
cả khi script throw. Đưa nó vào cây React là đặt lời khai báo ghi âm — thứ pháp lý duy
nhất trên bề mặt này — vào vùng có thể hỏng. Và `#toggle` nằm trong `<footer>` **anh em**
với `#consent`, không phải con của nó: một error boundary thêm sau này rất dễ có hình
dạng render được footer trong khi nhánh consent hỏng, tức là Start bấm được mà lời khai
báo chưa từng hiện. React chỉ mount phần settings + capture.

**Thay guard theo loại hỏng, không theo file.** Hai spec chết ở phase này:

`popup-style.spec.ts` canh "chuỗi template lắp tay hỏng lặng lẽ" — Tailwind làm loại lỗi
đó biến mất. Đừng dựng lại parser CSS. Invariant "mọi token màu có cả hai nửa" đã chuyển
sang `token-parity.spec.ts` ở Phase 3.

`popup-structure.spec.ts` đọc `main.ts` ở module load (`:27`) — plan v1 sót nó, và xoá
`main.ts` sẽ làm nó ENOENT. Nó canh "mọi id script tra cứu đều được khai". JSX không có
`el('id')` nên loại hỏng đó phần lớn biến mất; nhưng quyết định đó phải được ghi **ở
đây**, không phải bởi người đang nhìn màn hình đỏ.

**Guard mới, rẻ nhất trong plan:** không file nào dưới `entrypoints/popup/` chứa
`innerHTML` hay `dangerouslySetInnerHTML`. Quy tắc no-innerHTML hiện chỉ được khẳng định
cho `overlay.ts` (`overlay-invariants.spec.ts:139-140`); popup theo nó bằng quy ước
(`main.ts:41-43`), không gì cưỡng chế. React biến escape hatch thành một từ, và popup có
render chuỗi từ tab (`main.ts:285`) và từ worker (`main.ts:209`). Ba dòng, soi gương
invariant đã có.

**Popup MV3 chết khi mất focus** — state sống ở worker + `chrome.storage`. Bản React phải
giữ tính chất đó, không "cải tiến" thành state client bền.

## Related Code Files

- Create: `apps/extension/entrypoints/popup/main.tsx` + component con
- Create: `apps/extension/src/popup-render.spec.tsx` (happy-dom smoke render)
- Create: guard no-innerHTML
- Modify: `apps/extension/entrypoints/popup/index.html` (giữ consent tĩnh, `<main>`, hai id)
- Delete: `main.ts`, `styles.ts`, `popup-style.spec.ts`, `popup-structure.spec.ts`
  — **chỉ sau khi** e2e xanh trên bản mới
- Do NOT touch: `src/settings.ts`, `src/theme.ts`, `src/site-enablement.ts`,
  `src/supported-meeting-url.ts`, `entrypoints/content/**`

## Implementation Steps

1. Ghi quyết định về `popup-structure.spec.ts`: loại hỏng nào còn, loại nào biến mất.
2. Dựng cây component trên bộ dùng chung. Giữ ba hợp đồng DOM. Consent ở lại tĩnh.
3. Smoke render happy-dom cho vòng lặp nhanh.
4. Guard no-innerHTML, mutation-verified.
5. e2e xanh trên bản mới, gồm check mới: state `consentSeen: false` phải có nội dung
   consent **và** `#toggle` vắng mặt hoặc disabled.
6. Chỉ khi đó mới xoá file vanilla.

## Success Criteria

- [ ] e2e xanh trên bản viết lại; sideways check vẫn non-vacuous (Phase 2)
- [ ] `#consent-ok`, `#toggle`, `<main>` còn nguyên
- [ ] Check mới: consent hiện **và** Start không bấm được khi chưa xác nhận — mutation-verified
- [ ] Guard no-innerHTML xanh, mutation-verified
- [ ] `DirectionToggle` bắn `settings` tới worker; đổi hướng giữa lúc capture chạy vẫn có tác dụng
- [ ] `<select id="voice">` là Radix Select — Select có consumer thật
- [ ] File vanilla đã xoá; quyết định về `popup-structure.spec.ts` đã ghi
- [ ] `turbo lint typecheck test build` xanh, và **gate đó nhìn thấy `.tsx`** (Phase 1)

## Risk Assessment

**Hồi quy hành vi im lặng.** 419 dòng mang nhiều quyết định nhỏ đã ghi comment (vì sao
Stop luôn bật, vì sao settings không tắt theo tab, vì sao mic hỏi lại mỗi lần mở).
_Tín hiệu:_ e2e đỏ, hoặc tệ hơn — xanh mà hành vi vẫn sai.
_Phản ứng:_ đọc comment trước khi xoá dòng nào. Mỗi comment là một bug đã trả giá.

**Xoá bản vanilla quá sớm.** _Tín hiệu:_ không có — đó là vấn đề.
_Phản ứng:_ thứ tự 5→6 là bắt buộc.

**Stub của harness làm React throw.** `run.mjs:1279-1280` cho `sendMessage` trả
`undefined` với mọi type trừ `query`; component đọc field trên đó sẽ throw, và
`:1266-1271` báo nó dưới tên "the popup state stubs installed".
_Tín hiệu:_ check tên sai đỏ. _Phản ứng:_ Phase 2 đã đổi tên; ở đây chỉ cần component
chịu được `undefined`.
