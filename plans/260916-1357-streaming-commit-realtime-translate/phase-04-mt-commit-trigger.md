---
phase: 4
title: 'Dịch theo mốc chốt, dưới một governor hai tầng'
status: done
priority: P1
effort: '1.5d'
dependencies: [3]
revision: 3 (sửa sau counsel Phase 3, thi công 2026-09-16)
---

# Phase 4: Dịch theo mốc chốt

## Goal

Bản dịch chạy khi **lời nói tiến**, không khi **đồng hồ điểm**. Câu 2,5 giây nhận
được bản dịch. Chi tiêu bị chặn **trước khi** gửi request, bằng một governor hai
tầng theo đúng khuôn repo đã dùng cho concurrency.

## Vì sao bản này khác bản đầu

Red team tìm ra bốn Critical trong bản đầu, tất cả đều ở tầng ngân sách. Bản này
sửa bằng cách **bỏ bớt**, không phải thêm.

| Bản đầu                              | Vấn đề                                                                                    | Bản này                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Một bucket global, không phân vùng   | Một người nói liên tục khoá bản dịch của mọi người khác                                   | **Hai tầng: per-user và global**, đúng khuôn `turn-concurrency.ts` |
| Bucket không biết model              | `LIVE_TRANSLATION_MODELS[0]` **chính là** `FINAL_MODELS[0]`, nên "dự trữ" không dự trữ gì | **Khoá theo model**, và **bỏ hẳn** khái niệm dự trữ                |
| `spendFinal()` + dự trữ cho bản cuối | Biến đếm trong process không đặt chỗ được ở phía Google                                   | **Bỏ.** Nói thẳng là không có dự trữ                               |
| Trần ngày + `penalize()` tự chế      | Trùng lặp `key-rotation.ts`/`error-classification.ts`, sai múi giờ, mất khi restart       | **Bỏ cả hai.** Giữ lại phần thật sự mới: chặn **trước** khi gửi    |

### Điều phải nói thẳng: không có dự trữ nào cho bản dịch cuối lượt

`translation-model-policy.ts:75` — `LIVE_TRANSLATION_MODELS = ['gemini-3.5-flash-lite']`.
`:39-42` — `FINAL_MODELS` dẫn đầu bằng **đúng model đó**. Nên traffic giữa chừng
và nấc đầu của bản cuối **tranh cùng một bucket 15 RPM tại Google**, và không có
biến đếm nào trong process thay đổi được điều đó.

Bản đầu tuyên bố có dự trữ và trích `translation-model-policy.ts` làm căn cứ.
File đó nói về sự cô lập giữa **speculation** và **final** (3.1 so với 3.5), không
phải giữa **live** và **final**. Trích dẫn đó sai.

Hệ quả thiết kế: cách duy nhất chừa chỗ cho bản cuối là **đặt trần live thấp hơn
15 trên model đó**, và đó chính là việc `LIVE_TRANSLATION_RPM` làm. Không có cơ
chế nào khác, và plan không được vờ là có.

### RPD không còn được canh bằng code

500 request/ngày mỗi model là mối lo có thật. Nhưng một biến đếm trong bộ nhớ
mất khi restart, và khoá "ngày" theo giờ máy chứ không theo mốc reset của Google
— tức nó **báo an toàn khi không an toàn**, tệ hơn không có.

Đợt này: RPD được **đo và báo cáo** ở Phase 6 Task 6.4, không được cưỡng chế.
Người dùng quyết dựa trên số thật. Ghi thẳng điều này vào comment của
`LIVE_TRANSLATION_RPM` để người sau không tưởng có tường ngày.

## Files to Create / Modify

- Create: `apps/api/src/modules/translate/audio/translation-budget.ts`
- Create: `apps/api/src/modules/translate/audio/translation-budget.spec.ts`
- Modify: `apps/api/src/modules/translate/audio/live-translation-trigger.ts`
- Modify: `apps/api/src/modules/translate/audio/live-translation-trigger.spec.ts`
- Modify: `apps/api/src/modules/translate/session/turn-session.ts`
- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts`
- Modify: `apps/api/src/modules/translate/services/translation-session.service.spec.ts`
- Modify: `apps/api/src/modules/translate/session/live-preview.ts`
- Modify: `apps/api/src/modules/translate/services/turn-metrics.recorder.ts`
- Modify: `apps/api/src/modules/translate/providers/register-default-providers.ts`
- Modify: `apps/api/src/config/env.schema.ts`

**Không sửa** `turn-timeline.ts` — xem Task 4.4 bước 6, `spentCount` được giữ lại.

---

## Task 4.1 — Hai biến cấu hình, giá trị lấy từ Phase 1

- **Goal:** `N` và trần RPM là cấu hình, và giá trị đến từ số đo chứ không từ mong muốn.

- **Target files:** `apps/api/src/config/env.schema.ts`, cạnh các mục
  `z.coerce.number()` sẵn có (dòng 46, 74, 90 làm mẫu).

- **Steps:**
  1. Mở `reports/measurement.md`, mục `## Số bàn giao cho Phase 4`. Lấy
     `commit_rate_chars_per_s` trung vị và `liveTranslations`/phút nền.
  2. Tính trần khả dụng:

     ```
     trần_live = 15 × n_project − (thứ Phase 4 KHÔNG thay thế)
     ```

     **Không trừ `liveTranslations` nền.** Đó chính là làn live cũ, thứ Phase 4
     **thay thế** chứ không cộng thêm vào. Trừ nó đi là lập ngân sách như thể hai
     làn live chạy song song, và trần bị thu nhỏ vô cớ.

     Thứ phải trừ là những gì dùng **chung bucket `gemini-3.5-flash-lite`** mà
     phase này không đụng tới:
     - **bản dịch cuối lượt** — `FINAL_MODELS[0]` cũng là `gemini-3.5-flash-lite`
       (`translation-model-policy.ts:40`), một request mỗi lượt;
     - **bậc dự phòng của speculation**, chỉ khi ladder phải đi tiếp —
       `SPECULATION_MODELS` bắt đầu ở `gemini-3.1-flash-lite` (`:44`) nên phần
       lớn 40,7 speculation/phút **không** nằm trong bucket này.
       `15` là RPM mỗi project mỗi model. `n_project` lấy từ
       `## Số bàn giao cho Phase 4`. Xoay key **nhân được** trần vì key từ project
       khác nhau rút từ bucket riêng — xem comment đầu
       `gemini-translation-provider.ts:11-16` — và cặp (key, model) bị throttle
       được ghi nhớ rồi bỏ qua (`recordFailure` → `this.keys.cool`), nên chỉ tốn
       một lần 429 cho mỗi key khi nó bão hoà, không phải mỗi request.

  3. Tính mặc định:
     - `LIVE_TRANSLATION_RPM = floor(0.8 × trần_live)` — chừa 20% cho bản dịch
       cuối lượt, vốn dùng **chung** `gemini-3.5-flash-lite` (xem mục "không có
       dự trữ" ở đầu phase).
     - `LIVE_TRANSLATION_COMMIT_CHARS`: **người dùng đã chốt mức cụm từ, `N = 15`**
       (phiên validation 2026-09-16). Kiểm lại nó có vừa trần không:
       `req_phút_ước_tính = 60 × 0.6 × commit_rate_chars_per_s / 15`
       (0.6 là mật độ lời nói trong hội thoại hai người).
       - vừa `LIVE_TRANSLATION_RPM` → đặt `N = 15`;
       - **không** vừa → đặt `N` nhỏ nhất ≥ 15 mà vừa, rồi **báo người dùng** kèm
         cả hai con số. Không im lặng nâng lên 40; họ đã chọn 15 có ý thức.

       Ghi cả phép tính vào comment, kèm `n_project` đã dùng.
  4. **Kiểm RPD.** Tính
     `phút_hội_thoại_mỗi_ngày = 500 × n_project / req_phút_ước_tính`.
     Ở `N = 15` con số kỳ vọng là **~42 phút/ngày**, và người dùng **đã chấp nhận
     mức đó** khi chọn. Chỉ báo lại nếu số đo thật ra **dưới 30 phút** — lúc đó
     nó lệch đủ xa so với thứ họ đồng ý để cần quyết lại. **Không tự hạ `N`.**
  5. Thêm:
     ```ts
     /**
      * Số ký tự chốt thêm đủ để kích hoạt một bản dịch giữa chừng.
      * Giá trị mặc định suy từ commit rate đo được, không đặt tay.
      */
     LIVE_TRANSLATION_COMMIT_CHARS: z.coerce.number().int().min(12).default(15),
     /**
      * Trần request dịch GIỮA CHỪNG mỗi phút, cho mỗi người dùng.
      * Không có trần ngày: RPD được đo ở nghiệm thu, không cưỡng chế ở đây.
      */
     LIVE_TRANSLATION_RPM: z.coerce.number().int().positive().default(66),
     ```
  6. `min(12)` là **sàn cứng**. Dưới 12 ký tự sẽ sinh hơn một request mỗi vài âm
     tiết, và với 500 RPD/model thì cạn hạn mức ngày trong vài phút. Ghi vào
     comment: đường tới mức từng chữ là **nâng quota**, không phải hạ sàn này.

- **Success criteria:** hai biến có trong schema, mặc định khớp số của Phase 1, và
  comment ghi rõ không có trần ngày.

- **Verify:**
  ```
  pnpm --filter api typecheck
  ```
  Thoát mã 0.

---

## Task 4.2 — Viết `TranslationBudget` hai tầng

- **Goal:** chặn **trước khi gửi**, công bằng giữa người dùng, và không tái tạo
  máy móc đã có.

- **Target files:** tạo mới
  `apps/api/src/modules/translate/audio/translation-budget.ts`.

- **Steps:**
  1. API công khai:
     ```ts
     export class TranslationBudget {
       constructor(options: {
         perUserRpm: number;
         /**
          * Trần toàn tiến trình. Mặc định `trần_live`, và **không bao giờ vượt**
          * nó — xem ghi chú ngay dưới interface.
          */
         globalRpm?: number;
         now?: () => number;
       });
       /** Còn chỗ cho một request giữa chừng của người này không. KHÔNG tiêu. */
       canSpend(userId: string, model: string): boolean;
       /** Ghi nhận một lần tiêu. */
       spend(userId: string, model: string): void;
       /** Số lần đã tiêu trong 60 giây gần nhất, toàn tiến trình, để ghi số đo. */
       spentLastMinute(model: string): number;
     }
     ```

### Vì sao global KHÔNG phải `perUserRpm × 2`

Tỉ lệ 3:6 của `turn-concurrency.ts` **không chuyển được sang đây**, và lý do là
bản chất của hai cái trần. Trần đồng thời là **của chính ta**, đặt trên tài
nguyên máy ta; trần này là **của Google**, và vượt nó không bị ta chặn mà bị họ
trả 429.

Với `perUserRpm` cỡ 56, `× 2` ra 112 trên một bucket 90 — tức tầng global **không
bao giờ chặn được gì trước khi Google chặn**. Một trần không bao giờ ràng buộc
thì không phải trần, đúng câu `live-session-limits.ts:9-10` đã ghi.

Ràng buộc bắt buộc: `perUserRpm ≤ globalRpm ≤ trần_live`.

2. **Hai tầng, đúng khuôn đã có.** `turn-concurrency.ts:27,45` đặt
   `MAX_CONCURRENT_TURNS_PER_SOCKET = 3` **và**
   `MAX_CONCURRENT_TURNS_GLOBAL = 6`, kèm giải thích vì sao phải có cả hai chứ
   không phải cái này thay cái kia. `live-session-limits.ts:9-10` nói thẳng:
   _"a limit each path could exhaust independently is not a limit."_
   `canSpend` trả `true` chỉ khi **cả** tầng người dùng **và** tầng global còn
   chỗ.
3. **Khoá theo model.** Quota của Google là per-project-per-model
   (`apps/api/.env.example:121-122`), nên một bucket không biết model sẽ tính
   traffic trên hai model khác nhau vào cùng một trần.
4. Cài đặt: mỗi khoá giữ một mảng mốc thời gian; mỗi lần gọi loại mốc cũ hơn 60
   giây. Dọn khoá rỗng để map không phình theo số người dùng đã từng kết nối.
5. **Không có `penalize()`.** Provider đã có xoay key và cooldown per-key-model
   (`gemini-translation-provider.ts`), đã được đo, và đúng phạm vi hơn bất cứ
   thứ gì viết lại ở đây. Ghi lý do vào comment đầu file để người sau không
   thêm lại.
6. **Không có `spendFinal()` và không có trần ngày.** Xem hai mục ở đầu phase.
7. `now` tiêm vào để test không phải ngủ, giống `partial-transcript-scheduler.ts`.

- **Success criteria:** file tồn tại, typecheck sạch, không có `penalize`,
  `spendFinal`, hay bất kỳ biến đếm theo ngày nào.

- **Verify:**
  ```
  pnpm --filter api typecheck && \
  grep -cE 'penalize|spendFinal|spentToday|requestsPerDay' apps/api/src/modules/translate/audio/translation-budget.ts
  ```
  Lệnh đầu thoát mã 0; lệnh sau in ra `0`.

---

## Task 4.3 — Test cho `TranslationBudget`

- **Target files:** tạo mới
  `apps/api/src/modules/translate/audio/translation-budget.spec.ts`.

- **Steps:** viết các ca, dùng `now` giả:
  1. Tiêu đúng `perUserRpm` lần cho một người → `canSpend` của người đó thành `false`.
  2. **Người khác vẫn đi được** sau khi người thứ nhất cạn. Đây là ca quan trọng
     nhất của file — nó là lý do tầng per-user tồn tại.
  3. Đủ số người tiêu hết `globalRpm` → **mọi người** bị chặn, kể cả người chưa
     chạm trần riêng.
  4. Cửa sổ trượt, không reset theo phút: cạn trần, nhảy 30s vẫn `false`, nhảy
     thêm 31s thì `true`.
  5. **Hai model độc lập:** cạn trần trên `gemini-3.5-flash-lite` không ảnh hưởng
     `canSpend` cho `gemini-3.1-flash-lite`.
  6. Khoá của người dùng không còn hoạt động **không tích tụ** — tiêu cho 100
     userId, cho đồng hồ chạy quá 60s, rồi tiêu cho 3 userId mới; cấu trúc nội bộ
     chỉ còn giữ 3 khoá.

     **Ca này viết khác bản đầu, có chủ đích.** Bản đầu đòi map rỗng ngay sau khi
     cửa sổ trôi qua mà không có hoạt động nào nữa. Nhưng map **chỉ lớn lên khi
     `spend`**, nên một tiến trình đã ngừng tiêu là một tiến trình đã ngừng lớn —
     bất biến cần giữ là "người nói hôm qua đã biến mất trước khi người nói hôm
     nay tới", không phải "biến mất đúng khoảnh khắc phút của họ hết hạn". Cài
     đặt dọn khi `spend` vượt ngưỡng kích thước; gắn phép dọn vào một getter
     chỉ-đọc để qua được phép đọc theo nghĩa đen sẽ là chiều con số, không phải
     sửa lỗi.

- **Success criteria:** cả 6 ca xanh.

- **Verify:**
  ```
  pnpm --filter api test -- translation-budget
  ```
  Thoát mã 0, **0 failed**.

---

## Task 4.4 — Viết lại `LiveTranslationTrigger`

- **Goal:** kích hoạt theo lượng chữ **đã chốt**, và dùng **một chuỗi duy nhất**
  cho cả quyết định, sổ sách, lẫn payload.

- **Target files:**
  `apps/api/src/modules/translate/audio/live-translation-trigger.ts`.

### Lỗi bản đầu phải tránh

Bản đầu chỉ đổi **đối số** của `shouldTranslate` sang phần chốt, để nguyên
`markStarted(transcript)` nhận hypothesis đầy đủ. Hai đơn vị khác nhau: lần đầu
kích hoạt ở phần chốt 40 ký tự trong khi hypothesis đã ~70, nên `lastLength = 70`,
và mọi vòng sau tính `committed.length − 70` ra **số âm**. Luật đếm ký tự — thứ
duy nhất sống với tiếng Việt — **chết sau đúng một lần bắn**.

Quy tắc của bản này: **một chuỗi vào, dùng cho cả ba việc.**

- **Steps:**
  1. **Xoá** `MIN_SPEECH_SECONDS`, `MIN_INTERVAL_MS`, `WORDS_FOR_EARLY_REFRESH`,
     `MAX_PER_TURN`.
  2. Chữ ký mới, chỉ nhận phần đã chốt:
     ```ts
     shouldTranslate(committedText: string): boolean
     markStarted(committedText: string): void
     ```
     Bỏ tham số `seconds` — thời lượng nói không còn là điều kiện.
  3. Điều kiện, theo thứ tự:
     - `false` nếu `inFlight`;
     - `false` nếu `budget.canSpend(userId, model)` là `false`;
     - `true` nếu `committedText.length − lastCommittedLength >= commitChars`;
     - `true` nếu số mệnh đề đóng trong `committedText` **lớn hơn** số lần trước.
       Phải là **chuyển tiếp**, không phải trạng thái: một văn bản đã có dấu phẩy
       thì lần nào cũng "đang đóng mệnh đề", nên kiểm trạng thái sẽ chốt lại ở
       `true` vĩnh viễn cho chiều `en_to_vi`. Dùng bộ tách của
       `apps/api/src/modules/translate/audio/clause-splitter.ts`, **không** viết
       bộ tách mới.
     - **`true` nếu vừa có một lần neo lại** — `reanchors > lastReanchors` —
       vẫn chịu hai điều kiện `inFlight` và ngân sách ở trên.
       Phải là **chuyển tiếp**, không phải trạng thái, đúng như luật mệnh đề:
       so với trạng thái thì sau lần neo lại đầu tiên nó sẽ `true` mãi mãi.
       Nghĩa là chữ ký đổi thành `shouldTranslate(committed: string,
reanchors: number)`, và `markStarted` ghi `lastReanchors` cạnh
       `lastCommittedLength`;
     - ngược lại `false`.

     **Vì sao neo lại phải là một điều kiện kích hoạt riêng.** Neo lại có thể làm
     `committed` **ngắn đi** — đo được 2 trên 13 lần. Khi đó
     `committed.length − lastCommittedLength` ra **số âm** và luật đếm ký tự im
     lặng cho tới khi chữ mọc lại quá mốc cũ. Tệ hơn: bản dịch **đang hiển thị**
     được làm từ tiền tố **sai**, đúng thứ vừa bị thay. Để nguyên thì màn hình
     giữ một bản dịch sai lâu hơn cần thiết.

  4. `markStarted(committedText)` đặt `lastCommittedLength = committedText.length`
     và `lastClauseCount`, rồi gọi `budget.spend(...)`. **Cùng đơn vị với điều
     kiện ở bước 3.** Vì nó **gán** chứ không cộng dồn, nó tự xử đúng cả trường
     hợp `committedText` ngắn đi sau một lần neo lại.
  5. Constructor nhận `{ budget, commitChars, userId, model, now? }`.
  6. Ghi vào doc comment của class rằng **`inFlight` đã là một trần tự nhiên**:
     nó chặn lần kích hoạt kế cho tới khi Gemini trả lời (p50 723ms theo
     `development-journey.md`), nên một người dùng không thể vượt ~83 req/phút dù
     `N` nhỏ tới đâu; ở nhịp đọc 300ms và `N = 15` thì luật đếm ký tự mới là thứ
     ràng buộc, quanh ~56. Ghi ra để lần sau không ai thêm lại một
     `MIN_INTERVAL_MS`, tưởng là đang vá một lỗ không tồn tại.
  7. **Giữ nguyên `get spentCount()`.** `turn-timeline.ts:107` đọc nó để ghi
     `liveTranslations` vào metrics, và Phase 6 Task 6.4 dựa vào đúng hàng đó để
     đo chi tiêu. Bản đầu xoá nó và làm hỏng chính phép đo nghiệm thu của mình.
     Bộ đếm mỗi lượt và bucket toàn tiến trình trả lời hai câu hỏi khác nhau; giữ
     cả hai.
  8. Viết lại doc comment đầu file. Comment cũ giải thích vì sao câu ngắn không
     đáng dịch — lập luận đó **đã bị lật**, để nguyên sẽ thành sai.

### Vì sao luật đếm ký tự đứng TRƯỚC luật mệnh đề

**Nguồn tiếng Việt không có dấu câu.** `zipformer_vi.py:34-47` ghi model nhả
`"XIN CHÀO HÔM NAY TRỜI RẤT ĐẸP"` — viết hoa toàn bộ, không dấu câu, và
`postprocess` chỉ hạ chữ thường chứ không phục hồi dấu câu.

`clause-splitter.ts` tách theo `BOUNDARY = /[,;:.!?…]+(?=\s|$)/g`, nên trên văn
bản không dấu câu nó **không bao giờ khớp**. Với chiều `vi→en` — chiều chính —
luật mệnh đề là luật chết và **luật đếm ký tự là cơ chế thật sự duy nhất**.
Chiều `en→vi` thì Moonshine nhả văn bản có dấu câu nên luật mệnh đề chạy.

Viết điều này vào comment của hàm.

- **Success criteria:** typecheck sạch, `spentCount` vẫn tồn tại.

- **Verify:**
  ```
  pnpm --filter api typecheck && \
  grep -c 'spentCount' apps/api/src/modules/translate/audio/live-translation-trigger.ts
  ```
  Lệnh đầu thoát mã 0; lệnh sau in ≥ `1`.

---

## Task 4.5 — Cập nhật test của trigger

- **Target files:**
  `apps/api/src/modules/translate/audio/live-translation-trigger.spec.ts`.

- **Steps:**
  1. Xoá các ca khẳng định hành vi cũ đã bỏ (ngưỡng 3 giây, khoảng cách 2,5 giây,
     trần 3 lần mỗi lượt). Thay đổi có chủ đích.
  2. Thêm ca mới:
     - câu ngắn vẫn được dịch: `committedText` 20 ký tự đóng mệnh đề →
       `shouldTranslate` trả `true` (hôm nay trả `false`);
     - hết ngân sách thì từ chối, kể cả khi mệnh đề đã đóng;
     - chốt thêm dưới `commitChars` và chưa đóng mệnh đề mới thì từ chối;
     - **luật đếm ký tự bắn được nhiều lần.** Nạp phần chốt tăng dần
       40 → 80 → 120 ký tự với `commitChars = 40`, gọi `markStarted` sau mỗi lần
       → `shouldTranslate` trả `true` cả ba lần. **Đây là ca chặn lỗi đơn vị của
       bản đầu**; không có nó thì lỗi ấy tái diễn không ai thấy;
     - **luật mệnh đề là chuyển tiếp:** cùng một `committedText` có sẵn một dấu
       phẩy, gọi hai lần liên tiếp → lần thứ hai trả `false`;
     - `markStarted` tiêu đúng một đơn vị ngân sách.

- **Success criteria:** mọi ca xanh.

- **Verify:**
  ```
  pnpm --filter api test -- live-translation-trigger
  ```
  Thoát mã 0, **0 failed**.

---

## Task 4.6 — Nối ngân sách, và sửa CẢ NĂM nơi khởi tạo `TurnSession`

- **Goal:** một bucket cho cả tiến trình, và không file spec nào vỡ.

### `TurnSession` có năm nơi khởi tạo, không phải một

Bản đầu viết "dòng 139 là nơi duy nhất". Sai. Danh sách đầy đủ:

| File                                                                     | Dòng | Truyền mấy đối số |
| ------------------------------------------------------------------------ | ---- | ----------------- |
| `apps/api/src/modules/translate/services/translation-session.service.ts` | 139  | 2                 |
| `apps/api/src/modules/translate/session/turn-session.spec.ts`            | 14   | 1                 |
| `apps/api/src/modules/translate/session/outbound-audio-framer.spec.ts`   | 17   | 1                 |
| `apps/api/src/modules/translate/session/turn-timeline.spec.ts`           | 9    | 1                 |
| `apps/api/src/modules/translate/session/session-registry.spec.ts`        | 27   | 2                 |

- **Steps:**
  1. Trong `TranslationSessionService`, tạo **một** `TranslationBudget` ở cấp
     service, `perUserRpm` từ `this.config.get('LIVE_TRANSLATION_RPM')`.
  2. Thêm tham số constructor **thứ ba, TUỲ CHỌN** cho `TurnSession`:
     `deps?: { budget?: TranslationBudget; commitChars?: number; userId?: string }`.
     **Bắt buộc tuỳ chọn**, để bốn file spec biên dịch không cần sửa.
  3. Khi `deps.budget` vắng mặt, `TurnSession` tạo một `TranslationBudget` cục bộ
     với trần rộng. Test vẫn chạy được chính sách thật thay vì chạy vào nhánh
     không có ngân sách.
  4. `translation-session.service.ts:139` truyền đủ ba đối số, `userId` lấy từ
     danh tính đã xác thực của socket (`ws-auth.ts` gắn `claims.sub`).
  5. Trong `live-preview.ts`, sửa **cả ba chỗ** ở cùng một lời gọi. Số dòng dưới
     đây là vị trí **sau Phase 3**; bản trước ghi 117/119/122 và chúng đã dịch:
     - `:169` `shouldTranslate(...)` → truyền `session.committer.committed` và
       `session.committer.reanchors`, **bỏ** tham số `seconds`;
     - `:171` `markStarted(...)` → truyền **cùng chuỗi đó**;
     - `:174` `pipeline.translate({ text: ... })` → gửi **cùng chuỗi đó**.
       Bản đầu chuyển quyết định sang phần chốt nhưng vẫn gửi `transcript` thô,
       tức vẫn dịch phần đuôi đang nhấp nháy. Phase mang tên "dịch theo mốc chốt"
       thì thứ gửi đi phải là phần chốt.
     - lời gọi `translateLive(...)` ở `:82-88` bỏ đối số `audio.secondsAt(atBytes)`.
  6. **Phase 3 đã xử một cạm bẫy ở đây — đừng làm hỏng lại.** `committer.push()`
     nằm **trên** chốt chặn `streamCommitted` trong `settleTranscript`, nên phần
     chốt tiến cho **mọi** lượt. Nếu ai đó đẩy `push` xuống dưới chốt chặn ấy,
     phần chốt sẽ vĩnh viễn rỗng với extension và mobile, và trigger của phase
     này lặng lẽ **lấy mất bản dịch giữa lượt của họ**. Cờ quyết định thứ được
     _gửi_, không quyết định thứ được _tính_.
  7. `translation-session.service.spec.ts:785-808` (`bills the turn for the live
translations it spent`) **sẽ vỡ, và vỡ có chủ đích**. Nó đẩy **một** khung 5
     giây: một khung → một lần decode → committer chưa có hypothesis liền trước →
     `committed` rỗng → không kích hoạt. Chính sách mới cần **hai** lần đọc cùng
     chuỗi cách nhau ≥300ms (đồng hồ giả, `pushFrame` lần hai) để `committed`
     thành câu 24 ký tự, vượt `N`.
     Sửa test theo hướng đó, và **ghi lý do vào comment của test**: nó đổi vì đơn
     vị kích hoạt đổi từ giây-lời-nói sang ký-tự-đã-chốt, không phải vì nới lỏng.
     Xem thêm `:838-844`.

  8. Trong `.then` của `translateLive`, **bỏ kết quả đã lỗi thời**: nếu
     `session.committer.committed` không còn bắt đầu bằng chuỗi vừa được dịch thì
     đừng phát nó.
     Lý do: một bản dịch khởi hành từ tiền tố **sai** có thể về **sau** lần neo
     lại đã thay tiền tố đó, và khi ấy màn hình hiển thị bản dịch của một câu vừa
     bị rút lại. Đây là đường duy nhất còn sót để một tiền tố sai sống trên màn
     hình sau khi cơ chế neo lại đã làm đúng việc của nó. Một dòng.

- **Success criteria:** typecheck sạch, toàn bộ test API xanh.

- **Verify:**
  ```
  pnpm --filter api typecheck && pnpm --filter api test
  ```
  Cả hai thoát mã 0, **0 failed**.

---

## Task 4.7 — Cho cổng 429 của Phase 6 một thứ để đếm

- **Goal:** làm cho cổng nghiệm thu 429 **có thể trượt**.

### Vì sao task này tồn tại

Bản đầu nghiệm thu bằng `grep -c 'quotaCooldown' "$TURN_METRICS_PATH"` và chờ số
`0`. Chuỗi đó **không bao giờ được ghi vào file đó**: `onQuotaCooldown` chỉ đi
vào `quotaLogger.warn(...)` (`register-default-providers.ts:104-107`), và
`TurnMetrics` (`turn-metrics.recorder.ts:13-66`) có 14 trường, không trường nào
về quota. Cổng luôn in `0` và luôn pass. Đây là lỗi **thiếu file trong Phase 4**,
không phải lỗi của Phase 6.

- **Target files:**
  - `apps/api/src/modules/translate/services/turn-metrics.recorder.ts`
  - `apps/api/src/modules/translate/providers/register-default-providers.ts`

- **Steps:**
  1. Thêm `quotaCooldowns: number` vào interface `TurnMetrics`, cạnh
     `liveTranslations` (dòng ~60).
  2. Trong `register-default-providers.ts`, `onQuotaCooldown` hiện chỉ log. Thêm
     một bộ đếm cấp module tăng lên mỗi lần callback chạy, **giữ nguyên dòng
     log**. Bộ đếm đọc được từ recorder.
  3. Recorder ghi số cooldown tích luỹ trong lượt đó vào mỗi hàng.
  4. **Không** thêm `penalize()` hay bất kỳ phản ứng nào. Đây chỉ là **quan sát**.
     Phản ứng đã có sẵn ở provider.
  5. Ghi vào comment: trường này tồn tại để nghiệm thu đo được một thứ có thật,
     sau khi một phiên bản kế hoạch trước nghiệm thu bằng một trường không tồn tại.

- **Success criteria:** `TurnMetrics` có `quotaCooldowns`, test API xanh.

- **Verify:**
  ```
  grep -c 'quotaCooldowns' apps/api/src/modules/translate/services/turn-metrics.recorder.ts && \
  pnpm --filter api test
  ```
  Lệnh đầu in ≥ `1`; lệnh sau thoát mã 0.

---

## Task 4.8 — Kiểm toàn repo

- **Verify:**
  ```
  pnpm typecheck && pnpm lint
  ```
  Cả hai thoát mã 0.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.

## Số đã chốt khi thi công — 2026-09-16

| Số                                  | Giá trị | Từ đâu                               |
| ----------------------------------- | ------- | ------------------------------------ |
| Bucket `gemini-3.5-flash-lite`      | 90 RPM  | 15 × 6 project                       |
| Trừ bản dịch cuối lượt              | ~7 RPM  | ~5,7 lượt/phút đo được, làm tròn lên |
| `trần_live`                         | ~83     | 90 − 7                               |
| **`LIVE_TRANSLATION_RPM`**          | **66**  | `floor(0.8 × 83)`                    |
| **`LIVE_TRANSLATION_COMMIT_CHARS`** | **15**  | người dùng chốt ở phiên validation   |

Kiểm `N = 15` có vừa trần không, bằng **hai** đường độc lập vì chúng không khớp
nhau và tôi không giấu chỗ vênh:

| Đường                                  | req/phút | Phút/ngày trong 3000 RPD |
| -------------------------------------- | -------- | ------------------------ |
| VIVOS: `60 × 0,6 × 11,519 / 15`        | ~28      | ~109                     |
| Hội thoại prod: ~14 ký tự/giây đồng hồ | ~56      | ~54                      |

**Cả hai đều vừa trần 66 và đều trên ngưỡng cảnh báo 30 phút/ngày**, nên `N = 15`
giữ nguyên và không phải báo lại người dùng theo bước 4. Chỗ vênh là do hai bộ dữ
liệu đo hai thứ khác nhau — VIVOS là giọng đọc tiếng Việt, hội thoại prod là
tiếng Anh nguồn — và Phase 6 task 6.5 là nơi có số thật cho chiều vi.

### Ba chỗ thi công lệch kế hoạch, kèm lý do

1. **`userId` không lấy được từ socket.** Kế hoạch ghi _"`ws-auth.ts` gắn
   `claims.sub`"_, nhưng `StreamSocket` chỉ có `send` và không mang danh tính.
   Gateway **có** biết chủ socket (`socketsByUser`), nên đã thêm `userBySocket`
   (WeakMap) và truyền `userId` làm đối số thứ tư của `sessions.start`. Đối số
   tuỳ chọn; socket không có chủ xác minh được thì rơi về bucket riêng theo lượt,
   và tầng global vẫn chặn trần thật.
2. **`clauseCount` phải đếm mệnh đề ĐÃ ĐÓNG.** `splitIntoClauses` trả **một**
   đoạn cho văn bản không có dấu câu, nên đếm số đoạn sẽ làm luật mệnh đề bắn ở
   mọi văn bản và vô hiệu hoá ngưỡng ký tự. Đếm đoạn trừ đi phần đuôi chưa đóng.
3. **`TranslationBudget` ném lỗi khi trần không hợp lệ.** Một budget dựng với
   `undefined` từ chối mọi request **trong im lặng** — trông hệt như cạn quota.
   Guard này lập tức bắt được hai mock config trong test đang trả boolean cho mọi
   khoá.
