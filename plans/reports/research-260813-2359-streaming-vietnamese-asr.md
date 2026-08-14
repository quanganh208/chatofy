# Research: STT streaming tiếng Việt — có gỡ được chốt chặn không

Ngày 2026-08-13. Nối tiếp `measure-260813-2350-prefix-stability-gate.md`.

**Kết luận: có.** Chốt chặn "không có STT streaming tiếng Việt" — kết luận ở
brainstorm và vẫn đúng với catalog sherpa-onnx — **đã hết đúng ở phạm vi rộng
hơn**. Có một model streaming hỗ trợ tiếng Việt, chạy được trên CPU, và ra sau
thời điểm brainstorm.

## Ứng viên

### 1. `nvidia/nemotron-3.5-asr-streaming-0.6b` — ứng viên thật

|            |                                                                  |
| ---------- | ---------------------------------------------------------------- |
| Kiến trúc  | FastConformer-RNNT **cache-aware**, 24 lớp encoder, 600M tham số |
| Tiếng Việt | **Có**, hạng "transcription-ready", WER **11,18%** ở chunk 1,12s |
| Độ trễ     | Chỉnh được: chunk 80ms → 1,12s (`att_context_size`)              |
| Giấy phép  | OpenMDW-1.1                                                      |
| Chạy CPU   | Qua **`parakeet.cpp`** (ggml/GGUF), có bản `q8_0`                |

Vì sao nó gỡ được đúng chỗ đang hỏng: cache-aware streaming decode **causal,
theo chunk, giữ state giữa các chunk** — nó không bao giờ decode lại phần audio
đã xử lý. Nên **prefix đơn điệu là thuộc tính kiến trúc, không phải xác suất**.
Toàn bộ ca "ờ xuất hiện lại ở đầu câu rồi đẩy lệch cả chuỗi" không thể xảy ra,
chứ không phải hiếm xảy ra.

Số CPU công bố (bên thứ ba, **chưa tự đo**): 1m46s audio decode trong 32s trên
Intel Mac không GPU → RTF ≈ **0,30**; model dưới 1GB; q8_0 cho WER lệch 0,0000%
so với f32.

### 2. SeamlessStreaming (Meta) — bỏ

Dịch tiếng nói đồng thời end-to-end (EMMA), thay được cả STT lẫn MT, có tiếng
Việt. Nhưng 2,3B tham số, không có tối ưu CPU. Sai kích cỡ cho máy chạy sidecar
này. Ghi lại để không phải tìm lại.

### 3. sherpa-onnx — vẫn không có

Xác nhận lại: bản Việt trong catalog (`sherpa-onnx-zipformer-vi-30M-int8-2026-02-09`,
6000h) **vẫn là offline transducer**. Các model online transducer vẫn chỉ có
Bengali/Trung/Hàn/Anh/Pháp. Kết luận ở brainstorm không sai — nó chỉ hẹp hơn
thực tế vì chỉ nhìn một catalog.

## Cái giá, nói thẳng

So với Zipformer-30M đang chạy (`zipformer_vi.py`: WER 5,38%, RTF 0,017, 223MB):

|                                      | Zipformer-30M (nay)     | Nemotron streaming                  |
| ------------------------------------ | ----------------------- | ----------------------------------- |
| WER (vi), số công bố                 | **5,38%**               | 11,18%                              |
| WER (vi), **tự đo trên fixture này** | **11,7% / 19,3%**       | 20,4% / 26,1%                       |
| RTF, tự đo                           | **0,014–0,016**         | 0,065–0,077                         |
| RAM                                  | **223MB**               | <1GB                                |
| Prefix đơn điệu                      | **Không**               | **Có, theo kiến trúc**              |
| Runtime                              | sherpa-onnx (đang dùng) | parakeet.cpp — thêm một runtime mới |

**WER xấu đi 7–9 điểm.** Đó là cái giá thật và phải cân với việc được cái gì. Số
tự đo (mục 5) mới là số phải dùng; con số công bố đo trên bộ khác.

Nhưng có một điểm đảo chiều đáng chú ý: cách làm hiện tại decode lại cửa sổ 8s
**mỗi 300ms**, tức mỗi giây tường tiêu `8 × 0,016 / 0,3 ≈ 0,43` giây CPU. Model
streaming xử lý mỗi khung **đúng một lần**: **0,17** đo được. Nên dù RTF trên
giấy xấu hơn nhiều lần, **tổng tải CPU cho một luồng lại NHẸ hơn hiện tại khoảng
2,5 lần** — vì phần lớn công của cách làm hiện tại là decode đi decode lại cùng
một đoạn audio. Điều này cũng đổi cách tính `MAX_CONCURRENT_TURNS_GLOBAL`.

## KẾT QUẢ SPIKE (đã chạy thật, 2026-08-14)

Dựng `parakeet.cpp` từ source (cmake + submodule ggml, ~5 phút), tải GGUF q8_0
**984MB** từ `mudler/parakeet-cpp-gguf` (không phải GGUF của NVIDIA — bản đó dành
cho runtime khác và `parakeet-cli` không load được), chạy trên chính hai fixture
đã làm plan chết. Ngôn ngữ là `--lang vi-VN`, không phải `vi`.

### 1. Đơn điệu prefix — ĐẠT, và đây là điều quan trọng nhất

Cùng phép thử đã giết thiết kế cũ: cho input dài dần, kiểm tra output dài hơn có
luôn **nối thêm** vào output ngắn hơn không.

| Fixture      | Zipformer (cũ) | **Nemotron streaming** |
| ------------ | -------------- | ---------------------- |
| `vlsp-vi-01` | 66 mâu thuẫn   | **0 vi phạm**          |
| `vlsp-vi-02` | 38 mâu thuẫn   | **0 vi phạm**          |

Không một từ nào đã phát bị đổi, qua 4 bước tăng độ dài, trên cả hai fixture.
Chốt chặn đã giết plan **không còn nữa**.

### 2. Tốc độ — đạt thoải mái

8 luồng, máy này: offline **RTF 0,061–0,065**; streaming **RTF ~0,17**. Cả hai
dưới 1,0 rất xa. Ước lượng 0,30 lấy từ bài viết bên thứ ba là **bi quan hơn thực tế**.

### 3. Quà kèm không ngờ tới: dấu câu và viết hoa

Model sinh transcript tiếng Việt **có dấu câu và viết hoa**:
`"Xin được Mỹ ờ chấp thuận đó thì cái thời gian mà chờ Mỹ xét duyệt bao lâu nữa
theo luật sư."` — và giữ nguyên cả từ ngập ngừng "ờ".

Điều này **xoá luôn một ràng buộc lớn của plan**: mục "vì sao ranh giới vế không
lấy từ dấu câu" tồn tại chỉ vì Zipformer sinh chữ hoa trần không dấu câu. Với
model này, `splitIntoClauses` chạy được trên transcript nguồn tiếng Việt.

### 4. Vụ "ngừng ra chữ sau ~30s" — ĐÃ TÌM RA NGUYÊN NHÂN VÀ ĐÃ SỬA

Triệu chứng: trên `vlsp-vi-01` (41,5s), **cả hai chế độ** dừng ở **101 từ / 162 từ
tham chiếu**. 20s→69, 26s→92, 30s→101, rồi 34/38/41s đều **101** — output giống
nhau **từng ký tự**, dù đoạn 30–41s cắt riêng ra thì nhận rất tốt.

**Nguyên nhân: decoder tự phát ra token thẻ ngôn ngữ `<vi-VN>` rồi im hẳn.**

`--timestamps` chỉ thẳng vào thủ phạm — ký hiệu cuối cùng trước 14 giây im lặng:

```
27.52-27.68  họ.       (0.50)
27.68-27.76  <vi-VN>   (0.99)      <- rồi không còn gì nữa
```

Bộ từ vựng của model chứa **39 token thẻ ngôn ngữ** (`<vi-VN>`, `<en-US>`, …).
Chúng là nhãn dùng lúc huấn luyện, nhưng greedy decode của `parakeet.cpp` không
cấm phát chúng ra. Khi một thẻ được phát và **nạp ngược vào prediction network**,
trạng thái predictor thành "bắt đầu lượt mới", và vòng greedy tụt vào chỗ chọn
blank cho **mọi khung còn lại**. Transcript đứng im từ đó tới hết file.

Bốn mẩu bằng chứng, khớp nhau:

1. Mọi lần đứng im đều xảy ra **ngay sau** một thẻ, độ tin cậy 0,99–1,00.
2. Cắt file từ các mốc khác nhau (0s, 2s, 6s, 10s, 14s) thì thẻ luôn rơi vào
   **cùng một mốc tuyệt đối 27,68s** — đúng chỗ hai clip được ghép lại (RMS nhảy
   1009 → 3162). Đứt gãy âm học đột ngột là thứ kích hoạt thẻ.
3. Thẻ **không luôn gây chết**: bản cắt từ 6s phát thẻ ở 5,76s và 21,68s rồi vẫn
   chạy tiếp tới hết. Nên đây là sập trạng thái greedy, không phải "hết file".
4. AMI tiếng Anh (bản ghi liên tục, không có mối ghép) **không phát thẻ lần nào**
   và không đứng im suốt 100s.

**Sửa (đã kiểm chứng):** cấm 39 token thẻ khỏi argmax của greedy decode. Bản vá
nằm trong `src/decode_common.hpp` + `src/model_loader.cpp` của bản dựng spike,
bật bằng `PK_SUPPRESS_LANG_TAGS=1` nên **mặc định vẫn giống hệt upstream**. Cùng
file, cùng lệnh, chỉ khác biến môi trường:

| `vlsp-vi-01` (41,5s) | Số từ ra                                  |
| -------------------- | ----------------------------------------- |
| Như upstream         | 101 (đứng im từ 27,7s)                    |
| Cấm thẻ              | **144**, chạy hết file, kết đúng câu cuối |

**Đây là ngôn ngữ vô can.** Trigger là mối ghép trong fixture, không phải tiếng
Việt. Giả thuyết "đặc thù ngôn ngữ" ở bản trước đã bị loại.

**Còn một vết bẩn:** cấm token thẻ xong, model **đánh vần** thẻ ra bằng các mảnh
từ vựng thường (`<sl-SL>` xuất hiện giữa transcript). Không gây chết decode nữa,
nhưng **bắt buộc phải lọc chuỗi dạng `<xx-YY>` trước khi đưa sang TTS**, nếu
không nó sẽ bị đọc thành tiếng vào cuộc họp.

> **Một lỗi đã mắc và đã sửa, ghi lại để không ai lặp lại.** Kết luận đầu tiên ở
> bước này là "ghép clip phá hỏng phép đo", rút ra từ việc so **94 từ** với **37
> từ**. Sai: 94 từ đó là của file **80 giây**, còn 37 từ là của file **51 giây** —
> so hai độ dài khác nhau rồi gọi chênh lệch là phát hiện. Đối chứng đúng (cùng
> 48 giây: liên tục 31 từ, ghép khe 0ms 31 từ, ghép khe 400ms 37 từ) cho thấy
> điều ngược lại. Bài học: mọi so sánh ở đây phải khoá cứng độ dài, vì số từ tăng
> theo độ dài nhanh hơn bất kỳ hiệu ứng nào đang đo. Đáng nói thêm: việc ghép
> clip **vẫn là thứ tạo ra đứt gãy âm học** kích hoạt thẻ — nó vô hại với phép
> đếm từ, nhưng không vô hại với decoder.

### 5. WER thật — số liệu bị chặn nay đã đo được

Cùng audio, cùng transcript tham chiếu, cùng bộ chuẩn hoá. Cột `del` là số từ bị
**bỏ mất**, tách riêng để phân biệt "nghe nhầm" với "ngừng nghe".

| Fixture      | Engine              | WER       | sub | del    | ins | RTF   |
| ------------ | ------------------- | --------- | --- | ------ | --- | ----- |
| `vlsp-vi-01` | zipformer           | **11,7%** | 5   | 13     | 1   | 0,016 |
|              | nemotron (upstream) | 45,1%     | 6   | **64** | 3   | 0,065 |
|              | nemotron + cấm thẻ  | **20,4%** | 7   | 22     | 4   | 0,077 |
| `vlsp-vi-02` | zipformer           | **19,3%** | 10  | 9      | 4   | 0,014 |
|              | nemotron (upstream) | 25,2%     | 5   | 23     | 2   | 0,068 |
|              | nemotron + cấm thẻ  | 26,1%     | 5   | 23     | 3   | 0,071 |

Đọc bảng này:

- **Con số 45,1% cũ gần như toàn bộ là vụ sập decoder**, đúng như đã ngờ: sửa
  xong còn 20,4%, và `del` tụt 64 → 22.
- `vlsp-vi-02` **không đổi** (25,2 → 26,1) vì clip này không sập — nemotron chạy
  tới câu cuối. 23 từ mất của nó là bỏ thật ở đoạn khó ("ấy chứng chỉ mà ờ cư lít
  lao ơ"), chỗ zipformer cố đoán và ra "credit".
- **Giá thật của việc đổi model: xấu hơn khoảng 7–9 điểm WER** (20,4 vs 11,7 và
  26,1 vs 19,3), không phải gấp đôi thảm hoạ. Tỷ lệ này khớp với con số công bố
  11,18% vs 5,38%.
- **Lỗi thay từ thì nemotron ngang hoặc tốt hơn** (sub 7 vs 5, và 5 vs 10). Chênh
  lệch nằm gần hết ở chỗ nó bỏ qua đoạn khó thay vì đoán bừa. Với dịch nói, bỏ
  sót và đoán bừa **không cùng mức độ tai hại** — đoán bừa tạo câu sai nghĩa, còn
  câu này chưa có chỉ số nào trả lời, phải nghe.

### 6. Đơn điệu prefix — kiểm lại trên toàn bộ độ dài

Lần trước chỉ đo tới 30s (vùng output còn tăng). Nay đo hết file:

| Fixture      | Số từ theo mốc                                     | Vi phạm |
| ------------ | -------------------------------------------------- | ------- |
| `vlsp-vi-01` | 6s:20 12s:38 18s:61 24s:81 30s:108 36s:129 41s:144 | **0***  |
| `vlsp-vi-02` | 6s:22 12s:37 18s:57 24s:79 30s:84 33s:92           | **0**   |

*Một "vi phạm" duy nhất ở mốc 18s là do chính regex lọc thẻ của dụng cụ đo ăn
nhầm mảnh `mt-`, không phải model đổi ý. Sau khi lọc thẻ đúng cách thì bằng 0.

So với 66 và 38 mâu thuẫn của zipformer, **kết luận đơn điệu prefix đứng vững
trên toàn bộ độ dài lượt**, chứ không chỉ ở 30 giây đầu.

## Việc tiếp theo nếu chọn hướng này

Đã xong: dựng `parakeet.cpp` + GGUF vi, đo đơn điệu prefix trên toàn độ dài, đo
WER thật trên transcript tham chiếu của chính fixture, đo RTF trên máy này.

Còn lại, theo thứ tự chặn nhau:

1. **Quyết định go/no-go** với cái giá 7–9 điểm WER (mục 5). Đây là quyết định
   của người dùng, không phải của phép đo.
2. Nếu go: chốt đường tích hợp — `parakeet-server` hay binding C-API — và **bắt
   buộc kèm bộ lọc chuỗi `<xx-YY>` trước TTS**.
3. Xử lý bản vá cấm token thẻ cho tử tế: đối chiếu hành vi tham chiếu NeMo, báo
   ngược upstream, và không để bản dựng sản phẩm phụ thuộc một biến môi trường.
4. Đo WER ở chunk nhỏ hơn để biết độ trễ đạt được thật.
5. Nghe thử sau khi dịch (mục 5 của phần câu hỏi).

Với đơn điệu prefix đã đạt, plan streaming commit sống lại gần như nguyên vẹn:
phase 2 bỏ được phần agreement (không cần nữa), phase 3–5 giữ nguyên, và ranh
giới vế lấy được từ dấu câu nguồn.

## Câu hỏi chưa trả lời

1. **Cấm token thẻ có phải cách sửa đúng không**, hay upstream đã có cách xử lý
   khác mà bản dựng này chưa bật. Bản vá hiện tại là vá của mình, chưa đối chiếu
   với hành vi tham chiếu của NeMo. Cần: hỏi/đọc upstream, và nếu đúng là lỗi thì
   báo ngược lên `parakeet.cpp`.
2. Sập decoder xảy ra ở **đứt gãy âm học đột ngột**. Hội thoại thật có đổi người
   nói, có cắt mic — **tần suất thật là bao nhiêu**, chưa biết. Fixture ghép clip
   là ca cực đoan; cần đo trên bản ghi liên tục có nhiều người nói.
3. Đổi STT có làm hỏng chiều tiếng Anh không: Moonshine đang tốt và **vẫn chưa
   được đo trên giọng thật** — có nên đổi cả hai chiều, hay chỉ chiều tiếng Việt.
4. WER ở chunk nhỏ hơn 1,12s là bao nhiêu — số này quyết định độ trễ đạt được
   thật sự, và vẫn chưa đo.
5. WER xấu hơn 7–9 điểm **nghe ra sao sau khi đã dịch**: nemotron bỏ sót đoạn khó
   còn zipformer đoán bừa. Không chỉ số nào trả lời được, phải nghe thử.
6. OpenMDW-1.1 có ràng buộc gì với đồ án/luận văn không — chưa đọc toàn văn.
7. `parakeet.cpp` gọi từ sidecar Python/HTTP hiện tại: dùng `parakeet-server`
   (có sẵn, định dạng OpenAI) hay viết binding qua C-API.

## Bằng chứng nào còn đứng vững

Không còn mục "không dùng được" — chốt chặn đã gỡ và các số đã đo lại.

**Đứng vững:** đơn điệu prefix 0 vi phạm **trên toàn bộ độ dài lượt** (không chỉ
30s đầu); WER 20,4% / 26,1% so với zipformer 11,7% / 19,3%; RTF 0,065–0,077
offline và ~0,17 streaming; model sinh dấu câu + viết hoa tiếng Việt; nguyên nhân
vụ ngừng ra chữ đã xác định và sửa được.

**Đã bị bác bỏ:** "model có trần ~30s" (tiếng Anh chạy 100s); "ghép clip phá phép
đo" (đối chứng cùng độ dài bằng nhau); "đây là vấn đề của tiếng Việt" (trigger là
mối ghép, tiếng Anh không có mối ghép nên không dính).
