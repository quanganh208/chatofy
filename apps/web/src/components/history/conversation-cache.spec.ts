import { describe, expect, it, vi } from 'vitest';

/** The History layout's held conversations, and what a delete does to them. */

const getConversation = vi.hoisted(() => vi.fn<(id: string) => Promise<unknown>>());
vi.mock('@/clients/api-client', () => ({
  getConversation: (id: string) => getConversation(id),
  getMinutes: vi.fn(),
}));

const { createConversationCache } = await import('./conversation-cache');

const conversation = (id: string) => ({ conversationId: id, title: 'T', turns: [] }) as never;

describe('the conversation cache', () => {
  it('shares one request between callers and holds the answer', async () => {
    getConversation.mockResolvedValue({ conversation: conversation('c-1') });
    const cache = createConversationCache();
    const [a, b] = await Promise.all([cache.load('c-1'), cache.load('c-1')]);
    expect(a).toBe(b);
    expect(getConversation).toHaveBeenCalledTimes(1);
    expect(cache.peek('c-1')).toBe(a);
  });

  it('does not store a conversation deleted while its request was in flight', async () => {
    let answer: (value: unknown) => void = () => {};
    getConversation.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const cache = createConversationCache();
    const pending = cache.load('c-2');
    cache.forget('c-2');
    answer({ conversation: conversation('c-2') });
    await pending;

    expect(cache.peek('c-2')).toBeUndefined();
    expect(cache.isGone('c-2')).toBe(true);
    cache.remember(conversation('c-2'));
    expect(cache.peek('c-2'), 'remembered after its delete').toBeUndefined();
  });
});
