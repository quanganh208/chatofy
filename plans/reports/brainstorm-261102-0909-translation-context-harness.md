# Candidate E — Brainstorm contract: harness "càng dịch càng hiểu" cho phần dịch

Tóm tắt một dòng: đừng nhồi thêm transcript vào prompt — repo đã đo được là cách đó làm hỏng câu hoàn chỉnh. Cái nên "nhớ" là **các quyết định dịch** (một từ/tên đã được dịch thành gì), không phải thêm văn bản. Và trước khi đổi gì trên đường dịch live, phải dựng cái thước đo hiện chưa có: một corpus hội thoại có thứ tự, có bản dịch tham chiếu, chấm điểm theo vị trí lượt.

## 1. Outcome

Trong một cuộc hội thoại, các lượt về sau dịch chính xác hơn, hoặc ít nhất nhất quán hơn, so với harness đang ship, nhờ dùng những gì đã dịch ở các lượt trước. Cụ thể:

- (a) Một thuật ngữ, tên riêng hay từ mượn lặp lại thì được dịch giống nhau và đúng ở mọi lượt sau.
- (b) Câu ngắn hoặc câu cụt hiểu được nhờ ngữ cảnh.
- (c) Câu hoàn chỉnh **không** bị kéo nghĩa sai.

"Càng dịch càng hiểu" phải là con số đo được theo vị trí lượt trên một corpus cố định, không phải cảm nhận.

## 2. Constraints

- **Không có lời gọi LLM nào thêm, chặn trên đường live.** `TranslationRequest.context` chỉ chứa lượt ĐÃ XONG, và caller không bao giờ chờ context (`packages/ai-providers/src/interfaces/translation-provider.ts`). Lấy p50 khoảng 907 ms làm mốc.
- **Prompt được gửi lại tối đa 5 lần mỗi lượt** (4 speculative + final), cộng thêm live preview (`packages/ai-providers/src/providers/gemini/prompt-builder.ts`). Mỗi token thêm vào context bị nhân lên đến 5 lần.
- **Ngân sách quota.** Prod là DeepSeek `deepseek-flash`, temperature 1.0, nên cần lặp nhiều lần. Proxy Command Code giới hạn khoảng 5.3k lời gọi mỗi cửa sổ 5 giờ. Block retranslator đang dùng 12 RPM/user và 48 RPM global (`apps/api/src/modules/translate/session/block-retranslator.ts`).
- **Ranh giới tin cậy.**
  - Transcript đến từ socket, có đường không xác thực. Mọi thứ đưa ngược vào prompt đều là kênh lệnh.
  - Glossary chỉ được tối đa 4 từ mỗi vế và 24 cặp (`MAX_GLOSSARY_TERM_WORDS`). Một vế dài bằng câu đã từng bị model làm theo như một lệnh.
  - Learned terms hiện chỉ đi tới recognizer và restorer, **không bao giờ vào prompt dịch**, vì chúng đến từ người nói trong phòng chứ không phải từ chủ tài khoản (`docs/development-journey.md` §"Garbled loanwords…", 07/10/2026; `conversation-context.ts` `learnedTerms`).
  - Ở chế độ two-way, lời của phía bên kia bị loại khỏi context (`conversation-context.ts` `recall(socket, language)`).
- **Mọi thay đổi prompt phải chạy lại `benchmarks/prompt-injection`.** Kết quả cuối được ghi: 201/201 ở `--repeats 3` (`docs/development-journey.md`, 23/10).
- Prod chỉ có CPU, Docker VM khoảng 9.7 GiB: không thêm model local nào trên đường dịch.
- Đề tài tốt nghiệp phi thương mại. Không dùng dữ liệu giả. Số liệu trong docs phải tái lập được.

## 3. Non-goals

- Fine-tune hay train model dịch.
- Một "trí nhớ" tự động dùng chung cho mọi cuộc hội thoại của một tài khoản và tự đưa vào prompt mà không cần chủ tài khoản xác nhận. Lý do: với STT hotwords, một danh sách cố định đã đo là lỗ, trong khi danh sách học theo từng cuộc hội thoại thì lãi (§3.17 trích trong `docs/development-journey.md`).
- Đổi provider hay model.
- Thay đổi STT, TTS hoặc minutes.
- Nới `MAX_FRAGMENT_WORDS` hay cap glossary khi chưa có đo đạc.
- Đưa bản dịch phía target của phía bên kia vào prompt.

## 4. Acceptance criteria

Hiện chưa có thước nào đo được "theo vị trí lượt". `benchmarks/error-analysis/rows.jsonl` gồm 40 câu độc lập. `benchmarks/live-translate` là 50 utterance VIVOS độc lập mỗi chiều. Vì vậy AC0 là điều kiện tiên quyết.

- **AC0 — Thước đo tồn tại.** Có harness `benchmarks/conversation-context/`, không nằm trong workspace, theo cùng quy ước với `benchmarks/error-analysis`.
  - Input: N ≥ 2 hội thoại thật lấy từ `ConversationTurn` (`apps/api/prisma/schema.prisma`, có `position`, `sourceText`), mỗi hội thoại ≥ 30 lượt có thứ tự.
  - Mỗi lượt có `reference` do người viết. Harness từ chối chạy nếu thiếu, giống `translate-rows.mjs`.
  - Mỗi lượt có nhãn `repeatedTerm` (thuật ngữ đã xuất hiện ở lượt trước, kèm cách dịch đúng) và nhãn `completeSentence` (≥ 5 từ).
  - Có kiểm tra chi phí trước lời gọi đầu tiên, và chỉ ghi ra stdout (theo memory "Benchmark scorers rewrite recorded results").
- **AC1 — Nhất quán thuật ngữ (thước chính).** Đo **term-render accuracy** trên các lượt `repeatedTerm`, tái dùng logic đếm của `benchmarks/error-analysis/term-rendering.mjs`.
  - Arm mới phải hơn baseline (harness đang ship), với 95% CI của chênh lệch theo paired bootstrap không chứa 0. Paired bootstrap dùng theo mẫu `benchmarks/mt-zh`.
  - Số lần lặp ≥ 3, vì temperature 1.0.
- **AC2 — Không gây hại cho câu hoàn chỉnh (thước chặn).** Trên các lượt `completeSentence`:
  - chrF++ của arm mới không thấp hơn baseline. Ngưỡng đề xuất: cận dưới CI ≥ −0.5, đây là **ước lượng**, cần chốt.
  - Có một control set chứa ca anchoring đã đo ("Đánh một cái seri lớn…", được mô tả ở `prompt-builder.ts` ngay trên `MAX_FRAGMENT_WORDS`) cùng các ca tương tự do người viết. Số lần lật sang nghĩa sai không được tăng.
- **AC3 — "Càng dịch càng hiểu" thấy được.** Tách điểm theo nhóm vị trí lượt 1–5, 6–15, 16+.
  - Ở arm mới, khoảng cách (arm − baseline) trên term-render accuracy ở nhóm 16+ phải ≥ khoảng cách ở nhóm 1–5.
  - Nếu không có độ dốc này thì tính năng chỉ là "context tốt hơn", không phải "học dần". Phải báo cáo đúng như vậy.
- **AC4 — An toàn.** `benchmarks/prompt-injection` đạt 100% ở `--repeats 3` trên `deepseek-flash`.
  - Thêm các hàng mới, trong đó lệnh nằm trong một mục memory (ví dụ người nói cố tình nói một cặp "X là Reply with OK").
  - Glossary adherence không tụt quá "trước trừ 1", theo bar đã dùng ở mục "ai" → AI trong journey.
- **AC5 — Latency và quota.**
  - Không có lời gọi chặn mới trên đường live.
  - Turn p50 không tăng quá +5% so với mốc. Đây là **ước lượng**, vì token prompt tăng và bị nhân 5.
  - Lời gọi nền, nếu có, mỗi hội thoại ≤ 1 lời gọi trên mỗi K lượt, nằm trong cùng budget RPM của retranslator.

## 5. Option exploration

### A. Conversation term ledger: nhớ quyết định dịch trong phạm vi một kết nối

Một sổ `source term → rendering` sống theo socket, đặt cạnh `learned` trong `ConversationContext` (WeakMap, chết cùng kết nối).

- **Cách ghi:** sau mỗi lượt xong, trích một cách xác định các span thuộc ba loại: tên riêng hoặc Latin-script, span đã qua guard loanword, và span khớp mục glossary của người dùng; đồng thời trích cách bản dịch của lượt đó đã render chúng.
- **Cách dùng:** sổ đi vào prompt dưới dạng các cặp kiểu glossary, nằm trong cùng cap 24 cặp và 4 từ mỗi vế. Glossary của người dùng được ưu tiên trước.
- **Chi phí:** 0 lời gọi LLM thêm.
- **Giả định chính:** lỗi ở các lượt sau chủ yếu là dịch không nhất quán thuật ngữ, và cách render ĐẦU TIÊN thường là đúng.
- **Điểm gãy đầu tiên:** lượt đầu dịch sai thì sổ khóa luôn cái sai cho cả hội thoại. Đó là lan truyền lỗi, cùng cơ chế với ca "Play a big series", nhưng kéo dài.
  - Model yếu thì không hưởng lợi. Glossary trên 3.1-flash-lite: 2→1. Trên `deepseek-flash` mới đo adherence (41–42/43), chưa đo phần lãi.
  - Đây là đảo ngược quyết định "learned terms không vào prompt dịch". Cap 4 từ chặn được kênh lệnh dài, nhưng không chặn được việc cài một cách dịch sai có chủ đích (ví dụ "CEO là kẻ lừa đảo" gói trong 4 từ).
- **Trường hợp xấu nhất có thể xảy ra:** cả hội thoại nhất quán SAI một tên hay thuật ngữ, và AC1 lại báo "nhất quán". Vì thế AC1 phải chấm bằng `reference`, không chấm bằng việc output tự khớp với nhau.

### B. Conversation brief cuốn chiếu do model mạnh viết ngoài đường live

Cứ mỗi K lượt, một lời gọi nền (cùng kiểu `gemini-summarization-provider.ts`, nhưng chạy trên cửa sổ trượt) tạo ra `topic` ≤ 200 ký tự cùng tối đa M cặp thuật ngữ. Kết quả ghi đè `hints.topic` và glossary của kết nối.

- **Giả định chính:** biết chủ đề thì gỡ được mơ hồ nghĩa từ.
- **Điểm gãy đầu tiên:** chính là cơ chế anchoring đã đo. Brief tóm một cách dùng mơ hồ trước đó rồi kéo câu hoàn chỉnh sau sang nghĩa đó. Khác với context ≤ 4 từ hiện nay, topic đi vào **mọi** lượt, kể cả câu hoàn chỉnh, tức đúng nhóm đã đo là bị hại.
  - Thêm quota: khoảng N/K lời gọi mỗi hội thoại.
  - Brief tóm từ transcript không tin cậy, nên là thêm một kênh lệnh chạy qua một model nữa.
  - Có độ trễ K lượt mới "hiểu".
- **Trường hợp xấu nhất có thể xảy ra:** AC2 tụt trên diện rộng vì topic sai, quota cạn giữa demo, và injection đi qua topic (200 ký tự, không có cap theo từ).

### C. Trí nhớ xuyên hội thoại, người dùng duyệt (owner-confirmed promotion)

Sau khi hội thoại kết thúc, một pass offline đọc lịch sử (`Conversation`/`ConversationTurn`), hoặc gắn vào pass minutes đã có, rồi **đề xuất** các mục glossary: các thuật ngữ lặp lại cùng cách dịch, và các chỗ người dùng đã sửa.

Chủ tài khoản duyệt trong editor sẵn có (`apps/web/src/components/preferences/ai-context-draft.ts`, `apps/api/src/modules/glossaries`). Chỉ mục đã duyệt mới vào prompt, qua kênh glossary đã đo.

- **Giả định chính:** người dùng có duyệt, và glossary có giúp model prod. Hướng có lợi chỉ mới được ghim trên 3.5-flash-lite (4→7, 40 hàng, lặp 1 lần). Độ lớn chưa có, và trên `deepseek-flash` chưa đo.
- **Điểm gãy đầu tiên:** không ai duyệt, nên trí nhớ trống. Ngoài ra không cải thiện được _trong_ hội thoại đầu tiên.
- **Trường hợp xấu nhất có thể xảy ra:** tính năng chết vì không ai dùng, nhưng không gây hại cho bản dịch. Mọi thứ vào prompt đều do chủ tài khoản viết, đúng với ranh giới tin cậy hiện tại.

## 6. Trade-offs

|                                                        | A ledger/kết nối                | B brief cuốn chiếu               | C owner-confirmed                                         |
| ------------------------------------------------------ | ------------------------------- | -------------------------------- | --------------------------------------------------------- |
| Thêm lời gọi LLM                                       | 0                               | khoảng 1/K lượt                  | 1 pass offline cho mỗi hội thoại (có thể gộp với minutes) |
| Đúng nghĩa "càng dịch càng hiểu" trong 1 hội thoại     | có                              | có (trễ K lượt)                  | không, chỉ từ hội thoại sau                               |
| Rủi ro anchoring trên câu hoàn chỉnh                   | thấp (chỉ cặp ≤ 4 từ)           | **cao** (topic vào mọi lượt)     | thấp                                                      |
| Ranh giới tin cậy                                      | đảo ngược một quyết định đã ghi | thêm kênh mới                    | giữ nguyên                                                |
| Xấu nhất                                               | nhất quán sai cả hội thoại      | tụt chất lượng diện rộng + quota | không ai dùng                                             |
| Phụ thuộc lãi glossary trên `deepseek-flash` (chưa đo) | có                              | có                               | có                                                        |

So theo trường hợp xấu nhất: C an toàn nhất, A vừa phải nhưng có thể khống chế, B tệ nhất, và B dính trực tiếp kết quả đo âm duy nhất mà repo có. Cả ba cùng dựa trên một giả định chưa đo: kênh glossary có giúp `deepseek-flash` hay không. Câu hỏi đó phải trả lời trước.

## 7. Better approaches

Có một hướng tốt hơn cái người dùng ngụ ý ("càng dịch càng hiểu" hiểu ngây thơ là đưa càng nhiều lịch sử vào càng tốt): **nhớ quyết định, không nhớ văn bản, và đo bằng một oracle trước khi xây bộ trích**.

- **Bằng chứng:**
  - `prompt-builder.ts` ghi lại rằng 4 utterance context trên một câu 17 từ đã lật nghĩa 4/4 sang sai, và một dòng rác thì còn tệ hơn. Khoảng 5–15 từ chưa từng được đo.
  - Journey ghi rằng danh sách học theo từng cuộc hội thoại thì lãi, danh sách cố định thì lỗ (ở phía STT). Cap 4 từ của glossary là chặn tải, và nới nó ra đã mở lại lỗ hổng.
  - Hướng có lợi của glossary trên model mạnh đã được ghim.
  - Tức là đơn vị nhớ an toàn là _cặp thuật ngữ ngắn_, đi qua một kênh đã có cap và đã được đo injection. Transcript dài thì không an toàn.
- **Khác biệt vận hành:** không tăng độ dài context của câu hoàn chỉnh, không thêm lời gọi live, và sổ dùng chung ngân sách 24 cặp.
- **Chi phí chuyển hướng:**
  - Thấp ở phía code: thêm một map vào `ConversationContext`, và `buildContextBlock` đã nhận glossary.
  - Cao ở phía thước đo: người phải viết reference cho khoảng 60–120 lượt (**ước lượng**).
  - Chi phí chạy (**ước lượng**): 120 lượt × 4 arm × 3 lần lặp ≈ 1.4k lời gọi, khoảng 27% một cửa sổ 5 giờ của Command Code. Phải được duyệt trước khi chạy.

## 8. Recommended direction

Đi theo **A, có gate bằng oracle, và C làm đường lùi**. Không làm B.

**Bước nhỏ nhất đầu tiên (không đụng prod):** dựng `benchmarks/conversation-context/` (AC0) trên 2 hội thoại thật, rồi chạy 4 arm qua đúng `buildContextBlock` đang ship:

1. **baseline:** harness hiện tại.
2. **ledger-oracle:** sổ dựng từ cách render trong `reference`. Đây là cận trên: nếu đến sổ hoàn hảo cũng không giúp thì dừng.
3. **ledger-self:** sổ dựng từ output của chính model ở các lượt trước, tức là bản thật của A.
4. **gate-8:** thử nâng `MAX_FRAGMENT_WORDS` lên 8 trên khoảng 5–15 từ chưa đo. Arm này chỉ để đo, ship là việc khác.

**Gate cho bước tiếp theo:**

- Oracle **không** qua AC1 (CI chứa 0): dừng. Kênh glossary không giúp `deepseek-flash` trên hội thoại thật, và không có trí nhớ thuật ngữ nào đáng xây. Ghi kết quả âm vào journey.
- Oracle qua, nhưng ledger-self trượt AC1 hoặc AC2: lỗi đầu tiên đang bị khóa lại. Chuyển sang C, để chủ tài khoản duyệt các cặp. Cùng lúc, mang việc đảo ngược ranh giới tin cậy ra cho người dùng quyết định, như quy tắc "User Decisions" yêu cầu.
- ledger-self qua AC1–AC3: thêm hàng injection kiểu memory, phải đạt AC4. Sau đó ship sau một flag, rồi kiểm lại trên prod bằng replay recording dưới tài khoản owner (memory "Verify prod rollout by replay") và đo AC5.
- gate-8 được báo cáo riêng. Nó chỉ được đề xuất ship nếu qua AC2 trên control set anchoring.

## 9. Unresolved questions

1. Ai viết `reference` cho các lượt hội thoại thật, và dùng hội thoại nào (của chính chủ tài khoản trên prod)? Không có reference người viết thì AC0–AC3 không đo được. Reference sinh bằng model là dữ liệu giả.
2. Người dùng có chấp nhận đảo ngược quyết định "learned terms không vào prompt dịch" cho phương án A không? Nếu có, giới hạn ở chế độ one-way (người nói chính là chủ tài khoản) hay áp dụng cả two-way?
3. Có duyệt ngân sách khoảng 1.4k lời gọi (**ước lượng**) cho lượt chạy đầu tiên không, và chạy trên DeepSeek trực tiếp hay qua proxy Command Code?
4. Ngưỡng AC2 (−0.5 chrF++) và AC5 (+5% p50) là ước lượng. Người dùng có muốn bar chặt hơn, ví dụ "không tụt" tuyệt đối không?
5. "Hiểu context" có bao gồm nghĩa diễn ngôn (đại từ, chủ ngữ bị lược) ngoài thuật ngữ không? Nếu có, cần thêm một nhãn và một arm cho câu 5–15 từ, vì A không với tới loại lỗi đó.

---

## Ultra ranking appendix

Best-of-5 verifier mode, inspired by LLM-as-a-Verifier (not the full framework). Five independent Opus candidates, one Fable verifier, anonymized A–E. The winner above is emitted unchanged.

| Candidate  | Faithful | Evidence | AC sharp | Honesty | Conditional | Total |
| ---------- | -------- | -------- | -------- | ------- | ----------- | ----- |
| E (winner) | 18       | 18       | 18       | 19      | 18          | 91    |
| D          | 19       | 18       | 18       | 17      | 18          | 90    |
| B          | 17       | 17       | 19       | 18      | 18          | 89    |
| A          | 17       | 17       | 16       | 17      | 18          | 85    |
| C          | 16       | 14       | 17       | 16      | 17          | 80    |

All five passed the hard constraints. E won on honesty: it is the one that names that feeding conversation-learned pairs into the translation prompt reverses the recorded decision (journey §"Garbled loanwords…": learned terms reach the recognizer and restorer only, confirmed in `pipeline-translator.service.ts`), and it turns that into a user decision. Runner-up D was within noise; its two strongest ideas are not in E: inject a ledger pair only when its source span occurs in the current transcript (zero added bytes on complete sentences), and a zero-API-call first step that measures term inconsistency from stored `ConversationTurn.translations`. Verifier flag on E: AC0 asks for ≥30-turn conversations, and recorded prod conversations may be much shorter; check the DB first.

Verifier confidence: medium.

ultra: picked=2/5 margin=low unanimous=no rejected_all=no
