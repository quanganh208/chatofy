/**
 * The mediasoup transport wiring and consume step that ride on the
 * `/ws/conference` request/reply helpers (conference-request.ts, re-exported
 * here). Module-level helpers, no React.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { MediaStream } from 'react-native-webrtc';
import type { types } from 'mediasoup-client';
import { toNativeTrack } from './native-media-adapter';
import { ConferenceRequestError, request } from './conference-request';

export {
  ConferenceRequestError,
  parseSignal,
  replyErrorCode,
  request,
  send,
  type SignalMessage,
} from './conference-request';

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
