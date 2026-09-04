// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseStreamingTranslate } from '@/hooks/use-streaming-translate';
import { accentFilledControls } from './accent-count';
import { elevatedSurfaces } from './surface-count';

/**
 * One accent-filled control per app screen, mechanically.
 *
 * `accent-budget.spec.tsx` next door holds the marketing page, where the unit is
 * the SECTION. Nothing held the app screens, and
 * `.claude/rules/development-rules.md` says exactly why that gap was left open —
 * "per viewport" is a visual fact — and what to do when it starts costing:
 * "a spec per screen, not a louder checklist".
 *
 * ## A screen is not a section: it has states
 *
 * A marketing section renders one way. An app screen renders differently before
 * you start, while it runs, and after it stops — and the accent budget can be
 * correct in two of those and wrong in the third, which is precisely the bug
 * recorded below. So the unit here is the screen-state pair.
 *
 * ## `KNOWN_VIOLATIONS` shrinks and never grows
 *
 * This spec ships with a violation already in it, because writing it green
 * against a screen that is about to be rebuilt would prove nothing: it could only
 * ever confirm the end state, never that the fix landed.
 *
 * The table is enforced in BOTH directions. A listed screen-state that no longer
 * violates fails as stale, so the phase that fixes one cannot forget to delete
 * its row — the suite says so. That is what keeps this from decaying into a list
 * of excuses nobody revisits.
 *
 * ## What this does not cover
 *
 * The mocked states only. An error state, a mid-save state, and every width are
 * outside it, the same way the marketing spec is honest about covering sections
 * rather than the composed page. Those stay review items.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const useStreamingTranslate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-streaming-translate', () => ({ useStreamingTranslate }));

const useConversationSave = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-conversation-save', () => ({ useConversationSave }));

// Typed so the factory does not hand `any` back into the component under test —
// an untyped mock silences the very type errors this file exists to notice.
const listConversations = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const getMe = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const listVoices = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
const getConversation = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
// `/translate` probes the service for its readiness banner. Resolving by default
// means the banner stays silent, which is the state these counts describe.
const checkHealth = vi.hoisted(() => vi.fn<() => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  listConversations: () => listConversations(),
  getMe: () => getMe(),
  listVoices: () => listVoices(),
  checkHealth: () => checkHealth(),
  getConversation: () => getConversation(),
  deleteConversation: vi.fn(),
}));

// The detail screen fetches minutes of its own. Its generate button is the one
// accent on that screen, and it renders whether or not minutes exist — so the
// hook is stubbed at "none yet" rather than mocked away.
vi.mock('@/hooks/use-minutes', () => ({
  // `reset` included: `cascade-panel.tsx` calls it from an effect, so a stub
  // missing it throws on every `/translate` row in this table rather than on the
  // one screen the mock was added for.
  useMinutes: () => ({
    minutes: null,
    loading: false,
    error: false,
    generate: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/history',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-auth/react', () => ({
  signOut: vi.fn(),
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

const { CascadePanel } = await import('@/components/translate/cascade-panel');
const { HistoryScreen } = await import('@/components/history/history-screen');
const { ConversationDetail } = await import('@/components/history/conversation-detail');
const { default: PreferencesPage } = await import('../../app/(app)/preferences/page');
const { default: AccountPage } = await import('../../app/(app)/account/page');
const { LocaleProvider } = await import('@/i18n/provider');
const { DEFAULT_TRANSLATE_SETTINGS } = await import('@/lib/translate-settings');

/** A conversation with one finished block, held at one identity. */
const oneTurn: UseStreamingTranslate['turns'] = [
  {
    id: 'seg-a',
    sessionId: 'a',
    speakerRole: 'speaker_a',
    direction: 'vi_to_en',
    sourceText: 'xin chào',
    targetText: 'hello',
    audioUrl: null,
    createdAt: '2026-09-03T00:00:00.000Z',
  },
];

function conversation(over: Partial<UseStreamingTranslate> = {}): UseStreamingTranslate {
  return {
    status: 'idle',
    turns: [],
    liveTurns: [],
    speakers: [],
    attributions: {},
    captures: {},
    displays: {},
    stats: {
      totalTurns: 0,
      confirmed: 0,
      automatic: 0,
      pending: 0,
      fallback: 0,
      tapRate: 0,
      suggestions: { confirmedMatching: 0, corrected: 0, unreviewed: 0 },
    },
    addSpeaker: vi.fn(),
    renameSpeaker: vi.fn(),
    removeSpeaker: vi.fn(),
    attributeTurn: vi.fn(),
    unattributeTurn: vi.fn(),
    echoHeard: 0,
    error: null,
    level: 0,
    conversationId: 'c-1',
    startedAt: '2026-09-03T00:00:00.000Z',
    start: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    ...over,
  };
}

const translate = () => (
  <CascadePanel settings={DEFAULT_TRANSLATE_SETTINGS} onChange={vi.fn()} getVolume={() => 1} />
);

/**
 * Every screen-state this spec holds, with the two counts it is allowed and the
 * `setup` that puts the mocks into the state the name describes.
 *
 * `surfaces` is the second rule that had no gate: **at most two elevated surfaces
 * per screen.** A card is for a thing you act on as a unit, and the redesign spent
 * most of its effort deleting cards that were not — a card per conversation row, a
 * card per settings concern, a card around a loading sentence. Counted here so the
 * grammar cannot creep back one card at a time.
 *
 * Zero is normal and correct. `/translate` is the whole screen, `/history` is a
 * list on the page ground; only the two records on a stored conversation and the
 * one settings panel each earn one.
 */
const SCREENS = [
  {
    name: '/translate — before anything starts',
    filled: 1,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(conversation());
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate,
  },
  {
    name: '/translate — running',
    filled: 0,
    surfaces: 0,
    setup() {
      useStreamingTranslate.mockReturnValue(conversation({ status: 'listening' }));
      useConversationSave.mockReturnValue({
        saved: false,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate,
  },
  {
    name: '/translate — ended, turns stored',
    filled: 1,
    surfaces: 1,
    setup() {
      useStreamingTranslate.mockReturnValue(conversation({ turns: oneTurn }));
      useConversationSave.mockReturnValue({
        saved: true,
        failure: null,
        saving: false,
        retry: vi.fn(),
      });
    },
    render: translate,
  },
  {
    // Zero, not one. The screen's filled "Start a conversation" was deleted: it
    // offered the same destination the sidebar's Translate entry does on every
    // app screen. The rule is a ceiling, so a screen may spend none of it.
    name: '/history',
    filled: 0,
    surfaces: 0,
    setup() {
      listConversations.mockResolvedValue({ conversations: [], nextCursor: null });
    },
    render: () => <HistoryScreen />,
  },
  {
    // The other half of the history criterion, and the half that had no gate: the
    // "exactly one accent here" claim lived only in a doc comment. One, and it is
    // the minutes generate button — back is ghost, delete is outline then
    // `destructive`, which fills with `live-fill` rather than the accent.
    name: '/history/[conversationId]',
    filled: 1,
    surfaces: 2,
    setup() {
      getConversation.mockResolvedValue({
        conversation: {
          conversationId: 'c-1',
          direction: 'vi_to_en',
          startedAt: '2026-09-03T12:00:00.000Z',
          endedAt: '2026-09-03T12:10:00.000Z',
          turnCount: 4,
          preview: 'xin chào',
          hasMinutes: false,
          turns: [
            {
              position: 0,
              speakerRole: 'speaker_a',
              speakerLabel: null,
              sourceText: 'xin chào',
              displayText: null,
              targetText: 'hello',
            },
          ],
        },
      });
    },
    render: () => <ConversationDetail conversationId="c-1" />,
  },
  {
    name: '/preferences',
    filled: 0,
    surfaces: 1,
    setup() {
      listVoices.mockResolvedValue({ voices: [] });
    },
    render: () => <PreferencesPage />,
  },
  {
    name: '/account',
    filled: 0,
    surfaces: 1,
    setup() {
      getMe.mockResolvedValue({
        id: 'u1',
        email: 'a@b.co',
        name: 'Quang Anh',
        createdAt: '2026-01-09T00:00:00.000Z',
      });
    },
    render: () => <AccountPage />,
  },
] as const;

/**
 * Screens that break the rule TODAY, with what clears each.
 *
 * **Empty, and that is the point.** It shipped holding one row: `/translate`
 * after a conversation ends drew Start and Generate at once, both filled. The
 * minutes panel now takes an emphasis, `/translate` asks for the quiet one, and
 * this table told the change to delete its own row — the spec fails a listed
 * screen that no longer violates, so the fix could not forget.
 *
 * A new row here is a deliberate, temporary admission, not a place to park one.
 */
const KNOWN_VIOLATIONS: Record<string, number> = {};

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  localStorage.clear();
  // Here rather than in each `setup()`: a screen that forgot it would get
  // `undefined` back from the factory and the banner's `.catch` would throw.
  checkHealth.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.clearAllMocks();
});

async function mount(element: React.ReactElement): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(<LocaleProvider>{element}</LocaleProvider>);
    await Promise.resolve();
  });
}

describe('the accent counter', () => {
  it('does not count a checked Switch, whose accent is a state variant', async () => {
    // `/preferences` renders the speak-aloud Switch and `voiceOutput` defaults to
    // true, so a CHECKED switch is on screen carrying
    // `data-[state=checked]:bg-primary` in its class attribute. The substring
    // selector this helper replaced counts that; `classList.contains` does not.
    // Without this test the helper could quietly regress to a substring match and
    // every screen with a switch would start failing for the wrong reason.
    listVoices.mockResolvedValue({ voices: [] });
    await mount(<PreferencesPage />);

    const variantAccent = container.querySelectorAll('[class*="bg-primary"]');
    expect(variantAccent.length, 'expected a checked Switch on this screen').toBeGreaterThan(0);
    expect(accentFilledControls(container).length).toBe(0);
  });
});

describe('the app accent budget', () => {
  it.each(SCREENS)('$name draws $filled accent-filled controls', async (screen) => {
    screen.setup();
    await mount(screen.render());

    expect(container.textContent?.length ?? 0, 'the screen rendered nothing').toBeGreaterThan(20);

    // At most two, and exactly the number this screen is supposed to draw — a
    // ceiling alone would let a screen quietly lose the surface it needs.
    //
    // Counted over the DOCUMENT, not the render container: popovers and dialogs
    // portal to `document.body`, so a card inside an open one is invisible to a
    // scoped count — which is the case most worth catching.
    const surfaces = elevatedSurfaces(document.body).length;
    expect(surfaces, `${screen.name} draws ${surfaces} elevated surfaces`).toBe(screen.surfaces);
    expect(surfaces).toBeLessThanOrEqual(2);

    const known = KNOWN_VIOLATIONS[screen.name];
    const actual = accentFilledControls(container).length;

    if (known === undefined) {
      expect(actual).toBe(screen.filled);
      return;
    }

    // A listed violation must STILL be violating. Fixed and still listed is a
    // failure, so the table cannot rot into a list of excuses: whoever fixes the
    // screen is told to delete its row.
    expect(
      actual,
      `${screen.name} is listed in KNOWN_VIOLATIONS but now draws ${actual} — delete its row`,
    ).toBe(known);
    expect(known).toBeGreaterThan(screen.filled);
  });
});
