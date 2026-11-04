// Apply the shipped seam repair to decoded seams and score it against Scribe.
//
//   npx tsx benchmarks/seam-repair/score.mts <dir> <en|vi>
//
// Prints WER with and without the repair, then every insertion, because the
// bar is "no wrong word added" and a WER delta can hide one.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wordsLostAtSeam } from '../../apps/api/src/modules/translate/session/seam-word-repair.ts';

interface Short {
  width: number;
  left: string;
  clip: string;
}
interface Seam {
  turn: number;
  cutMs: number;
  clip: string;
  shorts: Short[];
}
interface Row {
  conv: string;
  texts: string[];
  seams: Seam[];
}
interface ScribeWord {
  type: string;
  text: string;
  start: number;
}

const [dir, lang] = process.argv.slice(2);
const SEARCH_S = 2.5;

const norm = (text: string) =>
  text
    .normalize('NFC')
    .toLowerCase()
    .replace(/’/g, "'")
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter(Boolean);

/** Word edit distance. */
function distance(a: string[], b: string[]): number {
  let row = b.map((_, i) => i + 1);
  row.unshift(0);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length]!;
}

/** Whether Scribe said these words, in a row, around the cut. */
function heardNearby(words: ScribeWord[], cutMs: number, inserted: string): boolean {
  const near = words
    .filter((word) => Math.abs(word.start - cutMs / 1000) <= SEARCH_S)
    .flatMap((word) => norm(word.text));
  const want = norm(inserted);
  return near.some((_, at) => want.every((word, k) => near[at + k] === word));
}

const rows = readFileSync(join(dir!, `seams-${lang}.jsonl`), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Row);

let refWords = 0;
let before = 0;
let after = 0;
let seams = 0;
const inserted: string[] = [];
const shortStats = new Map<number, { tried: number; added: number; wrong: string[] }>();
const shortInserted: string[] = [];

for (const { conv, texts, seams: found } of rows) {
  const scribe = JSON.parse(readFileSync(join(dir!, `${conv}.json`), 'utf8')) as {
    words: ScribeWord[];
  };
  const words = scribe.words.filter(
    (word) => word.type === 'word' && !word.text.includes('['),
  );
  const ref = words.flatMap((word) => norm(word.text));
  refWords += ref.length;
  seams += found.length;

  const repaired = [...texts];
  for (const seam of found) {
    const lost = wordsLostAtSeam(texts[seam.turn]!, texts[seam.turn + 1]!, seam.clip);
    if (lost) {
      repaired[seam.turn + 1] = `${lost} ${repaired[seam.turn + 1]}`;
      const ok = heardNearby(words, seam.cutMs, lost);
      inserted.push(`${ok ? 'ok   ' : 'WRONG'} ${conv} ${Math.round(seam.cutMs)}ms: ${lost}`);
    }
    for (const short of seam.shorts) {
      const stats = shortStats.get(short.width) ?? { tried: 0, added: 0, wrong: [] };
      stats.tried += 1;
      const piece = wordsLostAtSeam(short.left, texts[seam.turn + 1]!, short.clip);
      if (piece) {
        stats.added += 1;
        const oneWord = norm(short.left).length === 1 ? ' [one-word left]' : '';
        shortInserted.push(`${short.width}s${oneWord} "${short.left}" + ${piece}`);
        if (!heardNearby(words, seam.cutMs, piece)) {
          stats.wrong.push(`${conv} ${Math.round(seam.cutMs)}ms left="${short.left}": ${piece}`);
        }
      }
      shortStats.set(short.width, stats);
    }
  }
  before += distance(ref, norm(texts.join(' ')));
  after += distance(ref, norm(repaired.join(' ')));
}

const pct = (n: number) => ((100 * n) / refWords).toFixed(2);
console.log(`${lang}: ${rows.length} recordings, ${refWords} words, ${seams} seams`);
console.log(`WER ${pct(before)}% -> ${pct(after)}%`);
console.log(inserted.join('\n'));
console.log(shortInserted.join('\n'));
for (const [width, stats] of shortStats) {
  console.log(
    `short left ${width}s: ${stats.added}/${stats.tried} added, ${stats.wrong.length} wrong`,
    stats.wrong,
  );
}
