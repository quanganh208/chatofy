# Refusal retry budget tied to the pending ceiling

## Change

`packages/realtime-client/src/conversation/turn-pipeline.ts`

- Removed `MAX_REFUSAL_RETRIES` (fixed count of 4).
- `onError`'s `too_many_turns` give-up check now compares wall-clock time since
  the turn opened (`this.now() - turn.openedAt`) against `MAX_PENDING_MS`
  (20s) instead of counting attempts. Same deadline the pending ceiling would
  use to evict this turn's audio if it sat un-sent that long — one number,
  read from the existing constant, instead of two that could drift.
- `REFUSAL_RETRY_MS` (750ms) unchanged — still the retry cadence, doc comment
  updated to point at `MAX_PENDING_MS` instead of the old hardcoded "20
  seconds later" prose.
- Close reason on give-up stays `'too_many_turns'`; log line at give-up
  unchanged (still reports `turn.refusals` count and held-audio ms).

## Tests

`packages/realtime-client/src/conversation/turn-pipeline.spec.ts`

- Renamed and rewrote the give-up test: drives 13 refusals (~9.75s, past the
  old ~3s/4-attempt budget) and asserts the turn is still open, then drives to
  28 total refusals (~20.25s) and asserts give-up. 28 is exact — with fake
  timers advancing 750ms per iteration, iteration `i` (0-indexed) sees elapsed
  `i * 750ms`; the first iteration where `i * 750 >= 20_000` is `i = 27`
  (elapsed 20,250ms), the 28th call.
- Other `too_many_turns` tests (`keeps the turn and its audio...`, `retries on
its own...`, `stops retrying once torn down`) needed no changes — none
  drive past the new deadline.

## Verification

- `pnpm --filter @chatofy/realtime-client exec vitest run src/conversation/turn-pipeline.spec.ts` — 26/26 pass.
- `pnpm --filter @chatofy/realtime-client typecheck` — clean.
- `pnpm --filter @chatofy/realtime-client test` (full package) — 356 pass, 1
  fail: `conversation-session.spec.ts > ... > a turn the server kept
refusing > is reported as abandoned rather than vanishing`. Expected per
  the task brief — that spec drives five refusals (the old budget) and is
  owned by another workstream to update; not touched here.
- `grep -rn MAX_REFUSAL_RETRIES` across the repo — no remaining references.

## Not done / not concluded

- Did not touch `conversation-session.ts` or its spec, or
  `fake-audio-context.ts`, per file-ownership boundary.
- Did not change `MAX_CONCURRENT_TURNS_*` or state anything about what caused
  the original refusals — out of scope and unproven per the diagnosis.

## Unresolved questions

None.
