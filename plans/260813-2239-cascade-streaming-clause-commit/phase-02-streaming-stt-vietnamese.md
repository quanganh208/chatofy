---
phase: 2
title: 'Đổi STT tiếng Việt sang recognizer streaming'
status: done
priority: P0
effort: '3d'
dependencies: [1]
---

# Phase 2: Đổi STT tiếng Việt sang recognizer streaming

## Vì sao phase này tồn tại

Bản đầu của plan xếp "streaming STT" vào **Non-goals**, cắt trên bằng chứng:
catalog sherpa-onnx không có Zipformer streaming tiếng Việt. Bằng chứng đó đúng
nhưng hẹp — nó chỉ nhìn một catalog. Phép đo phase 1 sau đó **giết chính giả
định nền của plan**: recognizer offline decode lại buffer đang lớn dần **không**
đơn điệu prefix (66 và 38 từ đã phát bị phủ nhận), và tăng ngưỡng agreement
không cứu được vì chỗ hỏng ở **đầu** chuỗi chứ không phải đuôi.

Spike đã chạy thật (`plans/reports/research-260813-2359-streaming-vietnamese-asr.md`)
cho thấy `nvidia/nemotron-3.5-asr-streaming-0.6b` chạy qua `parakeet.cpp` gỡ
đúng chỗ hỏng đó, vì **đơn điệu prefix ở đây là thuộc tính kiến trúc, không phải
xác suất**: decode causal theo chunk, giữ state, không bao giờ decode lại phần
audio đã xử lý.

Cái giá đã đo, không phải ước lượng: **xấu hơn 5,5 điểm WER trên lời đọc rõ
(n=50), 7–9 điểm trên lời nói tự nhiên có ngập ngừng (n=2)**. Người dùng đã chấp
nhận cái giá đó để có chức năng. Chi tiết:
`plans/reports/measure-260814-0944-stt-model-fit-this-machine.md`.

## Bằng chứng đã có, đừng đo lại

|                                   | Zipformer-30M (nay) | Nemotron streaming                                          |
| --------------------------------- | ------------------- | ----------------------------------------------------------- |
| **WER, VIVOS 50 câu**             | **5,38%**           | **10,93%**                                                  |
| WER `vlsp-vi-01` (giọng tự nhiên) | 11,7%               | 20,4%                                                       |
| WER `vlsp-vi-02` (giọng tự nhiên) | 19,3%               | 26,1%                                                       |
| Lần lật prefix đã commit          | 66 / 38             | **0 / 0**                                                   |
| RTF (8 luồng, máy dev)            | 0,014–0,016         | 0,065–0,077                                                 |
| Dấu câu + viết hoa nguồn          | Không               | **Có**                                                      |
| RAM                               | 223MB               | 995MB thường trú + ~60MB/phiên, không tăng theo độ dài lượt |

Đo trên chính hai fixture đã làm plan chết, cùng transcript tham chiếu, cùng bộ
chuẩn hoá. Lệnh tái lập nằm trong report.

## Bẫy đã biết — phải xử, không được bỏ qua

**1. Token thẻ ngôn ngữ làm decoder chết câm.** Bộ từ vựng chứa 39 token
`<xx-YY>`. Greedy decode của `parakeet.cpp` được phép phát chúng ra; khi một thẻ
được nạp ngược vào prediction network, vòng greedy tụt vào chỗ chọn blank cho
**mọi khung còn lại** — transcript đứng im tới hết file. Đã dựng lại được: trên
`vlsp-vi-01` upstream ra 101 từ rồi câm từ giây 27,68; cấm token thẻ thì ra 144
từ và chạy hết file.

Trigger là **đứt gãy âm học đột ngột** (đổi người nói, cắt mic, mối ghép clip).
Hội thoại thật có những thứ đó. **Không được coi đây là chuyện của fixture.**

Xử lý bắt buộc, cả hai lớp:

- Cấm 39 token thẻ khỏi argmax của greedy decode. Đừng để bản dựng sản phẩm phụ
  thuộc một biến môi trường như bản spike.
- **Lọc mọi chuỗi dạng `<xx-YY>` khỏi transcript trước khi ra TTS.** Cấm token
  xong model vẫn **đánh vần** thẻ ra bằng mảnh từ vựng thường. Nếu không lọc,
  chuỗi đó sẽ **bị đọc thành tiếng vào cuộc họp**.

**2. Bản vá cấm token là bản vá của mình, chưa đối chiếu upstream.** Phải kiểm
với hành vi tham chiếu của NeMo trước khi coi là đúng, và báo ngược lên
`parakeet.cpp` nếu đúng là lỗi.

## Phạm vi

**Chỉ chiều nguồn tiếng Việt.** Moonshine (tiếng Anh) **giữ nguyên** — nó chưa
bao giờ được đo trên giọng thật, nên không có căn cứ để đổi. Chiều en→vi tiếp
tục đi đường agreement của phase 3.

## Files

- `services/local-stt/engines/` — engine mới cạnh `zipformer_vi.py`
- `services/local-stt/app.py` — chọn engine, giữ nguyên hợp đồng `POST /transcribe`
- `services/local-stt/scripts/download_models.py` — tải GGUF
- `services/local-stt/README.md` — cách dựng runtime mới
- **Không đụng:** `apps/web`, engine tiếng Anh, hợp đồng HTTP hiện có

## Việc phải làm

1. **Chốt đường gọi.** Hai lựa chọn, chọn một và ghi lý do:
   `parakeet-server` (có sẵn, định dạng OpenAI, thêm một tiến trình) hay binding
   C-API gọi thẳng từ sidecar Python (ít tiến trình hơn, phải tự dựng).
2. Dựng `parakeet.cpp` tái lập được (`cmake` + submodule `ggml`), tải GGUF q8_0
   984MB từ `mudler/parakeet-cpp-gguf` — **không** phải GGUF của NVIDIA, bản đó
   dành cho runtime khác và `parakeet-cli` không load được. Ngôn ngữ là
   `vi-VN`, không phải `vi`.
3. Engine mới sau `Engine` protocol đang có, **giữ nguyên hợp đồng
   `POST /transcribe`** để không có caller nào phải đổi.
4. Cấm token thẻ + lọc `<xx-YY>` ở đầu ra. Test cả hai.
5. Mở API streaming thật (nạp audio theo chunk, giữ session) — đây mới là thứ
   phase 3–5 cần; gọi một phát cho cả file không phải cách production chạy.
6. Đo lại RTF và RAM trên đường đã tích hợp, không phải trên CLI.

## Kiểm chứng

- [x] `POST /transcribe` tiếng Việt vẫn đúng hợp đồng cũ; test hiện có xanh, không sửa test nào để cho xanh
- [x] Đơn điệu prefix **0 vi phạm** trên toàn độ dài cả hai fixture, đo qua sidecar chứ không qua CLI
- [x] Không có chuỗi `<xx-YY>` nào lọt vào transcript trả về — có test cho ca đứt gãy âm học
- [x] Decoder **không** câm giữa chừng trên fixture ghép clip (ca đã dựng lại được)
- [x] WER trong khoảng đã đo (~20% / ~26%); lệch nhiều hơn thì tích hợp sai chứ không phải model
- [x] RTF trên đường tích hợp < 0,3
- [x] **RAM phiên streaming không tăng theo độ dài lượt.** Tiêu chí "RAM < 1GB"
      ở bản đầu **viết sai** — nó lấy từ "model dưới 1GB", tức kích thước file,
      rồi đem áp cho RSS của tiến trình. Con số đúng phải tách làm hai phần, vì
      chỉ một phần trong đó nhân lên theo số lượt đồng thời.
- [x] Engine tiếng Anh không đổi hành vi

## Rủi ro

- **Sập decoder ở đứt gãy âm học có thể còn đường khác chưa bịt.** Cấm token thẻ
  bịt được đường đã biết. **Tín hiệu:** transcript đứng im trong khi audio vẫn
  vào. **Phản ứng:** thêm watchdog ở lớp session — không ra chữ mới quá N giây
  trong khi VAD vẫn báo có tiếng thì reset session, và **ghi log**, đừng nuốt.
- **Thêm một runtime mới vào deploy.** ~1GB model + binary C++. **Phản ứng:** giữ
  zipformer nguyên chỗ, chọn engine bằng cấu hình, để lùi được trong một dòng.
- **WER xấu hơn 7–9 điểm là quyết định của người dùng, đã chốt.** Nếu phase 6 đo
  ra chất lượng dịch tệ hơn mức chấp nhận được thì đó là **dữ liệu mới**, mang về
  cho người dùng quyết lại — không tự lùi.

## Rollback

Cấu hình chọn engine trả về `zipformer_vi`. Không có schema, không có migration,
không có gì phải hoàn tác ngoài một dòng cấu hình.
