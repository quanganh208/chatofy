// Print the edge speech the planner measures for the replayed turn around a time.
import { readFileSync } from 'node:fs';
import { findSplitCandidate } from '../../../apps/api/src/modules/translate/session/speaker-change-split.ts';

const ROOT = process.env.EDGE_REPLAY_ROOT ?? new URL('./data', import.meta.url).pathname;
const [rid, atS] = process.argv.slice(2);
const SR = 16000;
const raw = readFileSync(`${ROOT}/pcm/${rid}.pcm`);
const all = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const turns = JSON.parse(readFileSync(`${ROOT}/turns/${rid}.json`, 'utf8')) as { startMs: number; endMs: number }[];
const t = turns.find((x) => x.startMs <= Number(atS) * 1000 + 50 && x.endMs > Number(atS) * 1000)!;
const pcm = all.slice(Math.round((t.startMs * SR) / 1000), Math.round((t.endMs * SR) / 1000));
const c = findSplitCandidate(Buffer.from(pcm.buffer), SR, { hasPreviousVoice: true });
console.log(rid, atS, 'turn', (t.startMs / 1000).toFixed(2), '-', (t.endMs / 1000).toFixed(2), 'pieces', c?.pieces.map((p) => p.endMs - p.startMs), 'edgeSpeech', c?.edgeSpeechMs);
