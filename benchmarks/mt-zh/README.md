# mt-zh: production translator on Mandarin directions

This harness measures the shipped DeepSeek provider (`translation-providers.mjs` preset `deepseek`)
on vi→zh, zh→vi, en→zh and zh→en. It also runs vi→en and en→vi as the baseline. All six directions
use the same 200 FLoRes sentences.

## Files

- `build-sentences.py` draws the sentence set into `data/sentences.jsonl`. It reads 200 FLEURS test
  ids that exist in `cmn_hans_cn`, `vi_vn` and `en_us`, using seed 42 and the `raw_transcription`
  column. The licence is CC-BY-4.0. The script refuses to re-draw if the file already exists.
- `run.mjs` translates every sentence in every direction. It writes one jsonl file per direction to
  `results/<tag>/` plus `meta.json`, which records the captured system prompt and request flags.
  It refuses an existing tag.
- `score.py` computes chrF++, plain chrF, COMET wmt22-comet-da, latency, failures, the
  script/leakage checks and token cost. It writes `results/<tag>/scores.json`.

## The one deviation from production

The registry (`packages/types` `LANGUAGES`) has no `zh`. The prompt builder reads
`LANGUAGES[code].englishName`, so a zh request throws before any traffic is sent. `run.mjs` handles
this by adding `zh: { englishName: 'Simplified Chinese' }` at runtime to the same module instance
that the provider imports. It then asserts from the captured request that the prompt names it.
Everything else in the request comes from production code.

## Run

```bash
cd benchmarks/mt-zh && uv run --no-project --with duckdb python -I build-sentences.py   # once
DEEPSEEK_API_KEY=... node benchmarks/mt-zh/run.mjs --tag <new-tag>                      # ~1 h, ~$0.4
cd benchmarks/live-translate && flock <cpu-lock> uv run --frozen --with "setuptools<81" \
  --with opencc-python-reimplemented python -I ../mt-zh/score.py ../mt-zh/results/<tag>  # ~8 min CPU
```

The scorer borrows the `live-translate` environment, which has the same sacrebleu and unbabel-comet
pins. The `setuptools<81` overlay is needed because `comet` still imports `pkg_resources`.
