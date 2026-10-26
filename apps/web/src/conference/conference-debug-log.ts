/**
 * Conference diagnostics, for development builds only.
 *
 * The call path logs every signaling step and, on the translate leg, would log
 * every audio frame; none of that belongs in a production console, where it is
 * noise for the user and a per-frame cost for the page.
 */
export function conferenceDebug(message: string): void {
  if (process.env.NODE_ENV === 'production') return;
  console.debug(`[conference] ${new Date().toISOString().slice(11, 23)} ${message}`);
}
