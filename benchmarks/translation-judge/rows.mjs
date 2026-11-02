// Paths and JSONL helpers shared by every script in this directory.
//
// `data/` holds what came from prod (turns, recordings, Scribe answers) and
// `results/` what a judge run produced. Both are gitignored: they are private
// conversations, and the judge's notes quote them.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA = join(HERE, 'data');
export const RESULTS = join(HERE, 'results');

/** JSONL in, one object per line, naming the line that failed to parse. */
export function readJsonl(path) {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${i + 1}: ${error.message}`);
      }
    });
}

export function toJsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

/** A turn's stable id across every file: the conversation and its position. */
export function turnId(row) {
  return `${row.conv}#${row.pos}`;
}
