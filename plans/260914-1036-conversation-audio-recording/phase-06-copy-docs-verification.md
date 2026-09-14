---
phase: 6
title: 'Phase 6: Privacy copy, docs, and verification'
status: partial
priority: P1
effort: '3-4h'
dependencies: [5]
---

# Phase 6: Privacy copy, docs, and verification

## Overview

Make the product stop saying something that is no longer true, and prove the feature works
on the three browsers it now claims to support.

This phase is **not optional and not deferrable**. `packages/i18n/src/en.ts:445-455` records
the rule in the codebase's own words, from the last time this block was amended:

> There is no separate privacy surface in this product; **this copy IS the notice**, so it
> had to change with the behaviour rather than after it.

Recording is on by default for every user. Shipping Phases 3–5 while `en.ts:460` still
promises "the audio is never uploaded" would make the product state a falsehood about its
own handling of user voice data. **This phase merges in the same PR as Phases 3–5.**

## Requirements

Functional:

- The landing privacy block tells the truth in both languages.
- The docs that describe the old behaviour are corrected at their source.
- The feature is exercised end to end on Chromium, Firefox and Safari.

Non-functional:

- `web.landing.localTitle` is **also a nav label** (`marketing-header.tsx:59`), so the
  replacement must stay short enough to sit in a header.
- The claim that survives must be one the product actually earns. Recognition still happens
  on the machine — that part was always the strong claim, and it stays true.

## Files

Owned by this phase:

- `packages/i18n/src/en.ts` — the `web.landing.local*` block and its comment
- `packages/i18n/src/vi.ts` — the same, in Vietnamese
- `docs/system-architecture.md` — the retained-audio section at lines 585-605
- `docs/deployment-guide.md` — the `conversations/` prefix in the shared bucket
- `prod.env.example` — the note about what the bucket now holds
- `apps/web/src/components/marketing/local-speech.tsx` — only if the block's shape changes

## Steps

1. **Draft the copy.** The claim moves from _where the audio stays_ to _where the
   recognition happens_, which keeps the sentence true and keeps the title short:

   ```
   'web.landing.localTitle': 'Your voice is understood on your machine',
   'web.landing.localBody':
     'What you say is recognised on your own computer — no key to obtain, and nothing is
      sent away to be understood. When a conversation ends, its recording and its words are
      saved to your history, so you can play it back and read it again. Deleting a
      conversation deletes its recording too.',
   ```

   Write the Vietnamese as Vietnamese, not as a translation of the English — the existing
   `vi.ts` block is idiomatic and the replacement should match its register.

2. **Amend the comment, do not delete it.** The block above the copy carries the history of
   the previous amendment and the rule that governs this one. Add a second paragraph in the
   same idiom: what changed, that recording is on by default, and that this copy is still
   the whole notice.

3. **Say the two things the copy currently would not.** The user-facing text must make
   clear that (a) the recording is kept until the conversation is deleted, and (b) **the
   microphone keeps recording while a conversation is paused** — the recorder deliberately
   runs through `pause()` to keep every timestamp aligned, and a person who believes pause
   silences the microphone would be wrong. Phase 4 records why that design choice was made.

4. **Docs.** `docs/system-architecture.md:585-605` currently reads "No audio is retained
   today" and explains why the existing R2 bucket could not take it. Rewrite it as the
   record of what was decided instead: audio **is** retained, it shares the `chatofy`
   bucket under `conversations/`, and — stated plainly, because a doc that hides this is
   worse than no doc — that the bucket is public-read, so the objects are world-readable by
   URL and the design leans on key entropy rather than on an access boundary. Link the
   accepted-exposure section of `plan.md`.

   `docs/deployment-guide.md` gains the prefix and the token-scope note.
   `prod.env.example`'s R2 block (lines 56-72) currently says conversation audio is
   "notably" the thing that must stay private; that sentence is now wrong and must be
   replaced with what was actually chosen and why.

5. **Grep gates.** `en.ts` must no longer contain "never uploaded"; `vi.ts` must no longer
   contain "không bao giờ được tải lên". Add both as explicit criteria so a partial
   amendment cannot pass.

6. **Manual verification matrix.** Record a ≥2-minute conversation with at least four
   utterances on each browser, then on `/history/[conversationId]`:

   | Check                                                    | Chromium | Firefox | Safari |
   | -------------------------------------------------------- | -------- | ------- | ------ |
   | Recording uploads, `audioKey` set                        |          |         |        |
   | Player plays                                             |          |         |        |
   | Each gutter time seeks within **±1 s** of that utterance |          |         |        |
   | Scrubber shows a real total, not `Infinity`              |          |         |        |
   | Layout holds at ~400px width                             |          |         |        |

   Safari is in scope by user decision and is the branch most likely to need `audio/mp4`;
   it is also the only one where a failure means a whole browser gets no recording.

7. **Delete verification.** Delete a conversation that has a recording, then confirm the R2
   object is gone — by key, in the dashboard or via the S3 API. The route claims the object
   is deleted first; this is the check that it is.

8. **The ±1 s check is the one that matters most.** It is the only test of whether
   `audioOffsetMs` is aimed at the right instant. A constant error across every timestamp
   means the offset base is wrong, not the formatting. Note that
   `capture-pump.ts`'s `PRE_ROLL_MS = 320` may make times read slightly early; 320 ms is
   inside the tolerance, and a consistent early bias is a one-constant fix in the
   projection.

## Validation

```bash
pnpm typecheck        # i18n parity: vi.ts is `satisfies Messages`
pnpm lint
pnpm build
pnpm knip             # no new unused export
pnpm --filter web test
```

Plus:

```bash
grep -c "never uploaded" packages/i18n/src/en.ts          # must be 0
grep -c "không bao giờ được tải lên" packages/i18n/src/vi.ts   # must be 0
git diff --stat .github/workflows/deploy.yml              # must be empty
```

The deploy-smoke file being unmodified is a real gate, not bookkeeping: a diff there means
a new media origin was added, which means the design drifted off the contract's no-CSP-change
constraint.

## Risk and rollback

**Risk: the copy ships late.** This is the one failure mode that cannot be fixed forward,
because the window between "recording is live" and "the notice is accurate" is a window in
which the product misstates its handling of user voice data. Mitigated by merging this
phase in the same PR, not by remembering to follow up.

**Risk: Safari needs work nobody budgeted.** Phase 1 surfaces this a day early rather than
at the end. If Safari cannot record at all, the honest options are to ship it recording
nothing on that browser (timestamps still work) or to hold the feature — and that is a user
decision, not a silent degradation.

**Rollback:** the copy revert is a single block in two files. The docs revert with it.
Nothing here has runtime behaviour to roll back.
