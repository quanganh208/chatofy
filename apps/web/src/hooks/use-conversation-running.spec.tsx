// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useConversationRunning, useReportConversationRunning } from './use-conversation-running';

/** The page reports, the Settings dialog reads; a withdrawn report clears it. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: boolean[] = [];
function Reader() {
  seen.push(useConversationRunning());
  return null;
}
function Reporter({ running }: { running: boolean }) {
  useReportConversationRunning(running);
  return null;
}

let root: Root;
const render = (node: React.ReactNode) => act(() => root.render(node));
const last = () => seen.at(-1);

beforeEach(() => {
  seen = [];
  root = createRoot(document.createElement('div'));
});
afterEach(() => act(() => root.unmount()));

describe('useConversationRunning', () => {
  it('reads false with no reporter, and follows a reporter on and off', () => {
    render(<Reader />);
    expect(last()).toBe(false);
    render(
      <>
        <Reader />
        <Reporter running />
      </>,
    );
    expect(last()).toBe(true);
    render(
      <>
        <Reader />
        <Reporter running={false} />
      </>,
    );
    expect(last()).toBe(false);
  });

  it('clears when a running reporter unmounts', () => {
    render(
      <>
        <Reader />
        <Reporter running />
      </>,
    );
    expect(last()).toBe(true);
    render(<Reader />);
    expect(last()).toBe(false);
  });

  it('stays running while any one of two reporters still runs', () => {
    render(
      <>
        <Reader />
        <Reporter key="a" running />
        <Reporter key="b" running />
      </>,
    );
    render(
      <>
        <Reader />
        <Reporter key="a" running />
      </>,
    );
    expect(last()).toBe(true);
  });
});
