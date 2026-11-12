// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The three verbs and the two promises they make: an error stays until dismissed, and
 * a repeated id replaces rather than stacks. Asserted on what reaches sonner, because
 * the timing and the replacement are sonner's once it has the right options.
 */
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@chatofy/ui/react', () => ({ toast }));

const { notify } = await import('./notify');

afterEach(() => {
  vi.clearAllMocks();
  document.documentElement.lang = '';
});

describe('notify', () => {
  it('says success with an Undo in the page language', () => {
    const undo = vi.fn();
    notify.success('Saved', { undo, id: 'autosave' });
    const call = toast.success.mock.calls[0] as unknown[] | undefined;
    expect(call?.[0]).toBe('Saved');
    expect(call?.[1]).toMatchObject({ id: 'autosave', action: { label: 'Undo', onClick: undo } });

    document.documentElement.lang = 'vi';
    notify.success('Đã lưu', { undo });
    expect(toast.success.mock.calls[1]?.[1]).toMatchObject({ action: { label: 'Hoàn tác' } });
  });

  it('keeps an error on screen until it is dismissed, with a Retry', () => {
    const retry = vi.fn();
    notify.error('Could not save', { retry });
    expect(toast.error.mock.calls[0]?.[1]).toMatchObject({
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      action: { label: 'Retry', onClick: retry },
    });
  });

  it('passes no id and no action when none was asked for', () => {
    notify.info('Copied');
    const options = toast.info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(options).not.toHaveProperty('id');
    expect(options).not.toHaveProperty('action');
  });

  it('reuses the id, so a repeat replaces the toast on screen', () => {
    notify.success('Saved', { id: 'autosave' });
    notify.success('Saved', { id: 'autosave' });
    expect(toast.success.mock.calls.map((call) => (call[1] as { id: string }).id)).toEqual([
      'autosave',
      'autosave',
    ]);
  });

  it('dismisses by id', () => {
    notify.dismiss('autosave');
    expect(toast.dismiss).toHaveBeenCalledWith('autosave');
  });
});
