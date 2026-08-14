---
phase: 3
title: 'Chính sách commit prefix ổn định'
status: done
priority: P1
effort: '2d'
dependencies: [2]
---

# Phase 3: Chính sách commit prefix ổn định

## Overview

Viết phần quyết định **được phép nói ra cái gì** — thuần, không I/O, test được
độc lập. Không đụng gì tới session, socket, hay provider.

Tách ra thành phase riêng vì đây là chỗ một lỗi là **không sửa được sau khi
xảy ra**: audio đã phát không rút lại. Repo đã có tiền lệ đúng cho việc này —
`SpeechGate` được tách khỏi hook React chính vì "đây là toàn bộ policy, nó thuần,
và đây là nơi một lỗi vô hình" (`capture-pump.ts:5-13`).

## Requirements

- Functional: từ chuỗi transcript partial nối tiếp nhau, quyết định phần nào đã
  ổn định và phần nào đủ điều kiện thành một vế để đem đi dịch.
- Non-functional: thuần, đồng bộ, không phụ thuộc Nest. Test phải **chứng minh
  được là có thể fail**: bỏ luật agreement đi thì test phải đỏ.

## Architecture

Hai module, tách theo đúng ranh giới đã lộ ra từ phép đo ở phase 1.

**`transcript-normalizer.ts`** — đưa transcript về chuỗi token so sánh được.
Tồn tại vì phép đo cho thấy Moonshine viết lại `seven` → `7`: **cùng một từ, hai
mặt chữ**. So thô sẽ báo lật giả mãi mãi trên đường tiếng Anh. Chuẩn hoá: số →
chữ, hạ hoa thường, bỏ dấu câu. Hàm chuẩn hoá **chỉ dùng để so sánh**; văn bản
đem đi dịch luôn là bản gốc, vì mặt chữ mang thông tin cho MT.

**`stable-prefix-commit.ts`** — luật commit:

1. **Agreement — chỉ cho chiều tiếng Anh.** Prefix chung dài nhất của
   `AGREEMENT_DEPTH` bản đọc liên tiếp gần nhất là ổn định. Ngưỡng lấy từ phase 1
   và hằng số phải mang theo lý do như thông lệ repo.

   **Chiều tiếng Việt sau phase 2 không đi qua luật này.** Recognizer streaming
   không decode lại phần đã xử lý, nên prefix đơn điệu là **thuộc tính kiến
   trúc** — chờ agreement chỉ thêm độ trễ mà không mua được gì. Module vẫn phải
   **đếm và log** mâu thuẫn ở chiều vi: nếu con số đó khác 0 thì giả định kiến
   trúc sai, và ta muốn biết ngay chứ không muốn nó im lặng.

2. **Ranh giới vế.** Chỉ commit tới ranh giới: **dấu câu nguồn** (chiều vi có
   được sau phase 2; chiều en luôn có), khoảng lặng gate báo, **hoặc** N≥8–12 từ
   khi người ta nói không nghỉ. Ba đường này bổ sung nhau — dấu câu là suy đoán
   của model, nên khoảng lặng và số từ là đường lùi bắt buộc, không phải tuỳ chọn.
3. **Chỉ tiến, không lùi.** Đã commit tới token thứ k thì mọi commit sau bắt đầu
   từ k. Prefix đã commit bị bản đọc sau mâu thuẫn → **đếm và log, không sửa
   lại**, vì âm thanh đã phát rồi. Bộ đếm này chính là chỉ số 4 của phase 1.
4. **Cửa sổ trượt.** `partial-transcript-scheduler.ts:26` chỉ đọc lại ~8s mới
   nhất, nên trên lượt dài **điểm bắt đầu cửa sổ dịch chuyển**. So sánh phải
   neo theo phần **sau offset đã commit**, không so cả chuỗi — nếu không, prefix
   sẽ tự đổi khi cửa sổ trượt và agreement sẽ nhiễu vô cớ trên đúng những lượt
   dài mà chức năng này sinh ra để phục vụ.

Điểm 4 là bẫy dễ bỏ sót nhất trong phase này và nó chỉ lộ ra trên lượt > 8s —
đúng loại lượt mà test ngắn không chạm tới. **Sau phase 2 nó chỉ còn là bẫy của
chiều tiếng Anh:** recognizer streaming giữ session và nạp audio theo chunk, nên
chiều vi không có cửa sổ trượt nào để canh lệch. Module vẫn phải xử đúng cả hai
đường, vì hai chiều dùng chung một chính sách commit.

## Related Code Files

- Create: `apps/api/src/modules/translate/audio/transcript-normalizer.ts`
- Create: `apps/api/src/modules/translate/audio/transcript-normalizer.spec.ts`
- Create: `apps/api/src/modules/translate/audio/stable-prefix-commit.ts`
- Create: `apps/api/src/modules/translate/audio/stable-prefix-commit.spec.ts`

## Implementation Steps

1. Viết `transcript-normalizer.ts`: chuẩn hoá cho vi và en. Test dựa trên chính
   chuỗi đã quan sát được ở phase 1 (`seven`/`7`, `at seven in the morning` →
   `at 7 in the Eve`), không phải ví dụ bịa.
2. Viết `stable-prefix-commit.ts` với 4 luật trên, ngưỡng nạp từ hằng số mang
   theo lý do và số đo của phase 1.
3. Test agreement: chuỗi partial thật từ phase 1 → commit ra đúng cái đã biết là
   an toàn, và **không** commit phần đã biết là nhiễu.
4. Test lượt dài > 8s cho cửa sổ trượt (điểm 4). Test này phải fail nếu bỏ neo
   theo offset.
5. Test chỉ-tiến-không-lùi: bơm một bản đọc mâu thuẫn, khẳng định bộ đếm tăng và
   commit **không** lùi.
6. Test ranh giới vế: nói không nghỉ → cắt theo số từ; có khoảng lặng → cắt theo
   khoảng lặng.

## Success Criteria

- [x] Bộ test chạy được trên chuỗi partial **thật** ghi lại từ phase 1
- [x] Bỏ luật agreement đi thì có test đỏ; bỏ neo offset cửa sổ trượt thì có test
      **khác** đỏ (hai lỗi khác nhau, hai test khác nhau)
- [x] Không có ca nào commit lùi
- [x] Ngưỡng agreement là hằng số có tên, mang theo số đo và lý do, theo đúng
      thông lệ `translation-model-policy.ts`
- [x] Không phụ thuộc Nest, không I/O, không mock

## Risk Assessment

- **Chuẩn hoá quá tay** có thể nuốt khác biệt thật (ví dụ số nhà vs số đếm). Chỉ
  chuẩn hoá cho _so sánh_, không bao giờ cho văn bản đem đi dịch. Đã ghi trong thiết kế.
- **Rủi ro dựa trên giả định:** ngưỡng phase 1 chốt trên bộ ghi âm nhỏ. **Tín
  hiệu:** phase 6 đếm được vế bị lật > 0. **Phản ứng đã định:** tăng ngưỡng ngôn
  ngữ đó lên một bậc và đo lại; không nới ranh giới vế để bù, vì đó là đổi độ ổn
  định lấy độ trễ theo chiều sai.
- **Rollback:** module mới, chưa ai gọi tới hết phase 4. Xoá là xong.
