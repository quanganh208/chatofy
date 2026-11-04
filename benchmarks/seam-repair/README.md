# Seam repair

Does re-reading the audio around a forced cut recover words the recognizer dropped, without adding wrong ones?

The bar is no wrong word added, so `score.mts` prints every insertion as well as WER. It imports the function the API ships rather than a copy of it. Measurement only: this directory is not part of the pnpm/turbo workspace.

## Steps

Recordings and transcripts are private and stay out of git. Build a working directory the way `benchmarks/translation-judge` does, one set per recording:

- `<conv>.pcm`: 16 kHz mono int16, decoded from the R2 webm with PyAV.
- `<conv>.json`: the Scribe answer, from `benchmarks/translation-judge/data/scribe/`.
- `<conv>.turns.json`: `npx tsx benchmarks/speaker-id/edge-replay/replay-turns.mts <conv>.pcm <conv>.turns.json`, the real `CapturePump` with the web client's options.

Copy the models out of the prod image with `docker cp`. Then:

```bash
uv run --no-project --python 3.11 --with sherpa-onnx==1.13.4 --with onnxruntime==1.27.0 --with numpy \
  python benchmarks/seam-repair/decode_seams.py --dir <dir> --models <models> --lang en <conv>...
npx tsx benchmarks/seam-repair/score.mts <dir> en
```

Never decode against the prod sidecar on port 8012. A sweep there killed it on 2026-10-13.

## Results, 2026-11-04

7 English recordings (2,614 words, 82 forced cuts) and 6 Vietnamese (2,640 words, 66), Parakeet and Zipformer 30M, against Scribe.

| Arm                                 | en WER | vi WER | Note                                   |
| ----------------------------------- | ------ | ------ | -------------------------------------- |
| Today                               | 4.02%  | 5.98%  |                                        |
| Insert only, shipped                | 3.71%  | 5.83%  | 6 insertions, all right                |
| Seam window, replace text           | 3.48%  | 6.89%  | deleted an 18-word phrase              |
| Left context on the next turn       | 3.71%  |        | 5 new errors                           |
| Tail padding on all turns, 300 ms   | 3.67%  |        | 8 new errors, invents endings          |
| Whole-block re-decode               | 4.63%  |        | worse, and memory-bound on the sidecar |
| Pump opens the next turn at the cut | 3.94%  |        | 3 fixed, 2 new                         |

The short-left arm reproduces a piece left by a voice change, at 0.8, 1.4 and 2 s. All 16 English insertions were words said at that seam. On Vietnamese, one of 3 dropped a word ("XIN MỜI VÂNG" for "XIN MỜI ANH VÂNG") but added none that was not said.
