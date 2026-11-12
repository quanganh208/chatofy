// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingMinutes } from '@chatofy/types';
import { MinutesPanel } from './minutes-panel';
import { LocaleProvider } from '@/i18n/provider';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/notify', () => ({ notify }));

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

  it('keeps the readable minutes on screen when a regenerate fails', () => {
    render({ minutes: ready, error: true });
    expect(container.textContent).toContain('Could not generate minutes');
    expect(container.textContent).toContain('We agreed to ship.');
  });

  it('offers Regenerate once minutes exist', () => {
    render({ minutes: ready });
    expect(generateButton()?.textContent).toContain('Regenerate');
  });

  it('is a region on the page ground, not a card, named by its heading', () => {
    render({ minutes: ready });
    expect(container.querySelector('[data-slot^="card"]')).toBeNull();
    const section = container.querySelector('section');
    const heading = section?.querySelector('h2');
    expect(heading?.textContent).toBe('Meeting minutes');
    expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
    // The header row is set off from whatever sits above by a hairline.
    expect(section?.classList.contains('border-t')).toBe(true);
  });

  it('separates each group with a hairline and keeps its uppercase label', () => {
    render({ minutes: ready });
    const labels = Array.from(container.querySelectorAll('section p.uppercase'));
    expect(labels.map((label) => label.textContent)).toEqual([
      'Summary',
      'Key points',
      'Decisions',
      'Action items',
    ]);
    for (const label of labels) {
      expect(label.classList.contains('text-label')).toBe(true);
      expect(label.classList.contains('text-muted-foreground')).toBe(true);
      expect(label.parentElement?.classList.contains('border-t')).toBe(true);
      expect(label.parentElement?.classList.contains('border-hairline')).toBe(true);
    }
  });

  it('renders the title at the heading level the page asks for', () => {
    render({ titleAs: 'h3' });
    expect(container.querySelector('h2')).toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('Meeting minutes');
  });

  it('drops the visible title but keeps the accessible name when asked', () => {
    render({ minutes: ready, showTitle: false });
    const section = container.querySelector('section');
    expect(container.querySelector('h2, h3')).toBeNull();
    expect(section?.getAttribute('aria-label')).toBe('Meeting minutes');
    expect(section?.hasAttribute('aria-labelledby')).toBe(false);
    // The actions stay, the copy control and Regenerate both.
    expect(generateButton()?.textContent).toContain('Regenerate');
    expect(container.textContent).toContain('Copy');
    // Only the group labels and content remain as text; no "Meeting minutes".
    expect(container.textContent).not.toContain('Meeting minutes');
  });

  it('fills Generate only at the default emphasis', () => {
    render();
    expect(generateButton()?.getAttribute('data-variant')).toBe('default');
    render({ emphasis: 'quiet' });
    expect(generateButton()?.getAttribute('data-variant')).toBe('outline');
  });

  describe('copying', () => {
    const copyButton = () =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Copy');
    const writeText = vi.fn<(text: string) => Promise<void>>();
    beforeEach(() => {
      notify.success.mockClear();
      notify.error.mockClear();
      writeText.mockReset();
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
    });

    it('says a copy as a toast and keeps the button named for what it does', async () => {
      writeText.mockResolvedValue(undefined);
      render({ minutes: ready });
      await act(async () => {
        copyButton()?.click();
        await Promise.resolve();
      });
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('We agreed to ship.'));
      expect(notify.success).toHaveBeenCalledWith('Minutes copied', { id: 'minutes-copy' });
      expect(copyButton()).toBeDefined();
    });

    it('says a refused clipboard instead of failing silently', async () => {
      writeText.mockRejectedValue(new Error('denied'));
      render({ minutes: ready });
      await act(async () => {
        copyButton()?.click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(notify.success).not.toHaveBeenCalled();
      expect(notify.error).toHaveBeenCalledWith('The minutes could not be copied.', {
        id: 'minutes-copy',
      });
    });
  });
});
