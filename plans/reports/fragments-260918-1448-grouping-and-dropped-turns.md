# Fragments and the missing turn — diagnosis

Read-only. No source file was modified.

**A note on the tree's state.** This analysis was run against a working tree that
already contains this session's earlier uncommitted fixes to `conversation-session.ts`,
`turn-pipeline.ts` and `conversation-turns.ts`. Where that matters — it does for
Defect B — the historical state is read from `git show HEAD` and stated explicitly.
The Defect A gap analysis is unaffected: today's `conversation-turns.ts` change
subtracts `preRollMs` from the _stored_ `offsetMs`, and deliberately does not touch the
`openedAt` that `groupTurnsForDisplay` measures gaps with.

## How the numbers below were obtained

Everything quantified here comes from replaying the **real** `SpeechGate` — not a
reimplementation — over `scratchpad/conv/rec.wav`, fed the way `CapturePump` feeds it
(`pcm16Rms` over 341-sample blocks = 21.31ms, the 16 kHz equivalent of the worklet's
1024 samples at 48 kHz) with `maxUtteranceMs: 8000`. `speech-gate.ts` and
`pcm-resampler.ts` were compiled with the repo's own `tsc` into
`scratchpad/gatejs/`; the driver is `scratchpad/replay.mjs`, the block/candidate
analysis is `scratchpad/blocks.mjs`.

The replay produces **65 turns, 9 of them `forced`**. Nine is the ceiling-fire count
already established for this conversation independently, so the replay is reproducing
the production gate rather than something adjacent to it. Aligning each stored row's
`offsetMs` to a gate `openedAt` gives a residual of **−260ms ± 25ms across all 55
rows with no drift over 270s** — the recording simply starts 260ms after the session
clock.

Two of 65 turns disagree with production, and both are explained:

| replay                            | what production did     | proof                                                                                                                                                                      |
| --------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| split 141.8–148.2s into #37 + #38 | ran it as one 6.4s turn | the sidecar decodes #38's audio as `"Anh anh chưa bao giờ nghĩ đến những điều đó em"`, which is the **tail of stored pos 33** — a genuine pipeline row — whose head is #37 |
| missed a turn at ~174.3s          | opened one              | stored pos 38 `"Đấy"` (Speaker 2, quiet) sits there with no replayed turn                                                                                                  |

Correcting for those: production ran **65 turns → 9 forced cuts, each with a successor
inside 1200ms → 9 merges → 56 display blocks**, against **53 genuine pipeline rows**.
Positions 0 and 54 of `turns_full.tsv` are hand-backfilled by the team lead and are
excluded from every count in this report. **Three blocks produced no row at all, and a
fourth stored only half of itself** — see Defect B.

> **Correction.** An earlier version of this report dismissed the 264.3–268.0s region
> as a third replay artifact, because gate #64's audio decodes to the tail of stored
> pos 54. Position 54 is hand-backfilled and fuses two distinct regions, so that was
> circular — backfilled data used as evidence about the pipeline. The replay was right:
> #63 and #64 are two real turns. This changes Defect B from one lost turn to four lost
> utterances, and moves its likely cause.

---

# Defect A — fragments

## What the shipped rule actually does

`packages/realtime-client/src/state/display-groups.ts:89` refuses to merge unless
`previousCapture.cutForced`. The file's stated premise — "a turn that ended on the
hangover is a complete utterance" — is indeed false for this speaker, but the
premise is not the whole defect, and dropping the `cutForced` test is not the fix.
The reason is that `MAX_CAPTURE_GAP_MS = 1200` does not mean the same thing on both
sides of that test.

`closedAt` is stamped when `onSpeechEnd` fires. For a `forced` cut that is the
instant of the cut (`speech-gate.ts:250-253`). For a `hangover` close it is
`SPEECH_HANGOVER_MS = 500` **after** the speaker actually stopped
(`speech-gate.ts:212-215`). `openedAt` is stamped at `onSpeechStart`, which needs
`MIN_SPEECH_MS = 120` of speech first. So for the pairs this defect is about:

```
real pause  ≈  measured gap + 500 − 120  =  measured gap + 380 ms
```

The 1200ms bound was measured over 22 **forced** cuts, where no hangover is baked
into `closedAt`. Reused unchanged on hangover-ended turns it silently becomes a
tolerance for **~1.58s of real silence**. Measured on this conversation, that is
catastrophic:

| threshold on the measured gap     | same-speaker adjacencies merged (of 45) |
| --------------------------------- | --------------------------------------- |
| 200ms                             | 7                                       |
| 300ms                             | 16                                      |
| 400ms                             | 20                                      |
| 500ms                             | 25                                      |
| 600ms                             | 33                                      |
| 700ms                             | 35                                      |
| 900ms                             | 37                                      |
| **1200ms (the shipped constant)** | **40**                                  |

Gap distribution over those 45 adjacencies: min 127ms, p25 213ms, median 447ms,
p75 660ms, max 5115ms. Simply deleting line 89 collapses 40 of 45 boundaries — the
conversation becomes roughly six blocks.

## The lead's five fragment boundaries, measured

| boundary    | measured gap | real pause | prev ended on |
| ----------- | ------------ | ---------- | ------------- |
| pos 16 → 17 | 447ms        | ~827ms     | hangover      |
| pos 19 → 20 | 554ms        | ~934ms     | hangover      |
| pos 20 → 21 | 213ms        | ~593ms     | hangover      |
| pos 28 → 29 | 149ms        | ~529ms     | hangover      |
| pos 29 → 30 | 128ms        | ~508ms     | hangover      |

To catch all five you need ≥600ms, which merges 30+ other boundaries.

## Short rows: 14, but not 14 fragments

Of the 53 genuine rows: **14 are ≤4 words (26%)**, 8 of them a single word; median row
is 12 words, mean 15.8. Seven of the 14 have a same-speaker neighbour within 600ms.
Five are isolated at 900ms and are **correct** as their own rows — pos 1 `"Nhiều"`,
pos 2 `"Hello mọi người"`, pos 3 `"Ừ"`, pos 4 `"Đây"` (Speaker 2), pos 38 `"Đấy"`
(Speaker 2). These are backchannels and greetings, not fragments, and merging cannot
help them — only context can. Two are Speaker 2 and are protected solely by the
attribution test at `display-groups.ts:117-120`. (Pos 1 counts as isolated only
because its true neighbour, pos 0, is one of the utterances the pipeline lost.)

## What a relaxed rule would wrongly merge — a real pair, in this conversation

**pos 26 → pos 27, measured gap 213ms.**

```
pos 26  "Hoặc là ở châu âu đấy đánh một cái series lớn"
pos 27  "Cảm ơn lê hoàng đã tặng kem bánh"          ← a donation thank-you
```

He is mid-answer about travel plans, breaks off to thank a donor by name, and
returns to the answer at pos 28. This must stay its own row: it has a different
addressee and a different subject, and it is the kind of line a reader searches for.
**No gap-only threshold keeps it apart** — 213ms is below every candidate that
catches even three of the five target fragments, and it ties with pos 20→21, which
_must_ merge. The two cases are indistinguishable on timing.

A second, cheaper one: **pos 42 → 43 at 660ms**, where pos 43
`"Anh nghĩ sao về công việc kiểm kê hàng hóa ở siêu thị..."` is him reading out a
viewer's question — a new topic. Any threshold ≥700ms swallows it.

## Blast radius: what a block changes

Grouping is **not** display-only, despite the header comment at
`display-groups.ts:13`.

- **Display** — `apps/web/src/components/translate/conversation-transcript.tsx:192`.
- **Storage** — `conversation-turns.ts:70` groups _first_; one row is one block.
- **Search** — `prisma-conversation.store.ts:606` builds `searchText` per stored
  row, so a phrase spanning two fragment rows is unfindable. This is a real,
  present user cost of Defect A.
- **Minutes** — `minutes.service.ts:223` reads `displayText ?? sourceText` per
  stored row, so the minutes prompt sees each fragment as its own speaker-labelled
  line.
- **Player seek** — `conversation-turns.ts:88` / `displayGroupOffsetMs`.
- **Translation — NO.** This is the decisive one.

## Translation is per turn, and grouping cannot repair it

The server translates each turn's own audio at
`translation-session.service.ts:336`, long before any client-side grouping exists.
`groupTargetText` (`display-groups.ts:216`) merely **concatenates the already-
translated fragments**. Merging pos 19/20/21 would therefore produce one row holding
three independently-produced English strings stitched together — the row count
improves, the English does not.

And the fragments are translated with **no conversational context whatsoever**:

- `TranslationRequest.context?: string[]` exists at
  `packages/ai-providers/src/interfaces/translation-provider.ts:82-83`, documented as
  "Optional preceding utterances for context-aware translation".
- **No caller anywhere populates it.** `PipelineTranslatorService.translate` and
  `transcribeAndTranslate` pass only `text`, languages, `models` and `hints`
  (`pipeline-translator.service.ts:232-239`, `:276-283`).
- **No provider reads it.** `gemini-translation-provider.ts:130` calls
  `buildContextBlock(req.hints, req.sourceLanguage)`, and
  `prompt-builder.ts:262-290` derives the `<context>` block purely from
  `topic` / `hotwords` / `glossary` / `style`. `req.context` is a dead field.
- `SessionRegistry` holds no transcript history either — only socket → sessionId
  maps (`session-registry.ts:35-44`).

So `"Thì nó"` (2 words) reaches Gemini as two words plus the session's topic and
glossary. That is the isolation defect, and it is a _translation-input_ defect, not
a grouping defect.

## Fix options

**Option 1 — carry preceding source utterances into the prompt. (my pick)**
Populate the `<context>` block with the last N finished source texts of the same
socket. It is the only option that changes what the model sees, it fixes short
fragments _and_ short backchannels (which merging cannot help, because they are
correctly their own rows), and it needs no VAD or grouping constant to move.
Cost: a small bounded ring of recent finished `sourceText` per socket in
`SessionRegistry`, and a `context` line in `buildContextBlock`. Two cautions —
(a) with `MAX_IN_FLIGHT = 3` the immediately preceding turn may still be in flight
when turn N ends, so context must be "whatever has finished", not "the previous
turn"; (b) prior transcript text entering the prompt is a second instruction
channel and must go through `asTranscriptData` exactly as the transcript does, with
`benchmarks/prompt-injection` re-run.

**Option 2 — relax grouping with a hangover-aware bound.** Allow a merge after a
`hangover` close when the gap is under a _separate, much smaller_ constant, ~300ms
(≈680ms of real silence). Recovers 16 of 46 boundaries including pos 20→21, 28→29,
29→30 — but **not** pos 16→17 or 19→20 — and wrongly merges pos 26→27. I would not
ship this alone; the honest reading of the measurement is that timing cannot
separate "hesitated mid-sentence" from "broke off to thank a donor" in this
conversation.

**Option 3 — raise `MAX_UTTERANCE_MS`.** Does nothing here. Only 9 of 64 turns hit
the ceiling and grouping already re-merged 8 of them.

**Option 4 — accept and do nothing.** Defensible for display, not for search and
minutes.

Recommended: **Option 1**, and leave `display-groups.ts:89` alone. If a grouping
change is wanted anyway, Option 2's constant must be _new_, not a reuse of
`MAX_CAPTURE_GAP_MS`, precisely because `closedAt` means different things on the two
paths.

## Specs that would have to change

Option 1 touches no grouping spec. It needs:

- `packages/ai-providers/src/providers/gemini/prompt-builder.spec.*` — a new
  `<context>` line and its sanitisation.
- `benchmarks/prompt-injection` — the recorded baseline is explicitly claimed intact
  only "with no hints" (`prompt-builder.ts:249-256`); a new block breaks that claim
  and must be re-graded.
- `apps/api/src/modules/translate/services/translation-session.service.spec.ts` —
  the hints/context passed to the pipeline.

Option 2 additionally breaks, by design:

- `display-groups.spec.ts:49-56` "does not merge when the speaker stopped" — this
  case _is_ the rule being changed.
- `display-groups.spec.ts:96-103` "splits when the gap runs past the bound" — still
  valid for forced cuts; needs a hangover twin.
- `conversation-turns.spec.ts` uses `cutForced: false` with gaps of 2000ms in most
  fixtures (`:106`, `:140`, `:281`), so a 300ms hangover bound leaves them passing.
  Worth re-checking `:62` and `:307` explicitly.

---

# Defect B — lost turns

## Scope: three of these four were already diagnosed and fixed today

I was reading a working tree that already contains this session's earlier fixes, and
re-derived two defects that were solved before I was spawned. Attributing correctly:

| #   | gate turn                                         | status                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | #0, **0.38–2.13s**, session's first utterance     | **Already diagnosed and fixed.** Start-up ordering: the socket was created after the microphone, so audio captured before the connection completed had nowhere to go. Fixed in `conversation-session.ts` by reordering `start()` and adding a pre-connect buffer (`MAX_PREBUFFER_MS`). My "gate #0 opens ~555ms after `startedAt`, inside the handshake window" is that defect, independently re-found. |
| 2   | #3, **11.25–13.17s** (1.92s), mid-conversation    | **Open.** See below.                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | #63, **264.25–265.87s**                           | **Covered by the tail diagnosis.** See the correction below — I was wrong to call this separately open.                                                                                                                                                                                                                                                                                                 |
| 4   | #64, **266.49–267.96s**, session's last utterance | **Already diagnosed and fixed.** `plans/reports/tail-diagnosis-260918-1356-conversation-tail-turn-loss.md`.                                                                                                                                                                                                                                                                                             |

### Correction: loss 3 is not a separate defect

I described #63 as "the grouping rule fired, the block formed, and a member never
completed", and treated it as unexplained by the tail fixes. Reading the tail
diagnosis, it is the same event: that report's reference transcription places a
"distinct ~8s utterance" at **~4:22–4:30**, which is 262–270s — spanning **both** #63
and #64. Both turns were refused with `too_many_turns` and given up; the tail
diagnosis covers both.

What my analysis does add is _why #63's loss is harder to see than #64's_. Because
#62 is a `forced` cut and #63 follows it by **490ms** (independently reproducing the
lead's 480ms), `continues()` would have merged them into one block. A turn lost from
**inside** a merged block leaves no hole in the timeline at all: pos 53 renders as a
complete, well-formed row that is merely shorter than what was said. Loss 4 at least
leaves a gap between the last row and the end of the recording. Loss 3 leaves nothing
to notice. That is worth stating because it bounds how much any timeline-gap heuristic
could ever detect.

### Correction: the double-`finish()` hypothesis is withdrawn

I proposed that a second `finish()` short-circuits to `stop()` and forgets in-flight
turns. The tail diagnosis explains the same observation better and with arithmetic:
`endedAt` minus `audioOffsetMs + audioDurationMs` is **−10ms**, so `stop()` ran in the
same tick as `finish()` — but because `ordered.isBusy` was _already false_, the turns
having been given up ~3s earlier by the refusal cycle, not because anyone tapped twice.
No double tap is needed and none should be assumed. Withdrawn.

### Correction: what `isServerReason` looked like when this ran

I cited `'stopped'` being on the client-reason list as evidence the abandonment signal
was plumbed. Checking `git show HEAD`, at the time this conversation ran the list read
`'never_started' | 'dropped_pending' | 'stopped'` — so `'stopped'` **was** already
there; `'too_many_turns'` is today's addition, and that omission is precisely what the
tail diagnosis identified. The long doc comment I quoted (about the transcript and the
recording disagreeing) is also today's work, written about this very conversation, so
it was not the pre-existing acknowledgement I presented it as. What _is_ pre-existing
and still stands is `turn-keyed-transcript.ts:163-167` — that file is unmodified in the
tree.

## What remains open: mid-conversation losses, one in each recorded conversation

Loss 2 is not at a boundary and is not explained by either fix. **And conversation 2
has one too**, which I found by running the same gate replay against `rec2.wav`:

> **`cmu4e61b4`, gate #17, 51.00–56.16s — 5.16 seconds, no stored row.**
> The recogniser decodes it, first attempt, as
> `"Mình thì chỉ cần chớp mắt một cái thôi thì đã sang thứ hai rồi"`
> — a complete, fully intelligible Vietnamese sentence, 51 seconds into a 111-second
> conversation. Its neighbours pos 15 (gate #16) and pos 16 (gate #18) are both stored.

This is the single most decisive piece of evidence in the investigation, and it points
the opposite way from where I first ranked. It is **not** marginal audio, so the
blank-transcript path cannot explain it; it is **not** at a boundary, so neither
start-up nor teardown can; and the block is its own, so no grouping rule is involved.
A clean five-second sentence simply never became a row.

Given the tail diagnosis proved that a `too_many_turns` give-up drops a turn in total
silence at HEAD — no marker, no live line, no row — and that both of these losses sit
after a run of closely-spaced turns, that mechanism is now the leading candidate for
the mid-conversation losses as well. I cannot prove it: the refusal is invisible in the
recording, and the server-side record is gone. But it is one mechanism that fits all
four losses across two conversations, which no other candidate does.

If that is right, it extends the tail diagnosis rather than competing with it: the same
defect ate turns **mid-conversation**, not only at the tail, and the fixes in the tree
(retry until `MAX_PENDING_MS`, and `'too_many_turns'` added to `isServerReason`) help in
both places — but in both places the turn still produces **no stored row**, which is
what Step 2 below is for.

## Every path from an opened turn to no stored row

| #   | path                                                                                                                                                                       | `file:line`                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | server: `end()` with an empty buffer → `fail('no_audio')`, close, **no `transcript.final`**                                                                                | `translation-session.service.ts:296-305`                                        |
| 2   | server: STT returns blank → `BadRequestException('No speech detected in the audio')` → the `catch` runs `record(false,'error')`, `reportTurnFailure`, `close(...,'error')` | `pipeline-translator.service.ts:273` → `translation-session.service.ts:423-427` |
| 3   | server: any other pipeline failure (provider, quota ladder exhausted, synthesis) → same `catch`                                                                            | `translation-session.service.ts:423-427`                                        |
| 4   | server: client left mid-flight → returns before the emit                                                                                                                   | `translation-session.service.ts:350-356`                                        |
| 5   | client: turn refused `too_many_turns` past `MAX_PENDING_MS` (20s) → `forget(turn,'too_many_turns')`                                                                        | `turn-pipeline.ts:459-465`                                                      |
| 6   | client: pending ceiling evicts a still-`waiting` turn → `forget(oldest,'dropped_pending')`                                                                                 | `turn-pipeline.ts:630-637`                                                      |
| 7   | client: pending ceiling discards a started turn's buffered audio; the turn survives but arrives empty → becomes path 1 or 2                                                | `turn-pipeline.ts:639-648`                                                      |
| 8   | client: `reset()` at teardown → `'stopped'`                                                                                                                                | `turn-pipeline.ts:487`                                                          |
| 9   | client: a block whose recognizer **and** rendered text are both blank is dropped from the projection                                                                       | `conversation-turns.ts:79`                                                      |

Path 9 is effectively unreachable from here: the server's own guard (path 2) means a
`transcript.final` with blank text is never emitted, so no such segment reaches the
reducer.

Path 8 is now the leading candidate for losses 3 and 4, and was wrongly dismissed in
the first version of this report on the grounds that "the conversation ran another
256s" — true for loss 2, irrelevant for losses at the very end.

## Eliminated for loss 2 (the mid-conversation one)

- **5, 6, 7** need a saturated pipeline. At 11.25s the conversation had produced
  three turns, all closed by 9.46s; `MAX_IN_FLIGHT = 3`
  (`use-streaming-translate.ts:35`) and the 20s pending ceiling cannot be near their
  limits 11 seconds in. Eliminated.
- **8** — the conversation ran another 256s after it, so teardown cannot reach it.
  Eliminated **for loss 2 only**; it is the leading candidate for losses 3 and 4.
- **4** — the socket stayed up and the next turn stored normally. Eliminated.
- **Echo suppression** (`capture-pump.ts:397-419`) was my first hypothesis and is
  wrong: `/translate` sets `fullDuplex: true`
  (`use-streaming-translate.ts:397`), so the `if (!this.fullDuplex)` drop branch is
  never taken, and continuous mode never enters `awaiting-result`
  (`capture-pump.ts:319`). Eliminated.

## What the boundary clustering points at

Losses 3 and 4 are the last two utterances of the conversation, and loss 1 is the
first. Two mechanisms fit that shape, and both are in the client rather than the
recognizer:

- **Teardown.** `finish()` (`conversation-session.ts:416-459`) drains properly on the
  first call — it closes the captured turn, holds on `ordered.isBusy`, and only then
  calls `stop()`. But a **second** `finish()` short-circuits straight to `stop()`
  (`:421-424`), and `stop()` runs `pipeline.reset()`, which forgets every in-flight
  turn as `'stopped'` (`turn-pipeline.ts:485-489`). A user who taps stop twice, or
  taps it while the button already says "finishing", loses whatever had not come back.
  Note also that the drain's completion test is the **playback** queue, so a turn whose
  audio was never queued does not hold it.
- **Start-up.** Gate #0 opens 384ms into the recording, which is ~555ms after
  `startedAt` (`audioOffsetMs` is 171 for this conversation). That is inside the
  window where the socket may still be handshaking.

I am not asserting either — I have no client log for this session. But they fit
three of four losses, whereas a recognizer returning blank fits none of the three
boundary cases particularly well and is contradicted by the probe below.

## For loss 2, the mid-conversation one — the evidence cannot say

I tried to settle it and could not, and I would rather say so than pick:

**The server-side record was never persisted, and has since been rotated out of
memory.** This is settled, not merely untried:

- The conversation **is** on this machine — in the **production** stack, not the dev
  one. `docker exec chatofy_prod_postgres psql -U chatofy -d chatofy` holds
  `cmu4edytm001201pcn1uh8w8d` with all 55 rows. (An earlier version of this report
  said the conversation was absent from this machine; that was me querying the dev
  database on 5432, whose largest conversation is 16 turns. Corrected — though
  conversation rows were never the evidence needed.)
- `docker inspect chatofy_prod_api` reports `StartedAt = 2026-09-18T04:39:13Z` with
  `RestartCount = 0`. The conversation ran on **2026-09-16 at 17:47**. The container's
  log buffer begins at its start, so the earliest surviving line is the Nest bootstrap
  on the 18th; every line from that night is gone.
- No persisted metrics artifact exists either: the running container has no `*.jsonl`
  data file, only the recorder's compiled source under `/app/dist`, and `docker inspect`
  shows an empty `Mounts` array, so nothing was written anywhere durable. The
  `dev-turn-metrics.jsonl` I found earlier is a different stream — 63 client rows with
  **4** `cutForced` turns, against this conversation's 9.

So the evidence that would separate `no_audio` from a blank STT result from another
pipeline error was never written down. The question is closed; the ranking stays where
it is.

### The negative result, which is the most interesting thing here

**The recognizer essentially never returns an empty string for audio at this level,
and that weakens the hypothesis this report ranked first.** I cut the 11.25s region
12 ways through the live sidecar at `localhost:8012` — pre-roll 200/320/440ms
(production is `PRE_ROLL_MS = 320`, `capture-pump.ts:22`) × tail trim 400/500/600/700ms
— and got a non-empty string **every time**: `"A"` ×4, `"Ope"` ×4, `"Ot"`, `"Họ về"` ×3.
All junk, none blank. Production's bytes are not identical to mine (different Opus
decode, different block boundaries) and the output is visibly unstable across a 240ms
shift, so blank remains possible — but twelve attempts produced it zero times.

That matters beyond this one turn. The blank-transcript path (path 2) is the only one
whose guard is `sourceText.trim()` at `pipeline-translator.service.ts:273`; if the
recogniser will emit `"A"` rather than `""` for 1.9 seconds of marginal speech, then
that guard is rarely what fires, and **`no_audio` (path 1) and a pipeline error
(path 3) move up** — as does the teardown path for losses 3 and 4, which never
reaches the recogniser at all. The practical consequence is for Recommendation B: a
reason primitive built around `no_speech` would be covering the _least_ likely cause.
It should be derived from the close reason the client already computes, which spans
all of them.

Revised ranking for loss 2: **path 1 or path 3 most likely, path 2 possible but not
reproducible, and nothing in the surviving evidence separates them.** What they share
is the answer to the next question, which does not depend on which one it was.

## Should a rowless turn vanish silently?

No. What the reader loses is not the audio — the recording holds it — but the
**knowledge that anything was said there**. `/history` renders contiguous rows with
timestamps; a 1.9-second hole between pos 2 and pos 3 is indistinguishable from
silence. The minutes prompt has the same blind spot and will summarise a
conversation it believes had a pause. And the person most able to tell a
misrecognition from a real silence — the speaker — is given nothing to react to.

The boundary clustering sharpens this. Three of the four losses are the conversation's
opening and closing utterances, which are exactly the lines a reader is most likely to
notice missing and least able to explain — and the team lead had already hand-repaired
two of them before this investigation began, which is itself evidence that the loss is
visible and costly enough to be worth manual work.

The cost of the alternative is a row that says nothing useful. Blank `sourceText`
with a real `offsetMs` is not free: `minutes.service.ts:223` and the history screen
both read `displayText ?? sourceText`, and an empty row reads as a speaker who said
nothing, which is its own lie.

### The signal already exists; only the last hop is missing

This is cheaper than I first estimated, because the plumbing is built and the codebase
has already named this exact gap. A turn abandoned client-side travels
`forget(turn, reason)` → `onTurnClosed` → `isServerReason`
(`conversation-session.ts:1024-1031`, which explicitly lists `'stopped'`,
`'dropped_pending'`, `'too_many_turns'`, `'never_started'`) → `abandonTurn`
(`:878-881`) → `onTurnAbandoned` → `dispatch('transcript.turnAbandoned')`
(`use-streaming-translate.ts:363-368`) → the reducer's `unheard` map.

And `turn-keyed-transcript.ts:163-167` states the limit in its own words:

> "it arrives separately, sometimes for a turn whose text never arrived at all. **That
> case marks nothing — there is no row to mark — and is the honest limit of this
> signal.**"

That is Defect B, already written down. The doc comment above `isServerReason`
describes the same failure concretely for `too_many_turns`: _"no live line, no
abandoned marker and no saved row, while the recorder — which taps the microphone
independently — kept the audio. The transcript and the recording then disagreed about
whether the speaker had said anything at all."_ That is exactly what happened here,
for a different reason code.

**Recommendation, in two separable steps.**

**Step 1 — log it. Useful on its own, and the reason this turn is undiagnosable now.**
Nothing records that a turn ended with no transcript. `onTurnClosed(turnId, reason)`
has the reason in hand, and the web app routes `onLog` only to `console.warn`
(`use-streaming-translate.ts:386`). Emitting a line per abandoned turn — with its
`turnId`, `openedAt` and reason — costs nothing structural, ships independently, and
would have answered this investigation's central question outright. Given that the
server's own record proved to be non-durable, a client-side line is the cheapest place
to put the fact that a turn was lost.

**Step 2 — keep the turn as a row, marked, not blank.** Store the abandoned turn with
its `offsetMs` and speaker plus a field saying why there is no text, derived from the
close reason rather than from a new vocabulary — `outcomeFor`
(`conversation-session.ts:1049-1067`) already maps every reason onto
`rejected | dropped | no_audio | played | error`, and that mapping spans the paths the
negative result above promoted. The history screen renders a localized placeholder from
that primitive, exactly as `speakerRole` already yields a localized speaker fallback
(`conversation-turns.ts:16-21`), and `buildTranscript` skips such rows.

This is the owner's call, not mine: it adds a nullable column and an i18n string, and
`toConversationTurns` would have to take `unheard` and emit rows for turns that never
became segments. Two honest limits if it is taken: a turn that never received a
`sessionId` cannot be keyed at all (`abandonTurn` reads
`sessionIdFor(turnId) ?? null`), which is exactly the `too_many_turns` case the tail
diagnosis describes — the turn is refused _before_ any session id exists — and the
ordering of such a row depends on a capture record that a never-started turn also
lacks.

**Why Step 2 is still needed after today's fixes.** Adding `'too_many_turns'` to
`isServerReason` makes the loss raise an abandoned marker, which is a real improvement
on screen. But the marker is keyed by `sessionId` into `unheard`, and
`turn-keyed-transcript.ts:163-167` says what happens to it for a turn whose text never
arrived: _"That case marks nothing — there is no row to mark — and is the honest limit
of this signal."_ So post-fix the signal exists and is still dropped at the storage
boundary. The five-second sentence in conversation 2 would still not be a row.

---

# Cross-conversation check

Eight prod conversations have ≥6 stored rows. The fragment rate is real and not
confined to the one conversation, but **the timing analysis is not portable**, for a
harder reason than the missing recordings.

| conversation         | rows | ≤4w | %   | ≤2w | speaker-change rate | `offsetMs` |
| -------------------- | ---- | --- | --- | --- | ------------------- | ---------- |
| cmu4edytm (this one) | 53 * | 14  | 26% | 10  | 12%                 | present    |
| cmtz8qk1g            | 52   | 11  | 21% | 5   | 0%                  | **NULL**   |
| cmu4e61b4            | 32   | 8   | 25% | 3   | 0%                  | present    |
| cmtz8jtb9            | 29   | 3   | 10% | 2   | 25%                 | **NULL**   |
| cmtz7fa6w            | 17   | 2   | 12% | 0   | 6%                  | **NULL**   |
| cmtzypils            | 7    | 0   | 0%  | 0   | 0%                  | **NULL**   |
| cmtzy67dq            | 6    | 4   | 67% | 0   | 0%                  | **NULL**   |
| cmtzy8fob            | 6    | 5   | 83% | 2   | 20%                 | **NULL**   |

\* 53 genuine rows; the lead's table reports 15/55 including the two backfills.

## Why the merge count cannot be extended to the corpus

`offsetMs` is **NULL for six of the eight** — it arrived with conversation recording,
so only the two conversations that have audio have timing at all. The limit is
therefore stronger than "acoustic verification is limited to two": _no_ timing
analysis is possible on the other six.

And even where `offsetMs` exists it is not enough. `continues()` reads
`nextCapture.openedAt − previousCapture.closedAt` plus `previousCapture.cutForced`.
`offsetMs` gives only the block's **open**; neither `closedAt` nor `cutForced` is
stored anywhere. I tried to bridge the gap by fitting block duration from word count
on the conversation where I have both — `duration ≈ 1347ms + 191ms/word`, and it is
not good enough: median |residual| 814ms, and the resulting gap estimate errs by
−1241ms at p10 and +1279ms at p90 over 51 adjacencies. Running a 200–600ms threshold
sweep through an estimator with ±1.2s of error would have produced numbers, not
measurements, so I did not report any. **The merge count is computable only by gate
replay, i.e. only where a recording exists** — currently one conversation locally.

## Second merge table — `cmu4e61b4`, gate replay on `rec2.wav`

The second recording was fetched from the public bucket by the timeline agent, so this
is a real replay, not an estimate. 111s, 32 stored rows, single speaker throughout,
alignment residual a constant **−240ms** — the same clean fit as conversation 1.

**34 gate turns → 1 forced cut, its successor re-merged → 33 blocks → 32 rows → 1 block
with no row** (the 51.00–56.16s loss above).

| threshold on the measured gap | conv 2: merged (of 31) | conv 1: merged (of 45) |
| ----------------------------- | ---------------------- | ---------------------- |
| 200ms                         | 4 (13%)                | 7 (16%)                |
| 300ms                         | 8 (26%)                | 16 (36%)               |
| 400ms                         | 13 (42%)               | 20 (44%)               |
| 500ms                         | 17 (55%)               | 25 (56%)               |
| 700ms                         | 22 (71%)               | 35 (78%)               |
| 900ms                         | 24 (77%)               | 37 (82%)               |
| **1200ms (shipped)**          | **28 (90%)**           | **40 (89%)**           |

Gap distribution, conv 2: min 149ms, p25 298ms, **median 448ms**, p75 874ms, max 6074ms.
Conversation 1's median was **447ms**. Two different conversations, different lengths,
different speaker counts, and the median inter-turn gap agrees to within one millisecond
— which is what you would expect if this number is a property of the gate's hangover
rather than of either speaker, and is the strongest support available for the
`gap + 380ms` correction being the right way to read it.

The headline replicates: **dropping `cutForced` at the shipped 1200ms collapses ~90% of
same-speaker adjacencies in both conversations.** Conversation 2 is single-speaker
throughout, so the attribution guard protects none of its 31 adjacencies.

Row lengths, conv 2: 8 of 32 are ≤4 words (25%), none is a single word, median 8 words.
The fragment rate reproduces; the extreme one-word backchannels of conversation 1 do
not, which is consistent with conversation 2 having no second speaker to backchannel at.

## The monologue hypothesis is refuted

The claim under test was that fragmentation tracks how much one person talks without
stopping. It does not. Measuring speaker-change rate against fragment rate gives
**Spearman rho = −0.21** over all eight conversations and **−0.33** over the five with
≥17 rows: no relationship, leaning slightly the wrong way. The decisive counter-example
is `cmtzypils` — a **pure monologue**, 0% speaker change, with a **0% fragment rate**
and long well-formed rows. If the hypothesis held, that conversation should be the most
fragmented in the corpus; it is the least. Stated plainly so it is not carried forward:
**the claim is wrong, and fragmentation is not predicted by monologue-vs-dialogue.**

The supporting detail:

- `cmtzypils` is a **pure monologue** (0% speaker change, 7 rows) with a **0%**
  fragment rate and long well-formed rows.
- `cmu4edytm` has the _most_ speaker alternation of the substantial monologue-ish
  conversations (12%) and the _highest_ fragment rate (26%).
- `cmtz8jtb9`, the most dialogue-like (25%), does have the lowest rate (10%) — which is
  the part of the pattern that holds.

The two conversations driving the apparent effect are artifacts and should be dropped
from the argument:

- **`cmtzy8fob` (83%)** is recognizer garbage, not fragmentation — someone saying
  "ChatGPT" into a Vietnamese-tuned model: `"U-shirt gpt"`, `"Here is your chest gpt"`,
  `"You know chat dvd"`. Longest row in the whole conversation is 5 words.
- **`cmtzy67dq` (67%)** is not an artifact at all — see immediately below.

## The second confirming case for Defect A: `cmtzy67dq`

This is the clearest independent instance of the defect in the corpus, and it needs no
timing to make its point. Six rows, one speaker, and rows 1–5 are **one sentence**:

```
1  "Ngày hôm qua tôi mới thử trò chuyện với mô hình"
2  "Mới của chất gpt"
3  "Và mô hình cv"
4  "Năm chín sáu"
5  "Mô hình năm sáu sáu luna"
```

Read as stored, that is five separately-attributed rows; read as spoken, it is one
person saying they tried a new model yesterday. Three properties make it the right case
to cite for the recommendation:

1. **It reproduces the defect outside the conversation originally under investigation**,
   in a conversation with a different speaker and a different subject.
2. **A single speaker throughout, so the attribution guard at
   `display-groups.ts:117-120` protects none of its adjacencies.** Whatever a relaxed
   grouping rule did here, it would do unopposed.
3. **`offsetMs` is NULL, so no gap rule can be evaluated against it** — yet the
   translation-context recommendation applies to it directly and needs no timing at all.
   Rows 2–5 are 3, 4, 3 and 5 words; each reached the translator alone, with no
   knowledge of row 1.

That asymmetry is the argument in miniature: the fix that needs timing evidence cannot
be validated here, and the fix that does not, can.

So: the fragment rate is corroborated across the corpus, the monologue explanation for
it is not.

## The tiny-dialogue safety check you asked for

I cannot perform it, and the reason is the finding. `cmtzy8fob` and `cmtzy67dq` both
have **NULL `offsetMs`**, so no candidate gap rule can be evaluated against them at
all. What I can say from the rows: in `cmtzy8fob`, rows 1–5 are all Speaker 2 and only
adjacency 0→1 changes speaker, so a merge rule would have four unguarded adjacencies to
work on there and the attribution test would stop none of them.

This strengthens the recommendation rather than complicating it. **Option 1 (translation
context) merges nothing, so it needs no such validation and is trivially safe on every
conversation in the corpus.** Option 2 (a retuned hangover bound) can now be validated
against **two** conversations rather than one — and both say the same thing: ~90% of
same-speaker adjacencies collapse at the shipped constant, and conversation 1 contains a
pair (pos 26→27, 213ms) that no workable threshold keeps apart. Two independent
conversations agreeing, with medians one millisecond apart, is about as much evidence as
this corpus can produce, and it argues against Option 2 rather than for it.

---

## Summary of measured counts

- Gate turns in production: **65**. Forced cuts: **9**, each with a successor inside
  1200ms, so grouping formed **9** merges → **56** display blocks.
- Genuine pipeline rows: **53**. Blocks that produced no row: **3**. Blocks that stored
  only half of themselves: **1**. Of those four losses, **three were already diagnosed
  and fixed earlier today**; the mid-conversation one at 11.25s remains open.
- Conversation 2 (`cmu4e61b4`, gate replay on `rec2.wav`): **34 turns → 1 forced cut →
  33 blocks → 32 rows → 1 block with no row**, a **5.16s** fully intelligible sentence
  at 51.00–56.16s, mid-conversation. One unexplained mid-conversation loss in each of
  the two recorded conversations.
- Rows ≤4 words: **14** (26%); ≤1 word: **8**; median 12 words, mean 15.8.
  Five of the 14 are correctly isolated backchannels.
- Same-speaker hangover adjacencies — conv 1: **45**, merged if `cutForced` were
  dropped: 7 @200ms, 16 @300ms, 20 @400ms, 25 @500ms, 33 @600ms, 35 @700ms, 37 @900ms,
  **40 @1200ms (89%)**. Conv 2: **31**, 4 / 8 / 13 / 17 / – / 22 / 24 / **28 (90%)**.
- Median inter-turn gap: **447ms** (conv 1) and **448ms** (conv 2) — independent
  replication to within one millisecond.
- Real pause ≈ measured gap + 380ms for hangover-ended turns.
- Sidecar decodes of the mid-conversation missing region: **12 of 12 non-empty**, all
  junk — the negative result that demotes the blank-transcript path.
- Cross-conversation fragment rate: 10–26% over the five conversations with ≥17 rows.
- Spearman rho(speaker-change rate, fragment rate) = −0.21 (n=8), −0.33 (n=5).

## Unresolved questions

1. ~~Are the prod API's records for 2026-09-16 17:47 still available?~~ **Closed.**
   They were never persisted and the container's log buffer starts 2026-09-18T04:39:13Z
   with `RestartCount = 0` — see Defect B. Defect B stays ranked rather than proven,
   for a verified reason.
2. ~~Was this conversation stopped with a single tap or two?~~ **Withdrawn.** The tail
   diagnosis's −10ms wall-clock arithmetic explains the same-tick `stop()` without a
   double tap, and asking the user about an interaction two days ago would produce a
   guess, not evidence.
3. Is adding preceding source utterances to the `<context>` block acceptable
   against the recorded prompt-injection baseline, or does that baseline need to be
   re-cut first? `prompt-builder.ts:249-256` claims the default path is intact only
   when there are no hints at all.
4. How many preceding utterances, and should they be source-only or source+target?
   Source-only is cheaper and safer; target-side context would help consistency of
   terminology across a block but doubles the injection surface.
5. Does storing a marked "no transcript" row change any existing `/history` contract
   that assumes every row has text? I did not audit the history screen's renderers
   for that assumption.
6. ~~Do you want me to pull `cmu4e61b4`'s recording?~~ **Done** — the timeline agent had
   already fetched it from the public bucket. The second merge table is above.
7. The two mid-conversation losses (conv 1 @11.25s, conv 2 @51.00s) both follow a run
   of closely-spaced turns. Is there any surviving way to tell whether they were
   `too_many_turns` refusals? If not, the honest position is that today's retry fix
   probably covers them and the evidence to confirm it no longer exists.

```
Status: DONE_WITH_CONCERNS
Summary: Defect A's cause is missing translation context, not grouping — translation is
per-turn and `TranslationRequest.context` is populated by nobody, so merging fragments
would only concatenate separately-translated text. The gate replay now runs against both
recorded conversations and they agree closely: ~90% of same-speaker adjacencies collapse
at the shipped 1200ms if `cutForced` is dropped, and the median inter-turn gap is 447ms
and 448ms respectively. Defect B is correctly scoped to ONE open item per recorded
conversation, both mid-conversation; the other three losses were diagnosed and fixed
earlier today.
Concerns/Blockers: I re-derived two already-fixed defects from the tree's fixed state,
and I wrongly treated loss 3 as separate from the tail diagnosis when that report already
covers it; both corrected above, and the double-`finish()` hypothesis is withdrawn in
favour of the tail report's wall-clock arithmetic. The remaining mid-conversation losses
cannot be attributed with certainty — the server-side record was never persisted — but
conversation 2's is a clean 5.16s sentence that decodes first try, which rules out the
blank-transcript path outright and leaves the `too_many_turns` give-up as the only
mechanism fitting all four losses. Timing analysis remains impossible on six of eight
conversations: `offsetMs` is NULL there and `closedAt`/`cutForced` are stored nowhere.
```
