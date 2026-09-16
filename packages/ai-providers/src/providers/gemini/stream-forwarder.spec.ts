import { describe, expect, it } from 'vitest';
import { StreamForwarder } from './stream-forwarder.js';

/** Collects what a caller would have been told, in order. */
function collect() {
  const calls: { delta: string; restart: boolean }[] = [];
  const forwarder = new StreamForwarder((delta, restart) => calls.push({ delta, restart }));
  return { forwarder, calls, joined: () => calls.map((c) => c.delta).join('') };
}

/** Feed accumulated text the way a stream would, one chunk at a time. */
function stream(forwarder: StreamForwarder, chunks: string[]) {
  let raw = '';
  for (const chunk of chunks) {
    raw += chunk;
    forwarder.push(raw);
  }
}

describe('StreamForwarder', () => {
  it('forwards each piece as it arrives', () => {
    const { forwarder, calls, joined } = collect();
    stream(forwarder, ['Xin ', 'chào ', 'các bạn']);
    expect(calls.map((c) => c.delta)).toEqual(['Xin ', 'chào ', 'các bạn']);
    expect(joined()).toBe('Xin chào các bạn');
  });

  it('marks only the first piece as a restart', () => {
    const { forwarder, calls } = collect();
    stream(forwarder, ['a', 'b', 'c']);
    expect(calls.map((c) => c.restart)).toEqual([true, false, false]);
  });

  it('never forwards a wrapper tag the model echoed', () => {
    const { forwarder, joined } = collect();
    stream(forwarder, ['<transcript>', 'Hello', '</transcript>']);
    expect(joined()).toBe('Hello');
  });

  it('holds back a tag split across chunks instead of showing half of it', () => {
    // The case that makes stripping per-chunk wrong: `</transcr` matches no
    // pattern yet, and once forwarded it could never be taken back.
    const { forwarder, joined } = collect();
    stream(forwarder, ['Hello</transcr', 'ipt>']);
    expect(joined()).toBe('Hello');
    expect(joined()).not.toContain('<');
  });

  it('holds back a tail that never closes rather than guessing', () => {
    const { forwarder, joined } = collect();
    stream(forwarder, ['Hello <', 'still open']);
    // The finished result carries the whole line, so waiting costs nothing.
    expect(joined()).toBe('Hello ');
  });

  it('says nothing when a chunk adds nothing', () => {
    const { forwarder, calls } = collect();
    stream(forwarder, ['Hello', '', '']);
    expect(calls).toHaveLength(1);
  });

  it('forwards nothing at all for a reply that is only a wrapper', () => {
    const { forwarder, calls } = collect();
    stream(forwarder, ['<transcript>', '</transcript>']);
    expect(calls).toHaveLength(0);
  });

  it('passes through a closed bracket pair that is not a wrapper tag', () => {
    // The hold-back keys on an UNCLOSED `<`, so a closed pair is ordinary text
    // and must survive. Otherwise the rule would quietly eat content.
    const { forwarder, joined } = collect();
    stream(forwarder, ['a <3> b']);
    expect(joined()).toBe('a <3> b');
  });
});
