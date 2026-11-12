'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

/**
 * What a page may hand up to the frame around it, and nothing else.
 *
 * A layout receives nothing from the page below it, so three things a page knows and
 * the frame draws travel through this context:
 *
 * - **a trailing crumb** — the topbar's breadcrumb ends on the page's `<h1>`, and on a
 *   page about one thing (a stored conversation) that thing's name is the heading, not
 *   the nav item's. Text only: a heading is words, and passing a string keeps the
 *   page's own providers out of the topbar's tree.
 * - **page actions** — controls that belong to the screen but sit at the right of the
 *   topbar. These are portalled, so they keep the page's React context and state; the
 *   topbar owns only the box they land in.
 * - **immersion** — a screen that wants the whole viewport while it is busy (the
 *   translator while it listens) asks the mobile tab bar to step aside.
 *
 * Every hook here is a no-op outside the provider, so a screen rendered in a spec
 * without the chrome behaves exactly as it does inside it, minus the frame.
 */
interface ChromeSlots {
  trailingCrumb: string | null;
  setTrailingCrumb: (owner: symbol, title: string | null) => void;
  actionsTarget: HTMLElement | null;
  setActionsTarget: (node: HTMLElement | null) => void;
  immersive: boolean;
  setImmersive: (owner: symbol, active: boolean) => void;
}

const ChromeSlotsContext = React.createContext<ChromeSlots | null>(null);

/** Owner-keyed so the last mounted claimant wins and an unmount clears only its own claim. */
function useOwnedValues<T>() {
  const [entries, setEntries] = React.useState<ReadonlyArray<[symbol, T]>>([]);
  const set = React.useCallback((owner: symbol, value: T | null) => {
    setEntries((current) => {
      const rest = current.filter(([key]) => key !== owner);
      return value === null ? rest : [...rest, [owner, value]];
    });
  }, []);
  return [entries, set] as const;
}

export function ChromeSlotsProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumb] = useOwnedValues<string>();
  const [immersions, setImmersion] = useOwnedValues<true>();
  const [actionsTarget, setActionsTarget] = React.useState<HTMLElement | null>(null);
  // Stable, or every claim would hand consumers a new setter, re-run their effects
  // (release, claim again) and loop.
  const setImmersive = React.useCallback(
    (owner: symbol, active: boolean) => setImmersion(owner, active ? true : null),
    [setImmersion],
  );

  const value = React.useMemo<ChromeSlots>(
    () => ({
      trailingCrumb: crumbs.at(-1)?.[1] ?? null,
      setTrailingCrumb: setCrumb,
      actionsTarget,
      setActionsTarget,
      immersive: immersions.length > 0,
      setImmersive,
    }),
    [crumbs, setCrumb, actionsTarget, immersions, setImmersive],
  );

  return <ChromeSlotsContext.Provider value={value}>{children}</ChromeSlotsContext.Provider>;
}

/** For the chrome's own parts (topbar, tab bar). Pages use the components below. */
export function useChromeSlots(): ChromeSlots | null {
  return React.useContext(ChromeSlotsContext);
}

/**
 * Appends a crumb to the topbar breadcrumb; it becomes the page's `<h1>` and the nav
 * item before it becomes a link back. Renders nothing where it is placed.
 *
 * @example <TopbarCrumb>{conversation.title}</TopbarCrumb>
 */
export function TopbarCrumb({ children }: { children: string }) {
  const slots = useChromeSlots();
  const [owner] = React.useState(() => Symbol('topbar-crumb'));
  const set = slots?.setTrailingCrumb;
  React.useLayoutEffect(() => {
    if (!set) return;
    set(owner, children);
    return () => set(owner, null);
  }, [set, owner, children]);
  return null;
}

/**
 * Renders its children at the right of the topbar, keeping the page's context and state.
 * Outside the chrome (a spec rendering the screen alone) it renders nothing.
 *
 * @example <TopbarActions><Button variant="outline">Rename</Button></TopbarActions>
 */
export function TopbarActions({ children }: { children: React.ReactNode }) {
  const target = useChromeSlots()?.actionsTarget;
  return target ? createPortal(children, target) : null;
}

/**
 * Asks the frame to hide the mobile tab bar while `active` is true — for a screen that
 * needs the whole phone while it works (the translator while it listens). Released on
 * unmount, so a screen that navigates away mid-session cannot leave the bar hidden.
 */
export function useImmersiveChrome(active: boolean): void {
  const set = useChromeSlots()?.setImmersive;
  const [owner] = React.useState(() => Symbol('immersive-chrome'));
  React.useEffect(() => {
    if (!set) return;
    set(owner, active);
    return () => set(owner, false);
  }, [set, owner, active]);
}
