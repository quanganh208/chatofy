'use client';

/**
 * mediasoup PoC — Issue #207
 *
 * Two browsers open this page, each enters the same room ID, and they exchange
 * audio + video through the mediasoup SFU running in the NestJS API.
 *
 * This page is intentionally minimal: plain HTML-ish JSX, no design tokens,
 * no i18n. Its only job is to prove the signaling and media paths work.
 *
 * Signaling wire format: { event: string; data: unknown }
 * All messages are sent as JSON text frames over the /ws/conference socket.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSession } from 'next-auth/react';
import * as mediasoupClient from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import { WS_SUBPROTOCOL } from '@chatofy/types/events';

// ─── Config ──────────────────────────────────────────────────────────────────

const API_WS_URL = process.env['NEXT_PUBLIC_API_WS_URL'] ?? 'ws://localhost:3000';

// ─── Signaling helpers ────────────────────────────────────────────────────────

type SignalMessage = { event: string; data: unknown };

function send(ws: WebSocket, event: string, data: unknown): void {
  ws.send(JSON.stringify({ event, data }));
}

/** Send a request and wait for a single response matching the event name. */
function request(ws: WebSocket, event: string, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const handler = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as SignalMessage;
        if (parsed.event === event) {
          ws.removeEventListener('message', handler);
          resolve(parsed.data);
        }
      } catch {
        /* ignore parse errors */
      }
    };
    ws.addEventListener('message', handler);
    send(ws, event, data);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Timeout waiting for ${event}`));
    }, 10_000);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ConferencePocPage() {
  const [roomId, setRoomId] = useState('poc-room');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState('idle');
  const [log, setLog] = useState<string[]>([]);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<types.Device | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev.slice(-49), `${new Date().toISOString().slice(11, 23)} ${msg}`]);
  }, []);

  const join = useCallback(async () => {
    if (!displayName.trim()) {
      addLog('Enter a display name first.');
      return;
    }
    setStatus('connecting');

    // 1. Open WebSocket — token rides Sec-WebSocket-Protocol (see ws-handshake.ts).
    const session = await getSession();
    const token = (session as { accessToken?: string } | null)?.accessToken;
    if (!token) {
      addLog('Not logged in — please sign in first.');
      setStatus('error');
      return;
    }
    const ws = new WebSocket(`${API_WS_URL}/ws/conference`, [WS_SUBPROTOCOL, token]);
    wsRef.current = ws;

    ws.addEventListener('open', async () => {
      try {
        addLog('WS connected');

        // 2. Join room — server returns routerRtpCapabilities + existing peers.
        send(ws, 'conference.join', { roomId, displayName });
        const joinResp = await waitForEvent(ws, 'conference.join');
        const { rtpCapabilities, peers, socketId } = joinResp as {
          rtpCapabilities: types.RtpCapabilities;
          peers: { socketId: string; displayName: string }[];
          socketId: string;
        };
        addLog(
          `Joined as ${socketId}. Peers: ${peers.map((p) => p.displayName).join(', ') || 'none'}`,
        );

        // 3. Load mediasoup Device.
        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        deviceRef.current = device;
        addLog('Device loaded');

        // 4. Get local media.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.muted = true; // no echo for local preview
        }
        addLog('Got local media');

        // 5. Create send transport.
        send(ws, 'conference.transport.create', { direction: 'send' });
        const sendParams = (await waitForEvent(
          ws,
          'conference.transport.create',
        )) as types.TransportOptions & {
          iceServers?: RTCIceServer[];
        };
        addLog(`TURN servers: ${sendParams.iceServers?.length ?? 0}`);
        const sendTransport = device.createSendTransport(sendParams);
        wireSendTransport(ws, sendTransport, addLog);

        // 6. Produce audio + video.
        for (const track of stream.getTracks()) {
          await sendTransport.produce({ track });
          addLog(`Producing ${track.kind}`);
        }

        // 7. Create recv transport.
        send(ws, 'conference.transport.create', { direction: 'recv' });
        const recvParams = (await waitForEvent(
          ws,
          'conference.transport.create',
        )) as types.TransportOptions & {
          iceServers?: RTCIceServer[];
        };
        const recvTransport = device.createRecvTransport(recvParams);
        wireRecvTransport(ws, recvTransport, addLog);

        // 8. Consume existing peers' producers.
        for (const peer of peers) {
          addLog(`Will consume tracks from ${peer.displayName}`);
          // Server will push conference.new.producer events for their tracks.
        }

        setStatus('in-call');

        // 9. Handle new producers from peers joining later.
        ws.addEventListener('message', async (evt: MessageEvent<string>) => {
          const msg = JSON.parse(evt.data) as SignalMessage;
          if (msg.event === 'conference.new.producer') {
            const {
              producerId,
              socketId: peerSocketId,
              kind,
            } = msg.data as {
              producerId: string;
              socketId: string;
              kind: string;
            };
            addLog(`New ${kind} producer ${producerId} from ${peerSocketId}`);
            await consumeTrack(ws, device, recvTransport, producerId, addLog, remoteVideoRef);
          }
          if (msg.event === 'conference.peer.joined') {
            const { displayName: peerName } = msg.data as { displayName: string };
            addLog(`Peer joined: ${peerName}`);
          }
          if (msg.event === 'conference.peer.left') {
            const { socketId: peerSid } = msg.data as { socketId: string };
            addLog(`Peer left: ${peerSid}`);
          }
        });
      } catch (err) {
        addLog(`Error: ${(err as Error).message}`);
        setStatus('error');
      }
    });

    ws.addEventListener('close', () => {
      addLog('WS closed');
      setStatus('idle');
    });

    ws.addEventListener('error', (e) => {
      addLog(`WS error: ${JSON.stringify(e)}`);
    });
  }, [roomId, displayName, addLog]);

  const leave = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    deviceRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setStatus('idle');
    addLog('Left room');
  }, [addLog]);

  useEffect(
    () => () => {
      wsRef.current?.close();
    },
    [],
  );

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'monospace', maxWidth: 800 }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>mediasoup PoC — Issue #207</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Room ID"
          disabled={status !== 'idle'}
          style={{ padding: '0.4rem 0.6rem', fontSize: '0.875rem', width: 160 }}
        />
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          disabled={status !== 'idle'}
          style={{ padding: '0.4rem 0.6rem', fontSize: '0.875rem', width: 140 }}
        />
        {status === 'idle' || status === 'error' ? (
          <button onClick={join} style={{ padding: '0.4rem 1rem' }}>
            Join
          </button>
        ) : (
          <button onClick={leave} style={{ padding: '0.4rem 1rem' }}>
            Leave
          </button>
        )}
        <span style={{ alignSelf: 'center', fontSize: '0.8rem', color: '#888' }}>
          status: {status}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>Local</div>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: 320, height: 240, background: '#111', display: 'block' }}
          />
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>Remote</div>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{ width: 320, height: 240, background: '#111', display: 'block' }}
          />
        </div>
      </div>

      <pre
        style={{
          background: '#111',
          color: '#0f0',
          padding: '0.75rem',
          fontSize: '0.75rem',
          height: 200,
          overflowY: 'auto',
          borderRadius: 4,
        }}
      >
        {log.join('\n') || '— log will appear here —'}
      </pre>
    </div>
  );
}

// ─── Signaling helpers (module-level, not hooks) ──────────────────────────────

function waitForEvent(ws: WebSocket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const handler = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as SignalMessage;
        if (parsed.event === event) {
          ws.removeEventListener('message', handler);
          resolve(parsed.data);
        }
      } catch {
        /* ignore */
      }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Timeout: ${event}`));
    }, 10_000);
  });
}

function wireSendTransport(
  ws: WebSocket,
  transport: types.Transport,
  log: (m: string) => void,
): void {
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    log('send transport connect');
    request(ws, 'conference.transport.connect', {
      transportId: transport.id,
      dtlsParameters,
    })
      .then(() => callback())
      .catch(errback);
  });

  transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
    log(`produce ${kind}`);
    request(ws, 'conference.produce', { kind, rtpParameters, appData })
      .then((resp) => callback({ id: (resp as { id: string }).id }))
      .catch(errback);
  });
}

function wireRecvTransport(
  ws: WebSocket,
  transport: types.Transport,
  log: (m: string) => void,
): void {
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    log('recv transport connect');
    request(ws, 'conference.transport.connect', {
      transportId: transport.id,
      dtlsParameters,
    })
      .then(() => callback())
      .catch(errback);
  });
}

async function consumeTrack(
  ws: WebSocket,
  device: types.Device,
  recvTransport: types.Transport,
  producerId: string,
  log: (m: string) => void,
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>,
): Promise<void> {
  send(ws, 'conference.consume', {
    producerId,
    rtpCapabilities: device.rtpCapabilities,
    producerSocketId: '',
  });

  const consumerParams = (await waitForEvent(ws, 'conference.consume')) as types.ConsumerOptions & {
    id: string;
  };
  if ('error' in consumerParams) {
    log(`Cannot consume: ${(consumerParams as unknown as { error: string }).error}`);
    return;
  }

  const consumer = await recvTransport.consume(consumerParams);
  log(`Consuming ${consumer.kind} track`);

  // Attach to remote video element.
  if (remoteVideoRef.current) {
    const existing = remoteVideoRef.current.srcObject as MediaStream | null;
    const stream = existing instanceof MediaStream ? existing : new MediaStream();
    stream.addTrack(consumer.track);
    remoteVideoRef.current.srcObject = stream;
  }

  // Resume (server pauses consumers by default to avoid media before the recv
  // transport DTLS handshake completes).
  send(ws, 'conference.consumer.resume', { consumerId: consumer.id });
  await waitForEvent(ws, 'conference.consumer.resume');
  log(`Consumer ${consumer.id} resumed`);
}
