// Keep only the listed turns of a corpus, arm or judgement file.
//
//   node subset.mjs --ids data/arms/blocks-corpus.json --in <jsonl> --out <jsonl>
//
// A corpus or arm row is matched by `conv#pos`; a judgement line by its `id`,
// which is the same string. Used to read a paired compare on one population
// (block rows) without re-judging anything.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { readJsonl, toJsonl, turnId } from './rows.mjs';

const flag = (name) => {
  const at = process.argv.indexOf(name);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const ids = new Set(JSON.parse(readFileSync(flag('--ids'), 'utf8')));
const rows = readJsonl(flag('--in'));
const kept = rows.filter((row) => ids.has(row.id ?? turnId(row)));
const out = flag('--out');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toJsonl(kept));
console.error(`${kept.length}/${rows.length} lines kept → ${out}`);
