# Realtime harness

Fixtures and analysis for the turn-taking path: how well capture keeps up, how far a
translation falls behind the speaker, and what a run costs in metered requests.

Everything here is plain Node with no dependencies. Nothing is committed except the
scripts — audio and metrics are regenerated.

| Script                          | What it produces                                                        |
| ------------------------------- | ----------------------------------------------------------------------- |
| `generate-fixtures.mjs`         | Synthesized Vietnamese turns, chosen for the shape of their pauses      |
| `vad-reference.mjs`             | Speech duration of a recording — the **denominator** of coverage        |
| `analyze-continuous.mjs`        | Coverage, drift, first-audio-vs-length, commit health, req/min          |
| `prefix-stability.mjs`          | Whether a re-decoded prefix stays put, and the agreement depth it needs |
| `gemini-continuation-probe.mjs` | Whether a translation model continues without rewriting what was spoken |

## Where a fixture may come from, and what it can honestly answer

Three sources, and they are not interchangeable. Using the wrong one does not
produce a wrong number — it produces a **flattering** one, which is worse,
because nothing about it looks broken.

| Source                                            | Legitimate for                                                                                  | Flatters, do not use for                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **ElevenLabs**                                    | commit-policy correctness, latency, quota, pause structure — the timing is exactly controllable | VAD robustness, WER, disfluency, echo                                 |
| **Public datasets** (AMI, Bud500)                 | disfluency, room tone, real speaking rate, WER against a reference transcript                   | nothing — but note the licence, and that AMI is English only          |
| **`generate-fixtures.mjs`** (our own TTS sidecar) | quick smoke tests                                                                               | anything reported, because the system would be grading its own output |

Synthetic speech has no room tone and no coarticulated hesitation, so a gate
measured only against it will look far more robust than it is. That is the whole
reason the dataset leg exists.

**Vietnamese is the weaker leg and the report must say so.** English has AMI:
whole unsegmented meetings, real disfluency, far-field microphones, CC BY 4.0.
There is no public Vietnamese equivalent — every available corpus is already cut
into short utterances, and the ones with the friendliest licences turn out to be
audiobook and news readings rather than natural speech. Vietnamese long-form
fixtures are therefore **assembled by concatenation**, which reproduces length
and pause structure but not real conversational dynamics. Never present the two
directions as equally evidenced.

> AMI's licence is **CC BY 4.0** per the corpus site. The OpenSLR mirror still
> states an older CC BY-NC-SA 2.0; cite the corpus site, and attribute.

## Coverage, and the one way it lies

Coverage is `Σ capturedMs / speechMs`. Both halves have a trap in them, and both are
guarded here rather than left to whoever reads the number.

**The denominator must not come from `SpeechGate`.** `vad-reference.mjs` deliberately
shares no reasoning with it: a threshold derived from the whole file's energy
distribution, with hysteresis and minimum-duration rules, where the gate uses a
streaming adaptive floor. Offline analysis can use statistics over the entire
recording; a realtime gate structurally cannot. If the denominator came from the gate,
speech the gate missed would leave both numerator and denominator — and a gate that
heard nothing at all would score 100%.

**The numerator must include every turn.** `capturedMs` is summed over all outcomes,
including `rejected`, `dropped` and `error`. Turns that never played were still
captured. Counting only the ones that played measures the success rate of playback, and
that figure goes _up_ as the pipeline breaks.

## Typical run

```bash
# Once, needs the TTS sidecar on :8003
node benchmarks/realtime/generate-fixtures.mjs

# The denominator, from the recording itself
node benchmarks/realtime/vad-reference.mjs path/to/meeting-3min.wav
node benchmarks/realtime/vad-reference.mjs --manifest        # every fixture

# The run. Needs TURN_METRICS_PATH set on the api, and "Report timings for
# measurement" ticked in the extension popup — either one missing and half of
# every row is absent.
node benchmarks/realtime/analyze-continuous.mjs turns.jsonl --speech-ms 174300
```

## Reading the streaming-commit numbers

- **The intercept is the headline, not the slope.** First-audio latency is
  plotted against how long the PASSAGE was, never against how long a turn was:
  `MAX_UTTERANCE_MS` cuts every turn at 8s, so turn-scoped latency is already
  flat above that ceiling whether or not anything streams. Measured that way a
  broken build and a working one score the same. The baseline plateaus near
  ~9.2s (the cut plus one pipeline pass); the streaming path has to drop that
  intercept while staying flat.
- **Slope needs more than one fixture length.** A single `--passage-ms` gives an
  intercept and no slope, by construction. Run the short and long fixtures and
  compare.
- **"Not recorded" never means zero.** Runs without streaming turns print `—`
  for the commit metrics rather than `0`. A run that could not measure
  contradictions must not be readable as a run that found none.
- **Commit starvation is the failure the other metrics call a pass.** When
  agreement never stabilises, nothing is committed: no clause is contradicted,
  no gap exists between clauses that were never spoken, and the latency
  percentiles quietly lose the passage instead of scoring it slow. The listener
  hears the translation die mid-sentence. That is why the worst
  speech-with-nothing-committed wait is reported on its own.
- **A dropped streaming turn is not a dropped sentence.** `OrderedPlayback`
  discards later frames for a turn it has released, so on a long committing turn
  one drop silences the remainder of the passage. Report the seconds lost, not
  just the count.

## Reading the output

- **Requests per minute is per model and must not be summed.** The free tier meters
  per model, so either of the two flash-lite models can be exhausted while a combined
  figure looks healthy.
- **Rows marked incomplete are usually quota.** Expected at this request rate until key
  rotation exists. Report the count and say it was expected, or a later reader will
  hunt for a fault that was never there.
- **A climbing drift line is a finding, not a failure.** Capturing continuously while
  playing turns back to back means utilisation is ~100% before overhead; one turn on
  the p95 tail pushes every later turn back permanently.

The step-by-step procedure, including the echo and oversubscription measurements that
need real hardware, is in
[`plans/reports/measure-260730-continuous-capture-runbook.md`](../../plans/reports/measure-260730-continuous-capture-runbook.md).
