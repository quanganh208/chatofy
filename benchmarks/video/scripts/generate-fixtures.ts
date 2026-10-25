/**
 * generate-fixtures.ts
 *
 * Generates synthetic Y4M video files at each target resolution+fps for
 * Chromium's --use-file-for-fake-video-capture flag.
 *
 * Requires ffmpeg on PATH. Run once before benchmarking:
 *   pnpm generate-fixtures
 *
 * Output: fixtures/fake-<width>x<height>-<fps>fps.y4m
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures');

interface Resolution {
  name: string;
  width: number;
  height: number;
  fps: number;
}

const RESOLUTIONS: Resolution[] = [
  { name: '360p30', width: 640, height: 360, fps: 30 },
  { name: '720p30', width: 1280, height: 720, fps: 30 },
  { name: '720p60', width: 1280, height: 720, fps: 60 },
];

// 3 seconds of synthetic color-bar video is enough; Chromium loops the Y4M.
const DURATION_SECONDS = 3;

mkdirSync(FIXTURES_DIR, { recursive: true });

let generated = 0;
let skipped = 0;

for (const res of RESOLUTIONS) {
  const filename = `fake-${res.width}x${res.height}-${res.fps}fps.y4m`;
  const outPath = resolve(FIXTURES_DIR, filename);

  if (existsSync(outPath)) {
    console.log(`  SKIP  ${filename} (already exists)`);
    skipped++;
    continue;
  }

  const cmd = [
    'ffmpeg',
    '-f lavfi',
    `-i testsrc=size=${res.width}x${res.height}:rate=${res.fps}`,
    `-t ${DURATION_SECONDS}`,
    '-pix_fmt yuv420p',
    '-f yuv4mpegpipe',
    `-y "${outPath}"`,
  ].join(' ');

  console.log(`  GEN   ${filename} …`);
  try {
    execSync(cmd, { stdio: 'pipe' });
    console.log(`  OK    ${filename}`);
    generated++;
  } catch (err) {
    console.error(`  FAIL  ${filename}`);
    console.error(
      'ffmpeg error — is ffmpeg installed and on PATH?',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

console.log(`\nDone: ${generated} generated, ${skipped} skipped.`);
console.log(`Fixtures directory: ${FIXTURES_DIR}`);
