'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

/**
 * A place in the topbar that the surface below can fill.
 *
 * The topbar is rendered by the layout, so it sits ABOVE every page in the tree and
 * receives nothing from them — the same constraint that made the route title come from
 * `NAV_ITEMS`. A title can be derived that way because a route name is a fact about the
 * route. A control cannot: `/translate`'s settings need the live settings object, the
 * volume writer that reaches the gain node, and whether a conversation is running, none
 * of which the chrome has or should have.
 *
 * So the direction is inverted with a portal. The topbar renders an empty node and the
 * surface renders THROUGH it, keeping its handlers, its state and its position in the
 * React tree exactly where they already are. Only the DOM position moves.
 *
 * ## Why a store rather than `useState` in a provider
 *
 * The obvious version holds the node in provider state and has the target set it in an
 * effect. That is a `setState` inside `useEffect` — the pattern the lint rules reject and
 * a second render on every mount, to publish a value that was never state: the node is
 * whatever React last handed the callback ref.
 *
 * This keeps it as exactly that. `mount` is a callback ref, so React writes the node
 * during commit and clears it on unmount; readers subscribe through
 * `useSyncExternalStore`, which re-reads after subscribing and so cannot miss a node that
 * committed first. The server snapshot is `null`, so nothing is portalled during SSR and
 * the first client render agrees with the markup it is hydrating.
 */

interface Slot {
  /** Callback ref for the topbar's own node. */
  mount: (element: HTMLElement | null) => void;
  subscribe: (listener: () => void) => () => void;
  read: () => HTMLElement | null;
}

function createSlot(): Slot {
  let element: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  return {
    mount(next) {
      element = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () => element,
  };
}

const TopbarSlotContext = React.createContext<Slot | null>(null);

/** Stable no-ops, so a consumer rendered outside the chrome does not resubscribe forever. */
const noSubscribe = () => () => {};
const noElement = () => null;

export function TopbarSlotProvider({ children }: { children: React.ReactNode }) {
  const [slot] = React.useState(createSlot);
  return <TopbarSlotContext.Provider value={slot}>{children}</TopbarSlotContext.Provider>;
}

/** The topbar's end of the slot: an empty node, and where whatever fills it lands. */
export function TopbarSlotTarget({ className }: { className?: string }) {
  const slot = React.useContext(TopbarSlotContext);
  return <div ref={slot?.mount} className={className} />;
}

/**
 * The surface's end. Renders nothing where it is written and everything in the topbar.
 *
 * Outside `AppChrome` — the auth frame, the lab routes, a spec that mounts a panel on its
 * own — there is no target, and this renders nothing rather than throwing. A surface that
 * has no chrome to put a control in genuinely has nowhere to put it.
 */
export function TopbarSlot({ children }: { children: React.ReactNode }) {
  const slot = React.useContext(TopbarSlotContext);
  const element = React.useSyncExternalStore(
    slot?.subscribe ?? noSubscribe,
    slot?.read ?? noElement,
    noElement,
  );
  return element ? createPortal(children, element) : null;
}
