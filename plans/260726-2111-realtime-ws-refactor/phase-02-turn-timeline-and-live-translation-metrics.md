---
title: 'Phase 2: turn timeline and live translation metrics'
status: todo
phase: 2
priority: P2
effort: '4h'
dependencies: [1]
---

# Phase 2: turn timeline and live translation metrics

## Overview

`end()` đang giữ 7 biến `let` timing, một inline type 11 field, và gọi `recordTurn` trùng lặp
ở cả `try` và `catch`. Thay bằng `TurnTimeline` + một closure `record()` local. Đồng thời vá
lỗ hổng metrics: live translation đang tiêu quota mà `TurnMetrics` không ghi, dù
`LiveTranslationTrigger.spentCount` đã tồn tại và doc của nó đã hứa điều đó.

Phase này cũng là nơi service về đích ≤200 LOC.

## Requirements

Functional:

- [ ] `TurnMetrics` có field mới `liveTranslations: number` từ `LiveTranslationTrigger.spentCount`
- [ ] Mọi field `TurnMetrics` hiện có giữ nguyên tên, đơn vị, cách tính, kể cả luật fallback
- [ ] Turn lỗi vẫn ghi một row `completed: false`, và **record chạy TRƯỚC `close()`** như hôm nay
- [ ] **Lượt bị bỏ giữa đường (client rời trong lúc pipeline chạy) vẫn ghi 0 row**
- [ ] Cả hai đường kết thúc vẫn `registry.close(socket)` rồi `channel.ended(reason)`
- [ ] Log line của recorder có thêm chi phí live-translation

Non-functional:

- [ ] `turn-timeline.ts` ≤ 200 LOC
- [ ] `translation-session.service.ts` ≤ **200** LOC (gate LOC thật của plan nằm ở đây)
- [ ] Không còn `recordTurn` method và không còn inline type 11 field

## Architecture

### KHÔNG dùng `finally` — đây là finding Critical, cả 3 reviewer đều tìm ra

`end()` có một `return` **bên trong `try`** ở `:469`:

```ts
if (!this.isActive(socket, session)) return; // client đã rời trong lúc pipeline chạy
```

`finally` chạy cả khi `return`. Nên `try { … } finally { record(…) }` sẽ ghi một row cho đúng
cái lượt mà hôm nay ghi **0** row — và vì không có gì ném, `completed` là `true`, với
`firstAudioAtMs = lastAudioAtMs = translatedAtMs`. Mỗi lượt bị bỏ dở biến thành một lượt
"thành công rất nhanh" trong bảng latency mà luận văn dựa vào. `spec:888` assert
`expect(recorded).toHaveLength(0)` → đỏ, và bản 1 của plan lại cấm sửa spec cũ.

Hình đúng — giữ nguyên hai call site, DRY bằng closure, `record` vẫn chạy trước `close`:

```ts
const timeline = new TurnTimeline();
const record = (completed: boolean) =>
  this.metrics.record(timeline.toMetrics(session, completed));

try {
  const translated = /* speculation reuse hoặc pipeline */;
  timeline.markTranslated(translated.targetText, speculationUsed);

  // Lượt bị bỏ: cố ý KHÔNG ghi gì. spec:888 là net cho dòng này.
  if (!this.registry.holds(socket, session)) return;

  channel.emit({ type: 'server.transcript.final', segment: … });
  const clauses = splitIntoClauses(translated.targetText);
  timeline.markClauses(clauses.length);
  await this.streamClauses(socket, session, clauses, translated.targetLanguage);

  record(true);
  this.close(socket, 'completed');
} catch (err) {
  record(false);                       // TRƯỚC reportTurnFailure, như :506 hôm nay
  this.reportTurnFailure(channel, session, err);
  this.close(socket, 'error');
}
```

Thứ tự trong `catch` giữ đúng hôm nay: `record` là câu **đầu** (`:506`), không phải câu cuối.
Bản 1 viết `failed = true` ở cuối catch → nếu `reportTurnFailure` ném thì lượt lỗi bị ghi là
completed.

### `session/turn-timeline.ts` (~85 LOC)

```ts
export class TurnTimeline {
  private readonly endpointAt: number;
  private translatedAt?: number;
  private firstAudioAt?: number;
  private lastAudioAt?: number;
  private targetChars = 0;
  private clauses = 0;
  private speculationUsed = false;

  constructor(private readonly now: () => number = Date.now) {
    this.endpointAt = this.now();
  }

  markTranslated(text: string, fromSpeculation: boolean): void;
  markClauses(count: number): void;
  markAudioPushed(): void; // firstAudioAt ??= now; lastAudioAt = now
  toMetrics(session: TurnSession, completed: boolean): TurnMetrics;
}
```

`toMetrics` mang nguyên luật fallback hiện tại (`translatedAt ?? now()`), comment `:538-541`
đi theo verbatim. `now` inject được ⇒ spec không phải sleep, cùng pattern với 2 scheduler.

`streamClauses` gọi `timeline.markAudioPushed()` mỗi lần đẩy xong audio một clause — đúng chỗ
`firstAudioAt ??= Date.now(); lastAudioAt = Date.now()` hôm nay (`:596-597`).

### `TurnMetrics` + recorder

```ts
/**
 * Bản dịch tạm đã tiêu cho lượt này. Mỗi cái là một request có định mức và không bao
 * giờ được phát thành tiếng, nên đây là phần chi phí mà bảng latency trước đây không
 * hề thấy. Row ghi trước 2026-07 không có field này.
 */
liveTranslations: number;
```

Log line thêm `live=<n>` cạnh `speculation=hit/miss`.

## Related Code Files

- Create: `session/turn-timeline.ts`, `session/turn-timeline.spec.ts`
- Modify: `services/translation-session.service.ts` (xoá `recordTurn`, `end()` dùng timeline)
- Modify: `services/turn-metrics.recorder.ts` (+1 field, +log)
- Modify (CHỈ THÊM): `services/translation-session.service.spec.ts` — 1 assert `liveTranslations`
- Read-only: `audio/live-translation-trigger.ts` (`spentCount` giờ có consumer production)

## Implementation Steps

Checkpoint: `git tag plan-p2-start`.

Tests Before:

1. `session/turn-timeline.spec.ts` với clock fake: 4 mốc stamp đúng khoảng; stage thiếu thì
   fallback về thời điểm bỏ cuộc; `firstAudioAt` chỉ set lần đầu, `lastAudioAt` set mỗi lần.
2. Thêm vào `describe('turn metrics')`: lượt có 2 live translation → row có `liveTranslations: 2`.
   Đỏ trước khi implement.

Refactor:

3. Tạo `turn-timeline.ts`.
4. `liveTranslations` vào `TurnMetrics` + log line.
5. `end()` dùng timeline + closure `record`, xoá `recordTurn` và inline type. **Không `finally`.**
6. `toMetrics` đọc `session.liveTranslation.spentCount` và `session.speculationCount`.

Regression Gate:

7. `cd apps/api && pnpm test` → 22 suites; `describe('turn metrics')` 3 test cũ + 1 mới;
   **`spec:888` (`abandons a turn whose socket disconnected while translating`) phải xanh** —
   đây là net cho finding Critical #1
8. Test 2-lượt-một-socket của Phase 1 vẫn xanh — net cho finding Critical #3
9. `cd apps/api && pnpm typecheck && pnpm lint`
10. `wc -l services/translation-session.service.ts` → ≤ 200
11. Tuỳ chọn: chạy tay một lượt với `TURN_METRICS_PATH` để xác nhận JSONL có key mới (cần api
    - 2 sidecar). Nếu không chạy được thì ghi rõ "chưa xác minh end-to-end" vào báo cáo phase.

## Success Criteria

- [ ] `end()` chỉ còn một biểu thức dựng metrics (closure `record`), gọi ở 2 nhánh
- [ ] Không dùng `finally` cho việc ghi metrics
- [ ] Lượt bị bỏ ghi 0 row (`spec:888` xanh, không sửa)
- [ ] `record` chạy trước `reportTurnFailure` ở nhánh lỗi
- [ ] `recordTurn` và inline type 11 field biến mất
- [ ] `TurnMetrics.liveTranslations` có mặt và được assert
- [ ] `spentCount` có consumer production
- [ ] `translation-session.service.ts` ≤ 200 LOC
- [ ] typecheck + lint exit 0

## Risk Assessment

| Rủi ro                                                                           | Giảm thiểu                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **`finally` ghi row cho lượt bị bỏ** (Critical, 3/3 reviewer)                    | Không dùng `finally`. Gate là `spec:888`, và nó nằm ngoài `describe('turn metrics')` nên đừng chỉ nhìn describe đó |
| **Mất `registry.close`** ở đường kết thúc → lượt 2 `session_busy` mãi (Critical) | Dùng helper `this.close(socket, reason)` của Phase 1, không gọi `channel.ended` trực tiếp; test 2-lượt là net      |
| Đảo thứ tự `record` / `reportTurnFailure` ở catch                                | Ghi rõ trong snippet; `record(false)` là câu đầu                                                                   |
| Row JSONL cũ thiếu key mới                                                       | Có chủ ý; comment trong `TurnMetrics` nói rõ; Phase 5 ghi vào doc                                                  |
| `liveTranslations` bị nhầm với `speculations` khi đọc bảng                       | Tên khác hẳn + comment "không bao giờ phát thành tiếng"                                                            |
