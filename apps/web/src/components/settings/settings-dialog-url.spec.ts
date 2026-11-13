import { describe, expect, it } from 'vitest';
import {
  paneTabFor,
  readSettingsDialog,
  settingsDialogHref,
  withoutSettingsDialog,
} from './settings-dialog-url';

/** The `?settings=` contract every caller and the redirect table build through. */
const read = (search: string) => readSettingsDialog(new URLSearchParams(search));

describe('the settings dialog URL', () => {
  it('reads closed, the list, and a tab', () => {
    expect(read('')).toBeUndefined();
    expect(read('q=x')).toBeUndefined();
    expect(read('settings=billing')).toBe('billing');
    expect(read('settings=menu')).toBeNull();
    // A mangled or retired value still opens Settings, on the list.
    expect(read('settings=')).toBeNull();
    expect(read('settings=appearance')).toBeNull();
  });

  it('opens over the page without disturbing its own query or hash', () => {
    expect(
      settingsDialogHref('account', { pathname: '/history', search: '?q=hi', hash: '#x' }),
    ).toBe('/history?q=hi&settings=account#x');
    expect(settingsDialogHref(null, { pathname: '/glossary' })).toBe('/glossary?settings=menu');
    // Switching replaces the value rather than adding a second one.
    expect(settingsDialogHref('general', { pathname: '/g', search: 'settings=billing' })).toBe(
      '/g?settings=general',
    );
  });

  it("closes by removing its own parameters, Polar's checkout return among them", () => {
    expect(
      withoutSettingsDialog({
        pathname: '/translate/one-way',
        search: '?settings=billing&checkout=done&keep=1',
      }),
    ).toBe('/translate/one-way?keep=1');
    expect(withoutSettingsDialog({ pathname: '/history', search: '?settings=menu' })).toBe(
      '/history',
    );
  });

  it('renders the first tab in the pane for the list', () => {
    expect(paneTabFor(null)).toBe('general');
    expect(paneTabFor('billing')).toBe('billing');
  });
});
