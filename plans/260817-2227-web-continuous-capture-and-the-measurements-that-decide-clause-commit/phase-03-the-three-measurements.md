---
title: 'Phase 3: Ba phép đo và cổng quyết định'
status: done
phase: 3
priority: P1
effort: '2d'
dependencies: [2]
---

# Phase 3: Ba phép đo và cổng quyết định

## Overview

Ba phép đo, mỗi cái trả lời đúng một câu hỏi mà A-lite đang phụ thuộc vào. Kết thúc
phase này là một **cổng quyết định** trả lời bằng số: làm A-lite, hay dừng ở Phase 2.

## Requirements

- Functional: ba phép đo chạy được, có số, ghi vào `docs/development-journey.md`.
- Non-functional: mỗi phép đo phải tái lập được bằng lệnh ghi trong mục 12 của
  journey doc; ghi đủ điều kiện đo, thiếu điều kiện thì lần sau không so được.

## (a) Phép đo vọng âm — 40 lượt, theo đúng §10.1

Quy trình đã thiết kế sẵn ở `docs/development-journey.md` §10.1, chưa từng chạy. Nó
là **món nợ kỹ thuật mở duy nhất** của dự án.

- 20 lượt **half-duplex làm đối chứng trước**, rồi 20 lượt `fullDuplex: true`. Câu
  khác nhau giữa các lượt (tự kích hoạt phụ thuộc nội dung phát).
- Đếm bằng **số lần `SpeechGate.onSpeechStart` bắn trong lúc loa đang phát** — sau
  Phase 1 thì `echoGate` đã chạy được ở chế độ continuous, nên đếm được ngay trong
  pump, không cần mở session. **Đạt = 0/20.**
- Ghi kèm số `session_busy` quan sát được: guard phía server tạo ra 0/20 **giả** và
  không liên quan gì tới khử vọng âm.
- Ghi **điều kiện đo**: âm lượng loa, khoảng cách mic–loa, thiết bị. Thiếu là lần sau
  không so sánh được.
- **Đọc kết quả một chiều**: rig i7 (loa rời + mic desktop, chỉ AEC phần mềm) là
  trường hợp khó nhất. Đạt ở đây → chắc chắn đạt trên điện thoại. **Trượt ở đây →
  chưa kết luận được gì**, không được dùng làm căn cứ đóng hướng full-duplex.

Kết quả đạt là điều kiện duy nhất để cấp phép cờ full-duplex đã tạo ở Phase 1.

## (b) Histogram độ dài lượt thật

Câu hỏi: **phân bố độ dài lượt thật ra sao?** Từ đó suy ra `t_commit` và số giây chờ
cắt được mỗi lượt — đại lượng quyết định A-lite có đáng làm không (xem "Ngưỡng quyết
định" bên dưới; **không** đếm đầu lượt qua một vạch 5 s).

- Nguồn: JSONL của `TURN_METRICS_PATH`. Dòng client đã mang `speechStartedAt` và
  `speechEndedAt` (`client.turn.metrics`), nên độ dài lượt tính được ngay, không cần
  thêm trường nào.
- `benchmarks/realtime/analyze-continuous.mjs` hiện in coverage / drift / req-mỗi-model
  nhưng **không** in phân bố độ dài lượt. Thêm một mục histogram vào chính script đó
  (bin 0–2, 2–3, 3–5, 5–7, 7–10, >10 s), không viết script mới.
- Mẫu phải là **hội thoại thật**, không phải fixture: băng độ dài của fixture đã biết
  trước (3–5 / 5–7 / 7–10 s trong `data/manifest.json`), nên lấy fixture làm mẫu số ở
  đây là đo lại chính thiết kế fixture.

**Ngưỡng quyết định — không đếm đầu lượt.** "% lượt vượt 5 s" là đếm theo một vạch
5 s mà chính plan này thừa nhận là đặt tạm. Đại lượng thật sự quyết định là **số giây
chờ của người nghe cắt được mỗi lượt**:

```
saving = mean over turns of max(0, L − t_commit)
```

trong đó `L` là độ dài lượt và `t_commit` là mốc commit đầu tiên. Cùng histogram này
**đặt ra** `t_commit` thay vì giả định nó. Neo vào số đã có: cascade p50 +2753 ms
(vi→en) / +3012 ms (en→vi), và bảng theo băng trong
`benchmarks/live-translate/results/2026-08-07T10-27-54-064Z/latency-table.txt`.

- **≥1,5 s** tiết kiệm kỳ vọng mỗi lượt (≈ nửa khoảng cách đã đo) → A-lite có cơ sở
- **<0,5 s** → dừng ở Phase 2, bảo vệ chẩn đoán §6.1 bằng chính histogram này
- khoảng giữa → quyết cùng user

Báo cáo phải ghi **n** và **trần `maxUtteranceMs`** đã chốt ở Phase 2 — trần đó
right-censor phân bố, nên bỏ qua nó là báo cáo một phân bố của chính cấu hình.

## (c) Adequacy: dịch từng-khúc-có-ngữ-cảnh vs cả-câu

Câu hỏi: commit sớm làm chất lượng tụt bao nhiêu — đặc biệt với **tiểu từ cuối câu
tiếng Việt** ("không / chưa / à / nhé / hả"), thứ mà transcript vi không có dấu câu
khiến nó thành tín hiệu phân cực duy nhất Gemini nhận được.

- Đây là thí nghiệm **thuần văn bản**, không cần audio và không cần ASR judge:
  `score-adequacy.py` (ASR-then-metric) là để so hai _arm nói ra tiếng_; ở đây cả hai
  nhánh đều là text nên dùng nó là sai công cụ.
- Dữ liệu đã có: `benchmarks/live-translate/data/manifest.json` — 100 utterance, mỗi
  cái có `transcript` và `referenceTranslation`.
- **Cắt theo dấu câu không chỉ là xấp xỉ — nó mù đúng với giả thuyết cần kiểm.**
  Tiểu từ cuối câu tiếng Việt nằm **ngay trước** dấu câu, nên một nhát cắt tại dấu
  câu **không bao giờ** tách được tiểu từ khỏi mệnh đề của nó: chế độ hỏng mà (c) sinh
  ra để định giá **không thể xuất hiện** trong dữ liệu. Tệ hơn, thiên lệch chỉ về phía
  "commit sớm rẻ thôi" — đúng hướng gây thiệt nếu sai.
- Cách làm: **hai hàm cắt trong cùng một script, báo cáo một khoảng**:
  - _cận lạc quan_: cắt tại ranh giới dấu câu/mệnh đề;
  - _cận bi quan_: cắt theo tỉ lệ thời lượng nói (~3 s), **snap về ranh giới từ**, cố
    ý rơi giữa mệnh đề.
    `vad-reference.mjs` cho **mốc thời gian** cắt thật, nhưng ánh xạ mốc đó về vị trí
    trong transcript cần alignment mà dự án chưa có — nên nhát cắt theo tỉ lệ là vật
    thay thế rẻ và thành thật.
- Mỗi nhánh: dịch từng khúc **có mang ngữ cảnh** (source + target của khúc trước) rồi
  ghép, so với dịch cả câu một lần. Chấm bằng COMET, hoặc A/B người nghe **chỉ trên
  các cặp bất đồng**.
- **Bắt buộc công bố**: `referenceProvenance.post_edited: false` — đây là
  pseudo-reference chưa post-edit.

Sản phẩm phụ có giá trị cho luận văn: một bảng "chi phí adequacy của việc commit
sớm", trả lời thẳng câu hỏi hiển nhiên của hội đồng.

## Related Code Files

- Modify: `benchmarks/realtime/analyze-continuous.mjs` — thêm histogram độ dài lượt
- Create: `benchmarks/live-translate/segment-vs-whole.mjs` (hoặc `.py` cạnh
  `score-adequacy.py` nếu chấm bằng COMET trong Python) — thí nghiệm (c)
- Modify: `docs/development-journey.md` — §10.1 chuyển từ "chưa chạy" sang có kết
  quả; thêm mục cho (b) và (c)
- ~~Modify: `apps/web/src/config/*` — cấp phép cờ full-duplex **chỉ khi** (a) đạt 0/20~~
  → **19/08: cờ bỏ hẳn.** Kiểm chứng trên MacBook demo (loa không bao giờ đè vào mic
  đang thu) cấp phép thẳng: `fullDuplex: true` trong hook, `full-duplex-clearance.ts`
  xoá, hai biến `NEXT_PUBLIC_*` rút khỏi `.env.example`. Xem journey §10 mục 1 cho
  phạm vi kết luận — nó là một thiết bị, không phải quy trình 40 lượt.

## Implementation Steps

1. Chạy (a) trên đúng máy demo, đúng âm lượng. Ghi bảng kết quả + điều kiện đo.
2. Thu JSONL hội thoại thật (bật `TURN_METRICS_PATH` và `reportMetrics: true`), chạy
   (b), in histogram.
3. Chạy (c), lập bảng adequacy.
4. Viết kết quả vào journey doc, kèm ghi chú `en_to_vi cascade max = 31106 ms` và
   SHA đã ghim của nhánh cascade 2026-08-07.
5. **Cổng quyết định** — trình bày cho user: histogram + bảng adequacy + kết quả
   echo, rồi hỏi. Không tự quyết. **Ba lựa chọn, không phải hai**:
   - **A-lite** đầy đủ (cắt theo mệnh đề, prefix ổn định, commit giữa câu);
   - **A-lite-zero** — hạ `maxUtteranceMs` + mang ngữ cảnh MT qua các lượt liên tiếp.
     Nhát cắt cưỡng bức **đã là** một dạng commit sớm rồi: gate arm trước trần và mua
     sẵn một speculation (`speech-gate.ts:238-248`), rồi đóng tại trần (`:181`). Cách
     này lấy được phần lớn hiệu quả của A-lite mà **không thêm máy móc nào ở client**;
   - **dừng ở Phase 2**.

## Success Criteria

### Dụng cụ (đã dựng xong)

- [x] **(a) đo được** — hai tiền đề trước đây không tồn tại: `echoHeard` được hook
      trả về nhưng **không render ở đâu cả**, và web **không gửi** client metrics.
      Đã thêm `NEXT_PUBLIC_MEASUREMENT_MODE`: hiện bộ đếm vọng âm trên màn hình và
      bật `reportMetrics`. Quy trình 40 lượt viết vào `benchmarks/realtime/README.md`
      (chỗ tracked — link cũ trỏ vào `plans/reports/...` đã chết).
      **19/08: cờ bỏ.** Bộ đếm hiện ngay khi khác 0 và ẩn ở 0 (một cờ chỉ để xem một
      số lẽ ra luôn bằng 0 là cái không ai bật đúng lúc cần); `reportMetrics` luôn
      true và `TURN_METRICS_PATH` phía server là công tắc duy nhất còn lại.
- [x] **(b) đo được** — `analyze-continuous.mjs` thêm histogram độ dài lượt và bảng
      **số giây chờ cắt được mỗi lượt** theo từng mốc commit (3/4/5/6 s). Đã kiểm
      bằng số tay trên dữ liệu dựng sẵn: commit@3s trên các lượt 1/4/4/9 s →
      2000 ms trung bình, giúp 3/4 lượt. `cutForced` báo cáo riêng như quan sát bị
      kiểm duyệt.
- [x] **(c) đo được** — `segment-vs-whole.mjs` (hai nhát cắt: dấu câu = cận lạc
      quan, tỉ lệ ~3 s snap theo từ = cận bi quan; dịch từng khúc **mang ngữ cảnh**) + `score-segments.py` (chrF++, tách theo chiều dịch). Đã chạy thử end-to-end
      trên dữ liệu giả: bracket hoạt động đúng hướng.

### Kết quả (chưa có — cần chạy thật)

- [x] **(a) đóng bằng kiểm chứng thiết bị, không bằng 40 lượt (19/08).** User kiểm
      trên MacBook demo: luồng loa không bao giờ đè vào mic đang thu. Full duplex bật
      trên web. Ghi rõ trong journey §10 mục 1 rằng đây là **một thiết bị, không có
      nhánh đối chứng, không ghi n** — không được trích như thể đã chạy quy trình.
      Quy trình 40 lượt vẫn nằm ở `benchmarks/realtime/README.md` cho thiết bị khác
      (rig i7 loa rời vẫn chưa đo → dùng tai nghe nếu bảo vệ trên máy đó).
- [x] Cờ full-duplex: **bỏ hẳn** thay vì cấp phép. Cái thay nó là bộ đếm `echoHeard`
      hiện trên màn hình ngay khi khác 0 — bằng chứng tại chỗ, không phải cờ build.
- [ ] (b) Số thật: cần một phiên hội thoại liên tục qua stack đang chạy (Postgres +
      2 sidecar + api + web) với `TURN_METRICS_PATH` đặt trên api — phía client không
      còn cờ nào phải bật. Dữ liệu JSONL hiện có trong repo là của **luồng live**,
      không có `speechStartedAt/EndedAt` ⇒ không dùng được cho histogram.
- [x] **(c) ĐÃ CHẠY (18/08)** — 12 utterance, 53 request, 12/12 ok, 0 rate limit.
      Kết quả: **−1,22 chrF++ (cắt dấu câu) … −3,46 (cắt tỉ lệ)** chung; vi→en
      thiệt nặng hơn en→vi rõ rệt (−2,38/−4,35 so với −0,28/−2,71). Bắt được ca
      phân cực tiếng Việt cụ thể ở `vi-001`. Ghi vào `docs/development-journey.md`
      §10 mục 1b. Cảnh báo: n=12, pseudo-reference chưa post-edit, chỉ đọc hiệu số.
- [x] `docs/development-journey.md` cập nhật; §10 mục 1 không còn là nợ mở — nó
      chuyển từ "chưa đo" sang "đã bật, kèm phạm vi kết luận và cái thay cho rào"
- [ ] **Cổng quyết định A-lite: vẫn mở, và mở có chủ ý.** Hai trong ba đầu vào đã
      có: (c) cho khoảng **−1,2 … −3,5 chrF++**, và khoảng cách cần đóng thì đã biết
      từ bộ số 2026-08-07. Thiếu đúng (b) — số giây chờ cắt được mỗi lượt — mà nó
      cần hội thoại thật. Không đoán thay: dụng cụ đã sẵn, chạy một phiên là trả lời
      được.

## Risk Assessment

**Rủi ro: (a) trượt và bị đọc sai thành "full-duplex bất khả thi".** §10.1 tự đặt
luật đọc một chiều. Phản ứng đã định trước: trượt → giữ `fullDuplex: false`, dùng tai
nghe cho buổi bảo vệ và nói thẳng lý do (phiên dịch song song chuyên nghiệp vốn làm
bằng tai nghe), **và** ghi rõ kết luận chỉ áp cho rig đã đo.

**Rủi ro: (b) lấy mẫu quá nhỏ nên histogram không kết luận được.** Tín hiệu: <30 lượt
thật. Phản ứng: nói rõ n và không dùng để đóng/mở A-lite, thu thêm.

**Rủi ro: (c) xấp xỉ điểm cắt bằng dấu câu lệch khỏi điểm cắt thật bằng im lặng.**
Đây là hạn chế thật của thí nghiệm text-only. Phản ứng: ghi rõ là xấp xỉ; nếu (b) nói
A-lite đáng làm thì đo lại (c) bằng điểm cắt thật từ VAD trên fixture WAV.
