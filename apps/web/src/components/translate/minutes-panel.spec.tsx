// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingMinutes } from '@chatofy/types';
import { MinutesPanel } from './minutes-panel';
import { LocaleProvider } from '@/i18n/provider';

const ready: MeetingMinutes = {
  conversationId: 'c1',
  status: 'ready',
  summary: 'We agreed to ship.',
  keyPoints: ['scope locked'],
  decisions: ['ship on Friday'],
  actionItems: [{ id: 'a1', description: 'cut the branch', owner: 'An', dueDate: 'Friday' }],
  generatedAt: '2026-08-30T00:00:00.000Z',
  model: 'gemini-3.5-flash',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: Partial<Parameters<typeof MinutesPanel>[0]> = {}) => {
  const onGenerate = vi.fn();
  act(() => {
    root.render(
      <LocaleProvider>
        <MinutesPanel
          minutes={null}
          loading={false}
          error={false}
          canGenerate
          onGenerate={onGenerate}
          {...props}
        />
      </LocaleProvider>,
    );
  });
  return { onGenerate };
};

const generateButton = () =>
  Array.from(container.querySelectorAll('button')).find((b) =>
    /Generate|Regenerate/.test(b.textContent ?? ''),
  );

describe('MinutesPanel', () => {
  it('renders summary, key points, decisions and action items when ready', () => {
    render({ minutes: ready });
    const text = container.textContent ?? '';
    expect(text).toContain('We agreed to ship.');
    expect(text).toContain('scope locked');
    expect(text).toContain('ship on Friday');
    expect(text).toContain('cut the branch');
    expect(text).toContain('An'); // owner badge
    expect(text).toContain('Friday'); // due badge
  });

  it('prompts to converse first and disables generate when there is nothing to summarize', () => {
    render({ canGenerate: false });
    expect(container.textContent).toContain('nothing to summarize');
    expect(generateButton()?.disabled).toBe(true);
  });

  it('calls onGenerate when the button is clicked', () => {
    const { onGenerate } = render({ canGenerate: true });
    act(() => {
      generateButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('shows a generating state and disables the button while loading', () => {
    render({ loading: true });
    expect(container.textContent).toContain('Summarizing');
    expect(generateButton()?.disabled).toBe(true);
  });

  it('shows a failure message on error', () => {
    render({ error: true });
    expect(container.textContent).toContain('Could not generate minutes');
  });

  it('offers Regenerate once minutes exist', () => {
    render({ minutes: ready });
    expect(generateButton()?.textContent).toContain('Regenerate');
  });
});
