import type { SessionOptions } from '@chatofy/types';
import { SessionRegistry } from './session-registry';
import type { StreamSocket } from './stream-socket';
import { TurnSession } from './turn-session';

/**
 * The registry is where every piece of fire-and-forget work on this path checks
 * whether it may still write. It has never had a spec, and until now it could not
 * have had a meaningful one: with a single turn per socket, `holds` could be
 * implemented as "does this socket have a turn at all" and no test would notice.
 *
 * That reading is wrong the moment two turns coexist, and wrong silently — a
 * finished turn's answer would be written into a socket whose current turn is a
 * different one. These tests pin the semantics that make the difference visible
 * before the map underneath them changes shape.
 */

const options: SessionOptions = {
  direction: 'vi_to_en',
  voiceGender: 'female',
};

/** A socket is only ever used as a map key here, so it needs no behaviour. */
const socket = (): StreamSocket => ({ send: () => {} });

const turn = (turnId?: string) => new TurnSession(options, turnId);

describe('SessionRegistry', () => {
  describe('holds', () => {
    // The whole point. "Is this still the turn I started on" is not the same
    // question as "does this socket have a turn", and only the first one is safe
    // to write on.
    it('answers for the turn asked about, not for the socket', () => {
      const registry = new SessionRegistry();
      const client = socket();
      const a = turn('a');
      const b = turn('b');
      registry.open(client, a);
      registry.open(client, b);

      registry.close(client, a.sessionId);

      expect(registry.holds(client, a)).toBe(false);
      expect(registry.holds(client, b)).toBe(true);
    });

    it('refuses a turn that belongs to another socket', () => {
      const registry = new SessionRegistry();
      const one = socket();
      const two = socket();
      const a = turn('a');
      registry.open(one, a);

      expect(registry.holds(one, a)).toBe(true);
      expect(registry.holds(two, a)).toBe(false);
    });

    it('refuses every turn of a socket that went away', () => {
      const registry = new SessionRegistry();
      const client = socket();
      const a = turn('a');
      const b = turn('b');
      registry.open(client, a);
      registry.open(client, b);

      registry.closeAll(client);

      expect(registry.holds(client, a)).toBe(false);
      expect(registry.holds(client, b)).toBe(false);
    });
  });

  describe('get', () => {
    it('finds a turn by its own id', () => {
      const registry = new SessionRegistry();
      const client = socket();
      const a = turn('a');
      const b = turn('b');
      registry.open(client, a);
      registry.open(client, b);

      expect(registry.get(client, a.sessionId)).toBe(a);
      expect(registry.get(client, b.sessionId)).toBe(b);
    });

    // A turn id is not a capability. Two clients must not be able to reach each
    // other's turns by guessing, on an endpoint that takes no authentication.
    it('will not reach a turn through the wrong socket', () => {
      const registry = new SessionRegistry();
      const one = socket();
      const two = socket();
      const a = turn('a');
      registry.open(one, a);

      expect(registry.get(two, a.sessionId)).toBeUndefined();
    });

    it('returns nothing for an id that was never opened', () => {
      const registry = new SessionRegistry();
      const client = socket();
      registry.open(client, turn('a'));

      expect(registry.get(client, 'not-a-session')).toBeUndefined();
    });
  });

  describe('only', () => {
    // The fallback for a client that sends no session id, which the contract
    // permits so a tab loaded before the field existed keeps working.
    it('names the socket’s turn when there is exactly one', () => {
      const registry = new SessionRegistry();
      const client = socket();
      const a = turn('a');
      registry.open(client, a);

      expect(registry.only(client)).toBe(a);
    });

    // Guessing here would route audio into the wrong turn and corrupt an
    // utterance without reporting anything. Refusing is the safe answer, and a
    // client that opens concurrent turns always sends the id.
    it('refuses to guess when the socket has several turns', () => {
      const registry = new SessionRegistry();
      const client = socket();
      registry.open(client, turn('a'));
      registry.open(client, turn('b'));

      expect(registry.only(client)).toBeUndefined();
    });

    it('returns nothing for a socket with no turn', () => {
      expect(new SessionRegistry().only(socket())).toBeUndefined();
    });
  });

  describe('counting', () => {
    it('counts per socket and across the process', () => {
      const registry = new SessionRegistry();
      const one = socket();
      const two = socket();
      registry.open(one, turn('a'));
      registry.open(one, turn('b'));
      registry.open(two, turn('c'));

      expect(registry.count(one)).toBe(2);
      expect(registry.count(two)).toBe(1);
      expect(registry.countGlobal()).toBe(3);
    });

    // The global count is the one that guards the sidecar, which is a single
    // shared process. A per-socket ceiling cannot see across sockets at all.
    it('drops closed turns out of both counts', () => {
      const registry = new SessionRegistry();
      const client = socket();
      const a = turn('a');
      registry.open(client, a);
      registry.open(client, turn('b'));

      registry.close(client, a.sessionId);

      expect(registry.count(client)).toBe(1);
      expect(registry.countGlobal()).toBe(1);
    });

    // A socket entry left behind after its last turn closed would leak one map
    // entry per connection for the lifetime of the process, on an endpoint that
    // takes no authentication.
    it('forgets a socket once its last turn closes', () => {
      const registry = new SessionRegistry();
      const client = socket();
      const a = turn('a');
      registry.open(client, a);

      registry.close(client, a.sessionId);

      expect(registry.count(client)).toBe(0);
      expect(registry.countGlobal()).toBe(0);
      expect(registry.trackedSockets).toBe(0);
    });

    it('forgets a socket after closeAll', () => {
      const registry = new SessionRegistry();
      const client = socket();
      registry.open(client, turn('a'));
      registry.open(client, turn('b'));

      expect(registry.closeAll(client)).toHaveLength(2);
      expect(registry.trackedSockets).toBe(0);
      expect(registry.countGlobal()).toBe(0);
    });
  });

  describe('close', () => {
    it('returns the turn it dropped', () => {
      const registry = new SessionRegistry();
      const client = socket();
      const a = turn('a');
      registry.open(client, a);

      expect(registry.close(client, a.sessionId)).toBe(a);
    });

    it('returns nothing when there was no such turn', () => {
      const registry = new SessionRegistry();
      const client = socket();
      registry.open(client, turn('a'));

      expect(registry.close(client, 'not-a-session')).toBeUndefined();
    });

    it('returns the turns closeAll dropped, and nothing on an unknown socket', () => {
      const registry = new SessionRegistry();
      const client = socket();
      const a = turn('a');
      registry.open(client, a);

      expect(registry.closeAll(client)).toEqual([a]);
      expect(registry.closeAll(socket())).toEqual([]);
    });
  });
});
