# Brainstorm — integrating speaker attribution into `apps/web`

Date: 2026-08-25 · Surface: `apps/web` `/translate` (cascade path) · Status: contract accepted,
direction chosen, ready for planning · Advisory: `kongming` GO with a restructure

Supersedes the delivery shape in `brainstorm-260824-1833-speaker-attribution.md`. That contract's
own kill clause authorised this re-open; the screen it was gated on failed with exit code 1.

## Contract

**Outcome.** The `/translate` transcript carries a per-turn speaker identity that is always correct
or correctable in one tap, for 3–5 people sharing one device. Anonymous labels by default; naming
is opt-in.

**Constraints.**

- No voiceprint persisted, none written to disk, none surviving the session. Carried unchanged from
  the prior contract.
- Labels anonymous by default. Self-naming is optional, and only for the session — a stored name
  bound to a stored voiceprint is the thing the constraint exists to prevent.
- No increase in Gemini requests per turn.
- `sherpa-onnx==1.13.4` + `onnxruntime==1.27.0` stay pinned (ABI-coupled pair).
- Model is **campplus**, decided by Phase 5 latency and not by accuracy: 82% headroom at the
  2-decode architectural ceiling, against eres2netv2's 28% for +1.2 accuracy points (inside noise).
- Embedding goes to a **separate `POST /embed`**, never piggybacked on `/transcribe`. The prior
  contract's argument survives intact: piggybacking serialises the embedding cost ahead of
  translation (+30–500ms), while a second localhost upload of a few-second 16k clip costs
  single-digit ms.
- `speakerRoleSchema` is **not** widened. Attribution arrives as an additive optional field, because
  `apps/extension` and `apps/mobile` read the existing enum.
- Shared device only (user decision, below). One microphone, several people in front of it.

**Non-goals.**

- Overlapping-speech separation.
- Cross-session speaker memory.
- Rooms, participants, multi-device join — explicitly out of scope per the user's decision.
- The `/translate/live` path. It has no turns, so there is nothing to attribute.
- Changing the TTS voice per detected speaker.
- The speaker chip driving the translation direction. See "Settled by measurement".

**Acceptance criteria.**

- Every turn is labelled correctly, or correctable in a single tap.
- End-to-end turn latency delta ≈ 0, measured on the prod container. **The prior gate deferred this
  item rather than meeting it; it is still owed.**
- Zero changes to `apps/extension` and `apps/mobile` behaviour.
- Tap rate and suggestion-correction rate instrumented from the first phase (see Risk).
- A suggestion never updates a centroid. Only a confirmed turn does.

## User decisions, 2026-08-25

1. **Attribution is a thesis deliverable in the product**, not only a benchmark chapter. The
   acoustic layer therefore ships; a manual-only design would not satisfy it.
2. **Implicit enrolment via corrections.** No 15s recording ritual. A tapped correction seeds that
   speaker's centroid, so enrolment happens inside ordinary use.
3. **Shared device only.** Per-device streams would give attribution for free and delete this whole
   problem, but that means building rooms, participants, join, and transcript sync — out of scope.

## Direction: the hybrid, restructured into two phases

**Phase 1 — the non-acoustic substrate.** A roster and a per-turn speaker chip. No model, no
sidecar change, no dependence on any threshold. This is the floor the acoustic layer falls back to,
not a competing option.

**Phase 2 — the acoustic suggestion layer, default OFF**, enabled only after the browser-channel
delta is measured.

Two rules make the hybrid safer than plain enrolment. Without both, it silently reproduces
enrolment's failure, because in a live conversation nobody is watching the screen and an uncorrected
wrong suggestion is indistinguishable from truth:

1. Suggested and confirmed labels are **visually distinct**. The prior contract's
   provisional-then-corrected vocabulary already covers this.
2. **Only confirmed turns update centroids.** An unconfirmed suggestion must never seed the model
   that produces the next suggestion, or one early error self-reinforces.

With both, the hybrid's floor is exactly Phase 1's.

### Why not the two alternatives

- **Enrolment alone has no floor.** If the channel delta invalidates the thresholds, wrong names
  render as confident labels with no correction affordance, and an unenrolled guest is stolen 67.6%
  of the time. The transcript reads as broken and the trust does not come back.
- **Manual alone** is survivable — skipped taps degrade to honest fallback labels — but it ships
  none of the measured work, which decision 1 rules out.

### Fit with the existing code

- `turn-keyed-transcript.ts` already mixes client-only actions (`transcript.reset`,
  `transcript.turnAbandoned`, `transcript.liveDelta`) with server events, so a client-only
  `transcript.speakerCorrected` follows the established pattern rather than inventing one.
- Turn audio already lives server-side in `TurnSession.audio` and is already POSTed to the STT
  sidecar. `/embed` attaches at that point, concurrent with translation.
- Centroid state belongs in the Node API per connection, matching `TurnSession` ownership.

## Settled by measurement — decided, not open

- **Longer turns are dead.** 2s → 5s buys 1.6 points.
- **Acoustic guest detection is dead.** Best far-field session-level detection is 36.5% at a 5%
  false-alarm rate, AUC 0.774. Guest handling is a manual "add person" chip; only its placement is
  open.
- **The chip must not drive direction in v1.** Tempting, because `DirectionToggle` is `disabled`
  while running and two-way conversation currently requires restarting the session per flip. But a
  missed tap would then select the wrong STT engine and produce a garbage transcript. A labelling
  miss must never become a translation failure. Direction stays on the existing toggle; the chip is
  an override at most. The per-turn chip remains a real product fix for the locked toggle,
  independently of attribution.

## Phase 7 runs in parallel; it does not block

It gates **enabling** the acoustic layer, not building the integration. Nothing in the roster UI,
the additive field, `/embed`, or the centroid state depends on the delta. If the 2s delta exceeds
~5 points, what expires is `tau_assign` / `tau_new` — recalibrate on browser-channel recordings
before flipping the flag. The architecture is unaffected.

Dependence differs sharply by design: enrolment-alone depends on Phase 7 entirely, because the
thresholds _are_ the product; manual-alone not at all; the hybrid only for suggestion _quality_,
where error costs a tap rather than a wrong label.

The evidence gap is double and should be stated as such: the bench far-field was
pyroomacoustics-simulated, **and** no audio anywhere passed through browser `noiseSuppression` /
`autoGainControl`, both of which reshape the timbre an embedding reads.

**Consequence to accept explicitly:** with no date for the 3-person recording, the acoustic flag
stays off indefinitely and the product is Phase 1 only.

## Risk

**Tap compliance is the top risk, and it compounds.** The product's value is hands-free; a per-turn
tap fights that grain. Skipped taps mean fallback labels — wrong but honest. The compounding part:
taps are the _only_ source of confirmed turns, so a low tap rate starves implicit enrolment, Phase 2
suggestions never improve, and the incentive to correct falls further.

Instrument from day one: share of turns explicitly tapped, and correction rate on suggestions. A
sustained tap rate below ~50% in real sessions means the hybrid is degenerating into
enrolment-alone. That metric is the early warning.

## Unresolved questions

- Where the "add person" chip lives, and whether adding a person mid-session re-opens the roster UI
  or is inline in the transcript.
- Whether a low-confidence turn falls back to the previous speaker or stays unlabelled. The former
  is right more often; the latter never asserts something false.
- Licence of the campplus weights for a shipped product. VoxVietnam's `cc-by-nc-4.0` covers the
  benchmark corpus only, but the model's own terms were never checked.
- Whether the acoustic layer should be per-language namespaced, as the prior contract accepted. A
  bilingual person would otherwise get two identities.
- Date for the Phase 7 recording session.
