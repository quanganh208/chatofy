// Run the REAL planner over replayed turns, without and with the previous
// voice, and score each plan against Scribe's diarized words.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  findSplitCandidate,
  planSpeakerSplit,
  type Span,
} from '../../../apps/api/src/modules/translate/session/speaker-change-split.ts';

const ROOT = process.env.EDGE_REPLAY_ROOT ?? new URL('./data', import.meta.url).pathname;
const SR = 16000;

async function embedPcm(pcm: Int16Array): Promise<number[]> {
  const res = await fetch('http://127.0.0.1:18712/', {
    method: 'POST',
    body: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength),
  });
  return ((await res.json()) as { vector: number[] }).vector;
}

type Word = { start: number; end: number; speaker_id: string; type: string };
const majority = (words: Word[], a: number, b: number) => {
  const c = new Map<string, number>();
  for (const w of words) {
    const mid = ((w.start + w.end) / 2) * 1000;
    if (mid >= a && mid < b) c.set(w.speaker_id, (c.get(w.speaker_id) ?? 0) + 1);
  }
  return [...c.entries()].sort((x, y) => y[1] - x[1]);
};

let totals = { old: { wrong: 0, words: 0, splits: 0 }, new: { wrong: 0, words: 0, splits: 0, leads: 0, leadsRight: 0, tails: 0, tailsRight: 0 } };
for (const file of readdirSync(`${ROOT}/turns`)) {
  const rid = file.replace('.json', '');
  if (!existsSync(`${ROOT}/scribe/${rid}.json`)) continue;
  const words = (JSON.parse(readFileSync(`${ROOT}/scribe/${rid}.json`, 'utf8')).words as Word[]).filter((w) => w.type === 'word');
  if (new Set(words.map((w) => w.speaker_id)).size < 2) continue;
  const raw = readFileSync(`${ROOT}/pcm/${rid}.pcm`);
  const all = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const turns = JSON.parse(readFileSync(`${ROOT}/turns/${file}`, 'utf8')) as { startMs: number; endMs: number }[];

  for (const mode of ['old', 'new'] as const) {
    let previous: number[] | null = null;
    let previousSpeaker: string | null = null;
    let held: { own: number[]; rest: number[]; restSpeaker: string; counts: [string, number][]; at: number; endMs: number } | null = null;
    for (const t of turns) {
      const s0 = Math.round((t.startMs * SR) / 1000);
      const pcm = all.slice(s0, Math.round((t.endMs * SR) / 1000));
      const buf = Buffer.from(pcm.buffer);
      const embedSpan = (span: Span) =>
        embedPcm(pcm.slice(Math.round((span.startMs * SR) / 1000), Math.round((span.endMs * SR) / 1000)));
      const candidate = findSplitCandidate(buf, SR, { hasPreviousVoice: mode === 'new' && previous !== null });
      const plan = candidate
        ? await planSpeakerSplit(candidate, embedSpan, mode === 'new' ? previous : null)
        : null;
      const spans: Span[] = plan ?? [{ startMs: 0, endMs: t.endMs - t.startMs }];
      if (plan) totals[mode].splits += 1;
      if (held) {
        // Decided by the next turn's first own voice, only when it opened right after.
        const firstOwn = spans.find((sp) => !sp.continuesPrevious) ?? spans[0]!;
        const nextVoice = await embedSpan(firstOwn);
        const nextSpeaker = majority(words, t.startMs + firstOwn.startMs, t.startMs + firstOwn.endMs)[0]?.[0] ?? null;
        const dot = (a: number[], b: number[]) => a.reduce((x, v, i) => x + v * b[i]!, 0);
        const adjacent = t.startMs - held.endMs <= 1000;
        const assigned = adjacent && dot(held.own, nextVoice) > dot(held.own, held.rest) ? nextSpeaker : held.restSpeaker;
        const n = held.counts.reduce((x, [, c]) => x + c, 0);
        const right = held.counts.find(([sp]) => sp === assigned)?.[1] ?? 0;
        totals.new.words += n; totals.new.wrong += n - right; totals.new.tails += 1;
        if (held.counts[0]![0] === assigned) totals.new.tailsRight += 1;
        console.log(`  ${rid} @${(held.at / 1000).toFixed(2)}s tail truth=${held.counts[0]![0]} assigned=${assigned} rest=${held.restSpeaker} next=${nextSpeaker}`);
        held = null;
      }
      // Score: every word should be on its span's speaker. A continuesPrevious
      // span is attributed as the previous span's speaker.
      for (const span of spans) {
        const a = t.startMs + span.startMs;
        const b = t.startMs + span.endMs;
        const counts = majority(words, a, b);
        const n = counts.reduce((x, [, c]) => x + c, 0);
        if (n === 0) continue;
        if (span.awaitsNextVoice && mode === 'new') {
          const before = spans[spans.indexOf(span) - 1]!;
          held = { own: await embedSpan(span), rest: await embedSpan(before), restSpeaker: previousSpeaker!, counts, at: a, endMs: t.endMs };
          continue;
        }
        // Before the change a closing rode with the rest of its turn.
        const assigned = span.awaitsNextVoice
          ? span.awaitsNextVoice.fallback === 'own'
            ? counts[0]![0]
            : previousSpeaker
          : span.continuesPrevious
            ? previousSpeaker
            : counts[0]![0];
        const right = counts.find(([s]) => s === assigned)?.[1] ?? 0;
        totals[mode].words += n;
        totals[mode].wrong += n - right;
        if (mode === 'new' && span.continuesPrevious) {
          totals.new.leads += 1;
          if (counts[0]![0] === previousSpeaker) totals.new.leadsRight += 1;
          console.log(`  ${rid} @${(a / 1000).toFixed(2)}s lead=previous truth=${counts[0]![0]} previous=${previousSpeaker}`);
        }
        previousSpeaker = assigned;
      }
      // The vector the server would remember: the last span's own, or the
      // previous voice for a marked opening that is also the last span.
      const last = spans.filter((sp) => !sp.awaitsNextVoice).at(-1)!;
      previous = last.continuesPrevious ? previous : await embedSpan(last);
    }
    if (held) {
      // Nothing after it: sent with its fallback, scored as the rest's speaker.
      const n = held.counts.reduce((x, [, c]) => x + c, 0);
      totals.new.words += n;
      totals.new.wrong += n - (held.counts.find(([sp]) => sp === held!.restSpeaker)?.[1] ?? 0);
    }
  }
}
console.log(JSON.stringify(totals, null, 1));
