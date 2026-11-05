import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  asksTwoWay,
  isValidPair,
  normalizePair,
  sourceChoices,
  storedLanguages,
  swapPair,
  withSource,
  withTarget,
} from './translate-mode.ts';

describe('asksTwoWay', () => {
  it('asks for two-way on a named vi↔en pair, either way round', () => {
    assert.equal(asksTwoWay({ source: 'vi', target: 'en' }), true);
    assert.equal(asksTwoWay({ source: 'en', target: 'vi' }), true);
  });

  it('stays one-way for Auto-detect and for pairs with Chinese', () => {
    assert.equal(asksTwoWay({ source: 'detect', target: 'en' }), false);
    assert.equal(asksTwoWay({ source: 'vi', target: 'zh' }), false);
    assert.equal(asksTwoWay({ source: 'zh', target: 'en' }), false);
  });
});

describe('sourceChoices', () => {
  it('offers Auto-detect only where the target can be identified against', () => {
    assert.deepEqual(sourceChoices('en'), ['vi', 'zh', 'detect']);
    assert.deepEqual(sourceChoices('vi'), ['en', 'zh', 'detect']);
    // Chinese output: turns are identified as vi or en and translated into zh.
    assert.ok(sourceChoices('zh').includes('detect'));
  });

  it('never offers the target as a source', () => {
    for (const target of ['vi', 'en', 'zh'] as const) {
      assert.ok(!sourceChoices(target).includes(target));
    }
  });
});

describe('picking', () => {
  it('keeps the target when a source is picked', () => {
    assert.deepEqual(withSource({ source: 'vi', target: 'en' }, 'detect'), {
      source: 'detect',
      target: 'en',
    });
  });

  it('swaps when the target picked is the current source', () => {
    assert.deepEqual(withTarget({ source: 'vi', target: 'en' }, 'vi'), {
      source: 'en',
      target: 'vi',
    });
  });

  it('repairs an Auto-detect source that the new target cannot hold, and never yields a same-language pair', () => {
    for (const source of ['vi', 'en', 'zh', 'detect'] as const) {
      for (const target of ['vi', 'en', 'zh'] as const) {
        const next = withTarget(
          { source: source === target ? 'vi' : source, target: 'en' },
          target,
        );
        assert.ok(isValidPair(next), JSON.stringify(next));
      }
    }
  });
});

describe('swapPair', () => {
  it('exchanges the sides of a named pair and refuses Auto-detect', () => {
    assert.deepEqual(swapPair({ source: 'vi', target: 'en' }), { source: 'en', target: 'vi' });
    assert.equal(swapPair({ source: 'detect', target: 'en' }), null);
  });
});

describe('normalizePair', () => {
  it('repairs a stored pair that names one language twice', () => {
    const fixed = normalizePair({ source: 'en', target: 'en' });
    assert.ok(isValidPair(fixed));
    assert.equal(fixed.target, 'en');
  });
});

describe('storedLanguages', () => {
  it('stores a named pair source first, and an auto-detected one with the whole registry', () => {
    assert.deepEqual(storedLanguages({ source: 'vi', target: 'en' }), ['vi', 'en']);
    const detected = storedLanguages({ source: 'detect', target: 'en' });
    assert.equal(detected[0], 'en');
    assert.ok(detected.length > 2);
  });
});
