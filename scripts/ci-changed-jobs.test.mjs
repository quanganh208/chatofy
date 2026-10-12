import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LANES, lanesFor, selectLanes } from './ci-changed-jobs.mjs';

const every = Object.fromEntries(LANES.map((lane) => [lane, true]));
const only = (...on) => Object.fromEntries(LANES.map((lane) => [lane, on.includes(lane)]));

describe('fails open', () => {
  it('runs everything on an empty diff', () => {
    assert.deepEqual(selectLanes([]), every);
  });

  it('runs everything when any one path is unmapped', () => {
    for (const path of [
      'packages/new-pkg/src/a.ts',
      'apps/desktop/main.ts',
      '.github/dependabot.yml',
      'release-manifest.json',
    ]) {
      assert.equal(lanesFor(path), null, path);
      assert.deepEqual(selectLanes(['docs/a.md', path]), every, path);
    }
  });

  it('runs everything for inputs every lane shares, and for the selection itself', () => {
    for (const path of [
      'pnpm-lock.yaml',
      'package.json',
      'pnpm-workspace.yaml',
      'turbo.json',
      'tsconfig.base.json',
      'packages/config/tsconfig/base.json',
      'patches/x.patch',
      '.github/workflows/ci.yml',
      'scripts/ci-changed-jobs.mjs',
    ]) {
      assert.deepEqual(selectLanes([path]), every, path);
    }
  });
});

describe('docs-only', () => {
  it('runs nothing for paths no CI job reads', () => {
    assert.deepEqual(
      selectLanes([
        'docs/code-standards.md',
        'plans/x/plan.md',
        '.claude/rules/a.md',
        'apps/web/CLAUDE.md',
        'README.md',
        'benchmarks/punct/run.py',
      ]),
      only(),
    );
  });
});

describe('reads that cross a package boundary', () => {
  it('maps every file a spec reads from outside its package to the lane that runs it', () => {
    assert.ok(lanesFor('apps/extension/entrypoints/content/overlay.ts').includes('node')); // web#test
    assert.ok(lanesFor('apps/extension/public/fonts/a.woff2').includes('node')); // token-parity
    assert.ok(lanesFor('apps/web/app/globals.css').includes('node')); // ui#test
    assert.ok(lanesFor('packages/ui/src/react/slider.tsx').includes('node')); // web#test
    for (const path of ['.env.example', 'prod.env.example', 'docker-compose.yml']) {
      assert.ok(lanesFor(path).includes('node'), path); // api env.schema.spec
    }
    assert.ok(lanesFor('benchmarks/speaker-id/recorder/index.html').includes('node')); // web recorder-parity
    assert.ok(
      lanesFor('apps/api/src/modules/translate/audio/clause-splitter.cases.json').includes(
        'sidecar',
      ),
    );
    for (const path of ['.prettierrc.cjs', '.prettierignore', '.editorconfig']) {
      assert.deepEqual(selectLanes([path]), only('node'), path); // eslint-plugin-prettier
    }
  });
});

describe('per-lane selection', () => {
  it('selects each specialised lane from its own closure', () => {
    assert.deepEqual(selectLanes(['apps/web/src/a.tsx']), only('node'));
    assert.deepEqual(selectLanes(['apps/api/src/a.ts']), only('node', 'api'));
    assert.deepEqual(selectLanes(['apps/extension/src/a.ts']), only('node', 'extension'));
    assert.deepEqual(
      selectLanes(['packages/types/src/a.ts']),
      only('node', 'api', 'extension', 'itn', 'replay'),
    );
    assert.deepEqual(selectLanes(['packages/ai-providers/src/a.ts']), only('node', 'api', 'itn'));
    assert.deepEqual(
      selectLanes(['packages/realtime-client/src/a.ts']),
      only('node', 'extension', 'replay'),
    );
    assert.deepEqual(selectLanes(['packages/ui/src/a.tsx']), only('node', 'extension'));
    assert.deepEqual(selectLanes(['services/local-tts/app.py']), only('sidecar', 'replay'));
    assert.deepEqual(selectLanes(['services/local-stt/app.py']), only('stt'));
    assert.deepEqual(selectLanes(['benchmarks/stt/data/itn-roundtrip.jsonl']), only('itn'));
    assert.deepEqual(selectLanes(['benchmarks/realtime/generate-fixtures.mjs']), only('replay'));
  });
});
