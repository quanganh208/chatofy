/**
 * Rebuild the popup's committed Be Vietnam Pro subsets, reproducibly.
 *
 * The popup cannot use `next/font`. It ships four woff2 files inside the
 * extension, and four opaque binaries in a diff are exactly the thing no reviewer
 * can check by reading. A comment recording a URL is provenance prose, not
 * integrity — so this script is the invocation that produced them, and
 * `fonts.lock.json` beside it holds the SHA-256 of every source TTF and every
 * emitted woff2.
 *
 * Default run VERIFIES: it fetches the pinned sources, re-subsets them, and
 * compares both sets of digests against the lock. `--write-lock` is the only way
 * to change what the lock claims, and it prints what moved.
 *
 * Why the web app is not built from here: `next/font/google` fetches Be Vietnam
 * Pro at build time and self-hosts it into `.next`, which is a different
 * mechanism with a different output. What the two surfaces share is the FAMILY
 * NAME, and `apps/web/src/design/token-parity.spec.ts` is what holds them to it.
 *
 * Requires Python's fontTools with brotli (`pip install 'fonttools[woff]'`).
 * Both versions are recorded in the lock: woff2 bytes depend on the compressor,
 * so a digest mismatch under a different toolchain is expected and is reported as
 * such rather than as tampering.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * The upstream tree this was cut from. A tag would be friendlier to read, but
 * `google/fonts` does not tag per family — a commit is the only thing that names
 * one exact set of bytes.
 */
const UPSTREAM_COMMIT = 'c13390277dfb1fcc7415d84ef7ef9cfc1e52f8c1';
const UPSTREAM_DIR = 'ofl/bevietnampro';
const UPSTREAM = `https://raw.githubusercontent.com/google/fonts/${UPSTREAM_COMMIT}/${UPSTREAM_DIR}`;

/** The four the components use: body, control label, heading, and nothing heavier. */
const WEIGHTS = [
  { weight: 400, file: 'BeVietnamPro-Regular.ttf' },
  { weight: 500, file: 'BeVietnamPro-Medium.ttf' },
  { weight: 600, file: 'BeVietnamPro-SemiBold.ttf' },
  { weight: 700, file: 'BeVietnamPro-Bold.ttf' },
];

/**
 * latin ∪ vietnamese, copied from what `fonts.googleapis.com` serves for this
 * family — so the popup's coverage is the same coverage `next/font` gives web
 * rather than a range invented here.
 *
 * latin-ext is deliberately absent. The popup renders Vietnamese and English and
 * nothing else, and it carries every byte it ships.
 */
const UNICODE_RANGES = [
  // vietnamese
  'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0',
  'U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
  // latin
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC',
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
].join(',');

/**
 * Everything `pyftsubset` is told, in one place because the lock's digests are
 * only meaningful alongside the flags that produced them.
 *
 * `--layout-features` keeps kerning and the mark positioning Vietnamese needs:
 * stacked diacritics (`ẫ`, `ợ`) are composed by `mark`/`mkmk` on this face, and a
 * subset without them renders them detached rather than not at all.
 */
const SUBSET_FLAGS = [
  '--flavor=woff2',
  `--unicodes=${UNICODE_RANGES}`,
  '--layout-features=kern,liga,mark,mkmk,ccmp,locl',
  '--no-hinting',
  '--desubroutinize',
  '--drop-tables+=DSIG',
  '--name-IDs=*',
  '--name-legacy',
];

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'fonts');
const lockPath = join(here, 'fonts.lock.json');
const writeLock = process.argv.includes('--write-lock');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function toolVersions() {
  const probe = spawnSync(
    'python3',
    [
      '-c',
      'import fontTools, brotli;' +
        'print(fontTools.version);' +
        "print(getattr(brotli, '__version__', 'unknown'))",
    ],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0) {
    throw new Error(
      `fontTools with brotli is required: ${probe.stderr.trim()}\n` +
        "  pip install 'fonttools[woff]'",
    );
  }
  const [fontTools, brotli] = probe.stdout.trim().split('\n');
  return { fontTools, brotli };
}

function subset(sourcePath, targetPath) {
  const run = spawnSync(
    'python3',
    ['-m', 'fontTools.subset', sourcePath, ...SUBSET_FLAGS, `--output-file=${targetPath}`],
    { encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`pyftsubset failed: ${run.stderr.trim()}`);
}

const tools = toolVersions();
const previous = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : undefined;
const staging = mkdtempSync(join(tmpdir(), 'chatofy-fonts-'));
const problems = [];
const lock = {
  family: 'Be Vietnam Pro',
  upstream: `https://github.com/google/fonts/tree/${UPSTREAM_COMMIT}/${UPSTREAM_DIR}`,
  commit: UPSTREAM_COMMIT,
  license: 'OFL-1.1',
  unicodeRanges: UNICODE_RANGES,
  subsetFlags: SUBSET_FLAGS,
  tools,
  files: {},
};

try {
  mkdirSync(outDir, { recursive: true });

  const license = await fetchBytes(`${UPSTREAM}/OFL.txt`);
  writeFileSync(join(outDir, 'OFL.txt'), license);
  lock.files['OFL.txt'] = { source: sha256(license) };

  for (const { weight, file } of WEIGHTS) {
    const ttf = await fetchBytes(`${UPSTREAM}/${file}`);
    const sourcePath = join(staging, file);
    writeFileSync(sourcePath, ttf);

    const name = `be-vietnam-pro-${weight}.woff2`;
    const targetPath = join(outDir, name);
    subset(sourcePath, targetPath);

    const emitted = readFileSync(targetPath);
    lock.files[name] = {
      weight,
      upstreamFile: file,
      source: sha256(ttf),
      subset: sha256(emitted),
      bytes: emitted.byteLength,
    };
    console.log(`${name}  ${(emitted.byteLength / 1024).toFixed(1)} KiB  from ${file}`);
  }

  if (previous) {
    for (const [name, entry] of Object.entries(lock.files)) {
      const was = previous.files?.[name];
      if (!was) {
        problems.push(`${name}: not in the lock`);
        continue;
      }
      if (was.source !== entry.source) {
        problems.push(`${name}: upstream TTF digest moved — ${was.source} -> ${entry.source}`);
      }
      if (entry.subset && was.subset !== entry.subset) {
        problems.push(`${name}: emitted woff2 digest moved — ${was.subset} -> ${entry.subset}`);
      }
    }
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

if (writeLock) {
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`\nfonts.lock.json written${problems.length ? `\n  ${problems.join('\n  ')}` : ''}`);
  process.exit(0);
}

if (!previous) {
  console.error('\nNo fonts.lock.json. Run with --write-lock to create one.');
  process.exit(1);
}

if (problems.length) {
  const sameTools =
    previous.tools?.fontTools === tools.fontTools && previous.tools?.brotli === tools.brotli;
  console.error(`\n${problems.join('\n')}`);
  console.error(
    sameTools
      ? '\nSame toolchain as the lock, so this is a real change in the bytes.'
      : `\nToolchain differs from the lock (fontTools ${previous.tools?.fontTools} / brotli ` +
          `${previous.tools?.brotli}). A woff2 digest can move on the compressor alone; the ` +
          'SOURCE digests above cannot, and are the ones that mean tampering.',
  );
  process.exit(1);
}

console.log('\nfonts match fonts.lock.json');
