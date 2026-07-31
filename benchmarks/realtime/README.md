# Realtime harness

Fixtures and analysis for the turn-taking path: how well capture keeps up, how far a
translation falls behind the speaker, and what a run costs in metered requests.

Everything here is plain Node with no dependencies. Nothing is committed except the
scripts — audio and metrics are regenerated.

| Script                   | What it produces                                                    |
| ------------------------ | ------------------------------------------------------------------- |
| `generate-fixtures.mjs`  | Synthesized Vietnamese turns, chosen for the shape of their pauses  |
| `vad-reference.mjs`      | Speech duration of a recording — the **denominator** of coverage    |
| `analyze-continuous.mjs` | Coverage, drift, requests-per-minute per model, from the JSONL sink |

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
