// Decides which CI lanes a pull request's diff can reach. Read by the
// `changes` job in .github/workflows/ci.yml; every other job there runs unless
// this prints `<lane>=false` for it.
//
// It fails OPEN, and that is the whole design. A path with no row below means
// "everything runs" — a new package, a new root config file, a new workflow —
// because a lane skipped on a path nobody thought about is coverage lost with
// a green check. An empty diff means everything runs too.
//
// The Node lane (Lint, Type check, Test, Build, Supply chain) runs whole-repo
// `turbo run …`, never `--affected`, so turbo's blind spots do not matter to it:
// what matters is only that every path any spec reads maps to `node`. The rows
// that exist for a read across a package boundary say so. A spec that starts
// reading outside its own package needs its path to map to the lane it runs in.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LANES = ['node', 'api', 'extension', 'itn', 'sidecar', 'stt', 'replay'];
const ALL = LANES;
const NONE = [];

// First match wins, so the everything-rows come first and the nothing-rows
// come before the per-package rows (a README inside apps/api is still docs).
export const RULES = [
  // Inputs every lane installs, resolves or is configured by. This file and
  // ci.yml are here so a change to the selection itself is tested by a full run.
  [
    /^(pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml|\.npmrc|\.nvmrc|turbo\.json|tsconfig\.base\.json|\.gitattributes)$/,
    ALL,
  ],
  [/^(packages\/config|patches)\//, ALL],
  [/^\.github\/workflows\/ci\.yml$/, ALL],
  [/^scripts\/ci-changed-jobs(\.test)?\.mjs$/, ALL],

  // Read by nothing in CI: no spec, build step or gate script opens these
  // (grepped across apps, packages, scripts, services, benchmarks; the only
  // hits are prose in comments).
  [/^(docs|plans|\.claude|\.agentkit|\.opencode|kits|\.vscode)\//, NONE],
  [/\.md$/, NONE],
  [/^(LICENSE|knip\.json)$/, NONE],
  [/^\.github\/workflows\/(deploy|main-failure-alert)\.yml$/, NONE],

  // The sidecar's Python splitter test reads the api's case file, so the two
  // splitters cannot drift apart unseen.
  [
    /^apps\/api\/src\/modules\/translate\/audio\/clause-splitter\.cases\.json$/,
    ['node', 'api', 'sidecar'],
  ],
  [/^apps\/api\//, ['node', 'api']],
  [/^apps\/extension\//, ['node', 'extension']],
  [/^apps\/(web|mobile)\//, ['node']],

  // Per package, its transitive dependents among the specialised lanes:
  // api e2e builds api^..., extension e2e builds extension's closure, the ITN
  // gates import ai-providers' dist, the replay suites build realtime-client^...
  [/^packages\/types\//, ['node', 'api', 'extension', 'itn', 'replay']],
  [/^packages\/(i18n|api-client)\//, ['node', 'api']],
  [/^packages\/ai-providers\//, ['node', 'api', 'itn']],
  [/^packages\/realtime-client\//, ['node', 'extension', 'replay']],
  [/^packages\/ui\//, ['node', 'extension']],

  // `node --test scripts/*.test.mjs` runs in Test; check-single-react in Supply chain.
  [/^scripts\//, ['node']],
  // The eslint configs load eslint-plugin-prettier, so a formatting rule change
  // can turn Lint red without touching a line of code.
  [/^(\.prettierrc\.cjs|\.prettierignore|\.editorconfig)$/, ['node']],
  // api's env.schema.spec reads these from the repo root.
  [/^(\.env\.example|prod\.env\.example|docker-compose(\.prod)?\.yml)$/, ['node']],

  // Non-Node inputs of the specialised lanes. The replay fixture cache is keyed
  // on the TTS engine files, so a sidecar change can force a re-synthesis.
  [/^services\/local-tts\//, ['sidecar', 'replay']],
  // The STT sidecar is read by no Node suite and no other job; only its own.
  [/^services\/local-stt\//, ['stt']],
  [/^benchmarks\/stt\//, ['itn']],
  [/^benchmarks\/realtime\//, ['replay']],
  // web's recorder-parity spec reads this one benchmark file.
  [/^benchmarks\/speaker-id\/recorder\//, ['node']],
  [/^benchmarks\//, NONE],
];

/** Lanes a path reaches, or null when no row covers it. */
export function lanesFor(path) {
  for (const [pattern, lanes] of RULES) if (pattern.test(path)) return lanes;
  return null;
}

/** { lane: boolean } for a diff. Unmapped path or empty diff → every lane. */
export function selectLanes(paths) {
  const everything = Object.fromEntries(LANES.map((lane) => [lane, true]));
  if (paths.length === 0) return everything;
  const selected = new Set();
  for (const path of paths) {
    const lanes = lanesFor(path);
    if (lanes === null) return everything;
    for (const lane of lanes) selected.add(lane);
  }
  return Object.fromEntries(LANES.map((lane) => [lane, selected.has(lane)]));
}

// CLI: NUL-separated paths on stdin (`git diff --name-only -z`), `lane=bool`
// lines on stdout for $GITHUB_OUTPUT, the reasoning on stderr for the log.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, 'utf8').split('\0').filter(Boolean);
  for (const path of paths) {
    const lanes = lanesFor(path);
    console.error(
      `${path} -> ${lanes === null ? 'UNMAPPED: every lane' : lanes.join(',') || '(none)'}`,
    );
  }
  const lanes = selectLanes(paths);
  process.stdout.write(LANES.map((lane) => `${lane}=${lanes[lane]}`).join('\n') + '\n');
}
