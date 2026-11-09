import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { vi } from './vi.js';

/**
 * An empty state has to say what the thing is for and which control creates it.
 *
 * The baseline audit found the glossary saying only "No glossaries yet." beside a
 * blank pane, which tells a first-time user nothing about why they would want one.
 * Each locale names its own label for the create button so the sentence points at
 * something on screen.
 */
describe('empty-state guidance', () => {
  it('points the glossary empty state at the create button, in both locales', () => {
    expect(en['web.glossary.emptyList']).toContain(en['web.glossary.new']);
    expect(vi['web.glossary.emptyList']).toContain(vi['web.glossary.new']);
  });

  it('says what a glossary is for rather than only that there are none', () => {
    expect(en['web.glossary.emptyList'].length).toBeGreaterThan(40);
    expect(vi['web.glossary.emptyList'].length).toBeGreaterThan(40);
  });
});
