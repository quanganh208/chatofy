import { describe, expect, it, vi } from 'vitest';
import { navItems } from '@/components/layout/nav-items';

vi.mock('@/config/server-env', () => ({ serverEnv: { WEB_BASE_URL: 'https://chatofy.example' } }));

/**
 * Every sidebar destination is signed-in only, so every one is disallowed.
 *
 * The list in `robots.ts` is written by hand and nothing tied it to the routes:
 * `/conference` shipped in the sidebar and stayed crawlable, where a crawler only
 * ever collects a redirect to `/login`.
 */
describe('robots.txt', () => {
  it('disallows every route the sidebar links to', async () => {
    const { default: robots } = await import('./robots');
    const rules = robots().rules;
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) =>
      Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : [],
    );
    for (const { href } of navItems()) expect(disallowed).toContain(href);
  });
});
