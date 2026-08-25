# mini-MOS listening panel

Blinded, within-subjects naturalness panel: session builder, rating form, and
aggregation. **Not** part of the pnpm/turbo workspace and never imported by the
app — standalone `uv` Python project, same convention as `benchmarks/stt`,
`benchmarks/tts`, `benchmarks/realtime` and `benchmarks/live-translate`.

It exists because two quality claims in this repo currently rest on one person's
ears. `docs/development-journey.md` records the Kokoro-over-Piper decision as a
single-listener A/B and flags multi-listener MOS as the open rigor question; the
live-translate harness specifies a panel under § Naturalness but stops short of
automating it. This is that automation.

MOS figures quoted from model cards (Kokoro ~4.5) are **not** substitutes. They
were measured on other corpora, other listeners, and other hardware, and say
nothing about how this project's output sounds.

## What it measures, and what it does not

Naturalness of output audio, on a 5-point scale, and nothing else. Adequacy is
scored separately on transcripts by `benchmarks/live-translate/score-adequacy.py`.
The two are deliberately kept apart: a listener who can hear both the voice and
the meaning will let a pleasant voice raise the adequacy score.

## Setup

```bash
cd benchmarks/mos
uv sync
```

## Test

```bash
uv run pytest
```

## 1. Describe the clips

`data/clips.jsonl`, one row per piece of audio:

```json
{"clip_id": "u012", "system": "sherpa-kokoro-en", "lang": "en", "path": "clips/kokoro/u012.wav"}
```

`clip_id` names the **material** — the utterance every system was asked to
render — so it recurs once per system. `system` is what the panel must never
see. Every system must cover the same `clip_id`s per language, and the builder
refuses to proceed otherwise: if one system is missing a clip the others have,
its mean comes from different content than its rivals and the comparison stops
being about the systems.

## 2. Build the session

```bash
uv run python build_session.py --manifest data/clips.jsonl --out session \
    --listeners 10 --seed 42
```

Writes `session/audio/` (clips copied to opaque `c-####` names),
`session/listener-<id>.html` (one form each), and `session/key.json`.

Hand out the HTML files. **Keep the key.** It is the only thing mapping a rating
back to a system, and a listener who sees it is no longer blinded — which is why
`session/` is gitignored wholesale.

Three properties are enforced here rather than left to discipline:

- **Blinding survives reading the page source.** Audio is copied, not linked, to
  names drawn in a seeded shuffle that ignores system and clip id. A symlink
  would resolve to a path naming the system; sequential numbering in manifest
  order would encode it, since manifests are grouped by system.
- **Order is drawn per listener.** One shared order lets fatigue or drift land on
  the same system for everyone, which then reads as a quality difference.
- **Every listener rates every system on the same clips.** A generally harsh or
  generous listener then shifts all systems together and cancels out.

## 3. Collect

Listeners open their form, use headphones, rate each clip, and press **Download
ratings**. The page refuses to export until every item is scored — a partial
return is the main way a within-subjects panel goes lopsided, and stopping it
there is cheaper than dropping the listener later. Collect the files into
`returned/`.

Panel size: 8–12 listeners. Below that, the interval is usually too wide to
separate two decent systems, which the report will say outright.

## 4. Aggregate

```bash
uv run python aggregate_ratings.py --key session/key.json --ratings returned/ \
    > results/panel-r1.md
```

Screening runs first and is reported whether or not anyone was dropped, because
"12 listeners, none excluded" and "12 listeners, 4 excluded" are different claims:

| Flag | Meaning |
| --- | --- |
| `attention` | The two ratings of one identical clip differ by more than the tolerance (default 2). Same audio both times, so a wide gap is evidence about the listener. |
| `flat` | Every rating identical — indistinguishable from clicking down the page. |
| `incomplete` | Items skipped, so the systems were not rated on equal material. |

Use `--include-flagged` to score everyone anyway; the report states that it did.

### The two decisions that carry the result

**The unit of analysis is the listener.** MOS is the mean of each listener's
mean, and the 95% interval is computed over those with n = the number of
listeners. Pooling individual ratings instead would inflate n by the clip count:
12 listeners rating 40 clips is 12 independent observations, not 480, because one
listener's ratings are correlated with each other. The pooled version produces a
much tighter interval that the panel never earned.

**Repeat presentations are screening data, not score data.** Only the first
presentation of a clip enters the MOS. Counting both would double-weight
whichever clips happened to be drawn as attention checks.

The report also states whether the top two systems' intervals actually separate.
A higher mean with overlapping intervals is a tie, and should be reported as one
rather than as a win.

### Inter-rater agreement

ICC(2,1) and ICC(2,k), two-way random effects, absolute agreement, over a
complete stimuli × listeners matrix. ICC(2,1) is how far one listener alone can
be trusted; ICC(2,k) is how far the panel mean can be, which is the figure that
matters when the deliverable is a MOS. Listener is modelled as a random effect,
so a uniformly harsh rater costs agreement instead of being absorbed silently.
The implementation is checked against the Shrout & Fleiss (1979) worked example.

Conventional bands: ≥0.90 excellent, ≥0.75 good, ≥0.50 moderate, below that poor.

## Unresolved questions

- Is a classmate panel acceptable to the committee, or is an automatic predictor
  expected? UTMOS is English-trained and NISQA needs an explicit caveat, so
  neither is a drop-in substitute for Vietnamese.
- 8–12 listeners is the target. If fewer return, report the reduced n rather than
  quietly scoring whoever showed up.
