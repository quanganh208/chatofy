---
phase: 4
title: 'Hợp đồng và commit phía server'
status: done
priority: P1
effort: '4d'
dependencies: [3]
---

# Phase 4: Hợp đồng và commit phía server

## Overview

Nối chính sách của phase 3 vào lượt đang mở: commit vế → dịch nối tiếp → TTS →
đẩy audio về ngay, trong lúc người ta còn đang nói. Endpoint chỉ còn dịch phần
**chưa commit**.

Đây là phase đụng hợp đồng và là phase duy nhất có thể làm hỏng `apps/web`, nên
tương thích được xử lý ngay ở bước 1 chứ không để cuối.

## Requirements

- Functional: lượt bật `streaming` phát ra audio giữa chừng; lượt không bật chạy
  **y hệt hôm nay**.
- Non-functional: `apps/web` không đổi hành vi một byte nào; test hiện có xanh mà
  không sửa test nào.

## Architecture

**Opt-in theo lượt.** `sessionOptionsSchema` thêm
`streaming: z.boolean().default(false)`. Tab web cũ không gửi trường vẫn hợp lệ —
đúng lý do đã ghi ở `ws-events.ts:47-55` cho `turnId`: hai app không deploy cùng
lúc, nên trường server bắt buộc sẽ làm hỏng mọi message của tab đang mở.

> **Cạm bẫy, đã kiểm tận nơi.** Chỉ thêm trường vào schema là **cờ chết ngay ở
> gateway**. `translate.gateway.ts:160-168` phá cấu trúc rồi **dựng lại object
> từng trường một**:
> `this.sessions.start(client, { direction, voiceGender }, turnId)`.
> `streaming` sẽ parse đúng, default đúng, rồi bị vứt tại đó — `TurnSession`
> không bao giờ thấy nó, chức năng thành no-op, mà **mọi test viết dưới tầng
> gateway vẫn xanh**. Phải sửa gateway và phải có một test **ở tầng gateway**
> chứng minh `streaming: true` đi tới được service.

**Sự kiện mới `server.translation.commit`** — `{ sessionId, text, direction, seq }`,
ngữ nghĩa **nối thêm**. Phải là sự kiện riêng, không tái dùng
`server.translation.partial`: cái đó được ghi rõ trong hợp đồng là "thay nguyên
cụm, không bao giờ nối" (`ws-events.ts:190-193`), và client hiện tại xử lý nó
đúng như vậy. Nhồi hai ngữ nghĩa vào một sự kiện là cách chắc chắn để về sau có
người đọc sai một trong hai.

**`streaming-commit-driver.ts`** — điều phối, viết cạnh và theo đúng khuôn
`LivePreview`: chạy theo audio tới chứ không theo timer (client biến mất giữa
chừng thì nó tự dừng, không có vòng lặp nào phải dọn), nuốt lỗi im lặng, kiểm tra
`stillCurrent()` sau mỗi await.

Khác `LivePreview` ở đúng một điểm, và điểm đó là toàn bộ độ nguy hiểm của phase
này: `LivePreview` **được phép sai** vì nó chỉ ghi lên màn hình. Driver này phát
ra tiếng. Nên nó chỉ nhận đầu vào từ phase 3 và không có đường tắt nào bỏ qua luật.

**Một lần decode, hai người dùng.** Driver **lấy lại kết quả decode của
`LivePreview`**, không tự chạy vòng re-decode riêng. Hiện kết quả đó nằm trong
chuỗi promise private của `live-preview.ts:51-89` và không lộ ra đâu cả, nên phải
mở nó ra. Nếu driver tự decode: tải STT sidecar **gấp đôi** (en p50 149ms mỗi
lượt đọc) **trước khi** phase 6 kịp đo RTF — tức là tự phá phần headroom đồng
thời mà plan đang dựa vào, một cách âm thầm.

**Tín hiệu khoảng lặng lấy từ đâu.** Gate nằm ở client; server chỉ thấy frame đã
lọc, và `turn-session.ts:151` ghi rõ khoảng trống trong luồng là khoảng lặng đã
bị bỏ đi. Nên server **không tự biết** chỗ nào là khoảng lặng. Dùng lại
`client.turn.speculate`: nó bắn đúng ở mức ngập ngừng `PROBABLE_END_MS`
(`conversation-session.ts:331`), tức là sẵn có đúng tín hiệu cần — trên lượt
streaming nó thành **gợi ý ranh giới vế** thay vì lệnh đoán trước.

**Vậy "bỏ speculation" nghĩa là gì cho chính xác.** Client **vẫn gửi**
`client.turn.speculate` (phase 5 không sửa chỗ đó, và không nên sửa vì gợi ý ranh
giới cần nó). Cái bị bỏ là **việc tiêu request** cho nó. Tiêu chí phải viết theo
vế đó, chứ "lượt streaming không gửi speculation nào" là điều server không kiểm
chứng được.

**`translateLive` phải tắt trên lượt streaming.** Nó vẫn bắn tới 3 request/lượt
trên `LIVE_TRANSLATION_MODELS = ['gemini-3.5-flash-lite']` — **đúng model mà
`FINAL_MODELS` đứng đầu**. Để nguyên thì phần tính ngân sách ở `plan.md` sai:
15–20 req/phút của commit cộng thêm 3 request/lượt không đếm, chen nhau trên cùng
một model. Chưa kể trên màn hình, `server.translation.partial` (thay nguyên cụm)
sẽ đánh nhau với dòng commit (nối thêm). **Transcript partial thì giữ** — nó
local, không tốn quota, và là đầu vào của chính driver.

**Dịch nối tiếp, không viết lại.** `TranslationRequest.context?: string[]` **đã
tồn tại** trong interface (`translation-provider.ts`) và **chưa provider nào
dùng** — grep toàn `packages/ai-providers/src` không có chỗ đọc `req.context`.
Nên phase này chỉ cần hiện thực nó trong `gemini-translation-provider.ts`, không
phải đổi interface công khai. Prompt mang: nguồn đã commit + đích đã phát ra
tiếng, và yêu cầu **nói tiếp, không sửa lại phần đã nói**.

> **Câu prompt đã đo ở phase 1, dùng nguyên văn.** Xem
> `benchmarks/realtime/gemini-continuation-probe.mjs` — 6/6 lần nối tiếp không
> ngoái lại. Hai điều bắt buộc mang theo, cả hai đều là kết quả đo chứ không phải
> suy luận:
>
> 1. **Phải có dòng cấm thêm từ nối.** Thiếu nó, model tự bịa liên từ đối lập:
>    "it mostly went fine" ra "**nhưng** nhìn chung là ổn", khiến cả câu tự mâu
>    thuẫn — mà phép đo trùng lặp vẫn chấm là đạt vì không có chữ nào lặp.
> 2. **Vết nối dấu câu chưa xử lý.** Vế không phải vế cuối, nguồn kết thúc bằng
>    dấu phẩy, vẫn có thể trả về kết thúc bằng dấu chấm, rồi vế sau nối vào bằng
>    chữ thường. Qua TTS thì nặng hơn qua màn hình: engine lấy ngữ điệu từ dấu câu
>    (`audio/clause-splitter.ts`), nên dấu chấm bảo nó đóng câu lại rồi vế sau bật
>    lên giữa chừng. Phải chọn chỗ xử lý — trong prompt, hay chuẩn hoá dấu câu
>    cuối vế trước khi synthesize — chứ không để rơi.

**Ladder cho commit: chỉ hai model flash-lite. `gemma-4-31b-it` phải bị cấm.**
Đo cả ba model trên cùng bộ ca (phase 1):

| model                   | ca đạt | nối tiếp sạch | median  |
| ----------------------- | ------ | ------------- | ------- |
| `gemini-3.5-flash-lite` | 3/3    | **6/6**       | 736ms   |
| `gemini-3.1-flash-lite` | 3/3    | **6/6**       | 3001ms  |
| `gemma-4-31b-it`        | 3/3    | **0/6**       | 12506ms |

`FINAL_MODELS` hiện đã không có gemma, và lý do ghi ở
`translation-model-policy.ts` là **tốc độ**. Phép đo bổ sung một lý do nặng hơn:
gemma **không tuân lệnh "chỉ xuất phần dịch"** — nó trả về cả phần tự luận của
mình ("Given the context of 'deployment'… I will provide a professional yet
natural version. _Draft:_ …"). Trên đường cũ thứ đó chỉ hiện lên màn hình. Trên
đường này nó **được đọc thành tiếng vào cuộc họp** và không rút lại được. Nên
lệnh cấm phải là điều kiện tường minh của đường commit, không phải hệ quả tình cờ
của việc xếp hạng theo tốc độ.

Ghi thêm, chưa giải thích được: `gemini-3.1-flash-lite` đo được **median 3001ms**
ở đây, trong khi README ghi 557ms. Prompt nối tiếp dài hơn prompt dịch trơn, nhưng
chênh 5 lần thì không chỉ do độ dài. Nếu con số này giữ nguyên ở phase 6 thì
model thứ hai của ladder **không phải là dự phòng dùng được cho commit**, và ngân
sách request phải tính lại trên một model chứ không phải hai.

**Endpoint chỉ dịch phần dư.** `end()` lấy phần chưa commit thay vì cả lượt. Đây
là chỗ cái đuôi p50 1163ms sau khi ngừng nói sụp xuống.

**Gỡ speculation trên đường continuous.** Không còn bản dịch cuối cỡ lớn để hâm
nóng trước; giữ lại là tiêu quota cho việc vô ích. `client.turn.speculate` **vẫn
ở lại hợp đồng** và vẫn phục vụ đường web một-lượt — chỉ lượt `streaming` mới bỏ
qua nó.

## Related Code Files

- Modify: `packages/types/src/events/ws-events.ts` — `streaming` trong
  `sessionOptionsSchema`; `serverTranslationCommitSchema` vào union
- Modify: `apps/api/src/modules/translate/translate.gateway.ts` — **bắt buộc**;
  chuyển `streaming` qua chỗ dựng lại options ở `:168`
- Modify: `apps/api/src/modules/translate/session/live-preview.ts` — lộ kết quả
  decode ra cho driver dùng chung; tắt `translateLive` trên lượt streaming
- Create: `apps/api/src/modules/translate/session/streaming-commit-driver.ts`
- Create: `apps/api/src/modules/translate/session/streaming-commit-driver.spec.ts`
- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts` —
  gọi driver trong `pushFrame`; `end()` chỉ dịch phần dư; bỏ speculation khi `streaming`
- Modify: `apps/api/src/modules/translate/session/turn-session.ts` — giữ trạng thái commit của lượt
- Modify: `apps/api/src/modules/translate/session/event-channel.ts` — phát sự kiện mới
- Modify: `packages/ai-providers/src/providers/gemini/gemini-translation-provider.ts` — hiện thực `context`
- Modify: `apps/api/src/modules/translate/session/turn-timeline.ts` + `services/turn-metrics.recorder.ts` —
  ghi số vế đã commit và mốc thời gian từng vế (phase 6 cần)

## Implementation Steps

1. **Tương thích trước.** Thêm `streaming` mặc định `false` và sự kiện mới,
   **kèm gateway** — thêm mỗi schema là cờ chết ở `:168`. Viết test tầng gateway
   chứng minh `streaming: true` tới được service **trước** khi viết driver, nếu
   không mọi test dưới đó sẽ xanh trên một cờ không bao giờ tới nơi. Chạy toàn bộ
   test hiện có; phải xanh mà không sửa test nào. Đây là cổng: chưa xanh thì
   không đi tiếp.
2. Hiện thực `context` trong provider Gemini; test rằng nguồn đã commit và đích
   đã phát có mặt trong prompt và model được yêu cầu nói tiếp.
3. Mở kết quả decode của `LivePreview` cho driver dùng chung (một lần decode, hai
   người dùng). Tắt `translateLive` khi `streaming` bật.
4. Viết `streaming-commit-driver.ts`: nhận partial → hỏi phase 3 → có vế thì dịch
   nối tiếp → TTS → `pushSynthesizedWav` trên **cùng** turn key → phát
   `server.translation.commit`. Dùng `client.turn.speculate` làm gợi ý ranh giới.
5. Nối driver vào `pushFrame` cạnh `LivePreview`, chỉ khi `streaming` bật.
6. Sửa `end()`: chỉ dịch phần chưa commit. Lượt không `streaming` đi nhánh cũ
   nguyên vẹn.
7. Lượt `streaming`: **không tiêu request** cho speculation nữa (client vẫn gửi
   event, server chỉ dùng nó làm gợi ý ranh giới).
8. Ghi thêm vào metrics: số vế commit, mốc từng vế, số lần lật.
9. Test: lượt `streaming` phát audio **trước** `server.transcript.final`; lượt
   không `streaming` phát y hệt thứ tự sự kiện cũ.

## Trạng thái (2026-08-14)

**Đã xong:** bước 1 (hợp đồng + gateway + test tầng gateway), 2 (`context` trong
provider Gemini), 3 (chia sẻ kết quả decode; tắt `translateLive` khi streaming),
4 (`streaming-commit-driver.ts` + spec), 5 (nối vào `pushFrame`), 6 (`end()` chỉ
dịch phần dư) và 7 (lượt streaming không tiêu request cho speculation).

**Đã xong nốt:** vết nối dấu câu (`audio/clause-seam.ts` — dấu câu chỉ được
_làm nhẹ_, không bao giờ thêm hay làm nặng, vì nguồn mới là bằng chứng duy nhất
về việc người nói đã dứt câu chưa); ba test mức service; và metrics
`committedClauses` / `firstCommitAfterStartMs` / `commitContradictions`.

Mốc commit đo từ lúc **mở lượt**, không phải từ endpoint như mọi mốc khác —
trên lượt streaming, tiếng đầu tiên phát ra _trước khi_ endpoint tồn tại.

## Success Criteria

- [x] Test `apps/web` và test hợp đồng hiện có xanh, **không sửa test nào để cho xanh**
- [x] Lượt `streaming` đẩy audio giữa lượt; có test chứng minh audio tới trước `transcript.final`
- [x] Lượt không `streaming` giữ nguyên thứ tự sự kiện — có test khoá thứ tự đó lại
- [x] Prompt dịch nối tiếp mang nguồn đã commit + đích đã phát; có test
- [x] `end()` chỉ dịch phần dư; có test cho lượt đã commit một phần
- [x] Test **ở tầng gateway**: `streaming: true` tới được `TurnSession` (không
      phải chỉ test schema parse ra đúng)
- [x] Lượt `streaming` **không tiêu request nào** cho speculation và cho
      `translateLive` — đếm request, không đếm event
- [x] Chỉ có **một** chuỗi decode STT cho mỗi lượt, dù có driver
- [x] Metrics ghi số vế và mốc từng vế

## Risk Assessment

- **Đây là phase phá được `apps/web`.** Giảm thiểu bằng opt-in mặc định tắt và
  bằng việc đặt cổng tương thích ở bước 1 thay vì bước cuối.
- **Vế dịch cụt ý** khi thiếu phần sau. Không rút lại được. Đo ở phase 6 bằng chỉ
  số so bản đã nói với bản dịch offline cả lượt.
- **Rủi ro dựa trên giả định:** dịch nối tiếp qua prompt phụ thuộc việc model
  chịu nghe lời "đừng sửa lại phần đã nói". **Tín hiệu:** bản dịch commit sau
  viết lại nội dung đã phát. **Phản ứng đã định:** ghim lại phần đã phát trong
  prompt như văn bản không được đụng tới; nếu model vẫn viết lại thì chỉ gửi
  nguồn của vế mới cộng một câu ngữ cảnh, chấp nhận mạch dịch lỏng hơn.
- **TTS ghép vế** sẽ nghe thấy mối nối. Thuộc tính kiến trúc TTS, đã ghi là không
  hứa ở `plan.md`. Không chữa ở đây.
- **Rollback:** tắt `streaming` ở client là về hành vi cũ hoàn toàn, không cần
  revert server. Đó là lý do chọn opt-in thay vì đổi thẳng hành vi.
