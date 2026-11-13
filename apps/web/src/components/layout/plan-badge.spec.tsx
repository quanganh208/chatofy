// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dawn } from '@chatofy/ui';

/**
 * The plan pill in the chrome: what it says per plan, that it says nothing while the
 * balance loads or after the read failed, that the sidebar's opens Settings › Billing
 * without being a button inside the account menu's button, that the rail's dawn dot is
 * Pro's alone — and that none of it spends the screen's one accent.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getCreditBalance = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  getCreditBalance: () => getCreditBalance(),
  getCheckoutOrder: vi.fn(),
  listCreditUsage: vi.fn(),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Quang Anh', email: 'a@b.co', image: null } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));
vi.mock('@/lib/sign-out', () => ({ signOutOfChatofy: vi.fn() }));

const { PRO_INK } = await import('./plan-badge');
const { SessionMenu } = await import('./session-menu');
const { MoreSheet } = await import('./more-sheet');
const { CreditLine } = await import('./credit-line');
const { balanceFixture } = await import('@/components/settings/credits.fixture');
const { LocaleProvider } = await import('@/i18n/provider');
const { SidebarMenu, SidebarProvider } = await import('@chatofy/ui/react');
const { accentFilledControls } = await import('@/design/accent-count');

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  window.history.replaceState(null, '', '/translate/one-way');
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  getCreditBalance.mockReset();
});

async function renderFooter(defaultOpen = true) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <LocaleProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <SidebarMenu>
            <SessionMenu detail={<CreditLine />} />
          </SidebarMenu>
        </SidebarProvider>
      </LocaleProvider>,
    );
    // The balance read settles on a microtask after mount.
    await Promise.resolve();
    await Promise.resolve();
  });
}

const badge = () => container.querySelector('[data-slot="plan-badge"]');
const dot = () => container.querySelector('[data-slot="plan-dot"]');
const trigger = () => container.querySelector('[aria-haspopup="menu"]');

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('the Pro pill ink', () => {
  it.each(Object.entries(dawn))('reads at 4.5:1 or better on the %s stop', (_, stop) => {
    const [hi, lo] = [luminance(PRO_INK), luminance(stop)].sort((a, b) => b - a) as [
      number,
      number,
    ];
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the sidebar footer plan pill', () => {
  it('says Free, quietly, on a Free account', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'free' }));
    await renderFooter();

    expect(badge()?.textContent).toBe('Free');
    expect(badge()?.getAttribute('data-variant')).toBe('outline');
    expect(badge()?.getAttribute('aria-label')).toBe('Plan: Free — open billing');
  });

  it('says Pro on the dawn ground on a Pro account', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'pro', proSource: 'polar' }));
    await renderFooter();

    const pill = badge() as HTMLElement | null;
    expect(pill?.textContent).toBe('Pro');
    expect(pill?.style.backgroundImage).toContain('linear-gradient');
  });

  it('shows nothing while the balance loads', async () => {
    getCreditBalance.mockReturnValue(new Promise(() => {}));
    await renderFooter();

    expect(badge()).toBeNull();
    expect(trigger()?.getAttribute('aria-label')).toBe('Account');
  });

  it('shows nothing when the balance read failed', async () => {
    getCreditBalance.mockRejectedValue(new Error('503'));
    await renderFooter();

    expect(badge()).toBeNull();
  });

  it('is a sibling of the account menu trigger, not a button inside it', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'pro' }));
    await renderFooter();

    expect(badge()?.tagName).toBe('BUTTON');
    expect(trigger()?.querySelector('button')).toBeNull();
    expect(trigger()?.contains(badge())).toBe(false);
  });

  it('opens Settings › Billing when pressed', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'free' }));
    await renderFooter();

    act(() => (badge() as HTMLButtonElement).click());

    expect(new URLSearchParams(window.location.search).get('settings')).toBe('billing');
  });

  it('spends no accent: a readout, not the screen action', async () => {
    for (const plan of ['free', 'pro'] as const) {
      getCreditBalance.mockResolvedValue(balanceFixture({ plan }));
      await renderFooter();
      expect(badge()).not.toBeNull();
      expect(accentFilledControls(document.body)).toHaveLength(0);
      act(() => root?.unmount());
      root = undefined;
    }
  });
});

describe('the collapsed rail', () => {
  it('marks a Pro avatar with the dawn dot and names the plan on the trigger', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'pro' }));
    await renderFooter(false);

    expect(dot()).not.toBeNull();
    expect(dot()?.getAttribute('aria-hidden')).toBe('true');
    expect(trigger()?.getAttribute('aria-label')).toBe('Account, Pro plan');
  });

  it('draws no dot for Free', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'free' }));
    await renderFooter(false);

    expect(dot()).toBeNull();
    expect(trigger()?.getAttribute('aria-label')).toBe('Account, Free plan');
  });
});

describe('the More sheet identity row', () => {
  it('carries the pill as text inside the row that opens Billing', async () => {
    getCreditBalance.mockResolvedValue(balanceFixture({ plan: 'pro' }));
    await act(async () => {
      root = createRoot(container);
      root.render(
        <LocaleProvider>
          <MoreSheet active={false} />
        </LocaleProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => (container.querySelector('button') as HTMLButtonElement).click());
    await act(async () => {
      await Promise.resolve();
    });

    const row = document.body.querySelector('[data-settings-tab="billing"]');
    const pill = row?.querySelector('[data-slot="plan-badge"]');
    expect(pill?.textContent).toBe('Pro');
    expect(pill?.tagName).toBe('SPAN');
  });
});
