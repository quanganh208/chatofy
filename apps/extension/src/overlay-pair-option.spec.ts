// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

/**
 * The overlay's language-pair options read "<source> into <target>". In
 * Vietnamese the option opens on the source name, which keeps its capital like
 * any label, while the target sits mid-sentence and is written in lower case.
 *
 * The extension picks its dictionary once, from the browser's languages, when
 * `src/i18n` loads, so the browser is set to Vietnamese before the overlay is
 * imported.
 */
describe('overlay language-pair options in Vietnamese', () => {
  it('capitalises the source name and lower-cases the target', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => Promise.resolve()) } });
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['vi-VN']);
    vi.resetModules();
    const { Overlay } = await import('../entrypoints/content/overlay');

    const spy = vi.spyOn(Element.prototype, 'attachShadow');
    new Overlay();
    const root = spy.mock.results[0]?.value as ShadowRoot;
    spy.mockRestore();

    const options = [...root.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toContain('Tiếng Việt sang tiếng Anh');
    expect(options).toContain('Tiếng Anh sang tiếng Việt');
    vi.unstubAllGlobals();
  });
});
