// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A translate failure is a toast for as long as the screen that holds it is mounted,
 * and no longer: Retry on a toast over History would call an unmounted hook.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notify = vi.hoisted(() => ({ error: vi.fn(), dismiss: vi.fn() }));
vi.mock('@/lib/notify', () => ({ notify }));

const { useErrorToast } = await import('./use-error-toast');

function Screen({ message }: { message: string | null }) {
  useErrorToast('recording-failed', message, () => {});
  return null;
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  container.remove();
  vi.clearAllMocks();
});

describe('useErrorToast', () => {
  it('raises the toast, and takes it down when the message clears', () => {
    act(() => root.render(<Screen message="Recording failed" />));
    expect(notify.error).toHaveBeenCalledWith(
      'Recording failed',
      expect.objectContaining({ id: 'recording-failed' }),
    );
    act(() => root.render(<Screen message={null} />));
    expect(notify.dismiss).toHaveBeenCalledWith('recording-failed');
    act(() => root.unmount());
  });

  it('takes the toast down when the screen unmounts', () => {
    act(() => root.render(<Screen message="Recording failed" />));
    expect(notify.dismiss).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(notify.dismiss).toHaveBeenCalledWith('recording-failed');
  });

  it('dismisses nothing on unmount when no toast is up', () => {
    act(() => root.render(<Screen message={null} />));
    act(() => root.unmount());
    expect(notify.dismiss).not.toHaveBeenCalled();
  });

  it('does not take the toast down when only the message changes', () => {
    act(() => root.render(<Screen message="Recording failed" />));
    act(() => root.render(<Screen message="Save failed" />));
    expect(notify.dismiss).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenLastCalledWith('Save failed', expect.anything());
    act(() => root.unmount());
  });
});
