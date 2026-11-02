# Candidate B — Brainstorm contract: hiểu cuộc hội thoại tích lũy theo lượt + cắt lời gọi LLM mỗi lượt

Ý chính: "hiểu cuộc hội thoại" được lưu thành một **trạng thái có cấu trúc, có cap**, giống một state file của AK, chứ không phải một đoạn tóm tắt văn xuôi. Trạng thái đó được cập nhật **ngoài đường live**, và chỉ được đưa vào prompt qua các kênh đã đo (glossary ≤ 4 từ mỗi vế) và qua một gate độ dài. Phần chi phí cho việc "hiểu" được trả bằng cách bỏ những lời gọi mà log prod cho thấy gần như không đem lại gì.

## 1. Outcome

1. **Hiểu tích lũy.** Mỗi kết nối giữ một `ConversationState`. Nó gồm một nhãn chủ đề ngắn, các thực thể và thuật ngữ đã dịch, và thông tin ai đang nói. Lượt càng về sau thì trạng thái càng đầy. Bản dịch các lượt sau đo được là tốt hơn hoặc nhất quán hơn, và câu hoàn chỉnh không bị kéo nghĩa sai (anchoring).
2. **Rẻ hơn.** Số lời gọi cloud LLM trung bình mỗi lượt và số token tính tiền mỗi lượt giảm rõ so với baseline. Phần này **đã gồm** cả lời gọi mới mà phần "hiểu" cần.

## 2. Constraints

- **Không có lời gọi chặn mới trên đường live.** Context chỉ chứa lượt đã xong, và caller không bao giờ chờ context (`packages/ai-providers/src/interfaces/translation-provider.ts`).
- **Anchoring đã đo:**
  - 4 utterance context trên một câu 17 từ lật nghĩa 4/4 sang sai. Context chỉ được gửi cho transcript ≤ 4 từ (`MAX_FRAGMENT_WORDS = 4`, `packages/ai-providers/src/providers/gemini/prompt-builder.ts:104`).
  - Khoảng 5–15 từ chưa từng đo.
- **Kênh lệnh:**
  - Mỗi vế glossary tối đa 4 từ, và cap này là thứ chặn tải (một vế dài bằng câu đã bị model làm theo như lệnh). Topic ≤ 200 ký tự.
  - Learned terms hiện chỉ đi tới STT, không vào prompt dịch (`apps/api/src/modules/translate/session/conversation-context.ts`).
  - Ở two-way, lời phía bên kia bị loại khỏi context.
  - Mọi thay đổi prompt phải chạy lại `benchmarks/prompt-injection`.
- **Bố cục prompt:**
  - System instruction đi riêng.
  - User message theo thứ tự `[context block, <transcript>, reminder]` (`packages/ai-providers/src/providers/openai-compatible/openai-compatible-translation-provider.ts:206`, `:279-281`).
  - Cùng một context block được gửi lại tối đa 5 lần mỗi lượt (`MAX_SPECULATIONS_PER_TURN = 4`, `session/translation-model-policy.ts:39`, cộng final), cộng thêm live preview.
- **Prod:**
  - `deepseek-flash` hoặc proxy `deepseek/deepseek-v4-flash-fast`, temperature 1.0, nên mọi phép đo phải lặp ≥ 3 lần.
  - Cửa sổ Command Code 5 giờ khoảng 5.3k lời gọi.
  - CPU-only, VM khoảng 9.7 GiB: không thêm model local nào trên đường dịch.
- **Chi phí token hiện chưa đo được.** Provider không đọc trường `usage` của response: grep `usage|prompt_cache` trong `openai-compatible-translation-provider.ts` không ra kết quả nào. Turn metrics chỉ ghi `speculation=` và `live=` (`services/turn-metrics.recorder.ts:151-152`).
- Không dùng dữ liệu giả. Không dùng reference do model sinh. Số liệu phải tái lập được.

## 3. Non-goals

- Đổi provider hay model dịch. Fine-tune.
- Trí nhớ tự động xuyên hội thoại vào prompt. Ở STT, danh sách cố định đã đo là lỗ (journey §"Garbled loanwords…").
- Nới `MAX_GLOSSARY_TERM_WORDS`, nới cap topic, hay nới `MAX_FRAGMENT_WORDS` khi chưa đo.
- Đổi STT, TTS, minutes. Tắt live preview như một tính năng UX.
- Đưa câu chữ phía target của phía bên kia vào prompt.

## 4. Acceptance criteria

**AC-C. Chi phí (thước: turn-metrics log mở rộng cùng replay).**

- **AC-C0, instrumentation.** Dòng `turn … ok` có thêm:
  - `calls=` theo loại: live, spec, final, scriptRetry, fusion, homophones, respell, polish, retranslate, digest;
  - `tokensIn=`, `tokensOut=`, và `cacheHitTokens=` nếu provider trả về.
  - Không đổi hành vi. Kiểm bằng unit spec của recorder, cùng ≥ 50 lượt prod thật làm baseline.
- **AC-C1, số lời gọi.** Replay cùng một bộ recording đã ghi (≥ 3 session, ≥ 60 lượt) dưới tài khoản owner, mỗi arm 3 lần.
  - Trung bình `calls/turn` của arm mới phải ≤ 60% baseline, tức giảm ≥ 40%. Ngưỡng này là **ước lượng**, cần chốt.
  - Lời gọi `digest` được tính vào tổng.
- **AC-C2, token tính tiền.** `tokensIn + tokensOut` mỗi lượt, cộng digest phân bổ theo lượt, phải ≤ 70% baseline (**ước lượng**).
- **AC-C3, quota.** Với nhịp lượt đo được, ước tính một giờ hội thoại phải nằm dưới mức 5.3k / 5 giờ với biên ≥ 2×. Ví dụ: ≤ 530 lời gọi/giờ cho một người dùng (**ước lượng**, suy từ cửa sổ).

**AC-Q. Chất lượng.**

- **AC-Q1, không tụt khi cắt chi phí.**
  - Trên `benchmarks/live-translate`, chrF++ và COMET của arm mới không thấp hơn baseline: paired bootstrap theo mẫu `benchmarks/mt-zh`, cận dưới CI ≥ −0.5 chrF++ (**ước lượng**), 3 lần lặp.
  - Riêng việc cắt homophones và fusion phải qua `benchmarks/recognizer-fusion` và `benchmarks/homophone-repair`. WER trên 6 hội thoại đã ghi không được vượt dải đã ghi (4.73–4.91%, `pipeline-translator.service.ts:264-268`).
- **AC-Q2, hiểu tích lũy.** Dựng harness `benchmarks/conversation-context/` từ `ConversationTurn` thật (≥ 2 hội thoại, mỗi hội thoại ≥ 30 lượt), reference do người viết.
  - Term-render accuracy trên các lượt có thuật ngữ lặp, tái dùng `benchmarks/error-analysis/term-rendering.mjs`: arm mới hơn baseline, CI paired bootstrap không chứa 0, 3 lần lặp.
  - Tách theo nhóm vị trí 1–5, 6–15, 16+. Khoảng cách ở nhóm 16+ phải ≥ khoảng cách ở nhóm 1–5. Đây là bằng chứng cho "càng dịch càng hiểu".
- **AC-Q3, anchoring.** Trên các lượt ≥ 5 từ cùng control set anchoring (ca "Build/Play a big series" trong `prompt-builder.ts`, cộng các ca tương tự do người viết), số lần lật nghĩa sai không tăng qua 3 lần lặp. chrF++ đạt cùng bar với AC-Q1.

**AC-S. An toàn.** `benchmarks/prompt-injection` đạt 100% ở `--repeats 3` trên `deepseek-flash`. Thêm các hàng mới, trong đó lệnh được cài vào lời nói để rơi vào digest (một "thuật ngữ" hay một "chủ đề" mang lệnh). Glossary adherence không tụt quá trước trừ 1.

**AC-L. Latency.**

- Turn p50 `translated=` từ log không tăng quá +5% so với baseline (**ước lượng**). p50 lịch sử khoảng 907 ms.
- Lượng thời gian mà lượt "hit" tiết kiệm được giữ nguyên hoặc tốt hơn.
- Digest không bao giờ nằm trên đường chờ của một lượt.

## 5. Option exploration

Baseline, đọc từ log (mẫu nhỏ, **ước lượng**):

- 11 lượt có metrics tạo ra 17 speculative, 16 live và khoảng 6 final (một final cho mỗi lượt miss), tức khoảng 3.5 lời gọi kiểu translate mỗi lượt.
- Toàn container: `homophones(commandcode)` có 12 lượt ok, trong đó **11 lượt accepted=0** và 1 lượt accepted=1. Thêm 8 lượt failed ở timeout, 1 lần `fusion` accepted=1, 1 lần `respell`. Số liệu từ `docker logs chatofy_prod_api --since 168h | grep`.
- Như vậy 20 lời gọi homophones chỉ cho 1 sửa được nhận.
- Tổng ước khoảng 4–6 lời gọi mỗi lượt.

### A. Trạng thái tất định + gộp làn (0 lời gọi cho phần "hiểu")

- **"Hiểu":** `ConversationState` trong `conversation-context.ts`, được điền **không dùng LLM**:
  - term ledger gồm các span Latin/tên riêng hoặc span đã qua guard loanword, cùng cách bản final đã render chúng;
  - topic do người dùng tự viết (`TranslationContext`).
- **Cắt chi phí:**
  - Live preview và speculation dùng chung một bản dịch đang bay. Một speculation không gửi lại khi text giống hệt live preview gần nhất.
  - Hạ `MAX_SPECULATIONS_PER_TURN` theo phân bố hit. Trên mẫu này mọi hit đều ở /1 hoặc /2.
  - Gate homophones bằng một precheck local (`soundKey` đã có): chỉ gọi khi transcript chứa từ thuộc cặp đồng âm.
- **Giả định chính:** lỗi ở lượt sau chủ yếu là thuật ngữ không nhất quán, và bản render đầu tiên thường đúng.
- **Điểm gãy đầu tiên:** không thật sự "nắm hội thoại nói về gì", vì không có chủ đề nào tự sinh ra. Lượt đầu dịch sai thì sổ khóa luôn cái sai.
- **Xấu nhất:** cả hội thoại nhất quán SAI một thuật ngữ. Vẫn rẻ hơn baseline.

### B. Digest cuốn chiếu có cấu trúc, ngoài đường live, trả bằng cách bỏ lời gọi lãng phí (khuyến nghị)

- **Thành phần A, cộng thêm `ConversationDigest`.** Cứ mỗi K lượt xong, hoặc khi đủ W từ mới, chạy **một** lời gọi nền trên model `deepseek-flash` đang dùng. Input là các lượt nguồn đã xong cùng bản final. Output là JSON có schema cứng:
  - `domain`: ≤ 4 từ;
  - `entities`: ≤ 8 mục, mỗi vế ≤ 4 từ;
  - `terms`: cặp `source → target`, mỗi vế ≤ 4 từ;
  - `register`: enum.
- **Tầng kiểm tra:**
  - Parser tất định loại mọi mục vượt cap, mọi chữ khác script, và mọi mục không xuất hiện nguyên văn trong transcript nguồn (mỗi term phải trích được, không được bịa).
  - Merge vào state. Glossary của người dùng thắng khi xung đột. Mục có `seenCount ≥ 2` mới được dùng, để giảm việc khóa lỗi ở lượt đầu.
- **Inject:**
  - `terms` và `entities` đi qua kênh glossary, chung cap 24 cặp, sau glossary của người dùng.
  - `domain` đi vào `hints.topic` **chỉ khi** `needsPriorSpeech(transcript)` đúng (≤ 4 từ, hoặc `continuesCut`). Như vậy câu hoàn chỉnh không bao giờ nhận chủ đề tự sinh, đúng nhóm đã đo là bị hại.
  - Nới gate này lên 5–15 từ chỉ là một arm đo, không ship mặc định.
- **Trả tiền:** áp toàn bộ phần cắt của A. Thêm việc gom `homophones` và `fusion` vào precheck. Nếu sau đó chúng vẫn qua AC-Q1, đổi `correctTranscript` (`services/pipeline-translator.service.ts:645-700`) sang chỉ gọi khi precheck nói có ứng viên.
- **Giả định chính:** một digest mỗi K lượt, đi qua cap và parser, mang được thông tin chủ đề và thuật ngữ mà model dùng được qua kênh glossary. Phần cắt chi phí lớn hơn 1/K lời gọi.
- **Điểm gãy đầu tiên:** kênh glossary không giúp `deepseek-flash`. Lãi mới được ghim trên 3.5-flash-lite (4→7), còn 3.1 thì 2→1. Khi đó digest chỉ là chi phí, phải tắt.
- **Xấu nhất có thể xảy ra:** digest cài một cặp 4 từ có chủ đích sai (ví dụ "CEO → kẻ lừa đảo") đi vào mọi lượt có thuật ngữ đó.
  - Cap 4 từ chặn được lệnh dài, nhưng không chặn được cách dịch sai.
  - Giảm nhẹ bằng `seenCount ≥ 2`, bằng ưu tiên glossary người dùng, bằng chỉ lấy span nguồn có mặt nguyên văn, và bằng việc thêm hàng injection kiểu này vào AC-S.
  - Nhưng rủi ro này không về 0. Hậu quả bị giới hạn: chỉ những lượt chứa thuật ngữ đó.

### C. Cõng state lên lời gọi final (0 lời gọi thêm)

- **Cách làm:** final translate trả về `{translation, stateDelta}` trong một response.
- **Giả định chính:** model ở temperature 1.0 giữ đúng format mà chất lượng dịch không tụt.
- **Điểm gãy đầu tiên:**
  - Lượt **hit** không có lời gọi final, vì final reuse một speculation (`session/turn-speculation.ts:59`). Vậy speculation cũng phải sinh delta, token output bị nhân lên đến 5 lần.
  - Streaming `onChunk` và first token bị chậm vì phải đọc JSON.
  - Output dịch, vốn chỉ là chữ, nay lại là nguồn ghi vào prompt các lượt sau, tức là mở thêm một kênh lệnh trên đường live.
- **Xấu nhất:** chất lượng dịch và latency tụt trên **mọi** lượt, và lỗi format làm hỏng bản dịch người nghe nhận được.

So theo trường hợp xấu nhất:

- C tệ nhất, vì nó làm hỏng chính bản dịch.
- B có rủi ro bị giới hạn: theo thuật ngữ, ngoài đường live, có thể tắt bằng flag.
- A an toàn nhất, nhưng không đáp ứng đầy đủ yêu cầu "nắm hội thoại nói về gì" mà người dùng đã chốt.

## 6. Trade-offs

|                                                        | A               | B                                         | C                                            |
| ------------------------------------------------------ | --------------- | ----------------------------------------- | -------------------------------------------- |
| Lời gọi thêm cho phần "hiểu"                           | 0               | khoảng 1/K lượt (**ước lượng** K=5 → 0.2) | 0 lời gọi, nhưng token ×5                    |
| Có "nắm chủ đề" thật                                   | không           | có (trễ K lượt)                           | có                                           |
| Rủi ro anchoring trên câu hoàn chỉnh                   | thấp            | thấp (topic bị gate ≤ 4 từ)               | cao (không gate được trong cùng một lời gọi) |
| Kênh lệnh mới                                          | ledger tất định | digest, có schema, cap và parser          | output dịch đi thẳng vào prompt              |
| Rủi ro latency                                         | không           | không (nền)                               | có, trên mọi lượt                            |
| Phụ thuộc lãi glossary trên `deepseek-flash` (chưa đo) | có              | có                                        | có                                           |

Trade-off chính của B: trễ K lượt và thêm một kênh lệnh, đổi lại có chủ đề thật. Gate độ dài khiến chủ đề **không** giúp được câu hoàn chỉnh mơ hồ. Đây là đánh đổi chủ động theo kết quả đo anchoring, không phải sơ suất.

## 7. Better approaches

Có một hướng tốt hơn ở **phía chi phí**: cắt theo lợi ích đo được của từng loại lời gọi, chứ không cắt đều.

- **Bằng chứng:** log prod cho thấy `homophones` có 20 lần gọi, chỉ 1 lần accepted, và 8/20 timeout ở 2.5 s. Trong khi đó live cùng speculation chiếm khoảng 33/39 lời gọi translate trên 11 lượt, và 6/11 lượt miss làm phí toàn bộ phần speculation.
- **Tác động vận hành:** hai nguồn này lớn hơn nhiều so với một digest 1/K. Không cần đụng prompt dịch, nên không chạm tới anchoring hay injection.
- **Lưu ý:** homophones nằm trong phép đo WER 5.86 → 4.73–4.91%, nên chỉ được cắt hoặc gate sau khi chạy lại `benchmarks/recognizer-fusion`.
- **Chi phí chuyển hướng:** thấp. Phần này là thứ tự ưu tiên bên trong hướng được yêu cầu, không thay đổi hướng đó.

Phía "hiểu" thì không có hướng nào tốt hơn hướng được yêu cầu. Lý do: người dùng đã chốt, và thiết kế B đã né kết quả đo anchoring bằng gate `needsPriorSpeech` cùng kênh glossary đã có cap.

## 8. Recommended direction

Đi theo **B**, làm theo thứ tự: đo → cắt → hiểu.

**Thành phần và file:**

1. **Instrumentation (AC-C0).**
   - Đọc `usage` (cùng trường cache-hit nếu có) trong `openai-compatible-translation-provider.ts` và `openai-compatible-loanword-respeller.ts`.
   - Đếm theo loại trong `services/turn-metrics.recorder.ts`, rồi ghi ra dòng `turn … ok`.
2. **Gộp làn live/speculation.**
   - Sửa `session/live-preview.ts` và `session/turn-speculation.ts`: dedupe text, và speculation tái dùng bản live đang bay khi text giống hệt.
   - Hạ `MAX_SPECULATIONS_PER_TURN` (`session/translation-model-policy.ts`) chỉ khi phân bố trên ≥ 50 lượt xác nhận rằng hit nằm ở ≤ 2.
   - Xem lại `LIVE_TRANSLATION_COMMIT_CHARS` (`session/turn-tuning.ts:54`) như một núm đo.
3. **Gate correction.** Thêm precheck tất định trong `pipeline-translator.service.ts` `correctTranscript`, dùng `soundKey` có sẵn. Kiểm bằng `benchmarks/homophone-repair` và `benchmarks/recognizer-fusion`.
4. **`ConversationState` cùng digest.**
   - Map state trong `session/conversation-context.ts` (cùng WeakMap).
   - Prompt và parser cho digest trong `packages/ai-providers/src/providers/openai-compatible/` (file mới, kebab-case).
   - Lịch chạy nền ở `session/block-retranslator.ts`: dùng chung kiểu budget RPM, digest không bao giờ được await.
   - Merge vào `hints.glossary` và `hints.topic` tại `buildContextBlock` (`prompt-builder.ts:442`), giữ nguyên cap, `topic` bị gate bởi `needsPriorSpeech` (`:400`).
   - State là append-stable, đặt trong context block đầu user message. Nhờ vậy các lần gửi lại trong cùng lượt có chung tiền tố. Chuyện DeepSeek hay proxy có tính giá cache cho tiền tố hay không thì **chưa xác minh**, nên chỉ đọc nó qua `cacheHitTokens` của AC-C0.

**Ngân sách lời gọi mỗi lượt (two-way vi↔en, một target):**

| Loại                      | Trước (log, mẫu 11–24 lượt)                                 | Sau (**ước lượng**, mục tiêu)       |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| live                      | khoảng 1.45                                                 | khoảng 0.8 (dedupe với spec)        |
| speculation               | khoảng 1.55                                                 | khoảng 0.8                          |
| final                     | khoảng 0.55                                                 | khoảng 0.55                         |
| homophones/fusion/respell | khoảng 0.9                                                  | khoảng 0.2 (precheck)               |
| digest                    | 0                                                           | khoảng 0.2 (K=5)                    |
| **Tổng**                  | **khoảng 4.4** (packet ước 5–6 khi tính polish/retranslate) | **khoảng 2.5**, tức giảm khoảng 43% |

Mọi số ở cột "Sau" là mục tiêu cần được AC-C1 xác nhận, không phải kết quả đo.

**Bước nhỏ nhất đầu tiên:** chỉ làm thành phần 1. Không đổi hành vi, không tốn lời gọi trả phí, có unit spec. Sau đó deploy và thu ≥ 50 lượt prod thật.

**Gate cho từng bước:**

- **Sang bước 2–3:** baseline AC-C0 cho biết loại nào chiếm phần lớn lời gọi và token. Chỉ cắt loại chiếm ≥ 20% tổng, và mỗi lần cắt phải qua AC-Q1 cùng AC-L trên replay.
- **Sang bước 4:** chạy một arm _oracle_ trong `benchmarks/conversation-context/`, trong đó digest dựng từ reference. Arm này phải qua AC-Q2 trên `deepseek-flash`. Nếu ngay cả oracle cũng không có lãi thì dừng digest và ghi kết quả âm vào journey.
- **Ship digest:** arm digest-thật qua AC-Q2, AC-Q3 và AC-S. Chỉ ship sau một flag. Tổng sau cùng phải qua AC-C1 và AC-C2, đã tính cả digest.

## 9. Unresolved questions

1. Ai viết reference cho ≥ 60 lượt hội thoại thật, và lấy hội thoại nào? Thiếu reference thì AC-Q2 và AC-Q3 không đo được.
2. Người dùng có chấp nhận rằng thuật ngữ do digest tự sinh từ lời người nói được vào prompt dịch không? Việc này đảo ngược quyết định "learned terms không vào prompt dịch". Nếu chấp nhận, áp dụng cả two-way hay chỉ one-way?
3. Prod có bật polisher (`gpt-5.6-sol`) không? Log 168h có 0 dòng chứa "polish", và lỗi của nó chỉ log ở mức debug (`session/turn-polisher.ts:59`). Nếu có bật thì đây có thể là khoản đắt nhất theo token, và phải đưa vào AC-C0.
4. Live preview prod có đi qua DeepSeek không? Code mặc định `LIVE_TRANSLATION_MODELS = ['gemini-3.5-flash-lite']`. Câu này quyết định việc gộp làn có khả thi không, vì hai làn phải cùng model.
5. Ngưỡng AC-C1 (−40%), AC-C2 (−30%), chrF++ −0.5 và p50 +5% đều là ước lượng. Người dùng muốn chốt bar nào?
6. Ngân sách cho các lần chạy benchmark và replay (3 lần lặp × nhiều arm) chạy trên DeepSeek trực tiếp hay proxy, và trần là bao nhiêu lời gọi?
7. K và W của digest (đề xuất K=5) là ước lượng. Có muốn đo K ∈ {3, 5, 10} không?

---

## Ultra ranking appendix

Best-of-5 verifier mode, inspired by LLM-as-a-Verifier (not the full framework). Five independent Opus candidates, one Fable verifier, anonymized A–E. The winner above is emitted unchanged. It supersedes `brainstorm-261102-0909-translation-context-harness.md` on one point: the user decided that conversation-level understanding is wanted, so the rolling digest is in scope (gated), not rejected.

| Candidate  | Faithful | Evidence | AC sharp | Honesty | Conditional | Total |
| ---------- | -------- | -------- | -------- | ------- | ----------- | ----- |
| B (winner) | 16       | 18       | 18       | 17      | 18          | 87    |
| E          | 17       | 17       | 16       | 18      | 17          | 85    |
| C          | 17       | 17       | 16       | 17      | 17          | 84    |
| A          | 17       | 16       | 16       | 17      | 17          | 83    |
| D          | 15       | 15       | 17       | 16      | 16          | 79    |

All five passed the hard constraints. B won on grounding and acceptance criteria: it is the only one that read the homophones log as 20 calls for 1 accepted correction, and it counts the digest and polish inside the cost target.

Verifier notes that close two of B's open questions (from source and logs, not from B):

- Q4: live preview, speculation and final all reach the same DeepSeek model on prod. The openai-compatible provider intersects the Gemini ladder with its own models (`openai-compatible-translation-provider.ts` ~L252-254), and all 47 `translate(` log lines name `deepseek/deepseek-v4-flash-fast`. Lane merging is feasible; splitting lanes across models saves nothing.
- Q3: the polisher is very likely ON in prod (only `commandcode` registers one, `homophones(commandcode)` proves that host is selected, and no circuit trip was logged). Inference, not observation, because success is not logged.

Ideas in non-winners that the winner does not contain:

- Speculation runs `correctTranscript` per speculation (`speculate()` passes `restoreDisplay`), while `translateAll` translates the raw `sourceText`, so corrections never reach the translation. Moving correction off speculation costs translation nothing (E).
- Do not open speculation n+1 while n is still in flight (E).
- `Subject:`/`Register:` already enter every prompt regardless of sentence length (`prompt-builder.ts` ~L451-469), so topic anchoring on complete sentences is unmeasured today (C).
- Polish prompt supports `<context>` but `TurnPolishInput` carries none (C, E).
- Shadow mode first (write the state and log it, do not inject) and `stream_options.include_usage` for token logging (A).
- Inject a term only when its source side appears verbatim in the current transcript (D).

Verifier confidence: high on source-level verdicts, low on every cost projection (11–13 prod turns).

ultra: picked=5/5 margin=low unanimous=no rejected_all=no
