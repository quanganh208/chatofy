// Replay a 16 kHz mono int16 recording through the real CapturePump (prod web
// options) and the server's pause finder, writing each turn with its pieces.
import { readFileSync, writeFileSync } from 'node:fs';
import { CapturePump } from '../../../packages/realtime-client/src/audio/capture-pump.ts';
import {
  findInternalPauses,
  piecesBetween,
} from '../../../apps/api/src/modules/translate/session/speaker-change-split.ts';

const [pcmPath, outPath] = process.argv.slice(2);
const raw = readFileSync(pcmPath!);
const all = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const BLOCK = 341;
const SR = 16000;

interface Turn { startSample: number; endSample: number; reason: string }
const turns: Turn[] = [];
let cursor = 0;
let open: { start: number } | null = null;
const pump = new CapturePump(
  {
    onTurnOpen: (preRoll) => {
      const pre = preRoll.reduce((n, b) => n + b.length, 0);
      open = { start: cursor - pre };
    },
    onAudio: () => {},
    onProbableEnd: () => {},
    onTurnClose: (reason) => {
      if (open) turns.push({ startSample: open.start, endSample: cursor, reason });
      open = null;
      pump.armNextTurn();
    },
    onLevel: () => {},
  },
  BLOCK,
  { continuous: true, fullDuplex: true, maxUtteranceMs: 8000 },
);
for (let i = 0; i + BLOCK <= all.length; i += BLOCK) {
  cursor = i + BLOCK;
  pump.push(all.slice(i, i + BLOCK));
}

const out = turns.map((t) => {
  const pcm = Buffer.from(all.slice(t.startSample, t.endSample).buffer);
  const pauses = findInternalPauses(pcm, SR);
  const durationMs = Math.floor(((t.endSample - t.startSample) / SR) * 1000);
  const base = (t.startSample / SR) * 1000;
  return {
    startMs: base,
    endMs: (t.endSample / SR) * 1000,
    reason: t.reason,
    pieces: piecesBetween(durationMs, pauses).map((p) => ({
      startMs: base + p.startMs,
      endMs: base + p.endMs,
    })),
  };
});
writeFileSync(outPath!, JSON.stringify(out));
console.log(pcmPath, out.length, 'turns', out.filter((t) => t.reason !== 'silence').length, 'non-silence closes', [...new Set(out.map((t) => t.reason))]);
