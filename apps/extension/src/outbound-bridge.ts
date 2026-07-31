/**
 * The channel between the extension and the meeting page's own world.
 *
 * Kept deliberately small, because this is a trust boundary. The script on the
 * far side runs where Meet, Zoom and Facebook's own JavaScript runs — and where
 * any third-party script they load, or any XSS on them, runs too. It can read
 * what we put there, patch over it, and delete it. So nothing that must be
 * correct is decided on that side, and nothing confidential travels to it.
 *
 * `event.source === window` is NOT authentication. It distinguishes this frame
 * from another frame; it says nothing about whether the sender is us or the
 * page. Building a control channel on it hands the page the ability to speak as
 * the extension — see the plan's red-team log for what that buys an attacker.
 *
 * So the handshake is a `MessagePort`, transferred once. Both scripts are
 * content scripts at `document_start`, which run before any page script, so at
 * the moment the port crosses there is no page listener to intercept it. That
 * ordering is the whole basis of the guarantee, which is why it is written down
 * here rather than assumed; the nonce is a second layer for the case where the
 * assumption turns out to be wrong.
 */

/** The one message that ever travels over `window.postMessage`. */
export const BOOTSTRAP_TYPE = 'chatofy:outbound:bootstrap';

export interface BootstrapMessage {
  type: typeof BOOTSTRAP_TYPE;
  /** Accompanies the transferred port; every later frame must carry it. */
  nonce: string;
}

/**
 * Page world → extension. Reports only; never asks for anything.
 *
 * Nothing travels the other way yet: this phase installs the patch and says
 * whether it took. The commands that carry translated audio arrive with the
 * phase that has audio to carry.
 */
export type PatchReport =
  { type: 'ready'; nonce: string } | { type: 'failed'; nonce: string; message: string };

export function isBootstrap(data: unknown): data is BootstrapMessage {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as { type?: unknown; nonce?: unknown };
  return candidate.type === BOOTSTRAP_TYPE && typeof candidate.nonce === 'string';
}

/**
 * Narrow a report, or reject it.
 *
 * The far end of the port is in the page's world. Casting the payload and
 * reading a field off it is how a `null` becomes a throw inside a message
 * listener, where nothing is watching.
 */
export function asReport(data: unknown): PatchReport | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as { type?: unknown; nonce?: unknown; message?: unknown };
  if (typeof candidate.nonce !== 'string') return null;
  if (candidate.type === 'ready') return { type: 'ready', nonce: candidate.nonce };
  if (candidate.type === 'failed') {
    return {
      type: 'failed',
      nonce: candidate.nonce,
      message: typeof candidate.message === 'string' ? candidate.message : 'unknown failure',
    };
  }
  return null;
}
