// Draft corpus rows from stored prod conversations, for the user to finish.
//
//   node benchmarks/conversation-context/export-turns.mjs --owner <userId> --conv <clientId,clientId>
//   node benchmarks/conversation-context/export-turns.mjs --owner <userId> --conv <ids> --force
//
// Reads the prod database READ-ONLY through `docker exec chatofy_prod_postgres
// psql` and writes `data/corpus.jsonl` and `data/conversations.jsonl`, nothing
// else. Every row leaves here with `reference: null`, every suggested term
// with `mustMatch: null` and `target: null`, every conversation with
// `domain: null`: those are the user's to write.
//
// It refuses to overwrite a corpus that already holds a written reference
// unless `--force` is given, because that file is hours of the user's work and
// re-exporting is one keystroke.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { foldForMatch } from '../../packages/ai-providers/dist/index.js';
import { DATA, bucketOf, readJsonl, typesModule } from './corpus.mjs';

/** Ids go into SQL literals, so they are held to the characters ids are made of. */
const ID = /^[A-Za-z0-9_-]+$/;

function parseArgs(argv) {
  const args = { owner: null, convs: [], force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--force') args.force = true;
    else if (flag === '--owner') args.owner = argv[++i];
    else if (flag === '--conv') args.convs = (argv[++i] ?? '').split(',').filter(Boolean);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!args.owner || !ID.test(args.owner)) throw new Error('--owner <userId> is required');
  if (!args.convs.length || !args.convs.every((id) => ID.test(id))) {
    throw new Error('--conv <clientId,…> is required');
  }
  return args;
}

function queryTurns(owner, convs) {
  const list = convs.map((id) => `'${id}'`).join(',');
  const sql = `
    SELECT coalesce(json_agg(x ORDER BY x.conv, x.position), '[]'::json) FROM (
      SELECT c."clientId" AS conv, c.languages, t.position, t."sourceText", t."displayText",
             t."sourceLanguages", t.translations
      FROM "Conversation" c JOIN "ConversationTurn" t ON t."conversationId" = c.id
      WHERE c."ownerId" = '${owner}' AND c."clientId" IN (${list})
    ) x;`;
  const run = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'chatofy_prod_postgres',
      'sh',
      '-c',
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -f -',
    ],
    { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) throw new Error(`psql failed: ${run.stderr.trim()}`);
  return JSON.parse(run.stdout.trim());
}

/**
 * Names and terms worth asking the writer about: capitalised runs that are not
 * the first word of the turn, and that an EARLIER turn of the same
 * conversation already said. A term said once has nothing for the conversation
 * to remember; the writer deletes the wrong suggestions and adds missed ones.
 */
export function suggestTerms(source, earlierFolded) {
  const words = source.split(/\s+/).filter(Boolean);
  const runs = [];
  let run = [];
  for (const [i, raw] of words.entries()) {
    const word = raw.replace(/^[\p{P}]+|[\p{P}]+$/gu, '');
    // A capital after a sentence end, or the English pronoun, says nothing
    // about a name.
    const startsSentence = i === 0 || /[.!?…]$/u.test(words[i - 1]);
    const pronoun = /^I(?:'[a-z]+)?$/u.test(word);
    if (!startsSentence && !pronoun && /^\p{Lu}/u.test(word)) run.push(word);
    else {
      if (run.length) runs.push(run.join(' '));
      run = [];
    }
  }
  if (run.length) runs.push(run.join(' '));
  const seen = new Set();
  return runs.filter((term) => {
    const key = foldForMatch(term);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return earlierFolded.some((earlier) => earlier.includes(key));
  });
}

/** One draft row per stored turn, in spoken order. */
export function draftRows(turns, countTermWords) {
  const rows = [];
  const byConv = new Map();
  for (const turn of turns) {
    if (!byConv.has(turn.conv)) byConv.set(turn.conv, []);
    byConv.get(turn.conv).push(turn);
  }
  for (const [conv, group] of byConv) {
    group.sort((a, b) => a.position - b.position);
    const earlierFolded = [];
    for (const [index, turn] of group.entries()) {
      const source = turn.displayText ?? turn.sourceText;
      const from = turn.sourceLanguages?.[0];
      const to = (turn.languages ?? []).find((lang) => lang !== from);
      rows.push({
        conv,
        pos: turn.position,
        direction: `${from}_to_${to}`,
        source,
        draft: turn.translations?.[to] ?? null,
        reference: null,
        terms: suggestTerms(source, earlierFolded).map((term) => ({
          source: term,
          target: null,
          mustMatch: null,
        })),
        words: countTermWords(source),
        bucket: bucketOf(index + 1),
      });
      earlierFolded.push(foldForMatch(source));
    }
  }
  return rows;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const corpusPath = join(DATA, 'corpus.jsonl');
  if (!args.force && existsSync(corpusPath)) {
    const written = readJsonl(corpusPath).filter((row) => row.reference).length;
    if (written) {
      console.error(
        `${corpusPath} already holds ${written} written references; pass --force to replace it`,
      );
      process.exit(2);
    }
  }
  const { countTermWords } = await typesModule();
  const turns = queryTurns(args.owner, args.convs);
  const found = new Set(turns.map((turn) => turn.conv));
  const missing = args.convs.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`no turns found for ${missing.join(', ')}`);

  const rows = draftRows(turns, countTermWords);
  mkdirSync(DATA, { recursive: true });
  writeFileSync(corpusPath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  writeFileSync(
    join(DATA, 'conversations.jsonl'),
    args.convs.map((conv) => JSON.stringify({ conv, domain: null })).join('\n') + '\n',
  );
  console.error(`${rows.length} rows from ${args.convs.length} conversations → ${DATA}`);
}
