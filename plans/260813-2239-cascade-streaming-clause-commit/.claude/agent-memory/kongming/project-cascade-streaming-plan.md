---
name: project-cascade-streaming-plan
description: Cascade streaming clause-commit plan (260813-2239) — user decisions, red-team blockers found 2026-08-13
metadata:
  type: project
---

Plan `plans/260813-2239-cascade-streaming-clause-commit` commits stabilized STT
prefixes mid-turn (translate+TTS per clause) on the extension cascade path.
**Why:** first-audio latency should be flat vs utterance length instead of
waiting for turn end; user wants cascade to feel like Gemini Live.

Locked user decisions (do not re-litigate): extension-only surface; Gemini free
tier retained; spoken output only from stabilized prefix; fixtures =
ElevenLabs + real recordings.

Red-team findings (2026-08-13) the implementation must address:
1. BLOCKER — headline "flat latency vs 40s monologue" presupposes lifting
   `MAX_UTTERANCE_MS = 8000` (`apps/extension/src/direction-session.ts:30`),
   but no phase before 5 changes it; per-turn `speechEndedAt−speechStartedAt`
   caps at ~8s, and baseline first-audio is already plateaued ~9-10s (8s cut +
   1163ms), not `utterance+1.2s` as brainstorm claims.
2. BLOCKER — `translate.gateway.ts:161-169` destructures `{direction,
   voiceGender}` and rebuilds the options object: a new `streaming` field is
   silently dropped unless the gateway is edited; it was missing from phase 3's
   file list.
3. LivePreview's `translateLive` (3 req/turn on gemini-3.5-flash-lite = same
   model as FINAL_MODELS[0]) was unaddressed for streaming turns — quota math
   and overlay UX both need it disabled there.
4. Clause boundaries: silence is known only client-side (speech gate); server
   must infer from frame timing or reuse `client.turn.speculate` as pause hint.

**How to apply:** when this plan reaches implementation or review, check these
four points were resolved before trusting phase acceptance criteria.
