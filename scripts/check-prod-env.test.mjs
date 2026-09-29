import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { diffEnvKeys, liveKeys, optionalKeys } from './check-prod-env.mjs';

const SCRIPT = fileURLToPath(new URL('./check-prod-env.mjs', import.meta.url));

const EXAMPLE = [
  '# a comment that mentions FOO=bar in prose is not a key',
  'DATABASE_URL=',
  'export AUTH_JWT_SECRET=',
  '',
  '# AI_STT_PROVIDER=local',
  '#   INDENTED_EXAMPLE=key-a,key-b',
].join('\n');

describe('key parsing', () => {
  it('reads live keys, with or without export, and skips comments and blanks', () => {
    assert.deepEqual([...liveKeys('# X=1\n\nA=1\nexport B=2\n  C = 3\n')].sort(), ['A', 'B', 'C']);
  });

  it('reads only `# KEY=` lines as optional keys, not indented prose', () => {
    assert.deepEqual([...optionalKeys(EXAMPLE)], ['AI_STT_PROVIDER']);
  });
});

describe('diffEnvKeys', () => {
  it('reports nothing for a matching file, optional keys included', () => {
    const prod = 'DATABASE_URL=x\nAUTH_JWT_SECRET=y\nAI_STT_PROVIDER=local\n';
    assert.deepEqual(diffEnvKeys(prod, EXAMPLE), { missing: [], unknown: [] });
  });

  it('reports required keys that are absent', () => {
    assert.deepEqual(diffEnvKeys('DATABASE_URL=x\n', EXAMPLE), {
      missing: ['AUTH_JWT_SECRET'],
      unknown: [],
    });
  });

  it('reports keys the example does not list', () => {
    const prod = 'DATABASE_URL=x\nAUTH_JWT_SECRET=y\nAUTH_URL=z\n';
    assert.deepEqual(diffEnvKeys(prod, EXAMPLE), {
      missing: [],
      unknown: ['AUTH_URL'],
    });
  });
});

describe('command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-prod-env-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const example = join(dir, 'prod.env.example');
  writeFileSync(example, EXAMPLE);

  const run = (prodText) => {
    const prod = join(dir, 'prod.env');
    writeFileSync(prod, prodText);
    return spawnSync('node', [SCRIPT, prod, '--example', example], {
      encoding: 'utf8',
    });
  };

  it('exits 0 with a one-line summary when the files agree', () => {
    const result = run('DATABASE_URL=x\nAUTH_JWT_SECRET=y\n');
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim().split('\n').length, 1);
  });

  it('exits 1 on drift and never prints a value', () => {
    const result = run('DATABASE_URL=hunter2\nSTALE_KEY=hunter3\n');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AUTH_JWT_SECRET/);
    assert.match(result.stderr, /STALE_KEY/);
    assert.doesNotMatch(result.stdout + result.stderr, /hunter/);
  });

  it('exits 1 when a file cannot be read', () => {
    const result = spawnSync('node', [SCRIPT, join(dir, 'nope.env')], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
  });
});
