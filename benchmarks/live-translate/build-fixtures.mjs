// Build the utterance set both arms are measured on.
//
// Three properties matter, and each is a defence against a specific objection:
//
//   REAL HUMAN SPEECH — VIVOS (vi) and LibriSpeech (en), the same corpora and the
//     same seed `benchmarks/stt` already uses, so the two thesis chapters share a
//     corpus. Synthesized speech is off-distribution for both systems' front ends
//     and is the easiest thing for an examiner to attack.
//   TRAILING SILENCE — at least PAD_MS after every utterance. This is not
//     cosmetic: the continuous model has no endpoint event and reads quiet as the
//     end of an utterance, and the spike proved that cutting the stream at the
//     last speech sample returns a truncated translation. It is also what makes a
//     continuous system's output attributable to ONE input utterance without
//     forced alignment.
//   A FIXED SEED — so an examiner's question is answered by re-running rather
//     than by memory.
//
// Everything is 16 kHz mono pcm16, which is what the app's own capture emits, so
// neither arm pays a resampling cost the other does not.
//
// Usage:
//   node benchmarks/live-translate/build-fixtures.mjs
//   node benchmarks/live-translate/build-fixtures.mjs --count 30

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data');

/** Matches `benchmarks/stt`, so the two chapters describe the same utterances. */
const SEED = 42;
const DEFAULT_COUNT = 50;
const MIN_DURATION_MS = 3000;
const MAX_DURATION_MS = 10000;
/**
 * Silence appended to every utterance.
 *
 * 3.5 s is the floor the plan sets for unambiguous attribution; 4 s is what the
 * spike actually verified end to end, and there is no reason to run the harness
 * on a value the spike did not prove.
 */
const PAD_MS = 4000;

const SAMPLE_RATE = 16000;

/**
 * Where the audio comes from.
 *
 * VIVOS through the HuggingFace datasets server rather than the OpenSLR tarball:
 * the canonical `AILAB-VNUHCM/vivos` runs arbitrary Python so the viewer refuses
 * it, and this mirror is a plain parquet conversion of the same test split. Its
 * licence is VIVOS's — CC BY-NC-SA 4.0, measurement use only, no redistribution,
 * which is why nothing under `data/` is committed.
 */
const SOURCES = {
  vi: {
    dataset: 'ademax/vivos-vie-speech2text',
    config: 'default',
    split: 'test',
    transcriptField: 'transcription',
    licence: 'VIVOS, CC BY-NC-SA 4.0 — measurement use only',
  },
  en: {
    dataset: 'openslr/librispeech_asr',
    config: 'clean',
    split: 'test',
    transcriptField: 'text',
    licence: 'LibriSpeech test-clean, CC BY 4.0',
  },
};

/** Deterministic PRNG, so `--count` and the seed fully describe the set. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchRows(source, offset, length) {
  const url =
    `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(source.dataset)}` +
    `&config=${source.config}&split=${source.split}&offset=${offset}&length=${length}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${source.dataset}: rows ${offset} → HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${source.dataset}: ${body.error}`);
  return body.rows.map((r) => r.row);
}

/**
 * Get PCM out of whatever the datasets server actually served.
 *
 * VIVOS arrives as WAV; LibriSpeech arrives as FLAC. Both are already 16 kHz
 * mono, so the FLAC branch is a container change and not a resample — worth
 * saying, because a harness that quietly resampled its own fixtures would be
 * measuring its own conversion alongside the systems under test. `ffmpeg` is
 * required only for the English half; see the README.
 */
function toPcm16Wav(raw) {
  if (raw.toString('ascii', 0, 4) === 'RIFF') return raw;
  if (raw.toString('ascii', 0, 4) !== 'fLaC') {
    throw new Error(`unsupported container ${JSON.stringify(raw.toString('ascii', 0, 4))}`);
  }
  return execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-f',
      'wav',
      '-acodec',
      'pcm_s16le',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      'pipe:1',
    ],
    { input: raw, maxBuffer: 256 * 1024 * 1024 },
  );
}

/** Locate a WAV's data chunk rather than assuming a 44-byte header. */
function readPcm16Wav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF file');
  let offset = 12;
  let fmt = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk');
      return { fmt, samples: buf.subarray(body, body + size) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('no data chunk');
}

function wrapPcm16Wav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function buildLanguage(lang, count) {
  const source = SOURCES[lang];
  const outDir = join(DATA, lang);
  mkdirSync(outDir, { recursive: true });

  // Over-fetch, then select deterministically. Fetching exactly `count` and
  // taking them all would make the seed decorative.
  const pool = [];
  const PAGE = 100;
  for (let offset = 0; pool.length < count * 6 && offset < count * 20; offset += PAGE) {
    const rows = await fetchRows(source, offset, PAGE);
    if (rows.length === 0) break;
    pool.push(...rows);
    process.stdout.write(`\r  ${lang}: ${pool.length} candidates`);
  }
  process.stdout.write('\n');

  const random = mulberry32(SEED + (lang === 'vi' ? 0 : 1));
  const shuffled = pool
    .map((row) => ({ row, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ row }) => row);

  const manifest = [];
  for (const row of shuffled) {
    if (manifest.length >= count) break;
    const src = row.audio?.[0]?.src;
    if (!src) continue;

    const res = await fetch(src);
    if (!res.ok) continue;
    const raw = Buffer.from(await res.arrayBuffer());

    let parsed;
    try {
      parsed = readPcm16Wav(toPcm16Wav(raw));
    } catch {
      continue;
    }
    const { fmt, samples } = parsed;
    // No resampling here. A fixture the harness had to convert is a fixture
    // whose provenance is one step further from the corpus, and both corpora
    // already ship 16 kHz mono.
    if (fmt.sampleRate !== SAMPLE_RATE || fmt.channels !== 1 || fmt.bitsPerSample !== 16) {
      continue;
    }
    const durationMs = (samples.length / 2 / SAMPLE_RATE) * 1000;
    if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) continue;

    const index = manifest.length;
    const id = `${lang}-${String(index).padStart(3, '0')}`;
    const padded = Buffer.concat([samples, Buffer.alloc((SAMPLE_RATE * 2 * PAD_MS) / 1000)]);
    const file = join(outDir, `${id}.wav`);
    writeFileSync(file, wrapPcm16Wav(padded, SAMPLE_RATE));

    manifest.push({
      id,
      lang,
      file: `data/${lang}/${id}.wav`,
      speechMs: Math.round(durationMs),
      paddedMs: Math.round(durationMs) + PAD_MS,
      transcript: row[source.transcriptField],
      // Left null on purpose. Neither corpus ships translations, and a
      // machine-filled field here would silently become the reference the
      // adequacy score is computed against.
      referenceTranslation: null,
    });
    process.stdout.write(`\r  ${lang}: ${manifest.length}/${count} written`);
  }
  process.stdout.write('\n');
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  const countArg = args.indexOf('--count');
  const count = countArg === -1 ? DEFAULT_COUNT : Number(args[countArg + 1]);

  mkdirSync(DATA, { recursive: true });
  const manifest = { seed: SEED, padMs: PAD_MS, sampleRate: SAMPLE_RATE, utterances: [] };

  for (const lang of ['vi', 'en']) {
    console.log(`${SOURCES[lang].dataset} — ${SOURCES[lang].licence}`);
    manifest.utterances.push(...(await buildLanguage(lang, count)));
  }

  const path = join(DATA, 'manifest.json');
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${manifest.utterances.length} utterances → ${path}`);
  console.log(
    'referenceTranslation is null for every row. Fill it before running ' +
      'score-adequacy.py; see the README on what counts as an acceptable reference.',
  );
}

await main();
