/**
 * Request/reply signaling over the raw `/ws/conference` socket, plus the mediasoup
 * transport wiring that rides on it. Module-level helpers, no React.
 *
 * Wire format: `{ event, data }` both ways. The gateway answers a request on the
 * same event name; a refusal is `{ error: <ConferenceErrorCode> }`.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { MediaStream } from 'react-native-webrtc';
import type { types } from 'mediasoup-client';
import { toNativeTrack } from './native-media-adapter';

/** How long a request waits for its reply before failing. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface SignalMessage {
  event: string;
  data: unknown;
}

/** A reply the gateway refused, carrying its stable error code. */
export class ConferenceRequestError extends Error {
  constructor(
    readonly event: string,
    readonly code: string,
  ) {
    super(`${event} refused: ${code}`);
    this.name = 'ConferenceRequestError';
  }
}

export function parseSignal(raw: unknown): SignalMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SignalMessage> | null;
    if (!parsed || typeof parsed.event !== 'string') return null;
    return { event: parsed.event, data: parsed.data };
  } catch {
    return null;
  }
}

/** The gateway's error code when `data` is a refusal, else undefined. */
export function replyErrorCode(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'error' in data) {
    const code = (data as { error: unknown }).error;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export function send(ws: WebSocket, event: string, data: unknown): void {
  ws.send(JSON.stringify({ event, data }));
}

/**
 * Send `event` and resolve with the data of the first reply carrying the same
 * name. Rejects with {@link ConferenceRequestError} when the reply is a refusal,
 * and with a timeout error when no reply arrives.
 */
export function request(ws: WebSocket, event: string, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Timeout waiting for ${event}`));
    }, REQUEST_TIMEOUT_MS);

    function handler(msg: MessageEvent<string>): void {
      const parsed = parseSignal(msg.data);
      if (!parsed || parsed.event !== event) return;
      ws.removeEventListener('message', handler);
      clearTimeout(timer);
      const code = replyErrorCode(parsed.data);
      if (code) reject(new ConferenceRequestError(event, code));
      else resolve(parsed.data);
    }

    ws.addEventListener('message', handler);
    try {
      send(ws, event, data);
    } catch (err) {
      ws.removeEventListener('message', handler);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function wireTransportConnect(ws: WebSocket, transport: types.Transport): void {
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    request(ws, 'conference.transport.connect', { transportId: transport.id, dtlsParameters })
      .then(() => callback())
      .catch(errback);
  });
}

export function wireSendTransport(ws: WebSocket, transport: types.Transport): void {
  wireTransportConnect(ws, transport);
  transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
    request(ws, 'conference.produce', { kind, rtpParameters, appData })
      .then((resp) => {
        const id = (resp as { id?: unknown } | null)?.id;
        if (typeof id !== 'string') throw new Error('conference.produce returned no id');
        callback({ id });
      })
      .catch(errback);
  });
}

export function wireRecvTransport(ws: WebSocket, transport: types.Transport): void {
  wireTransportConnect(ws, transport);
}

/**
 * Consume one remote producer and hand its track to `onTrack` in a fresh native
 * MediaStream. A refused consume or resume (the producer closed meanwhile) is
 * skipped; a timeout or transport failure rejects.
 */
export async function consumeTrack(
  ws: WebSocket,
  device: types.Device,
  recvTransport: types.Transport,
  producerId: string,
  producerSocketId: string,
  onTrack: (socketId: string, stream: MediaStream) => void,
): Promise<void> {
  let params: types.ConsumerOptions;
  try {
    params = (await request(ws, 'conference.consume', {
      producerId,
      rtpCapabilities: device.rtpCapabilities,
    })) as types.ConsumerOptions;
  } catch (err) {
    if (err instanceof ConferenceRequestError) return;
    throw err;
  }

  const consumer = await recvTransport.consume(params);
  try {
    await request(ws, 'conference.consumer.resume', { consumerId: consumer.id });
  } catch (err) {
    consumer.close();
    if (err instanceof ConferenceRequestError) return;
    throw err;
  }

  // consumer.track is DOM-typed by mediasoup-client; adapt it to the native track
  // before adding it to the native MediaStream RTCView renders.
  const stream = new MediaStream();
  stream.addTrack(toNativeTrack(consumer.track));
  onTrack(producerSocketId, stream);
}

/**
 * Android runtime permission request. iOS resolves camera/mic through Info.plist
 * usage strings and the implicit prompt getUserMedia triggers.
 */
export async function requestAndroidPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ]);
}
