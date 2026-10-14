# local-stt sidecar

Local speech-to-text over localhost, no cloud call. Wraps [sherpa-onnx][sherpa]
behind a small FastAPI service so the NestJS API can transcribe Vietnamese,
English and Mandarin Chinese through the normal `SttProvider` contract.

Standalone `uv` project — not part of the pnpm/turbo workspace, never imported
by the app (standalone `uv` project, like the benchmark harnesses).

## Models

| Language | Model                                         | WER       | RTF   | p95   | RAM    | License             |
| -------- | --------------------------------------------- | --------- | ----- | ----- | ------ | ------------------- |
| vi       | [hynt/Zipformer-30M-RNNT-6000h][zipformer]    | 5.38%     | 0.017 | 0.09s | 223MB  | **CC-BY-NC-ND-4.0** |
| en       | [Parakeet-TDT-0.6b-v2][parakeet] (INT8)       | —         | —     | 0.33s | ~1.1GB | CC-BY-4.0           |
| zh       | [Paraformer-zh 2023-09-14][paraformer] (INT8) | 3.22% CER | 0.018 | 0.18s | ~360MB | Apache-2.0          |

Numbers measured on this machine — see
`docs/development-journey.md` for the method and
the alternatives that lost.

> Those WERs are read speech (VIVOS, LibriSpeech). On a real conversation —
> spontaneous, with filler, brand names and English mixed in — the Vietnamese
> engine measured **13.4%** against an independent reference transcript. Both
> numbers are true of the same model; quote whichever matches the condition you
> are describing.

> **English is Parakeet-TDT, not Moonshine base.** On six prod recordings
> replayed through the client's own speech gate, Parakeet scored **3.4% vs 7.4%**
> WER. It answers both the live re-read every 300ms and the settled transcript.
> Under two directions of load on this host: re-read p95 284ms, final p95 327ms,
> no 503s, peak RSS 1.36GB. See `docs/development-journey.md`.
>
> Parakeet answers a cough or knock with a filler ("Uh", "Mm.") where Moonshine
> answered with nothing, so a transcript made only of fillers is returned empty
> and the API rejects the turn as no speech (`FILLERS` in `engines/parakeet_en.py`).

> **Mandarin is Paraformer-zh, not SenseVoice-small.** Mean CER over FLEURS and
> AISHELL-1 (50 clips each) was 3.22% against SenseVoice's 4.58%, and the sidecar
> reproduces 3.22% exactly over HTTP on the same clips. With the 320 ms of
> silence the client puts before every turn it reads 3.59%: Paraformer is a
> little sensitive to leading silence, 10 of 100 hypotheses change, not all for
> the worse. It writes no punctuation and every number as words; the API's zh
> ITN typesets the numbers. Its weights add about 270 MB to the sidecar's peak
> under four concurrent decodes. The tarball is pinned by size and sha256 in
> `scripts/download_models.py`, and only `model.int8.onnx` and `tokens.txt` are
> extracted. No hotword biasing.

> **Display punctuation (zh).** `POST /restore` with `language: "zh"` runs
> sherpa-onnx's CT-Transformer punctuation model
> (`sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8`, 64.7 MB
> tarball, pinned by GitHub's published digest, only `model.int8.onnx`
> extracted). It inserts marks only; the spaces Paraformer wrote around Latin
> tokens are put back after it, because the model drops them. On the 50 FLEURS
> Paraformer hypotheses: punctuation F1 0.865, words kept 50/50, p95 16 ms over
> HTTP, +80 MiB peak. Optional like Dewpoint: an unloaded zh model answers 404,
> which the API's per-language cooldown reads as "stop asking for zh a while" —
> it can never pause vi restores. No per-word pauses for zh: the model reads text only.

> **Display punctuation and case (vi).** `POST /restore` runs
> [valkayuh/dewpoint][dewpoint] (MIT), mmBERT member, pinned revision, with only
> its token embedding quantized to 8 bits by `scripts/quantize_embedding.py` at
> seed time (641 MB, ~1 GB RSS). It is a tagger and cannot add, drop or reorder a word. On 36 rows from 7
> recorded sessions against Scribe v2 it took punctuation F1 from 0 to 0.62, case
> F1 from 0.29 to 0.86 and "AI" from 0/26 to 26/26. Quantizing the MatMuls as
> well lost "AI" on 7 of 26 calls, so they stay fp32. The result is display only;
> the raw transcript stays canonical. See `punctuation/restorer.py`. Mixed-case
> names ("OpenAI") are beyond a per-word lower/Capital/UPPER tagger: the sidecar
> applies only the model's own gazetteer and the caller's mixed-case `terms`, and
> the API takes the rest from the turn's translation.
> Two measured post-rules lower the model's mid-sentence capitals ("Anh, Xin kính
> chào", "chào Anh Tuấn"): after a comma only for words in
> `punctuation/lowercase_words.json` (counted from ViCapPunc train), and a title
> word only before a capitalized name. The model and the rules were chosen by
> `benchmarks/punct` against every usable vi tagger.
> For Vietnamese, `/transcribe` also returns `pauses`, the silence after each
> word in ms (`engines/word_pauses.py`), and `leadPause`, the silence before the
> first word. `/restore` takes the pauses back and drops a
> full stop the speaker did not pause at (under 120 ms, chosen on FLEURS dev in
> `benchmarks/punct`).

> **Alternate vi recognizer (optional).** [hynt/ZipFormer-150M][zipformer150]
> (INT8, pinned revision, greedy, never biased) decodes the same final turn
> beside the 30M when a request sets `alternates=true`, and its reading comes
> back as `alternates: ["…"]`. The API lets an LLM pick words between the two
> for the display; the 30M's `text` stays the transcript of record. On the
> 95-turn vi ruler the 30M alone is 5.72% WER, this model alone 6.30%, the two
> fused ~4.9%. Missing weights are a startup warning, not a failed `/healthz`,
> which lists what loaded in `alternates` (`["vi"]` or `[]`). Measured on 95
> real turns at 4 threads: +53 ms p50 / +100 ms p95 per final (the two decodes
> run concurrently, so the cost is the 150M's extra time, not its whole
> decode), +411 MiB peak RSS under four concurrent finals. Same license as the
> 30M.

> **License obligation.** Zipformer-30M (and the 150M alternate) is CC-BY-NC-ND-4.0: **academic / thesis
> use only**, no commercial use, no distribution of derivatives. If this project
> is ever commercialized, swap in PhoWhisper behind the same `SttProvider`
> contract (measured at ~1.3s/utterance instead of ~0.1s).

## Run

This is a container — `pnpm dev:all` from the repo root builds it and brings it
up with the rest of the local stack. `models/` is bind-mounted and the weights
(~1.6GB) download on first start, so there is no separate setup step.

```bash
docker compose up -d --wait local-stt   # just this one
docker compose logs -f local-stt
```

To work on the Python directly instead:

```bash
cd services/local-stt
uv sync
# The sherpa-onnx wheel omits libonnxruntime.so while its native module asks the
# loader for exactly that name, so `import sherpa_onnx` fails until it is linked
# to the versioned file onnxruntime ships. The image does this at build time; a
# host venv needs it again after every `uv sync` that recreates .venv.
ln -sf "$(uv run python -c 'import onnxruntime,pathlib;print(next((pathlib.Path(onnxruntime.__file__).parent/"capi").glob("libonnxruntime.so.*")))')" \
       "$(uv run python -c 'import onnxruntime,pathlib;print(pathlib.Path(onnxruntime.__file__).parent.parent/"sherpa_onnx.libs"/"libonnxruntime.so")')"
uv run python scripts/download_models.py   # ~2.7GB, one time, idempotent
uv run uvicorn app:app --port 8002
```

sherpa-onnx and onnxruntime are pinned to exact versions, not floors: sherpa-onnx
links libonnxruntime by versioned symbol and its wheel does not bundle the
library, so the two are one ABI pair. sherpa-onnx 1.13.5 and 1.13.6 both need
onnxruntime 1.27.1, which PyPI has never published — neither is installable here.

Both models load eagerly at startup (~6s), so `/healthz` returning 200 means
the service is genuinely ready.

## API

| Route              | Request                                                                                                                                                  | Response                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /healthz`     | —                                                                                                                                                        | `200 {"status":"ok","alternates":["vi"]}` when loaded, `503 {"status":"loading"}` otherwise |
| `POST /transcribe` | `multipart/form-data`: `file` (audio), `language` (`vi` or `en`), `hotwords` (repeatable, optional), `min_speech_ms` (optional), `alternates` (optional) | `200 {"text":"…","language":"vi"}`                                                          |
| `POST /embed`      | `multipart/form-data`: `file` (audio)                                                                                                                    | `200 {"vector":[…],"dim":192,"speechMs":1480}`                                              |
| `POST /restore`    | JSON: `text`, `language` (`vi` only), `context` (optional, the piece this one continues), `terms` (optional, session hotwords)                           | `200 {"text":"Mô hình AI của OpenAI."}`                                                     |

`speechMs` on `/embed` is how much of the clip is speech, not how long the clip
is — the caller is sent a capture buffer with pre-roll and hangover on it, and
the difference is what tells it whether the vector was built on enough voice to
mean anything. Energy-based; see `audio/speech_duration.py`.

`POST /restore` returns `400` for a language it has no restorer for, `503` when
the Dewpoint weights were never seeded, `404` when the zh punctuation model was
never seeded, and `429` when another restore holds the
model for longer than 150 ms (`LOCK_WAIT_S` in `punctuation/restorer.py`). The
two refusals mean different things to the API: `503` makes it stop asking for a
while, `429` is a momentary queue and only that one line falls back. The wait is
sized so a request behind one other restore (~110 ms p95) still finishes inside
the API's 300 ms budget; it refuses rather than queues further, because a longer
wait only holds a worker thread for an answer the caller stopped waiting for.
A sidecar without the weights still transcribes; `/healthz` reports
`"restore": false` without failing readiness, and the API falls back to the
numerals-only display.

`POST /transcribe` returns `400` for an unsupported language or undecodable
audio, `413` for audio longer than `LOCAL_STT_MAX_AUDIO_SECONDS`, and `503`
before the models finish loading, or when every decode lane (or every VAD
detector — see below) is busy past `LOCAL_STT_LANE_WAIT_MS`.

```bash
curl -F file=@sample.webm -F language=vi http://localhost:8002/transcribe
# biased towards terms this conversation is known to use
curl -F file=@sample.webm -F language=vi -F hotwords=poker -F hotwords=Target \
     http://localhost:8002/transcribe
```

### Speech gate

`min_speech_ms` is opt-in and off by default (`0`): a request that does not set
it decodes exactly as it always did, no VAD call, no `speechMs` field. Set it
and the sidecar measures speech with a pinned Silero VAD **first**; a clip
under the floor returns `{"text":"","language":"vi","speechMs":180}` without
the engine ever running, and one at or above it decodes normally and returns
`speechMs` alongside `text`. `/embed` is unaffected — nothing asks it for
Silero, so it runs none. See `audio/silero_speech.py` for the pinned model, its
sha256, and why a request that cannot get a VAD detector within the lane wait
budget gets `503` rather than a queue.

```bash
# below 300ms of Silero-detected speech, text comes back empty and the engine
# never runs
curl -F file=@sample.webm -F language=vi -F min_speech_ms=300 \
     http://localhost:8002/transcribe
```

### Alternates

`alternates` is opt-in and off by default: a request that does not set it is
answered byte for byte as before, with no second decode. Set it on a vi final
and the response gains `"alternates": ["…"]`, the 150M's unbiased reading of the
same samples. The key is simply absent — never an error — when no alternate is
loaded for the language, when `min_speech_ms` gated the turn, or when the
alternate's lanes were busy or its decode failed. It has its own lanes, so it
never takes one from the 30M's live re-reads.

```bash
curl -F file=@sample.webm -F language=vi -F alternates=true \
     http://localhost:8002/transcribe
# {"text":"…","language":"vi","pauses":[…],"leadPause":320,"alternates":["…"]}
```

### Hotwords

Terms the Vietnamese decoder should be biased towards, one form field each,
upper-cased and capped at 48 on arrival. English is the case they exist for: the
Vietnamese model has no path to an English word, so it emits the Vietnamese
syllables that sound closest — measured on a real conversation, "giải poker"
became "giải quốc cơ" and reached the reader as "a national championship".

**A turn that names none decodes exactly as it always did.** `greedy_search`
stays the default, as `docs/development-journey.md` 3.10 recorded, and biasing
lives on a second `modified_beam_search` recognizer chosen only when terms
arrive — `+59MB` RSS, and RTF 1.36x on the biased turn alone.

There is deliberately **no standing list** in the service. One was built and
measured: 28 common English words moved WER on that conversation from 0.137 to
0.148, because biasing towards a word nobody said costs real Vietnamese. Terms
come from the conversation (`TranslationHints.hotwords`), or not at all.

English is unaffected: the Parakeet engine is not set up for biasing, and is
handed none rather than handed them and left to ignore them.

Audio is decoded with PyAV, which bundles its own ffmpeg libraries — **no ffmpeg
binary needs to be installed**. Anything ffmpeg reads works: the browser's
`audio/webm;codecs=opus`, plus uploaded mp3/m4a/wav/flac/ogg. Input is always
resampled to mono 16 kHz because both models are trained at that rate.

## Configuration

| Env                           | Default | Purpose                                                                       |
| ----------------------------- | ------- | ----------------------------------------------------------------------------- |
| `LOCAL_STT_THREADS`           | `8`     | Threads per engine. 8 (physical cores) beat 16 (hyperthreads) on this machine |
| `LOCAL_STT_MAX_AUDIO_SECONDS` | `300`   | Longest utterance accepted; longer audio returns `413` instead of decoding it |

## Test

```bash
uv run --directory services/local-stt pytest
```

`test_decode.py` needs no model weights. `test_app.py`, `test_embed.py` and
`test_silero_speech.py` load the real models; skip them with
`LOCAL_STT_SKIP_MODEL_TESTS=1`.

[sherpa]: https://github.com/k2-fsa/sherpa-onnx
[zipformer]: https://huggingface.co/hynt/Zipformer-30M-RNNT-6000h
[zipformer150]: https://huggingface.co/hynt/ZipFormer-150M-CR-CTC-RNNT-6000h
[parakeet]: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2
[paraformer]: https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-paraformer/paraformer-models.html
[dewpoint]: https://huggingface.co/valkayuh/dewpoint
