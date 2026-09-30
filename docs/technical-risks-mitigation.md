# Technical Risks & Mitigation Plans: Video Conferencing

**Date:** 2026-09-29  
**Scope:** Detailed risk analysis, impact assessment, mitigation strategies  
**Constraints:** SFU, VP8, 6 participants, 720p60fps, per-minute billing

---

## Risk Matrix Overview

| Risk                                           | Probability  | Impact      | Effort to Mitigate | Priority |
| ---------------------------------------------- | ------------ | ----------- | ------------------ | -------- |
| **Video Latency > 2s**                         | HIGH (80%)   | CRITICAL 🔴 | Medium             | P1       |
| **Translation lag delays video**               | HIGH (70%)   | HIGH 🔴     | Medium             | P1       |
| **Speaker attribution wrong**                  | MEDIUM (50%) | MEDIUM 🟡   | Low                | P2       |
| **Subtitle mismatch (timing)**                 | MEDIUM (60%) | MEDIUM 🟡   | Medium             | P2       |
| **Recording composition fails**                | LOW (20%)    | HIGH 🔴     | Medium             | P2       |
| **SFU scalability beyond 6 participants**      | MEDIUM (50%) | HIGH 🔴     | High               | P2       |
| **Redis room state lost (crash)**              | LOW (10%)    | MEDIUM 🟡   | Low                | P3       |
| **Translation cost explosion**                 | MEDIUM (40%) | HIGH 🔴     | Low                | P2       |
| **Browser compatibility (codec)**              | LOW (15%)    | LOW 🟢      | Low                | P3       |
| **Database write contention (turns/messages)** | MEDIUM (45%) | MEDIUM 🟡   | Low                | P3       |

---

## P1 Risks: Critical Path

### Risk 1.1: Video Latency > 2 seconds

#### Description

End-to-end video latency (camera capture → network → receiver display) exceeds 2 seconds, making real-time conversation feel like a phone call delay.

**Breakdown:**

- Local encoding: ~50-100ms (VP8)
- Network RTT: ~30-100ms (depends on geography)
- Jitter buffer: ~50-200ms
- Decoding: ~50-100ms
- Total: ~200-500ms **ideal**, but can spike to 2-5s under poor conditions

#### Why It Happens

1. **Insufficient bandwidth**: Client drops frames, RTP retransmits delay video
2. **SFU hop delays**: If SFU is geographically distant (e.g., us-east for asia users)
3. **Codec complexity**: H264 vs VP8 encoding time mismatch
4. **Network congestion**: Shared WiFi, mobile networks
5. **Browser GC pauses**: JavaScript garbage collection stalls WebRTC thread

#### Mitigation Strategies

**Immediate (MVP, Weeks 1-3):**

- ✅ **TURN server proximity**: Deploy TURN servers in 3 regions (us, eu, asia)
  - Use Cloudflare's Relay (or Tailscale/Netbird alternative)
  - Config: `rtc-config.ts` lists TURN URLs per client geo
  - Fallback: Direct P2P if TURN unavailable

- ✅ **Codec selection**: Default VP8, but detect H264 support
  - VP8: Takes ~30-50ms to encode 720p60, better for wireless
  - Measurement: Compare encoded frame size (VP8 smaller = less bandwidth)

- ✅ **Bitrate adaptation (SFU side)**: Pion's built-in REMB (Receiver Estimated Maximum Bitrate)
  - Sidecar downscales resolution from 720p → 360p if bandwidth drops
  - Client preference (2500 kbps default) is a baseline, not a ceiling

- ✅ **Jitter buffer tuning**: Set to 50ms (aggressive) instead of default 200ms
  - Trade-off: Higher packet loss rate, but lower latency
  - Measure on real network before deploy

**Short-term (Weeks 4-8):**

- 📊 **Telemetry**: Log every frame's timestamp
  - `{ captureTime, encodeTime, sendTime, receiveTime, decodeTime, displayTime }`
  - Alert if p99 latency > 1.5s
  - Dashboard: Histogram of latencies per connection

- 🎯 **Load testing**: Simulate poor network (2G/3G)
  - Use Chrome DevTools throttling in e2e tests
  - Measure: Can 6 participants on 3G talk without video lag?

- 🔄 **Fallback: Audio-only mode**
  - If video latency > 2s for > 30s, auto-degrade to audio + subtitles
  - User can manually re-enable video

**Long-term (Weeks 9+):**

- 🏗️ **SFU cluster**: Multi-region deployment (us-west, us-east, eu, asia)
  - Route participants to nearest SFU instance
  - Measure: Latency should drop to 300-500ms globally

- 🧠 **ML-based bitrate control**: Predict network conditions 100ms ahead
  - Use MLAgent to lower bitrate before packet loss spike
  - Requires: Collect historical packet-loss patterns

#### Measurement & Success Criteria

```
Benchmark (SFU in same region):
├─ Latency p50: 200-300ms ✅
├─ Latency p99: 500-800ms ✅ (tolerable for async)
└─ Jitter: < 100ms ✅

After mitigation:
├─ TURN deployed: Latency p50 → 250ms (±50ms)
├─ Bitrate adaptation: 0 frame drops on 2Mbps connection
└─ Fallback active: Never stay > 2s latency (drop to audio instead)
```

---

### Risk 1.2: Translation Lag Delays Video Sync

#### Description

Video (fast, ~300ms latency) arrives before translated subtitle (~1-2s latency), creating mismatch: user sees video of person speaking, but subtitle appears 0.5-2 seconds later (or even shows previous person's text).

**Breakdown:**

- Video path: Capture → Network → SFU → Client (300ms)
- Audio path: Capture → Network → STT (300ms) → Translation (500-1000ms) → TTS (200ms) → Network (100ms) → Total ~1.2-1.8s
- **Gap: 0.9-1.5 seconds**

#### Why It Happens

1. **STT latency**: Streaming doesn't help much; model still needs full audio frame (~500ms)
2. **Translation API roundtrip**: Gemini/DeepSeek takes 500-800ms for one sentence
3. **TTS streaming**: Even streamed, first byte comes ~200ms after translation completes
4. **No prioritization**: All 6 participants' streams process in parallel, no guaranteed ordering

#### Mitigation Strategies

**Immediate (MVP):**

- ✅ **Show "transcribing..." placeholder**
  - Subtitle area displays spinner until text ready
  - Prevents user thinking something is wrong

- ✅ **Live preview (already built in Chatofy)**
  - Show partial translation while speaker continues
  - Viewers see SOMETHING within 1s
  - Caveat: Preview may be incomplete/wrong, but at least keeps screen alive

- ✅ **Separate audio tracks for translation**
  - Translated audio (synthesis) goes to client's own audio mixing
  - NOT mixed with video sync; independent playback
  - If audio is 1.5s late, that's fine (normal phone delay)
  - Video still plays at real-time speed

**Short-term (Weeks 4-8):**

- 📊 **Track end-to-end latency per participant**
  - `latency = captureTime → subtitleDisplayTime`
  - Alert if p95 > 2s
  - Aggregate by language pair (vi→en vs en→vi may differ)

- 🎯 **Speculative translation (already built)**
  - Translate partial audio at 2s mark (before silence)
  - If speaker continues, translation gets updated
  - If speaker stops, use the guess
  - Saves ~500ms on short turns

- 🔄 **Subtitle staggering**
  - If translation N hasn't arrived, show subtitle N-1 (previous speaker)
  - Don't show blank subtitle; show something
  - Client-side logic: `[subtitle queue] ← [translations] (sorted by time)`

**Long-term (Weeks 9+):**

- 🧠 **Batch translation (off-cycle)**
  - Translate the LAST 30s of audio while meeting is live
  - Use faster model (cheaper, slightly less accurate)
  - Post-meeting: Full translation for archive
  - Measurement: Can we predict speaker will stop, translate preemptively?

- 🏗️ **Edge translation**
  - Deploy lightweight translation service (e.g., Ollama, local model) at SFU
  - 100ms roundtrip instead of 500ms to cloud
  - Trade-off: Lower accuracy (small model)

- 📡 **Protocol: Prioritize hot speakers**
  - If 3 people talk at once, only translate current speaker + 1 future
  - Defer others until speaker changes

#### Measurement & Success Criteria

```
Current (no optimization):
└─ Video-to-subtitle latency p95: 1.8-2.2s ❌

After mitigation:
├─ Live preview visible: < 1.0s ✅
├─ Final subtitle visible: < 1.5s ✅
├─ Speculative guess correct: 60% of time ✅
└─ User feels "sync": 80% satisfaction ✅
```

---

## P2 Risks: High Impact

### Risk 2.1: Speaker Attribution Wrong (50% Probability)

#### Description

Auto-attribution identifies "Speaker 1" as the wrong person, leading to confusion ("Did Bob really say that?").

**Breakdown:**

- CAM++ embedding accuracy: ~94.5% on clean audio, ~91% far-field (per system-architecture.md)
- In a meeting with 2+ people talking simultaneously, accuracy drops
- Manual override rate: Expected ~10% of turns

#### Scenarios

1. **Close friends** (similar voice): Clustering algorithm groups them together
2. **Echo/reverb**: Sidecar captures room audio twice (speaker + playback), embeddings diverge
3. **Background speaker** (TV, radio): Gets its own speaker ordinal (false positive)
4. **Speaker with cold/hoarse voice**: Embedding drifts mid-meeting

#### Mitigation Strategies

**Immediate:**

- ✅ **Manual override UI**
  - On transcript page, user can click "Speaker 2 (was wrong)" → dropdown to pick correct person
  - Change propagates to history (re-summarize minutes if needed)
  - Log: `{turnId, oldSpeakerId, newSpeakerId, confirmedBy, confirmedAt}`

- ✅ **Confidence score display**
  - Show "(80% confident)" next to speaker name
  - <85% confidence → offer override option immediately

- ✅ **No re-labeleling after render**
  - Once a turn is displayed, speaker label is final
  - Prevent "name changing mid-viewing" confusion
  - (Already implemented in system-architecture.md)

**Short-term:**

- 📊 **Accuracy audit**
  - Sample 5% of meetings per week
  - Manually verify speaker labels
  - Track accuracy by: num speakers, room echo, speaker similarity
  - Alert ops if accuracy drops below 88%

- 🎯 **Enrollment option**
  - User's first turn: auto-enroll (one embedding per person)
  - Future turns: match against enrolled profile
  - Opt-in, stored locally (not persisted to DB for privacy)

**Long-term:**

- 🧠 **Context-aware clustering**
  - Use turns' TEXT (speaker history) alongside embeddings
  - If "Bob" always talks about engineering, and this turn discusses design, adjust confidence
  - Requires: Natural language understanding (overkill for MVP?)

- 🏗️ **Multi-modal attribution**
  - Combine: Voice embedding + detected faces (if video is available)
  - Requires: Face detection model (privacy concern, may skip)

#### Measurement & Success Criteria

```
SLA: > 90% speaker attribution accuracy

Monitoring:
├─ Manual override rate < 10% per meeting ✅
├─ Audio confidence distribution: Show histogram
├─ Accuracy by scenario:
│  ├─ Single speaker: > 99% ✅
│  ├─ 2 speakers: > 95% ✅
│  ├─ 3+ speakers: > 85% ⚠️
│  └─ With echo: > 80% ⚠️
└─ User satisfaction: "Speaker labels were correct" > 85% ✅
```

---

### Risk 2.2: Subtitle Mismatch (Timing/Content)

#### Description

Subtitle appears at wrong timestamp or shows wrong translation, leading to user confusion ("Did she really say that?").

**Types of Mismatches:**

1. **Timing skew**: Subtitle appears 2s before/after the audio
2. **Content mismatch**: Subtitle is translation of PREVIOUS person's turn
3. **Truncation**: Subtitle cuts off mid-sentence
4. **Language mismatch**: Subtitle in wrong language for the viewer

#### Why It Happens

1. **Async processing**: STT, translation, TTS run in parallel; finish times vary
2. **Network jitter**: Subtitle packet arrives out-of-order
3. **Client-side merge**: Display groups merge multi-turn utterances; timing gets fuzzy
4. **Sidecar lag**: If TTS engine is busy, subtitle emitted but audio delayed

#### Mitigation Strategies

**Immediate:**

- ✅ **Timestamp every subtitle**
  - Subtitle event includes: `{speakerId, text, startMs, endMs, language, confidence}`
  - Client renders subtitle only when `startMs <= currentPlaybackTime <= endMs`
  - Subtitle queue sorts by startMs; play in order

- ✅ **Validation gate**
  - Refuse subtitle if:
    - `endMs < startMs` (invalid range)
    - `startMs > currentTime + 5000` (too far in future)
    - `text.length > 500` (truncation guard, warn ops)
  - Invalid subtitles logged, not displayed

- ✅ **UI fallback: Manual sync**
  - User can tap "Sync subtitles" button
  - Forces re-download of transcript from server
  - Clears client-side queue, re-renders in order

**Short-term:**

- 📊 **Subtitle accuracy audit**
  - Weekly: Sample 20 meetings
  - Manual review: Check if each subtitle matches audio/translation
  - Accuracy target: > 98%
  - Track failures by: language pair, speaker, time of day

- 🎯 **A/B test: Subtitle delay**
  - Control: Display subtitle immediately (current)
  - Variant: Delay subtitle by 500ms (let audio sync)
  - Measure: User satisfaction, skip rate
  - Decision: If variant > 5% better, apply to all

**Long-term:**

- 🧠 **ML-based sync correction**
  - Learn: "Usually, speech ends 200ms before translation arrives"
  - Auto-adjust: Shift all subtitles by learned offset
  - Requires: Historical subtitle-audio alignment data

#### Measurement & Success Criteria

```
SLA: > 98% subtitle-to-audio sync accuracy

Monitoring:
├─ Subtitle within [startMs±500ms] of audio: > 98% ✅
├─ Truncation rate: < 0.1% per meeting ✅
├─ Invalid subtitle refusals: Log (should be 0) 🔍
└─ User sentiment: "Subtitles were clear" > 90% ✅
```

---

### Risk 2.3: Recording Composition Fails

#### Description

Video composition job hangs, crashes, or produces corrupted output (no audio track, video glitchy, subtitles misaligned in final file).

**Failure Modes:**

1. **Timeout**: FFmpeg job runs > 30min for a 1hr recording (out-of-memory)
2. **Codec mismatch**: VP8 video + opus audio, but MP4 container doesn't support opus (audio missing)
3. **Subtitle rendering**: OpenCV/PIL fails on Unicode (Vietnamese text crashes rendering)
4. **Storage full**: R2 quota exceeded, upload fails silently (meeting appears recorded, but file is 0 bytes)

#### Why It Happens

1. **Async job complexity**: Recording job is separate process; errors not immediately visible
2. **Resource constraints**: SFU host is also running STT/TTS sidecars; memory contention
3. **FFmpeg quirks**: Different ffmpeg versions behave differently
4. **R2 quota**: No pre-check before starting job; upload fails only when flushing

#### Mitigation Strategies

**Immediate:**

- ✅ **Pre-flight checks**
  - Before starting composition job:
    - Check R2 space available (abort if < 500MB)
    - Check disk space on SFU host (abort if < 2GB)
    - Check FFmpeg version (support VP8? Opus in MP4? Unicode fonts?)
  - Refuse to start job if any check fails (400 error to API)

- ✅ **Fallback: Segments**
  - Instead of one 1hr .mp4, record as:
    - `recording/{id}_segment_0.mp4` (every 10min)
    - `recording/{id}_segment_1.mp4`
    - ...
  - If one segment fails, user gets 90% of recording
  - Segments can be re-composed asynchronously

- ✅ **Timeout + retry**
  - Timeout: 10 min per 1 hour of recording (e.g., 1hr meeting → 10min timeout)
  - Retry: On timeout, try AGAIN with lower bitrate (2Mbps → 1Mbps)
  - Max retries: 3, then mark as failed + notify user

**Short-term:**

- 📊 **Recording job telemetry**
  - Log: Start time, FFmpeg version, input specs, output size, duration, success/fail
  - Alert: If > 5% of jobs fail, page on-call
  - Automated: Retry failed jobs (off-peak hours)

- 🎯 **E2E test: Recording**
  - Test fixture: Compose a 5min sample recording (all codecs, languages)
  - Verify: Can download, play in VLC, no corruption
  - Run: Weekly, before deploy

- 🔄 **User notification**
  - Don't hide recording failures
  - After meeting ends, show: "Recording: ⏳ Compositing..." → "✅ Ready" or "❌ Failed"
  - Failed: "Recording unavailable. We're working on it." + Support link

**Long-term:**

- 🧠 **Streaming composition**
  - Instead of async job, composite in real-time during meeting
  - Write segments to R2 as they complete
  - User can download partial recording immediately
  - Requires: Redesign of TTS + subtitle injection (complex)

- 🏗️ **Multi-format fallback**
  - If MP4 composition fails (codec mismatch), fall back to Matroska (.mkv)
  - Matroska more flexible (supports any codec combo)
  - Trade-off: Not all players support .mkv

#### Measurement & Success Criteria

```
SLA: > 99% recording success rate

Monitoring:
├─ Recording composition success: > 99% ✅
├─ Average composition time: < 3min per 1hr meeting ✅
├─ User retrievable rate: 100% (no 0-byte files) ✅
├─ Corruption rate: < 0.1% (detected by playback) ✅
└─ Time-to-availability: < 5min after meeting ends ✅
```

---

### Risk 2.4: SFU Scalability Beyond 6 Participants

#### Description

Performance degrades or crashes when 7+ participants join (exceeds design constraint).

**Breakdown:**

- Pion SFU handles N participants by forking N-1 video tracks (each participant gets N-1 feeds)
- At 6 participants: 6 × 5 = 30 tracks on the SFU
- At 20 participants: 20 × 19 = 380 tracks (possible, but CPU high)
- Goal: Graceful degradation, not crash

#### Why It Happens

1. **CPU saturation**: Encoding 30 VP8 tracks = 100%+ CPU
2. **Memory**: Each track buffers ~1s of frames (~500KB); 30 tracks = 15MB
3. **Network**: SFU outbound = N × bitrate (6 participants × 2.5Mbps = 15Mbps out)
4. **No admission control**: API accepts 7th join request, then SFU struggles

#### Mitigation Strategies

**Immediate:**

- ✅ **Hard limit: 6 participants**
  - API layer: On `ConferenceParticipant.count >= 6`, refuse new joins with 403
  - Error message: "This meeting is full. Max 6 participants."
  - Allow owner to raise limit (feature for future)

- ✅ **CPU monitoring**
  - SFU reports CPU% to API every 10s
  - If CPU > 80%, reject new subscribers (video-only, no audio)
  - If CPU > 95%, degrade bitrate (fallback to 1Mbps)

- ✅ **Admission control**
  - API tracks in-memory: `{conferenceId, participantCount, estimatedCpuLoad}`
  - Refuse join if `estimatedCpuLoad > 0.8`

**Short-term:**

- 📊 **Load testing**
  - Simulate 10 participants (edge case)
  - Measure: CPU%, latency, packet loss
  - Document: Maximum stable participant count = 6

- 🎯 **Graceful degradation**
  - If 7th participant joins (shouldn't happen, but if quota check fails):
    - 7th participant gets audio + subtitles only (no video feed)
    - Existing 6 continue at full quality
    - Log: Admission control failure (alert ops)

**Long-term:**

- 🧠 **SFU cluster**
  - Split 20 participants across 3 SFU instances (7 each)
  - Coordinator routes: Participant A streams to SFUs 1,2,3
  - Complex: Requires inter-SFU communication (not in MVP)

- 🏗️ **Selective forwarding refinement**
  - Don't send all 6 feeds to each participant
  - Send: Current speaker + 2 others (3 feeds instead of 5)
  - Save: 40% CPU
  - Trade-off: Users can't see everyone at once (different layout)

#### Measurement & Success Criteria

```
SLA: Stable at 6 participants, graceful fail at 7+

Monitoring:
├─ P50 latency at 6 participants: < 500ms ✅
├─ CPU utilization at 6 participants: < 70% ✅
├─ Admission control accuracy: 100% (reject 7th) ✅
├─ Participant satisfaction at 6: > 90% ✅
└─ Graceful degradation if limit exceeded: Video-only → audio-only ✅
```

---

### Risk 2.5: Translation Cost Explosion

#### Description

Translation API costs spiral beyond budget due to:

1. Long meetings (5+ hours, unexpected participants)
2. Speculative translations (multiple guesses per turn)
3. Live previews (every 3 seconds, unnecessary cost)
4. Message translation (auto-translate all chat)

**Cost Model (with per-minute billing):**

```
Cost per participant-minute = $0.10 (your rate)
Meeting: 6 participants, 1 hour = 6 × 60 × $0.10 = $36 revenue

API costs:
├─ STT: 6 × 1 hour × $0.01/min = $3.60
├─ Translation: 6 × 1 hour × $0.02/min (speculative) = $7.20
├─ TTS: 6 × 1 hour × $0.01/min = $3.60
└─ Total: $14.40 / $36 revenue = 40% margin ✅

But if:
├─ 10 speculative translations per turn (high pause rate)
├─ Chat auto-translation (3 messages/min × 6 people × 60min = 1080 translations)
└─ Total API cost → $30+ / $36 revenue = 17% margin ❌
```

#### Mitigation Strategies

**Immediate:**

- ✅ **Disable chat auto-translation**
  - Chat translation is opt-in (user clicks "translate this message")
  - Not automatic on all messages
  - Saves: ~$5-10 per meeting

- ✅ **Cap speculative translations**
  - Max 3 per turn (already implemented in system-architecture.md)
  - If speaker pauses 4+ times, only translate first 3

- ✅ **No live preview translation cost**
  - Live preview is already built; reuse existing translation
  - Don't issue EXTRA API call for preview

- ✅ **Billing audit**
  - Post-meeting: Log actual costs
  - If cost > 60% of revenue, alert ops + investigate
  - Example: If actual cost $24 and revenue $36, margin only 33% (should be 60%+)

**Short-term:**

- 📊 **Cost tracking per meeting**
  - Breakdown:
    ```sql
    SELECT
      c.id, c.durationSeconds, COUNT(DISTINCT cp.id) AS participant_count,
      cbl.sttCostCents, cbl.translationCostCents, cbl.ttsCostCents,
      cbl.baseChargeCents,
      (cbl.sttCostCents + cbl.translationCostCents + cbl.ttsCostCents)
        / NULLIF(cbl.baseChargeCents, 0) * 100 AS cost_to_revenue_ratio
    FROM Conference c
    JOIN ConferenceBillingLine cbl ON c.id = cbl.conferenceId
    WHERE cost_to_revenue_ratio > 50;
    ```
  - Alert: If ratio > 50% (target 40%)

- 🎯 **Test edge case: Very long meeting**
  - Simulate 5hr meeting (6 participants)
  - Measure: Actual API costs
  - Decision: Set max meeting length? (e.g., 8hr cutoff, charge extra)

**Long-term:**

- 🧠 **Smarter speculation**
  - Don't guess EVERY pause; use silence duration to predict end
  - Short pause (100ms) → no guess needed
  - Long pause (800ms+) → guess
  - Saves: ~50% speculative translations

- 🏗️ **Edge translation (local model)**
  - Deploy lightweight open-source model on SFU
  - Reduce cloud translation calls by 30%
  - Trade-off: Slightly lower accuracy

- 📡 **Batch translation (async)**
  - After meeting: Translate full transcript in one API call
  - Cheaper per-token than streaming calls
  - For archive/replay, not live viewing

#### Measurement & Success Criteria

```
SLA: API cost / Revenue < 40%

Monitoring:
├─ Per-meeting cost breakdown: Published daily
├─ Cost anomalies: Alert if ratio > 50%
├─ Speculative translation waste: Track "guesses used" vs "guesses total"
├─ Chat translation opt-in rate: Target < 20% (keep costs down)
└─ User satisfaction: "Translation quality" > 4/5 (don't over-compress)
```

---

## P3 Risks: Lower Priority

### Risk 3.1: Redis Room State Lost

**Probability:** 10% (only if Redis container crashes)  
**Impact:** Room state lost; participants booted with "conference ended" message  
**Mitigation:**

- ✅ Checkpoint room state to Postgres every 30s (async job)
- ✅ On restart, reload from DB checkpoint
- ✅ Max 30s of state loss (acceptable)

### Risk 3.2: Browser Codec Mismatch

**Probability:** 15% (some old Safari versions)  
**Impact:** User can't send/receive video  
**Mitigation:**

- ✅ Fallback to H264 if VP8 rejected
- ✅ Test on 5 browsers (Chrome, Safari, Firefox, Edge, mobile)
- ✅ Graceful fallback to audio-only if codec fails

### Risk 3.3: Database Write Contention

**Probability:** 45% (if many messages + turns written simultaneously)  
**Impact:** Slow queries, missed captions  
**Mitigation:**

- ✅ Use `Serializable` isolation on batch writes
- ✅ Retry on serialization failure (exponential backoff)
- ✅ Write metrics to logs (JSONL) first, batch insert async

---

## Risk Monitoring Dashboard

### Metrics to Track (Grafana)

```
Real-time:
├─ Active conferences: gauge
├─ Participants per conference: histogram
├─ Video latency p50/p95/p99: gauge
├─ Subtitle latency: gauge
├─ Translation cost per minute: gauge
├─ API error rate (STT/TTS/Translation): rate
├─ SFU CPU%, memory%: gauge
└─ Redis connection count: gauge

Historical (Daily):
├─ Total meetings per day: counter
├─ Avg meeting duration: gauge
├─ API costs per day: gauge
├─ Revenue per day: gauge
├─ Margin (revenue - costs): gauge
├─ Speaker attribution override rate: rate
├─ Recording success rate: rate
└─ User satisfaction (CSAT): gauge
```

### Alerts (PagerDuty)

```
🔴 CRITICAL:
├─ SFU CPU > 95% for > 5min (page on-call)
├─ Video latency p95 > 2s (page on-call)
├─ Recording job failure rate > 5% (page on-call)
└─ Translation API timeout rate > 10% (page on-call)

🟡 WARNING:
├─ Cost/revenue ratio > 50% (notify ops)
├─ Subtitle latency p99 > 2s (notify ops)
├─ Speaker attribution override rate > 15% (notify ops)
└─ Room state loss detected (notify ops)
```

---

## Testing Strategy for Risk Mitigation

### Unit Tests

- **Timestamp validation**: Subtitle range checks (`endMs >= startMs`)
- **Language validation**: Participant lang ∈ conference.languages
- **Cost calculation**: Verify formula matches billing logic
- **Codec support**: Mock WebRTC offer/answer, verify VP8 + fallback

### Integration Tests

- **End-to-end latency**: Synthetic participant joins, speaks, measure to subtitle display
- **Load test**: 3 participants, 10 minutes, measure CPU/memory
- **Failover**: Restart Redis, verify room state recovered
- **Recording**: Compose sample recording, verify codec + audio tracks

### E2E Tests (Playwright)

- **Happy path**: Alice joins → Bob joins → Alice speaks → Subtitle appears → Bob responds → Recording saves
- **Error path**: Bob joins with no internet → Audio-only mode → Reconnect → Full video
- **Scale path**: 6 participants, 30 minutes, verify all subtitles sync, costs reasonable

### Load Test (k6 or Locust)

```
Scenario: 10 parallel 30-minute meetings (60 participants total)
├─ Ramp-up: 2 participants every 30s (5min total)
├─ Hold: Run for 30min at full load
├─ Ramp-down: 2 participants leave every 30s (5min total)
├─ Measure: Latency, CPU/memory, API error rate, cost
└─ Pass criteria: P99 latency < 1s, error rate < 1%, CPU < 80%
```

---

## Rollback & Incident Response

### If Critical Risk Fires

1. **Video latency > 2s**
   - Auto-switch to audio-only mode (no video)
   - Alert: "Video quality low, using audio instead"
   - Rollback: Revert to previous SFU version (compiled binary at deploy time)

2. **Recording job failing 20%+**
   - Disable recording temporarily (API returns 409)
   - Notify users: "Recordings temporarily unavailable"
   - Ops: Debug FFmpeg, fix, redeploy

3. **Translation API costs 70%+ of revenue**
   - Disable speculative translations immediately
   - Disable live preview immediately
   - Make message translation opt-in only
   - Negotiate lower rates with API provider

---

## Success Criteria: Production Readiness

Before launch, all **P1 risks must be mitigated** to < 5% impact:

- [ ] Video latency p99 < 1.5s (TURN deployed)
- [ ] Subtitle latency p99 < 2s (live preview + fallback)
- [ ] Recording success rate > 99%
- [ ] Speaker attribution accuracy > 90%
- [ ] API cost/revenue < 40%
- [ ] SFU stable with 6 participants

**Then: GA Launch** 🚀

---

**Document Version:** 1.0  
**Last Updated:** 2026-09-29
