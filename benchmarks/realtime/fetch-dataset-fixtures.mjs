// Builds the real-voice half of the fixture matrix from public datasets.
//
// The other half comes from ElevenLabs, and the split is not arbitrary:
// synthesized speech gives exact control over pause structure and length, and
// gives a flattering answer about disfluency, room tone and VAD robustness
// because it has none of them. Those questions need human speech, and since
// there are no recordings of our own, they come from published corpora.
//
// Usage:
//   set -a; . apps/api/.env; set +a          # for HF_TOKEN
//   node benchmarks/realtime/fetch-dataset-fixtures.mjs --source all
//   node benchmarks/realtime/fetch-dataset-fixtures.mjs --source ami --trim-s 180
//   node benchmarks/realtime/fetch-dataset-fixtures.mjs --source vlsp --passage-s 40
//
// Audio is written to `fixtures/` and never committed — only this script is, so
// the matrix is rebuilt rather than stored. Every choice it makes is recorded in
// `fixtures/manifest.json` (row indices, licence, reference transcript) so a
// later run reproduces the same fixtures rather than a similar-looking set, and
// so `vad-reference.mjs --manifest` can produce their coverage denominator.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concatClips, durationMs, openWav, writeWav } from './wav.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'fixtures');
// The manifest the harness already has, in the shape it already has: a flat array
// whose entries carry `file` relative to `fixtures/`. Writing a second manifest
// alongside it would have been tidier to generate and invisible to
// `vad-reference.mjs --manifest`, which is the step that produces the coverage
// denominator — so these fixtures would silently have had no denominator.
const MANIFEST = join(OUT_DIR, 'manifest.json');
const ROWS_API = 'https://datasets-server.huggingface.co/rows';

/**
 * Filled pauses, hedges and restarts, as they appear in a Vietnamese transcript.
 *
 * This regex is how fixtures are CHOSEN, which makes it part of the measurement
 * rather than a convenience. Selecting clips by ear would make the disfluency leg
 * unreproducible, and selecting them at random would mostly return fluent speech.
 *
 * It is also the step that audits the dataset: if a corpus yields no matches, that
 * corpus does not contain the speech this leg exists to test, and the honest move
 * is to record that rather than quietly substitute another one. Measured when this
 * was written — LSVSC returned matches that were all transliterated proper nouns
 * ("Mai sờ cai ơ"), which is why it is not one of the sources below.
 */
const FILLER = /(^|\s)(ừ|ừm|ờ|à|ạ|kiểu|thì là|nhưng mà|hoặc là|tức là|ý là)(\s|$)/;

/**
 * Where each leg of the matrix comes from, and what it is allowed to answer.
 *
 * Licence and citation travel with the source because the fixtures are rebuilt by
 * whoever runs this next, and an attribution requirement that lives only in
 * someone's memory is an attribution requirement that gets dropped. AMI is CC BY
 * 4.0 and therefore MUST be credited wherever its numbers are published.
 */
const SOURCES = {
  ami: {
    kind: 'http',
    language: 'en',
    shape: 'meeting-long-form',
    licence: 'CC BY 4.0',
    citation: 'AMI Meeting Corpus — https://groups.inf.ed.ac.uk/ami/corpus/',
    // One whole meeting, not a segmented export: this is the only leg of the
    // matrix that carries real turn-taking, far-field room tone and natural
    // disfluency in one continuous recording, which is exactly what the
    // extension actually captures.
    url: (meeting) =>
      `https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/${meeting}/audio/${meeting}.Mix-Headset.wav`,
    meeting: 'ES2002a',
    note: 'The OpenSLR mirror states an older CC BY-NC-SA 2.0; the corpus site is authoritative.',
  },
  vlsp: {
    kind: 'hf',
    dataset: 'doof-ferb/vlsp2020_vinai_100h',
    language: 'vi',
    shape: 'disfluent-concatenated',
    licence: 'CC BY 4.0',
    citation:
      'VLSP 2020 ASR (VinAI) — https://huggingface.co/datasets/doof-ferb/vlsp2020_vinai_100h',
    transcriptField: 'transcription',
    note: 'Carries genuine filled pauses ("mình đang ờ nói về..."). Primary Vietnamese leg.',
  },
  vietmed: {
    kind: 'hf',
    dataset: 'leduckhai/VietMed',
    language: 'vi',
    shape: 'conversation-concatenated',
    licence: 'MIT',
    citation: 'VietMed — https://huggingface.co/datasets/leduckhai/VietMed',
    transcriptField: 'text',
    note: 'Real doctor-patient conversation. Check the sample rate before quoting WER: telephony-band audio understates the recogniser.',
  },
};

/** Rows scanned per source before giving up on finding enough disfluent clips. */
const MAX_ROWS_SCANNED = 400;
/** Rows per request. The API caps a page at 100. */
const PAGE = 100;

const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};

async function getJson(url, token) {
  const res = await fetch(
    url,
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  );
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

async function getBytes(url, token) {
  const res = await fetch(
    url,
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Pull disfluent clips from a HuggingFace dataset and join them into passages.
 *
 * Concatenation is what produces long-form Vietnamese at all: every public
 * Vietnamese corpus is already cut into short utterances, so a 40s passage has to
 * be assembled. It reproduces length and pause structure faithfully, and does NOT
 * reproduce conversational dynamics — the joins are between unrelated sentences.
 * That limitation is written into the manifest so it reaches the report.
 */
async function buildHfPassages(key, source, token, { passageMs, gapMs, passages }) {
  const built = [];
  const selected = [];
  let scanned = 0;
  let matched = 0;

  for (let offset = 0; offset < MAX_ROWS_SCANNED && built.length < passages; offset += PAGE) {
    const url =
      `${ROWS_API}?dataset=${encodeURIComponent(source.dataset)}` +
      `&config=default&split=train&offset=${offset}&length=${PAGE}`;
    const page = await getJson(url, token);
    if (!page.rows?.length) break;

    for (const { row_idx: rowIndex, row } of page.rows) {
      scanned += 1;
      const transcript = String(row[source.transcriptField] ?? '');
      if (!FILLER.test(transcript)) continue;
      matched += 1;

      // Signed asset URLs expire, so bytes are fetched now rather than recorded.
      const src = row.audio?.[0]?.src;
      if (!src) continue;
      let clip;
      try {
        clip = openWav(await getBytes(src, token));
      } catch (err) {
        console.warn(`  row ${rowIndex}: unreadable (${err.message})`);
        continue;
      }

      selected.push({ rowIndex, transcript, clip });

      const total =
        selected.reduce((ms, s) => ms + durationMs(s.clip), 0) + gapMs * (selected.length - 1);
      if (total < passageMs) continue;

      built.push(finishPassage(key, source, selected.splice(0), gapMs, built.length));
      if (built.length >= passages) break;
    }
  }

  // A partial passage is still worth writing: a run that found six disfluent
  // clips should produce a fixture of six, not silently produce nothing.
  if (built.length < passages && selected.length > 0) {
    built.push(finishPassage(key, source, selected, gapMs, built.length));
  }

  console.log(
    `  scanned ${scanned} rows, ${matched} carried fillers, built ${built.length} passage(s)`,
  );
  if (matched === 0) {
    console.warn(
      `  NO disfluent clips in ${source.dataset}. That is a finding about the corpus,\n` +
        '  not a bug here: record it, and cover this leg with scripted ElevenLabs\n' +
        '  hesitation instead of quietly swapping in another dataset.',
    );
  }
  return built;
}

function finishPassage(key, source, clips, gapMs, index) {
  const joined = concatClips(
    clips.map((c) => c.clip),
    gapMs,
  );
  const wav = writeWav(joined, joined.pcm);
  const name = `${key}-${source.language}-${String(index + 1).padStart(2, '0')}.wav`;
  writeFileSync(join(OUT_DIR, name), wav);

  return {
    id: name.replace(/\.wav$/, ''),
    file: name,
    language: source.language,
    shape: source.shape,
    dataset: source.dataset,
    licence: source.licence,
    citation: source.citation,
    note: source.note,
    sampleRate: joined.sampleRate,
    durationMs: durationMs(joined),
    gapMs,
    // Everything needed to rebuild this exact fixture, and to check a later
    // rebuild produced the same bytes rather than a similar-looking set.
    sourceRows: clips.map((c) => c.rowIndex),
    referenceTranscript: clips.map((c) => c.transcript).join(' '),
    sha256: createHash('sha256').update(wav).digest('hex'),
    assembled: true,
    limitation:
      'Assembled from unrelated utterances: length and pause structure are real, conversational dynamics are not.',
  };
}

async function buildAmi(source, { trimMs }) {
  const meeting = arg('meeting', source.meeting);
  console.log(`  downloading ${meeting} (whole meeting, this is the large one)…`);
  const audio = openWav(await getBytes(source.url(meeting)));

  const full = durationMs(audio);
  const keepMs = trimMs && trimMs < full ? trimMs : full;
  const perMs = (audio.sampleRate * audio.channels * 2) / 1000;
  const pcm = audio.pcm.subarray(0, Math.floor(keepMs * perMs));
  const wav = writeWav(audio, pcm);

  const name = `ami-en-${meeting}.wav`;
  writeFileSync(join(OUT_DIR, name), wav);
  console.log(
    `  ${meeting}: ${Math.round(full / 1000)}s available, kept ${Math.round(keepMs / 1000)}s`,
  );

  return [
    {
      id: name.replace(/\.wav$/, ''),
      file: name,
      language: source.language,
      shape: source.shape,
      dataset: `AMI/${meeting}`,
      licence: source.licence,
      citation: source.citation,
      note: source.note,
      sampleRate: audio.sampleRate,
      durationMs: keepMs,
      // No reference transcript: AMI ships its annotations separately, and a
      // fixture claiming a transcript it does not have would be worse than one
      // that says so. Coverage and latency do not need it; WER does.
      referenceTranscript: null,
      sha256: createHash('sha256').update(wav).digest('hex'),
      assembled: false,
    },
  ];
}

async function main() {
  const want = arg('source', 'all');
  const token = (process.env.HF_TOKEN ?? '').trim();
  const passageMs = Number(arg('passage-s', 40)) * 1000;
  const gapMs = Number(arg('gap-ms', 400));
  const passages = Number(arg('passages', 2));
  const trimMs = arg('trim-s') ? Number(arg('trim-s')) * 1000 : null;

  const keys = want === 'all' ? Object.keys(SOURCES) : want.split(',');
  const unknown = keys.filter((k) => !SOURCES[k]);
  if (unknown.length) {
    console.error(
      `unknown source(s): ${unknown.join(', ')}. Known: ${Object.keys(SOURCES).join(', ')}`,
    );
    process.exit(2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const fixtures = [];
  const failures = [];

  for (const key of keys) {
    const source = SOURCES[key];
    console.log(`\n=== ${key} (${source.licence}) ===`);
    try {
      const built =
        source.kind === 'http'
          ? await buildAmi(source, { trimMs })
          : await buildHfPassages(key, source, token, { passageMs, gapMs, passages });
      fixtures.push(...built);
    } catch (err) {
      // One unreachable source must not lose the others. A gated dataset is the
      // common case and it is a permissions problem, not a code problem.
      console.error(`  FAILED: ${err.message}`);
      failures.push({ source: key, error: err.message });
    }
  }

  // Merged, not overwritten. `generate-fixtures.mjs` writes synthesized turns into
  // the same manifest, and clobbering them would quietly delete half the matrix
  // — the half whose audio is still sitting in `fixtures/`, so nothing would look
  // missing until a later run reported a denominator for fixtures it no longer
  // listed. Entries are keyed by `file`, so re-running this replaces its own and
  // leaves everything else alone.
  const existing = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];
  const mine = new Set(fixtures.map((f) => f.file));
  const kept = existing.filter((entry) => !mine.has(entry.file));
  writeFileSync(MANIFEST, `${JSON.stringify([...kept, ...fixtures], null, 2)}\n`);

  console.log(
    `\nwrote ${fixtures.length} fixture(s) into the manifest, kept ${kept.length} existing`,
  );
  for (const f of fixtures) {
    console.log(
      `  ${f.id.padEnd(26)} ${String(Math.round(f.durationMs / 1000)).padStart(4)}s  ` +
        `${String(f.sampleRate).padStart(5)}Hz  ${f.licence}`,
    );
  }
  if (failures.length) {
    console.log('\nunreachable:');
    for (const f of failures) console.log(`  ${f.source}: ${f.error.slice(0, 100)}`);
  }
  console.log(
    '\nAttribution is not optional for the CC BY sources — carry the citation\n' +
      'field into any report that quotes numbers from these fixtures.\n',
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
