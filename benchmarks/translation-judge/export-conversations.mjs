// Export recorded prod conversations, turn by turn, with their recordings.
//
//   node benchmarks/translation-judge/export-conversations.mjs --owner <userId> [--conv <clientId,…>]
//
// Reads the prod database READ-ONLY through `docker exec chatofy_prod_postgres
// psql`, and downloads each recording from the public R2 URL. Without
// `--conv` it takes every conversation of the owner that has a recording.
//
// Writes, all under the gitignored `data/`:
//   - `turns.jsonl`: one row per stored turn, in spoken order, with what the
//     reader saw (`source`, `translation`), the four previous turns as
//     `context`, and `mediaMs`, the turn's start inside the recording;
//   - `recordings.jsonl`: one row per conversation;
//   - `audio/<clientId>.webm`.
//
// A turn's target is the first conversation language other than its source,
// the same rule `conversation-context/export-turns.mjs` uses, through its
// `draftRows`, so the two benchmarks read a stored turn the same way.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { draftRows } from '../conversation-context/export-turns.mjs';
import { typesModule } from '../conversation-context/corpus.mjs';
import { DATA, toJsonl } from './rows.mjs';

/** Ids go into SQL literals, so they are held to the characters ids are made of. */
const ID = /^[A-Za-z0-9_-]+$/;

/** How many earlier turns the judge sees: what prod's own context holds. */
export const CONTEXT_TURNS = 4;

function parseArgs(argv) {
  const args = { owner: null, convs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--owner') args.owner = argv[++i];
    else if (flag === '--conv') args.convs = (argv[++i] ?? '').split(',').filter(Boolean);
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!args.owner || !ID.test(args.owner)) throw new Error('--owner <userId> is required');
  if (!args.convs.every((id) => ID.test(id))) throw new Error('--conv takes clientIds only');
  return args;
}

function psqlJson(sql) {
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

function queryRecorded(owner, convs) {
  const only = convs.length
    ? `AND c."clientId" IN (${convs.map((id) => `'${id}'`).join(',')})`
    : '';
  return psqlJson(`
    SELECT coalesce(json_agg(x ORDER BY x.conv, x.position), '[]'::json) FROM (
      SELECT c."clientId" AS conv, c.languages, c."audioKey", c."audioOffsetMs", c."audioDurationMs",
             t.position, t."sourceText", t."displayText", t."sourceLanguages", t.translations, t."offsetMs"
      FROM "Conversation" c JOIN "ConversationTurn" t ON t."conversationId" = c.id
      WHERE c."ownerId" = '${owner}' AND c."audioKey" IS NOT NULL ${only}
    ) x;`);
}

/**
 * Where a turn starts inside the recording, or null when it has no time.
 *
 * `offsetMs` is measured from the conversation's start and `audioOffsetMs` is
 * where the recording began on that clock — the same subtraction the history
 * player makes (`apps/web/src/lib/transcript-time.ts`, `mediaOffset`).
 */
export function mediaMs(offsetMs, audioOffsetMs) {
  if (offsetMs === null || offsetMs === undefined) return null;
  return Math.max(0, offsetMs - (audioOffsetMs ?? 0));
}

/** Turn rows for the judge, built on `draftRows` and joined back to their times. */
export function judgeRows(turns, countTermWords) {
  const timing = new Map(
    turns.map((turn) => [
      `${turn.conv}#${turn.position}`,
      mediaMs(turn.offsetMs, turn.audioOffsetMs),
    ]),
  );
  const rows = [];
  const history = new Map();
  for (const draft of draftRows(turns, countTermWords)) {
    const earlier = history.get(draft.conv) ?? [];
    rows.push({
      conv: draft.conv,
      pos: draft.pos,
      direction: draft.direction,
      source: draft.source,
      translation: draft.draft,
      words: draft.words,
      context: earlier.slice(-CONTEXT_TURNS),
      mediaMs: timing.get(`${draft.conv}#${draft.pos}`),
    });
    earlier.push({ source: draft.source, translation: draft.draft });
    history.set(draft.conv, earlier);
  }
  return rows;
}

function recordingsOf(turns) {
  const byConv = new Map();
  for (const turn of turns) {
    if (byConv.has(turn.conv)) continue;
    byConv.set(turn.conv, {
      conv: turn.conv,
      languages: turn.languages,
      audioKey: turn.audioKey,
      audioOffsetMs: turn.audioOffsetMs,
      audioDurationMs: turn.audioDurationMs,
    });
  }
  return [...byConv.values()];
}

function r2Base() {
  const run = spawnSync('docker', ['exec', 'chatofy_prod_api', 'printenv', 'R2_PUBLIC_BASE_URL'], {
    encoding: 'utf8',
  });
  const base = run.stdout.trim();
  if (run.status !== 0 || !base)
    throw new Error('R2_PUBLIC_BASE_URL is not set on chatofy_prod_api');
  return base.replace(/\/+$/, '');
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { countTermWords } = await typesModule();
  const turns = queryRecorded(args.owner, args.convs);
  const recordings = recordingsOf(turns);
  const missing = args.convs.filter((id) => !recordings.some((rec) => rec.conv === id));
  if (missing.length) throw new Error(`no recorded turns for ${missing.join(', ')}`);

  const rows = judgeRows(turns, countTermWords);
  const audioDir = join(DATA, 'audio');
  mkdirSync(audioDir, { recursive: true });
  const base = r2Base();
  for (const rec of recordings) {
    const path = join(audioDir, `${rec.conv}.webm`);
    if (!existsSync(path)) await download(`${base}/${rec.audioKey}`, path);
  }
  writeFileSync(join(DATA, 'turns.jsonl'), toJsonl(rows));
  writeFileSync(join(DATA, 'recordings.jsonl'), toJsonl(recordings));
  const untimed = rows.filter((row) => row.mediaMs === null).length;
  console.error(
    `${rows.length} turns (${untimed} without a time) from ${recordings.length} recordings → ${DATA}`,
  );
}
