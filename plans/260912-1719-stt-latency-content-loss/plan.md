---
title: 'STT latency and content loss on the turn path'
description: 'Bound every unbounded dependency call, stop the speculation fan-out, make discarded audio countable, then add STT concurrency for multi-user headroom.'
status: in-progress
priority: P1
effort: '2-3d'
tags: [stt, latency, realtime, reliability]
created: 2026-09-12
---

# STT latency and content loss on the turn path

## Overview

Users report speech-to-text "quá chậm, không trả về text kịp theo lời nói, mất từ mất
nội dung rất nặng" while RAM and CPU sit nearly idle. Measurement on prod
(`ssh.quanganh208.dev`) shows STT inference is **not** slow: a warm request decodes 6–8s
of audio in 70–200ms (RTF ≈ 0.012–0.025). The sidecar instead **serializes every decode
behind one `threading.Lock()` per engine**, so requests queue FIFO while the 16-core
machine stays ~72% idle — the signature of lock contention, not of saturation.

The accepted brainstorm contract is
[`plans/reports/brainstorm-260913-0001-stt-latency-lock-contention.md`](../reports/brainstorm-260913-0001-stt-latency-lock-contention.md).
Its outcome, constraints, non-goals and acceptance criteria are reused here and are not
re-derived.

**Priority is reordered against that contract, on evidence the contract itself asked
for.** The user confirmed the failing load is **one person, one tab**. Lock saturation
needs roughly three concurrent sockets: measured, one and two concurrent partial streams
hold the 300ms cadence target (296ms achieved), and only the third breaks English
(500ms cadence, 41% of live updates lost). So the recognizer pool is **multi-user
headroom, not the fix for the reported symptom**. The contract's own risk #2 predicted
this: "If the answer is one, expect a second contributing cause (unbounded Gemini tail,
leading candidate)."

For a single speaker the mechanism that loses content is a chain, not the lock:

1. **Gemini has no timeout** (p50 723ms, p95 1947ms, **max 8943ms** measured in-repo).
2. A slow turn holds its slot; `MAX_IN_FLIGHT = 3` fills; the server refuses with
   `too_many_turns`.
3. The client retries 4 × 750ms, then **discards the whole pending buffer** — with a
   `console.warn` and nothing on screen.
4. Up to **4 uncancellable speculations per turn** each spend a full-turn STT decode plus
   a metered Gemini request, so the fan-out both feeds the queue and burns the quota that
   makes step 1 worse.

## Goals

| #   | Goal                                                                                                         | Priority |
| --- | ------------------------------------------------------------------------------------------------------------ | -------- |
| 1   | No outbound call can hang: a wedged dependency fails its turn instead of pinning 1 of 6 global slots         | P1       |
| 2   | Cap the speculation fan-out so one turn cannot spend 4 full-turn decodes and 4 metered requests              | P1       |
| 3   | Every discarded block is counted and every dropped turn is visible; `sentMs` stops reporting unsent audio    | P1       |
| 4   | STT decodes concurrently (pool) and partial re-decodes cost-adapt, giving headroom for 3+ simultaneous users | P2       |
| 5   | Prove the change against the user's complaint with real numbers, not assertion                               | P2       |

## Phases

| #   | Phase                                                                                | Status                                                                          |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1   | [Phase 1: Bound outbound calls](./phase-01-bound-outbound-calls.md)                  | Completed                                                                       |
| 2   | [Phase 2: Loss visibility](./phase-02-loss-visibility.md)                            | Completed                                                                       |
| 3   | [Phase 3: Sidecar pool and adaptive cadence](./phase-03-sidecar-pool-and-cadence.md) | Completed (semaphore over one recognizer, per the step-1 measurement branch)    |
| 4   | [Phase 4: Verification](./phase-04-verification.md)                                  | In progress — sink enabled, baseline accruing; post-deploy verification remains |

Phase 1 and Phase 2 are the fix for the reported single-user symptom and should ship
together: Phase 1 removes the stall, Phase 2 is what proves whether loss actually stopped.
Phase 3 is headroom and can ship separately. Phase 4's blocker (the metrics sink decision)
was resolved 2026-09-13 — the sink is on and the pre-fix baseline is accruing from real
usage; what remains is the post-deploy measurement.

## Measured constraints (do not re-litigate without new evidence)

- **`LOCAL_STT_THREADS=4` is already optimal.** Swept 1/2/3/4/8 on prod: 8 threads made
  English solo decode ~25% slower (192ms → 227–252ms), the 6-deep wall time 1.5× worse
  (0.788s → 1.190s), the 3-stream cadence worse (500ms → 667ms, losing 56% of updates
  instead of 41%), and CPU peak 447% → 1325% — three times the CPU to run slower. This is
  ONNX Runtime intra-op oversubscription on a small INT8 model. **Do not raise threads.**
  A pool must therefore come with _fewer_ threads per lane, keeping total software threads
  near the 16 cores. Prod was reverted to 4 after the sweep. (Side finding: dev's default
  of 8 is ~25% slower per decode than prod's 4.)
- **Memory, not CPU, bounds the pool.** The Docker VM total is **7.553GiB** (not the
  host's 32GB); `local-stt` has `mem_limit: 4g` and sits at ~0.7GiB, while `local-tts`
  already holds ~1.9–2.1GiB against its own 4g limit. Per-engine weights are 223MB (vi) /
  418MB (en) per docstrings, single-instance and dev-measured.
- **Models are fixed.** vi Zipformer-30M is CC-BY-NC-ND-4.0 (academic/thesis only);
  Moonshine is MIT. No swap, no re-quantization.
- **No streaming recognizer exists.** `sherpa_onnx.OfflineRecognizer` only, so a partial
  transcript is inherently a full re-decode of a window.
- **The tunnel is not the bottleneck.** Cloudflare steady-state on a reused connection is
  55–64ms round trip; loopback is 0.4–1.3ms; edge RTT 21.8ms at 0% loss. The 207ms/978ms
  first measured was per-connection TLS/QUIC handshake, not steady state.
- ~~**`packages/ai-providers` has no test harness**~~ — true at planning time; this
  delivery added one (vitest config, `test` script, `http-util.spec.ts`), matching
  `apps/api` and `packages/realtime-client`.

## Non-goals

Carried from the contract: WebSocket reconnect/backoff/frame resend; the `fullDuplex`
echo trade (a documented accepted decision); Gemini key/project distinctness audit;
retuning `MAX_UTTERANCE_MS`, `MAX_IN_FLIGHT`, or `MAX_CONCURRENT_TURNS_*`;
`enforcePendingCeiling` excluding the capturing turn; TTS sidecar parallelism (identical
lock structure, but ~20% of one slot per speaker — the _next_ ceiling, not this one);
pipeline cancellation plumbing; model replacement; any rewrite.

## Success Criteria

- [x] No `fetch` on the speech path and no Gemini client is constructed without a deadline (all six provider fetches + Gemini; ElevenLabs included after review)
- [x] A turn whose dependency hangs fails that turn and frees its slot; it never pins one of 6 global slots
- [x] ~~At most one speculation is in flight per turn~~ — implemented then reverted: the specs proved renewal suppression costs the measured head start (see phase 1 record)
- [x] `turn.sentMs` and `turn.sequence` advance only when a frame actually left the socket; held frames re-send in order with no sequence hole
- [x] A turn dropped at the pending ceiling renders an "unheard" marker instead of vanishing
- [x] STT decodes concurrently: local overlap test ~0.50× vs serial (old lock ~0.94×); the ≤ 0.60× prod probe re-runs at deploy
- [x] `pnpm lint && pnpm typecheck && pnpm build` green; `apps/api` (879), `packages/realtime-client` (334), `packages/ai-providers` (4, new harness), and `services/local-stt` (27) test suites green

## Open questions

1. ~~`TURN_METRICS_PATH`~~ **Resolved 2026-09-13: enabled.** Sink on, api restarted with the
   bind mount, stale rows archived; the pre-fix baseline accrues from real usage until the
   fix deploys. (Standing note: CD does not pass `-f override` — the override file must be
   re-applied by hand after each deploy, or the env var alone silently has no mount.)
2. **Open — Gemini key/project distinctness.** The free tier meters per project per model;
   if the 4 keys share a project the pool multiplies nothing and part of the residual
   latency tail is quota, not network. Worth settling when Phase 4's post-fix numbers land.
3. ~~ai-providers test harness~~ **Resolved: vitest added** (config + `test` script +
   `http-util.spec.ts`, 4 tests). The package's tsconfig also moved to the relative
   `extends` form every other package uses — the package-export form breaks Vitest's
   transform ("Tsconfig not found"), already documented in `packages/realtime-client`.
4. **Cost-adaptive cadence shipped with divisor 3** (English partials refresh ~0.75-1.1s
   under load instead of 0.3s; a fast machine is unchanged — the floor is a floor). This is
   the intended trade of preview smoothness for on-time audio; flag it in the PR body so a
   reviewer sees it as a decision, not a silent tuning.

## Follow-ups recorded (not in this delivery)

- **Final-over-partial priority** (from code review): nothing orders a turn's final decode
  ahead of live-preview decodes at the sidecar or the api. Under saturation, shedding
  partials-not-finals is arrival-order luck. Mitigated at one-user load by the duty gate,
  per-scheduler in-flight guard, and 4 lanes; becomes real work for multi-user load.
- **TTS sidecar** has the identical one-lock structure — the next ceiling at roughly five
  concurrent speakers.

<!-- slug: stt-latency-content-loss -->
