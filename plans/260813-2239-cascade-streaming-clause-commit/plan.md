---
title: 'Cascade streaming clause commit'
description: 'Cascade STT→MT→TTS phát bản dịch ngay trong lúc người ta còn đang nói, thay vì đợi hết lượt'
status: in_progress
priority: P1
effort: '2w'
tags: [extension, realtime, streaming, mt, metrics]
created: 2026-08-13
---

# Cascade streaming clause commit

> **Đã chặn rồi lại chạy (2026-08-14).** Cổng phase 1 **không đạt**: recognizer
> offline decode lại buffer đang lớn dần **không** đơn điệu prefix trên giọng
> thật có ngập ngừng — 66 và 38 từ đã phát bị phủ nhận, và tăng ngưỡng agreement
> không cứu được vì chỗ hỏng nằm ở **đầu** chuỗi chứ không phải đuôi.
> (`plans/reports/measure-260813-2350-prefix-stability-gate.md`)
>
> **Hướng đã chọn: đổi recognizer cho chiều tiếng Việt.** Đây là hướng plan bản
> đầu đã tự cắt trong Non-goals, và phần cắt đó **đã sai** — nó dựa trên một
> catalog chứ không phải trên thực tế. Spike đã chạy thật cho ra: đơn điệu prefix
> **0 vi phạm trên toàn độ dài lượt**, có dấu câu nguồn, RTF 0,065–0,077 — đổi
> lại **WER xấu hơn 7–9 điểm**, cái giá người dùng đã chấp nhận.
> (`plans/reports/research-260813-2359-streaming-vietnamese-asr.md`)
>
> Hệ quả lên chính plan này, không nhỏ: **phase 2 mới** cho việc đổi engine; ranh
> giới vế chiều vi **lấy được từ dấu câu**; và agreement từ chỗ là cơ chế trung
> tâm tụt xuống chỉ còn phục vụ **chiều tiếng Anh**.

## Overview

Cascade hiện buffer cả câu rồi mới STT → MT → TTS
(`translation-session.service.ts:222`). Nói 15s thì ~16s sau mới có audio đầu
tiên. Đó là khoảng cách người dùng cảm thấy so với Gemini Live, và **chỉnh độ
trễ endpoint không chạm tới nó**: p50 sau khi ngừng nói đã là 1163ms, vốn đã tốt.

Plan này đổi **đơn vị phát tiếng từ lượt sang vế**. Server commit từng vế đã ổn
định _trong lúc lượt còn mở_, dịch nó, TTS nó, đẩy audio về ngay. Endpoint chỉ
còn dịch phần **chưa commit**.

Kết quả cần đạt không phải một con số độ trễ nhỏ hơn, mà là **độ trễ tới tiếng
nói đầu tiên phẳng theo độ dài đoạn nói**: nói 40s bắt đầu nghe thấy bản dịch
cùng lúc như nói 6s. Đường phẳng đó _chính là_ chức năng.

**Đính chính so với bản đầu của plan này** (red-team bắt được, đã kiểm lại tận
code): trên extension, đường nền **không** dốc ≈ 1. `MAX_UTTERANCE_MS = 8000`
(`direction-session.ts:30`) cắt mọi lượt ở 8s, và
`conversation-session.ts:332-342` cho thấy lượt bị cắt đi dịch ngay. Nên hôm nay
mọi đoạn dài hơn 8s đều **chững ở ~9,2s** (8s cắt + 1163ms p50), chứ không tăng
tuyến tính. Cái phải phá vì thế là **hằng số chặn (intercept) ~9,2s → ~2s**, và
"phẳng" phải đo theo **độ dài đoạn nói trong fixture**, không theo độ dài một
lượt — vì độ dài lượt bị trần 8s ép cho phẳng sẵn rồi, kể cả khi chức năng chưa
làm gì.

## Context links

- **Brainstorm + bằng chứng đo:** `plans/reports/brainstorm-260813-2223-streaming-cascade-commit.md`
- **Plan tiền nhiệm:** `260729-2306-extension-continuous-capture` (đã xoá khỏi worktree, còn trong git —
  `git show da13902^:plans/260729-2306-extension-continuous-capture/plan.md`). Plan này gỡ nốt chốt chặn
  thứ sáu mà plan đó không đụng tới: pipeline vẫn tuần tự hoá **trong** một lượt.
- **Runbook đo:** `plans/reports/measure-260730-continuous-capture-runbook.md` (trong git)
- **Docs:** `docs/system-architecture.md` §Streaming Turn, `docs/development-journey.md` mục 12
  (thông lệ "mọi số phải sinh lại được")

## Quyết định đã chốt

| Câu hỏi          | Chốt                                                       | Ghi chú                                           |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| Bề mặt           | **Chỉ extension**                                          | Web/mobile giữ nguyên, không đụng                 |
| Quota            | **Giữ free tier**                                          | Commit thay chỗ speculation, xem §Ngân sách       |
| Phát ra tiếng    | **Chỉ phần đã ổn định**                                    | Audio đã phát không rút lại được                  |
| Ranh giới vế     | **Dấu câu (vi, sau khi đổi engine) + khoảng lặng + số từ** | Đổi so với bản đầu, xem §Ranh giới vế             |
| Ngưỡng agreement | **Chỉ còn cho chiều tiếng Anh**                            | vi đơn điệu theo kiến trúc nên không cần          |
| Recognizer vi    | **Đổi sang nemotron streaming**                            | Đảo ngược một mục Non-goals, xem §Non-goals       |
| Fixture          | **ElevenLabs + dataset công khai**                         | Không tự thu; AMI (en) + Bud500 (vi). Xem phase 1 |
| Tương thích      | **Opt-in theo lượt**                                       | `apps/web` không được đổi hành vi một byte nào    |
| MT local         | **Chưa. Đo rồi quyết**                                     | Phase 6 sinh ra con số quyết định                 |

## Ranh giới vế

**Đổi so với bản đầu của plan.** Lập luận cũ: `zipformer_vi.py:34-47` sinh
`"XIN CHÀO HÔM NAY TRỜI RẤT ĐẸP"` — toàn hoa, không dấu câu — nên
`splitIntoClauses` trên transcript **nguồn** tiếng Việt luôn trả đúng 1 phần, và
mọi thiết kế cắt vế theo dấu câu ở chiều vi→en chết ngay từ đầu.

Lập luận đó đúng với engine cũ và **hết đúng sau phase 2**. Recognizer mới sinh
dấu câu và viết hoa cho tiếng Việt, giữ nguyên cả từ ngập ngừng:
`"Xin được Mỹ ờ chấp thuận đó thì cái thời gian mà chờ Mỹ xét duyệt bao lâu nữa
theo luật sư."` Nên `splitIntoClauses` chạy được trên transcript nguồn.

Ràng buộc còn lại: **khoảng lặng và số từ vẫn phải giữ làm đường lùi**, vì dấu
câu là suy đoán của model chứ không phải sự thật, và một đoạn nói liên tục không
nghỉ có thể không có dấu câu nào trong nhiều giây. `splitIntoClauses` trên văn
bản **đích** không đổi — output Gemini vốn có dấu câu đầy đủ.

## Bằng chứng: prefix có ổn định không

Cả plan đặt trên một giả định, và nó đã được **đo** chứ không giả định: decode
lại buffer đang lớn dần bằng recognizer _offline_ có cho prefix đơn điệu không?
Đo 300ms/lần trên sidecar thật:

|                               | reads | decode p50/max | lần lật prefix đã commit |
| ----------------------------- | ----- | -------------- | ------------------------ |
| **vi** Zipformer (transducer) | 18    | 75ms / 101ms   | **0**                    |
| **en** Moonshine (seq2seq)    | 19    | 149ms / 202ms  | **1**                    |

vi sạch: chỉ 1–2 từ cuối nhiễu (`tôm`→`tôi`, `bài`→`bàn`) — đúng phần agreement
giữ lại.

en **khác**, và cái khác đó là lý do phase 3 tồn tại. Moonshine viết lại prefix
của chính nó: `at a time` → `at set.` → `at seven in the morning` → `at 7 in the
Eve` → `at seven in the evening`. Agreement đã giữ đúng ở 12 từ suốt vùng nhiễu.
Lần lật duy nhất là `seven` → `7` — **viết lại bề mặt, không đảo nghĩa**.

Hệ quả, cả hai đều mới:

- So sánh agreement phải trên **token đã chuẩn hoá** (số, hoa thường, dấu câu),
  nếu không đường tiếng Anh báo lật giả mãi mãi.
- **Tiếng Anh cần ngưỡng sâu hơn tiếng Việt.** Theo ngôn ngữ, không phải một hằng
  số chung.

Cảnh báo ghi thẳng: hai fixture trên là giọng TTS sạch. Giọng thật có ậm ừ sẽ
nhiễu hơn. Phép đo này xác nhận **cơ chế**, chưa xác nhận biên an toàn — chốt
ngưỡng là việc của phase 1 và 3.

> **Cảnh báo đó đã thành sự thật, và bảng trên vì thế không còn đọc được như cũ.**
> Trên giọng thật, cột "0 lần lật" của tiếng Việt thành **66** và **38**. Con số 0
> ở đây không phải bằng chứng recognizer ổn định — nó là **thuộc tính của giọng
> TTS sạch**, và ai đọc bảng này phải đọc kèm câu đó. Sau phase 2, cột tiếng Việt
> đúng là 0, nhưng vì lý do khác hẳn: **kiến trúc decode causal**, không phải vì
> đo trên audio dễ. Cột tiếng Anh vẫn đứng nguyên và vẫn là lý do phase 3 tồn tại.

## Ngân sách request: gần như không đổi

Hôm nay một câu tiêu tới **4 speculation + 3 live-preview + 1 final**
(`translation-model-policy.ts:17`, `live-translation-trigger.ts:43`). **Một**
trong số đó ra tiếng; phần còn lại bị vứt hoặc chỉ hiện chữ.

Sau plan này: **1 request / vế đã commit**, tối thiểu ~3–4s speech mỗi commit →
~15–20 req/phút cho người nói liên tục. Speculation **bị gỡ khỏi đường
continuous** vì không còn bản dịch cuối cỡ lớn nào để hâm nóng trước — đó chính là
chỗ lấy quota cho commit. Mỗi request giờ đều ra tiếng.

**Cảnh báo từ phép đo phase 1: chỗ dựa có thể chỉ là MỘT model, không phải hai.**
Ban đầu phần này tính trên "hai ladder flash-lite = 30/phút". Nhưng đo thật thì
`gemini-3.1-flash-lite` cho median **3001ms** ở prompt nối tiếp (README ghi
557ms cho prompt dịch trơn), và `gemma-4-31b-it` vừa chậm 12,5s vừa **không tuân
lệnh chỉ-xuất-bản-dịch** nên bị cấm khỏi đường commit hẳn (xem phase 4). Nếu
3001ms giữ nguyên ở phase 6 thì commit thực chất chỉ chạy trên
`gemini-3.5-flash-lite`, tức **15/phút mỗi project** — và ngân sách phải dựa vào
xoay key qua nhiều project, chứ không dựa vào ladder.

## Sàn độ trễ — không hứa thấp hơn

Với từ kết thúc một vế, giữa câu: transport ~50–100ms + phát hiện ranh giới
~250–300ms + chờ nhịp partial & decode ~210–250ms + một vòng xác nhận agreement
~300ms + MT 553ms p50 + TTS mẫu đầu ~527ms + đệm phát ~50–100ms ≈ **~1.9s p50**.
p95 bị đuôi MT (1947ms p95, xấu nhất 8943ms) kéo lên ~3.3s.

Từ **nằm giữa** một vế còn phải đợi vế đó kết thúc (1–3s) — đó là ngôn ngữ học,
không phải kỹ thuật, và không đòn bẩy nào trong plan này gỡ được.

**Không hứa:** dưới 1s; độ liền ngữ điệu như Live (ghép từng vế VieNeu/Kokoro sẽ
nghe thấy mối nối — thuộc tính kiến trúc TTS); không bao giờ có vế dịch cụt ý;
phiên dài vô hạn trên free tier (~60–90 phút nói liên tục là cháy 500 req/ngày).

## Hợp đồng: opt-in, không phá web

`apps/web` vẫn là hạng mục được chấm và chạy `maxInFlight: 1`. Nên chế độ commit
**bật theo từng lượt** qua `sessionOptions`, mặc định tắt:

- `sessionOptionsSchema` thêm `streaming: z.boolean().default(false)` — tab web
  cũ không gửi trường này vẫn hợp lệ, và hành vi không đổi một byte.
- Thêm `server.translation.commit` — ngữ nghĩa **nối thêm**, khác hẳn
  `server.translation.partial` vốn được ghi rõ là "thay nguyên cụm, không nối".

Client **không cần đổi transport cho audio**: `conversation-session.ts:555` đã
map `frame.sessionId` → turnKey rồi đẩy vào `OrderedPlayback`, không hề giả định
audio tới sau `transcript.final`. Audio giữa lượt chạy đúng qua đường đó ngay
hôm nay.

## Phases

| #   | Phase                                                                                           | Status                   |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | [Phase 1: Dụng cụ đo, fixture, và đường nền](./phase-01-harness-fixtures-baseline.md)           | Phần lớn xong            |
| 2   | [Phase 2: Đổi STT tiếng Việt sang recognizer streaming](./phase-02-streaming-stt-vietnamese.md) | Xong                     |
| 3   | [Phase 3: Chính sách commit prefix ổn định](./phase-03-stable-prefix-commit-policy.md)          | Xong                     |
| 4   | [Phase 4: Hợp đồng và commit phía server](./phase-04-server-streaming-commits.md)               | Xong                     |
| 5   | [Phase 5: Phát và hiển thị theo commit](./phase-05-client-commit-playback.md)                   | Code xong, chờ nghe thật |
| 5b  | [Phase 5b: Micro liên tục trong lúc bản dịch đang phát](./phase-05b-continuous-microphone.md)   | Code xong, chờ đo        |
| 6   | [Phase 6: Đo lại, chốt hằng số, docs](./phase-06-measure-and-docs.md)                           | Pending                  |

Phase 1 còn nợ: bộ sinh fixture ElevenLabs, bản chạy đường nền, và report đo của
chính phase 1. Phần đã xong và vẫn dùng được: dụng cụ đo trong
`benchmarks/realtime/`, lệnh cấm `gemma-4-31b-it` khỏi mọi đường phát ra tiếng,
và đường nền intercept ~9,2s.

## Success Criteria

- [ ] Độ trễ tới tiếng nói đầu tiên **phẳng theo độ dài đoạn nói trong fixture**
      (trục x lấy từ `vad-reference.mjs`, **không** lấy từ độ dài một lượt), và
      **hằng số chặn giảm từ ~9,2s xuống ~2s**. Đây là tiêu chí chính.
- [ ] Từ → tiếng nói **p50 ≤ ~2s và p95** trên ma trận fixture. p95 bắt buộc có:
      phân bố ở đây lưỡng cực (vế sạch ~2s, đoạn ngập ngừng 10s+) nên chỉ nhìn
      p50 sẽ không thấy gì cả.
- [ ] **Khoảng cách dài nhất giữa hai lần commit trong lúc người ta vẫn đang
      nói**, theo từng fixture. Đây là chỉ số bắt "commit chết đói" — trường hợp
      agreement không bao giờ ổn định nên **không commit gì cả**: không có vế nào
      bị lật, không có lỗ nào bị đếm, p50 không nhúc nhích, mà người nghe thì
      nghe thấy chức năng chết giữa câu.
- [ ] **Không có vế đã phát nào bị lật** trên toàn ma trận (đếm được, không phải khẳng định suông)
- [ ] Không có lỗ im lặng > ~1.5s trong lúc còn text đã commit chưa phát hết
- [ ] Số lượt `dropped` ≈ 0 trên toàn ma trận
- [ ] Coverage ≥ 99% trên bản chạy liên tục 3 phút, mẫu số từ `vad-reference.mjs`, tử số gồm **mọi** outcome
- [ ] Req/phút **tách theo model**, nằm trong free tier với người nói liên tục
- [ ] `apps/web` không đổi hành vi: test hiện có xanh, không sửa test nào để cho xanh
- [ ] Mọi số tái lập được bằng lệnh đã commit

## Rủi ro

- **Đuôi MT làm nghẹn dòng.** p95 1947ms / xấu nhất 8943ms → khoảng 1/20 vế về
  trễ đủ tạo lỗ nghe thấy giữa câu. **Tín hiệu:** chỉ số lỗ liên tục ở phase 6.
  **Phản ứng đã định trước:** không chữa bằng cách nới ngưỡng commit (sẽ ăn vào
  độ ổn định); mở lại câu hỏi MT local cho _phần phát ra tiếng_, giữ Gemini cho
  transcript hiển thị vốn rút lại được.
- **Giọng thật nhiễu hơn giọng TTS — rủi ro này đã nổ, và phase 2 là câu trả
  lời.** Chỉ còn đúng cho **chiều tiếng Anh**, nơi Moonshine vẫn là seq2seq viết
  lại được prefix của chính nó và **vẫn chưa ai đo trên giọng thật**. **Tín
  hiệu:** vế bị lật > 0 ở chiều en. **Phản ứng:** tăng ngưỡng agreement theo ngôn
  ngữ, chấp nhận thêm ~300ms; nếu vẫn lật thì chiều en lùi về phương án B (giữ
  lượt, cắt ngắn ở khoảng lặng) trong khi chiều vi vẫn chạy commit — **hai chiều
  không bắt buộc phải cùng cơ chế**.
- **Decoder streaming câm giữa chừng.** Nemotron phát token thẻ ngôn ngữ ở đứt
  gãy âm học rồi ngừng ra chữ tới hết lượt. Đã dựng lại được và đã bịt được, xem
  phase 2 — nhưng bịt đường đã biết không có nghĩa là hết đường. **Tín hiệu:**
  transcript đứng im trong khi VAD vẫn báo có tiếng. **Phản ứng:** watchdog reset
  session ở lớp trên, và **ghi log**, đừng nuốt.
- **Bằng chứng hai chiều không ngang nhau.** Tiếng Anh có AMI: họp thật, không
  cắt khúc, có tiếng phòng. Tiếng Việt **không có bộ tương đương công khai** —
  đoạn dài phải ghép nhân tạo từ clip ngắn. Nên ngưỡng tiếng Việt đứng trên nền
  yếu hơn. Ghi rõ trong report, đừng trình bày như nhau.
- **Vế dịch cụt ý.** Commit không có phần tiếp theo có thể ra câu cụt (thiếu
  loại từ, sai mạo từ). Đo được, **không** rút lại được. Chấp nhận như cái giá —
  đúng đánh đổi mà phiên dịch người cũng chịu.
- **Lượt sống lâu ăn slot đồng thời.** Commit làm lượt dài ra, mà
  `MAX_CONCURRENT_TURNS_GLOBAL` đếm lượt đang mở. Có thể phải chỉnh; đã đưa vào
  phase 6 cùng với việc suy lại trần bộ nhớ (`MAX_TURN_BYTES` × trần).
- **Cổng micro tắt trong lúc bản dịch đang phát.** Cổng echo
  (`meeting-capture.ts:230-251`) đứng trên tiền đề "playback có khoảng hở để mở
  lại" — tiền đề đó đã hết đúng khi commit theo vế làm playback gần như liên tục,
  và Live được miễn trừ đúng vì lý do này. Chiều outbound còn tệ hơn: vế của lượt
  N phát trong lúc lượt N vẫn đang thu, gate micro về 0, endpointer đóng lượt
  sớm. **Đã có phase 5b.** Không chặn benchmark phase 6 (bản ghi không đi qua cổng
  micro), nhưng chặn việc gọi tính năng là xong và chặn demo thật.
- **Quota cho việc đo.** Mỗi lần chạy 3 phút ăn phần lớn hạn mức ngày. Đo req/phút
  ngay lần chạy đầu; xếp lịch đo khác ngày với hôm demo.
- **Số xấu vẫn phải ghi.** Đường độ trễ dốc lên, hay lượt fail vì quota, là **dữ
  liệu**, không phải thất bại. Đừng chỉnh phép đo cho số đẹp.

## Non-goals

- Web, mobile, half-duplex. **AEC tự viết** — phase 5b chỉ _xin_ chế độ AEC có
  sẵn của trình duyệt (`echoCancellation: 'all'`) và đo kết quả, không dựng bộ khử
  echo nào.
- Thay hoặc đụng vào backend Gemini Live.
- ~~Streaming STT~~ — **mục này đã bị chính bằng chứng lật, xem phase 2.** Lý do
  cắt ban đầu ("catalog sherpa-onnx không có Zipformer streaming tiếng Việt") vẫn
  đúng về mặt sự kiện nhưng **hẹp**: nó nhìn một catalog rồi kết luận cho cả bài
  toán. Câu tiếp theo — "phần giá trị còn lại, prefix ổn định, làm được bằng code
  chính sách" — thì **sai thẳng**, và phép đo phase 1 đã chứng minh: agreement
  không vá được một recognizer không đơn điệu, vì nó canh đuôi còn chỗ hỏng ở
  đầu. Ghi lại để nhớ: một non-goal cắt trên bằng chứng vẫn có thể sai, khi bằng
  chứng chỉ phủ một góc của câu hỏi.
- Đổi recognizer **chiều tiếng Anh**. Moonshine chưa bao giờ được đo trên giọng
  thật, nên chưa có căn cứ nào để đổi.
- wait-k thật (cần điều khiển decoder mà Gemini không mở).
- Chỉnh `SPEECH_HANGOVER_MS` như một đòn bẩy chính. Khi đã có commit, nó chỉ còn
  ảnh hưởng vế cuối.

## Open questions

1. **Free tier vs MT local.** Đã chốt giữ free tier _bây giờ_; phase 6 sinh ra
   con số quyết định (đếm lỗ im lặng + số req/ngày thực).
2. Một stream inbound có bao giờ lẫn hai ngôn ngữ không? Nếu có, ngưỡng agreement
   phải theo từng utterance và phải nhận diện ngôn ngữ trước khi commit.
3. ~~Trần cắt cứng 8s có còn cần không~~ — **đã chốt, không còn treo.** Đây là
   quyết định lúc build chứ không phải kết quả đo: nếu không nới thì phase 6 không
   có cấu hình nào để đo, và tiêu chí chính không kiểm chứng được. Phase 5 nới
   `maxUtteranceMs` cho **lượt streaming** về phía trần server
   (`MAX_TURN_SECONDS = 60`, `turn-audio.ts:12` — server đã cho phép sẵn), giữ 8s
   cho lượt không streaming. Đi kèm bắt buộc: suy lại trần đồng thời và trần bộ
   nhớ ngay ở phase 5, không để tới phase 6.
