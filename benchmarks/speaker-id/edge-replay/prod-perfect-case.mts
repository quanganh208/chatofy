// The prod cut around "…training our brains. Perfect." (rows 18/19 of 0f6b735a):
// row 18 opened at 93.04 s and row 19 at 97.23 s on the recording.
import { readFileSync } from 'node:fs';
import { findSplitCandidate, planSpeakerSplit, type Span } from '../../../apps/api/src/modules/translate/session/speaker-change-split.ts';
import { closerVoice } from '../../../apps/api/src/modules/translate/session/held-closing-voices.ts';

const ROOT = process.env.EDGE_REPLAY_ROOT ?? new URL('./data', import.meta.url).pathname;
const SR = 16000;
const raw = readFileSync(`${ROOT}/pcm/0f6b735a.pcm`);
const all = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const slice = (a: number, b: number) => all.slice(Math.round(a * SR), Math.round(b * SR));
const embed = async (pcm: Int16Array) =>
  ((await (await fetch('http://127.0.0.1:18712/', { method: 'POST', body: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength) })).json()) as { vector: number[] }).vector;

const turn = slice(93.04, 97.23);
const candidate = findSplitCandidate(Buffer.from(turn.buffer), SR);
console.log('pieces', candidate?.pieces.map((p) => `${(93.04 + p.startMs / 1000).toFixed(2)}-${(93.04 + p.endMs / 1000).toFixed(2)}`));
const at = (span: Span) => turn.slice(Math.round((span.startMs * SR) / 1000), Math.round((span.endMs * SR) / 1000));
const plan = candidate ? await planSpeakerSplit(candidate, (span) => embed(at(span))) : null;
console.log('plan', plan?.map((s) => ({ from: (93.04 + s.startMs / 1000).toFixed(2), to: (93.04 + s.endMs / 1000).toFixed(2), awaits: s.awaitsNextVoice ?? null })));
if (plan && plan.at(-1)!.awaitsNextVoice) {
  const own = await embed(at(plan.at(-1)!));
  const rest = await embed(at(plan.at(-2)!));
  const next = await embed(slice(97.23, 104.0)); // row 19: Sarah, "So Mike, let me ask you this…"
  console.log('closing goes to', closerVoice({ own, rest }, next) === next ? 'NEXT turn (Sarah) — right' : 'own turn (Mike) — wrong');
}
