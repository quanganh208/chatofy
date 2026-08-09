/**
 * What travels between the offscreen document and the meeting page's own world.
 *
 * The route is offscreen → worker → tab → page world, because an offscreen
 * document may only use `chrome.runtime`, and the page world has no extension
 * APIs at all. The last hop is `window.postMessage`, which the page can read.
 *
 * That is a deliberate, measured acceptance rather than an oversight. The
 * end-to-end harness proved the page sees anything sent this way; there is no
 * private channel into a world that IS the page. Two consequences follow, and
 * both are load-bearing:
 *
 *   1. The audio here is the user's own translated speech, which the page is
 *      about to transmit to the meeting anyway — EXCEPT when the meeting client
 *      is muted. So nothing is sent while it is muted. That rule is the real
 *      privacy control, not the channel.
 *   2. A page could post frames of its own and have them spoken as the user. It
 *      could also, without this extension existing at all, mix anything it liked
 *      into the stream it already controls — so this grants no capability a
 *      hostile page did not have. What it must not do is let the page corrupt
 *      the extension's own state, which is why every report coming back is a
 *      hint and never an authority.
 */

/** Extension → page world. */
export type OutboundCommand =
  /** Speak this, after everything already queued for this turn. */
  | { type: 'chatofy:audio'; turnKey: string; payload: string; sampleRate: number }
  /** Drop what is left of one turn — it was abandoned upstream. */
  | { type: 'chatofy:drop'; turnKey: string }
  /** Drop everything and let the microphone back up. */
  | { type: 'chatofy:silence' }
  /**
   * Whether the user's own voice reaches the meeting.
   *
   * `mine: false` is a LEASE and has to be restated — see
   * {@link ../outbound-voice-lease}. The page gives the voice back on its own if
   * the renewals stop, so an offscreen document that dies cannot leave a
   * microphone held shut in a live meeting.
   */
  | { type: 'chatofy:voice'; mine: boolean };

/**
 * Page world → extension. One fact, and one the extension cannot learn itself.
 *
 * There is deliberately no "this turn finished" report. The offscreen side keeps
 * its own duration ledger and asks nobody, because a page able to say a turn
 * ended is a page able to release the next one over the top of it.
 */
export type OutboundReport = {
  /**
   * Whether the meeting client is currently transmitting this microphone.
   *
   * Read by polling `enabled` on the track we handed over, because a property
   * assignment fires no event and shadowing it with our own setter would break
   * the silencing the client is relying on. Only the page can see this, and
   * getting it wrong in the direction of "transmitting" means translating
   * speech the user believes is private — so the extension treats a missing
   * answer as muted rather than as sending.
   */
  type: 'chatofy:transmitting';
  transmitting: boolean;
};

export function asCommand(data: unknown): OutboundCommand | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as Record<string, unknown>;
  if (candidate.type === 'chatofy:silence') return { type: 'chatofy:silence' };
  if (candidate.type === 'chatofy:voice' && typeof candidate.mine === 'boolean') {
    return { type: 'chatofy:voice', mine: candidate.mine };
  }
  if (typeof candidate.turnKey !== 'string') return null;
  if (candidate.type === 'chatofy:drop') {
    return { type: 'chatofy:drop', turnKey: candidate.turnKey };
  }
  if (
    candidate.type === 'chatofy:audio' &&
    typeof candidate.payload === 'string' &&
    typeof candidate.sampleRate === 'number'
  ) {
    return {
      type: 'chatofy:audio',
      turnKey: candidate.turnKey,
      payload: candidate.payload,
      sampleRate: candidate.sampleRate,
    };
  }
  return null;
}

export function asOutboundReport(data: unknown): OutboundReport | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as Record<string, unknown>;
  if (candidate.type === 'chatofy:transmitting' && typeof candidate.transmitting === 'boolean') {
    return { type: 'chatofy:transmitting', transmitting: candidate.transmitting };
  }
  return null;
}
