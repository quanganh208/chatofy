// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TopbarSlot, TopbarSlotProvider, TopbarSlotTarget } from './topbar-slot';

/**
 * The slot inverts the layout's one-way flow, so what is worth holding is that it
 * inverts only the DOM position.
 *
 * A control written inside the surface has to LEAVE the surface's column and appear in
 * the chrome, and it has to leave nothing behind — the gap between the theme toggle and
 * the sidebar trigger is real spacing, and an empty node parked there is a visible
 * defect nobody would trace back to a portal.
 *
 * The other half is the surfaces with no chrome at all: the auth frame, the two lab
 * routes, and any spec that mounts a panel on its own. There is no target in those, and
 * "no target" has to mean nothing rendered rather than a crash.
 */

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

function render(node: React.ReactNode) {
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
}

describe('TopbarSlot', () => {
  it('lands in the topbar and leaves the surface column empty', () => {
    render(
      <TopbarSlotProvider>
        <div id="bar">
          <TopbarSlotTarget />
        </div>
        <div id="column">
          <TopbarSlot>
            <button id="gear">gear</button>
          </TopbarSlot>
        </div>
      </TopbarSlotProvider>,
    );

    expect(container.querySelector('#bar #gear')).not.toBeNull();
    expect(container.querySelector('#column')?.innerHTML).toBe('');
  });

  it('renders nothing where there is no chrome to render into', () => {
    render(
      <TopbarSlot>
        <button id="gear">gear</button>
      </TopbarSlot>,
    );

    expect(container.querySelector('#gear')).toBeNull();
  });

  it('lets go of the node when the target unmounts', () => {
    function Frame({ withBar }: { withBar: boolean }) {
      return (
        <TopbarSlotProvider>
          {withBar ? <div id="bar">{<TopbarSlotTarget />}</div> : null}
          <TopbarSlot>
            <button id="gear">gear</button>
          </TopbarSlot>
        </TopbarSlotProvider>
      );
    }

    render(<Frame withBar />);
    expect(container.querySelector('#gear')).not.toBeNull();

    act(() => root?.render(<Frame withBar={false} />));
    expect(container.querySelector('#gear')).toBeNull();
  });
});
