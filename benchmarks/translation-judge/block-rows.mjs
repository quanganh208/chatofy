// Which saved rows are blocks: lines the app re-translated as one text after a
// forced cut, rather than one turn's own translation.
//
//   node block-rows.mjs data/turns.scribed.jsonl > data/arms/blocks-corpus.json
//
// A saved row does not record how many pieces it was joined from, so this
// reads it off the timing. Both clients cut a turn at 8 s
// (`CASCADE_MAX_UTTERANCE_MS`), and only a forced cut joins pieces into one
// row. A row whose successor starts 8 s or more after it therefore spans at
// least one cut. The last row of a conversation has no successor and is never
// counted. On 7a5c5edb this marks positions 3, 7, 16, 18, 20, 22 and 24; prod
// logged forced cuts inside each of them.
import { fileURLToPath } from 'node:url';

import { readJsonl, turnId } from './rows.mjs';

/** The client's turn ceiling; a row spanning it holds a forced cut. */
export const BLOCK_SPAN_MS = 8000;

/** Ids (`conv#pos`) of the rows that span a forced cut. */
export function blockIds(rows) {
  const byConv = new Map();
  for (const row of rows) {
    if (row.mediaMs === null || row.mediaMs === undefined) continue;
    const list = byConv.get(row.conv) ?? [];
    list.push(row);
    byConv.set(row.conv, list);
  }
  const ids = [];
  for (const list of byConv.values()) {
    list.sort((a, b) => a.mediaMs - b.mediaMs);
    for (let i = 0; i + 1 < list.length; i += 1) {
      if (list[i + 1].mediaMs - list[i].mediaMs >= BLOCK_SPAN_MS) ids.push(turnId(list[i]));
    }
  }
  return ids;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: node block-rows.mjs <turns.jsonl>');
  process.stdout.write(JSON.stringify(blockIds(readJsonl(path))) + '\n');
}
