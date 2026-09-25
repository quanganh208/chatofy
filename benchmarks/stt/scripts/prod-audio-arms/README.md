# Prod-audio arms — STT candidates scored on real Chatofy recordings

The runners behind `plans/reports/brainstorm-260925-1152-streaming-stt-prod-audio-evaluation.md`.
They are committed on purpose, like `../streaming-arms/`: scratchpad copies get lost.

**No audio and no transcripts are committed.** They are private user conversations.
Rebuild the working directory (`<dir>`) from prod read-only:

- `index.tsv`: `clientId, id, direction, audioKey, audioOffsetMs, startedAt, endedAt`, one row per conversation with `audioKey`.
- `<clientId>.webm`: `R2_PUBLIC_BASE_URL/<audioKey>`.
- `<clientId>.turns.tsv`: `position, offsetMs, speakerLabel, sourceText, targetText`.

## Run order (sequential; parallel runs distort RTF)

```bash
uv run --with faster-whisper --with soundfile python ref_all.py <dir>        # decodes wav + Whisper large-v3 ref
uv run --with faster-whisper --with huggingface_hub python ref_pho.py <dir>  # PhoWhisper-large (vi) cross-reference
cd benchmarks/stt && uv run python scripts/prod-audio-arms/prod_arms.py <dir> cur-oracle,nemo560,nemo1120,zf70k-oracle,hyntS,pcs,nemoen560,puni560,tdt-oracle,pcs-oracle,hyntS-oracle,pcs-prime3,pcs-prime6
uv run --with moonshine-voice --with soundfile python prod_moonshine.py <dir>
uv run python scripts/prod-audio-arms/score.py <dir> <arms> <refname: ref|elref|phoref> [vi|en]
```

The ElevenLabs reference (`<clientId>.elref.json`) came from one `POST /v1/speech-to-text` per recording (`model_id=scribe_v2`). It sends user audio to a third party, so run it only with the maintainer's approval.

Arm naming:

- `-oracle`: decoded on reference word-gap segments (≤8 s), one fresh stream per segment.
- No suffix (streaming models only): the whole recording is fed continuously, with no turn cuts.
- `-primeN`: a fresh stream per segment, first fed the preceding N s of audio; that prefix's text is dropped.

`clean_arms.py` writes `results/r10-prod-audio/*-clean.jsonl`. These are pcs and hyntS on the fixed VIVOS and LibriSpeech manifests, with streaming stats.
