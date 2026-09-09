import { Injectable, Logger } from '@nestjs/common';

/**
 * What a transport offers so a completed password reset can close what it holds
 * open for that user.
 *
 * Deliberately says nothing about sockets. `AuthService` writes a new password
 * hash and asks for that user's live connections to end; whether those are
 * WebSockets, and how one is closed, is the transport's business and stays
 * inside it.
 */
export interface TerminableTransport {
  /** Closes every live connection belonging to `userId`. Returns how many. */
  closeSessionsFor(userId: string): number;
}

/**
 * The seam a password reset reaches live connections through.
 *
 * Transports REGISTER WITH THIS; it never reaches back into them by name. That
 * is what keeps the dependency pointing the right way — `TranslateModule`
 * already imports `AuthModule`, so the gateway can inject this, while
 * `AuthService` stays unable to name a gateway, a socket, or `ws`.
 *
 * Why this exists at all: revocation at the upgrade is not enough. The guard
 * returns true for every non-HTTP context, no frame re-authenticates, and a
 * socket has no maximum lifetime — so without this, someone holding a stolen
 * token keeps streaming the victim's audio and transcripts for the rest of the
 * token's remaining minutes, straight through the reset performed to stop them.
 * The socket is where the sensitive data actually is.
 */
@Injectable()
export class SessionTerminator {
  private readonly logger = new Logger(SessionTerminator.name);

  /**
   * A Set, so a transport that registers twice — a module re-initialised in a
   * test, say — does not get asked to close the same connections twice.
   */
  private readonly transports = new Set<TerminableTransport>();

  register(transport: TerminableTransport): void {
    this.transports.add(transport);
  }

  /**
   * Ends every live connection this user holds, across every registered
   * transport. Returns the total closed, for the log line at the call site.
   *
   * Failures are contained per transport: one throwing must not stop the others
   * from closing, and must not turn a completed password reset into a 500 — the
   * password has already changed by the time this runs, and reporting failure
   * would tell the user their reset did not work when it did.
   */
  terminate(userId: string): number {
    let closed = 0;
    for (const transport of this.transports) {
      try {
        closed += transport.closeSessionsFor(userId);
      } catch (err) {
        this.logger.error(
          `a transport failed to close sessions: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return closed;
  }
}
