import { describe, expect, it } from 'vitest';
import { ConversationContext } from './conversation-context';
import type { StreamSocket } from './stream-socket';

/**
 * The per-connection transcript history a fragment is translated against.
 *
 * These pin the three properties the prompt depends on and the socket cannot
 * see: the list is per connection and never leaks between them, it is bounded,
 * and what a caller receives is a copy — a turn that finishes while another is
 * in flight must not rewrite the history that in-flight prompt was built from.
 */

/** A socket is only ever used as a map key here, so it needs no behaviour. */
const socket = (): StreamSocket => ({ send: () => {} });

describe('ConversationContext', () => {
  it('starts empty for a connection that has said nothing', () => {
    expect(new ConversationContext().recall(socket())).toEqual([]);
  });

  it('returns finished utterances oldest first', () => {
    const context = new ConversationContext();
    const client = socket();
    context.remember(client, 'Nhưng mà cái mục tiêu mà tôi muốn làm thì');
    context.remember(client, 'Thì nó');
    expect(context.recall(client)).toEqual([
      'Nhưng mà cái mục tiêu mà tôi muốn làm thì',
      'Thì nó',
    ]);
  });

  it('keeps the last four and forgets what came before', () => {
    const context = new ConversationContext();
    const client = socket();
    for (const text of ['a', 'b', 'c', 'd', 'e', 'f']) {
      context.remember(client, text);
    }
    expect(context.recall(client)).toEqual(['c', 'd', 'e', 'f']);
  });

  it('never carries one connection’s speech into another', () => {
    // `/ws/translate` takes no authentication, so two conversations are only
    // ever separated by the key, and the key is the socket object itself.
    const context = new ConversationContext();
    const mine = socket();
    const theirs = socket();
    context.remember(mine, 'Tôi đề ra');
    expect(context.recall(theirs)).toEqual([]);
  });

  it('ignores a turn that produced no text', () => {
    const context = new ConversationContext();
    const client = socket();
    context.remember(client, '   ');
    context.remember(client, '');
    expect(context.recall(client)).toEqual([]);
  });

  it('hands out a copy, so a later turn cannot rewrite an in-flight prompt', () => {
    // Several turns run at once. One that finishes while another is being
    // translated must not change the list the second one was built from.
    const context = new ConversationContext();
    const client = socket();
    context.remember(client, 'Thì thì tôi nghĩ là thì');
    const inFlight = context.recall(client);
    context.remember(client, 'Đấy');
    expect(inFlight).toEqual(['Thì thì tôi nghĩ là thì']);
  });

  it('answers a waiter for a split turn with the piece that reaches the cut', async () => {
    // A split turn records each piece under the turn's own id, in order, and
    // only the last one reaches the cut. A continuation already waiting on
    // that turn must get that piece, not the other speaker's opening one —
    // the same answer it would have read had it asked a moment later.
    const context = new ConversationContext();
    const client = socket();
    const waiting = context.textOf(client, 'turn-a', 1_500);
    context.remember(client, 'first piece other speaker', 'turn-a');
    context.remember(client, 'last piece reaching the cut', 'turn-a');

    await expect(waiting).resolves.toBe('last piece reaching the cut');
    expect(context.settledText(client, 'turn-a')).toEqual({
      text: 'last piece reaching the cut',
    });
  });

  it('drops a connection’s history when it goes away', () => {
    const context = new ConversationContext();
    const client = socket();
    context.remember(client, 'Đấy');
    context.forget(client);
    expect(context.recall(client)).toEqual([]);
  });
});

describe('learned spellings', () => {
  const socket = {} as StreamSocket;

  it('keeps the newest 48 and moves a re-learned span to the newest end', () => {
    const context = new ConversationContext();
    for (let i = 0; i < 50; i++)
      context.learnSpellings(socket, { [`span${i}`]: `Term${i}` });
    context.learnSpellings(socket, { span2: 'Term2' });

    const terms = context.learnedTerms(socket);
    expect(terms).toHaveLength(48);
    expect(terms).not.toContain('Term0');
    expect(terms.at(-1)).toBe('Term2');
  });

  it('forgets them with the connection', () => {
    const context = new ConversationContext();
    context.learnSpellings(socket, { 'deep fred': 'deepfake' });
    context.forget(socket);
    expect(context.learnedTerms(socket)).toEqual([]);
  });
});
