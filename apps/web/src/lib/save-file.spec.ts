// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVOKE_AFTER_MS, saveBlob, textBlob } from './save-file';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saveBlob', () => {
  it('clicks a temporary link and revokes its URL a minute later, not at once', () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => 'blob:one');
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    saveBlob(new Blob(['x']), 'a.txt');
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]'), 'the link is removed').toBeNull();

    vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:one');
  });
});

describe('textBlob', () => {
  it('prefixes the UTF-8 byte-order mark only when asked', async () => {
    const bytes = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())].slice(0, 3);
    expect(await bytes(textBlob('ab', 'text/plain', true))).toEqual([0xef, 0xbb, 0xbf]);
    expect(await bytes(textBlob('ab', 'text/plain', false))).toEqual([0x61, 0x62]);
  });
});
