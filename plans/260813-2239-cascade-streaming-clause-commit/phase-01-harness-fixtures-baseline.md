---
phase: 1
title: 'Dụng cụ đo, fixture, và đường nền'
status: pending
priority: P1
effort: '3d'
dependencies: []
---

# Phase 1: Dụng cụ đo, fixture, và đường nền

## Overview

Dựng dụng cụ đo **trước** khi sửa pipeline, và đo chính đường hiện tại bằng dụng
cụ đó để có đường nền phải vượt qua.

Phase này cũng trả lời câu hỏi chốt hằng số cho phase 3: **ngưỡng agreement mỗi
ngôn ngữ là bao nhiêu** trên giọng người thật, chứ không phải trên giọng TTS sạch.

Không có phase này thì "mượt hơn" là cảm nhận, không phải kết luận.

## Requirements

- Functional: sinh được ma trận fixture đủ 5 hình dạng; đo được 5 chỉ số mới;
  in ra đường nền của cascade hiện tại.
- Non-functional: mọi số tái lập bằng lệnh đã commit (`development-journey.md`
  mục 12). Script thuần Node, không thêm dependency — theo đúng thông lệ đang có
  ở `benchmarks/realtime/`.

## Architecture

**Đường nền đo được ngay hôm nay, không cần code mới.** `clientTurnMetricsSchema`
đã có `speechStartedAt` và `firstAudioPlayedAt`
(`packages/types/src/events/ws-events.ts:118,126`). Hiệu hai trường đó **chính
là** "từ đầu tiên → tiếng dịch đầu tiên". Chỉ số chính của cả plan tính được từ
JSONL đang có. Phase này chỉ thêm cách đọc và cách vẽ nó.

**Năm chỉ số mới**, thêm vào `analyze-continuous.mjs`:

1. **Độ trễ tới commit đầu — vẽ theo độ dài đoạn nói.** Trục y là
   `firstAudioPlayedAt − speechStartedAt` của **lượt đầu tiên trong đoạn**.

   Trục x **phải là độ dài đoạn nói trong fixture, lấy từ `vad-reference.mjs`** —
   **không** phải `speechEndedAt − speechStartedAt`. Lý do quan trọng và suýt làm
   hỏng cả phép đo: `MAX_UTTERANCE_MS = 8000` cắt mọi lượt ở 8s, nên hiệu hai mốc
   kia **không bao giờ vượt 8s**. Lấy nó làm trục x thì một đoạn độc thoại 40s ra
   năm điểm chụm ở x≈8s, và "độ dốc" tính trên đó là nhiễu chứ không phải kết
   luận.

   **Đường nền kỳ vọng là chững, không phải dốc.** Mọi đoạn dài hơn 8s hôm nay
   đều cho ~9,2s (8s cắt + 1163ms p50). Nên cái phải phá là **hằng số chặn**, và
   bảng kết quả phải in cả hằng số chặn lẫn độ dốc. Nếu đường nền chạy ra dốc ≈ 1
   thì **giả định về đường cắt đã sai** — dừng lại và đọc lại
   `conversation-session.ts:332-342` trước khi đi tiếp, đừng ghi nhận số đó.

2. **Độ trễ theo vế:** vế nguồn kết thúc (theo mốc thời gian audio gốc) → audio
   dịch của vế đó bắt đầu. p50/p95 + độ dốc trôi qua 3 phút.
3. **Lỗ liên tục:** đếm và tổng thời lượng khoảng im lặng trong dòng ra **trong
   lúc còn text đã commit chưa phát hết**. Đây là chỉ số bắt đuôi MT làm nghẹn.
4. **Vế bị lật:** đếm lần một prefix đã commit bị bản decode sau mâu thuẫn. Theo
   thiết kế phải bằng 0; đo để chứng minh, không để khẳng định.
5. **Khoảng cách dài nhất giữa hai lần commit trong lúc vẫn còn speech.** Bắt ca
   "commit chết đói": agreement không ổn định được nên **không commit gì**, và ca
   đó lọt qua cả ba chỉ số trên — không lật, không lỗ, p50 không đổi — trong khi
   người nghe thấy chức năng chết giữa câu.

**Dò độ ổn định prefix** (`prefix-stability.mjs`): tổng quát hoá script đã dùng ở
brainstorm — chạy theo ngôn ngữ, quét ngưỡng agreement 2/3/4, so sánh trên token
**đã chuẩn hoá**, in số lần lật cho từng ngưỡng. Đầu ra của nó là hằng số
`AGREEMENT_DEPTH` mà phase 3 nạp vào.

**Fixture — hai nguồn, hai câu hỏi khác nhau.** ElevenLabs **hợp lệ** cho tính
đúng của chính sách commit, độ trễ, quota, cấu trúc khoảng nghỉ: điều khiển được
chính xác thời điểm, và **độc lập hơn** fixture hiện tại, vốn được
`generate-fixtures.mjs` sinh từ chính TTS sidecar của mình — tự mình chấm mình,
đằng nào cũng nên bỏ. ElevenLabs **làm đẹp số** ở: độ bền VAD, WER, ậm ừ, vọng
âm — giọng tổng hợp không có tiếng phòng, không có ngập ngừng dính âm. Những cái
đó cần giọng người thật, và ở đây lấy từ **dataset công khai**.

### Dataset thay cho bản tự thu

Dataset còn hơn bản tự thu ở một điểm: nó có **transcript tham chiếu**, nên đo
được cả WER lẫn độ lệch dịch — thứ bản tự thu không cho.

| Chân                      | Nguồn                       | Giấy phép                         | Vì sao chọn                                                                                                                             |
| ------------------------- | --------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Họp thật, tiếng Anh, dài  | **AMI Meeting Corpus**      | CC BY 4.0                         | Bản ghi **nguyên cuộc họp, không cắt khúc**; có cả headset lẫn mic mảng xa; chú giải từ có mốc thời gian. Đúng y kịch bản của extension |
| Ậm ừ tiếng Việt           | **Bud500** (subset podcast) | CC-BY-NC-SA 4.0, cần đăng nhập HF | Podcast là chỗ hiếm hoi có ngập ngừng thật; streaming được nên không phải tải 98GB                                                      |
| Nhịp nghỉ điều khiển được | ElevenLabs                  | —                                 | Kịch bản hoá được cả ậm ừ lẫn độ dài nghỉ, và có cả vi lẫn en                                                                           |

**Chú ý giấy phép:** trang OpenSLR/16 ghi AMI là CC BY-NC-SA 2.0 — **đó là bản
cũ**. Trang chính thức của corpus ghi CC BY 4.0. Lấy theo trang chính thức và
trích dẫn nó, đừng trích OpenSLR.

### Điều dataset tiếng Việt **không** cho, và phải nói thẳng

Không có dataset tiếng Việt công khai nào cho **hội thoại tự nhiên, có ngập
ngừng, dài, kèm transcript, giấy phép dùng được**. Khảo sát 2026 xếp một loạt bộ
vào nhóm "spontaneous", nhưng đọc kỹ thì:

- **mọi bộ tiếng Việt đều đã cắt thành câu ngắn** (LSVSC 0,45–13s; VSV-1100 3–43
  từ; Bud500 6–32 từ) → **không có dạng dài liên tục**;
- LSVSC tuy giấy phép đẹp nhất (CC BY 4.0, không cần đăng nhập) nhưng nhãn chủ đề
  là _audiobook / news_ — **đọc diễn cảm, không phải nói tự nhiên**, nên gần như
  không có ậm ừ;
- VietMed-L là hội thoại bác sĩ–bệnh nhân thật (CC BY 4.0) nhưng **8kHz điện
  thoại**, sẽ kéo chất lượng STT xuống và làm sai lệch phép đo.

Nên chiều tiếng Việt xử lý bằng hai bước, và ghi rõ là hàng thay thế:

1. **Chọn clip theo transcript**, không chọn bằng tay: grep transcript tìm token
   ngập ngừng (`ừ`, `à`, `ờ`, `ừm`, `kiểu`, `thì`…). Bước này **tự kiểm chứng**:
   không grep ra clip nào nghĩa là bộ đó xác nhận không dùng được cho chân này, và
   ghi lại kết luận đó thay vì lặng lẽ đổi bộ khác.
2. **Ghép clip cùng người nói** thành đoạn dài, chèn khoảng lặng có độ dài định
   trước. Được: dạng dài + ground truth chính xác + nhịp nghỉ điều khiển được.
   Mất: mối ghép không phải động lực hội thoại thật. **Ghi hạn chế này vào
   report**, đừng để người đọc sau tưởng đó là hội thoại liên tục thật.

Năm hình dạng fixture:

| Hình dạng                   | Bắt lỗi gì                                                                 |
| --------------------------- | -------------------------------------------------------------------------- |
| Độc thoại 30–60s không nghỉ | Cắt cứng 8s + trôi tích luỹ                                                |
| Nghỉ giữa câu 300–800ms     | Nằm giữa `PROBABLE_END_MS` (150) và hangover (500) — kẻ giết ranh giới giả |
| Ậm ừ, nói lại từ đầu        | Prefix nhảy; đây là ca người dùng nêu đích danh                            |
| Đối đáp ngắn liên tục       | Trần đồng thời, thứ tự phát                                                |
| Nền ồn đổi mức              | Sàn nhiễu thích nghi của gate                                              |

## Related Code Files

- Create: `benchmarks/realtime/prefix-stability.mjs`
- Create: `benchmarks/realtime/generate-elevenlabs-fixtures.mjs`
- Create: `benchmarks/realtime/fetch-dataset-fixtures.mjs` — kéo subset AMI + Bud500
  theo chỉ số cố định, grep transcript tìm token ngập ngừng, ghép clip thành đoạn dài
- Create: `benchmarks/realtime/fixtures.manifest.json` — khai báo cả fixture sinh
  lẫn fixture dataset (nguồn, chỉ số mẫu, ngôn ngữ, hình dạng, thời lượng speech
  tham chiếu, transcript tham chiếu, giấy phép + dòng trích dẫn)
- Modify: `benchmarks/realtime/analyze-continuous.mjs` — thêm 5 chỉ số
- Modify: `benchmarks/realtime/README.md` — ghi rõ ranh giới ElevenLabs hợp lệ / làm đẹp số
- Create: `plans/reports/measure-{date}-cascade-baseline.md`

## Implementation Steps

1. Đưa `prefix-stability.mjs` vào repo: tham số ngôn ngữ, quét ngưỡng 2/3/4,
   chuẩn hoá token trước khi so (số → chữ, hạ hoa thường, bỏ dấu câu). In số lần
   lật cho từng ngưỡng.
2. Viết `generate-elevenlabs-fixtures.mjs` cho 5 hình dạng, cả vi lẫn en. Đọc key
   từ env, **không commit key**. Ghi manifest kèm hash để phát hiện fixture đổi.
3. Viết `fetch-dataset-fixtures.mjs`: kéo AMI (một cuộc họp nguyên bản, mic
   headset + mic mảng xa) và Bud500 (streaming, subset podcast). Chọn clip tiếng
   Việt **bằng grep token ngập ngừng trên transcript**, không chọn bằng tay. Ghép
   clip cùng người nói thành đoạn dài với khoảng lặng định trước. Ghi mọi lựa
   chọn vào manifest kèm chỉ số mẫu để lần sau ra đúng bộ đó.
   **Không commit file audio** — theo thông lệ hiện có ("nothing is committed
   except the scripts"). Ghi giấy phép + dòng trích dẫn cho từng nguồn; AMI là
   CC BY 4.0 nên **bắt buộc ghi công**.
   Nếu bước grep không ra clip nào: ghi kết luận "Bud500 không dùng được cho chân
   ậm ừ" vào report và chuyển chân đó sang ElevenLabs có kịch bản ngập ngừng —
   **không** lặng lẽ đổi sang bộ khác rồi coi như không có chuyện gì.
4. Chạy `vad-reference.mjs` lấy mẫu số coverage cho từng fixture.
5. Chạy `prefix-stability.mjs` trên **cả** fixture ElevenLabs lẫn fixture dataset, cả
   hai ngôn ngữ. Chốt `AGREEMENT_DEPTH` mỗi ngôn ngữ = ngưỡng nông nhất cho 0 lần
   lật **trên fixture dataset**.
   5b. **Dò xem Gemini có chịu nói tiếp mà không viết lại không** — ~10 request, một
   script ngắn, chạy **ở đây** chứ không đợi phase 4. Đây là giả định rủi ro nhất
   của phase 4 mà chưa ai đo, và nó đo được trước khi có một dòng code session
   nào. Nếu model cứ viết lại phần đã "phát", phương án prompt phải đổi trước khi
   phase 4 bắt đầu chứ không phải sau.
6. Thêm 5 chỉ số vào `analyze-continuous.mjs`.
7. Chạy cascade **hiện tại** trên ma trận, thu JSONL, in đường nền. Đo req/phút
   ngay lần chạy đầu để biết còn bao nhiêu lần chạy trong ngày.
8. Viết report kèm **điều kiện đo**: máy, thiết bị ra, âm lượng, fixture nào,
   ngày, số lượt fail vì quota.

## Success Criteria

- [ ] `prefix-stability.mjs` chạy được cả vi và en, in số lần lật theo từng ngưỡng
- [ ] `AGREEMENT_DEPTH` mỗi ngôn ngữ chốt **từ giọng người thật trong dataset**,
      không phải từ giọng TTS
- [ ] 5 hình dạng fixture sinh lại được bằng một lệnh, gồm cả bước kéo dataset
- [ ] Manifest ghi đủ giấy phép + dòng trích dẫn cho từng nguồn dataset
- [ ] Kết luận rõ ràng cho chân "ậm ừ tiếng Việt": grep ra được hay không, và nếu
      không thì report nói thẳng đó là hàng thay thế bằng ElevenLabs có kịch bản
- [ ] `analyze-continuous.mjs` in đủ 5 chỉ số mới; hai bẫy coverage trong README cũ vẫn được giữ
- [ ] Đường nền của cascade hiện tại có số, gồm **hằng số chặn và độ dốc** theo
      độ dài đoạn nói lấy từ `vad-reference.mjs` (kỳ vọng: chững ~9,2s — hằng số
      chặn mới là con số phải phá, không phải độ dốc)
- [ ] Có kết quả dò Gemini nói-tiếp-không-viết-lại, trước khi phase 4 bắt đầu
- [ ] Report ghi đủ điều kiện đo và số lượt fail vì quota
- [ ] Không commit key ElevenLabs, không commit file audio

## Risk Assessment

- **Quota ElevenLabs và quota Gemini là hai thứ khác nhau.** Sinh fixture tốn
  ElevenLabs; chạy đường nền tốn Gemini. Sinh fixture trước, một lần, tái dùng.
- **Chiều tiếng Việt là chân yếu nhất của cả ma trận.** Không có dataset công
  khai nào cho hội thoại tiếng Việt tự nhiên, dài, có ngập ngừng, kèm transcript.
  Đoạn dài tiếng Việt là **ghép nhân tạo**, không phải hội thoại thật. Hệ quả:
  ngưỡng agreement tiếng Việt chốt trên bằng chứng yếu hơn tiếng Anh. Ghi vào
  report; đừng trình bày như thể hai chiều được kiểm chứng ngang nhau.
- **Bud500 cần đăng nhập HF** và 98GB nếu tải hết. Bắt buộc dùng chế độ streaming
  và chỉ lấy đúng số mẫu cần.
- **Rủi ro dựa trên giả định:** nếu ngưỡng agreement trên fixture dataset phải sâu tới
  mức 4+ thì độ trễ cộng thêm ~600ms và sàn ~1.9s không giữ được. **Tín hiệu:**
  bước 5 cho lật > 0 ở cả ngưỡng 3. **Phản ứng đã định:** dừng, báo người dùng,
  cân nhắc phương án B trong brainstorm trước khi làm phase 3–5.
- **Rollback:** phase này chỉ thêm script và report, không đụng đường chạy. Xoá
  là xong. Quota đã tiêu thì không lấy lại được.
