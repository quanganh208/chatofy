// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeerState } from '@/hooks/use-conference';
import { ChatPanel } from './chat-panel';
import { ParticipantList } from './participant-list';

/**
 * Who is in the call, and what they said.
 *
 * The roster's glyphs carry meaning (who is muted), so they are named, not decorative; the
 * chat groups a sender's run of messages under one name and time and tells own from others.
 */
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const labels = {
  micOn: 'Microphone on',
  micOff: 'Microphone muted',
  camOn: 'Camera on',
  camOff: 'Camera off',
};

const peer = (displayName: string, muted: boolean, videoEnabled: boolean) =>
  ({ displayName, muted, videoEnabled }) as unknown as PeerState;

function roster(peers: Map<string, PeerState>) {
  act(() => {
    root.render(
      <ParticipantList
        selfName="Anh Minh"
        selfMuted={false}
        selfVideoEnabled
        selfLanguage="Vietnamese"
        selfLabel="You"
        peers={peers}
        rosterTitle="In this call"
        stateLabels={labels}
      />,
    );
  });
}

describe('ParticipantList', () => {
  it('counts everyone, self included', () => {
    roster(new Map([['a', peer('Bao Tran', false, true)]]));
    expect(container.querySelector('[data-slot="roster-count"]')?.textContent).toBe('2');
    expect(container.querySelectorAll('li').length).toBe(2);
  });

  it('shows initials discs and marks the viewer', () => {
    roster(new Map([['a', peer('Bao Tran', false, true)]]));
    const discs = [...container.querySelectorAll('[data-slot="roster-avatar"]')].map(
      (d) => d.textContent,
    );
    expect(discs).toEqual(['AM', 'BT']);
    expect(container.textContent).toContain('(You)');
    expect(container.textContent).toContain('Vietnamese');
  });

  it('names the mic and camera state of each person', () => {
    roster(new Map([['a', peer('Bao Tran', true, false)]]));
    const rows = [...container.querySelectorAll('li')];
    const names = (li: Element) =>
      [...li.querySelectorAll('[role="img"]')].map((n) => n.getAttribute('aria-label'));
    expect(names(rows[0]!)).toEqual(['Microphone on', 'Camera on']);
    expect(names(rows[1]!)).toEqual(['Microphone muted', 'Camera off']);
  });
});

const msg = (id: string, socketId: string, displayName: string, text: string, sentAt: number) =>
  ({ id, socketId, displayName, text, lang: 'en', sentAt }) as never;

function chat(messages: never[], extra: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  act(() => {
    root.render(
      <ChatPanel
        messages={messages}
        mySocketId="me"
        onSend={vi.fn()}
        title="Chat"
        inputPlaceholder="Type a message…"
        sendLabel="Send"
        emptyLabel="No messages yet."
        locale="en"
        {...extra}
      />,
    );
  });
}

describe('ChatPanel', () => {
  it('says what to do when empty, and what translation means here', () => {
    chat([], { emptyHint: 'Everyone reads messages in their own language.' });
    expect(container.textContent).toContain('No messages yet.');
    expect(container.textContent).toContain('Everyone reads messages in their own language.');
  });

  it('is a polite live log', () => {
    chat([]);
    expect(container.querySelector('[role="log"]')).not.toBeNull();
  });

  it('puts one name-and-time line over a run of messages from one sender', () => {
    const t0 = Date.UTC(2026, 10, 10, 9, 0, 0);
    chat([
      msg('1', 'bao', 'Bao Tran', 'Hello', t0),
      msg('2', 'bao', 'Bao Tran', 'Can you hear me?', t0 + 5_000),
      msg('3', 'me', 'Anh Minh', 'Yes', t0 + 10_000),
    ] as never[]);
    expect(container.querySelectorAll('time').length).toBe(2);
    expect(container.textContent).toContain('Bao Tran · ');
    // Own messages carry no name line, only the time.
    expect(container.textContent).not.toContain('Anh Minh');
  });

  it('starts a new group after a pause even for the same sender', () => {
    const t0 = Date.UTC(2026, 10, 10, 9, 0, 0);
    chat([
      msg('1', 'bao', 'Bao Tran', 'Hello', t0),
      msg('2', 'bao', 'Bao Tran', 'Still here', t0 + 5 * 60_000),
    ] as never[]);
    expect(container.querySelectorAll('time').length).toBe(2);
  });

  it('draws own messages on the right and others on the left', () => {
    const t0 = Date.UTC(2026, 10, 10, 9, 0, 0);
    chat([msg('1', 'bao', 'Bao Tran', 'Hi', t0), msg('2', 'me', 'Anh Minh', 'Hey', t0)] as never[]);
    const rows = [...container.querySelectorAll('[role="log"] > div')];
    expect(rows[0]?.className).toContain('items-start');
    expect(rows[1]?.className).toContain('items-end');
  });
});
