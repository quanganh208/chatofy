/**
 * mediasoup PoC — Issue #210
 *
 * Mobile screen mirroring the web PoC at apps/web/app/(app)/conference-poc/page.tsx.
 * Signaling wire format: { event: string; data: unknown } over /ws/conference.
 * Call-state UI lives in conference-poc-call-view.tsx (split per 200-line rule).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  PermissionsAndroid,
  StyleSheet,
  Platform,
} from 'react-native';
import { registerGlobals, mediaDevices, MediaStream } from 'react-native-webrtc';
import { Device } from 'mediasoup-client';
import type { types } from 'mediasoup-client';
import { WS_SUBPROTOCOL } from '@chatofy/types/events';
import { toMediasoupTrack, toNativeTrack } from '@/conference/native-media-adapter';
import { ConferencePocCallView } from './conference-poc-call-view';

// MUST be called once at module level before any Device instantiation.
registerGlobals();

const API_BASE = process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://10.0.2.2:3001';
const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws/conference';

async function fetchAuthToken(): Promise<string> {
  const email = process.env['EXPO_PUBLIC_BENCH_EMAIL'] ?? '';
  const password = process.env['EXPO_PUBLIC_BENCH_PASSWORD'] ?? '';
  if (!email || !password)
    throw new Error(
      'Set EXPO_PUBLIC_BENCH_EMAIL and EXPO_PUBLIC_BENCH_PASSWORD in apps/mobile/.env',
    );
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const json = (await res.json()) as { data: { token: { accessToken: string } } };
  return json.data.token.accessToken;
}

// ─── Signaling ────────────────────────────────────────────────────────────────

type SignalMsg = { event: string; data: unknown };

function wsRequest(ws: WebSocket, event: string, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const handler = (msg: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(msg.data) as SignalMsg;
        if (parsed.event === event) {
          ws.removeEventListener('message', handler);
          resolve(parsed.data);
        }
      } catch {
        /* ignore */
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ event, data }));
    setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Timeout: ${event}`));
    }, 10_000);
  });
}

async function connectTransport(ws: WebSocket, transport: types.Transport): Promise<void> {
  transport.on('connect', ({ dtlsParameters }, cb, eb) => {
    wsRequest(ws, 'conference.transport.connect', { transportId: transport.id, dtlsParameters })
      .then(() => cb())
      .catch(eb);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ConferencePocScreen() {
  const [screen, setScreen] = useState<'lobby' | 'call'>('lobby');
  const [roomId, setRoomId] = useState('poc');
  const [displayName, setDisplayName] = useState('mobile-user');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<types.Device | null>(null);
  const recvTransportRef = useRef<types.Transport | null>(null);
  const mySocketIdRef = useRef('');

  const consumeProducer = useCallback(async (producerId: string) => {
    const ws = wsRef.current;
    const device = deviceRef.current;
    const recvTransport = recvTransportRef.current;
    if (!ws || !device || !recvTransport) return;
    const params = (await wsRequest(ws, 'conference.consume', {
      producerId,
      rtpCapabilities: device.rtpCapabilities,
    })) as types.ConsumerOptions;
    const consumer = await recvTransport.consume(params);
    await wsRequest(ws, 'conference.consumer.resume', { consumerId: consumer.id });
    const stream = new MediaStream();
    stream.addTrack(toNativeTrack(consumer.track));
    setRemoteStreams((prev) => [...prev, stream]);
  }, []);

  const handleJoin = useCallback(async () => {
    if (Platform.OS === 'android') {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);
    }

    const token = await fetchAuthToken();
    const ws = new WebSocket(WS_URL, [WS_SUBPROTOCOL, token]);
    wsRef.current = ws;
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res());
      ws.addEventListener('error', () => rej(new Error('WS open failed')));
    });

    const joinData = (await wsRequest(ws, 'conference.join', { roomId, displayName })) as {
      socketId: string;
      rtpCapabilities: types.RtpCapabilities;
      peers: { socketId: string; producers: { producerId: string }[] }[];
    };
    mySocketIdRef.current = joinData.socketId;

    const device = new Device();
    await device.load({ routerRtpCapabilities: joinData.rtpCapabilities });
    deviceRef.current = device;

    const sendParams = (await wsRequest(ws, 'conference.transport.create', {
      direction: 'send',
    })) as types.TransportOptions;
    const sendTransport = device.createSendTransport(sendParams);
    await connectTransport(ws, sendTransport);
    sendTransport.on('produce', ({ kind, rtpParameters, appData }, cb, eb) => {
      wsRequest(ws, 'conference.produce', { kind, rtpParameters, appData })
        .then((r) => cb({ id: (r as { id: string }).id }))
        .catch(eb);
    });

    const stream = (await mediaDevices.getUserMedia({ video: true, audio: true })) as MediaStream;
    setLocalStream(stream);
    const vt = stream.getVideoTracks()[0];
    const at = stream.getAudioTracks()[0];
    if (vt) await sendTransport.produce({ track: toMediasoupTrack(vt) });
    if (at) await sendTransport.produce({ track: toMediasoupTrack(at) });

    const recvParams = (await wsRequest(ws, 'conference.transport.create', {
      direction: 'recv',
    })) as types.TransportOptions;
    const recvTransport = device.createRecvTransport(recvParams);
    recvTransportRef.current = recvTransport;
    await connectTransport(ws, recvTransport);

    for (const { producerId } of joinData.peers.flatMap((peer) => peer.producers)) {
      await consumeProducer(producerId);
    }

    setScreen('call');

    ws.addEventListener('message', (evt: MessageEvent<string>) => {
      const msg = JSON.parse(evt.data) as SignalMsg;
      if (msg.event === 'conference.new.producer') {
        const d = msg.data as { producerId: string; socketId: string };
        if (d.socketId !== mySocketIdRef.current)
          consumeProducer(d.producerId).catch(console.error);
      }
    });
  }, [roomId, displayName, consumeProducer]);

  const handleLeave = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    deviceRef.current = null;
    recvTransportRef.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStreams([]);
    setScreen('lobby');
  }, [localStream]);

  useEffect(
    () => () => {
      wsRef.current?.close();
    },
    [],
  );

  if (screen === 'call' && localStream) {
    return (
      <ConferencePocCallView
        roomId={roomId}
        localStream={localStream}
        remoteStreams={remoteStreams}
        onLeave={handleLeave}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Conference PoC</Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Room</Text>
        <TextInput
          style={styles.input}
          value={roomId}
          onChangeText={setRoomId}
          placeholder="Room name"
          placeholderTextColor="#A8A29E"
          autoCapitalize="none"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Display name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor="#A8A29E"
          autoCapitalize="none"
        />
      </View>
      <TouchableOpacity style={styles.joinButton} onPress={handleJoin} activeOpacity={0.7}>
        <Text style={styles.joinButtonText}>Join call</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1C1917',
    marginBottom: 32,
    textAlign: 'center',
  },
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: '#6E6E73', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1C1917',
    backgroundColor: '#FAFAF9',
  },
  joinButton: {
    backgroundColor: '#0C0A09',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  joinButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
