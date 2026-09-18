# Quality check — production conversation `f35c2816`

Target: <https://chatofy.quanganh208.dev/history/f35c2816-2a22-449d-a81c-7e42b907b567>
Row: `Conversation.id = cmu4edytm001201pcn1uh8w8d`, owner `nquanganh254@gmail.com`,
direction `vi_to_en`, 53 turns, recording `conversations/cmt72nfg7000001lu37cimqwf/4a21daf904ea05ff.webm`.

## Method

Read the row and its turns straight from the production database
(`chatofy_prod_postgres`), downloaded the recording from the CDN
(`https://chatofy-cdn.quanganh208.dev/...`, HTTP 200, 789,549 bytes), decoded it
to 16 kHz mono PCM with PyAV, and built an independent reference transcript with
`gemini-3.5-transcribe`. Every error called out below was then re-checked by
transcribing that window alone with a second model (`gemini-3.8-flash` /
`gemini-3.5-flash`), so no finding rests on a single machine transcript.

Word error rate was computed by Levenshtein alignment of the reference against
the concatenated `sourceText`, after normalising number words to digits (the app
stores "mười một" where the reference writes "11"; `displayText` converts them
back, so those are not real errors). The reference includes the two words at the
head and the twenty at the tail that the app never had a chance at; they are
counted as errors because they are ones a reader experiences.

## What is sound

- **The recording is intact.** Decoded length 270.539 s against the stored
  `audioDurationMs = 270646`; Opus mono 48 kHz, no gaps, no truncation.
- **The timeline lines up with the media.** `offsetMs - audioOffsetMs` puts turn
  24 at 1:50, and the reference transcript has that same sentence at 1:50. Spot
  checks at 0:30 and 3:41 also land on the right audio.
- **Diarisation is right.** The source is a one-speaker livestream and all 53
  turns are `speaker_a`.
- **The English reads well.** Where the recogniser got the Vietnamese right —
  roughly 70% of turns — the translation is fluent, idiomatic and faithful,
  including hard conversational registers ("anh chị em đi làm lương thưởng đủ",
  "mình không thể tài ba lỗi lạc hết được").

## Word error rate

| Scope                   | Reference words | Edits | WER       |
| ----------------------- | --------------- | ----- | --------- |
| Whole conversation      | 867             | 116   | **13.4%** |
| Excluding the lost tail | 847             | 98    | **11.6%** |

`services/local-stt/README.md` advertises 5.38% WER for the Vietnamese
Zipformer. On this material it is about 2.2× worse. That is not a contradiction —
this is spontaneous livestream speech with heavy filler, brand names and
code-switching, which no read-speech benchmark covers — but it is the number the
thesis should quote for real conditions alongside the benchmark one.

## The failures, by cause

### 1. English inside Vietnamese speech — the dominant cause

The Vietnamese model has no path to an English word, so it emits Vietnamese
syllables that sound similar, and the translator then treats that garbage as
real Vietnamese and repairs it into confident nonsense. Every serious error in
this conversation is this one bug.

| Time       | Actually said                                                   | Stored `sourceText`                                     | Shown in English                                                       |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0:32       | "Yo what's up baby. Hello what's up baby."                      | "Dấu sắp bệnh tật"                                      | **"Signs of impending illness"**                                       |
| 1:50       | "một cái giải **poker** ở Mỹ hoặc là Úc"                        | "một cái giải **quốc cơ** ở mỹ"                         | **"A national championship in the US"**                                |
| 3:38       | "tôi đi học ngành **retail**"                                   | "tôi đi học ngành **vì theo**"                          | "I studied this major **because**…"                                    |
| 3:41       | "thực tập ở siêu thị **Target**"                                | "siêu thị **ta ghép** … search **ta ghét**"             | "Our Target supermarket, just search Target" (translator recovered it) |
| 3:52       | "Tôi có **bằng** luôn. **First in first out** chứ gì, đơn giản" | "tôi có **bảng** luôn **fer** mà"                       | "I actually have a **chart** for that." (FIFO lost entirely)           |
| 2:55       | "**bluetooth**"                                                 | "**bluetood**"                                          | harmless — translator read through it                                  |
| 0:35, 3:05 | "bánh mì **PewPew**", "tạp hóa **PewPew**"                      | "bánh mì **phiu phiu**", "tạp hóa **vinpe** / **view**" | "Banh Mi Phiu Phiu", **"the VinMart grocery store"** (invented brand)  |

The 1:50 line you flagged is exactly this: a poker tournament became a national
championship, and nothing on the screen tells the reader that a word was lost.

### 2. The translator repairs bad input instead of exposing it

Given nonsense the model writes plausible English rather than nonsense English.
"VinMart", "gifted me the house" (0:18), "The tax deadline is increased by what
percentage" (3:57, from "chỉ thuế kê lên" where the speaker said "thì kê lên"),
"There is nothing for you to be suspicious of" (4:08, "để bà nghi" for "để mà
nghĩ"). This is the part that matters for a translation product: a visible
mistranslation is a nuisance, an invisible one is a lie. One turn also leaks a
translator note into the output — 3:20 renders "năm bảy triệu" as "five or seven
million **[currency unit]** ones".

### 3. Both ends of the recording are missing from the transcript

**The opening.** The recording carries loud speech from its very first sample:
media 0.00–1.70 s, RMS peaking at 0.17, and both reference passes hear "Alo/Hello
anh em" there. The first stored turn opens at `offsetMs = 2843`, which is media
2.672 s and matches the next burst ("Nhiều", 2.4–2.8 s). So the whole first
utterance was recorded and never transcribed.

The cause is in the startup order, in `ConversationSession.start()`
(`packages/realtime-client/src/conversation/conversation-session.ts:466`):

```
await openMicrophone()      ← the MediaRecorder starts HERE (audioOffsetMs = 171)
await audioWorklet.addModule(workletUrl)
await socket.connect()
… only now is the capture pump connected to the microphone
```

`use-streaming-translate.ts:288` attaches the recorder inside `openMicrophone`,
so recording begins the instant `getUserMedia` resolves, while nothing reaches
speech-to-text until the worklet module has loaded and the WebSocket has opened.
Anything said in that window exists in the audio and in no turn. Here the window
was at least 1.70 s and at most 2.67 s.

The speech gate is not involved: `SpeechGate` starts at `noiseFloor =
MIN_NOISE_FLOOR` (0.004) and only adapts on silence, so a 0.17 RMS burst would
have opened a turn immediately had samples been flowing.

**The ending.** The same shape, without a diagnosed cause. The audio runs to
4:30, the last stored turn opens at 4:15, and roughly 4:22–4:30 — "một công việc
thì đi làm, có gì đâu. Có gì đâu mà nghĩ, nghĩ là nghĩ cái gì? Ủa cảm ơn" — is in
the audio and in both reference transcripts but in no turn.
`ConversationSession.finish()` is written to close the captured turn gracefully
(`closeCapturedTurn(false)`) precisely so the last sentence survives, so this
one still needs its own diagnosis.

### 4. Minor recogniser noise

A filler "Hè" translated as "Summer", "gạt hết đi" heard as "cả hết đi", "thế thôi" as
"thế tốt". None of these change what a reader takes away.

## Verdict

Of 53 turns, about 15 carry a visible error and about 8 change the meaning. The
pipeline's own parts are healthy — audio storage, duration, offsets, speaker
roles and the translation model are all doing their job. The quality ceiling on
this material is set by one gap: the Vietnamese recogniser cannot hear English,
and this speaker code-switches constantly (poker, retail, Target, bluetooth,
First in first out, PewPew, "what's up baby").

Worth considering, in order of return:

1. Route code-switched speech. The English model is already loaded in the same
   sidecar; running both and picking the higher-confidence hypothesis per
   utterance would fix most of the table above.
2. Keep proper nouns out of the recogniser's hands — a glossary/bias list of
   brand and domain terms (PewPew, Target, poker, retail) at the STT boundary.
   Note the existing finding that the glossary helps the strong translation
   model only; here it would be applied one stage earlier, to STT.
3. Stop the translator from inventing. When a source turn is low-confidence,
   showing the uncertainty beats showing fluent English.
4. Close the startup window — hold the microphone's first samples until the
   socket is live, or start the recorder only when capture does, so what is heard
   and what is stored agree — and diagnose the lost tail separately.

## Unresolved questions

- "lúc 1:50" was read as the 1:50 mark in the recording, which is the
  poker → "national championship" error. If you meant a wall-clock 1:50 instead,
  say so — the conversation itself ran 00:47–00:51 local time on 2026-09-17.
- Should the real-world WER (13.4%) be recorded next to the 5.38% benchmark
  figure in `services/local-stt/README.md` and the journey doc?
