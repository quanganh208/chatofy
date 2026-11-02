import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compare, render } from './compare-answer-prompts.mjs';

const call = (purpose, h, ok = 1) =>
  `[LlmCall] llm kind=translate purpose=${purpose} host=deepseek model=m ms=1 ok=${ok} in=1 out=1 cached=- h=${h}`;

test('counts an arm final as covered when the baseline sent that prompt as a final or a guess', () => {
  const baseline = [
    call('final', 'aaaaaaaa'),
    call('speculation', 'bbbbbbbb'),
    call('block', 'cccccccc'),
  ].join('\n');
  const arm = [
    call('final', 'aaaaaaaa'),
    call('final', 'bbbbbbbb'),
    call('final', 'dddddddd'),
    call('final', 'eeeeeeee', 0),
    call('block', 'cccccccc'),
    call('live', 'aaaaaaaa'),
  ].join('\n');

  const result = compare([baseline], [arm]);

  assert.deepEqual(result.arm, [{ hit: 2, total: 3 }]);
  assert.deepEqual(result.armBlocks, [{ hit: 1, total: 1 }]);
  assert.match(
    render(result),
    /\| arm-1 vs all baselines \| 66\.7% \(2\/3\) \| 100\.0% \(1\/1\) \|/,
  );
});
