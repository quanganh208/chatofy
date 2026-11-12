import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Content pages use the window instead of one column and two margins of nothing.
 *
 * Every page below the topbar sat in a 672px column centred in a 1184px workspace: about
 * 280px of empty ground each side at 1440px. The headed pages are now measured to
 * `max-w-6xl` and lay their content out in columns from `lg` or `xl`. happy-dom has no box
 * model, so this holds the classes; the 1440px screenshots are the real check.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('wide layouts', () => {
  it('measures headed pages for columns', () => {
    expect(read('../components/layout/measures.ts')).toContain("page: 'max-w-6xl'");
  });

  it('lays History out as a list beside the open conversation from a 64rem content width', () => {
    // A container query, not a viewport one: a collapsed sidebar gives the content
    // more room at the same window size, and the panes should use it.
    expect(read('../components/history/history-master-detail.tsx')).toContain('@container');
    expect(read('../components/history/history-list-pane.tsx')).toContain(
      '@5xl:w-(--history-list-width)',
    );
    // Rows in one column — the two-column grid of cards is what this replaced.
    expect(read('../components/history/history-list.tsx')).not.toContain('grid-cols-2');
  });

  it('lays Account out in two columns from lg, with the identity across both', () => {
    const src = read('../components/account/account-screen.tsx');
    expect(src).toContain('lg:grid-cols-2');
    expect(src).toContain('lg:col-span-2');
  });

  it('gives sign-out a card of its own beside Security instead of a loose button', () => {
    const src = read('../components/account/account-screen.tsx');
    expect(src).toContain("t('web.account.session')");
    expect(src).toContain('sign-out-account');
  });

  it('measures the conference landing for its hero', () => {
    const src = read('../components/layout/app-chrome.tsx');
    expect(src).toContain('FULL_PAGE_ROUTES');
    expect(src).toContain("'/conference'");
  });

  it('lays Preferences out in two columns from xl', () => {
    // Columns that flow, not grid rows: a short section beside a tall one left a hole.
    expect(read('../../app/(app)/preferences/page.tsx')).toContain('xl:columns-2');
  });

  it('lets the glossary panel align with the page header instead of bleeding past it', () => {
    expect(read('../components/glossary/glossary-page-content.tsx')).not.toContain('-mx-6');
  });

  it('opens the conference landing as a two-column hero with the lotus beside the actions', () => {
    const src = read('../../app/(app)/conference/page.tsx');
    expect(src).toContain('lg:grid-cols-');
    expect(src).toContain('LotusIllustration');
  });
});
