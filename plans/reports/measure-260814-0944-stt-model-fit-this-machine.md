# Chọn model STT hợp với chính máy này — đo, không đoán

Ngày 2026-08-14. Dữ liệu: VIVOS test 50 câu (vi), LibriSpeech test-clean 50 câu
(en), cùng manifest và cùng bộ chuẩn hoá mà `benchmarks/stt` đã dùng cho các
model cũ. Lệnh tái lập ở cuối.

## Máy

|          |                                                                     |
| -------- | ------------------------------------------------------------------- |
| CPU      | i7-11700K, 8 nhân / 16 luồng, tới 5,0 GHz                           |
| Tập lệnh | **AVX-512 đầy đủ + VNNI** (`avx512_vnni`, `avx512bw/dq/vl`, `f16c`) |
| RAM      | 31 GB, trống ~23 GB                                                 |
| GPU      | AMD RX 580 8GB (Polaris) — **không CUDA**, Vulkan 1.4 qua RADV      |
| Đĩa      | trống 248 GB                                                        |

Hai đặc điểm này quyết định kết quả bên dưới: **VNNI** làm INT8 nhanh bất
thường, và **16 luồng là hyperthread chứ không phải 16 nhân**.

## Kết luận, gọn

| Vai trò                       | Model chọn                     | Vì sao                                                  |
| ----------------------------- | ------------------------------ | ------------------------------------------------------- |
| Phát ra tiếng, chiều vi       | **nemotron q8_0, streaming**   | Đơn điệu prefix; WER 10,93%; RTF 0,202                  |
| Transcript hiển thị, chiều vi | **zipformer-30M** (giữ nguyên) | 5,38% — không model nào đo được ở đây thắng nổi         |
| Chiều en                      | **Moonshine** (giữ nguyên)     | 3,86%, RTF 0,040, 418MB — rẻ nhất và gần chính xác nhất |
| Số luồng                      | **8**                          | 16 luồng **chậm hơn 2,7 lần**                           |

**Không có gì phải đổi trong cấu hình đang chạy.** Mặc định `q8_0` và 8 luồng
hoá ra đã là lựa chọn tối ưu trên máy này — nhưng trước hôm nay đó là may, không
phải bằng chứng.

## 1. Một lỗi đo phải kể trước, vì nó suýt thành kết luận

Lượt đo đầu ra **27,6% WER** cho nemotron, so với 5,38% của zipformer — chênh 22
điểm, và tôi suýt báo cáo "cái giá thật đắt hơn nhiều so với ước tính 7–9 điểm".

Sai. Harness gọi thẳng binding nên **không đi qua bộ lọc thẻ ngôn ngữ** mà
service vẫn áp. Model đánh dấu kết thúc phát ngôn bằng một thẻ `<sl-SI>`,
`<mt-MT>`… — và trên clip ngắn thì **gần như câu nào cũng có một thẻ ở cuối**.
Bộ chuẩn hoá WER biến `<sl-SI>` thành hai "từ" `sl si`, tức **2 lỗi chèn trên
mỗi câu tham chiếu ~9 từ**. Đúng bằng khoảng chênh.

Lọc thẻ xong: **11,29%**, khớp gần như chính xác con số công bố 11,18%.

Đã sửa tận gốc thay vì vá ở harness: `strip_language_tags` chuyển xuống
`parakeet_runtime.py` — nằm cạnh chính cái binding sinh ra nhu cầu lọc — và cả
service lẫn harness dùng chung một bản. Cùng lý do đã dùng cho binding: đo code
mà không ai chạy thì con số tả một hệ thống không tồn tại.

Ghi lại thêm một điều **quan trọng cho thiết kế**: thẻ ngôn ngữ ở cuối phát ngôn
là **hành vi bình thường của model**, không phải sự cố hiếm ở mối ghép clip như
tôi mô tả hôm qua. Cái là lỗi chỉ là việc decoder **câm hẳn** sau đó. Bộ lọc vì
thế không phải phòng xa — nó chạy trên gần như mọi phát ngôn.

## 2. Quét mức lượng tử hoá — và một kết quả ngược trực giác

50 câu VIVOS, cùng tham chiếu, chế độ streaming chunk 300ms như production:

| Quant    | WER% (stream) | RTF (stream) | RAM MB | File    |
| -------- | ------------- | ------------ | ------ | ------- |
| q4_k     | 11,83         | 0,212        | 802    | 718 MB  |
| q5_k     | 11,11         | 0,257        | 864    | 785 MB  |
| q6_k     | 11,11         | 0,224        | 932    | 856 MB  |
| **q8_0** | **10,93**     | **0,202**    | 1054   | 984 MB  |
| f16      | 11,29         | 0,239        | 1531   | 1484 MB |

**q8_0 thắng cả hai trục cùng lúc** — chính xác nhất _và_ nhanh nhất. Đây không
phải ngẫu nhiên mà là đặc tính của chính CPU này: `vpdpbusd` (AVX-512 VNNI) nhân
tích luỹ INT8 thẳng bằng phần cứng, còn q4_k/q5_k/q6_k phải giải nén k-quant
trước khi tính. Trên CPU không có VNNI thứ tự này gần như chắc chắn đảo lại.

Hệ quả thực dụng: **không có lý do gì dùng quant nhỏ hơn trên máy này**, và f16
cũng vô nghĩa — tốn thêm 480MB RAM để WER _xấu đi_.

## 3. Streaming không tốn thêm độ chính xác

| Chế độ                   | WER%      | RTF   |
| ------------------------ | --------- | ----- |
| offline (cả câu một lần) | 11,29     | 0,069 |
| streaming (chunk 300ms)  | **10,93** | 0,202 |

Đây là kết quả đáng kể nhất cho plan. Giả định thông thường là decode theo chunk
phải kém hơn vì thiếu ngữ cảnh phải. Đo ra **không kém** (chênh 0,36 điểm, nằm
trong nhiễu ở n=50). Nói cách khác: **khả năng nói giữa câu không phải mua bằng
độ chính xác** — nó mua bằng RTF gấp 3 (0,069 → 0,202), và 0,202 thì vẫn thừa.

## 4. Cái giá thật của việc đổi engine

| Model vi                 | WER%     | RTF   | RAM MB | Đơn điệu prefix |
| ------------------------ | -------- | ----- | ------ | --------------- |
| zipformer-30M            | **5,38** | 0,017 | 223    | Không           |
| PhoWhisper-small         | 7,71     | 0,332 | 972    | Không           |
| **nemotron q8_0 stream** | 10,93    | 0,202 | 1054   | **Có**          |
| whisper large-v3-turbo   | 12,19    | 0,756 | 2057   | Không           |

**5,5 điểm**, không phải 7–9 như tôi báo hôm qua từ 2 fixture ghép. Con số hôm
qua đo trên n=2 đoạn dài có ngập ngừng; con số này n=50 câu đọc sạch. Hai phép
đo **không mâu thuẫn** — chúng đo hai loại audio khác nhau, và cả hai đều thật.
Số nào dùng cho quyết định nào thì phải nói rõ: 5,5 điểm là chênh lệch trên lời
đọc rõ ràng, 7–9 điểm là chênh lệch trên lời nói tự nhiên có ngập ngừng.

## 5. Model lớn hơn có cứu được không — không

Máy có 23GB trống nên tôi thử hẳn hạng nặng: **whisper large-v3-turbo** (809M,
INT8, 1,6GB weights), một model phủ cả hai ngôn ngữ.

- **Tiếng Việt: 12,19%** — _tệ hơn cả nemotron_, và **RTF 0,756**, p95 3,2 giây.
  Vỡ trần RTF 0,3 của dự án. Whisper gốc yếu tiếng Việt; bản fine-tune
  PhoWhisper-small (7,71%) đánh bại nó bằng 1/4 tài nguyên.
- **Tiếng Anh: 2,90%** — tốt nhất bảng, nhưng RTF 0,555 và p95 3,4 giây. Moonshine
  cho 3,86% ở RTF 0,040, tức **kém 0,96 điểm nhưng nhanh gấp 14 lần**.

Kết luận: **không có model lớn nào đáng đổi trên máy này**. Trần chặn không phải
RAM — mà là RTF, và mọi model đủ lớn để chính xác hơn đều vượt trần.

## 6. Chiều tiếng Anh: giữ Moonshine

Câu hỏi treo từ brainstorm ("Moonshine chưa bao giờ đo trên giọng thật") nay có
số — trên LibriSpeech test-clean:

| Model en               | WER%     | RTF       | RAM MB  |
| ---------------------- | -------- | --------- | ------- |
| whisper large-v3-turbo | 2,90     | 0,555     | 2053    |
| whisper small.en       | 3,74     | 0,228     | 552     |
| **Moonshine base**     | **3,86** | **0,040** | **418** |
| nemotron q8_0 stream   | 5,19     | 0,203     | 1051    |

Moonshine đứng vững. Nhưng có một đánh đổi **mới đo được** đáng đưa ra:
nemotron-en kém 1,33 điểm, đổi lại **đơn điệu prefix theo kiến trúc** — tức
chiều tiếng Anh cũng nói được giữa câu mà không cần agreement, không cần chờ
thêm một vòng đọc, và không bao giờ có ca phát ra tiếng rồi sai. Dùng một model
cho cả hai chiều cũng bớt được 418MB và bớt một engine phải bảo trì.

Đây là **quyết định phạm vi, không phải kết quả đo** — plan hiện chốt "chỉ đổi
chiều vi", và tôi không tự đổi. Đưa ra để bạn quyết.

## 7. Số luồng — 8, và 16 thì tai hại

41,5s audio, fixture `vlsp-vi-01`:

| Luồng | offline s | RTF       | stream s | RTF       |
| ----- | --------- | --------- | -------- | --------- |
| 1     | 10,09     | 0,243     | 26,79    | 0,646     |
| 2     | 5,90      | 0,142     | 15,52    | 0,374     |
| 4     | 3,66      | 0,088     | 9,61     | 0,232     |
| **8** | **2,69**  | **0,065** | **8,19** | **0,197** |
| 16    | 6,23      | 0,150     | 22,48    | 0,542     |

**16 luồng chậm hơn 8 luồng 2,7 lần.** Hyperthread tranh nhau cùng đơn vị vector
— với tải AVX-512 thì siêu phân luồng là thuần tuý gây hại. Mặc định
`kDefaultThreads = 8` của thư viện trùng đúng mặc định `LOCAL_STT_THREADS=8` của
dự án, nên hiện tại không sai.

**Con số phase 5 cần:** 4 luồng chỉ chậm hơn 8 luồng **18%** (stream 9,61 vs
8,19). Nên **2 lượt đồng thời, mỗi lượt 4 luồng, mỗi lượt vẫn RTF 0,232** — thừa
sức thời gian thực. Ở 2 luồng, RTF 0,374, tức **4 lượt đồng thời** vẫn khả thi
về mặt tính toán. Đây là đầu vào trực tiếp cho `MAX_CONCURRENT_TURNS_GLOBAL`,
thay cho việc suy từ RTF một lượt.

Cảnh báo: C-API **không mở** `set_num_threads` (chỉ có `pk::set_num_threads` phía
C++). Muốn chỉnh số luồng từ sidecar Python thì phải vá thêm C-API. Chưa làm.

## 8. GPU: chưa thử được, và có lẽ không đáng

RX 580 chạy Vulkan 1.4 qua RADV, và `parakeet.cpp` có sẵn tuỳ chọn
`PARAKEET_GGML_VULKAN`. Nhưng máy **thiếu `glslc` và vulkan headers**, cần
`sudo apt install glslc libvulkan-dev` — tôi không tự cài gói hệ thống.

Đánh giá trước khi bạn quyết có đáng không: RTF đã là 0,197, tức GPU **không giải
quyết vấn đề nào đang tồn tại**. Giá trị duy nhất là giải phóng CPU cho TTS và
cho nhiều lượt đồng thời. Thêm nữa Polaris **không có tăng tốc fp16 hay dot
product INT8** — nó sẽ mất chính cái lợi thế VNNI đang làm q8_0 nhanh nhất trên
CPU. Tôi **không khuyến nghị** trừ khi phase 5 đo ra CPU thực sự nghẽn.

## Việc đã sửa trong repo lượt này

- `strip_language_tags` chuyển vào `parakeet_runtime.py`, service và harness dùng chung
- `benchmarks/stt` thêm engine `parakeet-nemotron-{quant}-{offline|stream}-{vi|en}` và `fw-large-turbo-{vi|en}`
- `run_benchmark.py --engines` nay nhận **bất kỳ** engine nào trong registry, manifest suy từ ngôn ngữ của engine (trước chỉ nhận 4 engine mặc định)
- `stt_bench/parakeet_binding.py` nạp binding **của service** theo đường dẫn, không sao chép

Test: `services/local-stt` 28 xanh, `benchmarks/stt` 11 xanh.

## Lệnh tái lập

```bash
cd benchmarks/stt
uv run python scripts/prepare_datasets.py
export LOCAL_STT_PARAKEET_LIB=/path/to/libparakeet.so
uv run python run_benchmark.py --run-tag q-sweep \
  --engines parakeet-nemotron-q8_0-stream-vi,parakeet-nemotron-q4_k-stream-vi,fw-large-turbo-vi
```

Kết quả thô: `benchmarks/stt/results/q-sweep/`.

## Câu hỏi chưa trả lời

1. **Có đổi chiều tiếng Anh sang nemotron không** — kém 1,33 điểm WER, đổi lấy
   đơn điệu prefix, bớt 418MB và bớt một engine. Quyết định phạm vi, cần bạn chốt.
2. Dùng **hai model cho chiều vi** được không: nemotron lái audio đã phát,
   zipformer sinh transcript hiển thị (5,38%)? Được về tài nguyên (1,3GB, RTF
   không đáng kể), nhưng người dùng sẽ **đọc một văn bản và nghe bản dịch của một
   văn bản khác**. Chưa rõ có gây khó chịu không — phải nghe thử, không đo được.
3. Có cài `glslc` để thử Vulkan không (mục 8: tôi nghiêng về **không**).
4. Vá C-API để mở `set_num_threads` — cần nếu phase 5 muốn chỉnh luồng theo số
   lượt đồng thời.
5. Chưa đo TTS và MT local trên máy này; lượt này chỉ STT.
6. WER ở chunk nhỏ hơn 300ms vẫn chưa đo — đây là dial độ trễ, và mục 3 cho thấy
   ở 300ms thì streaming không mất gì, nên câu hỏi thật là mất từ mốc nào.
