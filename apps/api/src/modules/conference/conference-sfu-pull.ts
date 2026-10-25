import type {
  CloudflareRealtimeClient,
  PulledTrack,
} from './cloudflare-realtime.client';
import type {
  ConferenceRoom,
  MediaKind,
  ParticipantSession,
} from './conference-room-registry.service';

/** Per-track errors worth one more try: the publisher's track is not ready yet. */
const RETRYABLE_TRACK_ERRORS = new Set([
  'retryable_transient_error',
  'not_found_track_error',
]);
const PULL_RETRY_DELAY_MS = 500;

/** A published track a receiving session should pull, and whose it is. */
export interface WantedTrack {
  sessionId: string;
  trackName: string;
  socketId: string;
  kind: MediaKind;
}

export interface PullOutcome {
  /** The SFU's offer for the receiving connection, or null when none was made. */
  offerSdp: string | null;
  /** Each pulled track's `mid` on the receiving session. */
  pulled: { mid: string; from: WantedTrack }[];
}

/** Every track published in the room that `peer` does not receive yet. */
export function missingTracks(
  room: ConferenceRoom,
  socketId: string,
  peer: ParticipantSession,
): WantedTrack[] {
  const held = new Set(
    [...peer.pulled.values()].map((f) => `${f.socketId}/${f.kind}`),
  );
  const wanted: WantedTrack[] = [];
  for (const [otherId, other] of room.peers) {
    if (otherId === socketId || !other.pubSessionId) continue;
    for (const track of other.publishedTracks) {
      if (held.has(`${otherId}/${track.kind}`)) continue;
      wanted.push({
        sessionId: other.pubSessionId,
        trackName: track.trackName,
        socketId: otherId,
        kind: track.kind,
      });
    }
  }
  return wanted;
}

/**
 * Pull `wanted` into `sessionId`, retrying tracks that failed with a
 * retryable per-track error once after {@link PULL_RETRY_DELAY_MS}.
 *
 * The retry runs only when the first pull produced no offer: an offer still
 * waiting for its answer makes any further mutation fail with 406. A track
 * that is not pulled is reported to `onSkipped` and left for the caller's next
 * subscribe, which sees it missing again.
 */
export async function pullWithRetry(
  client: CloudflareRealtimeClient,
  sessionId: string,
  wanted: WantedTrack[],
  onSkipped: (summary: string) => void,
): Promise<PullOutcome> {
  const first = await pullOnce(client, sessionId, wanted);
  if (first.retry.length === 0 || first.offerSdp !== null) {
    report([...first.retry, ...first.failed], onSkipped);
    return { offerSdp: first.offerSdp, pulled: first.pulled };
  }
  report(first.failed, onSkipped);
  await new Promise((resolve) => setTimeout(resolve, PULL_RETRY_DELAY_MS));
  const second = await pullOnce(
    client,
    sessionId,
    first.retry.map((r) => r.from),
  );
  report([...second.retry, ...second.failed], onSkipped);
  return {
    offerSdp: second.offerSdp,
    pulled: [...first.pulled, ...second.pulled],
  };
}

interface Rejected {
  from: WantedTrack;
  code: string;
}

async function pullOnce(
  client: CloudflareRealtimeClient,
  sessionId: string,
  wanted: WantedTrack[],
) {
  const result = await client.pullTracks(
    sessionId,
    wanted.map(({ sessionId: from, trackName }) => ({
      sessionId: from,
      trackName,
    })),
  );
  const pulled: PullOutcome['pulled'] = [];
  const retry: Rejected[] = [];
  const failed: Rejected[] = [];
  wanted.forEach((from, index) => {
    // By publisher session and name; by position when the SFU did not echo
    // them, since results come back in request order.
    const track =
      result.tracks.find(
        (t: PulledTrack) =>
          t.sessionId === from.sessionId && t.trackName === from.trackName,
      ) ?? positional(result.tracks, wanted.length, index);
    const code = track ? track.errorCode : 'missing_from_response';
    if (track && !code && track.mid) pulled.push({ mid: track.mid, from });
    else if (code && RETRYABLE_TRACK_ERRORS.has(code))
      retry.push({ from, code });
    else failed.push({ from, code: code ?? 'missing_mid' });
  });
  return { offerSdp: result.offerSdp, pulled, retry, failed };
}

function report(
  rejected: Rejected[],
  onSkipped: (summary: string) => void,
): void {
  if (rejected.length === 0) return;
  onSkipped(
    rejected
      .map(({ from, code }) => `${from.socketId}/${from.kind} ${code}`)
      .join(', '),
  );
}

function positional(
  tracks: PulledTrack[],
  requested: number,
  index: number,
): PulledTrack | undefined {
  const track = tracks.length === requested ? tracks[index] : undefined;
  return track && !track.sessionId && !track.trackName ? track : undefined;
}
