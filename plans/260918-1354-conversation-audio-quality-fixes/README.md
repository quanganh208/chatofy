# Conversation audio quality fixes

Three defects found by analysing the production recording of conversation
`f35c2816` (report: `plans/reports/quality-260918-1340-conversation-f35c2816-audio-transcript.md`;
options and measurements: `plans/reports/brainstorm-260918-1354-conversation-audio-quality-fixes.md`).

**Outcome.** Spontaneous Vietnamese carrying English brand and domain terms
transcribes with its meaning-bearing words intact, and the transcript covers all
the speech the recording holds, from the first word to the last.

**Constraints.** Speech stays local and on CPU. STT may spend tens of
milliseconds more, not hundreds (today 58 ms of a p50 1163 ms budget). The
recogniser may be configured, not retrained. `@chatofy/realtime-client` is shared
with the extension.

**Non-goals.** Replacing the Vietnamese model. Changing how the translator
phrases output. Retrofitting past conversations.

| Phase | Subject                                                                               | Depends on | Status |
| ----- | ------------------------------------------------------------------------------------- | ---------- | ------ |
| 1     | [Contextual biasing through the existing hotwords](phase-1-stt-contextual-biasing.md) | —          | done   |
| 2     | [The startup window that loses the opening](phase-2-startup-window.md)                | —          | done   |
| 3     | [The lost tail](phase-3-tail-loss.md)                                                 | diagnosed  | done   |
| 4     | [Re-measure and correct the recorded numbers](phase-4-measurements.md)                | 1          | done   |
| 5     | [Backfill the sample conversation](phase-5-backfill-the-sample-conversation.md)       | 1          | done   |

**Acceptance criteria for the whole delivery.**

1. The 1:50 window of the sample recording transcribes "poker", and the 3:41
   window transcribes "Target" and "search", with the conversation's hotword list
   applied; aggregate WER on the same harness does not get worse.
2. STT RTF stays under 0.03.
3. Speech recorded before capture is live either reaches the recogniser or is not
   recorded at all: the transcript and the recording agree at both ends.
4. Each of the above is held by a test.
