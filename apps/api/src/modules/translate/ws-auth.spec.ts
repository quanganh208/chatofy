import { describe, expect, it, vi } from 'vitest';
import { WS_SUBPROTOCOL } from '@chatofy/types';
import { createVerifyClient, handleProtocols, verifiedUserId } from './ws-auth';

function infoWith(header?: string | string[]) {
  return { req: { headers: { 'sec-websocket-protocol': header } } } as never;
}

/** Runs the verifier and resolves with the arguments it passed to `cb`. */
function run(
  verify: (token: string) => Promise<{ sub: string }>,
  header?: string | string[],
): Promise<[boolean, number?]> {
  return new Promise((resolve) => {
    createVerifyClient(verify)(infoWith(header), (ok, code) =>
      resolve([ok, code]),
    );
  });
}

describe('verifyClient', () => {
  const accepts = vi.fn().mockResolvedValue({ sub: 'user_1' });

  it('accepts a well-formed offer whose token verifies', async () => {
    await expect(
      run(accepts, `${WS_SUBPROTOCOL}, good.token`),
    ).resolves.toEqual([true, undefined]);
    expect(accepts).toHaveBeenCalledWith('good.token');
  });

  it('stamps the verified subject onto the upgrade request', async () => {
    // `ws` passes this same request object to the `connection` event, so the
    // socket and its owner arrive together and cannot be mismatched — which is
    // what lets a password reset close exactly that user's sockets.
    const info = infoWith(`${WS_SUBPROTOCOL}, good.token`) as {
      req: unknown;
    };
    await new Promise<void>((resolve) => {
      createVerifyClient(accepts)(info as never, () => resolve());
    });
    expect(verifiedUserId(info.req)).toBe('user_1');
  });

  it('leaves no subject on a request whose token was refused', async () => {
    const info = infoWith(`${WS_SUBPROTOCOL}, bad.token`) as { req: unknown };
    await new Promise<void>((resolve) => {
      createVerifyClient(() => Promise.reject(new Error('nope')))(
        info as never,
        () => resolve(),
      );
    });
    expect(verifiedUserId(info.req)).toBeUndefined();
  });

  it('refuses a connection offering no subprotocol at all', async () => {
    await expect(run(accepts, undefined)).resolves.toEqual([false, 401]);
  });

  it('refuses an offer carrying the name but no token', async () => {
    await expect(run(accepts, WS_SUBPROTOCOL)).resolves.toEqual([false, 401]);
  });

  it('refuses an offer whose first entry is some other protocol', async () => {
    await expect(run(accepts, `graphql-ws, a.token`)).resolves.toEqual([
      false,
      401,
    ]);
  });

  it('refuses a token the verifier rejects', async () => {
    const rejects = vi.fn().mockRejectedValue(new Error('Invalid token'));
    await expect(run(rejects, `${WS_SUBPROTOCOL}, bad.token`)).resolves.toEqual(
      [false, 401],
    );
  });

  it('does not let a REJECTED verify escape as a floating rejection', async () => {
    // The failure this guards against kills the process: Node 24 defaults to
    // --unhandled-rejections=throw, so a verifier rejection that is not handled
    // inside the callback would take the API down on an unauthenticated request.
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const rejects = () => Promise.reject(new Error('Invalid token'));
    await run(rejects, `${WS_SUBPROTOCOL}, bad.token`);
    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('reads a header node split into several values', async () => {
    await expect(run(accepts, [WS_SUBPROTOCOL, 'good.token'])).resolves.toEqual(
      [true, undefined],
    );
  });
});

describe('handleProtocols', () => {
  it('selects the name, never the token', () => {
    // A server that selects nothing gets a handshake that succeeds and a browser
    // that closes the connection an instant later.
    expect(handleProtocols()).toBe(WS_SUBPROTOCOL);
  });
});
