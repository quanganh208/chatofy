// Replay recorded recognizer snapshots through the SHIPPED streaming committer
// and live-translation trigger, offline.
//
//   cd apps/api && npx tsx ../../benchmarks/stt/scripts/streaming-arms/replay_committer.mts \
//     ../../benchmarks/stt/results/r13-zh-commit/zh-sidecar.jsonl \
//     ../../benchmarks/stt/results/r13-zh-commit/vi-sidecar-continuous.jsonl
//
// `commit_probe.py` records every snapshot a turn's live preview would have
// shown (`row.snapshots`: [audio seconds fed, wall seconds shown, text]) but
// mirrors the committer in Python with whitespace words, which cannot read
// Chinese. This runs the TypeScript the API runs, so its numbers are the
// product's, and adds one variant: the same agreement rule cut back to
// `Intl.Segmenter` word boundaries instead of one Han character at a time.
//
// Per file and arm: characters settled before the final, the retraction rate
// (settled characters later taken back, over settled characters), the median
// lag from a character first appearing to it settling, and how often the
// provisional translation fires — per turn and per minute of audio — through
// `LiveTranslationTrigger` with the production `commitChars` for the turn's
// language (a turn whose final holds Han is zh, any other is vi). A fired
// translation is held in flight for `--translate-ms` of audio, as a real one is.
//
// `npx tsx` rather than `node --experimental-strip-types`: the trigger imports
// its siblings without file extensions, which Node's own ESM loader refuses.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { StreamingCommitter } from '../../../../apps/api/src/modules/translate/audio/streaming-committer';
import { LiveTranslationTrigger } from '../../../../apps/api/src/modules/translate/audio/live-translation-trigger';
import { TranslationBudget } from '../../../../apps/api/src/modules/translate/audio/translation-budget';
import { LIVE_TRANSLATION_COMMIT_CHARS } from '../../../../apps/api/src/modules/translate/session/turn-tuning';

type Snapshot = [audioS: number, wallS: number, text: string];
interface Row {
  id: string;
  audio_seconds: number;
  final_hypothesis: string;
  snapshots: Snapshot[];
}

const args = process.argv.slice(2);
const translateMsAt = args.indexOf('--translate-ms');
const TRANSLATE_S = translateMsAt >= 0 ? Number(args[translateMsAt + 1]) / 1000 : 0.7;
const files = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--translate-ms');

const HAN = /\p{Script=Han}/u;
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/** Offsets in `text` where a word ends, by the ICU dictionary. */
function segmentEnds(text: string): Set<number> {
  const ends = new Set<number>([0]);
  for (const { index, segment } of segmenter.segment(text)) ends.add(index + segment.length);
  return ends;
}

/**
 * The shipped committer's rule with one change: inside Han text the agreed
 * prefix is cut back to the last dictionary word boundary rather than to the
 * last character. Text with no Han takes the shipped path.
 */
class SegmenterCommitter extends StreamingCommitter {
  override push(hypothesis: string): boolean {
    const previous = (this as unknown as { previous: string | null }).previous;
    if (previous === null || !HAN.test(hypothesis)) return super.push(hypothesis);
    const next = hypothesis.trim();
    const settledBefore = this.committed;
    // Let the shipped rule find the agreed prefix, then cut it to a word end
    // both readings agree on.
    const moved = super.push(next);
    if (!moved) return false;
    const settled = this.committed;
    if (!HAN.test(settled)) return true;
    const ends = segmentEnds(next);
    const earlierEnds = segmentEnds(previous);
    let cut = settled.length;
    while (cut > settledBefore.length && !(ends.has(cut) && earlierEnds.has(cut))) cut -= 1;
    if (cut < settled.length) {
      (this as unknown as { settled: string }).settled = settled.slice(0, cut);
    }
    return this.committed !== settledBefore;
  }
}

interface ArmResult {
  settledBeforeFinal: number;
  finalChars: number;
  committedChars: number;
  retractedChars: number;
  lags: number[];
  fires: number;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function replay(row: Row, make: () => StreamingCommitter): ArmResult {
  const committer = make();
  const trigger = new LiveTranslationTrigger({
    budget: new TranslationBudget({ perUserRpm: 1_000_000, globalRpm: 1_000_000 }),
    // The table's value for the language the turn was recognized in.
    commitChars: LIVE_TRANSLATION_COMMIT_CHARS[HAN.test(row.final_hypothesis) ? 'zh' : 'vi'],
    userId: 'replay',
    model: 'replay',
  });
  const firstSeen: number[] = [];
  const lags: number[] = [];
  let committedChars = 0;
  let retractedChars = 0;
  let fires = 0;
  let settlesAt = Number.NEGATIVE_INFINITY;

  for (const [audioS, , text] of row.snapshots) {
    for (let i = firstSeen.length; i < text.length; i += 1) firstSeen[i] = audioS;
    if (audioS >= settlesAt) trigger.markSettled();
    const before = committer.committed;
    committer.push(text);
    const after = committer.committed;
    if (after !== before) {
      const kept = commonPrefix(before, after);
      retractedChars += before.length - kept;
      committedChars += after.length - kept;
      for (let i = kept; i < after.length; i += 1) lags.push(Math.max(0, audioS - (firstSeen[i] ?? audioS)));
    }
    if (trigger.shouldTranslate(after, committer.reanchors)) {
      trigger.markStarted(after, committer.reanchors);
      fires += 1;
      settlesAt = audioS + TRANSLATE_S;
    }
  }
  return {
    settledBeforeFinal: committer.committed.length,
    finalChars: row.final_hypothesis.length,
    committedChars,
    retractedChars,
    lags,
    fires,
  };
}

const median = (values: number[]) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
};
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(2)}%` : 'n/a');

const ARMS: [string, () => StreamingCommitter][] = [
  ['per-character (shipped)', () => new StreamingCommitter()],
  ['Intl.Segmenter', () => new SegmenterCommitter()],
];

for (const file of files) {
  const rows: Row[] = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Row);
  const minutes = rows.reduce((sum, row) => sum + row.audio_seconds, 0) / 60;
  console.log(`\n${basename(file)} — ${rows.length} turns, ${minutes.toFixed(1)} min of audio`);
  for (const [name, make] of ARMS) {
    const results = rows.map((row) => replay(row, make));
    const sum = (key: keyof ArmResult) =>
      results.reduce((total, r) => total + (r[key] as number), 0);
    const lags = results.flatMap((r) => r.lags);
    console.log(
      `  ${name.padEnd(24)} settled before final ${pct(sum('settledBeforeFinal'), sum('finalChars'))}` +
        ` · retraction ${pct(sum('retractedChars'), sum('committedChars'))}` +
        ` · commit lag p50 ${median(lags).toFixed(2)} s` +
        ` · fires ${(sum('fires') / rows.length).toFixed(1)}/turn, ${(sum('fires') / minutes).toFixed(1)}/min`,
    );
  }
}
