// Why did a turn's words land on the wrong speaker? For each replayed turn
// that overlaps one of the given windows, print what the real planner saw:
// internal pauses, the pieces between them, each piece's Scribe speakers, and
// the cosine of each piece to the previous turn's voice and to its neighbour.
//
//   cd apps/api && npx -y tsx ../../benchmarks/speaker-id/edge-replay/trace-cases.mts \
//     7a5c5edb 10000-14000 33000-41000 135000-144000
//
// Needs `local_embed_server.py` listening on 127.0.0.1:18712.
import { readFileSync } from 'node:fs';
import {
  findInternalPauses,
  findSplitCandidate,
  piecesBetween,
  planSpeakerSplit,
  type Span,
} from '../../../apps/api/src/modules/translate/session/speaker-change-split.ts';

const ROOT = process.env.EDGE_REPLAY_ROOT ?? new URL('./data', import.meta.url).pathname;
const SR = 16000;
const [rid, ...ranges] = process.argv.slice(2);
if (!rid || ranges.length === 0) throw new Error('usage: trace-cases.mts <rid> <fromMs-toMs>...');
const windows = ranges.map((r) => r.split('-').map(Number) as [number, number]);

type Word = { start: number; end: number; speaker_id: string; type: string; text: string };
const words = (JSON.parse(readFileSync(`${ROOT}/scribe/${rid}.json`, 'utf8')).words as Word[]).filter(
  (w) => w.type === 'word',
);
const raw = readFileSync(`${ROOT}/pcm/${rid}.pcm`);
const all = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const turns = JSON.parse(readFileSync(`${ROOT}/turns/${rid}.json`, 'utf8')) as {
  startMs: number;
  endMs: number;
  reason?: string;
}[];

async function embed(pcm: Int16Array): Promise<number[]> {
  const res = await fetch('http://127.0.0.1:18712/', {
    method: 'POST',
    body: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength),
  });
  return ((await res.json()) as { vector: number[] }).vector;
}
const dot = (a: number[], b: number[]) => a.reduce((x, v, i) => x + v * b[i]!, 0);
const speakersIn = (a: number, b: number) => {
  const inside = words.filter((w) => ((w.start + w.end) / 2) * 1000 >= a && ((w.start + w.end) / 2) * 1000 < b);
  const by = new Map<string, string[]>();
  for (const w of inside) by.set(w.speaker_id, [...(by.get(w.speaker_id) ?? []), w.text]);
  return [...by.entries()].map(([s, t]) => `${s}:"${t.join(' ')}"`).join(' | ');
};

let previous: number[] | null = null;
for (const t of turns) {
  const pcm = all.slice(Math.round((t.startMs * SR) / 1000), Math.round((t.endMs * SR) / 1000));
  const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const slice = (span: Span) =>
    pcm.slice(Math.round((span.startMs * SR) / 1000), Math.round((span.endMs * SR) / 1000));
  const relevant = windows.some(([a, b]) => t.startMs < b && t.endMs > a);
  if (relevant) {
    const pauses = findInternalPauses(buf, SR);
    const pieces = piecesBetween(t.endMs - t.startMs, pauses);
    console.log(
      `\nturn ${(t.startMs / 1000).toFixed(2)}–${(t.endMs / 1000).toFixed(2)}s (${t.reason ?? '?'}) ` +
        `pauses=[${pauses.map((p) => `${p.startMs}-${p.endMs}`).join(', ')}]`,
    );
    const vectors = await Promise.all(pieces.map((p) => embed(slice(p))));
    pieces.forEach((p, i) => {
      const prev = previous ? dot(vectors[i]!, previous).toFixed(2) : '-';
      const next = i + 1 < pieces.length ? dot(vectors[i]!, vectors[i + 1]!).toFixed(2) : '-';
      console.log(
        `  piece ${i} ${p.startMs}-${p.endMs}ms (${p.endMs - p.startMs}ms) cos(prev turn)=${prev} cos(next piece)=${next}` +
          `\n    truth ${speakersIn(t.startMs + p.startMs, t.startMs + p.endMs)}`,
      );
    });
    const candidate = findSplitCandidate(buf, SR, { hasPreviousVoice: previous !== null });
    const plan = candidate ? await planSpeakerSplit(candidate, (s) => embed(slice(s)), previous) : null;
    console.log(
      `  candidate=${candidate ? 'yes' : 'no'} plan=${
        plan
          ? plan
              .map(
                (s) =>
                  `${s.startMs}-${s.endMs}${s.continuesPrevious ? '(lead)' : ''}${s.awaitsNextVoice ? '(held)' : ''}`,
              )
              .join(' ')
          : 'whole'
      }`,
    );
  }
  previous = await embed(pcm);
}
