/**
 * A browser's error text is English whatever language the reader uses, so no
 * extension sentence about a browser failure may take it as a placeholder. The
 * sentences are picked by the kind of failure instead.
 */
import { describe, expect, it } from 'vitest';
import { en, type MessageKey } from './en.js';
import { vi } from './vi.js';
import { zh } from './zh.js';

const BROWSER_FAILURE_KEYS: MessageKey[] = [
  'extension.microphone.openFailed',
  'extension.microphone.notFound',
  'extension.microphone.inUse',
  'extension.error.preparePageFailed',
];

describe('extension sentences about a browser failure', () => {
  it.each(BROWSER_FAILURE_KEYS)(
    '%s is written in all three languages with no placeholder',
    (key) => {
      for (const messages of [en, vi, zh]) {
        const text = messages[key];
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text).not.toMatch(/\{\w+\}/);
      }
      expect(vi[key]).not.toBe(en[key]);
      expect(zh[key]).not.toBe(en[key]);
    },
  );
});
