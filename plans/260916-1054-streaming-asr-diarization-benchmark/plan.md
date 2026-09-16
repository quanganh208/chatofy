---
title: Benchmark chọn model streaming ASR (kèm nhận diện người nói)
date: 2026-09-16
branch: main
status: draft
mode: measurement-only
phases: 5
gpu: không thuê mặc định — Phase 1 quyết định bằng một trigger có số
---

# Benchmark chọn model streaming ASR, có xử lý nhận diện người nói

## Outcome

Một bảng quyết định có số, đủ để chọn hoặc từ chối một model streaming ASR thay
cho stack STT hiện tại — và, nếu model đó tự làm diarization, thay luôn tầng
nhận diện người nói đang chạy trong browser.

Kế hoạch này **chỉ đo, không đổi code sản phẩm**. Không một dòng nào trong
`apps/`, `packages/`, `services/` bị sửa. Kết quả có thể là "không model nào
qua" và đó vẫn là sản phẩm giao được — đúng khuôn mẫu repo đã dùng cho PhoWhisper
(`docs/development-journey.md:186`) và cho streaming TTS callback (`:916-925`).

## Ba quyết định người dùng đã chốt

| Quyết định              | Giá trị                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| Nguồn danh sách model   | Tôi tự khảo sát; người dùng bổ sung sau, plan để ngỏ một khe nhận thêm           |
| Diarization server-side | **Chấp nhận.** Danh tính người nói được phép rời browser để đổi lấy độ chính xác |
| Thanh chắn              | **Phải thắng cả hai trục**: WER ≤ 5,38% **và** attribution > 0,78                |

### Cảnh báo một lần về thanh chắn, rồi thực hiện đúng như đã chốt

Bằng chứng hiện có cho thấy **nhiều khả năng không model nào qua trục WER**:
Nemotron-3.5 streaming công bố 11,18–13,41% trên FLEURS-vi và VietASR streaming
đạt 13,04% — tức state of the art của streaming tiếng Việt nằm quanh 11–13%,
trong khi incumbent Zipformer-30M đạt 5,38% trên VIVOS vì nó là model offline
chuyên tiếng Việt luyện 6.000 giờ.

Kế hoạch vẫn giữ nguyên thanh chắn đã chốt. Nhưng mọi arm đều **ghi lại số đầy
đủ** chứ không chỉ ghi pass/fail, nên khi không ai qua, dữ liệu vẫn trả lời được
hai câu hỏi tiếp theo mà không cần chạy lại: model nào gần nhất, và liệu cấu hình
lai — streaming cho bản partial, incumbent cho bản final — có qua không.

## Mốc nền phải vượt

| Trục                  | Số hiện tại                           | Nguồn                                 |
| --------------------- | ------------------------------------- | ------------------------------------- |
| WER tiếng Việt        | **5,38%** (VIVOS-50, seed 42, greedy) | `docs/development-journey.md:122-124` |
| CER tiếng Việt        | **2,90%**                             | như trên                              |
| WER tiếng Anh         | **3,86%**                             | `:129-131`                            |
| RTF vi / en           | **0,0158 / 0,040**                    | như trên                              |
| Attribution sạch      | **0,78** so với mục tiêu 0,85         | `docs/system-architecture.md:347`     |
| Attribution far-field | **0,59**                              | như trên                              |
| Lượt rơi vùng chết    | **~1/3**                              | như trên                              |
| RTF trần luận văn     | **≤ 0,30**, p95 ≤ 2s                  | `docs/development-journey.md:70`      |

**Tầng speaker đang trượt mục tiêu của chính nó (0,78/0,59 so với 0,85).** Nguyên
nhân đã xác định và nằm ngoài tầm với của kiến trúc hiện tại: _"turn length, not
language, is the dominant error term"_ — 1 giây audio tốn 15,65% EER so với 1,35%
ở độ dài đầy đủ, mà lượt trung vị của sản phẩm là 1065ms. Một model đọc waveform
liên tục không bị trói vào biến đó. Đây là lý do chính đáng nhất để chạy benchmark
này.

## Ràng buộc

| #   | Ràng buộc                                                                                                        | Nguồn                                       |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| R1  | CPU-only là đường ship; GPU chỉ là contingency                                                                   | quyết định ràng buộc phiên trước            |
| R2  | Runtime trần cứng **sherpa-onnx 1.13.4 + onnxruntime 1.27.0**; 1.13.5+ cần onnxruntime 1.27.1 chưa từng lên PyPI | `services/local-stt/pyproject.toml:9-16`    |
| R3  | Prod chạy **4 thread**, dev 8. Đo ở 8 rồi deploy ở 4 là cách trượt ngưỡng trong im lặng                          | `docker-compose.prod.yml:278,283`           |
| R4  | `local-stt` có `mem_limit: 4g` **riêng**, không chia với TTS                                                     | `docker-compose.prod.yml:284,314`           |
| R5  | Benchmark là uv project standalone, ngoài pnpm workspace; thêm arm = thêm adapter                                | `benchmarks/stt/`, `benchmarks/speaker-id/` |
| R6  | Chạy lại scorer với `--limit` **ghi đè** `summary.json` đã ghi nhận — mọi smoke run phải trỏ run-tag khác        | memory đã ghi                               |
| R7  | Model đang dùng là CC-BY-NC-ND (vi). License của ứng viên là tiêu chí chọn, không phải ghi chú                   | `README.md:343,348`                         |
| R8  | Đồ án phi thương mại — license học thuật dùng được, nhưng phải ghi rõ                                            | memory đã ghi                               |

## Non-goals

1. Không sửa code sản phẩm. Không đụng `apps/`, `packages/`, `services/`.
2. Không train, fine-tune, hay export model.
3. Không triển khai model thắng cuộc. Đó là kế hoạch riêng sau khi có số.
4. Không đo MT và TTS. Chỉ STT và speaker.
5. Không thay `benchmarks/stt` hay `benchmarks/speaker-id` bằng harness mới.
6. Không tải weight trong Phase 1 — Phase 1 chỉ đọc metadata.

## Các pha

| Pha                                 | Nội dung                                                                             | GPU?                        | Đầu ra                             |
| ----------------------------------- | ------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------- |
| [1](phase-01-inventory-and-gate.md) | Khảo sát ứng viên, lọc qua tiêu chí cứng, ước lượng chi phí đo                       | Không                       | Bảng ứng viên + **quyết định GPU** |
| [2](phase-02-harness-arms.md)       | Thêm arm streaming vào `benchmarks/stt`, arm diarization vào `benchmarks/speaker-id` | Không                       | Hai adapter + manifest dùng chung  |
| [3](phase-03-quality-screen.md)     | Đo chất lượng: WER/CER và attribution/DER                                            | Chỉ nếu Phase 1 bật trigger | Bảng chất lượng đầy đủ             |
| [4](phase-04-cpu-cost.md)           | Đo RTF/RAM trên đúng máy đích, 4 thread, có TTS chạy cùng                            | Không — **bắt buộc CPU**    | Bảng chi phí                       |
| [5](phase-05-decision.md)           | Ma trận quyết định, ghi kết quả, cập nhật docs                                       | Không                       | Phán quyết + báo cáo               |

Phụ thuộc: 1 → 2 → 3 → 4 → 5. Phase 4 chỉ chạy trên ứng viên sống sót Phase 3.

## Trả lời câu hỏi GPU

**Mặc định: không thuê.** Lý do nằm ở chỗ chia đôi các phép đo:

- **Chất lượng (WER/CER/attribution) không phụ thuộc phần cứng.** Chạy trên GPU
  cho ra đúng con số như chạy trên CPU, chỉ nhanh hơn.
- **RTF và RAM thì phụ thuộc hoàn toàn.** Chúng phải đo trên đúng x86 4 thread
  trong container, cạnh một sidecar TTS đang serialize inference. **GPU không nói
  được gì về trục này**, và đây mới là trục quyết định đường ship.

Bộ test lại nhỏ: VIVOS-50 là 50 câu 3–10 giây, khoảng 350 giây audio mỗi ngôn
ngữ. Kể cả một model chạy tệ trên CPU ở RTF 3,0 thì vẫn chỉ mất ~18 phút mỗi
ngôn ngữ. Phần đắt là arm diarization vì nó cần audio dạng cuộc họp, dài hơn
nhiều.

**Trigger thuê GPU, do Phase 1 tính ra và báo cho người dùng:**

1. Một ứng viên **không chạy được trên CPU** (kernel CUDA-only, hoặc chỉ có
   checkpoint PyTorch không export được), **và** nó qua được mọi tiêu chí cứng
   khác; **hoặc**
2. Tổng thời gian screening chất lượng ước tính **vượt 8 giờ**.

Khi trigger bật, GPU chỉ dùng cho **Phase 3 (chất lượng)**. Phase 4 vẫn chạy CPU
tại chỗ, không có ngoại lệ. Một model chỉ sống được nhờ GPU thì tự động trượt R1
và bị ghi là "loại vì ràng buộc triển khai", không phải "loại vì kém".

## Tiêu chí nghiệm thu của chính kế hoạch này

- **N1** Mỗi ứng viên có một dòng đầy đủ: WER vi/en, CER vi, attribution
  sạch/far-field, RTF@4t, RTF@8t, RAM đỉnh, license, runtime, kích thước.
- **N2** Mọi số sinh ra từ runner trong `benchmarks/`, tái lập được bằng một lệnh
  ghi trong báo cáo, không có số nào chép tay từ model card.
- **N3** Arm đối chứng: stack hiện tại chạy lại trong **cùng run-tag**, cùng seed,
  cùng bộ câu. Nếu không tái lập được 5,38% thì toàn bộ phép so vô hiệu và phải
  dừng để tìm nguyên nhân trước.
- **N4** `summary.json` của các run cũ (`r1`, `r2`, `r3-decoder-arms`) **không bị
  đụng**. Xác minh bằng `git status` sạch trên `benchmarks/*/results/`.
- **N5** Phán quyết ghi rõ pass/fail theo thanh chắn đã chốt, kèm bảng đầy đủ để
  đọc được cả khi không ai qua.
- **N6** Không file nào trong `apps/`, `packages/`, `services/` bị sửa. Xác minh
  bằng `git diff --name-only`.

## Câu hỏi chưa giải quyết

1. **Danh sách model của người dùng.** Phase 1 để ngỏ một khe nhận thêm; nếu
   người dùng đưa tên sau khi Phase 1 chạy xong, chúng đi thẳng vào cùng bộ lọc
   cứng chứ không được miễn trừ.
2. **Bộ test cho diarization tiếng Việt.** `benchmarks/speaker-id` dùng VoxVietnam
   và Vietnam-Celeb cho _verification_, không phải cho diarization có nhãn thời
   gian. Phase 2 phải xác định lấy nhãn ở đâu, hoặc dùng cuộc họp mô phỏng như
   bench hiện tại đang làm. Đây là rủi ro lịch trình lớn nhất của kế hoạch.
3. **Ngưỡng far-field.** Mốc 0,59 đo qua room impulse response mô phỏng. Ứng viên
   mới phải đo qua **đúng** đường augment đó (`speaker_bench/augment.py`) mới so
   được, và chưa rõ nó có áp được lên audio dạng cuộc họp dài không.
