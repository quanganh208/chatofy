---
phase: 2
title: 'Phase 2: Contracts, schema, and the offset projection'
status: completed
priority: P1
effort: '3-4h'
dependencies: []
---

# Phase 2: Contracts, schema, and the offset projection

## Overview

Persist the measurement that already exists. `TurnCapture { openedAt, closedAt }` is
computed client-side today and `display-groups.ts` already trusts `openedAt` to decide
whether two turns were one utterance — the schema comment on `ConversationTurn` records
that these capture times "never have to be persisted". This phase makes one of them
persistent, and adds the three columns the recording needs on the parent row.

Nothing reads any new column as a claim about a row: every one is nullable, because every
existing conversation has no recording and no timestamps, and a backfill would be
inventing data.

## Requirements

Functional:

- `ConversationTurn` gains `offsetMs` — milliseconds from the conversation's `startedAt`
  to the moment capture opened on that **displayed block**, which is its _first_ member's
  `openedAt`.
- `Conversation` gains `audioKey`, `audioOffsetMs` and `audioDurationMs`.
- `toConversationTurns` computes each block's `offsetMs` from `state.captures`.
- The HTTP contracts carry `offsetMs` in and `hasRecording`/`audioOffsetMs`/
  `audioDurationMs` out. **The key never appears in any contract.**

Non-functional:

- The migration adds only nullable columns and **no index**. `offsetMs` is never a filter
  or a sort key — rows are ordered by `position`, which is already the read index.
- `conversationSummarySchema` is untouched. A recording marker on the list card is scope
  the request does not contain.
- `packages/realtime-client` must stay usable by the extension. Only
  `toConversationTurns`' signature changes, and the extension calls neither it nor
  `saveConversation`.

## Files

Owned by this phase:

- `apps/api/prisma/schema.prisma` — three columns on `Conversation`, one on
  `ConversationTurn`, plus the docblock rewrite
- `apps/api/prisma/migrations/<new>/migration.sql`
- `packages/types/src/domain/conversation.ts`
- `packages/types/src/http/conversations.ts`
- `packages/realtime-client/src/state/conversation-turns.ts`
- `packages/realtime-client/src/state/conversation-turns.spec.ts`

## Steps

1. **Schema.** Add to `Conversation`:
   - `audioKey String?` — the R2 object key, **not** a URL. Comment must say why a key is
     still right even though this bucket _does_ have a public origin: the origin is
     configuration, the route is the intended way in, and moving to a private bucket later
     must not be a data migration.
   - `audioOffsetMs Int?` — milliseconds between `startedAt` and the first recorded sample.
     Not zero: `startedAt` is stamped at `use-streaming-translate.ts:383`, _before_ the
     permission prompt, the worklet load and the socket connect.
   - `audioDurationMs Int?` — the recording's wall-clock length, stored rather than read
     from the media, because `MediaRecorder` writes no Duration into the WebM header and
     `audio.duration` reads `Infinity` (Phase 1 supplies the evidence for this comment).

   Add to `ConversationTurn`: `offsetMs Int?`, with a comment naming it as the first
   member's `openedAt` and the same measurement display grouping already trusts.

2. **Rewrite the `ConversationTurn` docblock.** It currently reads "there is no per-turn
   `createdAt`: the capture timestamps grouping needed never have to be persisted. No
   `audioUrl` either; no audio is retained anywhere." Both halves stop being true in this
   commit and both must be rewritten here, not later.

3. **Migration.** `prisma migrate dev --name add_conversation_audio`. Verify the generated
   SQL is four `ADD COLUMN … NULL` statements and nothing else — no index, no backfill, no
   default.

4. **Contracts.** `conversationTurnSchema` gains `offsetMs: z.number().int().min(0).nullable()`.
   `conversationSchema` gains `hasRecording: z.boolean()`, `audioOffsetMs` and
   `audioDurationMs`, both nullable integers.
   `saveConversationTurnSchema` gains
   `offsetMs: z.number().int().min(0).max(HISTORY_LIMITS.MAX_DURATION_MS).nullable()`.
   Add `HISTORY_LIMITS.MAX_CONVERSATION_AUDIO_BYTES = 32 * 1024 * 1024`, with a comment
   tying it to the recorder's `audioBitsPerSecond: 24_000` the way the existing 1 MB /
   400,000-char pair is tied — 3 kB/s reaches the cap at ~3h06m, and raising either
   without the other is wrong.

5. **Do not add a non-decreasing refine on the offsets.** An earlier draft rejected the
   whole body when offsets ran backwards; that makes one bad number cost the entire
   transcript, and the transcript is the thing that must not be lost. Clamp at the
   projection instead (step 6).

6. **Projection.** `toConversationTurns(state, startedAtMs)` computes, per block:

   ```ts
   const opened = state.captures[head.sessionId]?.openedAt;
   const offsetMs = opened === undefined ? null : Math.max(0, opened - startedAtMs);
   ```

   Every piece produced by `splitAtCap` / `spreadOver` carries the **block's** offset — a
   split is one utterance shown as several rows and they were all said at one moment.

## Validation

```bash
pnpm --filter types test
pnpm --filter realtime-client test
cd apps/api && pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
pnpm typecheck
```

New test cases that must exist:

- `saveConversationTurnSchema` accepts `offsetMs: null` and an integer in range; rejects a
  negative and a non-integer.
- A block's `offsetMs` equals its **first** member's `openedAt − startedAtMs`.
- Every piece of a block split by `splitAtCap` carries the same `offsetMs`.
- A block whose session has no capture record yields `offsetMs: null`.
- A capture earlier than `startedAtMs` clamps to `0` rather than going negative.

`prisma migrate diff … --exit-code` must exit **0** — a non-zero exit is schema drift and
means the migration does not match the model.

## Risk and rollback

**Risk: the migration runs against a database with existing rows.** All four columns are
nullable with no default, so every existing row stays valid and no backfill query runs.
This is additive in the strict sense.

**Rollback:** drop the four columns. Nothing reads them until Phase 3, and no data is
derived from them, so a revert loses nothing that existed before this phase.

**Watch:** the repo has a squashed migration baseline and a documented history of drift
pain (see `README.md`, "If `migrate deploy` refuses on a database you already had"). Run
`migrate diff` rather than trusting that `migrate dev` produced what was intended.
