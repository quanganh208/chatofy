// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@chatofy/types';
import { LocaleProvider } from '@/i18n/provider';
import { ConversationMetaLine } from './conversation-meta-line';

let container: HTMLDivElement;
let root: Root;

const summary = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: '11111111-1111-4111-8111-111111111111',
  languages: ['vi', 'en'],
  startedAt: '2026-09-03T10:00:00.000Z',
  endedAt: '2026-09-03T10:10:00.000Z',
  turnCount: 12,
  preview: 'xin chào',
  hasMinutes: false,
  pausedMs: 0,
  title: null,
  kind: 'one-way',
  hasRecording: false,
  speakerCount: 0,
  speakers: [],
  ...overrides,
});

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function text(conversation: ConversationSummary, showTimeRange = false): string {
  act(() => {
    root.render(
      <LocaleProvider>
        <ConversationMetaLine conversation={conversation} showTimeRange={showTimeRange} />
      </LocaleProvider>,
    );
  });
  return container.textContent ?? '';
}

describe('ConversationMetaLine', () => {
  it('lets a speaker name with no spaces wrap instead of widening the page (D1)', () => {
    text(summary({ speakerCount: 1, speakers: ['A'.repeat(100)] }));
    const facts = [...container.querySelectorAll('p span')];
    const named = [...facts].reverse().find((el) => el.textContent?.includes('A'.repeat(100)));
    expect(named?.className).toContain('wrap-anywhere');
    expect(named?.className).toContain('min-w-0');
    expect(named?.parentElement?.className).toContain('min-w-0');
  });

  /** The kind fact as a screen reader hears it: the icon and the dot skipped. */
  const spoken = () => {
    const kind = container.querySelector('p > span')?.cloneNode(true) as Element | undefined;
    kind?.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
    return (kind?.textContent ?? '').replace(/\s+/g, ' ').trim();
  };

  it('names a two-way conversation both ways, with the two-way icon', () => {
    text(summary({ kind: 'two-way' }));
    expect(spoken()).toBe('Two-way Vietnamese and English');
    expect(container.querySelector('svg.lucide-arrow-left-right')).not.toBeNull();
  });

  it('names a one-way conversation source to target, with a one-way icon', () => {
    text(summary());
    expect(spoken()).toBe('One-way Vietnamese to English');
    expect(container.querySelector('svg.lucide-arrow-right')).not.toBeNull();
  });

  it('names an auto-detected conversation by its target', () => {
    text(summary({ kind: 'auto-detect', languages: ['en', 'vi', 'zh'] }));
    expect(spoken()).toBe('One-way Auto-detect to English');
  });

  it('draws the direction as an icon, never as an arrow character', () => {
    expect(text(summary({ kind: 'two-way' }))).not.toMatch(/[→⇄]/);
    expect(text(summary())).not.toMatch(/[→⇄]/);
  });

  it('never prints the short language codes', () => {
    expect(text(summary({ kind: 'two-way' }))).not.toMatch(/\bVI\b|\bEN\b/);
  });

  it('lists the named speakers with their count', () => {
    expect(text(summary({ speakerCount: 2, speakers: ['Lan', 'John'] }))).toContain(
      '2 speakers: Lan, John',
    );
  });

  it('counts speakers nobody named', () => {
    expect(text(summary({ speakerCount: 1 }))).toContain('1 speaker');
    expect(text(summary({ speakerCount: 3 }))).toContain('3 speakers');
  });

  it('says nothing about speakers when there were none', () => {
    expect(text(summary())).not.toContain('speaker');
  });

  it('marks a recording only when one exists', () => {
    expect(text(summary({ hasRecording: true }))).toContain('Recording');
    expect(text(summary())).not.toContain('Recording');
  });

  it('prints the time range only when asked', () => {
    expect(text(summary())).not.toContain('–');
    expect(text(summary(), true)).toContain('–');
  });
});
