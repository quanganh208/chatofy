# Attribution rulers (local data, not tracked)

Everything under this directory except this README and `SHA256SUMS` is
gitignored. It holds real people's voices, their transcripts and embeddings of
their voices, plus a ViYT-Diar derivative whose redistribution terms are
unknown. None of it may be committed.

`SHA256SUMS` pins every data file. A restore is the same ruler only when

```bash
cd benchmarks/speaker-id/rulers && sha256sum -c SHA256SUMS
```

passes. `viyt-diar/results/rulers.pkl` is a pickle: loaders verify its hash
against `SHA256SUMS` before unpickling it, and so must anything new that reads
it.

## `viyt-diar/`

The ViYT-Diar and old-prod attribution ruler built on 2026-09-26
(`report.md` is the write-up; `harness/*.py` are the scripts that built it).

- `results/rulers.pkl`: dict keyed `viyt/clean`, `viyt/far` (100 meetings each),
  `prod` (8 old browser recordings) and `vox/...` (VoxVietnam synthetic
  meetings). Each meeting is a dict with `truth` (speaker per turn),
  `speech_ms` (annotated speech per turn), `cam` (CAM++ vectors) and `hynt`.
  Built by `harness/build_viyt_turns.py`, `harness/eval_prod_recordings.py`
  and `harness/product_arm.py`.
- `results/*.npz`: the embedding caches behind it; `results/*.json`: the sweep
  summaries quoted in `report.md`.

Read by `run_attribution_rulers.py` and `tests/test_attribution_rulers.py`.

## `conversations/`

Five real vi→en sessions recorded on 2026-09-29 (`<conversationId>.webm`), with
ElevenLabs Scribe references (`*.scribe.json`), the saved turns
(`*.turns.tsv`), the scoring windows (`windows.json`, `windows_emb.json`), the
API log of the sessions (`api.log`) and the scratch analysis scripts that
produced the plan's evidence (`sim.py`, `embwin.py`, `vad.py`, ...).

- `silero_vad.onnx` here is **harness only, not the sidecar asset**. The sidecar
  pins its own Silero model by sha256 in
  `services/local-stt/audio/silero_speech.py`.
- Derived files written later are ignored like the rest: `ruler.json` and
  `noise-clips.json` (`scripts/build_conversation_ruler.py`), `*.wav` and the
  cut baselines (`scripts/cut_placement.py`).

Read by `run_attribution_rulers.py`, `scripts/build_conversation_ruler.py`,
`scripts/split_cosine_sweep.py`, `scripts/cut_placement.py` and
`tests/test_segment_parity.py` (via `SPEAKER_BENCH_GATE_FIXTURES`).

## Restore

The data has no public source. Restore it from a local backup of this directory,
then re-run the checksum command above. The 1cd04a39 STT-ruler inputs live
beside the STT bench, also ignored, in `benchmarks/stt/data/prod-recordings/1cd04a39/`.
