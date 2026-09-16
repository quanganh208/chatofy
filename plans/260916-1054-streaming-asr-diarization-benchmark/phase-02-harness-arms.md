---
phase: 2
title: Thêm arm đo vào hai harness đã có
depends-on: phase-01
gpu: không
outputs: adapter streaming ASR, adapter diarization, manifest dùng chung
---

# Phase 2 — Arm đo

## Bối cảnh

Repo đã có hai harness và **không được thay chúng bằng cái thứ ba** (R5):

- `benchmarks/stt/` đo WER, CER, RTF, RAM đỉnh, thời gian load. Engine adapter ở
  `stt_bench/engines/`, contract là `transcribe(wav_path) -> str`
  (`stt_bench/engines/base.py:54`). Chuẩn hoá văn bản dùng chung ở
  `text_normalize.py`, metric ở `metrics.py`, render ở `report.py`.
- `benchmarks/speaker-id/` đo attribution. Nó đã có phần khó nhất: cuộc họp mô
  phỏng với số người nói không biết trước (`run_session.py`), mô phỏng far-field
  bằng room impulse response (`speaker_bench/augment.py`), và **hai oracle chạy
  thẳng code TypeScript thật** (`scripts/gate-reference.mjs`,
  `scripts/attribution-reference.mjs`).

Cả hai là uv project riêng, không nằm trong pnpm workspace.

## Vấn đề hình dạng, và quyết định

Model streaming **không vừa** contract nào trong hai cái:

- `stt_bench` đưa cả utterance một lần (`run_engine.py:53-68`). Model streaming
  cần được đút từng chunk.
- `speaker_bench` chỉ _embed_ các clip mà gate đã cắt. Một model joint tự đọc
  waveform liên tục và tự cắt — nó không nhận đầu vào dạng đó.

**Quyết định: hai arm riêng, một manifest dùng chung, không cross-import.**

Lý do: hai harness là hai uv project độc lập. Cross-import buộc phải khai path
dependency giữa chúng, tức một thay đổi ở `stt_bench` có thể làm vỡ
`speaker_bench` và ngược lại — đúng loại ràng buộc mà việc tách project vốn để
tránh. Cái giá của quyết định này là mỗi model chạy hai lần. Với metric tất định
thì đó là chi phí thời gian máy, không phải rủi ro đúng sai.

Manifest dùng chung bảo đảm hai arm chấm **cùng một audio**, nếu không thì hai cột
trong bảng cuối không thuộc về cùng một thí nghiệm.

## Files

**Tạo:**

- `benchmarks/stt/stt_bench/engines/streaming_base.py` — lớp con của `SttEngine`
  thêm **đúng một** method tuỳ chọn:
  `transcribe_incremental(wav_path) -> list[tuple[int, str]]` trả về (mốc ms,
  văn bản tại mốc đó). `transcribe()` vẫn giữ nguyên chữ ký cũ bằng cách đút chunk
  rồi trả text cuối, nên toàn bộ `text_normalize.py`, `metrics.py`, `report.py`
  dùng lại **nguyên xi**.
- `benchmarks/stt/stt_bench/engines/<tên-ứng-viên>.py` — một file mỗi ứng viên
  sống sót Phase 1.
- `benchmarks/speaker-id/run_joint_diarization.py` — runner cho model joint: đút
  audio cuộc họp, nhận (đoạn, nhãn người nói), chấm bằng
  `speaker_bench/scoring.py` đã có.
- `benchmarks/shared-manifest/manifest.json` — danh sách clip dùng chung cho cả
  hai arm, kèm checksum.

**Sửa:**

- `benchmarks/stt/run_benchmark.py` — thêm id ứng viên vào `LOCAL_ENGINES`
  (`:23`) và một cờ `--arm streaming`. Không đụng `DECODER_ARM_ENGINES` (`:36`).

**Không đụng:** `apps/`, `packages/`, `services/`, và mọi thứ trong
`benchmarks/*/results/`.

## Các bước

1. Dựng `streaming_base.py` trước, kèm test cho một engine giả đút chunk — arm
   phải chứng minh được là nó đút từng chunk thật chứ không gọi lại cả file.
2. Viết adapter cho **một** ứng viên, chạy trên 3 câu, xác nhận WER ra được con
   số hợp lý. Chỉ khi đó mới viết các adapter còn lại.
3. Dựng manifest dùng chung. Với arm diarization, quyết định nguồn nhãn — xem
   Rủi ro.
4. Chạy **arm đối chứng** trước bất kỳ ứng viên nào: Zipformer-30M và Moonshine
   qua đúng đường mới, cùng run-tag mới. Nếu không tái lập được 5,38% / 3,86%
   thì **dừng** và tìm nguyên nhân. Đây là N3 trong `plan.md`.

## Xác minh

```bash
cd benchmarks/stt && uv run pytest
cd benchmarks/speaker-id && uv run pytest
# Arm đối chứng, run-tag MỚI để không đụng r1/r2/r3 (R6)
cd benchmarks/stt && uv run python run_benchmark.py --run-tag r4-streaming-control \
  --engines sherpa_zipformer_vi,sherpa_moonshine_en
git status --short benchmarks/   # chỉ được thấy file mới, không file results cũ nào đổi
```

Pass khi: cả hai bộ test xanh; arm đối chứng tái lập 5,38% vi và 3,86% en trong
biên variance đã ghi (RTF pooled 5,0% cho zipformer-vi, 0,6% cho moonshine-en,
`development-journey.md:143`); `git status` không cho thấy `summary.json` nào cũ
bị đổi.

## Rủi ro

**Rủi ro lịch trình lớn nhất của cả kế hoạch: nhãn cho diarization tiếng Việt.**
`benchmarks/speaker-id` dùng VoxVietnam và Vietnam-Celeb cho _verification_ — tức
"hai clip này có cùng người nói không" — chứ không phải diarization có nhãn theo
thời gian. Ba lối, phải chọn ở bước 3 và ghi lại lý do:

1. **Cuộc họp mô phỏng**, như `run_session.py` đang làm: ghép clip của những người
   nói khác nhau thành một phiên, nhãn có sẵn vì do mình ghép. Rẻ nhất, so được
   trực tiếp với mốc 0,78/0,59, nhưng không có overlap giọng thật.
2. **Bộ diarization công khai có nhãn** (AMI đã có sẵn một file trong
   `benchmarks/realtime/fixtures`). Thật hơn, nhưng là tiếng Anh, nên không nói
   được gì về tiếng Việt.
3. **Tự gán nhãn một đoạn thu thật.** Đắt, và cỡ mẫu sẽ nhỏ.

Khuyến nghị: **(1) làm trục chính** vì chỉ nó so được với mốc đã ghi, và (2) làm
đối chứng cho tiếng Anh nếu còn thời gian.

**Adapter đút chunk nhưng thực chất gọi lại cả file.** Đây là cách một arm
"streaming" giả mạo mà không ai phát hiện, và nó sẽ cho ra RTF đẹp giả tạo.
Giảm thiểu: test ở bước 1 phải khẳng định số lần gọi engine bằng số chunk.

## Rollback

Xoá file mới, revert dòng thêm vào `run_benchmark.py`. Không có migration, không
có state.
