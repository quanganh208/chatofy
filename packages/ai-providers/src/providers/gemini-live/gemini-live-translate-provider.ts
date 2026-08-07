// Gemini Live Translate — speech in, translated speech out, over one
// bidirectional WebSocket. Unlike the STT → translate → TTS trio, this backend
// has no turn: it translates while the speaker is still talking, and it learns
// the utterance ended from trailing quiet rather than from any event a caller
// sends. A caller that stops forwarding audio at the last speech sample gets a
// truncated translation.
import { randomUUID } from 'node:crypto';
import { GoogleGenAI, Modality } from '@google/genai';
import type {
  RealtimeProvider,
  RealtimeStartParams,
  RealtimeStreamEvents,
} from '../../interfaces/realtime-provider.js';
import type { LanguageCode, StreamHandle } from '../../interfaces/provider-types.js';
import { ProviderConfigError, ProviderConnectionError } from '../../errors/provider-errors.js';

const MODEL = 'gemini-3.5-live-translate-preview';

/** Rate this model accepts, and the only one `pushAudio` may be handed. */
export const INPUT_SAMPLE_RATE = 16000;

export interface GeminiLiveTranslateConfig {
  /**
   * One key, or several comma-separated.
   *
   * Only the FIRST is used, and that is deliberate — do not "fix" it by reaching
   * for the rotation in `GeminiTranslationProvider`. That rotation is
   * per-request with per-key/model cooldowns, and it works because a translation
   * request is short and retryable on the next key. A live session connects once
   * and holds for the length of a conversation, so there is no moment at which
   * this provider could rotate. A caller that genuinely needs to spread load
   * across the pool opens several sessions and passes
   * `RealtimeStartParams.apiKey` per session; the choice belongs to whoever
   * decides how many sessions there are.
   */
  apiKey?: string;
  model?: string;
}

/** The subset of the SDK's live session this provider drives. */
interface LiveSession {
  sendRealtimeInput(input: { audio: { data: string; mimeType: string } }): void;
  close(): void;
}

/** A live socket plus the callbacks that belong to it. */
interface OpenSession {
  session: LiveSession;
  events: RealtimeStreamEvents;
  /** One-shot latches, so a per-message fault cannot become a flood. */
  warned: { rate: boolean; language: boolean };
}

/**
 * The subset of a `serverContent` message this provider reads.
 *
 * Declared here rather than imported from the SDK because it is the part whose
 * shape was verified against the live API, field by field, including
 * `languageCode` — which the published sample does not mention and which is the
 * only reason `onSourceTranscript` can report a detected language honestly.
 */
interface ServerContent {
  inputTranscription?: { text?: string; languageCode?: string };
  outputTranscription?: { text?: string; languageCode?: string };
  modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
}

/**
 * Pull the sample rate out of `audio/pcm;rate=24000`.
 *
 * Read rather than assumed: the rate is the backend's and differs from the
 * input's — this model takes 16 kHz and answers at 24 kHz — so hardcoding the
 * observed value would turn a documented field into a silent assumption that
 * breaks by producing audio played at the wrong speed, which no test asserting
 * byte counts would catch.
 */
function rateFromMimeType(mimeType: string | undefined): number | null {
  const match = /rate=(\d+)/.exec(mimeType ?? '');
  if (!match) return null;
  const rate = Number.parseInt(match[1]!, 10);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** Narrow a BCP-47 tag the model reports onto this monorepo's language enum. */
function toLanguageCode(tag: string | undefined): LanguageCode | null {
  const primary = tag?.split('-')[0]?.toLowerCase();
  return primary === 'vi' || primary === 'en' ? primary : null;
}

export class GeminiLiveTranslateProvider implements RealtimeProvider {
  readonly name = 'gemini-live';
  private readonly apiKey: string;
  private readonly model: string;
  /**
   * Open sessions by handle id, so `pushAudio` can find the socket again.
   *
   * The caller's callbacks are stored beside the socket rather than only
   * captured in the connect closure, because faults discovered while sending —
   * not only while receiving — have to reach the session that caused them.
   */
  private readonly sessions = new Map<string, OpenSession>();

  constructor(config: GeminiLiveTranslateConfig) {
    const first = (config.apiKey ?? '')
      .split(',')
      .map((k) => k.trim())
      .find((k) => k.length > 0);
    if (!first) {
      throw new ProviderConfigError('Gemini Live Translate requires an apiKey');
    }
    this.apiKey = first;
    this.model = config.model ?? MODEL;
  }

  /** Refuse anything this model cannot be handed, before a socket is opened. */
  private assertSupportedFormat(params: RealtimeStartParams): void {
    if (params.audioFormat.encoding !== 'pcm16' || params.audioFormat.channels !== 1) {
      throw new ProviderConfigError(
        'Gemini Live Translate takes 16-bit mono PCM; got ' +
          `${params.audioFormat.encoding}/${params.audioFormat.channels}ch`,
      );
    }
    if (params.audioFormat.sampleRate !== INPUT_SAMPLE_RATE) {
      throw new ProviderConfigError(
        `Gemini Live Translate takes ${INPUT_SAMPLE_RATE} Hz; got ${params.audioFormat.sampleRate}`,
      );
    }
  }

  /**
   * A client for this session's key.
   *
   * `||` and not `??`: a caller walking a key pool can hand over an empty string
   * from a trailing comma or an off-by-one, and `??` would pass that straight to
   * the SDK to fail later with an opaque message. The constructor already
   * refuses blank keys; this is the same rule on the override path.
   */
  private clientFor(params: RealtimeStartParams): GoogleGenAI {
    return new GoogleGenAI({ apiKey: params.apiKey?.trim() || this.apiKey });
  }

  /**
   * What the SDK's websocket reports, routed to the caller's callbacks.
   *
   * `onEarlyClose` is called instead of `onClose` when the socket dies before
   * `start()` has registered the session — see `closedDuringConnect` in `start()`
   * for why that case cannot simply be announced.
   */
  private socketCallbacks(
    id: string,
    params: RealtimeStartParams,
    state: OpenSession,
    onEarlyClose: (e: { reason?: string }) => void,
  ) {
    return {
      onopen: () => {},
      onmessage: (message: unknown) => {
        // Guarded because this runs inside the SDK's own websocket handler: a
        // consumer callback that throws would escape into a foreign event loop,
        // where it kills the socket rather than the caller.
        try {
          this.dispatch(message, params, state);
        } catch (err) {
          state.events.onError?.(
            err instanceof Error ? err : new Error('Gemini Live message handler failed'),
          );
        }
      },
      onerror: (err: { message?: string }) => {
        // Typed, so a caller can branch on transport failure the way it can for
        // every other provider in this package.
        state.events.onError?.(
          new ProviderConnectionError(err?.message ?? 'Gemini Live session error', err),
        );
      },
      onclose: (e: { reason?: string }) => {
        if (!this.sessions.has(id)) {
          // Before `start()` returned. Recorded rather than announced: the
          // caller has no handle yet, so a close callback would name an id it
          // has never seen. It is reported as a thrown error instead.
          onEarlyClose(e ?? {});
          return;
        }
        this.sessions.delete(id);
        state.events.onClose?.(e?.reason);
      },
    };
  }

  async start(params: RealtimeStartParams, events: RealtimeStreamEvents): Promise<StreamHandle> {
    this.assertSupportedFormat(params);

    // Random rather than a per-instance counter. Two provider instances — the
    // api's factory memoizes one, a harness may build its own — would each mint
    // `gemini-live-0`, and `pushAudio` finds a session by id alone, so colliding
    // ids would feed audio into the wrong live conversation.
    const id = `gemini-live-${randomUUID()}`;
    const client = this.clientFor(params);

    const state: OpenSession = {
      session: null as unknown as LiveSession,
      events,
      warned: { rate: false, language: false },
    };
    /**
     * Whether the socket died before `connect()` handed back a session.
     *
     * The Live API reports a rejected key or exhausted quota by closing the
     * socket, not by rejecting the promise, and the SDK awaits in between — so
     * `onclose` really can arrive while the code below is still waiting. Without
     * this the entry was registered after the delete that was meant to remove
     * it, leaving a dead socket in the map that `pushAudio` happily wrote to
     * while `start()` reported success.
     */
    let closedDuringConnect: { reason?: string } | null = null;

    let session: LiveSession;
    try {
      session = (await client.live.connect({
        model: this.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          translationConfig: {
            targetLanguageCode: params.targetLanguage,
            // False, so speech already in the target language is silenced
            // rather than repeated. Repeating it would feed a single-speaker
            // demo its own loudspeaker output straight back in.
            echoTargetLanguage: false,
          },
        },
        callbacks: this.socketCallbacks(id, params, state, (e) => {
          closedDuringConnect = e;
        }),
      })) as LiveSession;
    } catch (err) {
      throw new ProviderConnectionError('Gemini Live Translate failed to connect', err);
    }

    if (closedDuringConnect !== null) {
      try {
        session.close();
      } catch {
        /* already gone */
      }
      throw new ProviderConnectionError(
        'Gemini Live Translate closed the session during connect: ' +
          ((closedDuringConnect as { reason?: string }).reason ?? 'no reason given'),
      );
    }

    state.session = session;
    this.sessions.set(id, state);

    return this.handleFor(id);
  }

  /** The caller's handle on a registered session. Closing it is idempotent. */
  private handleFor(id: string): StreamHandle {
    return {
      id,
      close: async () => {
        const open = this.sessions.get(id);
        this.sessions.delete(id);
        // Closing an already-closed socket is not worth failing a caller over;
        // the handle is gone from the map either way.
        try {
          open?.session.close();
        } catch {
          /* already closed */
        }
      },
    };
  }

  pushAudio(handle: StreamHandle, chunk: Uint8Array): Promise<void> {
    const open = this.sessions.get(handle.id);
    // Silent on a closed session rather than throwing: audio arrives on a pump
    // that cannot usefully handle "the session you were feeding has ended", and
    // the close already reached the caller through `onClose`.
    if (!open) return Promise.resolve();
    try {
      open.session.sendRealtimeInput({
        audio: {
          data: Buffer.from(chunk).toString('base64'),
          mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
        },
      });
    } catch (err) {
      // A socket that is mapped but dying throws from here. Reported on the
      // session's own error channel rather than rejecting, because rejecting
      // would break the promise this method's contract makes to an audio pump
      // that has nothing useful to do with the failure.
      open.events.onError?.(
        new ProviderConnectionError('Gemini Live Translate failed to send audio', err),
      );
    }
    return Promise.resolve();
  }

  /**
   * Route one `serverContent` message onto the caller's callbacks.
   *
   * The model reports the language it detected on each transcript
   * (`inputTranscription.languageCode`), which is what lets a caller notice
   * auto-detection failing rather than silently translating the wrong language.
   * When the tag is not one this monorepo knows, fall back to what the caller
   * expected and let the mismatch show up as audio nobody asked for — dropping
   * the delta instead would lose the transcript entirely.
   */
  private dispatch(message: unknown, params: RealtimeStartParams, state: OpenSession): void {
    const content = (message as { serverContent?: ServerContent } | null)?.serverContent;
    if (!content) return;
    const { events } = state;

    const input = content.inputTranscription;
    if (input?.text) {
      const detected = toLanguageCode(input.languageCode);
      if (detected === null && input.languageCode && !state.warned.language) {
        // Once per session. The transcript is still delivered under the expected
        // language below — dropping it would lose the text entirely — but a tag
        // this monorepo cannot model would otherwise be invisible, which is the
        // opposite of why the detected language is surfaced at all.
        state.warned.language = true;
        events.onError?.(
          new Error(
            `Gemini Live detected "${input.languageCode}", which is neither vi nor en; ` +
              `reporting transcripts as ${params.sourceLanguage}`,
          ),
        );
      }
      events.onSourceTranscript?.(input.text, detected ?? params.sourceLanguage);
    }

    if (content.outputTranscription?.text) {
      events.onTargetTranscript?.(content.outputTranscription.text);
    }

    for (const part of content.modelTurn?.parts ?? []) {
      const inline = part?.inlineData;
      if (!inline?.data) continue;
      const rate = rateFromMimeType(inline.mimeType);
      if (rate === null) {
        // Latched: audio arrives many times a second, so an unreadable rate
        // would otherwise report itself at that rate too.
        if (!state.warned.rate) {
          state.warned.rate = true;
          events.onError?.(
            new Error(`Gemini Live returned audio with an unreadable rate: ${inline.mimeType}`),
          );
        }
        continue;
      }
      events.onTranslatedAudio?.(new Uint8Array(Buffer.from(inline.data, 'base64')), rate);
    }
  }
}
