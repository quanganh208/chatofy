// The streamed half of the local TTS provider: `POST /synthesize/stream`.
//
// Split from `local-speech-tts-provider.ts` so each file stays readable; the
// provider class is still the only public entry point, and the request body is
// built here once for both endpoints.
import { MAX_SAMPLE_RATE, MIN_SAMPLE_RATE } from '@chatofy/types';
import type { TtsAudioStream, TtsSynthesizeRequest } from '../../interfaces/tts-provider.js';
import { ProviderBusyError, ProviderResponseError } from '../../errors/provider-errors.js';
import { fetchStreamWithDeadlines } from '../fetch-stream-with-deadlines.js';
import {
  LOCAL_TTS_STREAM_FIRST_BYTE_MS,
  LOCAL_TTS_STREAM_IDLE_MS,
  LOCAL_TTS_STREAM_MAX_CHARS,
  LOCAL_TTS_STREAM_TOTAL_MS,
  truncate,
} from '../http-util.js';

/**
 * What this provider accepts beyond the shared contract.
 *
 * `voice` lives HERE rather than on `TtsSynthesizeRequest` on purpose. Only a
 * provider that publishes a catalog can be given a token from it, and keeping the
 * field off the shared type is what makes that structural instead of a rule
 * someone has to remember — a provider that never declared a voice cannot be
 * handed one, whatever a caller does.
 */
export interface LocalSpeechSynthesizeRequest extends TtsSynthesizeRequest {
  /** A token from {@link LocalSpeechTtsProvider.listVoices}. */
  voice?: string;
}

/** The JSON body both synthesis endpoints take. */
export type SynthesisBody = {
  text: string;
  language: string;
  gender?: string;
  speed?: number;
  voice?: string;
};

/**
 * The request both synthesis endpoints take. Shared so the streamed and the
 * whole-turn path cannot disagree about voice, gender or speed.
 */
export function synthesisBody(req: LocalSpeechSynthesizeRequest): SynthesisBody {
  const body: SynthesisBody = {
    text: req.text,
    language: req.language,
  };
  if (req.voiceGender) body.gender = req.voiceGender;
  // Passed through unchecked, and safely so: the sidecar whitelists it against
  // the engine's own catalog and falls back to the gender default when it does
  // not recognise it, so a stale token costs a voice rather than a turn.
  if (req.voice) body.voice = req.voice;
  // Sent only when asked for, so the sidecar's own default stays the single
  // definition of "natural pace". Kokoro applies it at synthesis; the Vietnamese
  // engine accepts and ignores it, which is why the UI offers the control for
  // English output only rather than everywhere.
  if (req.speed !== undefined) body.speed = req.speed;
  return body;
}

/**
 * The error for a non-2xx answer from either synthesis endpoint.
 *
 * A 503 carrying `X-Engine-Busy` is the engine serving another turn past this
 * request's wait, not the sidecar being down — "models not loaded" is a 503 too,
 * without the header — so it gets its own type for the caller to answer
 * differently.
 */
export function localTtsError(label: string, res: Response, detail: string): ProviderResponseError {
  const message = `${label} returned ${res.status}: ${truncate(detail)}`;
  if (res.status === 503 && res.headers.get('x-engine-busy') === '1') {
    return new ProviderBusyError(message);
  }
  return new ProviderResponseError(message, res.status);
}

/**
 * Open a stream on the sidecar and check what it says it will send.
 *
 * `null` on 404: a sidecar deployed before the endpoint existed. The two
 * services are built and restarted separately, and a live turn falling back to
 * clause-by-clause synthesis beats every turn failing until someone redeploys
 * the other one.
 *
 * `null` too for text past the endpoint's length cap, which the sidecar would
 * refuse with 422. The cap protects the lock a stream holds for its whole turn;
 * the clause path takes the lock per clause and has no cap, so that is where
 * such a turn is still spoken. Counted in UTF-16 units, which is never fewer
 * than the code points the sidecar counts, so the check can only err early.
 *
 * The format headers are checked strictly before a single chunk is handed on,
 * because the consumer puts these bytes on the wire as samples at this rate: a
 * wrong rate plays at the wrong pitch, and a container read as PCM is noise.
 */
export async function openLocalTtsStream(
  baseUrl: string,
  body: SynthesisBody,
  signal: AbortSignal,
): Promise<TtsAudioStream | null> {
  if (body.text.length > LOCAL_TTS_STREAM_MAX_CHARS) return null;

  const streamed = await fetchStreamWithDeadlines(
    `${baseUrl}/synthesize/stream`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    {
      firstByteMs: LOCAL_TTS_STREAM_FIRST_BYTE_MS,
      idleMs: LOCAL_TTS_STREAM_IDLE_MS,
      totalMs: LOCAL_TTS_STREAM_TOTAL_MS,
      signal,
    },
    'Local TTS stream',
  );
  const res = streamed.response;

  if (!res.ok) {
    streamed.discard();
    const detail = await res.text().catch(() => '');
    if (res.status === 404) return null;
    throw localTtsError('Local TTS stream', res, detail);
  }

  const encoding = res.headers.get('x-audio-encoding');
  const rateHeader = res.headers.get('x-sample-rate') ?? '';
  const sampleRate = /^\d+$/.test(rateHeader) ? Number(rateHeader) : NaN;
  if (encoding !== 'pcm16' || !(sampleRate >= MIN_SAMPLE_RATE && sampleRate <= MAX_SAMPLE_RATE)) {
    streamed.discard();
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderResponseError(
      `Local TTS stream announced an unusable format (encoding ${String(encoding)}, rate ${JSON.stringify(rateHeader)})`,
    );
  }

  return { encoding: 'pcm16', sampleRate, chunks: streamed.chunks };
}
